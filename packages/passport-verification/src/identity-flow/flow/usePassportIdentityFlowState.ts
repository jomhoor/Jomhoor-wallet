import { useMemo, useState } from 'react'

import type { PassportIdentityFlowConfig, PassportIdentityFlowStep } from '../types'
import { PASSPORT_IDENTITY_FLOW_STEPS } from './steps'

function resolveInitialStep(
  config: PassportIdentityFlowConfig | undefined,
): PassportIdentityFlowStep {
  const requested = config?.initialStep
  if (requested && PASSPORT_IDENTITY_FLOW_STEPS.includes(requested)) {
    return requested
  }
  return PASSPORT_IDENTITY_FLOW_STEPS[0]
}

export function usePassportIdentityFlowState(config?: PassportIdentityFlowConfig) {
  const [currentStep, setCurrentStep] = useState<PassportIdentityFlowStep>(
    resolveInitialStep(config),
  )

  const currentIndex = useMemo(
    () => Math.max(PASSPORT_IDENTITY_FLOW_STEPS.indexOf(currentStep), 0),
    [currentStep],
  )

  const isComplete = currentStep === 'complete'
  const hasNext = currentIndex < PASSPORT_IDENTITY_FLOW_STEPS.length - 1

  const goToNext = () => {
    if (!hasNext) return
    setCurrentStep(PASSPORT_IDENTITY_FLOW_STEPS[currentIndex + 1])
  }

  const reset = () => {
    setCurrentStep(resolveInitialStep(config))
  }

  return {
    currentStep,
    currentIndex,
    totalSteps: PASSPORT_IDENTITY_FLOW_STEPS.length,
    isComplete,
    hasNext,
    goToNext,
    reset,
  }
}
