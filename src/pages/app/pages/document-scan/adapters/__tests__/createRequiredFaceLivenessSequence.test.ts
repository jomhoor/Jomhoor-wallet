/// <reference types="jest" />

import type { ChallengeDefinition } from '@iland/passport-verification'

import { createRequiredFaceLivenessSequence } from '../createRequiredFaceLivenessSequence'

const makeChallenge = (key: ChallengeDefinition['key']): ChallengeDefinition => ({
  key,
  prompt: key,
  evaluate: () => ({ passed: true, confidence: 1 }),
})

describe('createRequiredFaceLivenessSequence', () => {
  it('keeps only blink and smile in the required order', () => {
    const sequence = createRequiredFaceLivenessSequence([
      makeChallenge('turn_left'),
      makeChallenge('smile'),
      makeChallenge('blink'),
    ])

    expect(sequence.map(challenge => challenge.key)).toEqual(['blink', 'smile'])
  })
})
