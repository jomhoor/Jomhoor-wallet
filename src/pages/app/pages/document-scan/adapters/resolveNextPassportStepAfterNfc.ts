export type NextPassportStepAfterNfc = 'nfc-details' | 'face-liveness' | 'preview'

export function resolveNextPassportStepAfterNfc(
  faceFlowEnabled: boolean,
  _hasNfcDetails: boolean,
): NextPassportStepAfterNfc {
  if (!faceFlowEnabled) return 'preview'
  return 'nfc-details'
}
