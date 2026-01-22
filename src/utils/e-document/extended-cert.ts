import { time } from '@distributedlab/tools'
import { Hex } from '@iden3/js-crypto'
import { findMasterCertificate } from '@lukachi/rn-csca'
import { ECDSASigValue, ECParameters } from '@peculiar/asn1-ecc'
import { id_pkcs_1, RSAPublicKey } from '@peculiar/asn1-rsa'
import { AsnConvert } from '@peculiar/asn1-schema'
import { Certificate } from '@peculiar/asn1-x509'
import { toBeArray, toBigInt } from 'ethers'

import {
  getPublicKeyFromEcParameters,
  hash512,
  hash512P384,
  hash512P512,
  hashPacked,
  namedCurveFromParameters,
} from './helpers/crypto'
import { extractPubKey } from './helpers/misc'
import { ECDSA_ALGO_PREFIX } from './sod'

export class ExtendedCertificate {
  constructor(public certificate: Certificate) {}

  static fromBytes(certBytes: Uint8Array) {
    return new ExtendedCertificate(AsnConvert.parse(certBytes, Certificate))
  }

  get slaveCertPubKeyOffset() {
    const rawTbsCertHex = Buffer.from(
      AsnConvert.serialize(this.certificate.tbsCertificate),
    ).toString('hex')

    if (
      this.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.algorithm.includes(id_pkcs_1)
    ) {
      const rsaPub = AsnConvert.parse(
        this.certificate.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey,
        RSAPublicKey,
      )

      return rawTbsCertHex.indexOf(Buffer.from(rsaPub.modulus).toString('hex')) / 2 + 1
    }

    if (
      this.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.algorithm.includes(
        ECDSA_ALGO_PREFIX,
      )
    ) {
      if (!this.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters)
        throw new TypeError('ECDSA public key does not have parameters')

      const ecParameters = AsnConvert.parse(
        this.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters,
        ECParameters,
      )

      const [publicKey] = getPublicKeyFromEcParameters(
        ecParameters,
        new Uint8Array(this.certificate.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey),
      )

      if (!publicKey) throw new TypeError('Public key not found in TBS Certificate')

      return (
        rawTbsCertHex.indexOf(
          Buffer.from(
            new Uint8Array([...toBeArray(publicKey.px), ...toBeArray(publicKey.py)]),
          ).toString('hex'),
        ) / 2
      )
    }

    throw new TypeError(
      `Unsupported public key algorithm: ${this.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.algorithm}`,
    )
  }

  /** Works */
  get slaveCertExpOffset(): bigint {
    const tbsCertificateHex = Buffer.from(
      AsnConvert.serialize(this.certificate.tbsCertificate),
    ).toString('hex')

    if (!this.certificate.tbsCertificate.validity.notAfter.utcTime)
      throw new TypeError('Expiration time not found in TBS Certificate')

    const expirationHex = Buffer.from(
      time(this.certificate.tbsCertificate.validity.notAfter.utcTime?.toISOString())
        .utc()
        .format('YYMMDDHHmmss[Z]'),
      'utf-8',
    ).toString('hex')

    const index = tbsCertificateHex.indexOf(expirationHex)

    if (index < 0) {
      throw new TypeError('Expiration time not found in TBS Certificate')
    }

    return BigInt(index / 2) // index in bytes, not hex
  }

  /** Works */
  getSlaveCertIcaoMemberSignature(masterCert: Certificate): Uint8Array {
    if (masterCert.signatureAlgorithm.algorithm.includes(id_pkcs_1)) {
      return new Uint8Array(this.certificate.signatureValue)
    }

    if (masterCert.signatureAlgorithm.algorithm.includes(ECDSA_ALGO_PREFIX)) {
      if (!masterCert.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters)
        throw new TypeError('ECDSA public key does not have parameters')

      const ecParameters = AsnConvert.parse(
        masterCert.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters,
        ECParameters,
      )

      const [, namedCurve] = namedCurveFromParameters(
        ecParameters,
        new Uint8Array(masterCert.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey),
      )

      if (!namedCurve) throw new TypeError('Named curve not found in TBS Certificate')

      const { r, s } = AsnConvert.parse(this.certificate.signatureValue, ECDSASigValue)

      const signature = new namedCurve.Signature(
        toBigInt(new Uint8Array(r)),
        toBigInt(new Uint8Array(s)),
      )

      return signature.normalizeS().toCompactRawBytes()
    }

    throw new TypeError(
      `Unsupported public key algorithm: ${this.certificate.signatureAlgorithm.algorithm}`,
    )
  }

  /** Works */
  async getSlaveMaster(CSCAs: ArrayBuffer[]) {
    const master = findMasterCertificate(AsnConvert.serialize(this.certificate), CSCAs)

    if (!master) throw new TypeError('Master certificate not found for slave certificate')

    return AsnConvert.parse(new Uint8Array(master), Certificate)
  }

  /** Works */
  get slaveCertificateIndex(): Uint8Array {
    if (
      this.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.algorithm.includes(id_pkcs_1)
    ) {
      const rsa = AsnConvert.parse(
        this.certificate.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey,
        RSAPublicKey,
      )
      const modulusBytes = new Uint8Array(rsa.modulus)
      const unpadded = modulusBytes[0] === 0x00 ? modulusBytes.subarray(1) : modulusBytes

      return hashPacked(unpadded)
    }

    if (
      this.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.algorithm.includes(
        ECDSA_ALGO_PREFIX,
      )
    ) {
      if (!this.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters)
        throw new TypeError('ECDSA public key does not have parameters')

      const ecParameters = AsnConvert.parse(
        this.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters,
        ECParameters,
      )

      const [publicKey, namedCurve] = getPublicKeyFromEcParameters(
        ecParameters,
        new Uint8Array(this.certificate.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey),
      )

      if (!publicKey) throw new TypeError('Public key not found in TBS Certificate')

      // Get the byte length for one coordinate based on curve order
      const coordByteLength = Math.ceil(namedCurve.CURVE.n.toString(16).length / 2)
      const nBitLength = coordByteLength * 8

      // Pad each coordinate to the correct length (toBeArray strips leading zeros)
      const xBytes = toBeArray(publicKey.px)
      const yBytes = toBeArray(publicKey.py)
      const paddedX = new Uint8Array(coordByteLength)
      const paddedY = new Uint8Array(coordByteLength)
      paddedX.set(xBytes, coordByteLength - xBytes.length)
      paddedY.set(yBytes, coordByteLength - yBytes.length)
      const rawPoint = new Uint8Array([...paddedX, ...paddedY])

      const hashedHex = (() => {
        // P512: 64 bytes per coord = 128 bytes total → contract uses hash1024()
        if (nBitLength >= 504) {
          if (rawPoint.length !== 128) {
            throw new Error(`P512 key expected 128 bytes, got ${rawPoint.length}`)
          }
          return hash512P512(rawPoint).toString(16)
        }

        // P384: 48 bytes per coord = 96 bytes total
        // IMPORTANT: Contract's hash512() only reads first 64 bytes of the key!
        // See Bytes2Poseidon.sol: for keyByteLength < 128, it uses hash512()
        // which reads bytes 0-31 and 32-63, ignoring bytes 64-95.
        if (nBitLength >= 376) {
          if (rawPoint.length !== 96) {
            throw new Error(`P384 key expected 96 bytes, got ${rawPoint.length}`)
          }
          // Take first 64 bytes only to match contract behavior
          const first64Bytes = rawPoint.slice(0, 64)
          return hash512(first64Bytes).toString(16)
        }

        // P256: 32 bytes per coord = 64 bytes total
        if (rawPoint.length !== 64) {
          throw new Error(`P256 key expected 64 bytes, got ${rawPoint.length}`)
        }
        return hash512(rawPoint).toString(16)
      })()

      return Hex.decodeString(hashedHex)
    }

    throw new TypeError(
      `Unsupported public key algorithm: ${this.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.algorithm}`,
    )
  }

  get keySize() {
    const pubKey = extractPubKey(this.certificate.tbsCertificate.subjectPublicKeyInfo)

    if (pubKey instanceof RSAPublicKey) {
      return (
        new Uint8Array(pubKey.modulus[0] === 0x00 ? pubKey.modulus.slice(1) : pubKey.modulus)
          .length * 8
      )
    }

    if (!this.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters) {
      throw new TypeError('ECDSA public key does not have parameters')
    }

    const ecParameters = AsnConvert.parse(
      this.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters,
      ECParameters,
    )

    const [, namedCurve] = namedCurveFromParameters(
      ecParameters,
      new Uint8Array(this.certificate.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey),
    )

    if (!namedCurve) throw new TypeError('Named curve not found in TBS Certificate')

    return toBeArray(namedCurve.CURVE.n).length * 8
  }
}
