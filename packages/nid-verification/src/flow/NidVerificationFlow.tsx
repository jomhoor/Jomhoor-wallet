import { View } from 'react-native'

import { useNidVerification } from '../hooks'
import type { NidNfcReader } from '../nfc'
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
            />
          ),
        }[currentStep]
      }
    </View>
  )
}
