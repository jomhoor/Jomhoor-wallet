/**
 * Configuration for gaze/liveness challenge mode selection and behavior.
 *
 * This module exports a central constant that controls which challenge mode is active
 * across all challenge implementations (dot, face, pose modes).
 */

/**
 * Selectable gaze challenge mode.
 *
 * - `"dot"`: User follows a moving dot with their gaze (eyes only)
 * - `"face"`: User matches a rotating guiding face avatar (gaze + head pose)
 * - `"smart-face"`: Sophisticated wireframe face with sphere-projection math and iris gaze tracking
 * - `"pose"`: User performs head rotation movements (head pose only, explicit instructions)
 */
export type GazeChallengeMode = 'dot' | 'face' | 'smart-face' | 'pose'

/**
 * Currently active gaze challenge mode.
 *
 * This single constant controls the visualization and interaction style for all
 * gaze/liveness challenges in the application. All modes use the same underlying
 * evaluation logic (head pose angles from ML Kit face detection), but differ in:
 *
 * - Visual guidance: dot vs face avatar vs text prompts
 * - User experience: follow dot vs match face vs follow instructions
 * - Liveness strength: gaze detection vs head rotation detection
 *
 * Change this constant to switch modes. All modes produce identical GazeChallengeResult
 * format for backward compatibility.
 */
export const GAZE_CHALLENGE_MODE: GazeChallengeMode = 'smart-face'
