# Face Liveness Detection - Quick Fix Reference

## The Issue (Fixed)

Face detection failed in TestFlight Release builds but worked in Debug. **Root cause:** Vision Camera's `runAsync()` callback wasn't executing in Hermes due to nested worklet directives + variable capture.

## What Was Fixed

### Problem 1: runAsync Callback Not Executing

- **Symptom:** Frame processor runs, but detectFaces never called (Heartbeats: 408, detectFaces calls: 0)
- **Cause:** `runAsync` callback with `'worklet'` directive + variable capture fails in Hermes Release
- **Fix:** Remove `runAsync` wrapper, call `detectFaces(frame)` directly in main worklet

### Problem 2: Excessive Logging (1-2 fps)

- **Symptom:** Camera feed laggy, app hangs
- **Cause:** Logging on every frame (30/sec) = 60+ worklet→JS thread marshalls per second
- **Fix:** Throttle per-frame logs to 1/sec, keep event logs at full frequency

## The Fix (Code Level)

**File:** `src/pages/app/pages/document-scan/components/FaceLivenessStep.tsx`

### 1. Removed runAsync import

```typescript
// ❌ BEFORE
import { ..., runAsync, ... } from 'react-native-vision-camera'

// ✅ AFTER
import { ... } from 'react-native-vision-camera'  // No runAsync
```

### 2. Replaced async wrapper with direct call

```typescript
// ❌ BEFORE (fails in Release)
runAsync(frame, () => {
  'worklet'
  const faces = detectFaces(frame) // Callback never executed in Hermes
  onFacesDetected(faces)
})

// ✅ AFTER (works everywhere)
try {
  const faces = detectFaces(frame) // Direct call in worklet
  onFacesDetected(faces)
} catch (error) {
  onFacesDetected([])
}
```

### 3. Throttled logging

```typescript
// Throttle: 30 frames → 1 log (reduces 30/sec to 1/sec)
frameCountThrottleRef.current = (frameCountThrottleRef.current + 1) % 30
const isThrottledFrame = frameCountThrottleRef.current === 0

if (debugEnabled && isThrottledFrame) {
  // Only log once per second
  onDebugFrameProcessor({ event: 'worklet_body_entered', ... })
}

// But log detections immediately (sparse, important)
onDebugFrameProcessor({ event: 'detect_faces_result', ... })
```

## Verification

After the fix, you should see:

**In console logs:**

```json
{"event":"detect_faces_result","faceCount":1,"faces":[...]}
{"event":"face_detection_callback","timestamp":...,"faceCount":1}
```

**In debug overlay:**

- Heartbeats: incrementing
- detectFaces calls: incrementing
- Last face count: > 0
- Frame rate: 30 fps (not 1-2 fps)

## Why This Works

1. **Direct detectFaces call** → No nested worklet complications
2. **No variable capture across boundaries** → Hermes Release compatible
3. **Standard Vision Camera 4.x pattern** → Official recommendation
4. **Throttled logging** → Minimal overhead
5. **Event-based logging** → Important signals captured

## Key Learnings

### ❌ Don't Do This (Breaks in Release)

```typescript
runAsync(frame, () => {
  'worklet'  // Nested worklet directive
  const faces = detectFaces(frame)  // Captures function from outer scope
  onDebugFrameProcessor({...})  // Captures function from outer scope
})
```

### ✅ Do This Instead

```typescript
try {
  // Call directly in main worklet
  const faces = detectFaces(frame)

  // Use existing runOnJS callbacks
  onFacesDetected(faces)
  onDebugFrameProcessor({...})
} catch (error) {
  onFacesDetected([])
}
```

## Prevention

If you're tempted to use `runAsync`:

1. Ask: "Is the work already async?" → If yes, don't use runAsync
2. Ask: "Do I need to capture variables from outer scope?" → If yes, avoid runAsync
3. Ask: "Is this a nested worklet?" → If yes, restructure

Use direct calls when possible. `runAsync` is for CPU-intensive work that actually needs to be async.

## Debug If Issues Return

If face detection breaks again:

1. Add console.log before/after detectFaces call
2. Check if callback/function executes in Release
3. Look for nested `'worklet'` directives
4. Check variable capture (use dependency arrays)
5. Verify both Debug and Release builds work

See LIVENESS_DEBUG.md for detailed debugging guide.

## Files

- **Documentation:** `dev-docs/LIVENESS_DEBUG.md` (comprehensive guide)
- **Implementation:** `src/pages/app/pages/document-scan/components/FaceLivenessStep.tsx`
- **Utility:** `src/utils/liveness-debug.ts`
- **Config:** `env.js`, `.env.production`
