import { useEffect, useMemo, useState } from 'react'

import {
  createVerificationError,
  DefaultVerificationUi,
  defaultVerificationLabels,
  resolveVerificationLabel,
  type VerificationError,
  type VerificationLabels,
  type VerificationTheme,
  type VerificationUiAdapter,
} from '../../shared'
import type { PassportCredentials } from '../../passport'
import type {
  PassportIdentityFlowData,
  PassportIdentityFlowConfig,
  PassportIdentityMrzMode,
  PassportIdentityVerificationResult,
  PassportIdentityFlowStep,
} from '../types'
import { usePassportIdentityFlowState } from './usePassportIdentityFlowState'
import { FLOW_STEP_DESCRIPTION_KEYS, FLOW_STEP_LABEL_KEYS } from './steps'
import { PlaceholderVerificationStep } from '../ui/PlaceholderVerificationStep'

export type PassportIdentityFlowProps = {
  config?: PassportIdentityFlowConfig
  mrzMode?: PassportIdentityMrzMode
  initialCredentials?: PassportCredentials
  onRequestHostMrz?: () => Promise<PassportCredentials>
  uiAdapter?: VerificationUiAdapter
  theme?: VerificationTheme
  labels?: VerificationLabels
  onCancel?: () => void
  onError?: (error: VerificationError) => void
  onComplete: (result: PassportIdentityVerificationResult) => void
}

const mockCredentials: PassportCredentials = {
  documentNumber: 'MOCK12345',
  dateOfBirthYYMMDD: '900101',
  expiryDateYYMMDD: '300101',
  mrzKey: 'MOCK12345900101300101<<',
}

const createMockResult = (
  flowData: PassportIdentityFlowData,
): PassportIdentityVerificationResult => ({
  passport: {
    ...flowData.passport,
    credentials: flowData.passport.credentials ?? mockCredentials,
    normalized: flowData.passport.normalized ?? {
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
    gaze: { passed: true, score: 1 },
    comparison: {
      passed: true,
      similarity: 0.99,
      threshold: 0.75,
      model: 'mock',
    },
  },
  finalDecision: 'verified',
  errors: flowData.errors,
  debug: { backend: 'stub', timingsMs: {} },
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
  mrzMode,
  initialCredentials,
  onRequestHostMrz,
  uiAdapter,
  labels,
  onCancel,
  onError,
  onComplete,
}: PassportIdentityFlowProps): JSX.Element {
  const ui = uiAdapter ?? DefaultVerificationUi
  const [mrzLoading, setMrzLoading] = useState(false)
  const [mrzErrorMessage, setMrzErrorMessage] = useState<string | undefined>(undefined)

  const effectiveMrzMode = mrzMode ?? config?.mrzMode ?? 'package-placeholder'
  const mergedLabels = useMemo(
    () => ({
      ...defaultVerificationLabels,
      ...(labels ?? {}),
    }),
    [labels],
  )

  const {
    flowData,
    currentStep,
    currentIndex,
    totalSteps,
    hasNext,
    goToNext,
    setCredentials,
    pushError,
  } = usePassportIdentityFlowState(config)

  useEffect(() => {
    if (initialCredentials) {
      setCredentials(initialCredentials)
    }
  }, [initialCredentials, setCredentials])

  const maskedDocumentNumber = useMemo(() => {
    const raw = flowData.passport.credentials?.documentNumber ?? ''
    if (!raw) return undefined
    if (raw.length <= 4) return `${raw.slice(0, 1)}***`
    return `${raw.slice(0, 2)}****${raw.slice(-2)}`
  }, [flowData.passport.credentials?.documentNumber])

  const handleHostMrzRequest = async () => {
    if (!onRequestHostMrz) {
      goToNext()
      return
    }

    setMrzLoading(true)
    setMrzErrorMessage(undefined)

    try {
      const credentials = await onRequestHostMrz()
      setCredentials(credentials)
      goToNext()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to obtain MRZ credentials.'
      setMrzErrorMessage(message)
      const verificationError = createVerificationError('MRZ_PARSE_FAILED', message, {
        domain: 'identity-flow',
        cause: error,
      })
      pushError(verificationError)
      onError?.(verificationError)
    } finally {
      setMrzLoading(false)
    }
  }

  const handleNext = async () => {
    if (currentStep === 'mrz') {
      const shouldUseHostMrz = effectiveMrzMode === 'host-provided'
      const hasCredentials = Boolean(flowData.passport.credentials)
      if (shouldUseHostMrz && !hasCredentials) {
        await handleHostMrzRequest()
        return
      }
    }

    if (hasNext) {
      goToNext()
      return
    }

    onComplete(createMockResult(flowData))
  }

  const mrzActionLabel =
    currentStep === 'mrz' && effectiveMrzMode === 'host-provided'
      ? resolveVerificationLabel(mergedLabels, 'mrz.captureHost', 'Capture MRZ')
      : undefined

  const mrzStatusLabel =
    currentStep === 'mrz' && flowData.passport.credentials
      ? resolveVerificationLabel(
          mergedLabels,
          'mrz.hostCaptured',
          `MRZ captured (${maskedDocumentNumber ?? 'masked'})`,
        )
      : undefined

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
      primaryActionLabel={mrzActionLabel}
      loading={mrzLoading}
      errorMessage={mrzErrorMessage}
      supplementalMessage={mrzStatusLabel}
      onNext={() => {
        void handleNext()
      }}
      onCancel={onCancel}
    />
  )
}
