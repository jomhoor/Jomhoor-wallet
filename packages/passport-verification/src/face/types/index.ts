export type LivenessChallengeType =
  | 'blink'
  | 'smile'
  | 'turn_left'
  | 'turn_right'
  | 'look_at_target'
  | 'custom'

export type LivenessChallengeResult = {
  type: LivenessChallengeType
  passed: boolean
  confidence?: number
  durationMs?: number
  debug?: Record<string, unknown>
}

export type LivenessResult = {
  passed: boolean
  challenges: LivenessChallengeResult[]
  startedAt?: number
  completedAt?: number
}

export type GazeChallengeResult = {
  passed: boolean
  score: number
  targetsCompleted?: number
  targetsTotal?: number
  durationMs?: number
  debug?: Record<string, unknown>
}

export type FaceComparisonResult = {
  passed: boolean
  similarity: number
  threshold: number
  model?: string
  liveImage?: {
    base64?: string
    filePath?: string
  }
  referenceImage?: {
    base64?: string
    filePath?: string
  }
  debug?: Record<string, unknown>
}

export type FaceVerificationConfig = {
  livenessEnabled?: boolean
  gazeEnabled?: boolean
  comparisonEnabled?: boolean
  comparisonThreshold?: number
  modelSource?: 'bundled' | 'remote' | 'host-provided'
}
