import { useEffect } from 'react'
import { View } from 'react-native'

import { useNidVerification } from '../hooks'
import type { NidNfcProbeResult, NidNfcReader } from '../nfc'
import { NidBackScanStep, NidFrontScanStep, NidNfcReadStep } from '../steps'
import type {
  NidBackScanResult,
  NidFrontScanResult,
  NidNfcReadResult,
  NidVerificationInitialData,
  NidVerificationResult,
} from '../types'

export type NidVerificationFlowProps = {
  initialNationalId?: string
  initialData?: NidVerificationInitialData
  onBackStored?: (value: NidBackScanResult) => Promise<void> | void
  onComplete: (result: NidVerificationResult) => void
  onCancel?: () => void
  onError?: (error: Error) => void
  onFrontStored?: (value: NidFrontScanResult) => Promise<void> | void
  onNfcStored?: (nfc: NidNfcReadResult, result: NidVerificationResult) => Promise<void> | void
  nfcReader?: NidNfcReader
  nfcProbeEnabled?: boolean
  nfcProbeBusy?: boolean
  nfcProbeResult?: NidNfcProbeResult
  onNfcProbe?: () => void
  nfcEvidenceLabel?: string
  nfcEvidenceSummary?: string
  onNfcEvidenceLabelChange?: (value: string) => void
  onLogNfcEvidence?: () => void
  onClearNfcEvidence?: () => void
  mode?: 'live' | 'demo'
  demoFrontImageUri?: string
  demoBarcodeRaw?: string
  demoScanDelayMs?: number
}

export function NidVerificationFlow({
  initialNationalId,
  initialData,
  onBackStored,
  onComplete,
  onCancel,
  onError,
  onFrontStored,
  onNfcStored,
  nfcReader,
  nfcProbeEnabled,
  nfcProbeBusy,
  nfcProbeResult,
  onNfcProbe,
  nfcEvidenceLabel,
  nfcEvidenceSummary,
  onNfcEvidenceLabelChange,
  onLogNfcEvidence,
  onClearNfcEvidence,
  mode = 'live',
  demoFrontImageUri,
  demoBarcodeRaw,
  demoScanDelayMs = 3000,
}: NidVerificationFlowProps): JSX.Element {
  const {
    currentStep,
    stepIndex,
    totalSteps,
    front,
    busy,
    errorMessage,
    nfc,
    pendingResult,
    submitFront,
    submitBack,
    readNfc,
    completeAfterNfc,
    goBack,
    cancel,
  } = useNidVerification({
    initialNationalId,
    initialData,
    onBackStored,
    onComplete,
    onCancel,
    onError,
    onFrontStored,
    onNfcStored,
    nfcReader,
  })
  const isDemoMode = mode === 'demo'
  const demoMessage = 'Demo mode uses fictional ID card data. No real document data is being read.'

  useEffect(() => {
    if (!isDemoMode || currentStep !== 'front-scan' || !demoFrontImageUri) return

    const timeout = setTimeout(() => {
      submitFront(demoFrontImageUri)
    }, demoScanDelayMs)

    return () => {
      clearTimeout(timeout)
    }
  }, [currentStep, demoFrontImageUri, demoScanDelayMs, isDemoMode, submitFront])

  useEffect(() => {
    if (!isDemoMode || currentStep !== 'back-scan' || !demoBarcodeRaw) return

    const timeout = setTimeout(() => {
      submitBack(demoBarcodeRaw)
    }, demoScanDelayMs)

    return () => {
      clearTimeout(timeout)
    }
  }, [currentStep, demoBarcodeRaw, demoScanDelayMs, isDemoMode, submitBack])

  return (
    <View style={{ flex: 1 }}>
      {
        {
          'front-scan': (
            <NidFrontScanStep
              stepIndex={stepIndex}
              totalSteps={totalSteps}
              errorMessage={errorMessage}
              onSubmit={submitFront}
              onCancel={cancel}
              demoMessage={isDemoMode ? demoMessage : undefined}
            />
          ),
          'back-scan': (
            <NidBackScanStep
              stepIndex={stepIndex}
              totalSteps={totalSteps}
              nationalIdHint={front?.nationalId?.value ?? initialNationalId}
              errorMessage={errorMessage}
              onSubmit={submitBack}
              onBack={goBack}
              onCancel={cancel}
              demoMessage={isDemoMode ? demoMessage : undefined}
            />
          ),
          'nfc-read': (
            <NidNfcReadStep
              stepIndex={stepIndex}
              totalSteps={totalSteps}
              busy={busy}
              errorMessage={errorMessage}
              nfcResult={nfc}
              mismatches={pendingResult?.mismatches}
              blockingErrors={pendingResult?.blockingErrors}
              onContinue={completeAfterNfc}
              onRead={() => {
                void readNfc()
              }}
              onBack={goBack}
              onCancel={cancel}
              probeEnabled={nfcProbeEnabled}
              probeBusy={nfcProbeBusy}
              probeResult={nfcProbeResult}
              onProbe={onNfcProbe}
              evidenceLabel={nfcEvidenceLabel}
              evidenceSummary={nfcEvidenceSummary}
              onEvidenceLabelChange={onNfcEvidenceLabelChange}
              onLogEvidence={onLogNfcEvidence}
              onClearEvidence={onClearNfcEvidence}
              demoMessage={
                isDemoMode
                  ? 'Demo mode: tap Start NFC Read to load fictional chip data without using NFC.'
                  : undefined
              }
            />
          ),
        }[currentStep]
      }
    </View>
  )
}
