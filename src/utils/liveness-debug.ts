import { Env } from '@env'

const IS_DEBUG_ENABLED = Env.LIVENESS_DEBUG === 'enabled'

export const LivenessDebugLogger = {
  isEnabled: () => IS_DEBUG_ENABLED,

  runtime: (payload: Record<string, unknown>) => {
    if (!IS_DEBUG_ENABLED) return
    // eslint-disable-next-line no-console
    console.log('[JOMHOOR_RUNTIME_DEBUG]', JSON.stringify(payload))
  },

  camera: (payload: Record<string, unknown>) => {
    if (!IS_DEBUG_ENABLED) return
    // eslint-disable-next-line no-console
    console.log('[JOMHOOR_CAMERA_DEBUG]', JSON.stringify(payload))
  },

  frameProcessor: (payload: Record<string, unknown>) => {
    if (!IS_DEBUG_ENABLED) return
    // eslint-disable-next-line no-console
    console.log('[JOMHOOR_FRAME_PROCESSOR_DEBUG]', JSON.stringify(payload))
  },

  faceDetector: (payload: Record<string, unknown>) => {
    if (!IS_DEBUG_ENABLED) return
    // eslint-disable-next-line no-console
    console.log('[JOMHOOR_FACE_DETECTOR_DEBUG]', JSON.stringify(payload))
  },

  liveness: (payload: Record<string, unknown>) => {
    if (!IS_DEBUG_ENABLED) return
    // eslint-disable-next-line no-console
    console.log('[JOMHOOR_LIVENESS_DEBUG]', JSON.stringify(payload))
  },

  error: (tag: string, payload: Record<string, unknown>) => {
    if (!IS_DEBUG_ENABLED) return
    // eslint-disable-next-line no-console
    console.log(`[${tag}]`, JSON.stringify(payload))
  },
}
