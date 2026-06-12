import { NoirCircuitParams, NoirZKProof } from '@modules/noir'
import { RSAPublicKey } from '@peculiar/asn1-rsa'
import { getBytes, toBigInt, zeroPadBytes } from 'ethers'
import { Platform } from 'react-native'

import { tryCatch } from '@/helpers/try-catch'
import { EPassport } from '@/utils/e-document/e-document'
import { extractPubKey } from '@/utils/e-document/helpers/misc'

import {
  EIDBasedRegistrationCircuit,
  EPassportBasedRegistrationCircuit,
  RegistrationCircuit,
} from './registration-circuit'

export class NoirEPassportBasedRegistrationCircuit extends EPassportBasedRegistrationCircuit {
  constructor(public eDoc: EPassport) {
    super(eDoc)
  }

  static computeBarretReduction(nBits: number, n: bigint): bigint {
    return BigInt(2) ** BigInt(2 * nBits) / n
  }

  public get noirCircuitParams(): NoirCircuitParams {
    return NoirCircuitParams.fromName(this.name)
  }

  public get chunkedParams() {
    const defaultChunkedParams = super.chunkedParams

    const pubKey = extractPubKey(
      this.eDoc.sod.slaveCertificate.certificate.tbsCertificate.subjectPublicKeyInfo,
    )

    let reduction = RegistrationCircuit.splitBigIntToChunks(
      120,
      defaultChunkedParams.chunk_number,
      0n,
    )

    if (pubKey instanceof RSAPublicKey) {
      const unpaddedModulus = new Uint8Array(
        pubKey.modulus[0] === 0x00 ? pubKey.modulus.slice(1) : pubKey.modulus,
      )

      reduction = RegistrationCircuit.splitBigIntToChunks(
        120,
        defaultChunkedParams.chunk_number,
        NoirEPassportBasedRegistrationCircuit.computeBarretReduction(
          unpaddedModulus.length * 8 + 2,
          toBigInt(unpaddedModulus),
        ),
      )
    }

    return { ...super.chunkedParams, reduction }
  }

  async prove(params: {
    skIdentity: bigint
    icaoRoot: bigint
    inclusionBranches: bigint[]
  }): Promise<NoirZKProof> {
    await NoirCircuitParams.downloadTrustedSetup()

    const byteCode = await this.noirCircuitParams.downloadByteCode()

    let pk = this.chunkedParams.pk_chunked
    let reduction = this.chunkedParams.reduction
    let sig = this.chunkedParams.sig_chunked

    const pubKey = extractPubKey(
      this.eDoc.sod.slaveCertificate.certificate.tbsCertificate.subjectPublicKeyInfo,
    )

    if (pubKey instanceof RSAPublicKey) {
      const unpaddedModulus = new Uint8Array(
        pubKey.modulus[0] === 0x00 ? pubKey.modulus.slice(1) : pubKey.modulus,
      )

      const modulusBits = unpaddedModulus.length * 8

      // Noir RSA circuits pack the modulus/signature into 120-bit limbs. Derive
      // the limb count from the actual key size so 2048/3072/4096-bit keys all
      // work (e.g. 3072-bit -> ceil(3072 / 120) = 26 limbs, matching the platform
      // circuit `verify_rsa::<3072, 26, ...>`).
      const chunkNumber = Math.ceil(modulusBits / 120)

      pk = RegistrationCircuit.splitBigIntToChunks(120, chunkNumber, toBigInt(unpaddedModulus))

      reduction = RegistrationCircuit.splitBigIntToChunks(
        120,
        chunkNumber,
        NoirEPassportBasedRegistrationCircuit.computeBarretReduction(
          modulusBits + 2,
          toBigInt(unpaddedModulus),
        ),
      )

      // The circuit verifies the DS cert's signature over the passport SOD
      // signedAttributes (sod.signature) \u2014 NOT the CSCA signature on the DS cert.
      sig = RegistrationCircuit.splitBigIntToChunks(
        120,
        chunkNumber,
        toBigInt(new Uint8Array(this.eDoc.sod.signature)),
      )
    }

    const inputs = {
      dg1: Array.from(this.eDoc.dg1Bytes),
      dg15: this.eDoc.dg15Bytes?.length ? Array.from(this.eDoc.dg15Bytes) : [],
      ec: Array.from(this.eDoc.sod.encapsulatedContent),
      sa: Array.from(this.eDoc.sod.signedAttributes),

      pk: pk,
      reduction_pk: reduction,
      sig: sig,

      sk_identity: params.skIdentity.toString(),
      icao_root: params.icaoRoot.toString(),
      inclusion_branches: params.inclusionBranches.map(el => el.toString()),
    }

    const inputsJson = JSON.stringify(inputs)

    return this.noirCircuitParams.prove(inputsJson, byteCode, 'honk_keccak')
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

    let inclusion_branches = params.inclusionBranches.map(String)

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

    console.log('[NoirEIDRegistration] Input summary:')
    console.log('  tbs.length:', tbsInput.length)
    console.log('  pk.length:', pk.length)
    console.log('  reduction.length:', reduction.length)
    console.log('  signature.length:', signature.length)
    console.log('  len:', len)
    console.log('  icao_root:', icao_root.toString().slice(0, 20) + '...')
    console.log('  inclusion_branches.length:', inclusion_branches.length)
    console.log('  sk_identity:', skIdentity.toString().slice(0, 20) + '...')
    console.log('  tbsRaw.byteLength:', this.tbsRaw.byteLength)

    // The on-chain INID register verifier (NoirRegisterIdentity_ID_Card_I_Honk)
    // is a keccak UltraHonk verifier, so the proof must be produced with the
    // keccak honk backend — not the legacy plonk path.
    const [proof, getProofError] = await tryCatch(
      this.noirCircuitParams.prove(JSON.stringify(inputs), byteCode, 'honk_keccak'),
    )
    if (getProofError) {
      throw getProofError
    }

    return proof
  }
}
