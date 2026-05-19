import { useMemo } from 'react'

import {
  DefaultVerificationUi,
  defaultVerificationLabels,
  resolveVerificationLabel,
  type VerificationError,
  type VerificationLabels,
  type VerificationTheme,
  type VerificationUiAdapter,
} from '../../shared'
import type {
  PassportIdentityFlowConfig,
  PassportIdentityVerificationResult,
  PassportIdentityFlowStep,
} from '../types'
import { usePassportIdentityFlowState } from './usePassportIdentityFlowState'
import { FLOW_STEP_DESCRIPTION_KEYS, FLOW_STEP_LABEL_KEYS } from './steps'
import { PlaceholderVerificationStep } from '../ui/PlaceholderVerificationStep'

export type PassportIdentityFlowProps = {
  config?: PassportIdentityFlowConfig
  uiAdapter?: VerificationUiAdapter
  theme?: VerificationTheme
  labels?: VerificationLabels
  onCancel?: () => void
  onError?: (error: VerificationError) => void
  onComplete: (result: PassportIdentityVerificationResult) => void
}

const createMockResult = (): PassportIdentityVerificationResult => ({
  passport: {
    credentials: {
      documentNumber: 'MOCK12345',
      dateOfBirthYYMMDD: '900101',
      expiryDateYYMMDD: '300101',
      mrzKey: 'MOCK12345900101300101<<',
    },
    normalized: {
      documentNumber: 'MOCK12345',
      firstName: 'Mock',
      lastName: 'User',
      birthDate: '1990-01-01',
      expiryDate: '2030-01-01',
      nationality: 'UTO',
      sex: 'UNSPECIFIED',
    },
  },
  face: {
    liveness: { passed: true, challenges: [] },
    gaze: { passed: true },
    comparison: {
      passed: true,
      similarity: 0.99,
      threshold: 0.75,
      model: 'mock',
    },
  },
  finalDecision: 'verified',
  debug: {
    backend: 'stub',
    timingsMs: {},
  },
})

const buildStepTitle = (
  labels: VerificationLabels | undefined,
  step: PassportIdentityFlowStep,
): string => {
  const stepLabelKey = FLOW_STEP_LABEL_KEYS[step]
  return resolveVerificationLabel(labels, stepLabelKey, step)
}

const buildStepDescription = (
  labels: VerificationLabels | undefined,
  step: PassportIdentityFlowStep,
): string => {
  const descriptionKey = FLOW_STEP_DESCRIPTION_KEYS[step]
  return resolveVerificationLabel(labels, descriptionKey, descriptionKey)
}

export function PassportIdentityFlow({
  config,
  uiAdapter,
  labels,
  onCancel,
  onComplete,
}: PassportIdentityFlowProps): JSX.Element {
  const ui = uiAdapter ?? DefaultVerificationUi
  const mergedLabels = useMemo(
    () => ({
      ...defaultVerificationLabels,
      ...(labels ?? {}),
    }),
    [labels],
  )

  const { currentStep, currentIndex, totalSteps, hasNext, goToNext } =
    usePassportIdentityFlowState(config)

  const handleNext = () => {
    if (hasNext) {
      goToNext()
      return
    }

    onComplete(createMockResult())
  }

  return (
    <PlaceholderVerificationStep
      ui={ui}
      labels={mergedLabels}
      step={currentStep}
      stepIndex={currentIndex}
      totalSteps={totalSteps}
      title={buildStepTitle(mergedLabels, currentStep)}
      description={buildStepDescription(mergedLabels, currentStep)}
      isFinalAction={!hasNext}
      onNext={handleNext}
      onCancel={onCancel}
    />
  )
}
