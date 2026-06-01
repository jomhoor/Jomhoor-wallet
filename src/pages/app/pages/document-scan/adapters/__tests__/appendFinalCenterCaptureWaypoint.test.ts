/// <reference types="jest" />

import type { Waypoint } from '@iland/passport-verification'

import { appendFinalCenterCaptureWaypoint } from '../appendFinalCenterCaptureWaypoint'

describe('appendFinalCenterCaptureWaypoint', () => {
  it('adds one centered final waypoint for automatic live photo capture', () => {
    const waypoint: Waypoint = {
      holdMs: 700,
      id: 'wp-1',
      index: 0,
      screenX: 0.2,
      screenY: 0.3,
      targetPitchDeg: 5,
      targetYawDeg: -10,
    }

    const result = appendFinalCenterCaptureWaypoint([waypoint], 700)

    expect(result).toHaveLength(2)
    expect(result[1]).toEqual({
      holdMs: 900,
      id: 'wp-final-center-capture',
      index: 1,
      screenX: 0.5,
      screenY: 0.5,
      targetPitchDeg: 0,
      targetYawDeg: 0,
    })
  })
})
