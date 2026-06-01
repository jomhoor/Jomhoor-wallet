import type { Waypoint } from '@iland/passport-verification'

export function appendFinalCenterCaptureWaypoint(
  waypoints: Waypoint[],
  minHoldMs: number,
): Waypoint[] {
  return [
    ...waypoints,
    {
      holdMs: Math.max(minHoldMs, 900),
      id: 'wp-final-center-capture',
      index: waypoints.length,
      screenX: 0.5,
      screenY: 0.5,
      targetPitchDeg: 0,
      targetYawDeg: 0,
    },
  ]
}
