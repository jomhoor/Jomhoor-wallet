/// <reference types="jest" />

import {
  createHeadPoseMirrorValidationState,
  createHeadPoseWaypoints,
  createInitialHeadPoseWaypointProgress,
  evaluateHeadPoseSample,
  mapWaypointToTargetPose,
  resolveHeadPoseMirrorModeFromValidation,
  updateHeadPoseMirrorValidationState,
  updateHeadPoseWaypointProgress,
} from '@iland/passport-verification/face'

describe('head pose challenge logic', () => {
  it('maps waypoint coordinates into yaw/pitch ranges', () => {
    const center = mapWaypointToTargetPose({ x: 0.5, y: 0.5 })
    expect(center.targetYawDeg).toBeCloseTo(0, 3)
    expect(center.targetPitchDeg).toBeCloseTo(0, 3)

    const topLeft = mapWaypointToTargetPose({ x: 0, y: 0 })
    expect(topLeft.targetYawDeg).toBeLessThan(0)
    expect(topLeft.targetPitchDeg).toBeGreaterThan(0)
  })

  it('creates waypointCount randomized waypoints with target pose values', () => {
    const waypoints = createHeadPoseWaypoints({ width: 360, height: 760 }, { waypointCount: 3 }, () =>
      0.5,
    )

    expect(waypoints).toHaveLength(3)
    waypoints.forEach(waypoint => {
      expect(waypoint.x).toBeGreaterThanOrEqual(0)
      expect(waypoint.x).toBeLessThanOrEqual(1)
      expect(waypoint.y).toBeGreaterThanOrEqual(0)
      expect(waypoint.y).toBeLessThanOrEqual(1)
      expect(typeof waypoint.targetYawDeg).toBe('number')
      expect(typeof waypoint.targetPitchDeg).toBe('number')
    })
  })

  it('resolves mirrored mode when mirrored yaw error is consistently lower', () => {
    let mirrorState = createHeadPoseMirrorValidationState()

    for (let index = 0; index < 14; index++) {
      mirrorState = updateHeadPoseMirrorValidationState(mirrorState, {
        detectedYawDeg: -10,
        targetYawDeg: 10,
      })
    }

    const mode = resolveHeadPoseMirrorModeFromValidation(mirrorState)
    expect(mode).toBe('mirrored')
  })

  it('evaluates with mirrored mode by flipping yaw comparison sign', () => {
    const evaluation = evaluateHeadPoseSample(
      { yawDeg: -12, pitchDeg: 3 },
      { targetYawDeg: 12, targetPitchDeg: 3 },
      'mirrored',
    )

    expect(evaluation.passed).toBe(true)
    expect(evaluation.usedMirrorMode).toBe('mirrored')
    expect(evaluation.yawErrorDeg).toBeLessThanOrEqual(1)
  })

  it('resets hold accumulation when pose leaves tolerance and times out correctly', () => {
    const base = createInitialHeadPoseWaypointProgress()

    const first = updateHeadPoseWaypointProgress(base, {
      deltaMs: 400,
      matched: true,
      config: { minHoldMs: 700, maxWaypointMs: 1000 },
    })
    expect(first.completed).toBe(false)
    expect(first.stableMs).toBe(400)

    const reset = updateHeadPoseWaypointProgress(first, {
      deltaMs: 100,
      matched: false,
      config: { minHoldMs: 700, maxWaypointMs: 1000 },
    })
    expect(reset.stableMs).toBe(0)

    const timeout = updateHeadPoseWaypointProgress(reset, {
      deltaMs: 550,
      matched: false,
      config: { minHoldMs: 700, maxWaypointMs: 1000 },
    })

    expect(timeout.timedOut).toBe(true)
    expect(timeout.completed).toBe(false)
  })
})
