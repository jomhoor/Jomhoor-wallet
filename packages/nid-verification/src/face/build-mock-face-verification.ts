import {
  buildLivenessResult,
  buildUnifiedGazeChallengeResult,
  createLivenessChallengeSequence,
  evaluateLivenessChallenge,
  evaluateUnifiedGazeSample,
  generateUnifiedGazeWaypoints,
  toFaceComparisonResult,
  type ChallengeDefinition,
  type ChallengeSample,
  type DetectorFace,
} from '@iland/passport-verification/face'

import type { NidFaceVerificationResult } from '../types'

function detectorFaceForChallenge(challenge: ChallengeDefinition): DetectorFace {
  switch (challenge.key) {
    case 'blink':
      return {
        leftEyeOpenProbability: 0.05,
        rightEyeOpenProbability: 0.07,
      }
    case 'smile':
      return {
        smilingProbability: 0.94,
      }
    case 'turn_left':
      return {
        yawAngle: 24,
      }
    default:
      return {
        yawAngle: 20,
        smilingProbability: 0.9,
        leftEyeOpenProbability: 0.1,
        rightEyeOpenProbability: 0.1,
      }
  }
}

export function buildMockNidFaceVerificationResult(): NidFaceVerificationResult {
  const livenessStartedAt = Date.now()
  const sequence = createLivenessChallengeSequence()
  const confidenceByKey: Record<string, number> = {}

  sequence.forEach(challenge => {
    const evaluation = evaluateLivenessChallenge(challenge, detectorFaceForChallenge(challenge))
    confidenceByKey[challenge.key] = evaluation.confidence ?? 1
  })

  const livenessCompletedAt = livenessStartedAt + sequence.length * 450

  const liveness = buildLivenessResult({
    sequence,
    confidenceByKey,
    startedAt: livenessStartedAt,
    completedAt: livenessCompletedAt,
  })

  const gazeStartedAt = Date.now()
  const waypoints = generateUnifiedGazeWaypoints({
    width: 1080,
    height: 1920,
  })

  const gazeSamples: ChallengeSample[] = waypoints.map((waypoint, index) => {
    const sample = evaluateUnifiedGazeSample(
      waypoint.targetYawDeg,
      waypoint.targetPitchDeg,
      waypoint.targetYawDeg,
      waypoint.targetPitchDeg,
    )

    return {
      waypointIndex: index,
      timestamp: gazeStartedAt + index * 150,
      passed: sample.passed,
      yawErrorDeg: sample.yawErrorDeg,
      pitchErrorDeg: sample.pitchErrorDeg,
      actualYaw: waypoint.targetYawDeg,
      actualPitch: waypoint.targetPitchDeg,
      expectedYaw: waypoint.targetYawDeg,
      expectedPitch: waypoint.targetPitchDeg,
      mirrorMode: 'normal',
      confidence: 1,
    }
  })

  const gazeCompletedAt = gazeStartedAt + waypoints.length * 350

  const gaze = buildUnifiedGazeChallengeResult({
    samples: gazeSamples,
    targetsCompleted: waypoints.length,
    targetsTotal: waypoints.length,
    startedAt: gazeStartedAt,
    completedAt: gazeCompletedAt,
  })

  const comparison = toFaceComparisonResult({
    similarity: 0.97,
    threshold: 0.1,
    model: 'phase1-mock',
    liveImage: {
      filePath: 'file://mock-live-face.jpg',
    },
    referenceImage: {
      filePath: 'file://mock-reference-face.jpg',
    },
  })

  return {
    passed: liveness.passed && gaze.passed && comparison.passed,
    liveness,
    gaze,
    comparison,
    liveFaceImageUri: 'file://mock-live-face.jpg',
    referenceFaceImageUri: 'file://mock-reference-face.jpg',
  }
}
