import { useCallback, useMemo, useState } from 'react'

import { parseNidBarcode } from '../barcode'
import { buildMockNidFaceVerificationResult } from '../face'
import { readMockNidNfc, type ReadMockNidNfcInput } from '../nfc'
import type {
  NidBackScanResult,
  NidFaceVerificationResult,
  NidFrontScanResult,
  NidNfcReadResult,
  NidVerificationResult,
  NidVerificationStep,
} from '../types'

const STEP_ORDER: NidVerificationStep[] = ['front-scan', 'back-scan', 'nfc-read', 'face-liveness']

type NidNfcReader = (input: ReadMockNidNfcInput) => Promise<NidNfcReadResult>

export type UseNidVerificationOptions = {
  initialNationalId?: string
  onComplete: (result: NidVerificationResult) => void
  onError?: (error: Error) => void
  onCancel?: () => void
  nfcReader?: NidNfcReader
}

function normalizeNationalId(value?: string): string | undefined {
  if (!value) return undefined

  const normalized = value
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/\D/g, '')

  if (!normalized) return undefined
  return normalized
}

function resolveNationalId(
  front?: NidFrontScanResult,
  back?: NidBackScanResult,
  nfc?: NidNfcReadResult,
): string | undefined {
  return (
    normalizeNationalId(nfc?.nationalId?.value) ??
    normalizeNationalId(back?.nationalId?.value) ??
    normalizeNationalId(front?.nationalId?.value)
  )
}

function collectMismatches(
  front?: NidFrontScanResult,
  back?: NidBackScanResult,
  nfc?: NidNfcReadResult,
): string[] {
  const mismatches: string[] = []

  const frontId = normalizeNationalId(front?.nationalId?.value)
  const backId = normalizeNationalId(back?.nationalId?.value)
  const nfcId = normalizeNationalId(nfc?.nationalId?.value)

  if (frontId && backId && frontId !== backId) {
    mismatches.push('front-vs-back-national-id-mismatch')
  }

  if (frontId && nfcId && frontId !== nfcId) {
    mismatches.push('front-vs-nfc-national-id-mismatch')
  }

  if (backId && nfcId && backId !== nfcId) {
    mismatches.push('back-vs-nfc-national-id-mismatch')
  }

  return mismatches
}

function buildBlockingErrors(params: {
  nationalId?: string
  nfc?: NidNfcReadResult
  face?: NidFaceVerificationResult
}): string[] {
  const errors: string[] = []

  if (!params.nationalId) {
    errors.push('missing-national-id')
  }

  if (!params.nfc || params.nfc.status !== 'success') {
    errors.push('nfc-read-not-successful')
  }

  if (!params.face || !params.face.passed) {
    errors.push('face-verification-not-passed')
  }

  return errors
}

export function useNidVerification({
  initialNationalId,
  onComplete,
  onError,
  onCancel,
  nfcReader,
}: UseNidVerificationOptions) {
  const [currentStep, setCurrentStep] = useState<NidVerificationStep>('front-scan')
  const [front, setFront] = useState<NidFrontScanResult>()
  const [back, setBack] = useState<NidBackScanResult>()
  const [nfc, setNfc] = useState<NidNfcReadResult>()
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string>()

  const safeNfcReader = nfcReader ?? readMockNidNfc

  const setError = useCallback(
    (error: Error) => {
      setErrorMessage(error.message)
      onError?.(error)
    },
    [onError],
  )

  const submitFront = useCallback(
    (nationalIdInput?: string) => {
      setErrorMessage(undefined)
      const nationalId =
        normalizeNationalId(nationalIdInput) ??
        normalizeNationalId(initialNationalId) ??
        normalizeNationalId('0084575948')

      if (!nationalId) {
        setError(new Error('National ID is required.'))
        return
      }

      setFront({
        frontImageUri: 'file://mock-nid-front.jpg',
        nationalId: {
          value: nationalId,
          source: nationalIdInput ? 'manual' : 'derived',
          confidence: 1,
        },
      })
      setCurrentStep('back-scan')
    },
    [initialNationalId, setError],
  )

  const submitBack = useCallback(
    (barcodeRaw?: string) => {
      setErrorMessage(undefined)

      const rawValue = String(barcodeRaw ?? '').trim()
      const fallbackNationalId = front?.nationalId?.value ?? initialNationalId ?? '0084575948'
      const fallbackRaw = `NID*${fallbackNationalId}*IRN`
      const resolvedRaw = rawValue || fallbackRaw
      const barcode = parseNidBarcode(resolvedRaw)

      setBack({
        backImageUri: 'file://mock-nid-back.jpg',
        barcodeRaw: resolvedRaw,
        barcode,
        nationalId: barcode?.nidn
          ? {
              value: barcode.nidn,
              source: 'barcode',
              confidence: 0.95,
            }
          : undefined,
      })
      setCurrentStep('nfc-read')
    },
    [front?.nationalId?.value, initialNationalId],
  )

  const readNfc = useCallback(async () => {
    setErrorMessage(undefined)
    setBusy(true)

    try {
      const expectedNationalId =
        normalizeNationalId(back?.nationalId?.value) ??
        normalizeNationalId(front?.nationalId?.value) ??
        normalizeNationalId(initialNationalId)

      const result = await safeNfcReader({
        expectedNationalId,
      })
      setNfc(result)
      setCurrentStep('face-liveness')
    } catch (error) {
      setError(error instanceof Error ? error : new Error('Failed to read NFC.'))
    } finally {
      setBusy(false)
    }
  }, [
    back?.nationalId?.value,
    front?.nationalId?.value,
    initialNationalId,
    safeNfcReader,
    setError,
  ])

  const completeFaceVerification = useCallback(() => {
    setErrorMessage(undefined)
    const face = buildMockNidFaceVerificationResult()

    const nationalId = resolveNationalId(front, back, nfc)
    const mismatches = collectMismatches(front, back, nfc)
    const blockingErrors = buildBlockingErrors({
      nationalId,
      nfc,
      face,
    })

    const verified = mismatches.length === 0 && blockingErrors.length === 0

    const result: NidVerificationResult = {
      verified,
      finalDecision: verified ? 'verified' : 'failed',
      front: front ?? {},
      back: back ?? {},
      nfc: nfc ?? {
        status: 'failed',
      },
      face,
      identity: nationalId
        ? {
            nationalId,
            firstName: nfc?.firstName?.value,
            lastName: nfc?.lastName?.value,
            birthDate: nfc?.birthDate?.value,
            cardNumber: nfc?.cardNumber?.value,
            expiryDate: nfc?.expiryDate?.value,
          }
        : undefined,
      mismatches,
      blockingErrors,
      debug: {
        mockedNfc: true,
        mockedFace: true,
        stepsCompleted: [...STEP_ORDER],
      },
    }

    onComplete(result)
  }, [back, front, nfc, onComplete])

  const goBack = useCallback(() => {
    const index = STEP_ORDER.indexOf(currentStep)
    if (index <= 0) return
    setCurrentStep(STEP_ORDER[index - 1])
  }, [currentStep])

  const cancel = useCallback(() => {
    onCancel?.()
  }, [onCancel])

  const stepIndex = useMemo(() => Math.max(STEP_ORDER.indexOf(currentStep), 0), [currentStep])

  return {
    currentStep,
    stepIndex,
    totalSteps: STEP_ORDER.length,
    front,
    back,
    nfc,
    busy,
    errorMessage,
    submitFront,
    submitBack,
    readNfc,
    completeFaceVerification,
    goBack,
    cancel,
  }
}
