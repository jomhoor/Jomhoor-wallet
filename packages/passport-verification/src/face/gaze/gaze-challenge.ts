import type { GazeChallengeResult } from '../types'

// ============================================================================
// LEGACY TYPES (kept for backward compatibility)
// ============================================================================

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

// ============================================================================
// UNIFIED TYPES (new, for multi-mode architecture)
// ============================================================================

/**
 * Unified waypoint type used across all challenge modes (dot, face, pose).
 * Contains both screen positioning and target head pose angles.
 */
export type Waypoint = {
  /** Unique identifier for this waypoint (e.g., 'wp-1') */
  id: string
  /** 0-based index in the waypoint sequence */
  index: number
  /** Target head yaw rotation in degrees (negative = left, positive = right) */
  targetYawDeg: number
  /** Target head pitch tilt in degrees (negative = down, positive = up) */
  targetPitchDeg: number
  /** Normalized screen X position (0 = left, 1 = right), used for UI guidance */
  screenX: number
  /** Normalized screen Y position (0 = top, 1 = bottom), used for UI guidance */
  screenY: number
  /** Required hold duration in milliseconds to consider waypoint complete */
  holdMs: number
}

/**
 * Frame size information for waypoint generation and evaluation.
 */
export type FrameSize = {
  width: number
  height: number
}

/**
 * Challenge configuration (unified, preferred).
 * Controls waypoint generation, evaluation tolerances, and timing.
 */
export type UnifiedChallengeConfig = {
  /** Number of waypoints to complete in sequence */
  waypointCount: number
  /** Maximum head yaw rotation allowed (degrees from center) */
  maxYawDeg: number
  /** Maximum head pitch tilt allowed (degrees from center) */
  maxPitchDeg: number
  /** Tolerance for yaw evaluation: pass if |actualYaw - targetYaw| <= this (degrees) */
  yawToleranceDeg: number
  /** Tolerance for pitch evaluation: pass if |actualPitch - targetPitch| <= this (degrees) */
  pitchToleranceDeg: number
  /** Minimum time to hold a pose before waypoint is considered complete (milliseconds) */
  minHoldMs: number
  /** Maximum time allowed per waypoint before timeout failure (milliseconds) */
  maxWaypointMs: number
  /** Minimum yaw magnitude for mirror mode validation (degrees) */
  minYawForMirrorValidationDeg: number
  /** Number of samples needed to resolve mirror mode */
  mirrorValidationSamples: number
  /** Margin for mirror mode resolution (degrees) */
  mirrorValidationResolutionMarginDeg: number
  /** Minimum angular distance between consecutive waypoints (degrees) */
  minInterWaypointAngularDistanceDeg: number
  /** Start of interactive area on X axis (0 = left edge, 1 = right edge) */
  horizontalAreaStartRatio: number
  /** End of interactive area on X axis (0 = left edge, 1 = right edge) */
  horizontalAreaEndRatio: number
  /** Start of interactive area on Y axis (0 = top edge, 1 = bottom edge) */
  verticalAreaStartRatio: number
  /** End of interactive area on Y axis (0 = top edge, 1 = bottom edge) */
  verticalAreaEndRatio: number
}

/**
 * Per-frame sample evaluation result (unified).
 * Records whether a single frame's head pose matched the target waypoint.
 */
export type SampleEvaluation = {
  /** True if this frame's head pose is within tolerance of the target */
  passed: boolean
  /** Absolute yaw angle error from target (degrees) */
  yawErrorDeg: number
  /** Absolute pitch angle error from target (degrees) */
  pitchErrorDeg: number
}

/**
 * Per-frame sample with full context (unified).
 * Used to accumulate data during challenge for final scoring.
 */
export type ChallengeSample = {
  /** Which waypoint this sample was evaluated against (0-based) */
  waypointIndex: number
  /** Timestamp when this sample was recorded (milliseconds) */
  timestamp: number
  /** Evaluation result (passed/failed, errors) */
  passed: boolean
  yawErrorDeg: number
  pitchErrorDeg: number
  /** Observed head pose angle (degrees) */
  actualYaw: number
  actualPitch: number
  /** Target head pose angle from waypoint (degrees) */
  expectedYaw: number
  expectedPitch: number
  /** Mirror mode used in evaluation (optional, for pose mode) */
  mirrorMode?: 'normal' | 'mirrored'
  /** Confidence score for this sample (optional, 0-1) */
  confidence?: number
}

/**
 * Waypoint progress state during challenge execution (unified).
 * Tracks accumulated hold time and timeout for current waypoint.
 */
export type WaypointProgressState = {
  /** Accumulated time that pose has been held within tolerance (milliseconds) */
  stableMs: number
  /** Total elapsed time at current waypoint (milliseconds) */
  elapsedMs: number
  /** True when stable time >= minHoldMs */
  completed: boolean
  /** True when elapsed time >= maxWaypointMs */
  timedOut: boolean
}

// ============================================================================
// DEFAULT CONFIGURATIONS
// ============================================================================

const DEFAULT_LEGACY_CONFIG: GazeChallengeConfig = {
  waypointCount: 5,
  padding: 80,
  horizontalPadding: 80,
  verticalPadding: 80,
  yawRange: 18,
  pitchRange: 10,
  errorThreshold: 16,
  passRatioThreshold: 0.5,
  horizontalAreaStartRatio: 0.2,
  horizontalAreaEndRatio: 0.8,
  verticalAreaStartRatio: 0.2,
  verticalAreaEndRatio: 0.5,
}

const DEFAULT_UNIFIED_CONFIG: UnifiedChallengeConfig = {
  waypointCount: 4,
  maxYawDeg: 45,
  maxPitchDeg: 45,
  yawToleranceDeg: 15,
  pitchToleranceDeg: 15,
  minHoldMs: 700,
  maxWaypointMs: 4500,
  minYawForMirrorValidationDeg: 6,
  mirrorValidationSamples: 14,
  mirrorValidationResolutionMarginDeg: 1.5,
  minInterWaypointAngularDistanceDeg: 10,
  horizontalAreaStartRatio: 0.2,
  horizontalAreaEndRatio: 0.8,
  verticalAreaStartRatio: 0.2,
  verticalAreaEndRatio: 0.5,
}

// ============================================================================
// UTILITY FUNCTIONS (private)
// ============================================================================

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  if (inMax === inMin) return outMin
  const ratio = (value - inMin) / (inMax - inMin)
  return outMin + ratio * (outMax - outMin)
}

function nextWaypointId(index: number): string {
  return `wp-${index + 1}`
}

function mapWaypointToTargetPose(
  waypoint: Pick<Waypoint, 'screenX' | 'screenY'>,
  config: UnifiedChallengeConfig,
): Pick<Waypoint, 'targetYawDeg' | 'targetPitchDeg'> {
  const normalizedX = clamp(waypoint.screenX, 0, 1)
  const normalizedY = clamp(waypoint.screenY, 0, 1)

  const targetYawDeg = mapRange(normalizedX, 0, 1, -config.maxYawDeg, config.maxYawDeg)
  // Top of screen (Y=0) maps to "look up" (positive pitch in ML Kit terms)
  const targetPitchDeg = mapRange(normalizedY, 0, 1, config.maxPitchDeg, -config.maxPitchDeg)

  return { targetYawDeg, targetPitchDeg }
}

function angularDistance(
  pose1: Pick<Waypoint, 'targetYawDeg' | 'targetPitchDeg'>,
  pose2: Pick<Waypoint, 'targetYawDeg' | 'targetPitchDeg'>,
): number {
  const dx = pose1.targetYawDeg - pose2.targetYawDeg
  const dy = pose1.targetPitchDeg - pose2.targetPitchDeg
  return Math.sqrt(dx * dx + dy * dy)
}

// ============================================================================
// PUBLIC API (legacy, kept for backward compatibility)
// ============================================================================

export function getDefaultGazeChallengeConfig(): GazeChallengeConfig {
  return { ...DEFAULT_LEGACY_CONFIG }
}

export function generateGazeWaypoints(
  frameSize: GazeFrameSize,
  config?: Partial<GazeChallengeConfig>,
  random = Math.random,
): GazeWaypoint[] {
  const merged = { ...DEFAULT_LEGACY_CONFIG, ...(config ?? {}) }
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
  const merged = { ...DEFAULT_LEGACY_CONFIG, ...(config ?? {}) }
  const horizontalPadding = merged.horizontalPadding
  const verticalPadding = merged.verticalPadding
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
      : DEFAULT_LEGACY_CONFIG.passRatioThreshold

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

// ============================================================================
// PUBLIC API (unified, new, preferred)
// ============================================================================

/**
 * Get default configuration for unified gaze challenge.
 * Used by all modes (dot, face, pose).
 */
export function getDefaultUnifiedChallengeConfig(): UnifiedChallengeConfig {
  return { ...DEFAULT_UNIFIED_CONFIG }
}

/**
 * Generate randomized waypoints for the challenge.
 * Returns normalized screen coordinates and target head pose angles.
 * Used by all modes (dot, face, pose).
 *
 * @param frameSize Screen dimensions (used for area calculation, not stored)
 * @param config Challenge configuration (controls count, max angles, area bounds)
 * @param random Random number generator (default: Math.random)
 * @returns Array of Waypoint objects with randomized positions
 */
export function generateUnifiedGazeWaypoints(
  frameSize: FrameSize,
  config?: Partial<UnifiedChallengeConfig>,
  random = Math.random,
): Waypoint[] {
  const merged = { ...DEFAULT_UNIFIED_CONFIG, ...(config ?? {}) }

  const minX = merged.horizontalAreaStartRatio
  const maxX = merged.horizontalAreaEndRatio
  const minY = merged.verticalAreaStartRatio
  const maxY = merged.verticalAreaEndRatio
  const out: Waypoint[] = []

  for (let index = 0; index < merged.waypointCount; index++) {
    let candidate: Waypoint | null = null

    // Retry to ensure waypoints are sufficiently different
    for (let attempt = 0; attempt < 16; attempt++) {
      const screenX = clamp(minX + random() * (maxX - minX), 0, 1)
      const screenY = clamp(minY + random() * (maxY - minY), 0, 1)
      const target = mapWaypointToTargetPose({ screenX, screenY }, merged)

      const next: Waypoint = {
        id: nextWaypointId(index),
        index,
        screenX,
        screenY,
        targetYawDeg: target.targetYawDeg,
        targetPitchDeg: target.targetPitchDeg,
        holdMs: merged.minHoldMs,
      }

      const isFarEnough = out.every(existing => {
        return angularDistance(existing, next) >= merged.minInterWaypointAngularDistanceDeg
      })
      if (isFarEnough) {
        candidate = next
        break
      }
      if (!candidate) candidate = next
    }

    if (candidate) out.push(candidate)
  }

  return out
}

/**
 * Evaluate whether a single frame's head pose matches a waypoint target.
 * Called per-frame during challenge execution.
 * Used by all modes (dot, face, pose).
 *
 * @param actualYaw Observed yaw angle from face detection (degrees)
 * @param actualPitch Observed pitch angle from face detection (degrees)
 * @param targetYaw Target yaw angle from waypoint (degrees)
 * @param targetPitch Target pitch angle from waypoint (degrees)
 * @param config Challenge configuration (controls tolerances)
 * @returns Evaluation result with pass/fail and error magnitudes
 */
export function evaluateUnifiedGazeSample(
  actualYaw: number,
  actualPitch: number,
  targetYaw: number,
  targetPitch: number,
  config?: Partial<UnifiedChallengeConfig>,
): SampleEvaluation {
  const merged = { ...DEFAULT_UNIFIED_CONFIG, ...(config ?? {}) }

  const yawErrorDeg = Math.abs(actualYaw - targetYaw)
  const pitchErrorDeg = Math.abs(actualPitch - targetPitch)

  return {
    passed: yawErrorDeg <= merged.yawToleranceDeg && pitchErrorDeg <= merged.pitchToleranceDeg,
    yawErrorDeg,
    pitchErrorDeg,
  }
}

/**
 * Update waypoint progress state based on new frame evaluation.
 * Accumulates hold time if pose matches; resets if it drifts out.
 * Used by all modes (dot, face, pose).
 *
 * @param previous Previous progress state
 * @param params Update parameters (delta time, whether current pose matches target)
 * @returns Updated progress state with new accumulated times and completion status
 */
export function updateUnifiedWaypointProgress(
  previous: WaypointProgressState,
  params: {
    deltaMs: number
    matched: boolean
    config?: Partial<UnifiedChallengeConfig>
  },
): WaypointProgressState {
  const merged = { ...DEFAULT_UNIFIED_CONFIG, ...(params.config ?? {}) }
  const deltaMs = Math.max(params.deltaMs, 0)
  const elapsedMs = previous.elapsedMs + deltaMs
  const stableMs = params.matched ? previous.stableMs + deltaMs : 0
  const completed = stableMs >= merged.minHoldMs
  const timedOut = elapsedMs >= merged.maxWaypointMs

  return {
    stableMs,
    elapsedMs,
    completed,
    timedOut,
  }
}

/**
 * Build final challenge result from collected samples.
 * Calculates score and determines overall pass/fail.
 * Used by all modes (dot, face, pose).
 *
 * @param params Result parameters (samples, waypoint counts, timing)
 * @returns Final GazeChallengeResult for the challenge
 */
export function buildUnifiedGazeChallengeResult(params: {
  samples: ChallengeSample[]
  targetsCompleted: number
  targetsTotal: number
  startedAt: number
  completedAt: number
  passRatioThreshold?: number
}): GazeChallengeResult {
  const passedSamples = params.samples.filter(sample => sample.passed).length
  const score = params.samples.length > 0 ? passedSamples / params.samples.length : 0
  const threshold = params.passRatioThreshold ?? 0.5

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
