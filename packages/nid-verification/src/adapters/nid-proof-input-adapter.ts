import type { NidProofInputAdapterData, NidVerificationResult } from '../types'

export function toNidProofInputAdapterData(
  result: NidVerificationResult,
): NidProofInputAdapterData {
  return {
    docType: 'ID',
    mode: result.debug?.mockedNfc === false ? 'phase2-nfc-live' : 'phase1-mock',
    verified: result.verified,
    finalDecision: result.finalDecision,
    identityFields: {
      nationalId: result.identity?.nationalId,
      firstName: result.identity?.firstName,
      lastName: result.identity?.lastName,
      birthDate: result.identity?.birthDate,
      cardNumber: result.identity?.cardNumber,
      expiryDate: result.identity?.expiryDate,
    },
    faceChecks: {
      livenessPassed: result.face.liveness.passed,
      gazePassed: result.face.gaze.passed,
      faceComparisonPassed: result.face.comparison.passed,
      similarity: result.face.comparison.similarity,
      threshold: result.face.comparison.threshold,
    },
    nfcArtifacts: {
      signingCertHex: result.nfc.signingCertHex,
      authCertHex: result.nfc.authCertHex,
    },
    mismatches: result.mismatches ?? [],
    blockingErrors: result.blockingErrors ?? [],
    generatedAtIso: new Date().toISOString(),
  }
}
