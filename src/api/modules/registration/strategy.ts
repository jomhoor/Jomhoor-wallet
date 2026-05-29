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
  encodeBytes32String,
  getBytes,
  JsonRpcProvider,
  keccak256,
  toBeArray,
  zeroPadValue,
} from 'ethers'
import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system'
import { FieldRecords } from 'mrz'

import { RARIMO_CHAINS } from '@/api/modules/rarimo/constants'
import { relayerRegister } from '@/api/modules/registration/relayer'
import { Config } from '@/config'
import { createPoseidonSMTContract } from '@/helpers/contracts'
import {
  classifyIdentityCreationError,
  logIdentityDiagnostic,
  logIdentityDiagnosticError,
} from '@/helpers/identity-proof-diagnostics'
import { CertificateAlreadyRegisteredError } from '@/store/modules/identity/errors'
import { IdentityItem } from '@/store/modules/identity/Identity'
import { Registration__factory } from '@/types/contracts/factories/Registration__factory'
import { SparseMerkleTree } from '@/types/contracts/PoseidonSMT'
import { Registration2 } from '@/types/contracts/Registration'
import { StateKeeper } from '@/types/contracts/StateKeeper'
import { EDocument } from '@/utils/e-document/e-document'
import { ExtendedCertificate } from '@/utils/e-document/extended-cert'
import { getPublicKeyFromEcParameters } from '@/utils/e-document/helpers/crypto'
import { extractPubKey } from '@/utils/e-document/helpers/misc'
import { ECDSA_ALGO_PREFIX, Sod } from '@/utils/e-document/sod'

export type PassportInfo = {
  passportInfo_: StateKeeper.PassportInfoStructOutput
  identityInfo_: StateKeeper.IdentityInfoStructOutput
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

  public static getSlaveCertSmtProof = async (cert: ExtendedCertificate) => {
    return RegistrationStrategy.certPoseidonSMTContract.contractInstance.getProof(
      zeroPadValue(cert.slaveCertificateIndex, 32),
    )
  }

  public static getCircuitHashAlgorithm(certificate: Certificate): string {
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
      // WORKAROUND (March 2026): Rarimo mainnet has SHA1↔SHA256 RSA signers swapped.
      // C_RSA_SHA1_2048 dispatcher's signer actually does SHA256 verification.
      // C_RSA_2048 dispatcher's signer actually does SHA1 verification.
      // So for sha256WithRSAEncryption we return 'SHA1' to hit the SHA256 signer.
      // TODO: Remove this workaround once Rarimo fixes the signer assignment.
      // See: check-all-dispatchers.js and verify-dispatcher-swap.js for on-chain proof.
      case id_sha256WithRSAEncryption:
        return 'SHA1'
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

    const dispatcherName = (() => {
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

        const circuitHashAlgorithm = RegistrationStrategy.getCircuitHashAlgorithm(cert.certificate)
        if (circuitHashAlgorithm) {
          dispatcherName += `_${circuitHashAlgorithm}`
        }

        dispatcherName += `_${bits}`

        return dispatcherName
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

        const circuitHashAlgorithm = RegistrationStrategy.getCircuitHashAlgorithm(cert.certificate)
        if (circuitHashAlgorithm) {
          dispatcherName += `_${circuitHashAlgorithm}`
        }

        dispatcherName += `_${bits}`

        return dispatcherName
      }

      throw new Error(`unsupported public key type: ${masterSubjPubKeyAlg}`)
    })()

    const dispatcherHash = getBytes(keccak256(Buffer.from(dispatcherName, 'utf-8')))

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

    return RegistrationStrategy.registrationContractInterface.encodeFunctionData(
      'registerCertificate',
      [certificate, icaoMember, inclusionProofSiblings.map(el => Buffer.from(el, 'hex'))],
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

      stage = 'register-certificate-relayer-request'
      const { data } = await relayerRegister(callData, Config.REGISTRATION_CONTRACT_ADDRESS)
      logIdentityDiagnostic(
        'IdentityProof',
        'RegistrationStrategy.registerCertificate:relayer-accepted',
        {
          hasTxHash: Boolean(data?.tx_hash),
        },
      )

      stage = 'register-certificate-transaction-lookup'
      const tx = await RegistrationStrategy.rmoEvmJsonRpcProvider.getTransaction(data.tx_hash)

      if (!tx) throw new TypeError('Transaction not found')

      stage = 'register-certificate-transaction-wait'
      await tx.wait()
      logIdentityDiagnostic(
        'IdentityProof',
        'RegistrationStrategy.registerCertificate:transaction-confirmed',
      )
    } catch (error) {
      const axiosError = error as AxiosError

      const stringifiedError = JSON.stringify(axiosError.response?.data)

      if (
        stringifiedError?.includes('the key already exists') &&
        // TODO: remove once contracts got fixed
        stringifiedError?.includes('code = Unknown desc = execution reverted')
      ) {
        throw new CertificateAlreadyRegisteredError()
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
      logIdentityDiagnostic('IdentityProof', 'requestRelayerRegisterMethod:relayer-accepted', {
        hasTxHash: Boolean(data?.tx_hash),
      })

      stage = 'register-transaction-lookup'
      const tx = await RegistrationStrategy.rmoEvmJsonRpcProvider.getTransaction(data.tx_hash)

      if (!tx) throw new TypeError('Transaction not found')

      stage = 'register-transaction-wait'
      await tx.wait()
      logIdentityDiagnostic('IdentityProof', 'requestRelayerRegisterMethod:transaction-confirmed')
    } catch (error) {
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
