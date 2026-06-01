# Facial Verification Flow Refactor Plan

## Summary

This plan refactors the passport/NID facial verification flow without changing verification requirements. The goal is to keep blink, smile, gaze/head-pose, and face comparison checks, while reducing visible UI steps and removing the separate manual live-photo capture step.

Recommended approach:

1. Phase 1 merges the standalone liveness screen into the existing gaze challenge screen.
2. Phase 2 adds a final centered gaze waypoint that captures the live comparison photo automatically, then makes face comparison run automatically from stored images.

No proof-generation behavior should change. The refactor should continue writing canonical values into `verificationUserData.biometrics` through the existing provider setters.

## Current Flow Summary

Visible document-scan step map in `src/pages/app/pages/document-scan/index.tsx` currently includes:

```ts
[Steps.FaceLivenessStep]: () => <FaceLivenessStep />,
[Steps.FaceGazeStep]: () => <GazeChallengeStep />,
[Steps.FaceComparisonStep]: () => <FaceComparisonStep />,
```

Current passport route:

1. Passport country selection.
2. MRZ/barcode scan.
3. Passport NFC read.
4. `PassportNfcDetailsStep`.
5. `FaceLivenessStep`.
6. `FaceGazeStep`.
7. `FaceComparisonStep`.
8. `DocumentPreviewStep`.
9. Proof generation via `createIdentity()`.

Current NID route:

1. NID front capture.
2. NID back barcode read.
3. NID NFC read.
4. NID result is converted to `EID` and stored.
5. `ScanNfcStep` resets face verification.
6. `FaceLivenessStep`.
7. `FaceGazeStep`.
8. `FaceComparisonStep`.
9. Proof generation via `createIdentity()`.

## Current Produced And Consumed Data

`FaceLivenessStep`:

- Produces `LivenessResult` through `setFaceLivenessResult(result)`.
- Uses `createLivenessChallengeSequence()`, `evaluateLivenessChallenge()`, and `buildLivenessResult()` from `@iland/passport-verification`.
- Current package liveness sequence includes `blink`, `smile`, and `turn_left` because `createLivenessChallengeSequence()` shuffles all package liveness challenges.
- Uses VisionCamera plus `react-native-vision-camera-face-detector` with `classificationMode: 'all'`, so blink/smile probabilities are available.
- Does not produce images.
- Transitions to `Steps.FaceGazeStep` after success.

`GazeChallengeStep` / `gaze-challenge-container.tsx`:

- Produces `GazeChallengeResult` through `setFaceGazeResult(result)`.
- Uses `generateUnifiedGazeWaypoints()`, `evaluateUnifiedGazeSample()`, `updateUnifiedWaypointProgress()`, mirror-mode validation, and `buildUnifiedGazeChallengeResult()` from `@iland/passport-verification`.
- Uses the same face detector configuration as liveness, including `classificationMode: 'all'`, but its local `GazeDetectorFace` type currently only models pose fields.
- Current back/exit routes point to `Steps.FaceLivenessStep`.
- Transitions to `Steps.FaceComparisonStep` after success.

`FaceComparisonStep`:

- Consumes reference image:
  - Passport: `passportNfcDetails.portrait` or `verificationUserData.document.passport.nfc.portrait`.
  - NID: `verificationUserData.document.nid.front?.imageUri`.
- Currently captures its own live selfie using a second VisionCamera instance.
- Crops reference and live images using `getCenteredFaceSquareCrop()`.
- Runs `compareFaces()` with `alreadyPreprocessed: true`.
- Stores image paths under `verificationUserData.biometrics.images`:
  - `referenceUri`
  - `liveCaptureUri`
  - `referenceCropUri`
  - `liveCropUri`
- Produces `FaceComparisonResult` through `setFaceComparisonResult(result)`.
- For NID, merges face results into `NidVerificationResult`, builds `NidProofInputAdapterData`, and calls `createIdentity()`.
- For passport, transitions to `DocumentPreviewStep` after successful comparison.

`ScanProvider`:

- Holds transient UI state in `faceVerification`.
- Also writes canonical face data into `verificationUserData.biometrics`:
  - `liveness?: LivenessResult`
  - `gaze?: GazeChallengeResult`
  - `comparison?: FaceComparisonResult`
  - `images?: { referenceUri, liveCaptureUri, referenceCropUri, liveCropUri }`
- `createIdentity()` checks passport face comparison before proof creation. NID proof continues after the NID adapter data is prepared.

## Proposed New Flow

Phase 1 visible flow:

1. Combined `GazeChallengeStep` handles blink, smile, and existing gaze/head-pose waypoints.
2. `FaceComparisonStep` captures and compares as it does today.

Phase 2 visible flow:

1. Combined `GazeChallengeStep` handles blink, smile, existing gaze/head-pose waypoints, and one final centered waypoint.
2. The final centered waypoint captures the live comparison photo automatically.
3. `FaceComparisonStep` loads the model, crops/prepares images, runs comparison automatically, and shows progress/result.

After Phase 2, the user experiences this as one continuous facial verification step followed by an automatic comparison/progress screen.

## Phase 1 Plan: Merge Liveness Into Gaze Challenge

Implementation target:

- Remove `FaceLivenessStep` from visible navigation for passport and NID.
- Keep existing liveness evidence by producing the same `LivenessResult` shape.
- Continue storing liveness through `setFaceLivenessResult()`.
- Keep `FaceComparisonStep` behavior unchanged in Phase 1.

Recommended implementation details:

1. Route passport and NID directly to `Steps.FaceGazeStep`.
2. Change `PassportNfcDetailsStep` Continue button from `Steps.FaceLivenessStep` to `Steps.FaceGazeStep`.
3. Change `ScanNfcStep.handleComplete()` from `Steps.FaceLivenessStep` to `Steps.FaceGazeStep`.
4. Update `gaze-challenge-container.tsx` to import liveness helpers from `@iland/passport-verification`.
5. Extend the local detected-face type with liveness fields:

```ts
type GazeDetectorFace = {
  yawAngle?: number
  pitchAngle?: number
  headEulerAngleX?: number
  headEulerAngleY?: number
  headEulerAngleZ?: number
  rollAngle?: number
  leftEyeOpenProbability?: number
  rightEyeOpenProbability?: number
  smilingProbability?: number
}
```

6. Do not use `createLivenessChallengeSequence()` directly if the required product behavior is only `smile` and `blink`; that helper currently includes `turn_left` too. Prefer a small local sequence builder for Phase 1 using the exported challenge/evaluation types, or add a package helper that returns only blink/smile.
7. Run the combined challenge sequentially inside the existing gaze screen:
   - Blink prompt.
   - Smile prompt.
   - Existing gaze/head-pose waypoint challenge.
8. When blink and smile both pass, call `buildLivenessResult()` and `setFaceLivenessResult(result)` before starting or completing the gaze waypoint portion.
9. Preserve the existing `setFaceGazeResult(result)` call after gaze/head-pose passes.
10. On final pass, transition to `Steps.FaceComparisonStep` as today.
11. Change the screen title and copy from `Gaze Challenge` to a broader label such as `Face Verification`.
12. Replace `Back to Liveness` and all `onExit={() => setCurrentStep(Steps.FaceLivenessStep)}` paths with a flow-aware back target.

Recommended back-target behavior:

- Passport: back to `Steps.PassportNfcDetailsStep`.
- NID: back to `Steps.ScanNfcStep` after NFC has completed, or Home if returning to embedded NID flow is not safe.
- Implement as a small helper in the component or provider, not repeated conditionals in each guide component prop.

Compatibility recommendation:

- Keep `FaceLivenessStep` and `Steps.FaceLivenessStep` in the code during Phase 1 for rollback and to minimize enum churn.
- Remove the visible route and exports only after Phase 2 is stable and all transitions are proven unused.

## Phase 2 Plan: Final Center Capture And Automatic Face Comparison

Implementation target:

- Add one final centered waypoint to the existing gaze/head-pose sequence.
- Capture a clean live face photo automatically at that final waypoint.
- Store the captured photo in `verificationUserData.biometrics.images.liveCaptureUri`.
- Remove manual live-photo capture from `FaceComparisonStep`.
- Make `FaceComparisonStep` automatically prepare and compare images.

Final center waypoint plan:

1. Generate normal waypoints with `generateUnifiedGazeWaypoints()`.
2. Append a final waypoint locally:

```ts
{
  id: 'wp-final-center-capture',
  index: generated.length,
  screenX: 0.5,
  screenY: 0.5,
  targetYawDeg: 0,
  targetPitchDeg: 0,
  holdMs: challengeConfig.minHoldMs,
}
```

3. Track `finalCaptureWaypointIndexRef` rather than requiring a package-level `Waypoint` type change.
4. Use copy such as `Face the camera and hold still.` for the final waypoint.
5. Consider stricter center tolerances for capture than regular waypoints if quality is poor in testing.

Automatic capture plan:

1. Add `cameraRef = useRef<VisionCamera>(null)` to `gaze-challenge-container.tsx`.
2. Pass `ref={cameraRef}` and `photo` to the existing VisionCamera.
3. When final center waypoint completes, call a guarded async JS function to run `cameraRef.current.takePhoto()`.
4. Normalize the captured path to a `file://` URI.
5. Store it through `setVerificationUserData()` under `biometrics.images.liveCaptureUri` with evidence source `camera` and step `face-final-center-capture`.
6. Only call `finalizeChallenge(true)` after capture succeeds.
7. On capture failure, set challenge state to failed with a `capture_failed` debug reason and let the user retry.
8. Guard against duplicate captures with `captureInFlightRef` and `capturedLiveImageUriRef`.

Automatic face comparison plan:

1. Remove the camera permission/device/camera ref from `FaceComparisonStep`.
2. Require these inputs on mount:
   - Reference image: passport portrait or NID front image.
   - Live image: `verificationUserData.biometrics.images.liveCaptureUri`.
   - Liveness passed.
   - Gaze passed.
3. Replace `ComparisonState` with automatic states such as:

```ts
type ComparisonState = 'loading-model' | 'preparing-images' | 'comparing' | 'failed' | 'success'
```

4. In one guarded effect, run:
   - `preloadFaceComparisonModel()`.
   - `getCenteredFaceSquareCrop(referenceUri)`.
   - `getCenteredFaceSquareCrop(liveCaptureUri)`.
   - Store crop URIs in `verificationUserData.biometrics.images`.
   - `compareFaces({ liveImageUri: liveCropUri, referenceImage: { uri: referenceCropUri }, threshold, modelName: 'mobilefacenet', alreadyPreprocessed: true })`.
5. Keep progress UI and cropped preview UI if useful for debugging, but remove the manual `Capture and Prepare` / `Compare Cropped Faces` button.
6. Retry should route back to `Steps.FaceGazeStep` so a new final-center image is captured.
7. Keep passport/NID success behavior unchanged:
   - Passport: transition to `DocumentPreviewStep` after comparison passes.
   - NID: merge face result into `NidVerificationResult`, create proof adapter data, and call `createIdentity()`.

Cleanup note:

- `compareFaces()` cleans internally-created crops only when `alreadyPreprocessed` is false. If the app creates crops with `getCenteredFaceSquareCrop()` and passes `alreadyPreprocessed: true`, the app is responsible for deleting those temporary crop files when they are no longer needed.

## Required State And Data Model Changes

Existing state is mostly sufficient.

Keep using:

```ts
verificationUserData.biometrics = {
  liveness?: LivenessResult
  gaze?: GazeChallengeResult
  comparison?: FaceComparisonResult
  images?: {
    referenceUri?: string
    liveCaptureUri?: string
    referenceCropUri?: string
    liveCropUri?: string
  }
}
```

Recommended additions:

1. Add evidence entries when the final centered live image is stored:

```ts
{
  step: 'face-final-center-capture',
  source: 'camera',
  keys: ['biometrics.images.liveCaptureUri'],
  storedAt: Date.now(),
}
```

2. Add debug metadata to `GazeChallengeResult.debug`:

```ts
{
  livenessMerged: true,
  finalCenterCapture: true,
  finalCenterCaptureStored: true,
  mirrorMode,
  platform,
}
```

3. Do not add proof-specific face state outside `verificationUserData` unless needed. The provider already mirrors liveness/gaze/comparison in `faceVerification` for existing proof gates.

4. Consider adding a helper method later:

```ts
setFaceLiveCaptureImage(value: { uri: string; capturedAt: number; source: 'gaze-final-center' }): void
```

This would avoid direct `setVerificationUserData()` updates inside the camera screen, but it is optional for Phase 2.

## Affected Files

Primary app files:

- `src/pages/app/pages/document-scan/index.tsx`
- `src/pages/app/pages/document-scan/ScanProvider/index.tsx`
- `src/pages/app/pages/document-scan/components/PassportNfcDetailsStep.tsx`
- `src/pages/app/pages/document-scan/components/ScanNfcStep.tsx`
- `src/pages/app/pages/document-scan/components/FaceLivenessStep.tsx`
- `src/pages/app/pages/document-scan/components/GazeChallengeStep.tsx`
- `src/pages/app/pages/document-scan/components/gaze-challenge/gaze-challenge-container.tsx`
- `src/pages/app/pages/document-scan/components/gaze-challenge/gaze-challenge-dot.tsx`
- `src/pages/app/pages/document-scan/components/gaze-challenge/gaze-challenge-face.tsx`
- `src/pages/app/pages/document-scan/components/gaze-challenge/gaze-challenge-smart-face.tsx`
- `src/pages/app/pages/document-scan/components/FaceComparisonStep.tsx`

Package files likely reused, not changed initially:

- `packages/passport-verification/src/face/liveness/liveness-challenges.ts`
- `packages/passport-verification/src/face/gaze/gaze-challenge.ts`
- `packages/passport-verification/src/face/comparison/compare-faces.ts`
- `packages/passport-verification/src/face/types/index.ts`

Optional package changes if local app logic becomes too large:

- Add an exported `createBlinkSmileLivenessChallengeSequence()` helper.
- Add an exported `appendFinalCenterWaypoint()` helper.
- Add pure reducer/helper functions for combined face challenge state transitions.

## Risks And Edge Cases

- `createLivenessChallengeSequence()` includes `turn_left`; using it directly would add a liveness action not requested by the new Phase 1 behavior.
- Blink/smile classification requires `classificationMode: 'all'`; this is already enabled in both current face screens but should be preserved.
- Face detector probability fields may differ across devices or OS versions. Missing probabilities should not pass liveness.
- Combining liveness and gaze increases complexity in `gaze-challenge-container.tsx`; split pure helper logic if the component becomes hard to test.
- Current gaze exit/back paths point to `FaceLivenessStep`; those must be replaced or the removed visible step remains reachable.
- Final center capture can race with waypoint completion if frames keep arriving. Use capture guards.
- `takePhoto()` must be called from JS, not inside the worklet. The existing frame processor already forwards faces to JS with `Worklets.createRunOnJS()`.
- Captured image quality may be poor if the final waypoint hold duration is too short. Increase final hold duration if device testing shows blur.
- FaceComparisonStep currently owns camera startup timing. Removing its camera changes lifecycle and may expose stale/missing `liveCaptureUri` cases.
- NID comparison uses the full NID front image as the reference source. It must continue cropping the card-front face with `getCenteredFaceSquareCrop()` before comparison.
- App-created crop files are temporary sensitive data. Add cleanup after success, retry, cancellation, and screen unmount where safe.
- Existing debug logs must not include raw image paths if logs are treated as sensitive. Prefer boolean/path-kind diagnostics.

## Test Plan

Unit tests:

- Blink challenge passes when both eye-open probabilities are below threshold.
- Smile challenge passes when smile probability is above threshold.
- Missing blink/smile probabilities do not pass.
- Combined challenge stores `LivenessResult` before `GazeChallengeResult`.
- Existing gaze waypoint pass/fail behavior remains unchanged.
- Final center waypoint is appended after generated waypoints with `targetYawDeg: 0` and `targetPitchDeg: 0`.
- Final center capture is called exactly once after stable alignment.
- Capture failure leaves the user on a retryable failed state.
- FaceComparisonStep fails cleanly when reference image is missing.
- FaceComparisonStep fails cleanly when `liveCaptureUri` is missing.
- FaceComparisonStep auto-runs model preload, crop, and comparison when inputs exist.
- NID success merges liveness, gaze, and comparison into `NidVerificationResult` and calls proof generation as before.
- Passport success transitions to `DocumentPreviewStep` as before.

Manual/device tests:

- Passport happy path on iOS physical device.
- NID happy path on iOS physical device.
- Passport/NID retry after failed blink.
- Passport/NID retry after failed smile.
- Passport/NID retry after gaze timeout.
- Passport/NID retry after face comparison fail.
- Low-light final-center capture.
- Multiple faces visible during blink/smile/gaze/capture.
- Cancel/back behavior from the combined face screen.
- App background/foreground during camera use.

Privacy checks:

- Confirm raw live capture and crop files are deleted after proof generation, cancellation, or retry when no longer needed.
- Confirm provider cleanup clears `verificationUserData.biometrics` on reset/cancel.
- Confirm native temporary camera resources are released when leaving the combined screen.
- Confirm logs do not include national ID values, raw NFC data, face metadata, or raw image contents.

## Prioritized Implementation Steps

Phase 1:

1. Add a small pure combined face-challenge state helper for blink/smile/gaze sequencing, or keep the first implementation local but clearly separated inside `gaze-challenge-container.tsx`.
2. Extend `GazeDetectorFace` with blink/smile probability fields.
3. Add blink and smile prompts to `GazeChallengeContainer` before starting existing waypoint logic.
4. Write `LivenessResult` through `setFaceLivenessResult()` after blink and smile pass.
5. Route `PassportNfcDetailsStep` and `ScanNfcStep` directly to `Steps.FaceGazeStep`.
6. Replace all `FaceLivenessStep` back/exit paths in gaze components with flow-aware back behavior.
7. Keep `FaceComparisonStep` unchanged.
8. Add/update tests for liveness and gaze sequencing.
9. Manually verify passport and NID still reach proof generation.

Phase 2:

1. Append final centered capture waypoint to the generated waypoint list.
2. Add camera ref and `photo` support to `GazeChallengeContainer`.
3. Capture the final live image once after the centered waypoint passes.
4. Store `liveCaptureUri` in `verificationUserData.biometrics.images` with evidence.
5. Refactor `FaceComparisonStep` to consume stored `liveCaptureUri` instead of opening the camera.
6. Auto-run model loading, crop/prepare, and comparison from an effect.
7. Remove manual capture/compare button.
8. Route retry to `Steps.FaceGazeStep` for recapture.
9. Add cleanup for live capture and crop files after proof/cancel/retry.
10. Add tests for capture, auto-comparison, retry, and cleanup.

## Implementation Boundary

Do not delete `FaceLivenessStep` in the first implementation pass. First make it unreachable from normal passport/NID flows, validate device behavior, then remove dead exports/routes in a later cleanup PR if no rollback path is needed.
