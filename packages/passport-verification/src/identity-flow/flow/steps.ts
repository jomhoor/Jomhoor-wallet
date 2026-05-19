import type { PassportIdentityFlowStep } from '../types'

export const PASSPORT_IDENTITY_FLOW_STEPS: PassportIdentityFlowStep[] = [
  'mrz',
  'nfc',
  'liveness',
  'gaze',
  'comparison',
  'review',
  'complete',
]

export const FLOW_STEP_LABEL_KEYS: Record<PassportIdentityFlowStep, string> = {
  mrz: 'flow.step.mrz',
  nfc: 'flow.step.nfc',
  liveness: 'flow.step.liveness',
  gaze: 'flow.step.gaze',
  comparison: 'flow.step.comparison',
  review: 'flow.step.review',
  complete: 'flow.step.complete',
}

export const FLOW_STEP_DESCRIPTION_KEYS: Record<PassportIdentityFlowStep, string> = {
  mrz: 'mrz.description',
  nfc: 'nfc.description',
  liveness: 'liveness.title',
  gaze: 'gaze.title',
  comparison: 'comparison.title',
  review: 'review.title',
  complete: 'flow.mockResult',
}
