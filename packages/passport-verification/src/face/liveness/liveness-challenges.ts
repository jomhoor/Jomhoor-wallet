import type { LivenessChallengeResult, LivenessResult } from '../types'

export type DetectorFace = {
  leftEyeOpenProbability?: number
  rightEyeOpenProbability?: number
  smilingProbability?: number
  yawAngle?: number
}

export type ChallengeDefinition = {
  key: LivenessChallengeResult['type']
  prompt: string
  evaluate: (face: DetectorFace) => { passed: boolean; confidence?: number }
}

const BLINK_THRESHOLD = 0.2
const SMILE_THRESHOLD = 0.7
const TURN_THRESHOLD = 15

const LIVENESS_CHALLENGES: ChallengeDefinition[] = [
  {
    key: 'blink',
    prompt: ' 😌 Blink your eyes',
    evaluate: face => {
      const left = face.leftEyeOpenProbability ?? 1
      const right = face.rightEyeOpenProbability ?? 1
      const passed = left < BLINK_THRESHOLD && right < BLINK_THRESHOLD
      const confidence = 1 - Math.max(left, right)

      return { passed, confidence: Number(confidence.toFixed(3)) }
    },
  },
  {
    key: 'smile',
    prompt: '🙂 Smile',
    evaluate: face => {
      const smile = face.smilingProbability ?? 0

      return {
        passed: smile > SMILE_THRESHOLD,
        confidence: Number(smile.toFixed(3)),
      }
    },
  },
  {
    key: 'turn_left',
    prompt: 'Turn your head slightly',
    evaluate: face => {
      const yaw = face.yawAngle ?? 0
      const magnitude = Math.abs(yaw)

      return {
        passed: magnitude > TURN_THRESHOLD,
        confidence: Number(Math.min(magnitude / 40, 1).toFixed(3)),
      }
    },
  },
]

function shuffle<T>(input: T[]): T[] {
  const copy = [...input]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }

  return copy
}

export function createLivenessChallengeSequence(): ChallengeDefinition[] {
  return shuffle(LIVENESS_CHALLENGES)
}

export function evaluateLivenessChallenge(
  challenge: ChallengeDefinition,
  face: DetectorFace,
): { passed: boolean; confidence?: number } {
  return challenge.evaluate(face)
}

export function buildLivenessResult(params: {
  sequence: ChallengeDefinition[]
  confidenceByKey: Partial<Record<LivenessChallengeResult['type'], number>>
  startedAt: number
  completedAt: number
}): LivenessResult {
  return {
    passed: true,
    startedAt: params.startedAt,
    completedAt: params.completedAt,
    challenges: params.sequence.map(item => ({
      type: item.key,
      passed: true,
      ...(typeof params.confidenceByKey[item.key] === 'number'
        ? { confidence: params.confidenceByKey[item.key] }
        : {}),
    })),
  }
}
