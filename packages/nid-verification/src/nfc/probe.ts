export type NidNfcProbeAttempt = {
  profile: string
  command: string
  outcome: 'ok' | 'warning' | 'rejected' | 'transport_error'
  durationMs: number
  optional: boolean
  responseLength?: number
  statusWord?: string
  looksLikeDer?: boolean
  errorCategory?: string
  errorType?: string
}

export type NidNfcProbeStandardAttempt = {
  standard:
    | 'nfc-forum-tags'
    | 'iso-dep-iso7816'
    | 'iso14443-a'
    | 'iso14443-b'
    | 'iso14443-a-b'
    | 'iso15693'
    | 'iso18092-felica'
    | string
  outcome: 'timed_out' | 'detected' | 'capability_mismatch' | 'connect_failed' | 'session_error'
  durationMs: number
  nativePolling?: string
  aliases?: string[]
  detectedTechnologies?: string[]
  errorCategory?: string
  errorType?: string
}

export type NidNfcProbeResult = {
  status: 'probe_success' | 'probe_partial' | 'probe_failed'
  platform: 'android' | 'ios'
  sessionId: string
  durationMs: number
  selectedProfile?: string
  detectedStandard?: string
  tag: {
    technologies: string[]
    isoDepSupported: boolean
    ndefSupported?: boolean
    ndefStatus?: 'not_supported' | 'read_only' | 'read_write' | 'unknown'
    ndefType?: string
    ndefCapacity?: number
    maxTransceiveLength?: number
    timeoutMs?: number
    historicalBytesLength?: number
    applicationDataLength?: number
    initialSelectedAidLength?: number
  }
  attempts: NidNfcProbeAttempt[]
  standardAttempts: NidNfcProbeStandardAttempt[]
  error?: {
    category: string
    type?: string
    message: string
  }
}

type NativeNidVerificationModule = {
  getNidVerificationNativeStatus?: () => Promise<unknown>
  probeNidChip?: (input: { enabled: boolean }) => Promise<unknown>
  cancelNidProbe?: () => Promise<void>
  logNidNfcEvent?: (input: {
    event: string
    details?: Record<string, boolean | number | string>
  }) => void
}

const MODULE_NAMES = ['NidVerification', 'NidVerificationModule']

function loadNativeModule(): NativeNidVerificationModule | null {
  try {
    const reactNative = require('react-native') as {
      NativeModules?: Record<string, unknown>
    }

    for (const name of MODULE_NAMES) {
      const candidate = reactNative.NativeModules?.[name] as NativeNidVerificationModule | undefined
      if (candidate) return candidate
    }
  } catch {
    // Native diagnostics are optional and unavailable in non-native test environments.
  }

  return null
}

export function resolveNidNfcProbeEnabled(isDev: boolean, flag: string | undefined): boolean {
  return isDev && flag === 'enabled'
}

export function isNidNfcProbeEnabled(): boolean {
  return resolveNidNfcProbeEnabled(
    typeof __DEV__ !== 'undefined' && __DEV__,
    process.env.EXPO_PUBLIC_NID_NFC_PROBE,
  )
}

export async function probeNidChip(): Promise<NidNfcProbeResult> {
  if (!isNidNfcProbeEnabled()) {
    throw new Error('NID_NFC_PROBE_DISABLED')
  }

  const nativeModule = loadNativeModule()
  if (!nativeModule || typeof nativeModule.probeNidChip !== 'function') {
    throw new Error('NID_NATIVE_MODULE_NOT_LINKED')
  }

  return (await nativeModule.probeNidChip({ enabled: true })) as NidNfcProbeResult
}

export async function cancelNidNfcProbe(): Promise<void> {
  const nativeModule = loadNativeModule()
  if (nativeModule && typeof nativeModule.cancelNidProbe === 'function') {
    await nativeModule.cancelNidProbe()
  }
}

export function logNidNfcDiagnostic(
  event: string,
  details?: Record<string, boolean | number | string>,
): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return

  const nativeModule = loadNativeModule()
  if (nativeModule && typeof nativeModule.logNidNfcEvent === 'function') {
    nativeModule.logNidNfcEvent({ event, details })
  }
}
