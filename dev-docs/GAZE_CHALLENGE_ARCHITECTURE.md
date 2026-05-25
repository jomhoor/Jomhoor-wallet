# Gaze Challenge Architecture Investigation

**Date:** 2026-05-25  
**Objective:** Design a unified architecture where each challenge mode lives in its own file but shares a common challenge protocol.

---

## 1. Current Architecture Analysis

### 1.1 File Structure (Current State)

```
packages/passport-verification/src/face/gaze/
├── gaze-challenge.ts          ← LEGACY (not in use)
├── head-pose-challenge.ts     ← ACTIVE (currently used)
└── index.ts
```

```
src/pages/app/pages/document-scan/
├── components/
│   └── GazeChallengeStep.tsx   ← MONOLITHIC (camera + logic + UI)
├── ScanProvider/
└── adapters/__tests__/
    ├── gazeChallengeLogic.test.ts      ← tests for gaze-challenge (unused)
    └── headPoseChallengeLogic.test.ts  ← tests for head-pose-challenge (used)
```

### 1.2 Which Module Is Currently Active?

**Surprising finding:** The codebase is using `head-pose-challenge.ts`, NOT `gaze-challenge.ts`.

**Evidence:**

- Line 283 in GazeChallengeStep.tsx: `createHeadPoseWaypoints(...)` ← from head-pose-challenge
- Line 368: `evaluateHeadPoseSample(...)` ← from head-pose-challenge
- Lines 1-16 imports: all `createHeadPose*`, `evaluateHeadPose*`, `getDefaultHeadPoseChallenge*`

**Status of legacy gaze-challenge.ts:**

- Exports `generateGazeWaypoints()` and `evaluateGazeSample()`
- Uses pixel-coordinate waypoints (x, y in screen space)
- Uses yaw/pitch angles from ML Kit face detection
- Has test coverage but is **not imported anywhere in the codebase**
- Represents an older, simpler design

**Implication:** If we want to unify, we have two options:

1. Keep head-pose-challenge as the source of truth (modern, well-tested, more features)
2. Refactor gaze-challenge.ts to be a shim that wraps head-pose logic

**Recommendation:** Use head-pose-challenge as the source of truth, since it's already integrated and tested in production.

---

## 2. Type Analysis & Contract Mismatch

### 2.1 Waypoint Types

**gaze-challenge.ts:**

```typescript
export type GazeWaypoint = {
  x: number // pixel X coordinate (0 to frameWidth)
  y: number // pixel Y coordinate (0 to frameHeight)
}
```

**head-pose-challenge.ts:**

```typescript
export type HeadPoseWaypoint = {
  id: string // e.g., 'wp-1'
  x: number // normalized (0.2 to 0.8, used for visual positioning)
  y: number // normalized (0.2 to 0.5, used for visual positioning)
  targetYawDeg: number // target head rotation angle
  targetPitchDeg: number // target head tilt angle
  holdMs: number // required hold duration (700ms)
}
```

**Mismatch Analysis:**

- `GazeWaypoint`: Screen-space coordinates, no target angles
- `HeadPoseWaypoint`: Normalized coords + explicit angle targets + hold duration

**Current Usage in GazeChallengeStep.tsx:**

- Line 263: `dotX.value = withTiming(waypoint.x * width, ...)` ← treating normalized x as ratio
- Line 264: `dotY.value = withTiming(waypoint.y * height, ...)` ← treating normalized y as ratio
- Lines 259-264: Uses `targetYawDeg` and `targetPitchDeg` from waypoint
- **Conclusion:** Currently using `HeadPoseWaypoint` (not `GazeWaypoint`)

### 2.2 Sample Types

**gaze-challenge.ts:**

```typescript
export type GazeSample = GazeSampleEvaluation & {
  waypointIndex: number
  timestamp: number
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
```

**head-pose-challenge.ts:**

```typescript
export type HeadPoseSampleEvaluation = {
  passed: boolean
  yawErrorDeg: number // degrees
  pitchErrorDeg: number // degrees
  usedMirrorMode: Exclude<HeadPoseMirrorMode, 'unknown'>
}
```

**Mismatch:**

- `GazeSample`: Has expected/actual angles + error; no mirror mode info
- `HeadPoseSampleEvaluation`: Has error in degrees + mirror mode; no expected values

**Current Usage in GazeChallengeStep.tsx (lines 375-385):**

```typescript
samplesRef.current.push({
  passed: evaluation.passed,
  yawError: evaluation.yawErrorDeg,
  pitchError: evaluation.pitchErrorDeg,
  expectedYaw: active.targetYawDeg, // ← extra data added
  expectedPitch: active.targetPitchDeg, // ← extra data added
  actualYaw: headPose.yawDeg,
  actualPitch: headPose.pitchDeg,
  waypointIndex: currentWaypointIndex,
  timestamp: now,
})
```

**Conclusion:** Component is manually augmenting `HeadPoseSampleEvaluation` to match `GazeSample` shape.

### 2.3 Result Type

**types/index.ts:**

```typescript
export type GazeChallengeResult = {
  passed: boolean
  score?: number // 0-1, pass ratio
  targetsCompleted?: number
  targetsTotal?: number
  durationMs?: number
  debug?: Record<string, unknown>
}
```

**Current Usage (lines 218-248):**

- All fields are populated
- `passed` = whether all waypoints completed AND score >= threshold
- `score` = passedSampleCount / sampleCount
- Result is sent via `setFaceGazeResult()` context callback

**Observation:** This is the interface contract with the parent flow. All modes must produce this format.

---

## 3. Logic Flow Breakdown

### 3.1 Per-Frame Evaluation (the challenge logic)

**Current flow in GazeChallengeStep.tsx:**

```
Frame arrives → face detected →
  1. Convert GazeDetectorFace to HeadPose (toHeadPose)
  2. Update mirror mode validation (updateHeadPoseMirrorValidationState)
  3. Resolve mirror mode (resolveHeadPoseMirrorModeFromValidation)
  4. Evaluate sample (evaluateHeadPoseSample) → passed boolean
  5. Accumulate sample with metadata
  6. Update waypoint progress (updateHeadPoseWaypointProgress)
  7. If progress.completed: move to next waypoint
  8. If progress.timedOut: fail challenge
```

**Critical observation:** This evaluation logic is **mode-agnostic**. It doesn't care if the UI shows a dot or a face. It just checks if yaw/pitch match targets within tolerance.

**Implication:** This logic can be extracted and reused by all modes.

### 3.2 Waypoint Progress Tracking

**State managed in refs (not React state):**

- `currentWaypointProgressRef` — holds `{stableMs, elapsedMs, completed, timedOut}`
- `mirrorValidationRef` — holds calibration data
- `mirrorModeRef` — resolved calibration result
- `lastProgressTickAtRef` — for delta-time calculation

**Logic in `updateHeadPoseWaypointProgress()`:**

```typescript
export function updateHeadPoseWaypointProgress(
  previous: HeadPoseWaypointProgressState,
  params: {
    deltaMs: number
    matched: boolean // whether current sample.passed
    config?: Partial<HeadPoseChallengeConfig>
  },
): HeadPoseWaypointProgressState
```

**Key insight:** Progress is accumulated per-frame:

- If pose matches: `stableMs += deltaMs`
- If pose doesn't match: `stableMs = 0` (reset)
- If `stableMs >= minHoldMs`: waypoint completed
- If `elapsedMs >= maxWaypointMs`: waypoint timeout

**Implication:** This mechanism is mode-agnostic. All modes can use the same progress tracking.

---

## 4. Proposed Unified Contract

### 4.1 Core Types (Shared)

**File:** `packages/passport-verification/src/face/gaze/gaze-challenge.ts`

```typescript
// ============ SHARED WAYPOINT TYPE ============
export type Waypoint = {
  id: string // unique per challenge
  index: number // 0-based position in sequence
  targetYawDeg: number // expected head rotation
  targetPitchDeg: number // expected head tilt
  screenX: number // 0-1 normalized (for UI positioning)
  screenY: number // 0-1 normalized (for UI positioning)
  holdMs: number // required hold duration
}

// ============ SHARED SAMPLE TYPE ============
export type ChallengeSample = {
  waypointIndex: number
  timestamp: number

  // Evaluation result (from evaluateGazeSample)
  passed: boolean
  yawErrorDeg: number
  pitchErrorDeg: number

  // Observed values
  actualYaw: number
  actualPitch: number

  // Target values (from waypoint)
  expectedYaw: number
  expectedPitch: number

  // Mode-specific (optional)
  mirrorMode?: 'normal' | 'mirrored'
  confidence?: number
}

// ============ PROGRESS STATE (unchanged) ============
export type WaypointProgressState = {
  stableMs: number // accumulated time at correct pose
  elapsedMs: number // elapsed time at this waypoint
  completed: boolean
  timedOut: boolean
}

// ============ FINAL RESULT (unchanged) ============
export type GazeChallengeResult = {
  passed: boolean
  score: number // 0-1
  targetsCompleted: number
  targetsTotal: number
  durationMs: number
  debug: Record<string, unknown>
}
```

### 4.2 Shared Evaluation Functions

**File:** `packages/passport-verification/src/face/gaze/gaze-challenge.ts`

```typescript
// ============ WAYPOINT GENERATION ============
/**
 * Generate randomized waypoints for the challenge.
 * Returns normalized coordinates (0-1) and target angles.
 */
export function generateGazeWaypoints(
  config?: Partial<GazeChallengeConfig>,
  random?: () => number,
): Waypoint[]

// ============ PER-FRAME EVALUATION ============
/**
 * Evaluate whether a single frame's head pose matches waypoint target.
 * Called once per frame while running challenge.
 */
export function evaluateGazeSample(
  observedYaw: number,
  observedPitch: number,
  targetYaw: number,
  targetPitch: number,
  config?: Partial<GazeChallengeConfig>,
): {
  passed: boolean
  yawErrorDeg: number
  pitchErrorDeg: number
}

// ============ PROGRESS TRACKING ============
/**
 * Update accumulated hold time for current waypoint.
 * Resets hold time if pose leaves tolerance.
 * Returns completion/timeout state.
 */
export function updateWaypointProgress(
  previous: WaypointProgressState,
  params: {
    deltaMs: number
    matched: boolean // whether evaluateGazeSample.passed
    config?: Partial<GazeChallengeConfig>
  },
): WaypointProgressState

// ============ RESULT BUILDER ============
/**
 * Build final GazeChallengeResult from collected samples.
 */
export function buildGazeChallengeResult(
  samples: ChallengeSample[],
  totalWaypoints: number,
  startedAt: number,
  completedAt: number,
  config?: Partial<GazeChallengeConfig>,
): GazeChallengeResult
```

---

## 5. Proposed Mode File Structure

### 5.1 Directory Layout

```
packages/passport-verification/src/face/gaze/
├── gaze-challenge.ts                         ← UNIFIED PROTOCOL
│                                               (generateGazeWaypoints, evaluateGazeSample, etc.)
├── index.ts                                   ← Exports shared types/functions
├── config.ts                                  ← Challenge configuration constants
└── (modes handled by app code, not here)

src/pages/app/pages/document-scan/components/
├── gaze-challenge/                            ← NEW: Mode implementations
│   ├── gaze-challenge-container.tsx           ← Smart component (orchestrator)
│   ├── gaze-challenge-dot.tsx                 ← Dot mode UI
│   ├── gaze-challenge-face.tsx                ← Face mode UI
│   ├── gaze-challenge-pose.tsx                ← Pose mode UI (optional v2)
│   ├── types.ts                               ← Local types for component state
│   ├── hooks.ts                               ← Shared hooks (useFaceDetection, etc.)
│   └── __tests__/
│       ├── gaze-challenge-dot.test.tsx
│       ├── gaze-challenge-face.test.tsx
│       └── gaze-challenge-container.test.tsx
└── GazeChallengeStep.tsx                      ← (deprecated, replace with container)
```

### 5.2 Container Component (`gaze-challenge-container.tsx`)

**Responsibility:** Camera, face detection, challenge orchestration, mode routing

```typescript
export default function GazeChallengeContainer(): JSX.Element {
  // (Move logic from current GazeChallengeStep to here)
  // - Camera setup
  // - Face detection frame processing
  // - Challenge state management (running, idle, success, failed)
  // - Sample accumulation
  // - Waypoint progress tracking

  // Decide which mode to render based on GAZE_CHALLENGE_MODE
  const modeComponent = GAZE_CHALLENGE_MODE === 'dot'
    ? <GazeChallengeComponentDot ... />
    : GAZE_CHALLENGE_MODE === 'face'
    ? <GazeChallengeComponentFace ... />
    : <GazeChallengeComponentPose ... />

  return modeComponent
}
```

### 5.3 Mode Components (Dot, Face)

**Each mode receives the same props:**

```typescript
type GazeChallengeComponentProps = {
  // Shared state
  isRunning: boolean
  waypointIndex: number
  waypoints: Waypoint[]
  score: number

  // Current detection
  faceDetected: boolean
  multipleFaces: boolean
  headPose?: HeadPose
  mirrorMode?: HeadPoseMirrorMode

  // Actions
  onStart: () => void
  onRetry: () => void
  onExit: () => void
}
```

**Dot mode (`gaze-challenge-dot.tsx`):**

```typescript
export function GazeChallengeComponentDot(props: GazeChallengeComponentProps): JSX.Element {
  const [dotX, dotY] = useSharedValue(...)  // Animated values

  // Subscribe to waypoint changes, animate dot
  useEffect(() => {
    if (props.waypointIndex < props.waypoints.length) {
      const wp = props.waypoints[props.waypointIndex]
      animateDotToWaypoint(wp)
    }
  }, [props.waypointIndex])

  return (
    <View>
      <Animated.View
        style={dotStyle}
        className='absolute h-7 w-7 rounded-full ...'
      />
      {/* shared UI (status text, buttons, etc.) */}
    </View>
  )
}
```

**Face mode (`gaze-challenge-face.tsx`):**

```typescript
export function GazeChallengeComponentFace(props: GazeChallengeComponentProps): JSX.Element {
  const [faceYaw, facePitch] = useSharedValue(...)  // Animated values

  // Subscribe to waypoint changes, animate face rotation
  useEffect(() => {
    if (props.waypointIndex < props.waypoints.length) {
      const wp = props.waypoints[props.waypointIndex]
      animateFaceToWaypoint(wp)
    }
  }, [props.waypointIndex])

  return (
    <View>
      <Animated.Image
        source={GUIDING_FACE}
        style={faceTransformStyle}
      />
      {/* shared UI (status text, buttons, etc.) */}
    </View>
  )
}
```

**Key insight:** Both receive the same props and waypoint data. The difference is only in visualization.

---

## 6. Configuration & Mode Selection

### 6.1 Config File (`config.ts`)

```typescript
export type GazeChallengeMode = 'dot' | 'face' | 'pose'

export const GAZE_CHALLENGE_MODE: GazeChallengeMode = 'dot'

export const GAZE_CHALLENGE_CONFIG: GazeChallengeConfig = {
  waypointCount: 4,
  maxYawDeg: 45,
  maxPitchDeg: 45,
  yawToleranceDeg: 15,
  pitchToleranceDeg: 15,
  minHoldMs: 700,
  maxWaypointMs: 4500,
  // ... other fields
}
```

### 6.2 Runtime Mode Selection

```typescript
// In container
const mode = GAZE_CHALLENGE_MODE

const modeComponent = mode === 'dot'
  ? <GazeChallengeComponentDot {...sharedProps} />
  : mode === 'face'
  ? <GazeChallengeComponentFace {...sharedProps} />
  : mode === 'pose'
  ? <GazeChallengeComponentPose {...sharedProps} />
  : <GazeChallengeComponentDot {...sharedProps} />  // fallback
```

---

## 7. Migration Path from Current GazeChallengeStep

### Current State

```
GazeChallengeStep (monolithic)
├── Camera setup
├── Face detection
├── Challenge orchestration
├── Waypoint progress tracking
└── UI rendering (dot or face, hardcoded)
```

### Proposed State

```
GazeChallengeContainer (orchestrator)
├── Camera setup
├── Face detection
├── Challenge orchestration (shared)
├── Waypoint progress tracking (shared)
└── Delegates to mode component:
    ├── GazeChallengeComponentDot
    ├── GazeChallengeComponentFace
    └── GazeChallengeComponentPose (v2)
```

### Migration Steps

1. Extract challenge evaluation logic from GazeChallengeStep into gaze-challenge.ts
2. Create GazeChallengeContainer with orchestration logic from current GazeChallengeStep
3. Create GazeChallengeComponentDot with dot-specific rendering from current GazeChallengeStep
4. Create GazeChallengeComponentFace with face-specific rendering from current GazeChallengeStep
5. Update GazeChallengeStep to simply render GazeChallengeContainer (backward compatibility)

---

## 8. Type Unification Strategy

### 8.1 Problem

- Current code uses `HeadPoseWaypoint` (has angles, ids, normalized coords)
- Legacy code defines `GazeWaypoint` (has pixel coords, no angles)
- We need a single unified `Waypoint` type

### 8.2 Solution

**Retire both old types. Create new unified `Waypoint` type in gaze-challenge.ts:**

```typescript
export type Waypoint = {
  id: string
  index: number
  targetYawDeg: number // from HeadPoseWaypoint
  targetPitchDeg: number // from HeadPoseWaypoint
  screenX: number // from HeadPoseWaypoint.x (normalized)
  screenY: number // from HeadPoseWaypoint.y (normalized)
  holdMs: number // from HeadPoseWaypoint
}
```

**Why this works:**

- Contains all data needed by both dot and face modes
- screenX/screenY are normalized (0-1), can be scaled to any screen size
- targetYaw/Pitch are used for evaluation
- holdMs is used by progress tracking
- id and index are for organization

**Migration:**

- Replace `HeadPoseWaypoint` with `Waypoint` throughout
- `generateGazeWaypoints()` should return `Waypoint[]`
- Update function signatures to accept/return `Waypoint`

### 8.3 Sample Type Unification

**New `ChallengeSample` type includes:**

- Everything from current `GazeSample`
- Optional `mirrorMode` field (for pose mode)

```typescript
export type ChallengeSample = {
  waypointIndex: number
  timestamp: number
  passed: boolean
  yawErrorDeg: number
  pitchErrorDeg: number
  actualYaw: number
  actualPitch: number
  expectedYaw: number
  expectedPitch: number
  mirrorMode?: 'normal' | 'mirrored' // optional, added by pose mode
  confidence?: number // optional, added by any mode
}
```

---

## 9. Risk Analysis

### Risk 1: Logic Duplication in Mode Components

**Risk:** Each mode component might duplicate waypoint evaluation logic.

**Severity:** HIGH

**Root cause:** If mode components have their own evaluation, we lose the single source of truth.

**Mitigation:**

- ✅ Move ALL evaluation to `evaluateGazeSample()` in gaze-challenge.ts
- ✅ Mode components only handle visualization, not evaluation
- ✅ Container handles frame processing and calls shared evaluation
- ✅ Tests verify that all modes use the same evaluation function

### Risk 2: Waypoint Type Mismatch

**Risk:** Some code expects `HeadPoseWaypoint`, others expect pixel-space `GazeWaypoint`.

**Severity:** MEDIUM

**Root cause:** Two separate historical waypoint types.

**Mitigation:**

- ✅ Create single `Waypoint` type that includes all necessary data
- ✅ Update all imports to use new type
- ✅ Remove old type definitions from gaze-challenge.ts and head-pose-challenge.ts
- ✅ Verify all callers use new type

### Risk 3: Breaking Existing Dot Behavior

**Risk:** Refactoring could break the current working dot challenge.

**Severity:** HIGH

**Root cause:** Current code is in a monolithic component; extracting could introduce bugs.

**Mitigation:**

- ✅ Keep current GazeChallengeStep working during refactoring
- ✅ New container should produce identical results to old step
- ✅ Run side-by-side tests (old vs new produce same result)
- ✅ Keep same imports/exports from domain modules
- ✅ Manual QA on both iOS and Android

### Risk 4: Evaluation Logic Regression

**Risk:** Moving evaluation from GazeChallengeStep to shared module could break something.

**Severity:** MEDIUM

**Root cause:** Subtle differences in how angles are processed.

**Mitigation:**

- ✅ Extract evaluation logic in a way that preserves exact computation
- ✅ Test that `evaluateGazeSample()` produces same results as inline code
- ✅ Unit tests for edge cases (0° target, 45° target, negative angles)
- ✅ Reuse existing head-pose-challenge functions where possible

### Risk 5: Mirror Mode Calibration Issues

**Risk:** Mirror mode detection might break if moved to shared code.

**Severity:** MEDIUM

**Root cause:** Mirror mode is specific to front-facing camera; refactoring could introduce timing issues.

**Mitigation:**

- ✅ Keep mirror mode logic in head-pose-challenge.ts (already battle-tested)
- ✅ Container wraps it as-is, no changes
- ✅ Manual QA on both iOS and Android with front camera
- ✅ Verify mirror mode resolves within expected timeframe

### Risk 6: Platform Differences (iOS vs Android)

**Risk:** Behavior might differ between iOS and Android (camera orientation, ML Kit output).

**Severity:** MEDIUM

**Root cause:** Hardware/platform differences in face detection.

**Mitigation:**

- ✅ Keep existing angle conversion logic (yawAngle vs headEulerAngleY, etc.)
- ✅ Test on release builds for both platforms
- ✅ Run full QA checklist on both platforms after refactoring
- ✅ Monitor for platform-specific regression

### Risk 7: TypeScript Type Safety Loss

**Risk:** Changing type definitions could introduce type errors elsewhere.

**Severity:** LOW-MEDIUM

**Root cause:** Multiple files depend on HeadPoseWaypoint, GazeSample types.

**Mitigation:**

- ✅ Use TypeScript strict mode to catch type errors at compile time
- ✅ Search codebase for all usages of old types before refactoring
- ✅ Run type-check and lint passes
- ✅ Update test imports and signatures

---

## 10. Implementation Plan (Small Steps)

### Phase 1: Preparation (Non-Breaking)

**Commit 1:** Create unified types in gaze-challenge.ts

- Add `Waypoint`, `ChallengeSample`, `WaypointProgressState`, `GazeChallengeResult` to gaze-challenge.ts
- Keep old types temporarily (with deprecation comments)
- Export new types from index.ts
- Files: gaze-challenge.ts, index.ts

**Commit 2:** Add shared evaluation functions to gaze-challenge.ts

- Add `generateGazeWaypoints()` (new, based on createHeadPoseWaypoints)
- Add `evaluateGazeSample()` (new, based on evaluateHeadPoseSample)
- Add `updateWaypointProgress()` (new, wrapper around updateHeadPoseWaypointProgress)
- Add `buildGazeChallengeResult()` (new, based on current logic in GazeChallengeStep)
- Files: gaze-challenge.ts

**Commit 3:** Add config constant

- Create config.ts with GAZE_CHALLENGE_MODE, GAZE_CHALLENGE_CONFIG
- Files: config.ts, index.ts

---

### Phase 2: Extract Logic (Preserve Behavior)

**Commit 4:** Create GazeChallengeContainer

- Copy all logic from GazeChallengeStep to new file
- Replace direct imports of head-pose functions with imports from shared functions
- Determine mode (dot vs face) based on GAZE_CHALLENGE_MODE config
- Keep props/state/behavior identical to current GazeChallengeStep
- Files: components/gaze-challenge/gaze-challenge-container.tsx

**Commit 5:** Update GazeChallengeStep to delegate

- Change GazeChallengeStep to simply render GazeChallengeContainer
- Backward compatibility maintained
- Files: components/GazeChallengeStep.tsx

---

### Phase 3: Extract UI Modes

**Commit 6:** Extract dot mode visualization

- Move dot rendering from container into GazeChallengeComponentDot
- Container manages state, passes props down
- Component handles only rendering and local animation
- Files: components/gaze-challenge/gaze-challenge-dot.tsx

**Commit 7:** Extract face mode visualization

- Move face rendering from container into GazeChallengeComponentFace
- Container manages state, passes props down
- Component handles only rendering and local animation
- Files: components/gaze-challenge/gaze-challenge-face.tsx

**Commit 8:** Container selects mode

- Update GazeChallengeContainer to render correct mode component based on GAZE_CHALLENGE_MODE
- Both mode components receive same props and callbacks
- Files: components/gaze-challenge/gaze-challenge-container.tsx

---

### Phase 4: Testing & Cleanup

**Commit 9:** Add integration tests

- Test that container + dot mode produces same results as old GazeChallengeStep
- Test that container + face mode produces same results
- Test that switching GAZE_CHALLENGE_MODE works correctly
- Files: components/gaze-challenge/**tests**/

**Commit 10:** Type cleanup

- Remove old HeadPoseWaypoint/GazeSample deprecation comments
- Update all usages to new types
- Verify no type errors
- Files: gaze-challenge.ts, gaze-challenge-container.tsx, mode components

---

## 11. File Dependencies & Import Strategy

### Current (Before Refactoring)

```
GazeChallengeStep.tsx
  ↓ imports
@iland/passport-verification (from packages/passport-verification)
  ├── createHeadPoseWaypoints
  ├── evaluateHeadPoseSample
  ├── updateHeadPoseWaypointProgress
  ├── createHeadPoseMirrorValidationState
  ├── HeadPoseWaypoint (type)
  ├── GazeSample (type)
  └── GazeChallengeResult (type)
```

### Proposed (After Refactoring)

```
GazeChallengeStep.tsx
  └─ renders
    GazeChallengeContainer.tsx
      ├─ imports (shared functions)
      │   from @iland/passport-verification
      │   ├── generateGazeWaypoints
      │   ├── evaluateGazeSample
      │   ├── updateWaypointProgress
      │   ├── Waypoint (type)
      │   ├── ChallengeSample (type)
      │   └── GazeChallengeResult (type)
      │
      ├─ imports (shared helpers, unchanged)
      │   from @iland/passport-verification
      │   ├── createHeadPoseMirrorValidationState
      │   ├── updateHeadPoseMirrorValidationState
      │   ├── resolveHeadPoseMirrorModeFromValidation
      │   ├── HeadPose (type)
      │   └── HeadPoseMirrorMode (type)
      │
      └─ renders based on mode
        ├── GazeChallengeComponentDot.tsx (receives WaypointProps, renders dot)
        ├── GazeChallengeComponentFace.tsx (receives WaypointProps, renders face)
        └── GazeChallengeComponentPose.tsx (receives WaypointProps, renders prompts)
```

### Export Strategy

**gaze-challenge.ts exports:**

```typescript
// Types
export type Waypoint
export type ChallengeSample
export type WaypointProgressState
export type GazeChallengeResult
export type GazeChallengeConfig

// Functions
export function generateGazeWaypoints(...)
export function evaluateGazeSample(...)
export function updateWaypointProgress(...)
export function buildGazeChallengeResult(...)
export function getDefaultGazeChallengeConfig()

// Deprecated (for migration period)
export { HeadPoseWaypoint as _DeprecatedHeadPoseWaypoint }
```

**index.ts exports:**

```typescript
export * from './gaze-challenge'
export * from './head-pose-challenge' // keep for backward compatibility
export * from './config'
```

---

## 12. Testing Strategy

### Unit Tests

- Test `generateGazeWaypoints()` generates correct count and angles
- Test `evaluateGazeSample()` correctly determines pass/fail
- Test `updateWaypointProgress()` accumulates hold time correctly
- Test `buildGazeChallengeResult()` calculates score accurately

### Integration Tests

- Test container + dot mode flow (start → waypoint sequence → complete)
- Test container + face mode flow (same as dot, different visualization)
- Test mode switching (change GAZE_CHALLENGE_MODE, re-run, verify both work)
- Test failure path (timeout, no face, multiple faces)
- Test retry path (fail, then retry, verify state reset)

### E2E Tests (Manual QA)

- iOS release build: dot mode → complete successfully
- iOS release build: face mode → complete successfully
- Android release build: dot mode → complete successfully
- Android release build: face mode → complete successfully
- Verify mirror mode detection on both platforms
- Verify score calculation matches between modes

---

## 13. Backward Compatibility

### Export Compatibility

- ✅ GazeChallengeResult type unchanged (consumer interface)
- ✅ Challenge behavior unchanged (same success/failure logic)
- ⚠️ Internal types change (HeadPoseWaypoint → Waypoint) but only internal to package

### Import Compatibility

**Before:**

```typescript
import { createHeadPoseWaypoints, evaluateHeadPoseSample } from '@iland/passport-verification'
```

**After:**

```typescript
import { generateGazeWaypoints, evaluateGazeSample } from '@iland/passport-verification'
```

**Impact:** None (only internal to GazeChallengeContainer, external consumers don't import these)

### Component Compatibility

- ✅ GazeChallengeStep still exists and renders (delegates to container)
- ✅ setFaceGazeResult still receives same GazeChallengeResult format
- ✅ Navigation flow unchanged (success → FaceComparisonStep, failure → retry)

---

## 14. Summary: What Moves Where

### Stays in `gaze-challenge.ts`

```typescript
✓ generateGazeWaypoints()           (new, unified)
✓ evaluateGazeSample()              (new, unified)
✓ updateWaypointProgress()          (new, wrapper)
✓ buildGazeChallengeResult()        (new, extracted)
✓ Waypoint type                     (new)
✓ ChallengeSample type              (new)
✓ GazeChallengeConfig               (moved from inline)
✓ getDefaultGazeChallengeConfig()   (moved from inline)
```

### Stays in `head-pose-challenge.ts` (Low-level Helpers)

```typescript
✓ createHeadPoseMirrorValidationState()
✓ updateHeadPoseMirrorValidationState()
✓ resolveHeadPoseMirrorModeFromValidation()
✓ updateHeadPoseWaypointProgress()      (called by gaze-challenge)
✓ evaluateHeadPoseSample()              (called by gaze-challenge)
✓ HeadPose type
✓ HeadPoseMirrorMode type
✓ HeadPoseMirrorValidationState type
```

(No breaking changes to head-pose-challenge; it becomes a lower-level helper)

### Moves to `GazeChallengeContainer.tsx`

```typescript
✓ Camera setup and lifecycle
✓ Face detection frame processor
✓ Challenge state machine (idle, running, success, failed)
✓ Waypoint progress tracking and updates
✓ Sample accumulation
✓ Mirror mode management
✓ Mode selection logic (dot vs face)
✓ Result reporting
✓ Navigation and buttons
```

### Moves to Mode Components (Dot, Face, Pose)

```typescript
✓ Visualization-specific state (dotX, dotY, guideYaw, guidePitch)
✓ Animation logic
✓ Rendering code
✓ Component-specific styles
```

---

## 15. Conclusion

### Key Design Decisions

1. **Single Source of Truth:** Challenge evaluation logic lives in `gaze-challenge.ts`, not in each mode
2. **Shared Waypoint Type:** All modes use the same `Waypoint` structure (angles + normalized screen coords)
3. **Container + Mode Pattern:** Orchestrator handles camera/logic, delegates rendering to mode component
4. **Unified Result:** All modes produce identical `GazeChallengeResult` format
5. **Head-Pose as Foundation:** head-pose-challenge.ts provides robust angle detection; gaze-challenge.ts wraps it

### Why This Design Works

- ✅ **No duplication:** Evaluation logic defined once
- ✅ **Easy to add modes:** Just create a new component, use existing Waypoint data
- ✅ **No breaking changes:** GazeChallengeStep still works, backward compatible
- ✅ **Testable:** Each component can be tested independently
- ✅ **Type-safe:** Unified types prevent mismatches

### Estimated Refactoring Effort

- Phase 1 (types + functions): 1-2 hours
- Phase 2 (extract logic): 1-2 hours
- Phase 3 (extract UI): 1-2 hours
- Phase 4 (testing + cleanup): 2-3 hours
- **Total:** 5-9 hours, spread over 10 commits

### Next Steps (After Approval)

1. Review this architectural document
2. Clarify any design questions
3. Proceed with Phase 1 (types and functions)
4. Verify Phase 1 doesn't break anything
5. Continue with Phase 2-4 incrementally

---
