import {
  type ChallengeDefinition,
  createLivenessChallengeSequence,
} from '@iland/passport-verification'

const REQUIRED_LIVENESS_CHALLENGE_TYPES: ChallengeDefinition['key'][] = ['blink', 'smile']

export function createRequiredFaceLivenessSequence(
  source = createLivenessChallengeSequence(),
): ChallengeDefinition[] {
  return REQUIRED_LIVENESS_CHALLENGE_TYPES.map(type =>
    source.find(challenge => challenge.key === type),
  ).filter((challenge): challenge is ChallengeDefinition => Boolean(challenge))
}
