import { useCallback, useMemo, useState } from 'react'

import type { PassportCredentials } from '../../passport'
import type { VerificationError } from '../../shared'
import type {
  PassportIdentityFlowConfig,
  PassportIdentityFlowData,
  PassportIdentityFlowStep,
} from '../types'
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
  const [flowData, setFlowData] = useState<PassportIdentityFlowData>({
    passport: {},
  })

  const currentIndex = useMemo(
    () => Math.max(PASSPORT_IDENTITY_FLOW_STEPS.indexOf(currentStep), 0),
    [currentStep],
  )

  const isComplete = currentStep === 'complete'
  const hasNext = currentIndex < PASSPORT_IDENTITY_FLOW_STEPS.length - 1

  const goToNext = useCallback(() => {
    if (!hasNext) return
    setCurrentStep(PASSPORT_IDENTITY_FLOW_STEPS[currentIndex + 1])
  }, [currentIndex, hasNext])

  const reset = useCallback(() => {
    setCurrentStep(resolveInitialStep(config))
    setFlowData({
      passport: {},
    })
  }, [config])

  const setCredentials = useCallback((credentials: PassportCredentials) => {
    setFlowData(previous => ({
      ...previous,
      passport: {
        ...previous.passport,
        credentials,
      },
    }))
  }, [])

  const pushError = useCallback((error: VerificationError) => {
    setFlowData(previous => ({
      ...previous,
      errors: [...(previous.errors ?? []), error],
    }))
  }, [])

  return {
    flowData,
    currentStep,
    currentIndex,
    totalSteps: PASSPORT_IDENTITY_FLOW_STEPS.length,
    isComplete,
    hasNext,
    goToNext,
    reset,
    setCredentials,
    pushError,
  }
}
