import {
  getNativePlatform,
  getPassportVerificationNativeStatus,
  invokeNativeCancel,
  invokeNativeProbe,
  invokeNativeRead,
} from '../../shared/native/passport-native-module'
import { createPassportNfcError } from './errors'
import type {
  PassportNfcAccessControl,
  PassportNfcBackend,
  PassportNfcProbeInput,
  PassportNfcProbeResult,
  PassportNfcReadInput,
  PassportNfcReadResult,
} from './types'

const mapAuthStatus = (
  value: unknown,
): 'success' | 'failed' | 'not_supported' | 'not_attempted' => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (normalized === 'success') return 'success'
  if (normalized === 'failed') return 'failed'
  if (normalized === 'not_supported') return 'not_supported'
  return 'not_attempted'
}

const mapBacStatus = (value: unknown): 'success' | 'failed' | 'not_attempted' => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (normalized === 'success') return 'success'
  if (normalized === 'failed') return 'failed'
  return 'not_attempted'
}

const mapErrorCode = (rawCode: unknown) => {
  const code = typeof rawCode === 'string' ? rawCode : ''
  switch (code) {
    case 'INVALID_INPUT':
      return 'INVALID_INPUT' as const
    case 'NFC_SESSION_BUSY':
    case 'NFC_RESOURCE_UNAVAILABLE':
      return 'NFC_SESSION_BUSY' as const
    case 'NFC_TIMEOUT':
    case 'TimeOutError':
      return 'NFC_TIMEOUT' as const
    case 'NFC_USER_CANCELLED':
    case 'USER_CANCELED':
      return 'NFC_SESSION_CANCELED' as const
    case 'BAC_FAILED':
      return 'BAC_AUTH_FAILED' as const
    case 'PACE_FAILED':
    case 'PACE_UNSUPPORTED':
      return 'PACE_FAILED' as const
    case 'NO_DATA_READ':
      return 'NO_DATA_READ' as const
    case 'UNSUPPORTED_PLATFORM':
      return 'BACKEND_UNAVAILABLE' as const
    default:
      return 'UNKNOWN_NATIVE_ERROR' as const
  }
}

const selectBackend = (
  input?: PassportNfcReadInput | PassportNfcProbeInput,
): PassportNfcBackend => {
  if (input?.backend) return input.backend

  const platform = getNativePlatform()
  if (platform === 'ios') return 'native-ios'
  if (platform === 'android') return 'native-android'
  return 'stub'
}

const mapNativeFiles = (value: unknown): PassportNfcReadResult['files'] => {
  if (!value || typeof value !== 'object') {
    return {}
  }

  const files: PassportNfcReadResult['files'] = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') {
      files[key] = {
        status: 'error',
        error: 'Invalid file payload',
      }
      continue
    }

    const entry = raw as Record<string, unknown>
    const status =
      entry.status === 'ok' || entry.status === 'missing' || entry.status === 'error'
        ? entry.status
        : 'error'

    files[key] = {
      status,
      data: entry,
      ...(typeof entry.imageBase64 === 'string' ? { base64: entry.imageBase64 } : {}),
      ...(typeof entry.filePath === 'string' ? { filePath: entry.filePath } : {}),
      ...(typeof entry.reason === 'string' ? { error: entry.reason } : {}),
    }
  }

  return files
}

const mapAccessControl = (value: unknown): PassportNfcAccessControl | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const raw = value as Record<string, unknown>
  const used = typeof raw.used === 'string' ? raw.used.toUpperCase() : 'UNKNOWN'
  const method: PassportNfcAccessControl['method'] =
    used === 'PACE' ? 'PACE' : used === 'BAC' ? 'BAC' : 'UNKNOWN'

  return {
    method,
    paceStatus: mapAuthStatus(raw.paceStatus),
    bacStatus: mapBacStatus(raw.bacStatus),
    fallbackUsed: raw.fallbackUsed === true,
    fallbackReason: typeof raw.fallbackReason === 'string' ? raw.fallbackReason : null,
  }
}

const normalizeReadResult = (backend: PassportNfcBackend, raw: unknown): PassportNfcReadResult => {
  const payload = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const files = mapNativeFiles(payload.files)
  const dg1Entry = files.DG1?.data as Record<string, unknown> | undefined
  const dg1 = dg1Entry?.parsed as Record<string, unknown> | undefined
  const dg2 = files.DG2

  const finalStatus =
    payload.finalStatus === 'success' ||
    payload.finalStatus === 'partial_success' ||
    payload.finalStatus === 'error'
      ? payload.finalStatus
      : 'error'

  return {
    finalStatus,
    backend,
    files,
    accessControl: mapAccessControl(payload.accessControl),
    ...(dg2
      ? {
          portrait: {
            ...(typeof dg2.base64 === 'string' ? { base64: dg2.base64 } : {}),
            ...(typeof dg2.filePath === 'string' ? { filePath: dg2.filePath } : {}),
          },
        }
      : {}),
    ...(dg1
      ? {
          normalized: {
            ...(typeof dg1.documentNumber === 'string'
              ? { documentNumber: dg1.documentNumber }
              : {}),
            ...(typeof dg1.firstName === 'string' ? { firstName: dg1.firstName } : {}),
            ...(typeof dg1.lastName === 'string' ? { lastName: dg1.lastName } : {}),
            ...(typeof dg1.dateOfBirth === 'string' ? { birthDate: dg1.dateOfBirth } : {}),
            ...(typeof dg1.documentExpiryDate === 'string'
              ? { expiryDate: dg1.documentExpiryDate }
              : {}),
            ...(typeof dg1.nationality === 'string' ? { nationality: dg1.nationality } : {}),
            ...(typeof dg1.gender === 'string' ? { sex: dg1.gender } : {}),
          },
        }
      : {}),
    raw,
  }
}

const isNativeUnavailableError = (error: unknown) =>
  error instanceof Error && error.message === 'NATIVE_MODULE_NOT_LINKED'

export async function readPassportNfc(input: PassportNfcReadInput): Promise<PassportNfcReadResult> {
  const backend = selectBackend(input)
  const platform = getNativePlatform()

  if (backend === 'native-ios') {
    if (platform !== 'ios') {
      throw createPassportNfcError(
        'NOT_IMPLEMENTED',
        'native-ios backend is only available on iOS.',
        backend,
      )
    }

    try {
      const raw = await invokeNativeRead(input)
      return normalizeReadResult(backend, raw)
    } catch (error) {
      if (isNativeUnavailableError(error)) {
        throw createPassportNfcError(
          'NATIVE_MODULE_NOT_LINKED',
          'Passport native module is not linked.',
          backend,
          error,
        )
      }

      const nativeError = error as { code?: unknown; message?: unknown }
      const mappedCode = mapErrorCode(nativeError?.code)
      const message =
        typeof nativeError?.message === 'string' && nativeError.message.length > 0
          ? nativeError.message
          : 'Passport NFC read failed.'
      throw createPassportNfcError(mappedCode, message, backend, error)
    }
  }

  if (backend === 'native-android') {
    throw createPassportNfcError(
      'NOT_IMPLEMENTED',
      'native-android backend is not implemented in this slice.',
      backend,
    )
  }

  if (backend === 'jomhoor-js') {
    throw createPassportNfcError(
      'NOT_IMPLEMENTED',
      'jomhoor-js backend is owned by host app adapter and not implemented in package.',
      backend,
    )
  }

  throw createPassportNfcError(
    'NOT_IMPLEMENTED',
    'stub backend does not perform NFC reads.',
    backend,
  )
}

export async function probePassportChip(
  input: PassportNfcProbeInput = {},
): Promise<PassportNfcProbeResult> {
  const backend = selectBackend(input)
  const platform = getNativePlatform()

  if (backend === 'native-ios') {
    if (platform !== 'ios') {
      throw createPassportNfcError(
        'BACKEND_UNAVAILABLE',
        'native-ios backend is only available on iOS.',
        backend,
      )
    }

    try {
      const raw = await invokeNativeProbe(input)
      const payload = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      const finalStatusValue =
        typeof payload.finalStatus === 'string' ? payload.finalStatus : 'error'
      const available = finalStatusValue === 'success' || finalStatusValue === 'partial_success'
      const details = {
        ...payload,
        finalStatus: finalStatusValue,
      }
      const detected = typeof payload.detected === 'boolean' ? payload.detected : available

      return {
        backend,
        available,
        detected,
        details,
      }
    } catch (error) {
      if (isNativeUnavailableError(error)) {
        throw createPassportNfcError(
          'NATIVE_MODULE_NOT_LINKED',
          'Passport native module is not linked.',
          backend,
          error,
        )
      }

      const nativeError = error as { code?: unknown; message?: unknown }
      throw createPassportNfcError(
        mapErrorCode(nativeError?.code),
        typeof nativeError?.message === 'string' && nativeError.message.length > 0
          ? nativeError.message
          : 'Passport probe failed.',
        backend,
        error,
      )
    }
  }

  if (backend === 'native-android') {
    throw createPassportNfcError(
      'BACKEND_UNAVAILABLE',
      'native-android backend is not available in this slice.',
      backend,
    )
  }

  throw createPassportNfcError(
    'NOT_IMPLEMENTED',
    `Probe backend "${backend}" is not implemented.`,
    backend,
  )
}

export async function cancelPassportNfcSession(): Promise<void> {
  await invokeNativeCancel()
}

export { getPassportVerificationNativeStatus }
