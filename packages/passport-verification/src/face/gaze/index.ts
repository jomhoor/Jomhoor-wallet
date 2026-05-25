// ============================================================================
// LEGACY EXPORTS (kept for backward compatibility)
// ============================================================================

export {
  buildGazeChallengeResult,
  evaluateGazeSample,
  generateGazeWaypoints,
  getDefaultGazeChallengeConfig,
  type GazeChallengeConfig,
  type GazeDetectorFace,
  type GazeFrameSize,
  type GazeSample,
  type GazeSampleEvaluation,
  type GazeWaypoint,
} from './gaze-challenge'

export {
  createHeadPoseMirrorValidationState,
  createHeadPoseWaypoints,
  createInitialHeadPoseWaypointProgress,
  evaluateHeadPoseSample,
  getDefaultHeadPoseChallengeConfig,
  mapWaypointToTargetPose,
  resolveHeadPoseMirrorModeFromValidation,
  updateHeadPoseMirrorValidationState,
  updateHeadPoseWaypointProgress,
  type HeadPose,
  type HeadPoseChallengeConfig,
  type HeadPoseFrameSize,
  type HeadPoseMirrorMode,
  type HeadPoseMirrorValidationState,
  type HeadPoseSampleEvaluation,
  type HeadPoseWaypoint,
  type HeadPoseWaypointProgressState,
} from './head-pose-challenge'

// ============================================================================
// UNIFIED EXPORTS (new, preferred for multi-mode architecture)
// ============================================================================

export {
  buildUnifiedGazeChallengeResult,
  evaluateUnifiedGazeSample,
  generateUnifiedGazeWaypoints,
  getDefaultUnifiedChallengeConfig,
  type ChallengeSample,
  type FrameSize,
  type SampleEvaluation,
  type UnifiedChallengeConfig,
  type Waypoint,
  type WaypointProgressState,
  updateUnifiedWaypointProgress,
} from './gaze-challenge'

export { GAZE_CHALLENGE_MODE, type GazeChallengeMode } from './config'
