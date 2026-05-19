/// <reference types="jest" />

import type {
  FaceComparisonResult,
  GazeChallengeResult,
  LivenessResult,
} from '@iland/passport-verification/face'

describe('face placeholder mock contracts', () => {
  it('matches liveness contract shape', () => {
    const mockLivenessResult: LivenessResult = {
      passed: true,
      challenges: [
        { type: 'blink', passed: true, confidence: 1 },
        { type: 'smile', passed: true, confidence: 1 },
      ],
    }

    expect(mockLivenessResult.passed).toBe(true)
    expect(mockLivenessResult.challenges.length).toBeGreaterThan(0)
  })

  it('matches gaze and comparison contract shapes', () => {
    const mockGazeResult: GazeChallengeResult = {
      passed: true,
      score: 1,
      targetsCompleted: 4,
      targetsTotal: 4,
    }

    const mockFaceComparisonResult: FaceComparisonResult = {
      passed: true,
      similarity: 0.99,
      threshold: 0.75,
      model: 'mock',
    }

    expect(mockGazeResult.passed).toBe(true)
    expect(mockFaceComparisonResult.similarity).toBeGreaterThan(mockFaceComparisonResult.threshold)
  })
})
