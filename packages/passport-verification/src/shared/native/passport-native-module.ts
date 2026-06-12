import type {
  PassportNfcProbeInput,
  PassportNfcReadInput,
  PassportNfcScanStatus,
  PassportNfcScanStatusEvent,
} from '../../passport/nfc/types'

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
  clearTemporaryData?: () => Promise<void>
  disconnect?: () => Promise<void>
}

const MODULE_NAMES = ['PassportVerificationModule', 'PassportVerification']
const EVENT_EMITTER_MODULE_NAME = 'PassportVerificationEventEmitter'
const SCAN_STATUS_EVENT_NAME = 'PassportVerificationScanStatus'

// function logNativeNfcJson(_label: string, _value: unknown): void {}

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

function normalizeScanStatusEvent(input: unknown): PassportNfcScanStatusEvent | null {
  if (!input || typeof input !== 'object') return null

  const raw = input as Record<string, unknown>
  const status = normalizeScanStatus(raw.status)
  if (!status) return null

  const platform =
    raw.platform === 'ios' || raw.platform === 'android' || raw.platform === 'unknown'
      ? raw.platform
      : undefined

  return {
    status,
    message: typeof raw.message === 'string' && raw.message.length > 0 ? raw.message : status,
    ...(platform ? { platform } : {}),
    ...(typeof raw.stage === 'string' ? { stage: raw.stage } : {}),
    ...(typeof raw.sessionId === 'string' ? { sessionId: raw.sessionId } : {}),
    ...(typeof raw.timestamp === 'number' ? { timestamp: raw.timestamp } : {}),
  }
}

function normalizeScanStatus(input: unknown): PassportNfcScanStatus | null {
  switch (input) {
    case 'waiting_for_tag':
    case 'found_tag':
    case 'authorizing_tag':
    case 'reading_tag':
      return input
    default:
      return null
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
    ...(input.activeAuthenticationChallenge
      ? { activeAuthenticationChallenge: input.activeAuthenticationChallenge }
      : {}),
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
  // logNativeNfcJson('READ_PAYLOAD', payload)
  const response = await loaded.module.readPassport(payload)
  // logNativeNfcJson('READ_RESPONSE', response)
  return response
}

export function subscribePassportNfcScanStatus(
  listener: (event: PassportNfcScanStatusEvent) => void,
): { remove: () => void } {
  try {
    const reactNative = require('react-native') as {
      DeviceEventEmitter?: {
        addListener?: (
          eventName: string,
          listener: (event: unknown) => void,
        ) => { remove: () => void }
      }
      NativeEventEmitter?: new (nativeModule?: unknown) => {
        addListener: (
          eventName: string,
          listener: (event: unknown) => void,
        ) => { remove: () => void }
      }
      NativeModules?: Record<string, unknown>
      Platform?: { OS?: string }
    }

    const wrappedListener = (event: unknown) => {
      const normalized = normalizeScanStatusEvent(event)
      if (normalized) {
        listener(normalized)
      }
    }

    if (reactNative.Platform?.OS === 'ios' && reactNative.NativeEventEmitter) {
      const emitterModule = reactNative.NativeModules?.[EVENT_EMITTER_MODULE_NAME]
      if (emitterModule) {
        return new reactNative.NativeEventEmitter(emitterModule).addListener(
          SCAN_STATUS_EVENT_NAME,
          wrappedListener,
        )
      }
    }

    if (reactNative.DeviceEventEmitter?.addListener) {
      return reactNative.DeviceEventEmitter.addListener(SCAN_STATUS_EVENT_NAME, wrappedListener)
    }
  } catch {
    // Listener support is best-effort. Reads still work through the promise API.
  }

  return { remove: () => {} }
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

export async function invokeNativeClearTemporaryData(): Promise<void> {
  const loaded = loadPassportNativeModule()
  if (!loaded.module) return

  if (typeof loaded.module.clearTemporaryData === 'function') {
    await loaded.module.clearTemporaryData()
    return
  }

  await invokeNativeCancel()
}
