import { Hex, poseidon } from '@iden3/js-crypto'
import { CurveFnWithCreate } from '@noble/curves/_shortw_utils'
import { ProjPointType } from '@noble/curves/abstract/weierstrass'
import { ECParameters } from '@peculiar/asn1-ecc'
import { toBigInt } from 'ethers'

import { namedCurveFromOID, namedCurveFromParams } from '@/utils/curves'

/**
 * HashPacked computes the Poseidon hash of 5 elements.
 * This is a TypeScript implementation matching the Go function provided.
 */
export function hashPacked(x509Key: Uint8Array): Uint8Array {
  if (x509Key.length < 5 * 24) {
    throw new TypeError('x509Key is too short')
  }

  const decomposed: bigint[] = new Array(5)
  let position = x509Key.length

  for (let i = 0; i < 5; i++) {
    if (position < 24) {
      throw new TypeError('x509Key is too short')
    }

    // Extract 24 bytes chunk (3 x 64-bit values = 24 bytes)
    const chunkBytes = x509Key.slice(position - 24, position)
    position -= 24

    const element = BigInt('0x' + Buffer.from(chunkBytes).toString('hex'))

    // Reverse byte order in 64-bit chunks
    let reversed = 0n
    for (let j = 0; j < 3; j++) {
      // Extract 64 bits chunk
      const extracted = (element >> BigInt(j * 64)) & 0xffffffffffffffffn
      // Build reversed value
      reversed = (reversed << 64n) | extracted
    }

    decomposed[i] = reversed
  }

  try {
    const hash = poseidon.hash(decomposed)
    return Hex.decodeString(hash.toString(16))
  } catch (error) {
    throw new TypeError(`Failed to compute Poseidon hash: ${error}`)
  }
}

export function hash512P384(key: Uint8Array): bigint {
  if (key.length !== 96) {
    throw new Error(`key is not 96 bytes long, got ${key.length}`)
  }

  const modulus = 2n ** 248n

  // P384: 48 bytes per coordinate
  // Convert byte arrays to bigint (big-endian)
  const X = toBigInt(key.slice(0, 48))
  const Y = toBigInt(key.slice(48, 96))

  // Split into chunks that fit in the field
  const lowerX = X % modulus
  const upperX = (X >> 248n) % modulus

  const lowerY = Y % modulus
  const upperY = (Y >> 248n) % modulus

  const decomposed = [lowerX, upperX, lowerY, upperY]

  const keyHash = poseidon.hash(decomposed)

  return keyHash
}

export function hash512P512(key: Uint8Array): bigint {
  if (key.length !== 128) {
    throw new Error(`key is not 128 bytes long, got ${key.length}`)
  }

  const modulus = 2n ** 248n

  // Convert byte arrays to bigint (big-endian)
  const X = toBigInt(key.slice(0, 64))
  const Y = toBigInt(key.slice(64, 128))

  const lowerX = X % modulus
  const upperX = (X >> 256n) % modulus

  const lowerY = Y % modulus
  const upperY = (Y >> 256n) % modulus

  const decomposed = [lowerX, upperX, lowerY, upperY]

  // Note: You'll need to implement or import a Poseidon hash function
  const keyHash = poseidon.hash(decomposed)

  return keyHash
}

export function hash512(key: Uint8Array): bigint {
  if (key.length !== 64) {
    throw new Error('key is not 64 bytes long')
  }

  const modulus = 2n ** 248n
  const decomposed: bigint[] = []

  for (let i = 0; i < 2; i++) {
    const element = toBigInt(key.slice(i * 32, (i + 1) * 32))
    decomposed[i] = element % modulus
  }

  // Note: You'll need to implement or import a Poseidon hash function
  const keyHash = poseidon.hash(decomposed)

  return keyHash
}

/**
 * Compute the pk_hash the same way as Noir circuit's extract_pk_hash function for ECDSA keys.
 *
 * From the Noir circuit (lines 768-794 of not_passports_zk_circuits.nr):
 * For ECDSA (SIG_TYPE >= 20), it reconstructs X and Y from 120-bit limbs and computes poseidon(X, Y).
 *
 * From the test helper getFakeIdenData (process_passport.js lines 446-457):
 * For ECDSA keys with coordinates > 248 bits, it takes the last 248 bits (62 hex chars) of each:
 *   pk_hash = poseidon([BigInt("0x" + pk.x.slice(pk.x.length - 62)), BigInt("0x" + pk.y.slice(pk.y.length - 62))])
 *
 * This must match the circuit's computation for SMT verification to pass.
 *
 * @param xCoord The X coordinate as hex string (without 0x prefix)
 * @param yCoord The Y coordinate as hex string (without 0x prefix)
 * @returns The pk_hash as a bigint, matching what the Noir circuit computes
 */
export function computeNoirCircuitPkHash(xCoord: string, yCoord: string): bigint {
  // The Noir circuit/test takes the last 62 hex chars (248 bits) to fit in BN254 field
  // If coordinates are <= 62 chars, use them directly
  const x = xCoord.length <= 62 ? xCoord : xCoord.slice(xCoord.length - 62)
  const y = yCoord.length <= 62 ? yCoord : yCoord.slice(yCoord.length - 62)

  const xBigInt = BigInt('0x' + x)
  const yBigInt = BigInt('0x' + y)

  console.log('[computeNoirCircuitPkHash] Full X coord length:', xCoord.length)
  console.log('[computeNoirCircuitPkHash] Full Y coord length:', yCoord.length)
  console.log('[computeNoirCircuitPkHash] Truncated X (last 62 hex):', x)
  console.log('[computeNoirCircuitPkHash] Truncated Y (last 62 hex):', y)
  console.log('[computeNoirCircuitPkHash] X as BigInt:', xBigInt.toString())
  console.log('[computeNoirCircuitPkHash] Y as BigInt:', yBigInt.toString())

  // Verify this is actually 248 bits
  const xBits = xBigInt.toString(2).length
  const yBits = yBigInt.toString(2).length
  console.log('[computeNoirCircuitPkHash] X bit length:', xBits)
  console.log('[computeNoirCircuitPkHash] Y bit length:', yBits)

  if (xBits > 248 || yBits > 248) {
    console.error('[computeNoirCircuitPkHash] ERROR: Truncated value exceeds 248 bits!')
  }

  const pkHash = poseidon.hash([xBigInt, yBigInt])

  console.log('[computeNoirCircuitPkHash] pk_hash:', pkHash.toString())
  return pkHash
}

/**
 * Compute a synthetic SMT root for Noir circuit testing.
 *
 * From Rarimo's test helper getFakeIdenData:
 *   const root = poseidon([pk_hash, pk_hash, 1n])
 *
 * This matches the SMT's smt_hash1 function:
 *   smt_hash1(key, value) = poseidon([key, value, 1])
 *
 * For a single-leaf SMT where key = value = pk_hash, the root is computed this way.
 *
 * @param pkHash The pk_hash computed by computeNoirCircuitPkHash
 * @returns The synthetic SMT root as hex string
 */
export function computeSyntheticSmtRoot(pkHash: bigint): string {
  // smt_hash1(key, value) = poseidon([key, value, 1])
  // For single-leaf tree where leaf = key = pk_hash, this is the root
  const root = poseidon.hash([pkHash, pkHash, 1n])
  const rootHex = '0x' + root.toString(16).padStart(64, '0')

  console.log('[computeSyntheticSmtRoot] pk_hash:', pkHash.toString())
  console.log('[computeSyntheticSmtRoot] root:', rootHex)

  return rootHex
}

/**
 * Create a synthetic SMT proof for Noir circuit testing.
 *
 * This matches Rarimo's test suite approach where they create "fake" SMT proofs
 * because the on-chain SMT uses a different hash computation than the circuit expects.
 *
 * @param xCoord The X coordinate as hex string (without 0x prefix)
 * @param yCoord The Y coordinate as hex string (without 0x prefix)
 * @returns An object with root (hex string) and siblings (array of 80 zeros)
 */
export function createSyntheticSmtProofForNoir(
  xCoord: string,
  yCoord: string,
): {
  root: string
  siblings: string[]
  existence: boolean
} {
  const pkHash = computeNoirCircuitPkHash(xCoord, yCoord)
  const root = computeSyntheticSmtRoot(pkHash)

  // 80 zero siblings for single-leaf SMT tree
  const siblings = new Array(80).fill('0x' + '0'.repeat(64))

  console.log('[createSyntheticSmtProofForNoir] Created synthetic proof with root:', root)

  return {
    root,
    siblings,
    existence: true,
  }
}

export function namedCurveFromParameters(parameters: ECParameters, subjectPublicKey: Uint8Array) {
  const res = (() => {
    if (parameters.namedCurve) {
      return namedCurveFromOID(parameters.namedCurve)
    }

    if (!parameters.specifiedCurve?.fieldID.fieldType) {
      throw new TypeError(
        'namedCurveFromParameters: ECDSA public key does not have a specified curve fieldID',
      )
    }

    return namedCurveFromOID(parameters.namedCurve ?? parameters.specifiedCurve?.fieldID.fieldType)
  })()

  if (!res) {
    return namedCurveFromParams(subjectPublicKey, parameters)
  }

  return res
}

export function getPublicKeyFromEcParameters(
  parameters: ECParameters,
  subjectPublicKey: Uint8Array,
): [ProjPointType<bigint>, CurveFnWithCreate, string] {
  const [name, curve] = namedCurveFromParameters(parameters, subjectPublicKey)

  if (!curve) throw new TypeError('Named curve not found in ECParameters')

  const publicKey = curve.Point.fromBytes(rightAlign(subjectPublicKey, subjectPublicKey.length * 8))

  if (!publicKey) throw new TypeError('Public key not found in TBS Certificate')

  return [publicKey, curve, name]
}

/**
 * RightAlign returns a slice where the padding bits are at the beginning.
 */
function rightAlign(bytes: Uint8Array, bitLength: number): Uint8Array {
  const shift = 8 - (bitLength % 8)
  if (shift === 8 || bytes.length === 0) {
    return bytes
  }

  const a = new Uint8Array(bytes.length)
  a[0] = bytes[0] >> shift
  for (let i = 1; i < bytes.length; i++) {
    a[i] = (bytes[i - 1] << (8 - shift)) & 0xff
    a[i] |= bytes[i] >> shift
  }

  return a
}
