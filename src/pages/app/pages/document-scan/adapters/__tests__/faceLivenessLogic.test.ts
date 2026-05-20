/// <reference types="jest" />

import {
  buildLivenessResult,
  createLivenessChallengeSequence,
  type DetectorFace,
  evaluateLivenessChallenge,
} from '@iland/passport-verification/face'

describe('face liveness logic', () => {
  it('creates a non-empty challenge sequence', () => {
    const sequence = createLivenessChallengeSequence()

    expect(sequence.length).toBeGreaterThan(0)
  })

  it('passes blink challenge when both eyes are mostly closed', () => {
    const blinkChallenge = createLivenessChallengeSequence().find(item => item.key === 'blink')

    if (!blinkChallenge) {
      throw new Error('Blink challenge should exist')
    }

    const mockFace: DetectorFace = {
      leftEyeOpenProbability: 0.1,
      rightEyeOpenProbability: 0.1,
    }

    const result = evaluateLivenessChallenge(blinkChallenge, mockFace)
    expect(result.passed).toBe(true)
  })

  it('builds a typed liveness result', () => {
    const sequence = createLivenessChallengeSequence()
    const confidenceByKey = Object.fromEntries(sequence.map(item => [item.key, 0.9]))

    const result = buildLivenessResult({
      sequence,
      confidenceByKey,
      startedAt: 100,
      completedAt: 200,
    })

    expect(result.passed).toBe(true)
    expect(result.challenges.length).toBe(sequence.length)
    expect(result.completedAt).toBe(200)
  })
})
