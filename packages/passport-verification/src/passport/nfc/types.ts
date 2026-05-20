import type { VerificationError } from '../../shared/errors'
import type { PassportCredentials } from '../types'

export type PassportNfcBackend = 'native-ios' | 'native-android' | 'jomhoor-js' | 'stub'

export type PassportNfcAccessControl = {
  method?: 'PACE' | 'BAC' | 'UNKNOWN'
  paceStatus?: 'success' | 'failed' | 'not_supported' | 'not_attempted' | string
  bacStatus?: 'success' | 'failed' | 'not_attempted' | string
  fallbackUsed?: boolean
  fallbackReason?: string | null
}

export type PassportNfcFileResult = {
  status: 'ok' | 'missing' | 'error'
  data?: unknown
  base64?: string
  filePath?: string
  error?: string
}

export type PassportNfcReadInput = Omit<PassportCredentials, 'mrzKey'> & {
  mrzKey?: string
  backend?: PassportNfcBackend
  timeoutMs?: number
  requestedDataGroups?: string[]
  includeImageBase64?: boolean
  persistDg2ImageFile?: boolean
}

export type PassportNfcReadResult = {
  finalStatus: 'success' | 'partial_success' | 'error'
  backend: PassportNfcBackend
  files: Record<string, PassportNfcFileResult>
  accessControl?: PassportNfcAccessControl
  portrait?: {
    base64?: string
    filePath?: string
  }
  normalized?: {
    documentNumber?: string
    firstName?: string
    lastName?: string
    birthDate?: string
    expiryDate?: string
    nationality?: string
    sex?: string
  }
  raw?: unknown
}

export type PassportNfcProbeInput = Partial<PassportCredentials> & {
  backend?: PassportNfcBackend
  timeoutMs?: number
}

export type PassportNfcProbeResult = {
  backend: PassportNfcBackend
  available: boolean
  detected?: boolean
  details?: Record<string, unknown>
}

export type PassportNfcErrorCode =
  | 'NATIVE_MODULE_NOT_LINKED'
  | 'NFC_UNAVAILABLE'
  | 'NFC_PERMISSION_MISSING'
  | 'NFC_SESSION_CANCELED'
  | 'NFC_SESSION_BUSY'
  | 'NFC_TIMEOUT'
  | 'INVALID_INPUT'
  | 'BAC_AUTH_FAILED'
  | 'PACE_FAILED'
  | 'DG_READ_FAILED'
  | 'NO_DATA_READ'
  | 'NOT_IMPLEMENTED'
  | 'BACKEND_UNAVAILABLE'
  | 'UNKNOWN_NATIVE_ERROR'

export type PassportNfcError = VerificationError & {
  code: PassportNfcErrorCode
  backend?: PassportNfcBackend
}
