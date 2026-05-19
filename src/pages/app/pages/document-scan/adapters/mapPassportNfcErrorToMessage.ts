import type { PassportNfcErrorCode } from '@iland/passport-verification/passport'

export type PassportNfcUiErrorMessage = {
  primary: string
  secondary?: string
  code?: string
}

type PassportNfcErrorLike = {
  detail?: {
    code?: string
    message?: string
  }
  code?: string
  message?: string
}

const AUTH_SECONDARY =
  'The document number, date of birth, or expiry date from MRZ may be incorrect. Please rescan MRZ and try again.'
const CONNECTION_SECONDARY =
  'Keep the passport flat against the back of the phone and hold it still until reading completes.'

const byCode = (code: PassportNfcErrorCode): PassportNfcUiErrorMessage => {
  switch (code) {
    case 'NATIVE_MODULE_NOT_LINKED':
    case 'BACKEND_UNAVAILABLE':
      return {
        primary: 'NFC backend is unavailable on this device build.',
      }
    case 'NFC_UNAVAILABLE':
      return {
        primary: 'NFC is not available on this device.',
      }
    case 'NFC_PERMISSION_MISSING':
      return {
        primary: 'NFC permission is missing. Please enable NFC access and try again.',
      }
    case 'NFC_SESSION_CANCELED':
      return {
        primary: 'NFC scan was cancelled.',
      }
    case 'NFC_SESSION_BUSY':
      return {
        primary: 'Another NFC session is still active. Please wait and try again.',
      }
    case 'NFC_TIMEOUT':
      return {
        primary: 'NFC scan timed out. Please keep the passport steady and retry.',
        secondary: CONNECTION_SECONDARY,
      }
    case 'INVALID_INPUT':
      return {
        primary: 'Passport data is incomplete. Please rescan MRZ first.',
      }
    case 'BAC_AUTH_FAILED':
    case 'PACE_FAILED':
      return {
        primary: 'Authentication failed while reading the passport chip.',
        secondary: AUTH_SECONDARY,
      }
    case 'DG_READ_FAILED':
      return {
        primary: 'Could not read passport chip data. Please try again.',
      }
    case 'NO_DATA_READ':
      return {
        primary: 'No passport data was read. Please try again.',
      }
    case 'NOT_IMPLEMENTED':
      return {
        primary: 'Selected NFC backend is not implemented yet.',
      }
    case 'UNKNOWN_NATIVE_ERROR':
    default:
      return {
        primary: 'NFC read failed. Please try again.',
      }
  }
}

function extractCodeAndMessage(error: unknown): { code?: string; message: string } {
  if (!error || typeof error !== 'object') {
    return { message: String(error ?? '') }
  }

  const typed = error as PassportNfcErrorLike
  const code = typed?.detail?.code ?? typed?.code
  const message =
    typed?.detail?.message ??
    typed?.message ??
    (error instanceof Error ? error.message : String(error))

  return {
    code,
    message,
  }
}

const inferCodeFromMessage = (message: string): PassportNfcErrorCode | undefined => {
  const lower = message.toLowerCase()

  if (lower.includes('external authenticate') || lower.includes('6982') || lower.includes('bac')) {
    return 'BAC_AUTH_FAILED'
  }
  if (lower.includes('pace')) {
    return 'PACE_FAILED'
  }
  if (lower.includes('timeout') || lower.includes('time out')) {
    return 'NFC_TIMEOUT'
  }
  if (lower.includes('cancel')) {
    return 'NFC_SESSION_CANCELED'
  }
  if (lower.includes('busy')) {
    return 'NFC_SESSION_BUSY'
  }
  if (
    lower.includes('connection lost') ||
    lower.includes('transceive fail') ||
    lower.includes('nfc connection')
  ) {
    return 'NFC_TIMEOUT'
  }
  if (lower.includes('not implemented')) {
    return 'NOT_IMPLEMENTED'
  }
  if (lower.includes('module is not linked')) {
    return 'NATIVE_MODULE_NOT_LINKED'
  }

  return undefined
}

export function mapPassportNfcErrorToMessage(
  error: unknown,
  options: { debugEnabled?: boolean } = {},
): PassportNfcUiErrorMessage {
  const { code, message } = extractCodeAndMessage(error)

  const normalizedCode = (code as PassportNfcErrorCode | undefined) ?? inferCodeFromMessage(message)

  const base = normalizedCode ? byCode(normalizedCode) : byCode('UNKNOWN_NATIVE_ERROR')

  return {
    ...base,
    ...(options.debugEnabled && normalizedCode ? { code: normalizedCode } : {}),
  }
}
