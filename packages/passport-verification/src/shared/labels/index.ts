export type VerificationLabels = Record<string, string>

export const defaultVerificationLabels = {
  'flow.cancel': 'Cancel',
  'flow.continue': 'Continue',
  'flow.next': 'Next',
  'flow.finish': 'Finish',
  'flow.retry': 'Retry',
  'flow.mockResult': 'This is a placeholder flow result.',
  'flow.step.mrz': 'MRZ',
  'flow.step.nfc': 'NFC',
  'flow.step.liveness': 'Liveness',
  'flow.step.gaze': 'Gaze',
  'flow.step.comparison': 'Comparison',
  'flow.step.review': 'Review',
  'flow.step.complete': 'Complete',
  'mrz.title': 'Scan passport',
  'mrz.description': 'Scan the MRZ section of your passport.',
  'nfc.title': 'Read passport chip',
  'nfc.description': 'Hold your phone near the passport chip.',
  'liveness.title': 'Liveness check',
  'gaze.title': 'Gaze challenge',
  'comparison.title': 'Face comparison',
  'review.title': 'Review your information',
} as const

export function resolveVerificationLabel(
  labels: VerificationLabels | undefined,
  key: string,
  fallback?: string,
): string {
  const value = labels?.[key]
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }

  const defaultValue = defaultVerificationLabels[key as keyof typeof defaultVerificationLabels]
  if (typeof defaultValue === 'string') {
    return defaultValue
  }

  return fallback ?? key
}
