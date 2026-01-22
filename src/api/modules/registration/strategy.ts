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
  Interface,
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
    const key = zeroPadValue(cert.slaveCertificateIndex, 32)
    console.log('[getSlaveCertSmtProof] Looking up key:', key)
    const proof = await RegistrationStrategy.certPoseidonSMTContract.contractInstance.getProof(key)
    console.log('[getSlaveCertSmtProof] Proof existence:', proof.existence, 'root:', proof.root)
    console.log('[getSlaveCertSmtProof] Siblings count:', proof.siblings?.length ?? 0)
    console.log('[getSlaveCertSmtProof] First 5 siblings:', proof.siblings?.slice(0, 5))
    console.log(
      '[getSlaveCertSmtProof] Non-zero siblings count:',
      proof.siblings?.filter(
        (s: string) =>
          s !== '0x0000000000000000000000000000000000000000000000000000000000000000' && s !== '0',
      ).length ?? 0,
    )
    return proof
  }

  /**
   * Add a synthetic root to the PoseidonSMTMock contract for local testing.
   * This is required for Noir ECDSA passports where the circuit computes pk_hash differently
   * than the on-chain SMT. The synthetic root must be marked as valid before the registration
   * transaction is submitted.
   *
   * NOTE: This only works on local Hardhat with PoseidonSMTMock deployed.
   * On mainnet/testnet, this will fail (and shouldn't be called).
   *
   * @param syntheticRoot The synthetic SMT root computed for Noir circuit
   */
  public static addSyntheticRootToMockSMT = async (syntheticRoot: string): Promise<void> => {
    console.log('[addSyntheticRootToMockSMT] Adding synthetic root to mock SMT:', syntheticRoot)

    // Check if we're on a local chain (31337 is Hardhat's chain ID)
    if (Config.RMO_CHAIN_ID !== 31337) {
      console.log('[addSyntheticRootToMockSMT] Not on local chain, skipping mock root addition')
      return
    }

    try {
      // Encode the mockRoot(bytes32) function call
      const mockSMTInterface = new Interface(['function mockRoot(bytes32 newRoot_) external'])
      const calldata = mockSMTInterface.encodeFunctionData('mockRoot', [syntheticRoot])

      // Get the funded Hardhat account to send the transaction
      // Account #0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
      const hardhatSigner = {
        address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      }

      // Send transaction directly via JSON-RPC
      const provider = RegistrationStrategy.rmoEvmJsonRpcProvider
      const nonce = await provider.getTransactionCount(hardhatSigner.address)

      const tx = {
        to: Config.CERT_POSEIDON_SMT_CONTRACT_ADDRESS,
        from: hardhatSigner.address,
        data: calldata,
        nonce,
        gasLimit: 100000,
      }

      // Use eth_sendTransaction with impersonation for local testing
      const txHash = await provider.send('eth_sendTransaction', [tx])
      console.log('[addSyntheticRootToMockSMT] Transaction submitted:', txHash)

      // Wait for confirmation
      const receipt = await provider.waitForTransaction(txHash)
      console.log('[addSyntheticRootToMockSMT] Transaction confirmed, status:', receipt?.status)
    } catch (error) {
      console.error('[addSyntheticRootToMockSMT] Failed to add synthetic root:', error)
      // Don't throw - this is best-effort for local testing
      // On mainnet the synthetic root approach won't work anyway
    }
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
    // DEBUG: Log the computed ICAO root from the library
    const computedRoot = buildCertTreeRoot(CSCABytes)
    console.log('[ICAO DEBUG] Number of certificates:', CSCABytes.length)
    console.log('[ICAO DEBUG] Computed ICAO root from rn-csca:', computedRoot)
    console.log(
      '[ICAO DEBUG] Expected on-chain root: 0x8aebf998f59217b9031787c29c6ea8db762e58ccc45146bc1218bbcabc8fd775',
    )

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

        // Uppercase the curve name to match contract dispatcher naming convention
        let dispatcherName = `C_ECDSA_${masterCertCurveName.toUpperCase()}`

        const circuitHashAlgorithm = RegistrationStrategy.getCircuitHashAlgorithm(cert.certificate)
        if (circuitHashAlgorithm) {
          dispatcherName += `_${circuitHashAlgorithm}`
        }

        dispatcherName += `_${bits}`

        console.log('[Dispatcher] ECDSA dispatcher name:', dispatcherName)
        return dispatcherName
      }

      throw new Error(`unsupported public key type: ${masterSubjPubKeyAlg}`)
    })()

    console.log('[Dispatcher] Final dispatcher name:', dispatcherName)
    const dispatcherHash = getBytes(keccak256(Buffer.from(dispatcherName, 'utf-8')))
    console.log('[Dispatcher] Dispatcher hash:', Buffer.from(dispatcherHash).toString('hex'))

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
    try {
      const callData = await RegistrationStrategy.buildRegisterCertCallData(
        CSCABytes,
        cert,
        slaveMaster,
      )

      console.log('[registerCertificate] Submitting to relayer...')
      const { data } = await relayerRegister(callData, Config.REGISTRATION_CONTRACT_ADDRESS)
      console.log('[registerCertificate] Relayer responded with tx_hash:', data.tx_hash)

      const tx = await RegistrationStrategy.rmoEvmJsonRpcProvider.getTransaction(data.tx_hash)

      if (!tx) throw new TypeError('Transaction not found')

      console.log('[registerCertificate] Waiting for transaction confirmation...')
      await tx.wait()
      console.log('[registerCertificate] Certificate registered successfully!')
    } catch (error) {
      const axiosError = error as AxiosError

      const stringifiedError = JSON.stringify(axiosError.response?.data)
      console.log('[registerCertificate] Error:', stringifiedError || error)

      // Handle "certificate already registered" - this is expected when someone else
      // with the same DS certificate registered before us. One DS cert signs thousands
      // of passports, so KeyAlreadyExists is a success case - just skip to identity registration.
      if (
        stringifiedError?.includes('KeyAlreadyExists') ||
        stringifiedError?.includes('the key already exists')
      ) {
        throw new CertificateAlreadyRegisteredError()
      }

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

    return parsePemString(CSCAPemFileContent)
  }

  public static async requestRelayerRegisterMethod(registerCallData: string): Promise<void> {
    const { data } = await relayerRegister(registerCallData, Config.REGISTRATION_CONTRACT_ADDRESS)

    const tx = await RegistrationStrategy.rmoEvmJsonRpcProvider.getTransaction(data.tx_hash)

    if (!tx) throw new TypeError('Transaction not found')

    await tx.wait()
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
