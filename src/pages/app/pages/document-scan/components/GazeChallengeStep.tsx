import GazeChallengeContainer from './gaze-challenge/gaze-challenge-container'

/**
 * Gaze Challenge Step Component
 *
 * Delegates to GazeChallengeContainer which provides the unified multi-mode
 * implementation of the gaze/liveness challenge.
 *
 * Modes:
 * - "dot": User follows a moving dot with their gaze
 * - "face": User matches a rotating guiding face avatar
 * - "pose": User performs head rotation movements
 *
 * Mode is controlled by GAZE_CHALLENGE_MODE constant in the config.
 */
export default function GazeChallengeStep(): JSX.Element {
  return <GazeChallengeContainer />
}
