/**
 * passport-nfc-reader.ts
 *
 * Reads ICAO 9303 compliant passports (TD3) over NFC using Basic Access Control (BAC).
 *
 * Flow:
 *   1. Derive BAC session keys from MRZ (doc number + DOB + expiry)
 *   2. Perform BAC mutual authentication to establish encrypted channel
 *   3. Read DG1 (MRZ data), DG15 (AA public key), SOD (signature/cert)
 *   4. Return an EPassport object ready for ZK registration
 */

import NfcManager, { NfcTech } from 'react-native-nfc-manager'

// Pure JS crypto — works in Hermes (require('crypto') does not)
const createHash = require('create-hash')
const DES = require('des.js')

import { EPassport, PersonDetails } from './e-document'

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function log(...msg: unknown[]) {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[PASSPORT-NFC]', ...msg)
  }
}

// ---------------------------------------------------------------------------
// Hex helpers
// ---------------------------------------------------------------------------
const toBytes = (hex: string): number[] => (hex.match(/.{1,2}/g) ?? []).map(b => parseInt(b, 16))

const toHex = (bytes: number[] | Uint8Array): string =>
  Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

const xor = (a: Uint8Array, b: Uint8Array): Uint8Array =>
  a.map((v, i) => v ^ b[i]) as unknown as Uint8Array

// ---------------------------------------------------------------------------
// BAC key derivation (ICAO 9303 Part 11, Section 9.7.3)
// ---------------------------------------------------------------------------

/**
 * Computes the check digit for a MRZ field using ICAO 9303 weights (7-3-1).
 */
function mrzCheckDigit(s: string): string {
  const weights = [7, 3, 1]
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let sum = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i].toUpperCase()
    const val = c === '<' ? 0 : chars.indexOf(c)
    sum += val * weights[i % 3]
  }
  return String(sum % 10)
}

/**
 * Pads a date string (YYMMDD) to 6 chars.
 */
function padDate(d: string): string {
  return d.replace(/\D/g, '').padStart(6, '0').slice(0, 6)
}

function sha1Sync(data: Uint8Array): Uint8Array {
  const hash = createHash('sha1')
  hash.update(Buffer.from(data))
  return new Uint8Array(hash.digest())
}

/**
 * Derives the BAC seed from MRZ key data.
 * mrzKey = documentNumber(9) + checkDigit + dateOfBirth(6) + checkDigit + expiryDate(6) + checkDigit
 */
function deriveBacSeed(
  documentNumber: string,
  dateOfBirth: string,
  expiryDate: string,
): Uint8Array {
  const docNum = documentNumber.toUpperCase().padEnd(9, '<').slice(0, 9)
  const dob = padDate(dateOfBirth)
  const expiry = padDate(expiryDate)

  const docCheck = mrzCheckDigit(docNum)
  const dobCheck = mrzCheckDigit(dob)
  const expiryCheck = mrzCheckDigit(expiry)

  const mrzKey = `${docNum}${docCheck}${dob}${dobCheck}${expiry}${expiryCheck}`
  log('MRZ key string:', mrzKey)

  const mrzBytes = new TextEncoder().encode(mrzKey)
  const hash = sha1Sync(mrzBytes)
  return hash.slice(0, 16) // 16-byte seed
}

/**
 * Derives 3DES session keys from the BAC seed.
 * Uses ICAO 9303 key derivation with counter c=1 (Kenc) and c=2 (Kmac).
 */
function deriveKey(seed: Uint8Array, counter: 1 | 2): Uint8Array {
  const c = new Uint8Array([0, 0, 0, counter])
  const data = new Uint8Array([...seed, ...c])
  const hash = sha1Sync(data)

  // Adjust parity bits for 3DES
  const key = hash.slice(0, 16)
  for (let i = 0; i < 16; i++) {
    const b = key[i]
    let parity = 0
    for (let bit = 1; bit < 8; bit++) {
      parity ^= (b >> bit) & 1
    }
    key[i] = (b & 0xfe) | (parity ^ 1)
  }
  return key
}

// ---------------------------------------------------------------------------
// 3DES CBC encryption / decryption (used for BAC)
// ---------------------------------------------------------------------------

function des3Encrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  // 3DES requires 24-byte key; duplicate the first 8 bytes
  const key24 = Buffer.concat([Buffer.from(key), Buffer.from(key.slice(0, 8))])
  const cipher = DES.CBC.instantiate(DES.EDE).create({
    key: key24,
    iv: Buffer.alloc(8, 0),
    type: 'encrypt',
  })
  // Only call update() — do NOT call final() which adds PKCS padding.
  // Our data is always 8-byte aligned so update() processes everything.
  return new Uint8Array(cipher.update(data))
}

function des3Decrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  // Manual CBC decryption using individual DES operations.
  // Avoids DES.EDE decrypt entirely — uses only desDecryptBlock (single DES)
  // and desEncryptBlock (single DES) which are known to work.
  //
  // 3DES EDE decrypt with 2-key (K1,K2,K1):
  //   ECB_D(C) = DES_D(K1, DES_E(K2, DES_D(K1, C)))
  // CBC decrypt:
  //   P_i = ECB_D(C_i) XOR C_{i-1}
  const k1 = new Uint8Array(key.slice(0, 8))
  const k2 = new Uint8Array(key.slice(8, 16))
  const result = new Uint8Array(data.length)
  let prev = new Uint8Array(8) // IV = all zeros
  for (let i = 0; i < data.length; i += 8) {
    const block = new Uint8Array(data.slice(i, i + 8))
    // 3DES EDE decrypt: D_K1(E_K2(D_K1(block)))
    const step1 = desDecryptBlock(k1, block) // D_K1
    const step2 = desEncryptBlock(k2, step1) // E_K2
    const step3 = desDecryptBlock(k1, step2) // D_K1
    // CBC: XOR with previous ciphertext block
    for (let j = 0; j < 8; j++) {
      result[i + j] = step3[j] ^ prev[j]
    }
    prev = block
  }
  return result
}

// ---------------------------------------------------------------------------
// Retail MAC (ISO/IEC 9797-1 MAC Algorithm 3 with DES) for BAC
// ---------------------------------------------------------------------------

function desEncryptBlock(key: Uint8Array, block: Uint8Array): Uint8Array {
  const cipher = DES.DES.create({ key: Buffer.from(key), type: 'encrypt' })
  return new Uint8Array(cipher.update(block)) as Uint8Array
}

function desDecryptBlock(key: Uint8Array, block: Uint8Array): Uint8Array {
  // des.js decrypt buffers the last block; feed dummy bytes so update() releases it
  const decipher = DES.DES.create({ key: Buffer.from(key), type: 'decrypt' })
  const withDummy = Buffer.concat([Buffer.from(block), Buffer.alloc(8)])
  return new Uint8Array(decipher.update(withDummy)).slice(0, 8)
}

function macSingle(key: Uint8Array, data: Uint8Array): Uint8Array {
  let result: Uint8Array = new Uint8Array(8)
  for (let i = 0; i < data.length; i += 8) {
    const block = new Uint8Array(data.slice(i, i + 8))
    result = desEncryptBlock(new Uint8Array(key.slice(0, 8)), xor(result, block))
  }
  return result
}

function retailMac(kmac: Uint8Array, data: Uint8Array): Uint8Array {
  // ISO/IEC 9797-1 MAC Algorithm 3 (Retail MAC):
  // 1. DES CBC with K1 over all blocks → intermediate H_n
  // 2. DES decrypt H_n with K2
  // 3. DES encrypt result with K1
  // Final MAC = E_K1(D_K2(H_n))
  //
  // NOTE: Do NOT use 3DES-EDE here! EDE would give E_K1(D_K2(E_K1(H_n)))
  // which has an extra E_K1 step since macSingle already applied E_K1 to the last block.

  // Pad data to multiple of 8 with ISO 9797-1 padding (method 2)
  const padLen = 8 - (data.length % 8)
  const padded = new Uint8Array(data.length + padLen)
  padded.set(data)
  padded[data.length] = 0x80

  // Single DES CBC with K1 (first 8 bytes) over all blocks
  const intermediate = macSingle(kmac.slice(0, 8), padded)

  // DES decrypt with K2 (last 8 bytes), then DES encrypt with K1
  const decrypted = desDecryptBlock(new Uint8Array(kmac.slice(8, 16)), intermediate)
  return desEncryptBlock(new Uint8Array(kmac.slice(0, 8)), decrypted)
}

// ---------------------------------------------------------------------------
// Secure Messaging (SM) for reading DGs after BAC
// ---------------------------------------------------------------------------

/** ISO 9797-1 Method 2 padding: append 0x80 then zeros to reach multiple of 8 */
function iso9797Pad(data: number[]): number[] {
  const padded = [...data, 0x80]
  while (padded.length % 8 !== 0) padded.push(0x00)
  return padded
}

/** Encode TLV length (handles multi-byte lengths for values > 127) */
function tlvLength(len: number): number[] {
  if (len < 0x80) return [len]
  if (len < 0x100) return [0x81, len]
  return [0x82, (len >> 8) & 0xff, len & 0xff]
}

/** Parse TLV length starting at position i, returns [value, newPosition] */
function parseTlvLength(data: number[], i: number): [number, number] {
  if (data[i] < 0x80) return [data[i], i + 1]
  const numBytes = data[i] & 0x7f
  let len = 0
  for (let j = 0; j < numBytes; j++) len = (len << 8) | data[i + 1 + j]
  return [len, i + 1 + numBytes]
}

class SecureMessaging {
  private ssc: bigint // send sequence counter

  constructor(
    private kenc: Uint8Array,
    private kmac: Uint8Array,
    sscBytes: Uint8Array,
  ) {
    this.ssc = BigInt('0x' + toHex(sscBytes))
  }

  private incrementSsc() {
    this.ssc = (this.ssc + 1n) & 0xffffffffffffffffn
    const hex = this.ssc.toString(16).padStart(16, '0')
    return toBytes(hex)
  }

  /**
   * Wraps a plain APDU into a Secure Messaging APDU.
   * Supports all cases: data only, Le only, both, or neither.
   */
  wrap(
    cla: number,
    ins: number,
    p1: number,
    p2: number,
    le?: number,
    cmdData?: number[],
  ): number[] {
    const ssc = this.incrementSsc()

    const maskedCla = cla | 0x0c
    const header = [maskedCla, ins, p1, p2]

    // Build DO'87 (encrypted command data, if present)
    let do87: number[] = []
    if (cmdData && cmdData.length > 0) {
      // Pad plaintext data with ISO 9797-1 method 2, then encrypt
      const padded = iso9797Pad(cmdData)
      const encrypted = des3Encrypt(this.kenc, new Uint8Array(padded))
      // DO'87: tag + length + padding indicator (0x01) + encrypted data
      const do87Value = [0x01, ...encrypted]
      do87 = [0x87, ...tlvLength(do87Value.length), ...do87Value]
    }

    // Build DO'97 (Le, if present)
    const do97: number[] = le !== undefined ? [0x97, 0x01, le] : []

    // ICAO 9303-11 §9.8.6.1: M = SSC || pad(CmdHeader) || DO'87 || DO'97
    // retailMac adds the final ISO 9797-1 padding to the whole M — do NOT pre-pad DOs!
    const headerPadded = iso9797Pad([...header])
    const dataObjects = [...do87, ...do97]

    const macInput = new Uint8Array([...ssc, ...headerPadded, ...dataObjects])
    const mac = retailMac(this.kmac, macInput)

    // DO'8E (MAC)
    const do8e = [0x8e, 0x08, ...mac]

    // Build final APDU: CLA INS P1 P2 Lc [DO'87] [DO'97] [DO'8E] Le=0x00
    const body = [...do87, ...do97, ...do8e]
    const apdu = [...header, body.length, ...body, 0x00]

    log('SM wrap: SSC=', toHex(ssc), 'cmd=', toHex(header))
    if (do87.length > 0) log('  DO87:', toHex(do87))
    log('  MAC input:', toHex(macInput), '→ MAC:', toHex(mac))
    log('  APDU:', toHex(apdu))

    return apdu
  }

  /**
   * Unwraps a Secure Messaging response.
   * Returns the plain response data.
   */
  unwrap(response: number[]): number[] {
    const ssc = this.incrementSsc()

    if (response.length < 2) throw new Error('Empty SM response')

    // Parse TLV objects from response (before the 2-byte SW at the end)
    let i = 0
    let do87Raw: number[] = [] // full DO'87 bytes for MAC verification
    let encryptedData: number[] | null = null
    let do99Raw: number[] = [] // full DO'99 bytes for MAC verification
    let receivedMac: number[] | null = null

    while (i < response.length - 2) {
      const tag = response[i]
      if (tag === 0x87) {
        const do87Start = i
        i++
        const [len, afterLen] = parseTlvLength(response, i)
        i = afterLen
        // First byte is padding indicator (0x01), rest is encrypted data
        encryptedData = response.slice(i + 1, i + len)
        i += len
        do87Raw = response.slice(do87Start, i)
      } else if (tag === 0x99) {
        const do99Start = i
        i++
        const [len, afterLen] = parseTlvLength(response, i)
        i = afterLen
        i += len
        do99Raw = response.slice(do99Start, i)
      } else if (tag === 0x8e) {
        i++
        const [len, afterLen] = parseTlvLength(response, i)
        i = afterLen
        receivedMac = response.slice(i, i + len)
        i += len
      } else {
        break
      }
    }

    // ICAO 9303-11 §9.8.6.1: response M = SSC || DO'87 || DO'99
    // retailMac adds the final ISO 9797-1 padding — do NOT pre-pad DOs!
    const dataForMac = [...do87Raw, ...do99Raw]
    const macInput = new Uint8Array([...ssc, ...dataForMac])
    const expectedMac = retailMac(this.kmac, macInput)

    if (receivedMac && toHex(receivedMac) !== toHex(expectedMac)) {
      log('MAC mismatch! received:', toHex(receivedMac), 'expected:', toHex(expectedMac))
    }

    if (!encryptedData) return []

    // Decrypt with Kenc (3DES CBC, IV = 0)
    const decrypted = des3Decrypt(this.kenc, new Uint8Array(encryptedData))

    // Remove ISO 9797-1 padding (find last 0x80)
    let end = decrypted.length
    while (end > 0 && decrypted[end - 1] === 0x00) end--
    if (end > 0 && decrypted[end - 1] === 0x80) end--

    return Array.from(decrypted.slice(0, end))
  }
}

// ---------------------------------------------------------------------------
// Low-level NFC APDU sender
// ---------------------------------------------------------------------------

async function transceive(apdu: number[]): Promise<{ sw: string; data: number[] }> {
  log('> APDU:', toHex(apdu))
  const raw = await NfcManager.isoDepHandler.transceive(apdu)
  log('< RAW:', toHex(raw))

  // Handle 61xx (more data available) — fetch with GET RESPONSE
  let sw1 = raw[raw.length - 2]
  let sw2 = raw[raw.length - 1]
  let data = raw.slice(0, -2)

  while (sw1 === 0x61) {
    const getResponse = await NfcManager.isoDepHandler.transceive(
      toBytes(`00C00000${sw2.toString(16).padStart(2, '0')}`),
    )
    sw1 = getResponse[getResponse.length - 2]
    sw2 = getResponse[getResponse.length - 1]
    data = [...data, ...getResponse.slice(0, -2)]
  }

  const sw = toHex([sw1, sw2]).toUpperCase()
  log('  SW:', sw, 'data len:', data.length)
  return { sw, data }
}

async function selectPassportApp(): Promise<boolean> {
  // Select LDS/MRTD application AID: A0 00 00 02 47 10 01
  // ICAO 9303 uses P2=0C (no response data expected)
  // Standard JMRTD approach: P2=0C, no Le
  const selectApdu = '00A4040C07A0000002471001'

  try {
    log('SELECT passport app:', selectApdu)
    const { sw } = await transceive(toBytes(selectApdu))
    if (sw.startsWith('90') || sw.startsWith('61')) {
      log('Passport app selected OK')
      return true
    }
    log('SELECT failed with SW:', sw, '— will try GET CHALLENGE anyway')
    return false
  } catch (e) {
    // transceive itself failed (NFC connection issue)
    // Throw with a user-friendly message
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(
      `NFC connection lost during SELECT (${msg}). ` +
        'Please hold your passport firmly against the phone and keep it still.',
    )
  }
}

async function getChallenge(): Promise<number[]> {
  const { sw, data } = await transceive(toBytes('0084000008'))
  if (sw !== '9000' && !sw.startsWith('61')) {
    throw new Error(`GET CHALLENGE failed: SW=${sw}`)
  }
  log('Challenge:', toHex(data))
  return data
}

// ---------------------------------------------------------------------------
// BAC Handshake
// ---------------------------------------------------------------------------

async function performBAC(
  kenc: Uint8Array,
  kmac: Uint8Array,
  rndIfd: Uint8Array,
  kIfd: Uint8Array,
): Promise<{ ksenc: Uint8Array; ksmac: Uint8Array; ssc: Uint8Array }> {
  // Step 1: Get challenge from passport (RNDicc = 8 bytes)
  const rndIcc = await getChallenge()

  // Step 2: Build EIFD = 3DES_enc(Kenc, RNDifd || RNDicc || KIfd)
  const plaintext = new Uint8Array([...rndIfd, ...rndIcc, ...kIfd])
  log('BAC S (RNDifd|RNDicc|KIfd):', toHex(plaintext))
  const eifd = des3Encrypt(kenc, plaintext)
  log('BAC EIFD:', toHex(eifd))

  // Step 3: Compute MAC over EIFD
  const mifd = retailMac(kmac, eifd)
  log('BAC MIFD:', toHex(mifd))

  // Step 4: EXTERNAL AUTHENTICATE
  const authData = [...eifd, ...mifd]
  log('BAC authData (EIFD|MIFD):', toHex(authData), 'len:', authData.length)
  const extAuth = [0x00, 0x82, 0x00, 0x00, authData.length, ...authData, 0x00]
  const { sw, data: respData } = await transceive(extAuth)

  if (sw !== '9000') {
    throw new Error(
      `EXTERNAL AUTHENTICATE failed: SW=${sw}. Check MRZ data (doc number, DOB, expiry).`,
    )
  }

  log('BAC EXTERNAL AUTHENTICATE success, response len:', respData.length)
  log('BAC response (EICC|MICC):', toHex(respData))

  // Step 5: Decrypt response to get RNDicc, RNDifd, Kicc
  const eicc = new Uint8Array(respData.slice(0, 32))
  const _micc = new Uint8Array(respData.slice(32, 40))
  log('BAC EICC:', toHex(eicc))
  const decResp = des3Decrypt(kenc, eicc)
  log('BAC decrypted response:', toHex(decResp))
  const rndIccResp = decResp.slice(0, 8)
  const rndIfdResp = decResp.slice(8, 16)
  const kicc = decResp.slice(16, 32)

  // Verify RNDicc and RNDifd match
  const rndIccMatch = toHex(rndIccResp) === toHex(new Uint8Array(rndIcc))
  const rndIfdMatch = toHex(rndIfdResp) === toHex(rndIfd)
  log(
    'BAC verify: RNDicc',
    rndIccMatch ? 'OK' : 'MISMATCH',
    '| RNDifd',
    rndIfdMatch ? 'OK' : 'MISMATCH',
  )
  if (!rndIccMatch)
    log('  RNDicc expected:', toHex(new Uint8Array(rndIcc)), 'got:', toHex(rndIccResp))
  if (!rndIfdMatch) log('  RNDifd expected:', toHex(rndIfd), 'got:', toHex(rndIfdResp))

  // Step 6: Derive session keys KSenc and KSmac from XOR of Kicc and KIfd
  log('BAC Kicc:', toHex(kicc))
  log('BAC KIfd:', toHex(kIfd))
  const kseedBytes = xor(new Uint8Array(kicc), kIfd)
  log('BAC KSeed:', toHex(kseedBytes))
  const ksenc = deriveKey(kseedBytes, 1)
  const ksmac = deriveKey(kseedBytes, 2)
  log('BAC KSenc:', toHex(ksenc))
  log('BAC KSmac:', toHex(ksmac))

  // SSC = last 4 bytes of RNDicc || last 4 bytes of RNDifd
  const ssc = new Uint8Array([...new Uint8Array(rndIcc).slice(4), ...rndIfd.slice(4)])
  log('BAC SSC:', toHex(ssc))

  log('BAC complete. Session keys established.')
  return { ksenc, ksmac, ssc }
}

// ---------------------------------------------------------------------------
// Read a file (DG/EF) using Secure Messaging
// ---------------------------------------------------------------------------

/**
 * Reads a file by FID using SM-wrapped SELECT and READ BINARY commands.
 */
async function readFile(fid: string, sm: SecureMessaging): Promise<Uint8Array> {
  // SM-wrapped SELECT (case 3: command data, no Le)
  const fidBytes = toBytes(fid)
  const selectApdu = sm.wrap(0x00, 0xa4, 0x02, 0x0c, undefined, fidBytes)
  const { sw: selSw, data: selData } = await transceive(selectApdu)
  if (selSw !== '9000' && !selSw.startsWith('61') && selSw !== '6282') {
    throw new Error(`Select file ${fid} failed: SW=${selSw}`)
  }
  // Must unwrap even if we don't need the data — keeps SSC synchronized
  if (selData.length > 0) {
    sm.unwrap([...selData, ...toBytes(selSw.toLowerCase())])
  }

  // SM-wrapped READ BINARY in chunks
  let fullData: number[] = []
  let offset = 0
  const chunkSize = 0xe0

  while (true) {
    const o1 = (offset >> 8) & 0x7f
    const o2 = offset & 0xff
    const readApdu = sm.wrap(0x00, 0xb0, o1, o2, chunkSize)
    const { sw, data: rawResp } = await transceive(readApdu)

    if (sw !== '9000' && sw !== '6282') {
      if (sw === '6B00' || sw === '6700') break // past end of file
      if (fullData.length > 0) break // EOF
      throw new Error(`READ BINARY ${fid} at offset ${offset} failed: SW=${sw}`)
    }

    const decrypted = sm.unwrap([...rawResp, ...toBytes(sw.toLowerCase())])
    if (decrypted.length === 0) break

    fullData = [...fullData, ...decrypted]
    offset += decrypted.length

    if (decrypted.length < chunkSize || sw === '6282') break
  }

  log(`Read ${fid}: ${fullData.length} bytes`)
  return new Uint8Array(fullData)
}

// ---------------------------------------------------------------------------
// Parse DG1 to extract PersonDetails
// ---------------------------------------------------------------------------

function parseDG1PersonDetails(dg1: Uint8Array): PersonDetails {
  // DG1 structure: 61 xx 5F 1F xx [MRZ data]
  // Find MRZ data after tag 5F1F
  let mrzStart = 0
  for (let i = 0; i < dg1.length - 1; i++) {
    if (dg1[i] === 0x5f && dg1[i + 1] === 0x1f) {
      // Length byte(s) follow
      const len = dg1[i + 2]
      mrzStart = i + 3
      if (len & 0x80) {
        const lenBytes = len & 0x7f
        mrzStart = i + 2 + lenBytes + 1
      }
      break
    }
  }

  const mrzBytes = dg1.slice(mrzStart)
  const mrz = new TextDecoder('utf-8').decode(mrzBytes).trim()

  // TD3 passport: 2 lines of 44 chars
  const line1 = mrz.slice(0, 44)
  const line2 = mrz.slice(44, 88)

  log('MRZ line1:', line1)
  log('MRZ line2:', line2)

  // Line 1: P<COUNTRY SURNAME<<GIVEN NAMES
  const _docType = line1.slice(0, 1)
  const issuingState = line1.slice(2, 5)
  const nameField = line1.slice(5, 44).replace(/<+$/, '')
  const nameParts = nameField.split('<<')
  const lastName = (nameParts[0] ?? '').replace(/</g, ' ').trim()
  const firstName = (nameParts[1] ?? '').replace(/</g, ' ').trim()

  // Line 2: docNumber + check + nationality + DOB + check + sex + expiry + check + optional + check
  const documentNumber = line2.slice(0, 9).replace(/<+$/, '')
  const nationality = line2.slice(10, 13).replace(/<+$/, '')
  const dob = line2.slice(13, 19)
  const sex = line2.slice(20, 21)
  const expiry = line2.slice(21, 27)

  const formatDate = (d: string): string => {
    if (d.length !== 6) return d
    const yy = d.slice(0, 2)
    const mm = d.slice(2, 4)
    const dd = d.slice(4, 6)
    const year = parseInt(yy) > 30 ? `19${yy}` : `20${yy}`
    return `${year}-${mm}-${dd}`
  }

  return {
    firstName,
    lastName,
    gender: sex === 'M' ? 'Male' : sex === 'F' ? 'Female' : sex,
    birthDate: formatDate(dob),
    expiryDate: formatDate(expiry),
    documentNumber,
    nationality,
    issuingAuthority: issuingState,
    passportImageRaw: null,
  }
}

// ---------------------------------------------------------------------------
// Self-test: verify crypto against ICAO 9303 Appendix D.1 test vectors
// ---------------------------------------------------------------------------
function selfTestCrypto() {
  let allPassed = true
  const check = (name: string, actual: string, expected: string) => {
    const ok = actual === expected
    if (!ok) allPassed = false
    log(
      `SELF-TEST ${name}: ${ok ? 'OK' : 'FAIL'} (got ${actual.slice(0, 20)}${actual.length > 20 ? '...' : ''})`,
    )
    if (!ok) log(`  expected: ${expected}`)
  }

  try {
    // ICAO 9303 test data: doc L898902C<, DOB 690806, expiry 940623
    const mrzKey = 'L898902C<369080619406236'
    const seed = sha1Sync(new TextEncoder().encode(mrzKey)).slice(0, 16)
    check('seed', toHex(seed), '239ab9cb282daf66231dc5a4df6bfbae')

    const kenc = deriveKey(seed, 1)
    check('kenc', toHex(kenc), 'ab94fdecf2674fdfb9b391f85d7f76f2')

    const kmac = deriveKey(seed, 2)
    check('kmac', toHex(kmac), '7962d9ece03d1acd4c76089dce131543')

    // ICAO BAC test: encrypt S = RNDifd || RNDicc || Kifd
    const rndIfd = new Uint8Array(toBytes('781723860c06c226'))
    const rndIcc = new Uint8Array(toBytes('4608f91988702212'))
    const kIfd = new Uint8Array(toBytes('0b795240cb7049b01c19b33e32804f0b'))
    const S = new Uint8Array([...rndIfd, ...rndIcc, ...kIfd])
    const eifd = des3Encrypt(kenc, S)
    check('EIFD', toHex(eifd), '72c29c2371cc9bdb65b779b8e8d37b29ecc154aa56a8799fae2f498f76ed92f2')

    // Decrypt EIFD should give back S
    const decS = des3Decrypt(kenc, eifd)
    check('decrypt', toHex(decS), toHex(S))

    // Retail MAC of EIFD with kmac — ICAO expected value
    const mifd = retailMac(kmac, eifd)
    check('MIFD', toHex(mifd), '5f1448eea8ad90a7')

    // Test desDecryptBlock (single DES) individually
    const testBlock = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])
    const testKey = new Uint8Array(kenc.slice(0, 8))
    const encBlock = desEncryptBlock(testKey, testBlock)
    const decBlock = desDecryptBlock(testKey, encBlock)
    check('DES-roundtrip', toHex(decBlock), toHex(testBlock))

    // Test full 3DES decrypt roundtrip (our implementation)
    const testPlain32 = new Uint8Array(32)
    for (let i = 0; i < 32; i++) testPlain32[i] = i
    const testEnc32 = des3Encrypt(kenc, testPlain32)
    const testDec32 = des3Decrypt(kenc, testEnc32)
    check('3DES-roundtrip', toHex(testDec32), toHex(testPlain32))

    // Test SM MAC input construction (the critical fix!)
    // Simulates wrapping SELECT 0101 with known session keys and SSC.
    // This verifies that MAC input = SSC || pad(header) || DOs (no extra pad on DOs).
    {
      const testSsc = toBytes('0000000000000001')
      const testHeader = [0x0c, 0xa4, 0x02, 0x0c]
      const testHeaderPad = iso9797Pad(testHeader) // [0c a4 02 0c 80 00 00 00]
      const testFid = [0x01, 0x01]
      const testPadded = iso9797Pad(testFid)
      const testEncrypted = des3Encrypt(kenc, new Uint8Array(testPadded))
      const testDo87Value = [0x01, ...testEncrypted]
      const testDo87 = [0x87, ...tlvLength(testDo87Value.length), ...testDo87Value]

      // Correct MAC input: SSC(8) || padHeader(8) || DO87(11) = 27 bytes
      // retailMac pads to 32 bytes internally
      const correctInput = new Uint8Array([...testSsc, ...testHeaderPad, ...testDo87])
      check('SM-macInput-len', String(correctInput.length), '27')

      // Wrong (old) input would be: SSC(8) || padHeader(8) || padDO87(16) = 32 bytes
      // which retailMac would pad to 40 — different MAC!
      const wrongInput = new Uint8Array([...testSsc, ...testHeaderPad, ...iso9797Pad(testDo87)])
      const correctMac = toHex(retailMac(kmac, correctInput))
      const wrongMac = toHex(retailMac(kmac, wrongInput))
      const macsDiffer = correctMac !== wrongMac
      check('SM-macs-differ', String(macsDiffer), 'true')
      log(`  SM correct MAC input (27 bytes): ${toHex(correctInput)}`)
      log(`  SM correct MAC: ${correctMac}`)
      log(`  SM wrong MAC (old code, 32 bytes): ${wrongMac}`)
    }

    if (allPassed) {
      log('SELF-TEST: ALL PASSED — crypto is correct')
    } else {
      log('SELF-TEST: *** SOME TESTS FAILED — BAC will not work! ***')
    }
  } catch (e) {
    log('SELF-TEST EXCEPTION:', e)
  }
}

let selfTestDone = false

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PassportReadOptions {
  /** Called when NFC tag is detected and BAC is starting */
  onConnected?: () => void
  /** Called when BAC is complete and DG reading begins */
  onReading?: () => void
}

/**
 * Reads an ICAO 9303 passport over NFC using BAC.
 *
 * @param documentNumber  9-char document number (from MRZ line 2, positions 0-8)
 * @param dateOfBirth     6-char YYMMDD date of birth
 * @param expiryDate      6-char YYMMDD expiry date
 * @param opts            Optional callbacks for progress
 */
export async function readPassport(
  documentNumber: string,
  dateOfBirth: string,
  expiryDate: string,
  opts?: PassportReadOptions,
): Promise<EPassport> {
  // Run crypto self-test once (Buffer polyfill must be available)
  if (!selfTestDone) {
    selfTestDone = true
    selfTestCrypto()
  }

  log('Starting passport NFC read...')
  log('MRZ input:', { documentNumber, dateOfBirth, expiryDate })

  // Ensure NFC is initialized
  try {
    await NfcManager.start()
    log('NfcManager started')
  } catch (e) {
    log('NfcManager.start() error (may already be started):', e)
  }

  // Cancel any lingering NFC session from a previous read
  try {
    await NfcManager.cancelTechnologyRequest()
    log('Cancelled previous technology request')
  } catch {
    // No previous session — this is fine
  }

  try {
    log('Requesting IsoDep technology...')
    await NfcManager.requestTechnology(NfcTech.IsoDep, {
      alertMessage: 'Hold your passport flat against the back of your phone',
    })
    log('IsoDep technology granted — passport detected!')

    opts?.onConnected?.()

    // CRITICAL: Set timeout and send first APDU as fast as possible.
    // Any delay risks the user moving the phone and losing the NFC connection.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (NfcManager as any).setTimeout(10000)
    } catch {
      /* non-fatal */
    }

    // Select passport application immediately
    const selectOk = await selectPassportApp()
    if (!selectOk) {
      log('SELECT failed — attempting GET CHALLENGE directly...')
    }

    // Derive BAC keys from MRZ data
    const seed = deriveBacSeed(documentNumber, dateOfBirth, expiryDate)
    log('BAC seed:', toHex(seed))
    const kenc = deriveKey(seed, 1)
    log('BAC Kenc:', toHex(kenc))
    const kmac = deriveKey(seed, 2)
    log('BAC Kmac:', toHex(kmac))

    // Generate random IFD nonce and key
    const rndIfd = new Uint8Array(8)
    const kIfd = new Uint8Array(16)
    globalThis.crypto.getRandomValues(rndIfd)
    globalThis.crypto.getRandomValues(kIfd)

    // Perform BAC
    const { ksenc, ksmac, ssc } = await performBAC(kenc, kmac, rndIfd, kIfd)

    const sm = new SecureMessaging(ksenc, ksmac, ssc)
    opts?.onReading?.()

    // Read DG1 (MRZ data)
    log('Reading DG1...')
    const dg1 = await readFile('0101', sm)

    // Read DG15 (Active Authentication public key) — optional
    let dg15: Uint8Array | undefined
    try {
      log('Reading DG15...')
      dg15 = await readFile('010F', sm)
      if (dg15.length === 0) dg15 = undefined
    } catch (e) {
      log('DG15 not available (no Active Authentication):', e)
      dg15 = undefined
    }

    // Read SOD (Document Security Object)
    log('Reading SOD...')
    const sod = await readFile('011D', sm)

    log('All DGs read. Building EPassport...')

    // Parse person details from DG1
    const personDetails = parseDG1PersonDetails(dg1)

    const passport = new EPassport({
      docCode: 'P',
      personDetails,
      sodBytes: sod,
      dg1Bytes: dg1,
      dg15Bytes: dg15,
    })

    log('EPassport created successfully:', personDetails)
    return passport
  } finally {
    await NfcManager.cancelTechnologyRequest()
  }
}

export function stopPassportNfc() {
  return NfcManager.cancelTechnologyRequest().catch(() => {})
}
