export type NextPassportStepAfterNfc = 'nfc-details' | 'face-liveness' | 'preview'

export function resolveNextPassportStepAfterNfc(
  faceFlowEnabled: boolean,
  hasNfcDetails: boolean,
): NextPassportStepAfterNfc {
  if (!faceFlowEnabled) return 'preview'
  return hasNfcDetails ? 'nfc-details' : 'face-liveness'
}
