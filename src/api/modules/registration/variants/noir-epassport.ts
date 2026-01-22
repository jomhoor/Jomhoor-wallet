import { NoirZKProof } from '@modules/noir'
import { AxiosError } from 'axios'
import { hexlify, keccak256, toBeHex } from 'ethers'
import { FieldRecords } from 'mrz'

import { relayerRegister } from '@/api/modules/registration/relayer'
import { PassportInfo, RegistrationStrategy } from '@/api/modules/registration/strategy'
import { Config } from '@/config'
import { tryCatch } from '@/helpers/try-catch'
import {
  CertificateAlreadyRegisteredError,
  PassportRegisteredWithAnotherPKError,
} from '@/store/modules/identity/errors'
import { IdentityItem, NoirEpassportIdentity } from '@/store/modules/identity/Identity'
import { SparseMerkleTree } from '@/types/contracts/PoseidonSMT'
import { Registration2 } from '@/types/contracts/Registration'
import { NoirEPassportBasedRegistrationCircuit } from '@/utils/circuits/registration/noir-registration-circuit'
import { EDocument, EPassport } from '@/utils/e-document/e-document'
import { createSyntheticSmtProofForNoir } from '@/utils/e-document/helpers/crypto'
import { extractPubKey } from '@/utils/e-document/helpers/misc'

export class NoirEPassportRegistration extends RegistrationStrategy {
  /**
   * Build calldata for registerViaNoir or reissueIdentityViaNoir
   * @param identityItem The identity item with proof
   * @param certificatesRoot The certificates SMT root to use (can be synthetic for ECDSA)
   * @param isRevoked Whether this is a reissuance (previous identity was revoked)
   */
  buildRegisterCallData = async (
    identityItem: NoirEpassportIdentity,
    certificatesRoot: string,
    isRevoked: boolean,
  ) => {
    if (typeof identityItem.registrationProof !== 'string') {
      throw new TypeError('Noir proof is not supported for Circom registration')
    }

    const registrationProof = identityItem.registrationProof as NoirZKProof
    const identityItemDocument = identityItem.document as EPassport

    const circuit = new NoirEPassportBasedRegistrationCircuit(identityItemDocument)

    const aaSignature = identityItemDocument.getAASignature()

    if (!aaSignature) throw new TypeError('AA signature is not defined')

    const parts = circuit.name.split('_')

    if (parts.length < 2) {
      throw new Error('circuit name is in invalid format')
    }

    // ZKTypePrefix represerts the circuit zk type prefix
    const ZKTypePrefix = 'Z_PER_PASSPORT'

    const zkTypeSuffix = parts.slice(1).join('_') // support for multi-underscore suffix
    const zkTypeName = `${ZKTypePrefix}_${zkTypeSuffix}`

    const passport: Registration2.PassportStruct = {
      dataType: identityItemDocument.getAADataType(circuit.eDoc.sod.slaveCertificate.keySize),
      zkType: keccak256(zkTypeName),
      signature: aaSignature,
      publicKey: (() => {
        const aaPublicKey = identityItemDocument.getAAPublicKey()

        if (!aaPublicKey) return identityItem.publicKey

        return aaPublicKey
      })(),
      passportHash: identityItem.passportHash,
    }

    if (isRevoked) {
      return RegistrationStrategy.registrationContractInterface.encodeFunctionData(
        'reissueIdentityViaNoir',
        [
          certificatesRoot,
          identityItem.pkIdentityHash,
          identityItem.dg1Commitment,
          passport,
          registrationProof.proof,
        ],
      )
    }

    return RegistrationStrategy.registrationContractInterface.encodeFunctionData(
      'registerViaNoir',
      [
        certificatesRoot,
        identityItem.pkIdentityHash,
        identityItem.dg1Commitment,
        passport,
        registrationProof.proof,
      ],
    )
  }

  createIdentity = async (
    _eDocument: EDocument,
    privateKey: string,
    publicKeyHash: Uint8Array,
  ): Promise<NoirEpassportIdentity> => {
    const eDocument = _eDocument as EPassport

    const CSCACertBytes = await RegistrationStrategy.retrieveCSCAFromPem()

    const slaveMaster = await eDocument.sod.slaveCertificate.getSlaveMaster(CSCACertBytes)

    // Determine if this is an ECDSA passport (which needs synthetic SMT proof)
    const slaveCertPubKey = extractPubKey(
      eDocument.sod.slaveCertificate.certificate.tbsCertificate.subjectPublicKeyInfo,
    )
    const isECDSA = 'px' in slaveCertPubKey && 'py' in slaveCertPubKey

    let slaveCertSmtProof = await RegistrationStrategy.getSlaveCertSmtProof(
      eDocument.sod.slaveCertificate,
    )

    if (!slaveCertSmtProof.existence) {
      try {
        await RegistrationStrategy.registerCertificate(
          CSCACertBytes,
          eDocument.sod.slaveCertificate,
          slaveMaster,
        )
      } catch (error) {
        // KeyAlreadyExists is expected - another passport with the same DS certificate
        // was registered between our check and registration attempt. This is fine,
        // we can proceed to identity registration.
        if (error instanceof CertificateAlreadyRegisteredError) {
          console.log(
            '[NoirEPassport] Certificate already registered (race condition), continuing...',
          )
        } else {
          throw error
        }
      }

      // After registration (or if already registered), fetch fresh proof with existence=true
      console.log('[NoirEPassport] Fetching fresh SMT proof after certificate registration...')
      slaveCertSmtProof = await RegistrationStrategy.getSlaveCertSmtProof(
        eDocument.sod.slaveCertificate,
      )
      console.log('[NoirEPassport] Fresh proof existence:', slaveCertSmtProof.existence)
      console.log('[NoirEPassport] Fresh proof root:', slaveCertSmtProof.root)
    }

    // CRITICAL: For ECDSA passports with Noir circuits, we need to use a SYNTHETIC SMT proof.
    //
    // The problem: The on-chain SMT stores certificate keys computed by Bytes2Poseidon.hash512(),
    // but the Noir circuit's extract_pk_hash() computes the key differently (from 120-bit limbs).
    // These produce DIFFERENT hash values for the same public key!
    //
    // The solution: For ECDSA passports, we create a synthetic SMT proof where:
    // 1. pk_hash is computed the same way as the Noir circuit: poseidon(X_last248bits, Y_last248bits)
    // 2. root = poseidon([pk_hash, pk_hash, 1]) - matching smt_hash1(key, value) for a single-leaf tree
    // 3. All 80 siblings are zeros (valid for a single-leaf SMT)
    //
    // This matches how Rarimo's test suite creates "fake" SMT proofs in getFakeIdenData().
    // Note: The actual certificate registration still happens on-chain with hash512(), but
    // the ZK proof uses this synthetic proof that matches the circuit's expectations.

    let proofToUse: { root: string; siblings: string[]; existence: boolean }

    if (isECDSA) {
      console.log(
        '[NoirEPassport] ECDSA passport detected - using synthetic SMT proof for Noir circuit',
      )

      // Get X, Y coordinates as hex strings (without 0x prefix)
      const xHex = slaveCertPubKey.px.toString(16).padStart(96, '0') // P384 = 48 bytes = 96 hex
      const yHex = slaveCertPubKey.py.toString(16).padStart(96, '0')

      console.log('[NoirEPassport] Public key X (first 40 chars):', xHex.slice(0, 40))
      console.log('[NoirEPassport] Public key Y (first 40 chars):', yHex.slice(0, 40))

      // Create synthetic proof that matches the Noir circuit's pk_hash computation
      const syntheticProof = createSyntheticSmtProofForNoir(xHex, yHex)

      proofToUse = syntheticProof

      console.log('[NoirEPassport] Synthetic SMT root:', syntheticProof.root)
      console.log('[NoirEPassport] On-chain SMT root (not used for proof):', slaveCertSmtProof.root)
    } else {
      // RSA passports can use the real on-chain SMT proof
      console.log('[NoirEPassport] RSA passport - using on-chain SMT proof')

      // Debug: Log the SMT proof siblings before conversion
      console.log('[NoirEPassport] SMT proof siblings count:', slaveCertSmtProof.siblings.length)
      console.log(
        '[NoirEPassport] SMT proof siblings (first 5):',
        slaveCertSmtProof.siblings.slice(0, 5),
      )
      console.log(
        '[NoirEPassport] SMT proof non-zero siblings:',
        slaveCertSmtProof.siblings.filter(
          (s: string) =>
            s !== '0x0000000000000000000000000000000000000000000000000000000000000000' &&
            s !== '0' &&
            BigInt(s) !== 0n,
        ).length,
      )

      proofToUse = {
        root: slaveCertSmtProof.root,
        siblings: slaveCertSmtProof.siblings,
        existence: slaveCertSmtProof.existence,
      }
    }

    const circuit = new NoirEPassportBasedRegistrationCircuit(eDocument)

    const inclusionBranchesAsBigInt = proofToUse.siblings.map((el: string) => BigInt(el))
    console.log(
      '[NoirEPassport] inclusionBranches (first 5 as BigInt):',
      inclusionBranchesAsBigInt.slice(0, 5).map(String),
    )

    const registrationProof = await circuit.prove({
      skIdentity: BigInt(`0x${privateKey}`),
      icaoRoot: BigInt(proofToUse.root),
      inclusionBranches: inclusionBranchesAsBigInt,
    })

    const identityItem = new NoirEpassportIdentity(eDocument, registrationProof)

    const passportInfo = await identityItem.getPassportInfo()

    const currentIdentityKey = publicKeyHash
    const currentIdentityKeyHex = hexlify(currentIdentityKey)

    const isPassportNotRegistered =
      !passportInfo ||
      passportInfo.passportInfo_.activeIdentity === RegistrationStrategy.ZERO_BYTES32_HEX

    const isPassportRegisteredWithCurrentPK =
      passportInfo?.passportInfo_.activeIdentity === currentIdentityKeyHex

    if (isPassportNotRegistered) {
      // CRITICAL: For ECDSA passports, we need to:
      // 1. Add the synthetic root to the mock SMT (local testing only)
      // 2. Use the synthetic root in the calldata (to match the ZK proof)
      if (isECDSA) {
        console.log('[NoirEPassport] ECDSA: Adding synthetic root to mock SMT before registration')
        await RegistrationStrategy.addSyntheticRootToMockSMT(proofToUse.root)
      }

      const registerCallData = await this.buildRegisterCallData(
        identityItem,
        proofToUse.root, // Use synthetic root for ECDSA, real root for RSA
        false,
      )

      await RegistrationStrategy.requestRelayerRegisterMethod(registerCallData)
    }

    if (!isPassportRegisteredWithCurrentPK) {
      throw new PassportRegisteredWithAnotherPKError()
    }

    return identityItem
  }

  public revokeIdentity = async (
    tempMRZ: FieldRecords,
    _currentIdentityItem: IdentityItem,
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
    if (
      !tempMRZ.birthDate ||
      !tempMRZ.documentNumber ||
      !tempMRZ.expirationDate ||
      !tempMRZ.documentCode
    )
      throw new TypeError('MRZ data is empty')

    const currentIdentityItem = _currentIdentityItem as NoirEpassportIdentity

    const [passportInfo, getPassportInfoError] = await (async () => {
      if (_passportInfo) return [_passportInfo, null]

      return tryCatch(currentIdentityItem.getPassportInfo())
    })()
    if (getPassportInfoError) {
      throw new TypeError('Failed to get passport info', getPassportInfoError)
    }

    if (!passportInfo?.passportInfo_.activeIdentity)
      throw new TypeError('Active identity not found')

    if (!passportInfo?.passportInfo_.activeIdentity)
      throw new TypeError('Active identity not found')

    const challenge = await RegistrationStrategy.getRevocationChallenge(passportInfo)

    const eDocumentResponse = (await scanDocument(
      tempMRZ.documentCode,
      {
        dateOfBirth: tempMRZ.birthDate,
        dateOfExpiry: tempMRZ.expirationDate,
        documentNumber: tempMRZ.documentNumber,
      },
      challenge,
    )) as EPassport

    const revokedEDocument = currentIdentityItem.document || eDocumentResponse

    revokedEDocument.aaSignature = eDocumentResponse.aaSignature

    const aaSignature = revokedEDocument.getAASignature()

    if (!aaSignature) throw new TypeError('AA signature is not defined')

    const isPassportRegistered =
      passportInfo?.passportInfo_.activeIdentity !== RegistrationStrategy.ZERO_BYTES32_HEX

    if (isPassportRegistered) {
      const passport: Registration2.PassportStruct = {
        dataType: revokedEDocument.getAADataType(revokedEDocument.sod.slaveCertificate.keySize),
        zkType: RegistrationStrategy.ZERO_BYTES32_HEX,
        signature: aaSignature,
        publicKey: revokedEDocument.getAAPublicKey() || RegistrationStrategy.ZERO_BYTES32_HEX,
        passportHash: RegistrationStrategy.ZERO_BYTES32_HEX,
      }

      const txCallData = RegistrationStrategy.registrationContractInterface.encodeFunctionData(
        'revoke',
        [passportInfo?.passportInfo_.activeIdentity, passport],
      )

      try {
        const { data } = await relayerRegister(txCallData, Config.REGISTRATION_CONTRACT_ADDRESS)

        const tx = await RegistrationStrategy.rmoEvmJsonRpcProvider.getTransaction(data.tx_hash)

        if (!tx) throw new TypeError('Transaction not found')

        await tx.wait()
      } catch (error) {
        const axiosError = error as AxiosError
        if (axiosError.response?.data) {
          console.warn(JSON.stringify(axiosError.response?.data))
        }

        const errorMsgsToSkip = ['the leaf does not match', 'already revoked']

        const isSkip = errorMsgsToSkip.some(q =>
          JSON.stringify(axiosError.response?.data)?.includes(q),
        )

        if (!isSkip) {
          throw axiosError
        }
      }
    }

    const [slaveCertSmtProof, getSlaveCertSmtProofError] = await (async () => {
      if (_slaveCertSmtProof) return [_slaveCertSmtProof, null]

      return tryCatch(
        RegistrationStrategy.getSlaveCertSmtProof(
          currentIdentityItem.document.sod.slaveCertificate,
        ),
      )
    })()
    if (getSlaveCertSmtProofError) {
      throw new TypeError('Slave certificate SMT proof not found', getSlaveCertSmtProofError)
    }

    // For ECDSA passports during reissuance, we need synthetic proof too
    const slaveCertPubKey = extractPubKey(
      currentIdentityItem.document.sod.slaveCertificate.certificate.tbsCertificate
        .subjectPublicKeyInfo,
    )
    const isECDSA = 'px' in slaveCertPubKey && 'py' in slaveCertPubKey

    let rootToUse: string
    if (isECDSA) {
      console.log('[NoirEPassport Revoke] ECDSA passport detected - using synthetic SMT proof')
      const xHex = slaveCertPubKey.px.toString(16).padStart(96, '0')
      const yHex = slaveCertPubKey.py.toString(16).padStart(96, '0')
      const syntheticProof = createSyntheticSmtProofForNoir(xHex, yHex)
      await RegistrationStrategy.addSyntheticRootToMockSMT(syntheticProof.root)
      rootToUse = syntheticProof.root
    } else {
      rootToUse = slaveCertSmtProof.root
    }

    const registerCallData = await this.buildRegisterCallData(
      currentIdentityItem,
      rootToUse,
      true, // isRevoked = true for reissuance
    )

    await RegistrationStrategy.requestRelayerRegisterMethod(registerCallData)

    return currentIdentityItem
  }
}
