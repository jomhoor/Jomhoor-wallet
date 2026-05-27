import type { Waypoint } from '@iland/passport-verification'
import type { HeadPoseMirrorMode } from '@iland/passport-verification'

export type GazeState = 'idle' | 'running' | 'success' | 'failed'

export type GazeChallengeComponentProps = {
  // Challenge state
  isRunning: boolean
  waypointIndex: number
  waypoints: Waypoint[]
  latestScorePercent: number
  totalTargets: number

  // Face detection state
  faceDetected: boolean
  multipleFaces: boolean
  mirrorMode?: HeadPoseMirrorMode

  // Screen dimensions
  screenWidth: number
  screenHeight: number

  // Actions
  onStart: () => void
  onRetry: () => void
  onExit: () => void
}
