import { ECDSASigValue, ECParameters } from '@peculiar/asn1-ecc'
import { id_pkcs_1, RSAPublicKey } from '@peculiar/asn1-rsa'
import { AsnConvert } from '@peculiar/asn1-schema'
import { Certificate } from '@peculiar/asn1-x509'
import { SubjectPublicKeyInfo } from '@peculiar/asn1-x509'
import { fromBER } from 'asn1js'
import { decodeBase64, getBytes, keccak256, toBigInt } from 'ethers'
import forge from 'node-forge'
import superjson from 'superjson'

import { ExtendedCertificate } from './extended-cert'
import { namedCurveFromParameters } from './helpers/crypto'
import { figureOutRSAAAHashAlgorithm } from './helpers/misc'
import { Sod } from './sod'
import { ECDSA_ALGO_PREFIX } from './helpers/constants'

export type PersonDetails = {
  firstName: string | null
  lastName: string | null
  gender: string | null
  birthDate: string | null
  expiryDate: string | null
  documentNumber: string | null
  nationality: string | null
  issuingAuthority: string | null
  passportImageRaw: string | null
}

export enum DocType {
  ID = 'ID',
  PASSPORT = 'PASSPORT',
}

export interface EDocument {
  docCode: string

  // constructor(params: { docCode: string }) {
  //   this.docCode = params.docCode
  // }

  get personDetails(): PersonDetails

  serialize(): string
}

type EPassportSerialized = {
  docCode: string
  personDetails: PersonDetails
  sodBytes: string
  dg1Bytes: string
  dg15Bytes?: string
  dg11Bytes?: string
  aaSignature?: string
}

export class EPassport implements EDocument {
  static ECMaxSizeInBits = 2688 // Represents the maximum size in bits for an encapsulated content

  docCode: string
  _personDetails: PersonDetails
  sodBytes: Uint8Array
  dg1Bytes: Uint8Array
  dg15Bytes?: Uint8Array
  dg11Bytes?: Uint8Array
  aaSignature?: Uint8Array // TODO: make optional and remove from persistence

  constructor(params: {
    docCode: string
    personDetails: PersonDetails
    sodBytes: Uint8Array
    dg1Bytes: Uint8Array
    dg15Bytes?: Uint8Array
    dg11Bytes?: Uint8Array
    aaSignature?: Uint8Array
  }) {
    this.docCode = params.docCode
    this.docCode = params.docCode
    this._personDetails = params.personDetails
    this.sodBytes = params.sodBytes
    this.dg1Bytes = params.dg1Bytes
    this.dg15Bytes = params.dg15Bytes
    this.dg11Bytes = params.dg11Bytes
    this.aaSignature = params.aaSignature
  }

  get sod(): Sod {
    return new Sod(this.sodBytes)
  }

  get docType(): 'ID' | 'PASSPORT' {
    if (this.docCode.includes('I')) {
      return DocType.ID
    }

    if (this.docCode.includes('P')) {
      return DocType.PASSPORT
    }

    throw new TypeError('Unsupported document type')
  }

  get personDetails(): PersonDetails {
    return this._personDetails
  }

  serialize(): string {
    const target: EPassportSerialized = {
      docCode: this.docCode,
      personDetails: this.personDetails,
      sodBytes: Buffer.from(this.sodBytes).toString('base64'),
      dg1Bytes: Buffer.from(this.dg1Bytes).toString('base64'),
      dg15Bytes: this.dg15Bytes ? Buffer.from(this.dg15Bytes).toString('base64') : undefined,
      dg11Bytes: this.dg11Bytes ? Buffer.from(this.dg11Bytes).toString('base64') : undefined,
      // AA signature is required on-chain by the passport dispatcher, so it must
      // survive persistence between scan and registration.
      aaSignature: this.aaSignature ? Buffer.from(this.aaSignature).toString('base64') : undefined,
    }
    const serialized = superjson.stringify(target)

    return serialized
  }

  static deserialize(serialized: string): EPassport {
    try {
      const parsed = superjson.parse<EPassportSerialized>(serialized)

      const res = new EPassport({
        docCode: parsed.docCode,
        personDetails: parsed.personDetails,
        sodBytes: decodeBase64(parsed.sodBytes),
        dg1Bytes: decodeBase64(parsed.dg1Bytes),
        dg15Bytes: parsed.dg15Bytes ? decodeBase64(parsed.dg15Bytes) : undefined,
        dg11Bytes: parsed.dg11Bytes ? decodeBase64(parsed.dg11Bytes) : undefined,
        aaSignature: parsed.aaSignature ? decodeBase64(parsed.aaSignature) : undefined,
      })

      return res
    } catch (error) {
      console.error('Error during deserialization:', error)
      throw new Error('Failed to deserialize NewEDocument')
    }
  }

  get dg15PubKey() {
    if (!this.dg15Bytes) return undefined

    const { result } = fromBER(this.dg15Bytes)

    if (!result) {
      throw new Error('BER-decode failed - DG15 file corrupted?')
    }

    const subjectPublicKeyInfo = AsnConvert.parse(
      result.valueBlock.toBER(false),
      SubjectPublicKeyInfo,
    )

    return subjectPublicKeyInfo
  }

  getAADataType(ecSizeInBits: number) {
    if (!this.dg15PubKey) {
      return getBytes(keccak256(Buffer.from('P_NO_AA', 'utf-8')))
    }

    if (this.dg15PubKey?.algorithm.algorithm.includes(id_pkcs_1)) {
      const rsaPubKey = AsnConvert.parse(this.dg15PubKey.subjectPublicKey, RSAPublicKey)

      if (!this.aaSignature) throw new TypeError('AA signature is not defined')

      const hashAlg = figureOutRSAAAHashAlgorithm(rsaPubKey, this.aaSignature)

      if (!hashAlg) {
        return getBytes(keccak256(Buffer.from('P_NO_AA', 'utf-8')))
      }

      const exponentHex = Buffer.from(rsaPubKey.publicExponent).toString('hex')
      const unpaddedModulus =
        rsaPubKey.modulus[0] === 0x00 ? rsaPubKey.modulus.slice(1) : rsaPubKey.modulus

      const e = new forge.jsbn.BigInteger(exponentHex, 16)

      // The passport (AA) dispatcher size component is a fixed circuit constant
      // (ECMaxSizeInBits = 2688), NOT the DS certificate key size. Only
      // `P_RSA_<hash>_2688[_3]` dispatchers are registered on-chain, so larger DS
      // keys (e.g. 3072-bit) must still map to 2688.
      let dispatcherName = `P_RSA_${hashAlg}_${EPassport.ECMaxSizeInBits}`
      const exponentInt = e.intValue()
      if (exponentInt === 3) {
        dispatcherName += '_3'
      } else if (exponentInt !== 65537) {
        // Non-standard AA exponents (e.g. Iranian passports use 51279 / 0xc84f)
        // need a dedicated dispatcher whose authenticator is initialized with that
        // exact exponent. Encode it in the name; the on-chain registration must
        // register a matching `P_RSA_<hash>_2688_<exponent>` dispatcher.
        dispatcherName += `_${exponentInt}`
      }

      // eslint-disable-next-line no-console
      console.log('[AA-DISPATCHER]', {
        hashAlg,
        exponent: e.intValue(),
        exponentHex,
        modulusBits: Buffer.from(unpaddedModulus).length * 8,
        dispatcherName,
      })

      return getBytes(keccak256(Buffer.from(dispatcherName, 'utf-8')))
    }

    if (this.dg15PubKey?.algorithm.algorithm.includes(ECDSA_ALGO_PREFIX)) {
      const dispatcherName = `P_ECDSA_SHA1_${ecSizeInBits}`

      return getBytes(keccak256(Buffer.from(dispatcherName, 'utf-8')))
    }

    throw new TypeError('Unsupported DG15 public key algorithm')
  }

  // TEMP DIAGNOSTIC: decrypts the RSA AA signature and tests which hash
  // (SHA-1 vs SHA-256) reproduces the embedded digest for the given on-chain
  // challenge. Mirrors PRSASHAAuthenticator.authenticate. Remove after debugging.
  debugVerifyAA(challenge: Uint8Array) {
    try {
      if (!this.dg15PubKey || !this.aaSignature) {
        // eslint-disable-next-line no-console
        console.log('[AA-VERIFY] missing dg15PubKey or aaSignature')
        return
      }
      const rsaPubKey = AsnConvert.parse(this.dg15PubKey.subjectPublicKey, RSAPublicKey)
      const n = new forge.jsbn.BigInteger(Buffer.from(rsaPubKey.modulus).toString('hex'), 16)
      const e = new forge.jsbn.BigInteger(Buffer.from(rsaPubKey.publicExponent).toString('hex'), 16)
      const sig = new forge.jsbn.BigInteger(Buffer.from(this.aaSignature).toString('hex'), 16)

      let F = Buffer.from(sig.modPow(e, n).toByteArray())
      if (F[0] === 0x00) F = F.subarray(1)

      const chal = Buffer.from(challenge)

      const tryHash = (
        label: string,
        hashLen: number,
        suffixLen: number,
        md: forge.md.MessageDigest,
      ) => {
        const L = F.length - suffixLen
        if (L - hashLen - 1 < 0) {
          // eslint-disable-next-line no-console
          console.log(`[AA-VERIFY] ${label}: too short`)
          return
        }
        const prepared = Buffer.from(F.subarray(1, L - hashLen))
        const digest = Buffer.from(F.subarray(L - hashLen, L))
        md.start()
        md.update(Buffer.concat([prepared, chal]).toString('binary'))
        const computed = Buffer.from(md.digest().toHex(), 'hex')
        const match = computed.equals(digest)
        // eslint-disable-next-line no-console
        console.log(
          `[AA-VERIFY] ${label}: match=${match} digest=${digest.toString('hex').slice(0, 16)} computed=${computed.toString('hex').slice(0, 16)}`,
        )
      }

      // eslint-disable-next-line no-console
      console.log(
        '[AA-VERIFY] F.len',
        F.length,
        'first',
        F[0]?.toString(16),
        'last2',
        F[F.length - 2]?.toString(16),
        F[F.length - 1]?.toString(16),
        'challenge',
        chal.toString('hex'),
      )
      // eslint-disable-next-line no-console
      console.log('[AA-VERIFY] F.hex', Buffer.from(F).toString('hex'))
      tryHash('SHA1 (suffix1,hash20)', 20, 1, forge.md.sha1.create())
      tryHash('SHA256 (suffix2,hash32)', 32, 2, forge.md.sha256.create())
      tryHash('SHA256 (suffix1,hash32)', 32, 1, forge.md.sha256.create())
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log('[AA-VERIFY] error', String(err))
    }
  }

  getAASignature() {
    if (!this.dg15PubKey) throw new TypeError('DG15 public key is not defined')

    if (this.dg15PubKey?.algorithm.algorithm.includes(id_pkcs_1)) {
      return this.aaSignature
    }

    if (this.dg15PubKey?.algorithm.algorithm.includes(ECDSA_ALGO_PREFIX)) {
      const ecParameters = AsnConvert.parse(this.dg15PubKey.subjectPublicKey, ECParameters)

      const [, namedCurve] = namedCurveFromParameters(
        ecParameters,
        new Uint8Array(this.dg15PubKey.subjectPublicKey),
      )

      if (!namedCurve) throw new TypeError('Named curve not found in TBS Certificate')

      if (!this.aaSignature) throw new TypeError('AA signature is not defined')

      const { r, s } = AsnConvert.parse(this.aaSignature, ECDSASigValue)

      const signature = new namedCurve.Signature(
        toBigInt(new Uint8Array(r)),
        toBigInt(new Uint8Array(s)),
      )

      return signature.normalizeS().toCompactRawBytes()
    }

    throw new TypeError('Unsupported DG15 public key algorithm for AA signature extraction')
  }

  getAAPublicKey() {
    if (!this.dg15PubKey) throw new TypeError('DG15 public key is not defined')

    if (this.dg15PubKey?.algorithm.algorithm.includes(id_pkcs_1)) {
      const rsaPubKey = AsnConvert.parse(this.dg15PubKey.subjectPublicKey, RSAPublicKey)

      if (!this.aaSignature) throw new TypeError('AA signature is not defined')

      const hashAlg = figureOutRSAAAHashAlgorithm(rsaPubKey, this.aaSignature)

      if (!hashAlg) {
        return null
      }

      return new Uint8Array(
        rsaPubKey.modulus[0] === 0x00 ? rsaPubKey.modulus.slice(1) : rsaPubKey.modulus,
      )
    }

    // TODO: not tested yet
    if (this.dg15PubKey?.algorithm.algorithm.includes(ECDSA_ALGO_PREFIX)) {
      const ecParameters = AsnConvert.parse(this.dg15PubKey.subjectPublicKey, ECParameters)
      if (!ecParameters?.specifiedCurve?.base?.buffer) {
        throw new TypeError(
          'ECDSA public key does not have a ecParameters?.specifiedCurve?.base?.buffer',
        )
      }

      return new Uint8Array(this.dg15PubKey.subjectPublicKey)
    }

    throw new TypeError('Unsupported DG15 public key algorithm for AA public key extraction')
  }
}

export class EID implements EDocument {
  docCode = 'EID'

  constructor(
    public sigCertificate: ExtendedCertificate,
    public authCertificate: ExtendedCertificate,
  ) {}

  get AADataType() {
    return keccak256(Buffer.from('P_NO_AA', 'utf-8'))
  }

  static fromBytes(sigBytes: Uint8Array, authBytes: Uint8Array): EID {
    const sigCert = AsnConvert.parse(sigBytes, Certificate)
    const authCert = AsnConvert.parse(authBytes, Certificate)

    return new EID(new ExtendedCertificate(sigCert), new ExtendedCertificate(authCert))
  }

  get personDetails(): PersonDetails {
    const certData = this.sigCertificate.certificate.tbsCertificate
    return {
      firstName: certData.subject[2][0].value.toString(),
      lastName: certData.subject[3][0].value.toString(),
      expiryDate: certData.validity.notAfter.getTime().toString(),
      nationality: certData.subject[0][0].value.toString(),
      issuingAuthority: certData.issuer[3][0].value.toString(),
    } as PersonDetails
  }

  serialize(): string {
    return superjson.stringify({
      sigCertificate: new Uint8Array(AsnConvert.serialize(this.sigCertificate.certificate)),
      authCertificate: new Uint8Array(AsnConvert.serialize(this.authCertificate.certificate)),
    })
  }

  static deserialize(serialized: string): EID {
    try {
      const parsed = superjson.parse<{
        sigCertificate: Uint8Array
        authCertificate: Uint8Array
      }>(serialized)

      const sigCert = AsnConvert.parse(parsed.sigCertificate, Certificate)
      const authCert = AsnConvert.parse(parsed.authCertificate, Certificate)

      return new EID(new ExtendedCertificate(sigCert), new ExtendedCertificate(authCert))
    } catch (error) {
      console.error('Error during deserialization:', error)
      throw new Error('Failed to deserialize EID')
    }
  }
}
