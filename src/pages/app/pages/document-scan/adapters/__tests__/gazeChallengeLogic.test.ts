/// <reference types="jest" />

import {
  buildGazeChallengeResult,
  evaluateGazeSample,
  type GazeDetectorFace,
  generateGazeWaypoints,
} from '@iland/passport-verification'

describe('gaze challenge logic', () => {
  it('generates waypoint count within frame bounds', () => {
    const waypoints = generateGazeWaypoints({ width: 360, height: 760 }, { waypointCount: 3 }, () =>
      0.5,
    )

    expect(waypoints).toHaveLength(3)
    waypoints.forEach(waypoint => {
      expect(waypoint.x).toBeGreaterThan(0)
      expect(waypoint.x).toBeLessThan(360)
      expect(waypoint.y).toBeGreaterThan(0)
      expect(waypoint.y).toBeLessThan(760)
    })
  })

  it('evaluates sample as passed when yaw/pitch are near expected values', () => {
    const waypoint = { x: 180, y: 380 }
    const face: GazeDetectorFace = { yawAngle: 0, pitchAngle: 0 }

    const evaluation = evaluateGazeSample(face, waypoint, { width: 360, height: 760 })

    expect(evaluation.passed).toBe(true)
    expect(evaluation.yawError).toBeLessThan(12)
    expect(evaluation.pitchError).toBeLessThan(12)
  })

  it('builds failed result when pass ratio is below threshold', () => {
    const result = buildGazeChallengeResult({
      samples: [
        {
          passed: false,
          yawError: 20,
          pitchError: 20,
          expectedYaw: 10,
          expectedPitch: 10,
          actualYaw: -10,
          actualPitch: -10,
          waypointIndex: 0,
          timestamp: 1000,
        },
      ],
      targetsCompleted: 1,
      targetsTotal: 1,
      startedAt: 1000,
      completedAt: 2000,
    })

    expect(result.passed).toBe(false)
    expect(result.score).toBe(0)
    expect(result.targetsCompleted).toBe(1)
    expect(result.targetsTotal).toBe(1)
    expect(result.durationMs).toBe(1000)
  })
})
