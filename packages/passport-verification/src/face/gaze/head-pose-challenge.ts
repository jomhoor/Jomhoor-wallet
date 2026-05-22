export type HeadPose = {
  yawDeg: number
  pitchDeg: number
  rollDeg?: number
}

export type HeadPoseFrameSize = {
  width: number
  height: number
}

export type HeadPoseWaypoint = {
  id: string
  x: number
  y: number
  targetYawDeg: number
  targetPitchDeg: number
  holdMs: number
}

export type HeadPoseMirrorMode = 'unknown' | 'normal' | 'mirrored'

export type HeadPoseChallengeConfig = {
  waypointCount: number
  maxYawDeg: number
  maxPitchDeg: number
  yawToleranceDeg: number
  pitchToleranceDeg: number
  minHoldMs: number
  maxWaypointMs: number
  minYawForMirrorValidationDeg: number
  mirrorValidationSamples: number
  mirrorValidationResolutionMarginDeg: number
  minInterWaypointAngularDistanceDeg: number
  horizontalAreaStartRatio: number
  horizontalAreaEndRatio: number
  verticalAreaStartRatio: number
  verticalAreaEndRatio: number
}

export type HeadPoseMirrorValidationState = {
  sampleCount: number
  normalYawErrorSum: number
  mirroredYawErrorSum: number
  resolvedMode: HeadPoseMirrorMode
}

export type HeadPoseSampleEvaluation = {
  passed: boolean
  yawErrorDeg: number
  pitchErrorDeg: number
  usedMirrorMode: Exclude<HeadPoseMirrorMode, 'unknown'>
}

export type HeadPoseWaypointProgressState = {
  stableMs: number
  elapsedMs: number
  completed: boolean
  timedOut: boolean
}

const DEFAULT_HEAD_POSE_CHALLENGE_CONFIG: HeadPoseChallengeConfig = {
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

export function getDefaultHeadPoseChallengeConfig(): HeadPoseChallengeConfig {
  return { ...DEFAULT_HEAD_POSE_CHALLENGE_CONFIG }
}

export function createHeadPoseMirrorValidationState(): HeadPoseMirrorValidationState {
  return {
    sampleCount: 0,
    normalYawErrorSum: 0,
    mirroredYawErrorSum: 0,
    resolvedMode: 'unknown',
  }
}

export function createInitialHeadPoseWaypointProgress(): HeadPoseWaypointProgressState {
  return {
    stableMs: 0,
    elapsedMs: 0,
    completed: false,
    timedOut: false,
  }
}

export function mapWaypointToTargetPose(
  waypoint: Pick<HeadPoseWaypoint, 'x' | 'y'>,
  config?: Partial<HeadPoseChallengeConfig>,
): Pick<HeadPoseWaypoint, 'targetYawDeg' | 'targetPitchDeg'> {
  const merged = { ...DEFAULT_HEAD_POSE_CHALLENGE_CONFIG, ...(config ?? {}) }
  const normalizedX = clamp(waypoint.x, 0, 1)
  const normalizedY = clamp(waypoint.y, 0, 1)

  const targetYawDeg = mapRange(normalizedX, 0, 1, -merged.maxYawDeg, merged.maxYawDeg)
  // Top of the screen should map to "look up" (positive pitch in ML Kit terms).
  const targetPitchDeg = mapRange(normalizedY, 0, 1, merged.maxPitchDeg, -merged.maxPitchDeg)

  return {
    targetYawDeg,
    targetPitchDeg,
  }
}

function angularDistance(
  lhs: Pick<HeadPoseWaypoint, 'targetYawDeg' | 'targetPitchDeg'>,
  rhs: Pick<HeadPoseWaypoint, 'targetYawDeg' | 'targetPitchDeg'>,
): number {
  const dx = lhs.targetYawDeg - rhs.targetYawDeg
  const dy = lhs.targetPitchDeg - rhs.targetPitchDeg
  return Math.sqrt(dx * dx + dy * dy)
}

export function createHeadPoseWaypoints(
  _frameSize: HeadPoseFrameSize,
  config?: Partial<HeadPoseChallengeConfig>,
  random = Math.random,
): HeadPoseWaypoint[] {
  const merged = { ...DEFAULT_HEAD_POSE_CHALLENGE_CONFIG, ...(config ?? {}) }

  const minX = merged.horizontalAreaStartRatio
  const maxX = merged.horizontalAreaEndRatio
  const minY = merged.verticalAreaStartRatio
  const maxY = merged.verticalAreaEndRatio
  const out: HeadPoseWaypoint[] = []

  for (let index = 0; index < merged.waypointCount; index++) {
    let candidate: HeadPoseWaypoint | null = null

    // Retry several times to keep waypoints sufficiently different.
    for (let attempt = 0; attempt < 16; attempt++) {
      const x = clamp(minX + random() * (maxX - minX), 0, 1)
      const y = clamp(minY + random() * (maxY - minY), 0, 1)
      const target = mapWaypointToTargetPose({ x, y }, merged)

      const next: HeadPoseWaypoint = {
        id: nextWaypointId(index),
        x,
        y,
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

export function resolveHeadPoseMirrorModeFromValidation(
  state: HeadPoseMirrorValidationState,
): HeadPoseMirrorMode {
  if (state.resolvedMode !== 'unknown') return state.resolvedMode
  if (state.sampleCount <= 0) return 'unknown'

  const avgNormal = state.normalYawErrorSum / state.sampleCount
  const avgMirrored = state.mirroredYawErrorSum / state.sampleCount
  return avgMirrored < avgNormal ? 'mirrored' : 'normal'
}

export function updateHeadPoseMirrorValidationState(
  state: HeadPoseMirrorValidationState,
  params: {
    detectedYawDeg: number
    targetYawDeg: number
    config?: Partial<HeadPoseChallengeConfig>
  },
): HeadPoseMirrorValidationState {
  if (state.resolvedMode !== 'unknown') return state

  const merged = { ...DEFAULT_HEAD_POSE_CHALLENGE_CONFIG, ...(params.config ?? {}) }
  if (Math.abs(params.targetYawDeg) < merged.minYawForMirrorValidationDeg) {
    return state
  }

  const normalYawError = Math.abs(params.detectedYawDeg - params.targetYawDeg)
  const mirroredYawError = Math.abs(-params.detectedYawDeg - params.targetYawDeg)
  const sampleCount = state.sampleCount + 1
  const normalYawErrorSum = state.normalYawErrorSum + normalYawError
  const mirroredYawErrorSum = state.mirroredYawErrorSum + mirroredYawError

  let resolvedMode: HeadPoseMirrorMode = 'unknown'
  if (sampleCount >= merged.mirrorValidationSamples) {
    const avgNormal = normalYawErrorSum / sampleCount
    const avgMirrored = mirroredYawErrorSum / sampleCount
    resolvedMode =
      avgMirrored + merged.mirrorValidationResolutionMarginDeg < avgNormal ? 'mirrored' : 'normal'
  }

  return {
    sampleCount,
    normalYawErrorSum,
    mirroredYawErrorSum,
    resolvedMode,
  }
}

function evaluateWithMirrorMode(
  currentPose: HeadPose,
  waypoint: Pick<HeadPoseWaypoint, 'targetYawDeg' | 'targetPitchDeg'>,
  config: HeadPoseChallengeConfig,
  mirrorMode: Exclude<HeadPoseMirrorMode, 'unknown'>,
): HeadPoseSampleEvaluation {
  const adjustedYaw = mirrorMode === 'mirrored' ? -currentPose.yawDeg : currentPose.yawDeg
  const yawErrorDeg = Math.abs(adjustedYaw - waypoint.targetYawDeg)
  const pitchErrorDeg = Math.abs(currentPose.pitchDeg - waypoint.targetPitchDeg)

  return {
    passed: yawErrorDeg <= config.yawToleranceDeg && pitchErrorDeg <= config.pitchToleranceDeg,
    yawErrorDeg,
    pitchErrorDeg,
    usedMirrorMode: mirrorMode,
  }
}

export function evaluateHeadPoseSample(
  currentPose: HeadPose,
  waypoint: Pick<HeadPoseWaypoint, 'targetYawDeg' | 'targetPitchDeg'>,
  mirrorMode: HeadPoseMirrorMode,
  config?: Partial<HeadPoseChallengeConfig>,
): HeadPoseSampleEvaluation {
  const merged = { ...DEFAULT_HEAD_POSE_CHALLENGE_CONFIG, ...(config ?? {}) }

  if (mirrorMode !== 'unknown') {
    return evaluateWithMirrorMode(currentPose, waypoint, merged, mirrorMode)
  }

  const normal = evaluateWithMirrorMode(currentPose, waypoint, merged, 'normal')
  const mirrored = evaluateWithMirrorMode(currentPose, waypoint, merged, 'mirrored')

  if (mirrored.yawErrorDeg < normal.yawErrorDeg) return mirrored
  return normal
}

export function updateHeadPoseWaypointProgress(
  previous: HeadPoseWaypointProgressState,
  params: {
    deltaMs: number
    matched: boolean
    config?: Partial<HeadPoseChallengeConfig>
  },
): HeadPoseWaypointProgressState {
  const merged = { ...DEFAULT_HEAD_POSE_CHALLENGE_CONFIG, ...(params.config ?? {}) }
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
