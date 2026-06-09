import type {
  FaceComparisonResult,
  GazeChallengeResult,
  LivenessResult,
} from '@iland/passport-verification/face'
import type { ParsedNidBarcode } from '@iland/passport-verification/passport'

export type NidFieldSource = 'ocr' | 'manual' | 'barcode' | 'nfc' | 'derived'

export type NidEvidenceField<T> = {
  value?: T
  source: NidFieldSource
  confidence?: number
}

export type NidFrontScanResult = {
  frontImageUri?: string
  nationalId?: NidEvidenceField<string>
  firstName?: NidEvidenceField<string>
  lastName?: NidEvidenceField<string>
  birthDate?: NidEvidenceField<string>
}

export type NidBackScanResult = {
  backImageUri?: string
  barcodeRaw?: string
  barcode?: ParsedNidBarcode | null
  nationalId?: NidEvidenceField<string>
}

export type NidNfcReadStatus = 'success' | 'failed' | 'cancelled' | 'unavailable'

export type NidNfcReadResult = {
  status: NidNfcReadStatus
  nationalId?: NidEvidenceField<string>
  firstName?: NidEvidenceField<string>
  lastName?: NidEvidenceField<string>
  birthDate?: NidEvidenceField<string>
  cardNumber?: NidEvidenceField<string>
  expiryDate?: NidEvidenceField<string>
  signingCertHex?: string
  authCertHex?: string
  dg1Bytes?: Uint8Array
  dg15Bytes?: Uint8Array
  sodBytes?: Uint8Array
  debug?: Record<string, unknown>
}

export type NidFaceVerificationResult = {
  passed: boolean
  liveness: LivenessResult
  gaze: GazeChallengeResult
  comparison: FaceComparisonResult
  liveFaceImageUri?: string
  referenceFaceImageUri?: string
}

export type NidVerifiedIdentity = {
  nationalId: string
  firstName?: string
  lastName?: string
  birthDate?: string
  cardNumber?: string
  expiryDate?: string
}

export type NidVerificationStep = 'front-scan' | 'back-scan' | 'nfc-read'

export type NidFinalDecision = 'verified' | 'failed' | 'cancelled'

export type NidVerificationResult = {
  verified: boolean
  finalDecision: NidFinalDecision
  front: NidFrontScanResult
  back: NidBackScanResult
  nfc: NidNfcReadResult
  face: NidFaceVerificationResult
  identity?: NidVerifiedIdentity
  mismatches?: string[]
  blockingErrors?: string[]
  debug?: {
    mockedNfc: boolean
    mockedFace: boolean
    stepsCompleted: NidVerificationStep[]
  }
}

export type NidVerificationInitialData = {
  front?: NidFrontScanResult
  back?: NidBackScanResult
  nfc?: NidNfcReadResult
  result?: NidVerificationResult
}

export type NidProofInputAdapterData = {
  docType: 'ID'
  mode: 'phase1-mock' | 'phase2-nfc-live'
  verified: boolean
  finalDecision: NidFinalDecision
  identityFields: {
    nationalId?: string
    firstName?: string
    lastName?: string
    birthDate?: string
    cardNumber?: string
    expiryDate?: string
  }
  faceChecks: {
    livenessPassed: boolean
    gazePassed: boolean
    faceComparisonPassed: boolean
    similarity: number
    threshold: number
  }
  nfcArtifacts: {
    signingCertHex?: string
    authCertHex?: string
    dg1Bytes?: Uint8Array
    dg15Bytes?: Uint8Array
    sodBytes?: Uint8Array
  }
  mismatches: string[]
  blockingErrors: string[]
  generatedAtIso: string
}
