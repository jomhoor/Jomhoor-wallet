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
  horizontalPadding: number
  verticalPadding: number
  yawRange: number
  pitchRange: number
  errorThreshold: number
  passRatioThreshold: number
  horizontalAreaStartRatio: number
  horizontalAreaEndRatio: number
  verticalAreaStartRatio: number
  verticalAreaEndRatio: number
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
  horizontalPadding: 80, // Horizontal inset for waypoint generation/mapping
  verticalPadding: 80, // Vertical inset for waypoint generation/mapping
  yawRange: 18, // Softer yaw target range for better usability
  pitchRange: 10, // Softer pitch target range for better usability
  errorThreshold: 16, // More tolerant threshold for regular users
  passRatioThreshold: 0.5, // Lower pass ratio makes challenge easier to complete
  horizontalAreaStartRatio: 0.2, // Start of interactive area on X axis (0.2 = left edge)
  horizontalAreaEndRatio: 0.8, // End of interactive area on X axis (0.8 = right edge)
  verticalAreaStartRatio: 0.2, // Start of interactive area on Y axis (0.2 = top edge)
  verticalAreaEndRatio: 0.5, // End of interactive area on Y axis (0.5 = top half only)
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
  const horizontalPadding = merged.horizontalPadding ?? merged.padding
  const verticalPadding = merged.verticalPadding ?? merged.padding
  const areaStartX = frameSize.width * merged.horizontalAreaStartRatio
  const areaEndX = frameSize.width * merged.horizontalAreaEndRatio
  const areaStartY = frameSize.height * merged.verticalAreaStartRatio
  const areaEndY = frameSize.height * merged.verticalAreaEndRatio

  const minX = areaStartX + horizontalPadding
  const maxX = Math.max(areaEndX - horizontalPadding, minX + 1)
  const minY = areaStartY + verticalPadding
  const maxY = Math.max(areaEndY - verticalPadding, minY + 1)

  return Array.from({ length: merged.waypointCount }, () => ({
    x: minX + random() * (maxX - minX),
    y: minY + random() * (maxY - minY),
  }))
}

export function evaluateGazeSample(
  face: GazeDetectorFace,
  waypoint: GazeWaypoint,
  frameSize: GazeFrameSize,
  config?: Partial<GazeChallengeConfig>,
): GazeSampleEvaluation {
  const merged = { ...DEFAULT_GAZE_CHALLENGE_CONFIG, ...(config ?? {}) }
  const horizontalPadding = merged.horizontalPadding ?? merged.padding
  const verticalPadding = merged.verticalPadding ?? merged.padding
  const areaStartX = frameSize.width * merged.horizontalAreaStartRatio + horizontalPadding
  const areaEndX = frameSize.width * merged.horizontalAreaEndRatio - horizontalPadding
  const areaStartY = frameSize.height * merged.verticalAreaStartRatio + verticalPadding
  const areaEndY = frameSize.height * merged.verticalAreaEndRatio - verticalPadding

  const centerX = (areaStartX + areaEndX) / 2
  const centerY = (areaStartY + areaEndY) / 2
  const halfAreaWidth = Math.max((areaEndX - areaStartX) / 2, 1)
  const halfAreaHeight = Math.max((areaEndY - areaStartY) / 2, 1)

  const expectedYaw = ((waypoint.x - centerX) / halfAreaWidth) * merged.yawRange
  const expectedPitch = ((waypoint.y - centerY) / halfAreaHeight) * merged.pitchRange

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
