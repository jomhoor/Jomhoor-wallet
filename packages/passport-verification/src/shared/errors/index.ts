export type VerificationErrorCode =
  | 'INVALID_INPUT'
  | 'MRZ_PARSE_FAILED'
  | 'INVALID_CREDENTIALS'
  | 'NATIVE_MODULE_NOT_LINKED'
  | 'NFC_UNAVAILABLE'
  | 'NFC_PERMISSION_MISSING'
  | 'NFC_SESSION_CANCELED'
  | 'NFC_SESSION_BUSY'
  | 'NFC_TIMEOUT'
  | 'BAC_AUTH_FAILED'
  | 'PACE_FAILED'
  | 'DG_READ_FAILED'
  | 'NO_DATA_READ'
  | 'NOT_IMPLEMENTED'
  | 'BACKEND_UNAVAILABLE'
  | 'CAMERA_PERMISSION_DENIED'
  | 'FACE_NOT_DETECTED'
  | 'LIVENESS_FAILED'
  | 'GAZE_FAILED'
  | 'FACE_COMPARISON_FAILED'
  | 'MODEL_LOAD_FAILED'
  | 'UNKNOWN_NATIVE_ERROR'
  | 'UNKNOWN'

export type VerificationError = {
  code: VerificationErrorCode
  message: string
  domain?: 'passport' | 'face' | 'identity-flow' | 'shared'
  backend?: string
  cause?: unknown
  debug?: Record<string, unknown>
}

export const createVerificationError = (
  code: VerificationErrorCode,
  message: string,
  options: Omit<VerificationError, 'code' | 'message'> = {},
): VerificationError => ({
  code,
  message,
  ...options,
})
