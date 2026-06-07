// inidNfcReader_debug.ts — same public API, but with verbose logging
// -----------------------------------------------------------------------------
// One‑file, framework‑agnostic helper for extracting certificates
// from Iranian National ID Cards (MAV4 & Pardis) in a React‑Native
// app using **react-native-nfc-manager** — **with debug logging**.
// -----------------------------------------------------------------------------
// Public API (unchanged)
//   • initNfc()                           – call once at app boot
//   • readSigningCertificate()            – returns hex string
//   • readAuthenticationCertificate()     – returns hex string
//   • readCsnAndCrn()                     – returns { csn, crn }
// -----------------------------------------------------------------------------

import { logNidNfcDiagnostic } from '@iland/nid-verification'
import { Platform } from 'react-native'
import NfcManager, { NfcTech } from 'react-native-nfc-manager'

// ————————————————————————————————————————————————————————————————
// 0.  Logger util
// ————————————————————————————————————————————————————————————————

type DiagnosticDetails = Record<string, boolean | number | string>

function log(event: string, details?: DiagnosticDetails) {
  logNidNfcDiagnostic(event, details)
}

function classifyError(error: unknown): DiagnosticDetails {
  const candidate = error as { code?: unknown; message?: unknown; name?: unknown }
  const message = typeof candidate?.message === 'string' ? candidate.message.toLowerCase() : ''
  let errorCategory = 'NFC_ERROR'

  if (message.includes('tag') && message.includes('lost')) {
    errorCategory = 'TAG_LOST'
  } else if (message.includes('timeout')) {
    errorCategory = 'TIMEOUT'
  } else if (message.includes('cancel')) {
    errorCategory = 'CANCELLED'
  } else if (candidate?.code != null) {
    errorCategory = String(candidate.code)
  }

  return {
    errorCategory,
    errorType: typeof candidate?.name === 'string' ? candidate.name : 'Error',
  }
}

function describeCommand(apduHex: string): string {
  const instruction = apduHex.slice(2, 4).toUpperCase()
  if (instruction === 'A4') return 'select'
  if (instruction === 'B0') return 'read_binary'
  if (instruction === 'C0') return 'get_response'
  if (instruction === 'CA') return 'get_data'
  return `ins_${instruction || 'unknown'}`
}

function readBinaryDetails(apduHex: string): DiagnosticDetails {
  if (!apduHex.toUpperCase().startsWith('00B0') || apduHex.length < 10) return {}

  return {
    offset: parseInt(apduHex.slice(4, 8), 16),
    requestedLength: parseInt(apduHex.slice(8, 10), 16) || 256,
  }
}

// ————————————————————————————————————————————————————————————————
// 1.  General utilities
// ————————————————————————————————————————————————————————————————

const hexToBytes = (hex: string): number[] => hex.match(/.{1,2}/g)?.map(b => parseInt(b, 16)) ?? []

const bytesToHex = (bytes: number[]): string =>
  bytes
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()

/** Parse APDU response into status word + payload */
const parseApdu = (resp: number[]) => {
  const sw1 = resp.at(-2) ?? 0
  const sw2 = resp.at(-1) ?? 0
  const sw = `${sw1.toString(16).padStart(2, '0')}${sw2
    .toString(16)
    .padStart(2, '0')}`.toUpperCase()
  return {
    sw,
    data: resp.slice(0, -2),
    success: sw === '9000' || sw.startsWith('61') || sw.startsWith('62') || sw.startsWith('63'),
  } as const
}

// ————————————————————————————————————————————————————————————————
// 2.  APDU constants (subset of lib/apdu_commands.dart)
// ————————————————————————————————————————————————————————————————
// <unchanged — omitted here for brevity>

// Signing cert (general MAV4 flow)
const SIGN_SELECT_CM = '00A4040008A000000018434D00'
const SIGN_SELECT_AID = '00A404000CA0000000180C000001634200'
const SIGN_SELECT_MF = '00A40000023F00'
const SIGN_SELECT_DF_51 = '00A40000025100'
const SIGN_SELECT_EF_5040 = '00A4020C025040'
const SIGN_SELECT_MF_P2 = '00A4000C023F00'
const SIGN_SELECT_DF_51_P2 = '00A4000C025100'
const SIGN_SELECT_EF_5040_P2 = '00A4020C025040'

// Pardis card shortcut (try first – quicker on those cards)
const PARDIS_SELECT_APP = '00A404000F5041524449532C4D41544952414E20'
const PARDIS_SELECT_DF = '00A40000025100'
const PARDIS_SELECT_EF = '00A40200025040'

// MAV4 Authentication cert sequence (subset)
const AUTH_SELECT_IAS_APP_1 = '00A404000CA0000000180C000001634200'
const AUTH_SELECT_CM = '00A4040008A000000018434D00'
const AUTH_SELECT_MF = '00A40000023F00'
const AUTH_SELECT_DF_5000 = '00A40000025000'
const AUTH_SELECT_EF_5040 = '00A4020C025040'
const AUTH_SELECT_MF_P2 = '00A4000C023F00'
const AUTH_SELECT_DF_5000_P2 = '00A4000C025000'
const AUTH_SELECT_EF_5040_P2 = '00A4020C025040'
const AUTH_SELECT_EF_0303 = '00A4020C020303'

// CSN / CRN helpers
const CM_GET_CPLC = '80CA9F7F2D'
const CM_GET_TAG0101 = '80CA010115'

// ————————————————————————————————————————————————————————————————
// 3.  Low‑level APDU helper – must be inside an IsoDep session
// ————————————————————————————————————————————————————————————————

async function transmitAPDU(apduHex: string, profile: string) {
  const command = describeCommand(apduHex)
  const startedAt = Date.now()
  const commandDetails = {
    command,
    profile,
    ...readBinaryDetails(apduHex),
  }
  log('apdu-started', commandDetails)

  let sw: string
  let data: number[]
  try {
    const parsed = parseApdu(await NfcManager.isoDepHandler.transceive(hexToBytes(apduHex)))
    sw = parsed.sw
    data = parsed.data
  } catch (error) {
    log('apdu-failed', {
      ...commandDetails,
      durationMs: Date.now() - startedAt,
      ...classifyError(error),
    })
    throw error
  }

  // iOS: fetch the pending bytes the tag advertised with 61xx
  while (sw.startsWith('61')) {
    const le = sw.slice(2) // xx
    log('get-response-started', {
      command: 'get_response',
      profile,
      requestedLength: parseInt(le, 16) || 256,
      statusWord: sw,
    })
    try {
      const more = await NfcManager.isoDepHandler.transceive(hexToBytes(`00C00000${le}`))
      const parsed = parseApdu(more)
      data = [...data, ...parsed.data]
      sw = parsed.sw
    } catch (error) {
      log('get-response-failed', {
        command: 'get_response',
        profile,
        durationMs: Date.now() - startedAt,
        ...classifyError(error),
      })
      throw error
    }
  }

  log('apdu-completed', {
    ...commandDetails,
    durationMs: Date.now() - startedAt,
    responseLength: data.length,
    statusWord: sw,
  })
  return { sw, data, success: sw === '9000' } as const
}

// ————————————————————————————————————————————————————————————————
// 4.  Higher‑level NFC session wrapper
// ————————————————————————————————————————————————————————————————

async function withIsoDep<T>(label: string, job: () => Promise<T>): Promise<T> {
  const startedAt = Date.now()
  log('session-starting', { stage: 'nfc-manager-start' })
  try {
    await NfcManager.start()
    log('nfc-manager-started', { durationMs: Date.now() - startedAt })
  } catch (error) {
    log('nfc-manager-start-failed', {
      durationMs: Date.now() - startedAt,
      ...classifyError(error),
    })
    throw error
  }

  try {
    log('technology-request-started', { stage: 'waiting-for-isodep' })
    await NfcManager.requestTechnology(NfcTech.IsoDep, {
      alertMessage: label,
    })
    log('technology-request-granted', {
      durationMs: Date.now() - startedAt,
      stage: 'isodep-connected',
    })

    const ret = await job()

    if (Platform.OS === 'ios') {
      await NfcManager.setAlertMessageIOS('Done')
    }
    log('session-completed', { durationMs: Date.now() - startedAt })
    return ret
  } catch (error) {
    log('session-failed', {
      durationMs: Date.now() - startedAt,
      ...classifyError(error),
    })
    throw error
  } finally {
    log('session-cleanup-started')
    try {
      await NfcManager.cancelTechnologyRequest()
      log('session-cleanup-completed')
    } catch (error) {
      log('session-cleanup-failed', classifyError(error))
    }
  }
}

// ————————————————————————————————————————————————————————————————
// 5.  File‑selection helpers
// ————————————————————————————————————————————————————————————————

async function runSelection(sequence: string[], profile: string): Promise<void> {
  for (const cmd of sequence) {
    const res = await transmitAPDU(cmd, profile)
    if (!res.success && !res.sw.startsWith('61')) {
      throw new Error(`Select failed SW=${res.sw}`)
    }
    // auto GET RESPONSE when 61xx (handled inside transmitAPDU already)
  }
}

// ————————————————————————————————————————————————————————————————
// 6.  Chunked READ BINARY util
// ————————————————————————————————————————————————————————————————

const READ_BINARY = (off: number, le: number) =>
  `00B0${(off >> 8).toString(16).padStart(2, '0')}${(off & 0xff)
    .toString(16)
    .padStart(2, '0')}${le.toString(16).padStart(2, '0')}`

async function readFile(profile: string, maxLe = 0xf8) {
  let offset = 0
  let full: number[] = []
  let chunkCount = 0
  while (true) {
    const res = await transmitAPDU(READ_BINARY(offset, maxLe), profile)
    if (!res.success) break
    full = [...full, ...res.data]
    offset += res.data.length
    chunkCount += 1

    if (res.sw.startsWith('6C')) {
      const le = parseInt(res.sw.slice(2), 16)
      log('read-wrong-length-retry', {
        offset,
        profile,
        requestedLength: le || 256,
        statusWord: res.sw,
      })
      const fix = await transmitAPDU(READ_BINARY(offset, le), profile)
      full = [...full, ...fix.data]
      offset += fix.data.length
      chunkCount += 1
    }

    if (!res.sw.startsWith('61') && res.data.length < maxLe) break // EOF heuristic
  }
  log('file-read-completed', {
    certificateLength: full.length,
    chunkCount,
    profile,
  })
  return full
}

// ————————————————————————————————————————————————————————————————
// 7.  Public high‑level flows (API is identical)
// ————————————————————————————————————————————————————————————————

export async function initNfc() {
  log('initialization-started')
  try {
    await NfcManager.start()
    log('initialization-completed')
  } catch (error) {
    log('initialization-failed', classifyError(error))
    throw error
  }
}

export async function stopNfc() {
  log('shutdown-started')
  try {
    await NfcManager.close()
    log('shutdown-completed')
  } catch (error) {
    log('shutdown-failed', classifyError(error))
    throw error
  }
}

export async function clearInidNfcTemporaryData(): Promise<void> {
  await NfcManager.cancelTechnologyRequest().catch(() => undefined)
  await stopNfc().catch(() => undefined)
}

export async function readSigningAndAuthCertificates(onScanStarted?: () => void): Promise<{
  signingCert: string | null
  authCert: string | null
}> {
  return withIsoDep('Reading Signing & Auth Certificates', async () => {
    onScanStarted?.()

    log('signing-certificate-started', { profile: 'auto' })
    const signingCert = await readSigningCertificate()

    log('authentication-certificate-started', { profile: 'mav4-authentication' })
    const authCert = await readAuthenticationCertificate()

    log('certificate-read-completed', {
      hasAuthenticationCertificate: Boolean(authCert),
      hasSigningCertificate: Boolean(signingCert),
    })
    return { signingCert, authCert }
  })
}

export async function readSigningCertDgAndSod(onScanStarted?: () => void): Promise<{
  signingCert: string | null
  authCert: string | null
  dg1Bytes?: Uint8Array
  dg15Bytes?: Uint8Array
  sodBytes?: Uint8Array
}> {
  const { signingCert, authCert } = await readSigningAndAuthCertificates(onScanStarted)

  return {
    signingCert,
    authCert,
  }
}

/** Read Signing cert (handles Pardis & MAV4 automatically) */
export async function readSigningCertificate(): Promise<string | null> {
  let profile = 'pardis-signing'

  // ➊ Try Pardis shortcut first
  try {
    log('profile-started', { profile })
    await runSelection([PARDIS_SELECT_APP, PARDIS_SELECT_DF, PARDIS_SELECT_EF], profile)
    log('profile-selected', { profile })
  } catch (error) {
    log('profile-failed', { profile, ...classifyError(error) })
    // ➋ Fallback to generic MAV4 flow
    profile = 'mav4-signing'
    log('profile-fallback-started', { profile })
    await runSelection(
      [
        SIGN_SELECT_CM,
        SIGN_SELECT_AID,
        SIGN_SELECT_MF,
        SIGN_SELECT_DF_51,
        SIGN_SELECT_EF_5040,
        SIGN_SELECT_MF_P2,
        SIGN_SELECT_DF_51_P2,
        SIGN_SELECT_EF_5040_P2,
      ],
      profile,
    )
    log('profile-selected', { profile })
  }

  const bytes = await readFile(profile, 0xff)
  return bytes.length ? bytesToHex(bytes) : null
}

/** Read MAV4 Authentication certificate */
export async function readAuthenticationCertificate(): Promise<string | null> {
  const profile = 'mav4-authentication'
  log('profile-started', { profile })
  await runSelection(
    [
      AUTH_SELECT_IAS_APP_1, // 00A404000CA000...634200
      AUTH_SELECT_CM, // 00A4040008A000...434D00
      CM_GET_CPLC, // 80CA9F7F2D        (optional)
      AUTH_SELECT_IAS_APP_1, // 🔸 select IAS again
      AUTH_SELECT_MF, // 00A40000023F00    (now OK)
      AUTH_SELECT_DF_5000, // 00A40000025000
      AUTH_SELECT_EF_5040, // 00A4020C025040
      AUTH_SELECT_MF_P2, // 00A4000C023F00
      AUTH_SELECT_DF_5000_P2, // 00A4000C025000
      AUTH_SELECT_EF_5040_P2, // 00A4020C025040
      AUTH_SELECT_EF_0303, // 00A4020C020303
    ],
    profile,
  )
  log('profile-selected', { profile })

  const bytes = await readFile(profile, 0xff)
  return bytes.length ? bytesToHex(bytes) : null
}

/** Read CSN (Card Serial Number) & CRN using CPLC / Tag0101 */
export async function readCsnAndCrn(): Promise<{ csn?: string; crn?: string }> {
  return withIsoDep('Reading CSN / CRN', async () => {
    const profile = 'card-identifiers'
    await transmitAPDU(SIGN_SELECT_CM, profile) // Select Card Manager first

    const cplc = await transmitAPDU(CM_GET_CPLC, profile)
    const tag = await transmitAPDU(CM_GET_TAG0101, profile)

    const csn = cplc.data.length >= 0x13 ? bytesToHex(cplc.data.slice(8, 8 + 0x13)) : undefined
    const crn = tag.data.length >= 0x03 ? bytesToHex(tag.data.slice(0x10, 0x10 + 0x03)) : undefined

    log('card-identifiers-read', {
      responseLength: cplc.data.length + tag.data.length,
    })
    return { csn, crn }
  })
}
