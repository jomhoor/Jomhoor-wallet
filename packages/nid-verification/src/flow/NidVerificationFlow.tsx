import { View } from 'react-native'

import { useNidVerification } from '../hooks'
import type { ReadMockNidNfcInput } from '../nfc'
import { NidBackScanStep, NidFrontScanStep, NidLivenessFaceStep, NidNfcReadStep } from '../steps'
import type { NidNfcReadResult, NidVerificationResult } from '../types'

export type NidVerificationFlowProps = {
  initialNationalId?: string
  onComplete: (result: NidVerificationResult) => void
  onCancel?: () => void
  onError?: (error: Error) => void
  nfcReader?: (input: ReadMockNidNfcInput) => Promise<NidNfcReadResult>
}

export function NidVerificationFlow({
  initialNationalId,
  onComplete,
  onCancel,
  onError,
  nfcReader,
}: NidVerificationFlowProps): JSX.Element {
  const {
    currentStep,
    stepIndex,
    totalSteps,
    front,
    nfc,
    busy,
    errorMessage,
    submitFront,
    submitBack,
    readNfc,
    completeFaceVerification,
    goBack,
    cancel,
  } = useNidVerification({
    initialNationalId,
    onComplete,
    onCancel,
    onError,
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
              defaultNationalId={initialNationalId}
              errorMessage={errorMessage}
              onSubmit={submitFront}
              onCancel={cancel}
            />
          ),
          'back-scan': (
            <NidBackScanStep
              stepIndex={stepIndex}
              totalSteps={totalSteps}
              nationalIdHint={front?.nationalId?.value}
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
              onRead={() => {
                void readNfc()
              }}
              onBack={goBack}
              onCancel={cancel}
            />
          ),
          'face-liveness': (
            <NidLivenessFaceStep
              stepIndex={stepIndex}
              totalSteps={totalSteps}
              nfc={nfc}
              errorMessage={errorMessage}
              onComplete={completeFaceVerification}
              onBack={goBack}
              onCancel={cancel}
            />
          ),
        }[currentStep]
      }
    </View>
  )
}
