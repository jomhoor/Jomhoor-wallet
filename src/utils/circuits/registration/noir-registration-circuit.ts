import { poseidon } from '@iden3/js-crypto'
import { NoirCircuitParams, NoirZKProof } from '@modules/noir'
import { ECDSASigValue } from '@peculiar/asn1-ecc'
import { RSAPublicKey } from '@peculiar/asn1-rsa'
import { AsnConvert } from '@peculiar/asn1-schema'
import { getBytes, toBeArray, toBigInt, zeroPadBytes } from 'ethers'
import { Platform } from 'react-native'

import { tryCatch } from '@/helpers/try-catch'
import { EPassport } from '@/utils/e-document/e-document'
import { computeNoirCircuitPkHash } from '@/utils/e-document/helpers/crypto'
import { extractPubKey } from '@/utils/e-document/helpers/misc'

import {
  EIDBasedRegistrationCircuit,
  EPassportBasedRegistrationCircuit,
  RegistrationCircuit,
} from './registration-circuit'

/**
 * Noir circuits use 120-bit chunks (30 hex chars per chunk).
 * This differs from Circom which uses 64-bit chunks.
 *
 * For brainpoolP384r1 (96 hex char coordinates):
 * - chunk_number = ceil(96/30) = 4 per coordinate
 * - Total pk = 4 (X) + 4 (Y) = 8 elements
 * - Total sig = 4 (r) + 4 (s) = 8 elements
 *
 * For ECDSA, reduction_pk is all zeros (Barrett reduction is RSA-only).
 */
export class NoirEPassportBasedRegistrationCircuit extends EPassportBasedRegistrationCircuit {
  constructor(public eDoc: EPassport) {
    super(eDoc)
  }

  static computeBarretReduction(nBits: number, n: bigint): bigint {
    return BigInt(2) ** BigInt(2 * nBits) / n
  }

  /**
   * Split a BigInt into 120-bit chunks (little-endian, least significant first).
   * This matches Rarimo's Noir implementation: bigintToArray(120, k, x)
   */
  static splitTo120BitChunks(chunkCount: number, value: bigint): string[] {
    const bitsPerChunk = 120n
    const mask = (1n << bitsPerChunk) - 1n
    return Array.from({ length: chunkCount }, (_, i) => {
      return ((value >> (BigInt(i) * bitsPerChunk)) & mask).toString(10)
    })
  }

  /**
   * Reconstruct a value from 120-bit little-endian chunks.
   * This is the inverse of splitTo120BitChunks.
   */
  static reconstructFromChunks(chunks: string[]): bigint {
    const bitsPerChunk = 120n
    let result = 0n
    for (let i = 0; i < chunks.length; i++) {
      result += BigInt(chunks[i]) << (BigInt(i) * bitsPerChunk)
    }
    return result
  }

  /**
   * Compute pk_hash the same way the Noir circuit does:
   * 1. Reconstruct X and Y from 120-bit limbs
   * 2. Truncate to 248 bits (lower bits)
   * 3. poseidon([truncatedX, truncatedY])
   *
   * @param pkChunks Array of 8 strings: [X0, X1, X2, X3, Y0, Y1, Y2, Y3]
   * @param ecFieldSize Size in bits (e.g., 384 for brainpoolP384r1)
   */
  static computePkHashFromChunks(pkChunks: string[], ecFieldSize: number): bigint {
    const halfLen = pkChunks.length / 2
    const xChunks = pkChunks.slice(0, halfLen)
    const yChunks = pkChunks.slice(halfLen)

    console.log('[computePkHashFromChunks] X chunks:', xChunks)
    console.log('[computePkHashFromChunks] Y chunks:', yChunks)

    // Reconstruct full X and Y
    const fullX = this.reconstructFromChunks(xChunks)
    const fullY = this.reconstructFromChunks(yChunks)

    console.log('[computePkHashFromChunks] Full X:', fullX.toString())
    console.log('[computePkHashFromChunks] Full Y:', fullY.toString())
    console.log('[computePkHashFromChunks] Full X (hex):', fullX.toString(16))
    console.log('[computePkHashFromChunks] Full Y (hex):', fullY.toString(16))

    // Truncate to 248 bits if ecFieldSize > 248
    const truncBits = 248
    const mask = (1n << BigInt(truncBits)) - 1n
    const truncatedX = fullX & mask
    const truncatedY = fullY & mask

    console.log('[computePkHashFromChunks] Truncated X (248 bits):', truncatedX.toString())
    console.log('[computePkHashFromChunks] Truncated Y (248 bits):', truncatedY.toString())
    console.log('[computePkHashFromChunks] Truncated X (hex):', truncatedX.toString(16))
    console.log('[computePkHashFromChunks] Truncated Y (hex):', truncatedY.toString(16))

    const pkHash = poseidon.hash([truncatedX, truncatedY])
    console.log('[computePkHashFromChunks] pk_hash:', pkHash.toString())

    return pkHash
  }

  public get noirCircuitParams(): NoirCircuitParams {
    console.log('[NoirCircuit] Looking for circuit:', this.name)
    return NoirCircuitParams.fromName(this.name)
  }

  /**
   * Get chunked parameters using Noir's 120-bit chunking strategy.
   *
   * Key differences from Circom:
   * - Uses 120-bit chunks instead of 64-bit
   * - chunk_number = ceil(hexKeyLength / 30) for ECDSA
   * - reduction_pk is all zeros for ECDSA (Barrett reduction is RSA-only)
   */
  public get chunkedParams() {
    const pubKey = extractPubKey(
      this.eDoc.sod.slaveCertificate.certificate.tbsCertificate.subjectPublicKeyInfo,
    )

    // RSA handling
    if (pubKey instanceof RSAPublicKey) {
      // Remove leading zero if present
      const unpaddedModulus = new Uint8Array(
        pubKey.modulus[0] === 0x00 ? pubKey.modulus.slice(1) : pubKey.modulus,
      )

      // RSA: chunk_number = ceil(modulusHexLength / 30)
      const modulusHexLength = unpaddedModulus.length * 2
      const chunkNumber = Math.ceil(modulusHexLength / 30)

      const pk_chunked = NoirEPassportBasedRegistrationCircuit.splitTo120BitChunks(
        chunkNumber,
        toBigInt(unpaddedModulus),
      )

      const sig_chunked = NoirEPassportBasedRegistrationCircuit.splitTo120BitChunks(
        chunkNumber,
        // IMPORTANT: Use sod.signature (SOD's signature on passport data),
        // NOT slaveCertificate.certificate.signatureValue (CSCA's signature on DS cert)
        toBigInt(this.eDoc.sod.signature),
      )

      const reduction = NoirEPassportBasedRegistrationCircuit.splitTo120BitChunks(
        chunkNumber,
        NoirEPassportBasedRegistrationCircuit.computeBarretReduction(
          unpaddedModulus.length * 8 + 2,
          toBigInt(unpaddedModulus),
        ),
      )

      return {
        ec_field_size: 0,
        chunk_number: chunkNumber,
        pk_chunked,
        sig_chunked,
        reduction,
      }
    }

    // ECDSA handling
    // Get the hex length of X coordinate (384 bits = 48 bytes = 96 hex chars for P384)
    const xBytes = toBeArray(pubKey.px)
    const yBytes = toBeArray(pubKey.py)

    // Pad to full coordinate size based on curve
    // P384: 48 bytes, P256: 32 bytes, P512: 64 bytes
    const coordinateByteSize = Math.max(xBytes.length, yBytes.length)
    const paddedX = new Uint8Array(coordinateByteSize)
    const paddedY = new Uint8Array(coordinateByteSize)
    paddedX.set(xBytes, coordinateByteSize - xBytes.length)
    paddedY.set(yBytes, coordinateByteSize - yBytes.length)

    // For Noir: chunk_number = ceil(hexLength / 30) per coordinate
    const coordinateHexLength = coordinateByteSize * 2
    const chunkNumberPerCoord = Math.ceil(coordinateHexLength / 30)

    console.log('[NoirChunking] ECDSA params:', {
      coordinateByteSize,
      coordinateHexLength,
      chunkNumberPerCoord,
      totalPkElements: chunkNumberPerCoord * 2,
    })

    // Split X and Y into 120-bit chunks and concatenate
    const pk_chunked = NoirEPassportBasedRegistrationCircuit.splitTo120BitChunks(
      chunkNumberPerCoord,
      toBigInt(paddedX),
    ).concat(
      NoirEPassportBasedRegistrationCircuit.splitTo120BitChunks(
        chunkNumberPerCoord,
        toBigInt(paddedY),
      ),
    )

    // Parse ECDSA signature (r, s) from DER-encoded format
    // IMPORTANT: Use sod.signature (SOD's signature on passport data),
    // NOT slaveCertificate.certificate.signatureValue (CSCA's signature on DS cert)
    const sodSignature = this.eDoc.sod.signature
    console.log('[NoirChunking] SOD signature length:', sodSignature.length)
    console.log(
      '[NoirChunking] SOD signature first 20 bytes:',
      Array.from(sodSignature.slice(0, 20))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(''),
    )

    const { r, s } = AsnConvert.parse(sodSignature, ECDSASigValue)

    console.log('[NoirChunking] Parsed ECDSA r length:', new Uint8Array(r).length)
    console.log('[NoirChunking] Parsed ECDSA s length:', new Uint8Array(s).length)

    // Pad r and s to same size as coordinates
    const rBytes = new Uint8Array(r)
    const sBytes = new Uint8Array(s)
    const paddedR = new Uint8Array(coordinateByteSize)
    const paddedS = new Uint8Array(coordinateByteSize)
    paddedR.set(
      rBytes.length > coordinateByteSize ? rBytes.slice(-coordinateByteSize) : rBytes,
      Math.max(0, coordinateByteSize - rBytes.length),
    )
    paddedS.set(
      sBytes.length > coordinateByteSize ? sBytes.slice(-coordinateByteSize) : sBytes,
      Math.max(0, coordinateByteSize - sBytes.length),
    )

    const sig_chunked = NoirEPassportBasedRegistrationCircuit.splitTo120BitChunks(
      chunkNumberPerCoord,
      toBigInt(paddedR),
    ).concat(
      NoirEPassportBasedRegistrationCircuit.splitTo120BitChunks(
        chunkNumberPerCoord,
        toBigInt(paddedS),
      ),
    )

    // For ECDSA, reduction is all zeros (Barrett reduction is RSA-only)
    const reduction = NoirEPassportBasedRegistrationCircuit.splitTo120BitChunks(
      chunkNumberPerCoord * 2,
      0n,
    )

    // Verify pk_hash computation from chunks (for debugging)
    console.log('[NoirChunking] Computing pk_hash from chunks for verification...')
    console.log('[NoirChunking] Source public key X (bigint):', pubKey.px.toString())
    console.log('[NoirChunking] Source public key Y (bigint):', pubKey.py.toString())
    console.log('[NoirChunking] Source public key X (hex):', pubKey.px.toString(16))
    console.log('[NoirChunking] Source public key Y (hex):', pubKey.py.toString(16))

    const pkHashFromChunks = NoirEPassportBasedRegistrationCircuit.computePkHashFromChunks(
      pk_chunked,
      coordinateByteSize * 8,
    )
    console.log('[NoirChunking] pk_hash from chunks:', pkHashFromChunks.toString())

    // Also compute pk_hash from hex for comparison
    const xHex = pubKey.px.toString(16).padStart(coordinateHexLength, '0')
    const yHex = pubKey.py.toString(16).padStart(coordinateHexLength, '0')
    console.log('[NoirChunking] X hex for pk_hash:', xHex)
    console.log('[NoirChunking] Y hex for pk_hash:', yHex)
    const pkHashFromHex = computeNoirCircuitPkHash(xHex, yHex)
    console.log('[NoirChunking] pk_hash from hex:', pkHashFromHex.toString())

    // These should match!
    if (pkHashFromChunks.toString() !== pkHashFromHex.toString()) {
      console.error('[NoirChunking] ❌ pk_hash MISMATCH! Chunks vs Hex computation differs!')
      console.error(
        '[NoirChunking] This means the circuit will compute a DIFFERENT pk_hash from the SMT root!',
      )
    } else {
      console.log('[NoirChunking] ✅ pk_hash matches between chunks and hex computation')
    }

    return {
      ec_field_size: coordinateByteSize * 8,
      chunk_number: chunkNumberPerCoord * 2, // Total chunks (X+Y or r+s)
      pk_chunked,
      sig_chunked,
      reduction,
    }
  }

  async prove(params: {
    skIdentity: bigint
    icaoRoot: bigint
    inclusionBranches: bigint[]
  }): Promise<NoirZKProof> {
    await NoirCircuitParams.downloadTrustedSetup()

    const byteCode = await this.noirCircuitParams.downloadByteCode()

    // Log raw passport data sizes before any formatting
    console.log('[NoirEPassport] Raw passport data sizes:', {
      dg1Bytes: this.eDoc.dg1Bytes.length,
      dg15Bytes: this.eDoc.dg15Bytes?.length ?? 0,
      encapsulatedContent: this.eDoc.sod.encapsulatedContent.length,
      signedAttributes: this.eDoc.sod.signedAttributes.length,
    })

    // Format byte arrays based on platform
    // iOS: needs string array of decimal values
    // Android: raw arrays work
    const formatBytes = (bytes: Uint8Array): (string | number)[] => {
      if (Platform.OS === 'ios') {
        return Array.from(bytes).map(String)
      }
      return Array.from(bytes)
    }

    // Format chunked BigInt values based on platform
    const formatChunks = (chunks: string[]): string[] => {
      if (Platform.OS === 'android') {
        return chunks.map(el => `0x${BigInt(el).toString(16)}`)
      }
      return chunks // iOS uses decimal strings
    }

    // Format single BigInt as string
    const formatBigInt = (val: bigint): string => {
      if (Platform.OS === 'android') {
        return `0x${val.toString(16)}`
      }
      return val.toString()
    }

    // Pad inclusion_branches to exactly 80 elements (SMT tree depth)
    // The smart contract may return fewer siblings, but the circuit expects exactly 80
    const SMT_TREE_DEPTH = 80
    const paddedBranches = [...params.inclusionBranches]
    while (paddedBranches.length < SMT_TREE_DEPTH) {
      paddedBranches.push(0n) // Pad with zeros
    }
    console.log(
      `[NoirEPassport] Padded inclusion_branches from ${params.inclusionBranches.length} to ${paddedBranches.length}`,
    )

    const inputs = {
      dg1: formatBytes(this.eDoc.dg1Bytes),
      dg15: this.eDoc.dg15Bytes ? formatBytes(this.eDoc.dg15Bytes) : [],
      ec: formatBytes(this.eDoc.sod.encapsulatedContent),
      sa: formatBytes(this.eDoc.sod.signedAttributes),

      pk: formatChunks(this.chunkedParams.pk_chunked),
      reduction_pk: formatChunks(this.chunkedParams.reduction),
      sig: formatChunks(this.chunkedParams.sig_chunked),

      sk_identity: formatBigInt(params.skIdentity),
      icao_root: formatBigInt(params.icaoRoot),
      inclusion_branches: paddedBranches.map(b => formatBigInt(b)),
    }

    // Debug: Log input sizes to compare with circuit ABI expectations
    console.log('[NoirEPassport] Input sizes:', {
      dg1: inputs.dg1.length,
      dg15: inputs.dg15.length,
      ec: inputs.ec.length,
      sa: inputs.sa.length,
      pk: inputs.pk.length,
      reduction_pk: inputs.reduction_pk.length,
      sig: inputs.sig.length,
      inclusion_branches: inputs.inclusion_branches.length,
    })

    // Validate sizes match circuit expectations for this specific circuit
    // registerIdentity_25_384_3_3_336_232_NA expects:
    // dg1: 93, dg15: 0, ec: 258, sa: 90, pk: 8, reduction_pk: 8, sig: 8, inclusion_branches: 80
    const expectedSizes: Record<
      string,
      { dg1: number; dg15: number; ec: number; sa: number; pk: number }
    > = {
      registerIdentity_25_384_3_3_336_232_NA: { dg1: 93, dg15: 0, ec: 258, sa: 90, pk: 8 },
      // Add other circuit variants as needed
    }

    const expected = expectedSizes[this.name]
    if (expected) {
      const mismatches: string[] = []
      if (inputs.dg1.length !== expected.dg1)
        mismatches.push(`dg1: got ${inputs.dg1.length}, expected ${expected.dg1}`)
      if (inputs.dg15.length !== expected.dg15)
        mismatches.push(`dg15: got ${inputs.dg15.length}, expected ${expected.dg15}`)
      if (inputs.ec.length !== expected.ec)
        mismatches.push(`ec: got ${inputs.ec.length}, expected ${expected.ec}`)
      if (inputs.sa.length !== expected.sa)
        mismatches.push(`sa: got ${inputs.sa.length}, expected ${expected.sa}`)
      if (inputs.pk.length !== expected.pk)
        mismatches.push(`pk: got ${inputs.pk.length}, expected ${expected.pk}`)

      if (mismatches.length > 0) {
        console.error('[NoirEPassport] SIZE MISMATCH DETECTED:', mismatches)
        console.error('[NoirEPassport] This German passport may need a different circuit variant!')
        console.error('[NoirEPassport] Circuit name:', this.name)
      }
    }

    // Debug: Log first few values of each chunked array to verify format
    console.log('[NoirEPassport] Sample values:', {
      pk_first3: inputs.pk.slice(0, 3),
      sig_first3: inputs.sig.slice(0, 3),
      reduction_first3: inputs.reduction_pk.slice(0, 3),
      sk_identity: inputs.sk_identity,
      icao_root: inputs.icao_root,
      inclusion_branches_first3: inputs.inclusion_branches.slice(0, 3),
    })

    // Debug: Log raw chunked params before formatting
    console.log('[NoirEPassport] Raw chunkedParams:', {
      pk_chunked: this.chunkedParams.pk_chunked,
      sig_chunked: this.chunkedParams.sig_chunked,
      reduction: this.chunkedParams.reduction,
      chunk_number: this.chunkedParams.chunk_number,
      ec_field_size: this.chunkedParams.ec_field_size,
    })

    // Validate input sizes match circuit expectations before proving
    // The circuit registerIdentity_25_384_3_3_336_232_NA expects:
    // dg1: 93, dg15: 0, ec: 258, sa: 90, pk: 8, reduction_pk: 8, sig: 8
    console.log('[NoirEPassport] FULL INPUTS for circuit:', JSON.stringify(inputs, null, 2))

    try {
      return await this.noirCircuitParams.prove(JSON.stringify(inputs), byteCode)
    } catch (error) {
      console.error('[NoirEPassport] Proof generation failed:', error)
      console.error('[NoirEPassport] Circuit name:', this.name)
      console.error('[NoirEPassport] Actual input sizes:', {
        dg1: inputs.dg1.length,
        dg15: inputs.dg15.length,
        ec: inputs.ec.length,
        sa: inputs.sa.length,
        pk: inputs.pk.length,
        reduction_pk: inputs.reduction_pk.length,
        sig: inputs.sig.length,
        inclusion_branches: inputs.inclusion_branches.length,
      })
      throw error
    }
  }
}

export class NoirEIDBasedRegistrationCircuit extends EIDBasedRegistrationCircuit {
  public get noirCircuitParams(): NoirCircuitParams {
    return NoirCircuitParams.fromName('registerIdentity_inid_ca')
  }

  async prove(params: {
    skIdentity: bigint
    icaoRoot: bigint
    inclusionBranches: bigint[]
  }): Promise<NoirZKProof> {
    await NoirCircuitParams.downloadTrustedSetup()

    const byteCode = await this.noirCircuitParams.downloadByteCode()

    const tbsInput =
      Platform.OS === 'ios'
        ? Array.from(getBytes(zeroPadBytes(new Uint8Array(this.tbsRaw), 1200))).map(String)
        : Array.from(getBytes(zeroPadBytes(new Uint8Array(this.tbsRaw), 1200)))

    let pk = RegistrationCircuit.splitBigIntToChunks(120, 18, toBigInt(this.pubKey))

    if (Platform.OS === 'android') {
      pk = pk.map(el => `0x${BigInt(el).toString(16)}`)
    }

    let reduction = RegistrationCircuit.splitBigIntToChunks(
      120,
      18,
      NoirEPassportBasedRegistrationCircuit.computeBarretReduction(2048 + 2, toBigInt(this.pubKey)),
    )

    if (Platform.OS === 'android') {
      reduction = reduction.map(el => `0x${BigInt(el).toString(16)}`)
    }

    let signature = RegistrationCircuit.splitBigIntToChunks(
      120,
      18,
      toBigInt(new Uint8Array(this.eID.sigCertificate.certificate.signatureValue)),
    )

    if (Platform.OS === 'android') {
      signature = signature.map(el => `0x${BigInt(el).toString(16)}`)
    }

    let len = String(this.tbsRaw.byteLength)

    if (Platform.OS === 'android') {
      len = `0x${BigInt(len).toString(16)}`
    }

    let icao_root = String(params.icaoRoot)

    if (Platform.OS === 'android') {
      icao_root = `0x${BigInt(icao_root).toString(16)}`
    }

    // Pad inclusion_branches to exactly 80 elements (SMT tree depth)
    const SMT_TREE_DEPTH = 80
    const paddedBranches = [...params.inclusionBranches]
    while (paddedBranches.length < SMT_TREE_DEPTH) {
      paddedBranches.push(0n) // Pad with zeros
    }

    let inclusion_branches = paddedBranches.map(String)

    if (Platform.OS === 'android') {
      inclusion_branches = inclusion_branches.map(el => `0x${BigInt(el).toString(16)}`)
    }

    let skIdentity = String(params.skIdentity)

    if (Platform.OS === 'android') {
      skIdentity = `0x${BigInt(skIdentity).toString(16)}`
    }

    const inputs = {
      tbs: tbsInput,
      pk: pk,
      reduction: reduction,
      len: len,
      signature: signature,
      icao_root: icao_root,
      inclusion_branches: inclusion_branches,
      sk_identity: skIdentity,
    }

    const [proof, getProofError] = await tryCatch(
      this.noirCircuitParams.prove(JSON.stringify(inputs), byteCode),
    )
    if (getProofError) {
      throw getProofError
    }

    return proof
  }
}
