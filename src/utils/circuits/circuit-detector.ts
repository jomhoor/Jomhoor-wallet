/**
 * Circuit Detector
 *
 * Determines which ZK circuit system (Circom/Groth16 vs Noir/UltraPlonk)
 * to use based on the passport/ID card's cryptographic properties.
 *
 * Decision criteria:
 * - RSA signatures → Circom (more mature, battle-tested)
 * - ECDSA signatures → Noir (only option for elliptic curves)
 */

import { id_pkcs_1 } from '@peculiar/asn1-rsa'

import { ECDSA_ALGO_PREFIX } from '@/utils/e-document/sod'

import type { EDocument } from '../e-document/e-document'
import { EPassport } from '../e-document/e-document'
import type { Sod } from '../e-document/sod'

export type CircuitSystem = 'circom' | 'noir'

export interface CircuitDetectionResult {
  system: CircuitSystem
  signatureType: 'rsa' | 'ecdsa' | 'rsa-pss'
  hashAlgorithm: string
  keySize: number
  curveName?: string // Only for ECDSA
  reason: string
}

/**
 * Detects which circuit system to use based on the document's SOD
 */
export function detectCircuitSystem(sod: Sod): CircuitDetectionResult {
  const slaveCert = sod.slaveCertificate
  const signatureAlgorithm = slaveCert.certificate.signatureAlgorithm.algorithm

  // Check for RSA-based signatures
  if (isRSASignature(signatureAlgorithm)) {
    const keyInfo = extractRSAKeyInfo(slaveCert)
    return {
      system: 'circom',
      signatureType: signatureAlgorithm.includes('RSASSA-PSS') ? 'rsa-pss' : 'rsa',
      hashAlgorithm: extractHashAlgorithm(signatureAlgorithm),
      keySize: keyInfo.keySize,
      reason: 'RSA signatures are well-supported in Circom with mature trusted setup',
    }
  }

  // Check for ECDSA-based signatures
  if (isECDSASignature(signatureAlgorithm)) {
    const keyInfo = extractECDSAKeyInfo(slaveCert)
    return {
      system: 'noir',
      signatureType: 'ecdsa',
      hashAlgorithm: extractHashAlgorithm(signatureAlgorithm),
      keySize: keyInfo.keySize,
      curveName: keyInfo.curveName,
      reason: 'ECDSA signatures require Noir circuits (Circom has limited EC support)',
    }
  }

  throw new Error(`Unsupported signature algorithm: ${signatureAlgorithm}`)
}

/**
 * Detects circuit system from an EDocument
 */
export function detectCircuitSystemFromDocument(doc: EDocument): CircuitDetectionResult {
  // Check if document is an EPassport with SOD
  if (doc instanceof EPassport) {
    return detectCircuitSystem(doc.sod)
  }
  throw new Error('Document does not have SOD data or is not an EPassport')
}

/**
 * Check if the algorithm is RSA-based
 */
function isRSASignature(algorithm: string): boolean {
  // OID prefix for RSA algorithms (PKCS#1)
  if (algorithm.includes(id_pkcs_1)) return true

  // Common RSA algorithm OIDs
  const rsaOids = [
    '1.2.840.113549.1.1.1', // rsaEncryption
    '1.2.840.113549.1.1.5', // sha1WithRSAEncryption
    '1.2.840.113549.1.1.11', // sha256WithRSAEncryption
    '1.2.840.113549.1.1.12', // sha384WithRSAEncryption
    '1.2.840.113549.1.1.13', // sha512WithRSAEncryption
    '1.2.840.113549.1.1.10', // RSASSA-PSS
  ]

  return rsaOids.some(oid => algorithm === oid || algorithm.startsWith(oid))
}

/**
 * Check if the algorithm is ECDSA-based
 */
function isECDSASignature(algorithm: string): boolean {
  // OID prefix for ECDSA algorithms
  if (algorithm.includes(ECDSA_ALGO_PREFIX)) return true

  // Common ECDSA algorithm OIDs
  const ecdsaOids = [
    '1.2.840.10045.4.1', // ecdsa-with-SHA1
    '1.2.840.10045.4.3.1', // ecdsa-with-SHA224
    '1.2.840.10045.4.3.2', // ecdsa-with-SHA256
    '1.2.840.10045.4.3.3', // ecdsa-with-SHA384
    '1.2.840.10045.4.3.4', // ecdsa-with-SHA512
  ]

  return ecdsaOids.some(oid => algorithm === oid || algorithm.startsWith(oid))
}

/**
 * Extract hash algorithm from signature algorithm OID
 */
function extractHashAlgorithm(algorithm: string): string {
  // SHA-1
  if (
    algorithm.includes('1.2.840.113549.1.1.5') || // sha1WithRSAEncryption
    algorithm.includes('1.2.840.10045.4.1') // ecdsa-with-SHA1
  ) {
    return 'SHA1'
  }

  // SHA-224
  if (algorithm.includes('1.2.840.10045.4.3.1')) {
    return 'SHA224'
  }

  // SHA-256
  if (
    algorithm.includes('1.2.840.113549.1.1.11') || // sha256WithRSAEncryption
    algorithm.includes('1.2.840.10045.4.3.2') // ecdsa-with-SHA256
  ) {
    return 'SHA256'
  }

  // SHA-384
  if (
    algorithm.includes('1.2.840.113549.1.1.12') || // sha384WithRSAEncryption
    algorithm.includes('1.2.840.10045.4.3.3') // ecdsa-with-SHA384
  ) {
    return 'SHA384'
  }

  // SHA-512
  if (
    algorithm.includes('1.2.840.113549.1.1.13') || // sha512WithRSAEncryption
    algorithm.includes('1.2.840.10045.4.3.4') // ecdsa-with-SHA512
  ) {
    return 'SHA512'
  }

  // Default for RSA-PSS (need to check parameters)
  if (algorithm.includes('1.2.840.113549.1.1.10')) {
    return 'SHA256' // Default, actual value comes from PSS parameters
  }

  return 'UNKNOWN'
}

/**
 * Extract RSA key info from certificate
 */
function extractRSAKeyInfo(cert: import('../e-document/extended-cert').ExtendedCertificate): {
  keySize: number
} {
  try {
    const { RSAPublicKey } = require('@peculiar/asn1-rsa')
    const { AsnConvert } = require('@peculiar/asn1-schema')

    const rsaPub = AsnConvert.parse(
      cert.certificate.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey,
      RSAPublicKey,
    )

    const modulusBytes = new Uint8Array(rsaPub.modulus)
    const unpadded = modulusBytes[0] === 0x00 ? modulusBytes.subarray(1) : modulusBytes

    return {
      keySize: unpadded.length * 8,
    }
  } catch {
    return { keySize: 2048 } // Default assumption
  }
}

/**
 * Extract ECDSA key info from certificate
 */
function extractECDSAKeyInfo(cert: import('../e-document/extended-cert').ExtendedCertificate): {
  keySize: number
  curveName: string
} {
  try {
    const { ECParameters } = require('@peculiar/asn1-ecc')
    const { AsnConvert } = require('@peculiar/asn1-schema')
    const { namedCurveFromParameters } = require('../e-document/helpers/crypto')

    if (!cert.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters) {
      throw new Error('ECDSA certificate missing parameters')
    }

    const ecParams = AsnConvert.parse(
      cert.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters,
      ECParameters,
    )

    const [, namedCurve, curveName] = namedCurveFromParameters(
      ecParams,
      new Uint8Array(cert.certificate.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey),
    )

    // Calculate key size from curve
    const keySize = namedCurve ? Math.ceil(namedCurve.CURVE.n.toString(2).length / 8) * 8 : 256

    return {
      keySize,
      curveName: curveName || 'unknown',
    }
  } catch {
    return { keySize: 256, curveName: 'unknown' }
  }
}

/**
 * Get human-readable description of the detection result
 */
export function getCircuitDescription(result: CircuitDetectionResult): string {
  if (result.signatureType === 'ecdsa') {
    return `${result.curveName} ECDSA with ${result.hashAlgorithm} (${result.keySize}-bit) → Noir`
  }

  return `${result.signatureType.toUpperCase()} with ${result.hashAlgorithm} (${result.keySize}-bit) → Circom`
}
