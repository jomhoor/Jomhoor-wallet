import { useCallback, useMemo, useState } from 'react'

import { parseNidBarcode } from '../barcode'
import { readMockNidNfc, type NidNfcReader } from '../nfc'
import type {
  NidBackScanResult,
  NidFrontScanResult,
  NidNfcReadResult,
  NidVerificationResult,
  NidVerificationStep,
} from '../types'

const STEP_ORDER: NidVerificationStep[] = ['front-scan', 'back-scan', 'nfc-read']

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

function isValidNationalId(value?: string): boolean {
  const nationalId = normalizeNationalId(value)
  if (!nationalId || nationalId.length !== 10) return false
  if (/^(.)\1+$/.test(nationalId)) return false

  const digits = nationalId.split('').map(Number)
  const checkDigit = digits[9]
  const sum = digits.slice(0, 9).reduce((acc, digit, index) => acc + digit * (10 - index), 0)
  const remainder = sum % 11

  return remainder < 2 ? checkDigit === remainder : checkDigit === 11 - remainder
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

function buildBlockingErrors(params: { nationalId?: string; nfc?: NidNfcReadResult }): string[] {
  const errors: string[] = []

  if (!params.nationalId) {
    errors.push('missing-national-id')
  }

  if (params.nationalId && !isValidNationalId(params.nationalId)) {
    errors.push('invalid-national-id')
  }

  if (!params.nfc || params.nfc.status !== 'success') {
    errors.push('nfc-read-not-successful')
  }

  if (!params.nfc?.signingCertHex) {
    errors.push('missing-signing-certificate')
  }

  if (!params.nfc?.authCertHex) {
    errors.push('missing-auth-certificate')
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
  const [pendingResult, setPendingResult] = useState<NidVerificationResult>()
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
      setPendingResult(undefined)
      const nationalId =
        normalizeNationalId(nationalIdInput) ?? normalizeNationalId(initialNationalId)

      if (!nationalId) {
        setError(new Error('National ID is required.'))
        return
      }

      if (!isValidNationalId(nationalId)) {
        setError(new Error('National ID is invalid.'))
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
      setPendingResult(undefined)

      const rawValue = String(barcodeRaw ?? '').trim()
      const fallbackNationalId = front?.nationalId?.value ?? initialNationalId
      const fallbackRaw = fallbackNationalId ? `NID*${fallbackNationalId}*IRN` : ''
      const resolvedRaw = rawValue || fallbackRaw

      if (!resolvedRaw) {
        setError(new Error('Barcode payload is required.'))
        return
      }

      const barcode = parseNidBarcode(resolvedRaw)
      const parsedNationalId = normalizeNationalId(barcode?.nidn)

      if (!barcode || !parsedNationalId || !isValidNationalId(parsedNationalId)) {
        setError(new Error('Barcode unreadable. Please rescan the card back barcode.'))
        return
      }

      setBack({
        backImageUri: 'file://mock-nid-back.jpg',
        barcodeRaw: resolvedRaw,
        barcode,
        nationalId: {
          value: parsedNationalId,
          source: 'barcode',
          confidence: 0.95,
        },
      })
      setCurrentStep('nfc-read')
    },
    [front?.nationalId?.value, initialNationalId, setError],
  )

  const readNfc = useCallback(async () => {
    setErrorMessage(undefined)
    setPendingResult(undefined)
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
      if (result.status !== 'success') {
        setError(new Error('NFC read failed. Please retry.'))
        return
      }

      const nationalId = resolveNationalId(front, back, result)
      const mismatches = collectMismatches(front, back, result)
      const blockingErrors = buildBlockingErrors({
        nationalId,
        nfc: result,
      })
      if (mismatches.length > 0) {
        blockingErrors.push('national-id-mismatch')
      }
      const verified = mismatches.length === 0 && blockingErrors.length === 0

      const phaseTwoHandoffResult: NidVerificationResult = {
        verified,
        finalDecision: verified ? 'verified' : 'failed',
        front: front ?? {},
        back: back ?? {},
        nfc: result,
        face: {
          passed: false,
          liveness: {
            passed: false,
            challenges: [],
          },
          gaze: {
            passed: false,
            score: 0,
          },
          comparison: {
            passed: false,
            similarity: 0,
            threshold: 0.1,
          },
        },
        identity: nationalId
          ? {
              nationalId,
              firstName: result.firstName?.value,
              lastName: result.lastName?.value,
              birthDate: result.birthDate?.value,
              cardNumber: result.cardNumber?.value,
              expiryDate: result.expiryDate?.value,
            }
          : undefined,
        mismatches,
        blockingErrors,
        debug: {
          mockedNfc: result.debug?.mocked === true,
          mockedFace: false,
          stepsCompleted: [...STEP_ORDER],
        },
      }

      setPendingResult(phaseTwoHandoffResult)
    } catch (error) {
      setError(error instanceof Error ? error : new Error('Failed to read NFC.'))
    } finally {
      setBusy(false)
    }
  }, [back, front, initialNationalId, safeNfcReader, setError])

  const completeAfterNfc = useCallback(() => {
    if (!pendingResult) {
      return
    }
    onComplete(pendingResult)
  }, [onComplete, pendingResult])

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
    pendingResult,
    busy,
    errorMessage,
    submitFront,
    submitBack,
    readNfc,
    completeAfterNfc,
    goBack,
    cancel,
  }
}
