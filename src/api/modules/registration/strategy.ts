import { buildCertTreeAndGenProof, buildCertTreeRoot, parsePemString } from '@lukachi/rn-csca'
import {
  ECParameters,
  id_ecdsaWithSHA1,
  id_ecdsaWithSHA256,
  id_ecdsaWithSHA384,
  id_ecdsaWithSHA512,
} from '@peculiar/asn1-ecc'
import {
  id_pkcs_1,
  id_RSASSA_PSS,
  id_sha1WithRSAEncryption,
  id_sha256,
  id_sha256WithRSAEncryption,
  id_sha384,
  id_sha384WithRSAEncryption,
  id_sha512,
  id_sha512WithRSAEncryption,
  RSAPublicKey,
  RsaSaPssParams,
} from '@peculiar/asn1-rsa'
import { AsnConvert } from '@peculiar/asn1-schema'
import { Certificate } from '@peculiar/asn1-x509'
import { AxiosError } from 'axios'
import {
  Contract,
  encodeBytes32String,
  getBytes,
  hexlify,
  JsonRpcProvider,
  keccak256,
  toBeArray,
  toBigInt,
  zeroPadValue,
} from 'ethers'
import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system'
import { FieldRecords } from 'mrz'

import { RARIMO_CHAINS } from '@/api/modules/rarimo/constants'
import {
  PassportRegistrationProfile,
  PassportRegistrationPublicKeyAlgorithm,
  resolvePassportRegistrationPath,
} from '@/api/modules/registration/passport-registration-path'
import { extractRelayerTxHash, relayerRegister } from '@/api/modules/registration/relayer'
import { Config } from '@/config'
import { createPoseidonSMTContract } from '@/helpers/contracts'
import {
  classifyIdentityCreationError,
  logIdentityDiagnostic,
  logIdentityDiagnosticError,
} from '@/helpers/identity-proof-diagnostics'
import { IdentityItem } from '@/store/modules/identity/Identity'
import { Registration__factory } from '@/types/contracts/factories/Registration__factory'
import { SparseMerkleTree } from '@/types/contracts/PoseidonSMT'
import { Registration2 } from '@/types/contracts/Registration'
import { StateKeeper } from '@/types/contracts/StateKeeper'
import { EDocument } from '@/utils/e-document/e-document'
import { ExtendedCertificate } from '@/utils/e-document/extended-cert'
import { getPublicKeyFromEcParameters, hashPacked } from '@/utils/e-document/helpers/crypto'
import { extractPubKey } from '@/utils/e-document/helpers/misc'
import { Sod } from '@/utils/e-document/sod'
import { ECDSA_ALGO_PREFIX } from '@/utils/e-document/helpers/constants'

/**
 * Manual ABI encoder for `registerCertificate`.
 *
 * Hermes (React Native JS engine) corrupts certain offset/length words when
 * ethers.js's ABI coder round-trips values through typed arrays. This function
 * builds the calldata entirely with string operations, bypassing the issue.
 */
function manualEncodeRegisterCertificate(
  dataType: string,
  signedAttributes: Uint8Array,
  keyOffset: number,
  expirationOffset: number,
  signature: Uint8Array,
  publicKey: Uint8Array,
  proof: Uint8Array[],
): string {
  const SELECTOR = 'ccd0b62a'

  const word = (n: number | bigint): string => {
    const h = BigInt(n).toString(16)
    return '0'.repeat(64 - h.length) + h
  }

  const bytesToHex = (data: Uint8Array): string => {
    let result = ''
    for (let i = 0; i < data.length; i++) {
      result += data[i].toString(16).padStart(2, '0')
    }
    return result
  }

  const padTo32 = (hex: string): string => {
    const byteLen = hex.length / 2
    const paddedLen = Math.ceil(byteLen / 32) * 32
    return hex + '0'.repeat((paddedLen - byteLen) * 2)
  }

  const strip = (h: string): string => (h.startsWith('0x') ? h.slice(2) : h)

  // Certificate tuple: (bytes32 dataType, bytes signedAttributes, uint256 keyOffset, uint256 expirationOffset)
  const saHex = bytesToHex(signedAttributes)
  const certSaOffset = 128 // head = 4 * 32
  const certTuple =
    strip(dataType).padStart(64, '0') +
    word(certSaOffset) +
    word(keyOffset) +
    word(expirationOffset) +
    word(signedAttributes.length) +
    padTo32(saHex)

  // ICAOMember tuple: (bytes signature, bytes publicKey)
  const sigHex = bytesToHex(signature)
  const pkHex = bytesToHex(publicKey)
  const icaoSigOffset = 64 // head = 2 * 32
  const sigSection = word(signature.length) + padTo32(sigHex)
  const icaoPkOffset = icaoSigOffset + sigSection.length / 2
  const icaoTuple =
    word(icaoSigOffset) + word(icaoPkOffset) + sigSection + word(publicKey.length) + padTo32(pkHex)

  // Proof: bytes32[]
  const proofHex = word(proof.length) + proof.map(p => bytesToHex(p).padStart(64, '0')).join('')

  // Top-level offsets
  const headBytes = 96
  const certBytes = certTuple.length / 2
  const icaoBytes = icaoTuple.length / 2
  const topLevel =
    word(headBytes) + word(headBytes + certBytes) + word(headBytes + certBytes + icaoBytes)

  return '0x' + SELECTOR + topLevel + certTuple + icaoTuple + proofHex
}

export type PassportInfo = {
  passportInfo_: StateKeeper.PassportInfoStructOutput
  identityInfo_: StateKeeper.IdentityInfoStructOutput
}

type CertificateDispatcherSelection = {
  dispatcherName: string
  publicKeyAlgorithm: 'RSA' | 'ECDSA'
  publicKeySizeBits: number
  pathId: string
  pathDescription: string
  dataSizeClass: string
  masterPublicExponent: number | null
}

export abstract class RegistrationStrategy {
  static ZERO_BYTES32_HEX = encodeBytes32String('')

  static registrationContractInterface = Registration__factory.createInterface()

  public static getRevocationChallenge = async (
    passportInfo: PassportInfo,
  ): Promise<Uint8Array> => {
    if (!passportInfo?.passportInfo_.activeIdentity)
      throw new TypeError('Active identity not found')

    const challenge = getBytes(passportInfo.passportInfo_.activeIdentity).slice(24, 32)

    return challenge
  }

  public static get rmoEvmJsonRpcProvider() {
    const evmRpcUrl = RARIMO_CHAINS[Config.RMO_CHAIN_ID].rpcEvm

    return new JsonRpcProvider(evmRpcUrl)
  }

  public static get certPoseidonSMTContract() {
    return createPoseidonSMTContract(
      Config.CERT_POSEIDON_SMT_CONTRACT_ADDRESS,
      RegistrationStrategy.rmoEvmJsonRpcProvider,
    )
  }

  private static buildSlaveCertProofLookupCandidates(
    cert: ExtendedCertificate,
  ): Array<{ key: string; source: string }> {
    const candidates: Array<{ key: string; source: string }> = []
    const pushCandidate = (keyBytes: Uint8Array | string, source: string) => {
      try {
        candidates.push({
          key: zeroPadValue(keyBytes, 32),
          source,
        })
      } catch {
        // no-op: skip malformed candidate
      }
    }

    pushCandidate(cert.slaveCertificateIndex, 'slave-certificate-index')

    if (
      cert.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.algorithm.includes(id_pkcs_1)
    ) {
      const rsaPubKey = AsnConvert.parse(
        cert.certificate.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey,
        RSAPublicKey,
      )
      const modulusBytes = new Uint8Array(rsaPubKey.modulus)
      const unpaddedModulus = modulusBytes[0] === 0x00 ? modulusBytes.subarray(1) : modulusBytes
      const exponentBytes = new Uint8Array(rsaPubKey.publicExponent)
      const rsaPublicKeyDer = new Uint8Array(AsnConvert.serialize(rsaPubKey))
      const subjectPublicKeyBytes = new Uint8Array(
        cert.certificate.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey,
      )

      if (unpaddedModulus.length >= 5 * 24) {
        pushCandidate(hashPacked(unpaddedModulus), 'rsa-modulus-unpadded')
      }

      const paddedModulus =
        modulusBytes[0] === 0x00
          ? modulusBytes
          : new Uint8Array([0x00, ...Array.from(unpaddedModulus)])
      if (paddedModulus.length >= 5 * 24) {
        pushCandidate(hashPacked(paddedModulus), 'rsa-modulus-asn1-padded')
      }

      // Some dispatcher implementations derive certificate key from RSA public key
      // structures that also include exponent bytes, not just modulus.
      const modulusPlusExponent = new Uint8Array([
        ...Array.from(unpaddedModulus),
        ...Array.from(exponentBytes),
      ])
      if (modulusPlusExponent.length >= 5 * 24) {
        pushCandidate(hashPacked(modulusPlusExponent), 'rsa-modulus-plus-exponent')
      }

      if (rsaPublicKeyDer.length >= 5 * 24) {
        pushCandidate(hashPacked(rsaPublicKeyDer), 'rsa-public-key-der')
      }

      if (subjectPublicKeyBytes.length >= 5 * 24) {
        pushCandidate(hashPacked(subjectPublicKeyBytes), 'rsa-subject-public-key-bitstring')
      }
    }

    const deduped = new Map<string, { key: string; source: string }>()
    candidates.forEach(candidate => {
      if (!deduped.has(candidate.key)) {
        deduped.set(candidate.key, candidate)
      }
    })

    return Array.from(deduped.values())
  }

  private static resolveCertificateDispatcherSelection(params: {
    cert: ExtendedCertificate
    masterCert: Certificate
  }): CertificateDispatcherSelection {
    const { cert, masterCert } = params
    const masterSubjPubKeyAlg = masterCert.tbsCertificate.subjectPublicKeyInfo.algorithm.algorithm

    if (masterSubjPubKeyAlg.includes(id_pkcs_1)) {
      const bits = (() => {
        const pubKey = extractPubKey(cert.certificate.tbsCertificate.subjectPublicKeyInfo)

        if (pubKey instanceof RSAPublicKey) {
          const pubKeyModulusBytes = new Uint8Array(pubKey.modulus)

          const unpaddedRsaPubKey =
            pubKeyModulusBytes[0] === 0x00 ? pubKeyModulusBytes.subarray(1) : pubKeyModulusBytes

          return unpaddedRsaPubKey.byteLength * 8
        }

        const rawPoint = new Uint8Array([...toBeArray(pubKey.px), ...toBeArray(pubKey.py)])

        return rawPoint.byteLength * 8
      })()

      let dispatcherName = `C_RSA`

      const circuitHashAlgorithmDecision = RegistrationStrategy.getCircuitHashAlgorithm({
        cert,
        publicKeyAlgorithm: 'RSA',
        publicKeySizeBits: bits,
      })
      const circuitHashAlgorithm = circuitHashAlgorithmDecision.hashAlgorithm

      if (circuitHashAlgorithm) {
        dispatcherName += `_${circuitHashAlgorithm}`
      }

      dispatcherName += `_${bits}`

      const masterRsaPubKey = extractPubKey(masterCert.tbsCertificate.subjectPublicKeyInfo)
      if (masterRsaPubKey instanceof RSAPublicKey) {
        const masterExponent = Number(toBigInt(new Uint8Array(masterRsaPubKey.publicExponent)))
        if (Number.isFinite(masterExponent) && masterExponent > 0 && masterExponent !== 65537) {
          dispatcherName += `_${masterExponent}`
        }

        return {
          dispatcherName,
          publicKeyAlgorithm: 'RSA',
          publicKeySizeBits: bits,
          pathId: circuitHashAlgorithmDecision.pathId,
          pathDescription: circuitHashAlgorithmDecision.pathDescription,
          dataSizeClass: circuitHashAlgorithmDecision.dataSizeClass,
          masterPublicExponent: masterExponent,
        }
      }

      return {
        dispatcherName,
        publicKeyAlgorithm: 'RSA',
        publicKeySizeBits: bits,
        pathId: circuitHashAlgorithmDecision.pathId,
        pathDescription: circuitHashAlgorithmDecision.pathDescription,
        dataSizeClass: circuitHashAlgorithmDecision.dataSizeClass,
        masterPublicExponent: null,
      }
    }

    if (masterSubjPubKeyAlg.includes(ECDSA_ALGO_PREFIX)) {
      if (!masterCert.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters) {
        throw new TypeError('Master ECDSA public key does not have parameters')
      }

      if (!cert.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters) {
        throw new TypeError('Slave ECDSA public key does not have parameters')
      }

      const masterEcParameters = AsnConvert.parse(
        masterCert.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters,
        ECParameters,
      )

      const slaveEcParameters = AsnConvert.parse(
        cert.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters,
        ECParameters,
      )

      const [, , masterCertCurveName] = getPublicKeyFromEcParameters(
        masterEcParameters,
        new Uint8Array(masterCert.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey),
      )

      const [slaveCertPubKey] = getPublicKeyFromEcParameters(
        slaveEcParameters,
        new Uint8Array(cert.certificate.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey),
      )

      const pubKeyBytes = new Uint8Array([
        ...toBeArray(slaveCertPubKey.px),
        ...toBeArray(slaveCertPubKey.py),
      ])

      const bits = pubKeyBytes.length * 8

      let dispatcherName = `C_ECDSA_${masterCertCurveName}`

      const circuitHashAlgorithmDecision = RegistrationStrategy.getCircuitHashAlgorithm({
        cert,
        publicKeyAlgorithm: 'ECDSA',
        publicKeySizeBits: bits,
      })
      const circuitHashAlgorithm = circuitHashAlgorithmDecision.hashAlgorithm

      if (circuitHashAlgorithm) {
        dispatcherName += `_${circuitHashAlgorithm}`
      }

      dispatcherName += `_${bits}`

      return {
        dispatcherName,
        publicKeyAlgorithm: 'ECDSA',
        publicKeySizeBits: bits,
        pathId: circuitHashAlgorithmDecision.pathId,
        pathDescription: circuitHashAlgorithmDecision.pathDescription,
        dataSizeClass: circuitHashAlgorithmDecision.dataSizeClass,
        masterPublicExponent: null,
      }
    }

    throw new Error(`unsupported public key type: ${masterSubjPubKeyAlg}`)
  }

  private static async getDispatcherDerivedProofCandidate(params: {
    cert: ExtendedCertificate
    masterCert: Certificate
  }): Promise<{ source: string; key: string; proof: SparseMerkleTree.ProofStructOutput } | null> {
    const { cert, masterCert } = params
    const dispatcherSelection = RegistrationStrategy.resolveCertificateDispatcherSelection({
      cert,
      masterCert,
    })

    const dispatcherAddress = await RegistrationStrategy.getCertificateDispatcherAddress(
      dispatcherSelection.dispatcherName,
    )

    if (dispatcherAddress === '0x0000000000000000000000000000000000000000') {
      return null
    }

    const dispatcherContract = new Contract(
      dispatcherAddress,
      [
        'function getCertificatePublicKey(bytes,uint256) view returns (bytes)',
        'function getCertificateKey(bytes) view returns (uint256)',
      ],
      RegistrationStrategy.rmoEvmJsonRpcProvider,
    )

    const signedAttributes = new Uint8Array(AsnConvert.serialize(cert.certificate.tbsCertificate))
    const certificatePublicKey = await dispatcherContract.getCertificatePublicKey(
      signedAttributes,
      cert.slaveCertPubKeyOffset,
    )
    const certificateKey = await dispatcherContract.getCertificateKey(certificatePublicKey)
    const keyAsBytes32 = zeroPadValue(toBeArray(certificateKey), 32)
    const proof =
      await RegistrationStrategy.certPoseidonSMTContract.contractInstance.getProof(keyAsBytes32)

    return {
      source: `dispatcher-derived:${dispatcherSelection.dispatcherName}`,
      key: keyAsBytes32,
      proof,
    }
  }

  public static getSlaveCertSmtProof = async (
    cert: ExtendedCertificate,
    masterCert?: Certificate,
  ) => {
    const candidates = RegistrationStrategy.buildSlaveCertProofLookupCandidates(cert)
    const probeResults: Array<{ source: string; existence: boolean }> = []
    let fallbackProof: SparseMerkleTree.ProofStructOutput | null = null

    for (const candidate of candidates) {
      const proof = await RegistrationStrategy.certPoseidonSMTContract.contractInstance.getProof(
        candidate.key,
      )

      probeResults.push({
        source: candidate.source,
        existence: proof.existence,
      })

      if (!fallbackProof) {
        fallbackProof = proof
      }

      if (proof.existence) {
        logIdentityDiagnostic('IdentityProof', 'slaveCertSmtProof:inclusion-proof-found', {
          source: candidate.source,
          probeResults,
        })

        if (candidate.source !== 'slave-certificate-index') {
          logIdentityDiagnostic('IdentityProof', 'slaveCertSmtProof:alternate-key-selected', {
            source: candidate.source,
            probeResults,
          })
        }

        return proof
      }
    }

    if (masterCert) {
      try {
        const dispatcherDerivedCandidate =
          await RegistrationStrategy.getDispatcherDerivedProofCandidate({
            cert,
            masterCert,
          })

        if (dispatcherDerivedCandidate) {
          probeResults.push({
            source: dispatcherDerivedCandidate.source,
            existence: dispatcherDerivedCandidate.proof.existence,
          })

          if (dispatcherDerivedCandidate.proof.existence) {
            logIdentityDiagnostic('IdentityProof', 'slaveCertSmtProof:inclusion-proof-found', {
              source: dispatcherDerivedCandidate.source,
              probeResults,
            })
            logIdentityDiagnostic('IdentityProof', 'slaveCertSmtProof:alternate-key-selected', {
              source: dispatcherDerivedCandidate.source,
              probeResults,
            })

            return dispatcherDerivedCandidate.proof
          }
        }
      } catch (error) {
        logIdentityDiagnosticError({
          domain: 'IdentityProof',
          event: 'slaveCertSmtProof:dispatcher-derived-candidate-failed',
          stage: 'slave-proof-dispatcher-derived-key',
          classification: 'UNKNOWN_IDENTITY_CREATION_FAILURE',
          error,
          context: {
            candidateSources: candidates.map(candidate => candidate.source),
          },
        })
      }
    }

    logIdentityDiagnostic('IdentityProof', 'slaveCertSmtProof:no-inclusion-proof', {
      candidateCount: probeResults.length,
      probeResults,
    })

    if (fallbackProof) return fallbackProof

    return RegistrationStrategy.certPoseidonSMTContract.contractInstance.getProof(
      zeroPadValue(cert.slaveCertificateIndex, 32),
    )
  }

  public static getDefaultCircuitHashAlgorithm(certificate: Certificate): string {
    switch (certificate.signatureAlgorithm.algorithm) {
      case id_sha1WithRSAEncryption:
      case id_ecdsaWithSHA1:
        return 'SHA1'
      // TODO: need to check
      case id_RSASSA_PSS:
        if (!certificate.signatureAlgorithm.parameters)
          throw new Error('RSASSA-PSS parameters are missing')

        // eslint-disable-next-line no-case-declarations
        const rsaSaPssParams = AsnConvert.parse(
          certificate.signatureAlgorithm.parameters,
          RsaSaPssParams,
        )

        if (
          rsaSaPssParams.hashAlgorithm.algorithm === id_sha256 &&
          rsaSaPssParams.saltLength === 32
        ) {
          return 'SHA2'
        }

        if (
          rsaSaPssParams.hashAlgorithm.algorithm === id_sha384 &&
          rsaSaPssParams.saltLength === 48
        ) {
          return 'SHA384'
        }

        if (
          rsaSaPssParams.hashAlgorithm.algorithm === id_sha512 &&
          rsaSaPssParams.saltLength === 64
        ) {
          return 'SHA384'
        }

        throw new Error('Unsupported RSASSA-PSS parameters')
      case id_sha256WithRSAEncryption:
        return ''
      case id_ecdsaWithSHA256:
        return 'SHA2'
      case id_sha384WithRSAEncryption:
      case id_ecdsaWithSHA384:
        return 'SHA384'
      case id_sha512WithRSAEncryption:
      case id_ecdsaWithSHA512:
        return 'SHA512'
      default:
        return ''
    }
  }

  private static buildPassportRegistrationProfile(params: {
    cert: ExtendedCertificate
    publicKeyAlgorithm: PassportRegistrationPublicKeyAlgorithm
    publicKeySizeBits: number
  }): PassportRegistrationProfile {
    return {
      chainId: String(Config.RMO_CHAIN_ID),
      publicKeyAlgorithm: params.publicKeyAlgorithm,
      publicKeySizeBits: params.publicKeySizeBits,
      signatureAlgorithmOid: params.cert.certificate.signatureAlgorithm.algorithm,
    }
  }

  public static getCircuitHashAlgorithm(params: {
    cert: ExtendedCertificate
    publicKeyAlgorithm: PassportRegistrationPublicKeyAlgorithm
    publicKeySizeBits: number
  }): {
    hashAlgorithm: string
    pathId: string
    pathDescription: string
    dataSizeClass: string
  } {
    const profile = RegistrationStrategy.buildPassportRegistrationProfile(params)
    const pathDecision = resolvePassportRegistrationPath(profile)
    const defaultHashAlgorithm = RegistrationStrategy.getDefaultCircuitHashAlgorithm(
      params.cert.certificate,
    )
    const resolvedHashAlgorithm =
      pathDecision.dispatcherHashAlgorithmOverride ?? defaultHashAlgorithm

    return {
      hashAlgorithm: resolvedHashAlgorithm,
      pathId: pathDecision.pathId,
      pathDescription: pathDecision.description,
      dataSizeClass: pathDecision.dataSizeClass,
    }
  }

  private static async getCertificateDispatcherAddress(dispatcherName: string): Promise<string> {
    const contract = new Contract(
      Config.REGISTRATION_CONTRACT_ADDRESS,
      ['function certificateDispatchers(bytes32) view returns (address)'],
      RegistrationStrategy.rmoEvmJsonRpcProvider,
    )
    const dispatcherTypeHash = keccak256(Buffer.from(dispatcherName, 'utf-8'))

    return contract.certificateDispatchers(dispatcherTypeHash)
  }

  private static extractRelayerErrors(axiosError: AxiosError): string[] {
    const responseData = axiosError.response?.data

    if (!responseData || typeof responseData !== 'object') {
      return []
    }

    const errors = (responseData as { errors?: unknown }).errors

    if (!Array.isArray(errors)) {
      return []
    }

    return errors
      .map(entry => {
        if (!entry || typeof entry !== 'object') return null

        const asRecord = entry as { title?: unknown; status?: unknown; detail?: unknown }
        const title = typeof asRecord.title === 'string' ? asRecord.title : 'RelayerError'
        const status = typeof asRecord.status === 'string' ? asRecord.status : ''
        const detail = typeof asRecord.detail === 'string' ? asRecord.detail : ''

        return [title, status && `status=${status}`, detail].filter(Boolean).join(' | ')
      })
      .filter((value): value is string => Boolean(value))
  }

  private static extractEvmRevertDetails(error: unknown): string[] {
    if (!error || typeof error !== 'object') return []

    const raw = error as {
      shortMessage?: unknown
      reason?: unknown
      data?: unknown
      errorName?: unknown
      code?: unknown
      message?: unknown
    }

    const details: string[] = []
    const maybePush = (value: unknown, label?: string) => {
      if (typeof value !== 'string' || !value.trim()) return
      details.push(label ? `${label}: ${value}` : value)
    }

    maybePush(raw.shortMessage, 'shortMessage')
    maybePush(raw.reason, 'reason')
    maybePush(raw.errorName, 'errorName')
    maybePush(raw.code, 'code')
    maybePush(raw.message, 'message')

    if (typeof raw.data === 'string') {
      maybePush(raw.data, 'revertData')
      try {
        const parsed = RegistrationStrategy.registrationContractInterface.parseError(raw.data)
        if (parsed?.name) {
          details.push(`decodedError: ${parsed.name}`)
        }
      } catch {
        // no-op: not a known custom error in this ABI
      }
    }

    return Array.from(new Set(details))
  }

  private static isCertificateAlreadyRegisteredError(error: unknown): boolean {
    const normalized = JSON.stringify(error).toLowerCase()

    return (
      normalized.includes('the key already exists') ||
      normalized.includes('sparsemerkletree: the key already exists')
    )
  }

  public static buildRegisterCertCallData = async (
    CSCABytes: ArrayBuffer[],
    cert: ExtendedCertificate,
    masterCert: Certificate,
  ) => {
    // DEBUG: Log the computed ICAO root
    const computedRoot = buildCertTreeRoot(CSCABytes)
    console.log('[ICAO DEBUG] Number of certificates:', CSCABytes.length)
    console.log('[ICAO DEBUG] Computed ICAO root from rn-csca:', computedRoot)

    const inclusionProofSiblings = buildCertTreeAndGenProof(
      CSCABytes,
      AsnConvert.serialize(masterCert),
    )

    if (inclusionProofSiblings.length === 0) {
      throw new TypeError('failed to generate inclusion proof')
    }

    const dispatcherSelection = RegistrationStrategy.resolveCertificateDispatcherSelection({
      cert,
      masterCert,
    })

    const dispatcherAddress = await RegistrationStrategy.getCertificateDispatcherAddress(
      dispatcherSelection.dispatcherName,
    )
    const hasDispatcher = dispatcherAddress !== '0x0000000000000000000000000000000000000000'

    logIdentityDiagnostic(
      'IdentityProof',
      'RegistrationStrategy.registerCertificate:dispatcher-selected',
      {
        dispatcherName: dispatcherSelection.dispatcherName,
        dispatcherAddress,
        hasDispatcher,
        pathId: dispatcherSelection.pathId,
        pathDescription: dispatcherSelection.pathDescription,
        dataSizeClass: dispatcherSelection.dataSizeClass,
        chainId: String(Config.RMO_CHAIN_ID),
        signatureAlgorithmOid: cert.certificate.signatureAlgorithm.algorithm,
        publicKeyAlgorithm: dispatcherSelection.publicKeyAlgorithm,
        publicKeySizeBits: dispatcherSelection.publicKeySizeBits,
        masterPublicExponent: dispatcherSelection.masterPublicExponent,
      },
    )

    if (!hasDispatcher) {
      throw new Error(
        `No certificate dispatcher for ${dispatcherSelection.dispatcherName} on chain ${String(Config.RMO_CHAIN_ID)}`,
      )
    }

    const dispatcherHash = getBytes(
      keccak256(Buffer.from(dispatcherSelection.dispatcherName, 'utf-8')),
    )

    const certificate: Registration2.CertificateStruct = {
      dataType: dispatcherHash,
      signedAttributes: new Uint8Array(AsnConvert.serialize(cert.certificate.tbsCertificate)),
      keyOffset: cert.slaveCertPubKeyOffset,
      expirationOffset: cert.slaveCertExpOffset,
    }
    const icaoMember: Registration2.ICAOMemberStruct = {
      signature: cert.getSlaveCertIcaoMemberSignature(masterCert),
      publicKey: Sod.getSlaveCertIcaoMemberKey(masterCert),
    }

    // Use manual ABI encoding to work around Hermes typed-array corruption
    // in ethers.js's ABI coder (offset/length words get nibble-swapped).
    return manualEncodeRegisterCertificate(
      hexlify(dispatcherHash),
      certificate.signedAttributes as Uint8Array,
      Number(cert.slaveCertPubKeyOffset),
      Number(cert.slaveCertExpOffset),
      icaoMember.signature as Uint8Array,
      icaoMember.publicKey as Uint8Array,
      inclusionProofSiblings.map(el => new Uint8Array(Buffer.from(el, 'hex'))),
    )
  }

  public static registerCertificate = async (
    CSCABytes: ArrayBuffer[],
    cert: ExtendedCertificate,
    slaveMaster: Certificate,
  ) => {
    let stage = 'register-certificate-build-call-data'

    logIdentityDiagnostic('IdentityProof', 'RegistrationStrategy.registerCertificate:start', {
      cscaCertificateCount: CSCABytes.length,
      hasSlaveCertificateIndex: Boolean(cert.slaveCertificateIndex),
    })

    try {
      const callData = await RegistrationStrategy.buildRegisterCertCallData(
        CSCABytes,
        cert,
        slaveMaster,
      )
      logIdentityDiagnostic(
        'IdentityProof',
        'RegistrationStrategy.registerCertificate:call-data-built',
        {
          callDataLength: callData.length,
        },
      )

      stage = 'register-certificate-preflight-call'
      await RegistrationStrategy.rmoEvmJsonRpcProvider.call({
        to: Config.REGISTRATION_CONTRACT_ADDRESS,
        data: callData,
      })
      logIdentityDiagnostic(
        'IdentityProof',
        'RegistrationStrategy.registerCertificate:preflight-call-success',
      )

      stage = 'register-certificate-relayer-request'
      const { data } = await relayerRegister(callData, Config.REGISTRATION_CONTRACT_ADDRESS)

      const txHash = extractRelayerTxHash(data)

      logIdentityDiagnostic(
        'IdentityProof',
        'RegistrationStrategy.registerCertificate:relayer-accepted',
        {
          hasTxHash: Boolean(txHash),
        },
      )

      stage = 'register-certificate-transaction-lookup'
      const tx = await RegistrationStrategy.rmoEvmJsonRpcProvider.getTransaction(txHash)

      if (!tx) throw new TypeError('Transaction not found')

      stage = 'register-certificate-transaction-wait'
      await tx.wait()
      logIdentityDiagnostic(
        'IdentityProof',
        'RegistrationStrategy.registerCertificate:transaction-confirmed',
      )
    } catch (error) {
      const axiosError = error as AxiosError
      const relayerErrorDetails = RegistrationStrategy.extractRelayerErrors(axiosError)
      const evmRevertDetails = RegistrationStrategy.extractEvmRevertDetails(error)
      if (RegistrationStrategy.isCertificateAlreadyRegisteredError(error)) {
        logIdentityDiagnostic(
          'IdentityProof',
          'RegistrationStrategy.registerCertificate:already-registered',
        )
        return
      }

      const classification = classifyIdentityCreationError({
        stage,
        error: axiosError,
      })
      logIdentityDiagnosticError({
        domain: 'IdentityProof',
        event: 'RegistrationStrategy.registerCertificate:failed',
        stage,
        classification,
        error: axiosError,
        context: {
          cscaCertificateCount: CSCABytes.length,
          relayerErrorDetails,
          evmRevertDetails,
        },
      })

      throw axiosError
    }
  }

  public static retrieveCSCAFromPem = async (): Promise<ArrayBuffer[]> => {
    const [CSCAPemAsset] = await Asset.loadAsync(require('@assets/certificates/master_000316.pem'))

    if (!CSCAPemAsset.localUri) throw new Error('CSCA cert asset local URI is not available')

    const CSCAPemFileInfo = await FileSystem.getInfoAsync(CSCAPemAsset.localUri)

    if (!CSCAPemFileInfo.exists) throw new Error('CSCA cert file does not exist')

    const CSCAPemFileContent = await FileSystem.readAsStringAsync(CSCAPemFileInfo.uri, {
      encoding: FileSystem.EncodingType.UTF8,
    })

    const parsed = parsePemString(CSCAPemFileContent)
    logIdentityDiagnostic('PassportVerification', 'retrieveCSCAFromPem:parsed', {
      certificateCount: parsed.length,
    })

    return parsed
  }

  public static async requestRelayerRegisterMethod(registerCallData: string): Promise<void> {
    let stage = 'register-relayer-request'

    logIdentityDiagnostic('IdentityProof', 'requestRelayerRegisterMethod:start', {
      callDataLength: registerCallData.length,
    })

    try {
      const { data } = await relayerRegister(registerCallData, Config.REGISTRATION_CONTRACT_ADDRESS)

      const txHash = extractRelayerTxHash(data)

      logIdentityDiagnostic('IdentityProof', 'requestRelayerRegisterMethod:relayer-accepted', {
        hasTxHash: Boolean(txHash),
      })

      stage = 'register-transaction-lookup'
      const tx = await RegistrationStrategy.rmoEvmJsonRpcProvider.getTransaction(txHash)

      if (!tx) throw new TypeError('Transaction not found')

      stage = 'register-transaction-wait'
      await tx.wait()
      logIdentityDiagnostic('IdentityProof', 'requestRelayerRegisterMethod:transaction-confirmed')
    } catch (error) {
      const relayerErrorDetails =
        error instanceof AxiosError ? RegistrationStrategy.extractRelayerErrors(error) : []
      const classification = classifyIdentityCreationError({
        stage,
        error,
      })
      logIdentityDiagnosticError({
        domain: 'IdentityProof',
        event: 'requestRelayerRegisterMethod:failed',
        stage,
        classification,
        error,
        context: {
          callDataLength: registerCallData.length,
          relayerErrorDetails,
        },
      })

      throw error
    }
  }

  public async buildRegisterCallData(
    // eslint-disable-next-line unused-imports/no-unused-vars
    identityItem: IdentityItem,
    // eslint-disable-next-line unused-imports/no-unused-vars
    slaveCertSmtProof: SparseMerkleTree.ProofStructOutput,
    // eslint-disable-next-line unused-imports/no-unused-vars
    isRevoked: boolean,
  ): Promise<string> {
    throw new Error('Override this method in a subclass')
  }

  public createIdentity = async (
    // eslint-disable-next-line unused-imports/no-unused-vars
    eDocument: EDocument,
    // eslint-disable-next-line unused-imports/no-unused-vars
    privateKey: string,
    // eslint-disable-next-line unused-imports/no-unused-vars
    publicKeyHash: Uint8Array,
  ): Promise<IdentityItem> => {
    throw new Error('Override this method in a subclass')
  }

  public revokeIdentity = async (
    // eslint-disable-next-line unused-imports/no-unused-vars
    tempMRZ: FieldRecords,
    // eslint-disable-next-line unused-imports/no-unused-vars
    currentIdentityItem: IdentityItem,
    // eslint-disable-next-line unused-imports/no-unused-vars
    scanDocument: (
      documentCode: string,
      bacKeyParameters: {
        dateOfBirth: string
        dateOfExpiry: string
        documentNumber: string
      },
      challenge: Uint8Array,
    ) => Promise<EDocument>,
    _passportInfo?: PassportInfo | null,
    _slaveCertSmtProof?: SparseMerkleTree.ProofStructOutput,
  ): Promise<IdentityItem> => {
    throw new TypeError('Implement revokeIdentity method in subclass')
  }
}
