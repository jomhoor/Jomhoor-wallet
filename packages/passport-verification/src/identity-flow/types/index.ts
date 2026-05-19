import type { FaceComparisonResult, GazeChallengeResult, LivenessResult } from '../../face'
import type { PassportCredentials, PassportNfcReadResult } from '../../passport'
import type { VerificationError } from '../../shared'

export type PassportIdentityFlowStep =
  | 'mrz'
  | 'nfc'
  | 'liveness'
  | 'gaze'
  | 'comparison'
  | 'review'
  | 'complete'

export type PassportIdentityFinalDecision = 'verified' | 'failed' | 'manual_review' | 'cancelled'

export type PassportIdentityFlowData = {
  passport: {
    credentials?: PassportCredentials
    mrz?: unknown
    nfc?: PassportNfcReadResult
    normalized?: PassportNfcReadResult['normalized']
    portrait?: PassportNfcReadResult['portrait']
  }
  face?: {
    liveness?: LivenessResult
    gaze?: GazeChallengeResult
    comparison?: FaceComparisonResult
  }
  errors?: VerificationError[]
}

export type PassportIdentityVerificationResult = {
  passport: PassportIdentityFlowData['passport']
  face?: PassportIdentityFlowData['face']
  finalDecision: PassportIdentityFinalDecision
  errors?: PassportIdentityFlowData['errors']
  debug?: {
    backend?: string
    timingsMs?: Record<string, number>
  }
}

export type PassportIdentityMrzMode =
  | 'host-provided'
  | 'package-placeholder'
  | 'package-photo'
  | 'package-live'

export type PassportIdentityFlowConfig = {
  initialStep?: PassportIdentityFlowStep
  nfcBackend?: 'native-ios' | 'native-android' | 'jomhoor-js' | 'stub'
  mrzMode?: PassportIdentityMrzMode
  face?: {
    enabled?: boolean
    livenessEnabled?: boolean
    gazeEnabled?: boolean
    comparisonEnabled?: boolean
    comparisonThreshold?: number
  }
}
