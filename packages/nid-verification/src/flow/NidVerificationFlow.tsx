import { View } from 'react-native'

import { useNidVerification } from '../hooks'
import type { NidNfcReader } from '../nfc'
import { NidBackScanStep, NidFrontScanStep, NidNfcReadStep } from '../steps'
import type { NidVerificationResult } from '../types'

export type NidVerificationFlowProps = {
  initialNationalId?: string
  onComplete: (result: NidVerificationResult) => void
  onCancel?: () => void
  onError?: (error: Error) => void
  nfcReader?: NidNfcReader
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
    busy,
    errorMessage,
    nfc,
    submitFront,
    submitBack,
    readNfc,
    completeAfterNfc,
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
              nfcResult={nfc}
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
