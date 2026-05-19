export type NextPassportStepAfterNfc = 'face-liveness' | 'preview'

export function resolveNextPassportStepAfterNfc(
  faceFlowEnabled: boolean,
): NextPassportStepAfterNfc {
  return faceFlowEnabled ? 'face-liveness' : 'preview'
}
