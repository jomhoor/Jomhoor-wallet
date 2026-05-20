import type { PassportNfcProbeInput, PassportNfcReadInput } from '../../passport/nfc/types'

export type PassportVerificationNativeStatus = {
  platform: 'ios' | 'android' | 'unknown'
  nativeLinked: boolean
  module: string
  version?: string
}

type NativePassportModule = {
  getPassportVerificationNativeStatus?: () =>
    | Promise<PassportVerificationNativeStatus>
    | PassportVerificationNativeStatus
  readPassport?: (input: Record<string, unknown>) => Promise<unknown>
  probePassportChip?: (input: Record<string, unknown>) => Promise<unknown>
  cancelSession?: () => Promise<void>
  disconnect?: () => Promise<void>
}

const MODULE_NAMES = ['PassportVerificationModule', 'PassportVerification']

function isNativeNfcDebugEnabled(): boolean {
  return __DEV__ && process.env.EXPO_PUBLIC_PASSPORT_NFC_DEBUG === 'enabled'
}

function logNativeNfcJson(label: string, value: unknown): void {
  if (!isNativeNfcDebugEnabled()) return

  const payload =
    (() => {
      try {
        return JSON.stringify(value, null, 2)
      } catch {
        return String(value)
      }
    })() ?? 'undefined'

  // dummy condition to not log payload
  if (payload.length < 1000) {
    // eslint-disable-next-line no-console
    console.log(`[PASSPORT-NFC][NATIVE-BRIDGE][${label}]`, payload)
  }
}

function fallbackStatus(
  moduleName = 'PassportVerificationModule',
): PassportVerificationNativeStatus {
  return {
    platform: 'unknown',
    nativeLinked: false,
    module: moduleName,
  }
}

export function normalizeStatus(input: unknown): PassportVerificationNativeStatus {
  if (!input || typeof input !== 'object') return fallbackStatus()

  const raw = input as Partial<PassportVerificationNativeStatus>
  const platform =
    raw.platform === 'ios' || raw.platform === 'android' || raw.platform === 'unknown'
      ? raw.platform
      : 'unknown'

  return {
    platform,
    nativeLinked: raw.nativeLinked === true,
    module:
      typeof raw.module === 'string' && raw.module.length > 0
        ? raw.module
        : 'PassportVerificationModule',
    ...(typeof raw.version === 'string' && raw.version.length > 0 ? { version: raw.version } : {}),
  }
}

export function getNativePlatform(): 'ios' | 'android' | 'unknown' {
  try {
    const reactNative = require('react-native') as {
      Platform?: { OS?: string }
    }
    const platform = reactNative?.Platform?.OS
    if (platform === 'ios' || platform === 'android') {
      return platform
    }
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

export function loadPassportNativeModule(): {
  module: NativePassportModule | null
  moduleName: string
} {
  try {
    const reactNative = require('react-native') as {
      NativeModules?: Record<string, unknown>
    }

    for (const moduleName of MODULE_NAMES) {
      const candidate = reactNative?.NativeModules?.[moduleName] as NativePassportModule | undefined
      if (candidate) {
        return { module: candidate, moduleName }
      }
    }

    return { module: null, moduleName: MODULE_NAMES[0] }
  } catch {
    return { module: null, moduleName: MODULE_NAMES[0] }
  }
}

export async function getPassportVerificationNativeStatus(): Promise<PassportVerificationNativeStatus> {
  const loaded = loadPassportNativeModule()
  if (!loaded.module || typeof loaded.module.getPassportVerificationNativeStatus !== 'function') {
    return fallbackStatus(loaded.moduleName)
  }

  try {
    const result = await loaded.module.getPassportVerificationNativeStatus()
    return normalizeStatus(result)
  } catch {
    return fallbackStatus(loaded.moduleName)
  }
}

export function toNativeReadPayload(input: PassportNfcReadInput): Record<string, unknown> {
  const dateOfBirthYYMMDD = input.dateOfBirthYYMMDD ?? input.dateOfBirth
  const expiryDateYYMMDD = input.expiryDateYYMMDD ?? input.dateOfExpiry

  return {
    credentials: {
      mrzKey: input.mrzKey,
      documentNumber: input.documentNumber,
      dateOfBirth: dateOfBirthYYMMDD,
      dateOfExpiry: expiryDateYYMMDD,
    },
    dataGroups: input.requestedDataGroups,
    ...(typeof input.includeImageBase64 === 'boolean'
      ? { includeImageBase64: input.includeImageBase64 }
      : {}),
    ...(typeof input.persistDg2ImageFile === 'boolean'
      ? { persistDg2ImageFile: input.persistDg2ImageFile }
      : {}),
  }
}

export function toNativeProbePayload(input: PassportNfcProbeInput): Record<string, unknown> {
  const extendedInput = input as PassportNfcProbeInput & { requestedDataGroups?: string[] }
  const dateOfBirthYYMMDD = input.dateOfBirthYYMMDD ?? input.dateOfBirth
  const expiryDateYYMMDD = input.expiryDateYYMMDD ?? input.dateOfExpiry

  return {
    credentials: {
      mrzKey: input.mrzKey,
      documentNumber: input.documentNumber,
      dateOfBirth: dateOfBirthYYMMDD,
      dateOfExpiry: expiryDateYYMMDD,
    },
    dataGroups: extendedInput.requestedDataGroups,
  }
}

export async function invokeNativeRead(input: PassportNfcReadInput): Promise<unknown> {
  const loaded = loadPassportNativeModule()
  if (!loaded.module || typeof loaded.module.readPassport !== 'function') {
    throw new Error('NATIVE_MODULE_NOT_LINKED')
  }
  const payload = toNativeReadPayload(input)
  logNativeNfcJson('READ_PAYLOAD', payload)
  const response = await loaded.module.readPassport(payload)
  // logNativeNfcJson('READ_RESPONSE', response)
  return response
}

export async function invokeNativeProbe(input: PassportNfcProbeInput): Promise<unknown> {
  const loaded = loadPassportNativeModule()
  if (!loaded.module || typeof loaded.module.probePassportChip !== 'function') {
    throw new Error('NATIVE_MODULE_NOT_LINKED')
  }
  return loaded.module.probePassportChip(toNativeProbePayload(input))
}

export async function invokeNativeCancel(): Promise<void> {
  const loaded = loadPassportNativeModule()
  if (!loaded.module) return

  if (typeof loaded.module.cancelSession === 'function') {
    await loaded.module.cancelSession()
    return
  }

  if (typeof loaded.module.disconnect === 'function') {
    await loaded.module.disconnect()
  }
}
