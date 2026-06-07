import type {
  NidNfcProbeResult,
  NidNfcReadResult,
  NidVerificationResult,
} from '@iland/nid-verification'
import type { PassportNfcProbeResult, PassportNfcReadResult } from '@iland/passport-verification'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import { Platform } from 'react-native'

const STORAGE_KEY = 'development-nfc-compatibility-evidence-v1'
const SCHEMA_VERSION = 1 as const
const MAX_RECORDS = 250

export type NfcEvidenceFlow = 'passport' | 'nid'
export type NfcEvidenceSource = 'probe' | 'read'
export type NfcEvidenceOutcome = 'success' | 'partial' | 'failed'
export type NfcEvidenceValidation = 'passed' | 'failed' | 'not_run'

export type NfcEvidenceRecord = {
  schemaVersion: typeof SCHEMA_VERSION
  id: string
  recordedAt: string
  testLabel: string
  documentFlow: NfcEvidenceFlow
  source: NfcEvidenceSource
  platform: 'android' | 'ios' | 'unknown'
  deviceModel: string
  osVersion: string
  appVersion: string
  outcome: NfcEvidenceOutcome
  validation: NfcEvidenceValidation
  fullReadSucceeded: boolean
  probeTechnology?: string
  runtimeCapabilities: string[]
  readerStrategy?: string
  authentication?: string
  statusWords: string[]
  fileStatuses?: Record<string, 'ok' | 'missing' | 'error'>
  durationMs?: number
  errorCode?: string
}

export type NfcCompatibilityMatrixRow = {
  documentFlow: NfcEvidenceFlow
  source: NfcEvidenceSource
  testLabel: string
  platform: NfcEvidenceRecord['platform']
  probeTechnology: string
  readerStrategy: string
  runtimeCapabilities: string[]
  authentication: string
  attemptCount: number
  successCount: number
  validatedCount: number
  successRate: number
  medianDurationMs?: number
  lastRecordedAt: string
  lastErrorCode?: string
}

type EvidenceEnvironment = Pick<
  NfcEvidenceRecord,
  'appVersion' | 'deviceModel' | 'osVersion' | 'platform'
>

type UnknownRecord = Record<string, unknown>

let writeQueue: Promise<unknown> = Promise.resolve()

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {}
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort()
}

function safeStatusWord(value: unknown): string | undefined {
  const normalized = asString(value)?.toUpperCase()
  return normalized && /^[0-9A-F]{4}$/.test(normalized) ? normalized : undefined
}

function safeErrorCode(value: unknown): string | undefined {
  const normalized = asString(value)?.toUpperCase()
  return normalized && /^[A-Z0-9_]{2,64}$/.test(normalized) ? normalized : undefined
}

export function normalizeNfcEvidenceLabel(value: string | undefined): string {
  const normalized = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)

  // Avoid accidentally storing document numbers or national IDs as labels.
  if (!normalized || /\d{5,}/.test(normalized)) {
    return 'unlabeled-sample'
  }
  return normalized
}

export function isNfcEvidenceCollectionEnabled(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__
}

function getEnvironment(): EvidenceEnvironment {
  const constants = Platform.constants as
    | {
        Model?: unknown
        model?: unknown
      }
    | undefined
  const model = asString(constants?.Model) ?? asString(constants?.model) ?? 'unknown'
  const platform =
    Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : ('unknown' as const)

  return {
    platform,
    deviceModel: model,
    osVersion: String(Platform.Version ?? 'unknown'),
    appVersion: Constants.expoConfig?.version ?? 'unknown',
  }
}

function createBaseRecord(
  flow: NfcEvidenceFlow,
  source: NfcEvidenceSource,
  testLabel: string | undefined,
): Omit<
  NfcEvidenceRecord,
  | 'authentication'
  | 'durationMs'
  | 'errorCode'
  | 'fileStatuses'
  | 'fullReadSucceeded'
  | 'outcome'
  | 'probeTechnology'
  | 'readerStrategy'
  | 'runtimeCapabilities'
  | 'statusWords'
  | 'validation'
> {
  const recordedAt = new Date().toISOString()
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    recordedAt,
    testLabel: normalizeNfcEvidenceLabel(testLabel),
    documentFlow: flow,
    source,
    ...getEnvironment(),
  }
}

function mapProbeOutcome(value: unknown): NfcEvidenceOutcome {
  const normalized = asString(value)?.toLowerCase() ?? ''
  if (normalized.includes('success')) return 'success'
  if (normalized.includes('partial')) return 'partial'
  return 'failed'
}

function collectStatusWords(values: unknown[]): string[] {
  return unique(values.map(safeStatusWord))
}

export function createNidProbeEvidence(
  result: NidNfcProbeResult,
  testLabel?: string,
): NfcEvidenceRecord {
  const statusWords = collectStatusWords(result.attempts.map(attempt => attempt.statusWord))
  const capabilities = unique([
    ...result.tag.technologies,
    result.tag.isoDepSupported ? 'IsoDep' : undefined,
    result.tag.ndefSupported ? 'NDEF' : undefined,
    result.tag.ndefStatus ? `NDEF:${result.tag.ndefStatus}` : undefined,
  ])

  return {
    ...createBaseRecord('nid', 'probe', testLabel),
    platform: result.platform,
    outcome: mapProbeOutcome(result.status),
    validation: 'not_run',
    fullReadSucceeded: false,
    probeTechnology: result.detectedStandard,
    runtimeCapabilities: capabilities,
    readerStrategy: result.selectedProfile,
    authentication: result.selectedProfile?.includes('authentication')
      ? 'nid-certificate-authentication'
      : 'none',
    statusWords,
    durationMs: result.durationMs,
    errorCode: safeErrorCode(result.error?.category),
  }
}

export function createNidReadEvidence(
  nfc: NidNfcReadResult,
  verification: NidVerificationResult | undefined,
  testLabel?: string,
): NfcEvidenceRecord {
  const validation: NfcEvidenceValidation = verification
    ? verification.verified
      ? 'passed'
      : 'failed'
    : 'not_run'
  const readSucceeded = nfc.status === 'success'
  const fullReadSucceeded = readSucceeded && validation === 'passed'
  const debug = asRecord(nfc.debug)

  return {
    ...createBaseRecord('nid', 'read', testLabel),
    outcome: fullReadSucceeded ? 'success' : readSucceeded ? 'partial' : 'failed',
    validation,
    fullReadSucceeded,
    probeTechnology: 'iso-dep-iso7816',
    runtimeCapabilities: unique([
      'IsoDep',
      nfc.signingCertHex ? 'signing-certificate' : undefined,
      nfc.authCertHex ? 'authentication-certificate' : undefined,
    ]),
    readerStrategy: asString(debug.backend) ?? 'nid-certificate-auto',
    authentication: nfc.authCertHex ? 'nid-certificate-authentication' : 'none',
    statusWords: [],
    durationMs: asNumber(debug.durationMs),
    errorCode: readSucceeded ? undefined : 'READ_FAILED',
  }
}

export function createPassportProbeEvidence(
  result: PassportNfcProbeResult,
  testLabel?: string,
): NfcEvidenceRecord {
  const details = asRecord(result.details)
  const chip = asRecord(details.chip)
  const access = asRecord(details.access)
  const timing = asRecord(details.timing)
  const files = asRecord(details.files)
  const cardAccess = asRecord(files.cardAccess)
  const com = asRecord(files.com)
  const rawErrors = Array.isArray(details.rawErrors) ? details.rawErrors : []
  const lastError = asRecord(rawErrors.at(-1))
  const bacResult = asString(access.bacResult)
  const paceResult = asString(access.paceResult)
  const strategy =
    paceResult === 'success'
      ? 'icao-emrtd-pace'
      : bacResult === 'success'
        ? 'icao-emrtd-bac'
        : 'icao-emrtd-probe'

  return {
    ...createBaseRecord('passport', 'probe', testLabel),
    outcome: mapProbeOutcome(details.finalStatus),
    validation: 'not_run',
    fullReadSucceeded: false,
    probeTechnology: asString(chip.technologyDescription) ?? 'iso14443',
    runtimeCapabilities: unique([
      chip.supportsIso14443 === true ? 'ISO14443' : undefined,
      chip.supportsIso7816 === true ? 'ISO7816' : undefined,
      asString(chip.tagType),
    ]),
    readerStrategy: strategy,
    authentication: paceResult === 'success' ? 'PACE' : bacResult === 'success' ? 'BAC' : 'none',
    statusWords: [],
    fileStatuses: {
      CardAccess:
        cardAccess.status === 'ok' || cardAccess.status === 'missing' ? cardAccess.status : 'error',
      COM: com.status === 'ok' || com.status === 'missing' ? com.status : 'error',
    },
    durationMs: asNumber(timing.totalMs),
    errorCode: safeErrorCode(lastError.errorCode) ?? safeErrorCode(lastError.code),
  }
}

export function createPassportReadEvidence(
  result: PassportNfcReadResult,
  testLabel?: string,
): NfcEvidenceRecord {
  const raw = asRecord(result.raw)
  const timing = asRecord(raw.timing)
  const fileStatuses = Object.fromEntries(
    Object.entries(result.files).map(([name, file]) => [name, file.status]),
  )
  const requiredFilesSucceeded = ['DG1', 'SOD'].every(name => result.files[name]?.status === 'ok')
  const fullReadSucceeded = result.finalStatus === 'success' && requiredFilesSucceeded
  const method = result.accessControl?.method

  return {
    ...createBaseRecord('passport', 'read', testLabel),
    outcome:
      result.finalStatus === 'success'
        ? 'success'
        : result.finalStatus === 'partial_success'
          ? 'partial'
          : 'failed',
    validation: requiredFilesSucceeded ? 'passed' : 'failed',
    fullReadSucceeded,
    probeTechnology: 'iso14443-iso7816',
    runtimeCapabilities: unique([
      'ISO14443',
      'ISO7816',
      ...Object.entries(result.files)
        .filter(([, file]) => file.status === 'ok')
        .map(([name]) => `file:${name}`),
    ]),
    readerStrategy:
      method === 'PACE'
        ? 'icao-emrtd-pace'
        : method === 'BAC'
          ? 'icao-emrtd-bac'
          : 'icao-emrtd-auto',
    authentication: method ?? 'UNKNOWN',
    statusWords: [],
    fileStatuses,
    durationMs: asNumber(timing.totalReadMs) ?? asNumber(timing.totalMs),
    errorCode: fullReadSucceeded ? undefined : 'READ_FAILED',
  }
}

export function createNfcFailureEvidence(input: {
  documentFlow: NfcEvidenceFlow
  source: NfcEvidenceSource
  testLabel?: string
  error: unknown
  probeTechnology?: string
  readerStrategy?: string
}): NfcEvidenceRecord {
  const error = asRecord(input.error)
  return {
    ...createBaseRecord(input.documentFlow, input.source, input.testLabel),
    outcome: 'failed',
    validation: 'not_run',
    fullReadSucceeded: false,
    probeTechnology: input.probeTechnology,
    runtimeCapabilities: [],
    readerStrategy: input.readerStrategy,
    authentication: 'none',
    statusWords: [],
    errorCode: safeErrorCode(error.code) ?? 'UNKNOWN_NFC_ERROR',
  }
}

function isEvidenceRecord(value: unknown): value is NfcEvidenceRecord {
  if (!isRecord(value)) return false
  return (
    value.schemaVersion === SCHEMA_VERSION &&
    (value.documentFlow === 'passport' || value.documentFlow === 'nid') &&
    (value.source === 'probe' || value.source === 'read') &&
    typeof value.recordedAt === 'string' &&
    typeof value.testLabel === 'string' &&
    Array.isArray(value.runtimeCapabilities) &&
    Array.isArray(value.statusWords)
  )
}

export async function loadNfcEvidence(): Promise<NfcEvidenceRecord[]> {
  if (!isNfcEvidenceCollectionEnabled()) return []

  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored) as unknown
    return Array.isArray(parsed) ? parsed.filter(isEvidenceRecord) : []
  } catch {
    return []
  }
}

export async function appendNfcEvidence(record: NfcEvidenceRecord): Promise<void> {
  if (!isNfcEvidenceCollectionEnabled()) return

  const operation = writeQueue.then(async () => {
    const records = await loadNfcEvidence()
    const next = [...records, record].slice(-MAX_RECORDS)
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  })
  const safeOperation = operation.catch(() => {
    console.warn('[NFC-EVIDENCE] Failed to persist compatibility evidence.')
  })
  writeQueue = safeOperation
  await safeOperation
}

export async function clearNfcEvidence(): Promise<void> {
  if (!isNfcEvidenceCollectionEnabled()) return

  const operation = writeQueue.then(() => AsyncStorage.removeItem(STORAGE_KEY))
  const safeOperation = operation.catch(() => {
    console.warn('[NFC-EVIDENCE] Failed to clear compatibility evidence.')
  })
  writeQueue = safeOperation
  await safeOperation
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

export function buildNfcCompatibilityMatrix(
  records: NfcEvidenceRecord[],
): NfcCompatibilityMatrixRow[] {
  const groups = new Map<string, NfcEvidenceRecord[]>()

  for (const record of records) {
    const key = [
      record.documentFlow,
      record.source,
      record.testLabel,
      record.platform,
      record.probeTechnology ?? 'unknown',
      record.readerStrategy ?? 'unknown',
      record.authentication ?? 'unknown',
    ].join('|')
    groups.set(key, [...(groups.get(key) ?? []), record])
  }

  return [...groups.values()]
    .map(group => {
      const latest = [...group].sort((left, right) =>
        right.recordedAt.localeCompare(left.recordedAt),
      )[0]
      const successCount = group.filter(record => record.fullReadSucceeded).length
      const probeSuccessCount = group.filter(
        record => record.source === 'probe' && record.outcome === 'success',
      ).length
      const effectiveSuccessCount = latest.source === 'read' ? successCount : probeSuccessCount
      const durations = group
        .map(record => record.durationMs)
        .filter((value): value is number => typeof value === 'number')

      return {
        documentFlow: latest.documentFlow,
        source: latest.source,
        testLabel: latest.testLabel,
        platform: latest.platform,
        probeTechnology: latest.probeTechnology ?? 'unknown',
        readerStrategy: latest.readerStrategy ?? 'unknown',
        runtimeCapabilities: unique(group.flatMap(record => record.runtimeCapabilities)),
        authentication: latest.authentication ?? 'unknown',
        attemptCount: group.length,
        successCount: effectiveSuccessCount,
        validatedCount: group.filter(record => record.validation === 'passed').length,
        successRate: Number((effectiveSuccessCount / group.length).toFixed(3)),
        medianDurationMs: median(durations),
        lastRecordedAt: latest.recordedAt,
        lastErrorCode: latest.errorCode,
      }
    })
    .sort((left, right) => {
      const flowOrder = left.documentFlow.localeCompare(right.documentFlow)
      if (flowOrder !== 0) return flowOrder
      return left.testLabel.localeCompare(right.testLabel)
    })
}

export async function createNfcEvidenceExport(): Promise<{
  generatedAt: string
  recordCount: number
  records: NfcEvidenceRecord[]
  matrix: NfcCompatibilityMatrixRow[]
}> {
  const records = await loadNfcEvidence()
  return {
    generatedAt: new Date().toISOString(),
    recordCount: records.length,
    records,
    matrix: buildNfcCompatibilityMatrix(records),
  }
}

export async function getNfcEvidenceSummary(
  flow: NfcEvidenceFlow,
  testLabel: string | undefined,
): Promise<string> {
  const label = normalizeNfcEvidenceLabel(testLabel)
  const rows = buildNfcCompatibilityMatrix(await loadNfcEvidence()).filter(
    row => row.documentFlow === flow && row.testLabel === label,
  )
  if (rows.length === 0) return 'No evidence recorded for this sample.'

  const attempts = rows.reduce((total, row) => total + row.attemptCount, 0)
  const successful = rows.reduce((total, row) => total + row.successCount, 0)
  const validated = rows.reduce((total, row) => total + row.validatedCount, 0)
  return `${attempts} attempts, ${successful} successful paths, ${validated} validated reads`
}

export async function logNfcEvidenceExport(): Promise<void> {
  if (!isNfcEvidenceCollectionEnabled()) return
  const evidence = await createNfcEvidenceExport()
  console.warn('[NFC-EVIDENCE][EXPORT]\n', JSON.stringify(evidence, null, 2))
}
