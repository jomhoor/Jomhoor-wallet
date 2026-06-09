import type { PropsWithChildren } from 'react'

import type { VerificationLabels, VerificationUiAdapter } from '../../shared'
import { resolveVerificationLabel } from '../../shared'
import type { PassportIdentityFlowStep } from '../types'

type PlaceholderVerificationStepProps = {
  ui: VerificationUiAdapter
  labels?: VerificationLabels
  step: PassportIdentityFlowStep
  stepIndex: number
  totalSteps: number
  title: string
  description: string
  isFinalAction: boolean
  primaryActionLabel?: string
  loading?: boolean
  errorMessage?: string
  supplementalMessage?: string
  onNext: () => void
  onCancel?: () => void
}

export function PlaceholderVerificationStep({
  ui,
  labels,
  step,
  stepIndex,
  totalSteps,
  title,
  description,
  isFinalAction,
  primaryActionLabel,
  loading = false,
  errorMessage,
  supplementalMessage,
  onNext,
  onCancel,
}: PlaceholderVerificationStepProps): JSX.Element {
  const Card = ui.Card ?? (({ children }: PropsWithChildren): JSX.Element => <>{children}</>)
  const stepProgressText = `Step ${stepIndex + 1} / ${totalSteps}`
  const placeholderModeText = 'Placeholder mode only. No live camera/NFC is running in this phase.'

  const stepLabel = resolveVerificationLabel(labels, `flow.step.${step}`, step)
  const resolvedPrimaryActionLabel =
    primaryActionLabel ??
    (isFinalAction
      ? resolveVerificationLabel(labels, 'flow.finish', 'Finish')
      : resolveVerificationLabel(labels, 'flow.next', 'Next'))

  return (
    <ui.Screen>
      <Card>
        <ui.Text tone='muted'>{stepProgressText}</ui.Text>
        <ui.Text tone='primary'>{stepLabel}</ui.Text>
        <ui.Text tone='primary'>{title}</ui.Text>
        <ui.Text tone='secondary'>{description}</ui.Text>
      </Card>

      <Card>
        <ui.Text tone='muted'>{placeholderModeText}</ui.Text>
        {supplementalMessage ? <ui.Text tone='secondary'>{supplementalMessage}</ui.Text> : null}
        {errorMessage ? <ui.Text tone='error'>{errorMessage}</ui.Text> : null}
      </Card>

      <ui.Button title={resolvedPrimaryActionLabel} onPress={onNext} loading={loading} />
      {onCancel ? (
        <ui.Button
          title={resolveVerificationLabel(labels, 'flow.cancel', 'Cancel')}
          onPress={onCancel}
          variant='secondary'
        />
      ) : null}
    </ui.Screen>
  )
}
