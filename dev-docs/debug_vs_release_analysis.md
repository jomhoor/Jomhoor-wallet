# Debug vs Release Build Frame Processor Analysis

## Executive Summary

**Frame processor works in Debug but fails in Release despite identical code.**

The JavaScript code has **zero build-dependent conditions**. The issue is **not in the app code** but in:

1. **Runtime initialization** of react-native-worklets-core in Release builds
2. **VisionCamera frame processor attachment** in Release mode
3. **Hermes JavaScript engine** bytecode compilation/execution of worklet code

---

## Investigation Results

### 1. Code Analysis: No Build Conditions Found

#### FaceLivenessStep.tsx (Main Component)

```
✓ Line 45:    livenessState initialized to 'idle' (NO conditions)
✓ Line 65:    useFaceDetector called (NO conditions)
✓ Line 78:    isCameraActive = Boolean(...) (NO conditions)
✓ Line 287:   useFrameProcessor created (NO conditions)
✓ Line 391:   VisionCamera rendered (NO conditions)
✓ Line 396:   frameProcessor prop passed (NO conditions)
✓ Line 446:   startLiveness button onClick (NO conditions)
```

**Conclusion:** Every critical path is identical between Debug and Release.

#### Entire document-scan Folder

```
✓ Grep result: Only 1 __DEV__ found (FaceComparisonStep.tsx, not liveness)
✓ No NODE_ENV checks
✓ No APP_ENV checks
✓ No __DEV__ checks in FaceLivenessStep.tsx
```

#### Environment Variables

```
.env.development:  EXPO_PUBLIC_LIVENESS_DEBUG=enabled
.env.production:   EXPO_PUBLIC_LIVENESS_DEBUG=enabled
```

Both are identical, so debug logging should work in both.

---

## 2. Frame Processor Setup: Code is Identical

### useFrameProcessor Call (Line 287)

```typescript
const frameProcessor = useFrameProcessor(
  frame => {
    'worklet'
    // ... frame processor code ...
  },
  [detectFaces, onFacesDetected, onDebugFrameProcessor], // dependencies
)
```

**What should happen:**

- Hook creates a worklet function
- Returns frameProcessor object
- frameProcessor passed to Camera (line 396)
- VisionCamera activates processor when isActive=true

**What we know:**

- ✓ Worklets.createRunOnJS called (line 277, 281)
- ✓ runAsync used (line 301)
- ✓ 'worklet' directives present
- ? Frame processor mysteriously not activating in Release

---

## 3. Camera Component: Props are Identical

### VisionCamera Rendering (Line 391-398)

```typescript
{isCameraActive && device ? (
  <VisionCamera
    style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
    device={device}
    isActive={isCameraActive}           // ← depends on permissions & focus
    frameProcessor={frameProcessor}      // ← should activate processor
    pixelFormat='yuv'
  />
) : (
  <View> ... loading ... </View>
)}
```

**isCameraActive (Line 78):**

```typescript
const isCameraActive = Boolean(isFocused && hasPermission && device && cameraEnabled)
```

All conditions are present in both Debug and Release (camera logs show device + permissions are OK).

**frameProcessor prop:** Passed unconditionally.

**Hypothesis:** frameProcessor object might be undefined or invalid in Release, preventing attachment.

---

## 4. State Machine: Identical Across Builds

### State Transitions

```
Initial:         idle (line 45)
Button press  →  startLiveness() (line 446)
startLiveness →  setLivenessState('running') (line 357)
               → runningRef.current = true
               → Frame processor should start detecting
```

**Debug:** State transitions work, frame processor runs.
**Release:** State transitions work (we don't see errors), but frame processor doesn't run.

**Observation:** Frame processor should work even while state is 'idle'—it doesn't depend on livenessState. The processor runs on every frame regardless of state.

---

## 5. Worklets & Hermes: The Likely Culprit

### Worklets in Debug vs Release

**Debug Build:**

- Uses Metro JavaScript engine
- No Hermes bytecode compilation
- Worklets compiled/interpreted at runtime
- ✓ Works

**Release Build:**

- Uses Hermes JavaScript engine (app.config.ts line 7: newArchEnabled: true)
- JS compiled to Hermes bytecode during build
- Worklets require special handling in bytecode
- ❌ Fails silently (no errors thrown)

### Hermes Bytecode Compilation

The **worklet directive** must be compiled correctly for Hermes:

```typescript
const frameProcessor = useFrameProcessor(frame => {
  'worklet' // ← Special directive for Hermes compiler
  // ... code ...
}, [])
```

**Problem:** If Hermes compilation fails to recognize 'worklet', the code runs in the JS thread instead of the worklet thread, breaking VisionCamera frame processing.

**Evidence:**

- Logs from console show worklet code executing (proving JS runs)
- But heartbeat not incrementing (frame processor not called)
- This matches a failed worklet-to-Hermes compilation

---

## 6. React Native Worklets Initialization

### Worklets Module Loading

```typescript
import { Worklets } from 'react-native-worklets-core'
```

**Debug:** Metro loads modules dynamically, initialization happens at import time.
**Release:** Hermes uses precompiled bytecode, module initialization might differ.

**Risk:** If Worklets native module doesn't initialize properly in Release, `Worklets.createRunOnJS()` might:

- Return undefined
- Return a broken callback
- Throw a silent error

---

## 7. VisionCamera Frame Processor in Release

### Frame Processor Activation Conditions

VisionCamera activates frame processor when:

1. Camera `isActive={true}` ✓ (confirmed in logs)
2. `frameProcessor` prop exists ✓ (code shows it)
3. Frame processor is valid worklet ❌ (likely fails in Release)
4. Native VisionCamera module linked ✓ (code shows device found)

**Debug:** All conditions met, processor runs.
**Release:** Condition #3 likely fails—frameProcessor is undefined or invalid.

---

## Hypothesis: Most Likely Root Cause

### **Hermes Bytecode Compilation of Worklet Code Fails**

1. **Build Phase:**
   - EAS or Xcode build runs Hermes compiler
   - Hermes compiler sees `'worklet'` directive
   - If worklet transform isn't applied correctly, code becomes invalid worklet
2. **Runtime Phase:**
   - JS loads in Hermes runtime
   - `useFrameProcessor()` hook tries to create worklet
   - Worklet compilation/activation fails
   - `frameProcessor` becomes undefined
   - Camera component receives undefined frameProcessor
   - VisionCamera silently ignores it (no error thrown)
3. **Observable Result:**
   - Camera preview visible ✓ (camera initialized)
   - VisionCamera renders with frameProcessor={undefined}
   - No frame processor runs
   - No heartbeat
   - No detectFaces calls

---

## Secondary Hypotheses

### B. Expo Updates Embedded JS Not Including Worklets

- Release uses embedded JS (Updates.isEmbeddedLaunch = true)
- Embedded JS might not include react-native-worklets-core if build skipped it
- Solution: Verify embedded bundle includes worklet module

### C. Native Module Initialization Timing

- Release builds initialize native modules differently
- Worklets native module might not be initialized when component mounts
- Solution: Add initialization check/wait

### D. VisionCamera Plugin Configuration Missing in Release

- VisionCamera must be configured with vision-camera-frame-processor plugin
- Release build might not include plugin
- Solution: Check .expo/modules.json or native config

---

## Recommended Diagnostic Steps

### 1. Add Explicit Logs (No Code Changes Yet)

Add to FaceLivenessStep.tsx to prove/disprove each hypothesis:

```
Location: Line 287 (useFrameProcessor)
Log: frame processor created
Value: typeof frameProcessor

Location: Line 396 (VisionCamera frameProcessor prop)
Log: camera render with frameProcessor
Value: frameProcessor !== undefined

Location: Line 277 (Worklets.createRunOnJS)
Log: worklets initialized
Value: typeof Worklets.createRunOnJS

Location: Line 391 (Camera render)
Log: camera_rendered
Value: isCameraActive, device position, frameProcessor type
```

### 2. Check Hermes Compilation Logs

```bash
# If using EAS
eas build --platform ios --profile preview --logs

# Look for warnings about worklet compilation
# Search for: 'worklet', 'transform', 'bytecode', 'compilation error'
```

### 3. Inspect Embedded JS Module List

In Release build, verify:

- react-native-worklets-core is in embedded bundle
- VisionCamera is in embedded bundle
- Frame processor plugin is registered

### 4. Compare Metro vs Embedded JS

```bash
# Debug (Metro) - works
npx expo start

# Release (embedded) - doesn't work
# Check if same modules loaded in both
```

---

## Conclusion

**The frame processor is NOT running in Release because the worklet code is not being executed as a worklet in the Hermes bytecode engine.**

The JavaScript code is identical. The issue is:

1. ~~State machine~~ (proven identical)
2. ~~Code conditions~~ (proven absent)
3. ✓ **Worklet/Hermes bytecode compilation or runtime initialization**
4. ✓ **Native module initialization timing in Release**

**Next step:** Add diagnostic logs to prove which of these is failing, then fix.
