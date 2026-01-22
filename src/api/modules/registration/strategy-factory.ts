/**
 * Registration Strategy Factory
 *
 * Creates the appropriate registration strategy based on the document type
 * and its cryptographic properties (RSA vs ECDSA).
 */

import type { EDocument } from '@/utils/e-document/e-document'
import { DocType, EPassport } from '@/utils/e-document/e-document'

import { CircomEPassportRegistration } from './variants/circom-epassport'
import { NoirEIDRegistration } from './variants/noir-eid'
import { NoirEPassportRegistration } from './variants/noir-epassport'
import type { RegistrationStrategy } from './strategy'
import {
  detectCircuitSystemFromDocument,
  getCircuitDescription,
  type CircuitDetectionResult,
} from '@/utils/circuits/circuit-detector'

// Singleton instances for reuse
const circomPassportStrategy = new CircomEPassportRegistration()
const noirPassportStrategy = new NoirEPassportRegistration()
const noirEidStrategy = new NoirEIDRegistration()

export interface StrategySelection {
  strategy: RegistrationStrategy
  detection: CircuitDetectionResult
  description: string
}

/**
 * Get the appropriate registration strategy based on document type only
 * (without analyzing the document's cryptographic properties)
 *
 * This is the simple version used when we don't have the document yet.
 */
export function getRegistrationStrategyByDocType(docType: DocType): RegistrationStrategy {
  switch (docType) {
    case DocType.PASSPORT:
      // Default to Noir for passports (handles both RSA and ECDSA)
      return noirPassportStrategy
    case DocType.ID:
      // EID always uses Noir
      return noirEidStrategy
    default:
      return noirPassportStrategy
  }
}

/**
 * Get the optimal registration strategy based on the actual document
 *
 * This analyzes the document's signature algorithm and chooses:
 * - Circom for RSA signatures (more mature, battle-tested)
 * - Noir for ECDSA signatures (only option for elliptic curves)
 */
export function getRegistrationStrategy(doc: EDocument): StrategySelection {
  // Check if this is an EPassport (has SOD for analysis)
  const isPassport = doc instanceof EPassport

  // EID (non-passport) always uses Noir (TD1 format, typically ECDSA)
  if (!isPassport) {
    return {
      strategy: noirEidStrategy,
      detection: {
        system: 'noir',
        signatureType: 'ecdsa',
        hashAlgorithm: 'SHA256',
        keySize: 256,
        reason: 'ID cards (TD1) use Noir circuits with light verification',
      },
      description: 'ID Card → Noir (TD1 light verification)',
    }
  }

  // For passports, analyze the signature algorithm
  try {
    const detection = detectCircuitSystemFromDocument(doc)
    const description = getCircuitDescription(detection)

    if (detection.system === 'circom') {
      return {
        strategy: circomPassportStrategy,
        detection,
        description,
      }
    }

    return {
      strategy: noirPassportStrategy,
      detection,
      description,
    }
  } catch (error) {
    // Fallback to Noir if detection fails (handles more cases)
    console.warn('Circuit detection failed, falling back to Noir:', error)
    return {
      strategy: noirPassportStrategy,
      detection: {
        system: 'noir',
        signatureType: 'ecdsa',
        hashAlgorithm: 'UNKNOWN',
        keySize: 0,
        reason: 'Fallback due to detection error',
      },
      description: 'Unknown signature → Noir (fallback)',
    }
  }
}

/**
 * Check if a document is supported by our circuit system
 */
export function isDocumentSupported(doc: EDocument): {
  supported: boolean
  reason: string
} {
  try {
    const detection = detectCircuitSystemFromDocument(doc)

    // Check for known unsupported algorithms
    if (detection.hashAlgorithm === 'UNKNOWN') {
      return {
        supported: false,
        reason: 'Unknown hash algorithm in signature',
      }
    }

    // RSA key sizes we support
    if (detection.signatureType === 'rsa') {
      const supportedRsaSizes = [1024, 2048, 3072, 4096]
      if (!supportedRsaSizes.includes(detection.keySize)) {
        return {
          supported: false,
          reason: `Unsupported RSA key size: ${detection.keySize} bits`,
        }
      }
    }

    // ECDSA curves we support
    if (detection.signatureType === 'ecdsa' && detection.curveName) {
      const supportedCurves = [
        'secp256r1',
        'secp384r1',
        'secp521r1',
        'brainpoolP256r1',
        'brainpoolP320r1',
        'brainpoolP384r1',
        'brainpoolP512r1',
      ]

      if (!supportedCurves.includes(detection.curveName)) {
        return {
          supported: false,
          reason: `Unsupported ECDSA curve: ${detection.curveName}`,
        }
      }
    }

    return {
      supported: true,
      reason: getCircuitDescription(detection),
    }
  } catch (error) {
    return {
      supported: false,
      reason: `Failed to analyze document: ${error}`,
    }
  }
}
