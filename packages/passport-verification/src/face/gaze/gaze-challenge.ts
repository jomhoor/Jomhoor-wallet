import type { GazeChallengeResult } from '../types'

export type GazeDetectorFace = {
  yawAngle?: number
  pitchAngle?: number
}

export type GazeWaypoint = {
  x: number
  y: number
}

export type GazeFrameSize = {
  width: number
  height: number
}

export type GazeChallengeConfig = {
  waypointCount: number
  padding: number
  yawRange: number
  pitchRange: number
  errorThreshold: number
  passRatioThreshold: number
}

export type GazeSampleEvaluation = {
  passed: boolean
  yawError: number
  pitchError: number
  expectedYaw: number
  expectedPitch: number
  actualYaw: number
  actualPitch: number
}

export type GazeSample = GazeSampleEvaluation & {
  waypointIndex: number
  timestamp: number
}

const DEFAULT_GAZE_CHALLENGE_CONFIG: GazeChallengeConfig = {
  waypointCount: 5, // Total number of gaze waypoints to complete in the challenge
  padding: 80, // Minimum distance from the edges of the frame for waypoints
  yawRange: 25, // Maximum yaw angle range for gaze
  pitchRange: 15, // Maximum pitch angle range for gaze
  errorThreshold: 12, // Maximum allowable error for gaze to be considered correct
  passRatioThreshold: 0.7, // Minimum ratio of passed samples required to pass the challenge
}

export function getDefaultGazeChallengeConfig(): GazeChallengeConfig {
  return { ...DEFAULT_GAZE_CHALLENGE_CONFIG }
}

export function generateGazeWaypoints(
  frameSize: GazeFrameSize,
  config?: Partial<GazeChallengeConfig>,
  random = Math.random,
): GazeWaypoint[] {
  const merged = { ...DEFAULT_GAZE_CHALLENGE_CONFIG, ...(config ?? {}) }
  const maxX = Math.max(frameSize.width - merged.padding * 2, 1)
  const maxY = Math.max(frameSize.height - merged.padding * 2, 1)

  return Array.from({ length: merged.waypointCount }, () => ({
    x: merged.padding + random() * maxX,
    y: merged.padding + random() * maxY,
  }))
}

export function evaluateGazeSample(
  face: GazeDetectorFace,
  waypoint: GazeWaypoint,
  frameSize: GazeFrameSize,
  config?: Partial<GazeChallengeConfig>,
): GazeSampleEvaluation {
  const merged = { ...DEFAULT_GAZE_CHALLENGE_CONFIG, ...(config ?? {}) }
  const halfWidth = Math.max(frameSize.width / 2, 1)
  const halfHeight = Math.max(frameSize.height / 2, 1)

  const expectedYaw = ((waypoint.x - halfWidth) / halfWidth) * merged.yawRange
  const expectedPitch = ((waypoint.y - halfHeight) / halfHeight) * merged.pitchRange

  const actualYaw = face.yawAngle ?? 0
  const actualPitch = face.pitchAngle ?? 0

  const yawError = Math.abs(actualYaw - expectedYaw)
  const pitchError = Math.abs(actualPitch - expectedPitch)

  return {
    passed: yawError < merged.errorThreshold && pitchError < merged.errorThreshold,
    yawError,
    pitchError,
    expectedYaw,
    expectedPitch,
    actualYaw,
    actualPitch,
  }
}

export function buildGazeChallengeResult(params: {
  samples: GazeSample[]
  targetsCompleted: number
  targetsTotal: number
  startedAt: number
  completedAt: number
  passRatioThreshold?: number
}): GazeChallengeResult {
  const passedSamples = params.samples.filter(sample => sample.passed).length
  const score = params.samples.length > 0 ? passedSamples / params.samples.length : 0
  const threshold =
    typeof params.passRatioThreshold === 'number'
      ? params.passRatioThreshold
      : DEFAULT_GAZE_CHALLENGE_CONFIG.passRatioThreshold

  const completedAllTargets = params.targetsCompleted >= params.targetsTotal
  const passed = completedAllTargets && score >= threshold

  return {
    passed,
    score: Number(score.toFixed(3)),
    targetsCompleted: params.targetsCompleted,
    targetsTotal: params.targetsTotal,
    durationMs: Math.max(params.completedAt - params.startedAt, 0),
    debug: {
      sampleCount: params.samples.length,
      passRatioThreshold: threshold,
    },
  }
}
