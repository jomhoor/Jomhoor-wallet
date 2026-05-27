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

import { Platform } from 'react-native'
import NfcManager, { NfcTech } from 'react-native-nfc-manager'

// ————————————————————————————————————————————————————————————————
// 0.  Logger util
// ————————————————————————————————————————————————————————————————

function log(...msg: unknown[]) {
  void msg
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

async function transmitAPDU(apduHex: string) {
  log('> APDU', apduHex)
  let { sw, data } = parseApdu(await NfcManager.isoDepHandler.transceive(hexToBytes(apduHex)))

  // iOS: fetch the pending bytes the tag advertised with 61xx
  while (sw.startsWith('61')) {
    log('  ↪︎ 61xx, GET RESPONSE le=', sw.slice(2))
    const le = sw.slice(2) // xx
    const more = await NfcManager.isoDepHandler.transceive(hexToBytes(`00C00000${le}`))
    const parsed = parseApdu(more)
    data = [...data, ...parsed.data]
    sw = parsed.sw
  }

  log('< APDU SW=', sw, '| len=', data.length)
  return { sw, data, success: sw === '9000' } as const
}

// ————————————————————————————————————————————————————————————————
// 4.  Higher‑level NFC session wrapper
// ————————————————————————————————————————————————————————————————

async function withIsoDep<T>(label: string, job: () => Promise<T>): Promise<T> {
  await NfcManager.start()
  log('NFC started')

  try {
    log('Request IsoDep tech -', label)
    await NfcManager.requestTechnology(NfcTech.IsoDep, {
      alertMessage: label,
    })
    log('IsoDep tech granted')

    const ret = await job()

    if (Platform.OS === 'ios') {
      await NfcManager.setAlertMessageIOS('Done')
    }
    return ret
  } finally {
    log('Cancel IsoDep session')
    await NfcManager.cancelTechnologyRequest()
  }
}

// ————————————————————————————————————————————————————————————————
// 5.  File‑selection helpers
// ————————————————————————————————————————————————————————————————

async function runSelection(sequence: string[]): Promise<void> {
  for (const cmd of sequence) {
    const res = await transmitAPDU(cmd)
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

async function readFile(maxLe = 0xf8) {
  let offset = 0
  let full: number[] = []
  while (true) {
    const res = await transmitAPDU(READ_BINARY(offset, maxLe))
    if (!res.success) break
    full = [...full, ...res.data]
    offset += res.data.length

    if (res.sw.startsWith('6C')) {
      const le = parseInt(res.sw.slice(2), 16)
      log('  ↪︎ 6Cxx, re‑READ with le', le)
      const fix = await transmitAPDU(READ_BINARY(offset, le))
      full = [...full, ...fix.data]
      offset += fix.data.length
    }

    if (!res.sw.startsWith('61') && res.data.length < maxLe) break // EOF heuristic
  }
  log('Total bytes read', full.length)
  return full
}

// ————————————————————————————————————————————————————————————————
// 7.  Public high‑level flows (API is identical)
// ————————————————————————————————————————————————————————————————

export async function initNfc() {
  await NfcManager.start()
  log('initNfc -> started')
}

export async function stopNfc() {
  await NfcManager.close()
  log('initNfc -> closed')
}

export async function readSigningAndAuthCertificates(onScanStarted?: () => void): Promise<{
  signingCert: string | null
  authCert: string | null
}> {
  return withIsoDep('Reading Signing & Auth Certificates', async () => {
    onScanStarted?.()

    log('Reading Signing Certificate...')
    const signingCert = await readSigningCertificate()

    log('Reading Authentication Certificate...')
    const authCert = await readAuthenticationCertificate()

    return { signingCert, authCert }
  })
}

/** Read Signing cert (handles Pardis & MAV4 automatically) */
export async function readSigningCertificate(): Promise<string | null> {
  // ➊ Try Pardis shortcut first
  try {
    await runSelection([PARDIS_SELECT_APP, PARDIS_SELECT_DF, PARDIS_SELECT_EF])
    log('Pardis path succeeded')
  } catch (err) {
    log('Pardis path failed, fallback to MAV4', err?.message)
    // ➋ Fallback to generic MAV4 flow
    await runSelection([
      SIGN_SELECT_CM,
      SIGN_SELECT_AID,
      SIGN_SELECT_MF,
      SIGN_SELECT_DF_51,
      SIGN_SELECT_EF_5040,
      SIGN_SELECT_MF_P2,
      SIGN_SELECT_DF_51_P2,
      SIGN_SELECT_EF_5040_P2,
    ])
  }

  const bytes = await readFile(0xff)
  return bytes.length ? bytesToHex(bytes) : null
}

/** Read MAV4 Authentication certificate */
export async function readAuthenticationCertificate(): Promise<string | null> {
  await runSelection([
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
  ])

  const bytes = await readFile(0xff)
  return bytes.length ? bytesToHex(bytes) : null
}

/** Read CSN (Card Serial Number) & CRN using CPLC / Tag0101 */
export async function readCsnAndCrn(): Promise<{ csn?: string; crn?: string }> {
  return withIsoDep('Reading CSN / CRN', async () => {
    await transmitAPDU(SIGN_SELECT_CM) // Select Card Manager first

    const cplc = await transmitAPDU(CM_GET_CPLC)
    const tag = await transmitAPDU(CM_GET_TAG0101)

    const csn = cplc.data.length >= 0x13 ? bytesToHex(cplc.data.slice(8, 8 + 0x13)) : undefined
    const crn = tag.data.length >= 0x03 ? bytesToHex(tag.data.slice(0x10, 0x10 + 0x03)) : undefined

    log('CSN', csn, 'CRN', crn)
    return { csn, crn }
  })
}
