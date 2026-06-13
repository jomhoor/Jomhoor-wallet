import { babyJub, poseidon } from '@iden3/js-crypto'
import { NoirZKProof } from '@modules/noir'
import { AxiosError } from 'axios'
import { BytesLike, hexlify, keccak256 } from 'ethers'
import { FieldRecords } from 'mrz'

import { extractRelayerTxHash, relayerRegister } from '@/api/modules/registration/relayer'
import { PassportInfo, RegistrationStrategy } from '@/api/modules/registration/strategy'
import { Config } from '@/config'
import {
  classifyIdentityCreationError,
  logIdentityDiagnostic,
  logIdentityDiagnosticError,
} from '@/helpers/identity-proof-diagnostics'
import { tryCatch } from '@/helpers/try-catch'
import { PassportRegisteredWithAnotherPKError } from '@/store/modules/identity/errors'
import { IdentityItem, NoirEpassportIdentity } from '@/store/modules/identity/Identity'
import { SparseMerkleTree } from '@/types/contracts/PoseidonSMT'
import { Registration2 } from '@/types/contracts/Registration'
import { NoirEPassportBasedRegistrationCircuit } from '@/utils/circuits/registration/noir-registration-circuit'
import { EDocument, EPassport } from '@/utils/e-document/e-document'

const hash1024Strict = (publicKey: Uint8Array) => {
  const decomposed = [0, 1, 2, 3, 4].map(chunkIndex => {
    const start = chunkIndex * 25
    const end = chunkIndex === 4 ? start + 28 : start + 25
    const chunk = Buffer.from(publicKey.slice(start, end)).toString('hex')

    return BigInt(`0x${chunk}`)
  })

  return (poseidon.hash(decomposed) as bigint).toString(16).padStart(64, '0')
}

/**
 * Manual ABI encoder for `registerViaNoir`.
 *
 * Hermes (React Native JS engine) corrupts dynamic offset/length words when
 * ethers.js's ABI coder round-trips values through typed arrays. This function
 * builds the calldata entirely with string operations, bypassing the issue.
 *
 * Signature:
 *   registerViaNoir(bytes32 certificatesRoot_, uint256 identityKey_, uint256 dgCommit_,
 *                   Passport memory passport_, bytes memory zkPoints_)
 *   Passport = { bytes32 dataType, bytes32 zkType, bytes signature, bytes publicKey, bytes32 passportHash }
 */
function manualEncodeRegisterViaNoir(
  certificatesRoot: string | Uint8Array,
  identityKey: string,
  dgCommit: string,
  passport: {
    dataType: BytesLike
    zkType: BytesLike
    signature: BytesLike
    publicKey: BytesLike
    passportHash: BytesLike
  },
  zkPoints: string | Uint8Array,
): string {
  const SELECTOR = '5a0f28b1'

  const word = (n: number | bigint): string => {
    const h = BigInt(n).toString(16)
    return '0'.repeat(64 - h.length) + h
  }

  const strip = (h: string): string => (h.startsWith('0x') ? h.slice(2) : h)

  const toHex = (data: BytesLike): string => {
    if (typeof data === 'string') return strip(data)
    let result = ''
    for (let i = 0; i < data.length; i++) {
      result += (data as Uint8Array)[i].toString(16).padStart(2, '0')
    }
    return result
  }

  const padTo32 = (hex: string): string => {
    const byteLen = hex.length / 2
    const paddedLen = Math.ceil(byteLen / 32) * 32
    return hex + '0'.repeat((paddedLen - byteLen) * 2)
  }

  // Convert inputs to hex
  const certRootHex = toHex(certificatesRoot).padStart(64, '0')
  const identityKeyHex = strip(identityKey).padStart(64, '0')
  const dgCommitHex = strip(dgCommit).padStart(64, '0')

  const sigHex = toHex(passport.signature)
  const pkHex = toHex(passport.publicKey)
  const zkPointsHex = toHex(zkPoints)

  // Build Passport struct encoding (tuple with dynamic fields)
  // Head: dataType(32) + zkType(32) + sigOffset(32) + pkOffset(32) + passportHash(32) = 160 bytes
  const passportHeadBytes = 160
  const sigSection = word(sigHex.length / 2) + padTo32(sigHex)
  const sigSectionBytes = sigSection.length / 2
  const pkSection = word(pkHex.length / 2) + padTo32(pkHex)

  const passportSigOffset = passportHeadBytes // offset from start of passport tuple
  const passportPkOffset = passportHeadBytes + sigSectionBytes

  const passportEncoded =
    toHex(passport.dataType).padStart(64, '0') +
    toHex(passport.zkType).padStart(64, '0') +
    word(passportSigOffset) +
    word(passportPkOffset) +
    toHex(passport.passportHash).padStart(64, '0') +
    sigSection +
    pkSection

  const passportEncodedBytes = passportEncoded.length / 2

  // Build zkPoints encoding
  const zkPointsEncoded = word(zkPointsHex.length / 2) + padTo32(zkPointsHex)

  // Top-level head: 5 words (certificatesRoot, identityKey, dgCommit, passportOffset, zkPointsOffset)
  const topHeadBytes = 160
  const passportOffset = topHeadBytes
  const zkPointsOffset = topHeadBytes + passportEncodedBytes

  const topHead =
    certRootHex + identityKeyHex + dgCommitHex + word(passportOffset) + word(zkPointsOffset)

  return '0x' + SELECTOR + topHead + passportEncoded + zkPointsEncoded
}

export class NoirEPassportRegistration extends RegistrationStrategy {
  buildRegisterCallData = async (
    identityItem: NoirEpassportIdentity,
    slaveCertSmtProof: SparseMerkleTree.ProofStructOutput,
    isRevoked: boolean,
  ) => {
    logIdentityDiagnostic('IdentityProof', 'buildRegisterCallData:start', {
      identityType: identityItem.identityType,
      isRevoked,
      siblingsLength: slaveCertSmtProof.siblings.length,
      hasDg15: Boolean(identityItem.document.dg15Bytes?.length),
      hasAaSignature: Boolean(identityItem.document.aaSignature?.length),
    })

    if (typeof identityItem.registrationProof.proof !== 'string') {
      throw new TypeError('Noir proof is not supported for Circom registration')
    }

    const registrationProof = identityItem.registrationProof as NoirZKProof
    const identityItemDocument = identityItem.document as EPassport

    const circuit = new NoirEPassportBasedRegistrationCircuit(identityItemDocument)

    // NoirZKProof emits `proof` and each `pub_signals[i]` as raw hex without a
    // leading `0x`. ethers' encodeFunctionData rejects unprefixed hex for both
    // BigNumberish (pkIdentityHash, dg1Commitment) and BytesLike (passportHash,
    // proof) arguments, so canonicalize to `0x`-prefixed. Idempotent: values
    // sourced from the contract (e.g. the SMT root) already carry `0x`.
    const ensureHexPrefix = (value: string) => (value.startsWith('0x') ? value : `0x${value}`)

    const aaSignature = identityItemDocument.getAASignature()

    if (!aaSignature) throw new TypeError('AA signature is not defined')

    const parts = circuit.name.split('_')

    if (parts.length < 2) {
      throw new Error('circuit name is in invalid format')
    }

    // ZKTypePrefix represerts the circuit zk type prefix
    const ZKTypePrefix = 'Z_NOIR_PASSPORT'

    const zkTypeSuffix = parts.slice(1).join('_') // support for multi-underscore suffix
    const zkTypeName = `${ZKTypePrefix}_${zkTypeSuffix}`

    const passport: Registration2.PassportStruct = {
      dataType: identityItemDocument.getAADataType(circuit.eDoc.sod.slaveCertificate.keySize),
      zkType: keccak256(Buffer.from(zkTypeName, 'utf-8')),
      signature: aaSignature,
      publicKey: (() => {
        const aaPublicKey = identityItemDocument.getAAPublicKey()

        if (!aaPublicKey) return ensureHexPrefix(identityItem.publicKey)

        return aaPublicKey
      })(),
      passportHash: ensureHexPrefix(identityItem.passportHash),
    }

    try {
      const passportPublicKey = identityItemDocument.getAAPublicKey()
      const _passportKeyFromPublicKey = passportPublicKey ? hash1024Strict(passportPublicKey) : null

      if (__DEV__) {
        console.log('[noir-epassport] Registration proof generated (PII redacted)')
      }
    } catch (diagErr) {
      if (__DEV__) {
        console.log('[noir-epassport] diagnostic error:', diagErr)
      }
    }

    if (isRevoked) {
      const callData = RegistrationStrategy.registrationContractInterface.encodeFunctionData(
        'reissueIdentityViaNoir',
        [
          slaveCertSmtProof.root,
          ensureHexPrefix(identityItem.pkIdentityHash),
          ensureHexPrefix(identityItem.dg1Commitment),
          passport,
          ensureHexPrefix(registrationProof.proof),
        ],
      )
      logIdentityDiagnostic('IdentityProof', 'buildRegisterCallData:success', {
        mode: 'reissueIdentityViaNoir',
        callDataLength: callData.length,
      })
      return callData
    }

    const callData = manualEncodeRegisterViaNoir(
      slaveCertSmtProof.root as string,
      ensureHexPrefix(identityItem.pkIdentityHash),
      ensureHexPrefix(identityItem.dg1Commitment),
      passport,
      ensureHexPrefix(registrationProof.proof),
    )
    logIdentityDiagnostic('IdentityProof', 'buildRegisterCallData:success', {
      mode: 'registerViaNoir',
      callDataLength: callData.length,
    })
    return callData
  }

  createIdentity = async (
    _eDocument: EDocument,
    privateKey: string,
    publicKeyHash: Uint8Array,
  ): Promise<NoirEpassportIdentity> => {
    const eDocument = _eDocument as EPassport
    let stage = 'passport-data-check'

    // TEMP DIAGNOSTIC: verify which AA hash matches for the on-chain challenge
    // (last 8 bytes of publicKeyHash). Remove after debugging.
    eDocument.debugVerifyAA(publicKeyHash.slice(-8))

    logIdentityDiagnostic('IdentityProof', 'NoirEPassportRegistration.createIdentity:start', {
      hasPrivateKey: Boolean(privateKey),
      privateKeyLength: privateKey.length,
      publicKeyHashLength: publicKeyHash.length,
      hasSodBytes: eDocument.sodBytes.length > 0,
      sodBytesLength: eDocument.sodBytes.length,
      dg1BytesLength: eDocument.dg1Bytes.length,
      dg15BytesLength: eDocument.dg15Bytes?.length ?? 0,
      dg11BytesLength: eDocument.dg11Bytes?.length ?? 0,
      hasAaSignature: Boolean(eDocument.aaSignature?.length),
    })

    try {
      if (eDocument.sodBytes.length === 0 || eDocument.dg1Bytes.length === 0) {
        throw new TypeError('Passport NFC result is missing required DG/SOD bytes')
      }

      stage = 'wallet-private-key-parse'
      const skIdentity = BigInt(`0x${privateKey}`)
      logIdentityDiagnostic('WalletCredential', 'NoirEPassportRegistration:private-key-ready', {
        hasPrivateKey: Boolean(privateKey),
        privateKeyLength: privateKey.length,
      })

      stage = 'passport-csca-fetch'
      logIdentityDiagnostic('PassportVerification', 'retrieveCSCAFromPem:start')
      const CSCACertBytes = await RegistrationStrategy.retrieveCSCAFromPem()
      logIdentityDiagnostic('PassportVerification', 'retrieveCSCAFromPem:success', {
        certificateCount: CSCACertBytes.length,
      })

      stage = 'passport-sod-parse'
      const slaveCertificate = eDocument.sod.slaveCertificate
      logIdentityDiagnostic('PassportVerification', 'slaveCertificate:available', {
        keySize: slaveCertificate.keySize,
        hasSlaveCertificateIndex: Boolean(slaveCertificate.slaveCertificateIndex),
      })

      stage = 'passport-slave-master-fetch'
      const slaveMaster = await slaveCertificate.getSlaveMaster(CSCACertBytes)
      logIdentityDiagnostic('PassportVerification', 'slaveMaster:resolved', {
        signatureAlgorithm: slaveMaster.signatureAlgorithm.algorithm,
      })

      stage = 'passport-slave-proof-fetch'
      const slaveCertSmtProof = await RegistrationStrategy.getSlaveCertSmtProof(
        slaveCertificate,
        slaveMaster,
      )
      logIdentityDiagnostic('IdentityProof', 'slaveCertSmtProof:received', {
        existence: slaveCertSmtProof.existence,
        siblingsLength: slaveCertSmtProof.siblings.length,
        rootLength: String(slaveCertSmtProof.root).length,
      })

      let currentSlaveCertSmtProof = slaveCertSmtProof

      if (!slaveCertSmtProof.existence) {
        stage = 'register-certificate-api'
        logIdentityDiagnostic('IdentityProof', 'registerCertificate:start', {
          reason: 'slave-certificate-proof-not-found',
        })
        await RegistrationStrategy.registerCertificate(CSCACertBytes, slaveCertificate, slaveMaster)
        logIdentityDiagnostic('IdentityProof', 'registerCertificate:success')

        stage = 'passport-slave-proof-refetch'
        currentSlaveCertSmtProof = await RegistrationStrategy.getSlaveCertSmtProof(
          slaveCertificate,
          slaveMaster,
        )
        logIdentityDiagnostic('IdentityProof', 'slaveCertSmtProof:refetched', {
          existence: currentSlaveCertSmtProof.existence,
          siblingsLength: currentSlaveCertSmtProof.siblings.length,
          rootLength: String(currentSlaveCertSmtProof.root).length,
        })
      }

      stage = 'passport-slave-proof-validate'
      if (!currentSlaveCertSmtProof.existence) {
        throw new TypeError(
          'Slave certificate inclusion proof is still missing after registration lookup',
        )
      }

      stage = 'registration-circuit-prepare'
      const circuit = new NoirEPassportBasedRegistrationCircuit(eDocument)
      logIdentityDiagnostic('IdentityProof', 'registration-circuit:prepared', {
        circuitName: circuit.name,
        hasDg15: Boolean(eDocument.dg15Bytes?.length),
      })

      // === CIRCUIT-DUMP (temporary) =========================================
      // One-time export of the raw passport material in the exact shape the
      // platform circuit generator (passport-zk-circuits-noir/.../process_passport.js)
      // expects as `tmp.json`. Copy the JSON between the BEGIN/END markers into
      // that file to autogenerate the Variant B (Type 9) circuit `main.nr`.
      // Remove this block once the circuit is compiled.
      try {
        const circuitDump = {
          sod: Buffer.from(eDocument.sodBytes).toString('base64'),
          dg1: Buffer.from(eDocument.dg1Bytes).toString('base64'),
          dg15: eDocument.dg15Bytes?.length
            ? Buffer.from(eDocument.dg15Bytes).toString('base64')
            : '',
        }
        console.log('=========== CIRCUIT-DUMP BEGIN (tmp.json) ===========')
        console.log(JSON.stringify(circuitDump))
        console.log('=========== CIRCUIT-DUMP END (tmp.json) =============')
      } catch (dumpErr) {
        console.log('[CircuitDump] failed to serialize passport dump', dumpErr)
      }
      // === /CIRCUIT-DUMP ====================================================

      stage = 'proof-generate'
      const registrationProof = await circuit.prove({
        skIdentity,
        icaoRoot: BigInt(currentSlaveCertSmtProof.root),
        inclusionBranches: currentSlaveCertSmtProof.siblings.map(el => BigInt(el)),
      })
      logIdentityDiagnostic('IdentityProof', 'proof-generated', {
        publicSignalsCount: registrationProof.pub_signals?.length ?? 0,
        proofKeyCount:
          registrationProof && typeof registrationProof === 'object'
            ? Object.keys(registrationProof).length
            : 0,
      })

      // === DIAG: compare wallet publicKeyHash vs circuit pub_signals[3] ===
      try {
        const diagPoint = babyJub.mulPointEScalar(babyJub.Base8, skIdentity) as [bigint, bigint]
        const diagHash = poseidon.hash(diagPoint) as bigint
        const diagHashHex = diagHash.toString(16).padStart(64, '0')
        const circuitPubSig3 = registrationProof.pub_signals[3]
        const walletHashFromParam = Buffer.from(publicKeyHash).toString('hex')
        console.log('[DIAG-IDENTITY-KEY] ======================================')
        console.log(
          '[DIAG-IDENTITY-KEY] skIdentity (first 20 hex):',
          skIdentity.toString(16).slice(0, 20),
        )
        console.log('[DIAG-IDENTITY-KEY] JS poseidon(point):', diagHashHex)
        console.log('[DIAG-IDENTITY-KEY] circuit pub_signals[3]:', circuitPubSig3)
        console.log('[DIAG-IDENTITY-KEY] wallet publicKeyHash param:', walletHashFromParam)
        console.log('[DIAG-IDENTITY-KEY] JS==circuit?', diagHashHex === circuitPubSig3)
        console.log('[DIAG-IDENTITY-KEY] JS==walletParam?', diagHashHex === walletHashFromParam)
        console.log('[DIAG-IDENTITY-KEY] challenge from JS (last 8):', diagHashHex.slice(-16))
        console.log(
          '[DIAG-IDENTITY-KEY] challenge from param (last 8):',
          walletHashFromParam.slice(-16),
        )
        console.log('[DIAG-IDENTITY-KEY] ======================================')
      } catch (diagErr) {
        console.log('[DIAG-IDENTITY-KEY] diagnostic failed:', diagErr)
      }
      // === /DIAG ============================================================

      stage = 'credential-identity-item-create'
      const identityItem = new NoirEpassportIdentity(eDocument, registrationProof)
      logIdentityDiagnostic('WalletCredential', 'identity-item-created', {
        identityType: identityItem.identityType,
      })

      stage = 'passport-info-fetch'
      let passportInfo = await identityItem.getPassportInfo()

      const currentIdentityKeyHex = hexlify(publicKeyHash)
      let isPassportNotRegistered =
        !passportInfo ||
        passportInfo.passportInfo_.activeIdentity === RegistrationStrategy.ZERO_BYTES32_HEX
      let isPassportRegisteredWithCurrentPK =
        passportInfo?.passportInfo_.activeIdentity === currentIdentityKeyHex

      logIdentityDiagnostic('IdentityProof', 'passport-info-evaluated', {
        hasPassportInfo: Boolean(passportInfo),
        hasActiveIdentity: Boolean(passportInfo?.passportInfo_.activeIdentity),
        isPassportNotRegistered,
        isPassportRegisteredWithCurrentPK,
      })

      if (isPassportNotRegistered) {
        stage = 'register-call-data-build'
        const registerCallData = await this.buildRegisterCallData(
          identityItem,
          currentSlaveCertSmtProof,
          false,
        )

        logIdentityDiagnostic('IdentityProof', 'register-call-data-built', {
          registerCallDataLength: registerCallData.length,
        })

        stage = 'register-via-relayer-api'
        await RegistrationStrategy.requestRelayerRegisterMethod(registerCallData)
        logIdentityDiagnostic('IdentityProof', 'register-via-relayer:success')

        passportInfo = await identityItem.getPassportInfo()
        isPassportNotRegistered =
          !passportInfo ||
          passportInfo.passportInfo_.activeIdentity === RegistrationStrategy.ZERO_BYTES32_HEX
        isPassportRegisteredWithCurrentPK =
          passportInfo?.passportInfo_.activeIdentity === currentIdentityKeyHex

        logIdentityDiagnostic('IdentityProof', 'passport-info-refetched', {
          hasPassportInfo: Boolean(passportInfo),
          hasActiveIdentity: Boolean(passportInfo?.passportInfo_.activeIdentity),
          isPassportNotRegistered,
          isPassportRegisteredWithCurrentPK,
        })
      }

      stage = 'passport-owner-validate'
      if (!isPassportRegisteredWithCurrentPK) {
        throw new PassportRegisteredWithAnotherPKError()
      }

      logIdentityDiagnostic('IdentityProof', 'NoirEPassportRegistration.createIdentity:success', {
        identityType: identityItem.identityType,
      })

      return identityItem
    } catch (error) {
      const classification = classifyIdentityCreationError({
        stage,
        error,
      })

      logIdentityDiagnosticError({
        domain: 'IdentityProof',
        event: 'NoirEPassportRegistration.createIdentity:failed',
        stage,
        classification,
        error,
        context: {
          hasPrivateKey: Boolean(privateKey),
          privateKeyLength: privateKey.length,
          publicKeyHashLength: publicKeyHash.length,
          hasSodBytes: eDocument.sodBytes.length > 0,
          sodBytesLength: eDocument.sodBytes.length,
          dg1BytesLength: eDocument.dg1Bytes.length,
          dg15BytesLength: eDocument.dg15Bytes?.length ?? 0,
        },
      })

      throw error
    }
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

        const txHash = extractRelayerTxHash(data)
        const tx = await RegistrationStrategy.rmoEvmJsonRpcProvider.getTransaction(txHash)

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

    const registerCallData = await this.buildRegisterCallData(
      currentIdentityItem,
      slaveCertSmtProof,
      false,
    )

    await RegistrationStrategy.requestRelayerRegisterMethod(registerCallData)

    return currentIdentityItem
  }
}
