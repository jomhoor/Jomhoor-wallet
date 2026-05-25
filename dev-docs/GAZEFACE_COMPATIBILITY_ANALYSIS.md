# GazeFace Compatibility Analysis for Gaze Challenge "Face" Mode

**Date:** 2026-05-26
**Question:** Can we use the GazeFace class from gaze-circle.ts for the "face" mode in our multi-mode gaze challenge?

---

## TL;DR

❌ **Not compatible as-is** — GazeFace is a web/Canvas implementation, but our gaze challenge runs on **React Native (iOS/Android)**.

However, **the concepts are valuable**:

- Sphere projection math for realistic 3D head rotation
- `drawAtPose(yaw, pitch)` API pattern is perfect for waypoint-driven animation
- Iris positioning based on gaze angle is sophisticated

---

## Detailed Analysis

### 1. What GazeFace Does

```typescript
// Current usage (circular animation):
const face = new GazeFace(canvasElement)
face.start() // continuously rotates head in a circle

// One-shot rendering at explicit pose:
face.drawAtPose(yaw, pitch, gazeAngle, gazeRadius)
```

**Strengths:**

- ✅ Sophisticated 3D wireframe face with eyes, mouth, iris
- ✅ Realistic sphere projection mathematics
- ✅ Handles foreshortening, visibility culling, perspective
- ✅ Eye follows a gaze angle (iris position)
- ✅ `drawAtPose()` method allows external pose control
- ✅ Beautiful cyan glow aesthetic

**Constraints:**

- Uses `HTMLCanvasElement` (web only)
- Uses `CanvasRenderingContext2D` (web only)
- Requires `requestAnimationFrame` (browser API)
- No React Native integration

### 2. Platform Mismatch

**GazeFace Target:** Web browsers with Canvas support

```
GazeFace
├─ Canvas 2D rendering context
├─ HTMLCanvasElement
└─ requestAnimationFrame (browser)
```

**Our Gaze Challenge Target:** Mobile (iOS/Android) via React Native

```
GazeChallengeContainer
├─ react-native-vision-camera (camera)
├─ react-native-reanimated (animations)
├─ Animated.Image (renderers)
└─ Native platform APIs
```

❌ **Incompatible:** Canvas APIs don't exist in React Native.

### 3. Current "Face" Mode Implementation (GazeChallengeContainer)

**What we have now:**

```typescript
// Uses a static PNG image with Reanimated transforms
<Animated.Image
  source={GUIDING_FACE_IMAGE}  // assets/guiding-face.png
  style={[guideFaceStyle, { width: 500, height: 500, opacity: 0.82 }]}
/>

// Animation: simple 3D CSS-like transforms
const guideFaceStyle = useAnimatedStyle(() => ({
  transform: [
    { translateX: (guideYaw.value / maxYaw) * 18 },
    { translateY: (-guidePitch.value / maxPitch) * 14 },
    { perspective: 800 },
    { rotateY: `${guideYaw.value}deg` },
    { rotateX: `${-guidePitch.value}deg` },
  ],
}))
```

**Trade-offs:**
| Aspect | GazeFace | Current Implementation |
|--------|----------|----------------------|
| **Realism** | High (3D sphere projection) | Medium (2D image with CSS transforms) |
| **Platform** | Web/Canvas only | ✅ React Native iOS/Android |
| **Performance** | Canvas redraw per frame | ✅ GPU-accelerated Reanimated |
| **Customization** | Hard-coded colors, geometry | Flexible (any PNG image) |
| **Implementation** | ~300 lines Canvas code | ~20 lines React Native code |
| **Usability** | `drawAtPose(yaw, pitch)` | Automatic (via Reanimated values) |

---

## 4. Could We Port GazeFace to React Native?

### Option A: React Native Skia (2D Drawing Library)

```typescript
// Hypothetical React Native Skia port
import { Canvas, Circle, Image } from '@react-native-skia/skia'

export function GazeFaceSkia({ yaw, pitch, gazeAngle }) {
  return (
    <Canvas style={{ width: 300, height: 300 }}>
      {/* Port GazeFace drawing logic here */}
      <Circle cx={cx} cy={cy} r={r} color="cyan" />
      {/* ... */}
    </Canvas>
  )
}
```

**Pros:**

- ✅ Real 2D drawing (like Canvas)
- ✅ Can port sphere projection math 1:1
- ✅ Works on iOS/Android
- ✅ GPU accelerated

**Cons:**

- ❌ Adds new dependency (react-native-skia)
- ❌ Larger bundle size
- ❌ Moderate learning curve (Skia API)
- ⚠️ Sketch rendering per frame (more CPU intensive than Reanimated transforms)

### Option B: Babylon.js / Three.js (3D Libraries)

```typescript
// Web-only 3D engines
import * as BABYLON from 'babylonjs'
// or
import * as THREE from 'three'
```

**Pros:**

- ✅ True 3D rendering
- ✅ Can use GazeFace math directly

**Cons:**

- ❌ Web-only (no React Native support)
- ❌ Huge bundle size
- ❌ Not suitable for mobile

### Option C: Keep Current PNG + Reanimated (Recommended)

```typescript
// Current implementation
<Animated.Image source={require('./guiding-face.png')} />
```

**Pros:**

- ✅ Simple, lightweight
- ✅ Already implemented
- ✅ GPU-accelerated animations
- ✅ Works perfectly on iOS/Android
- ✅ Fast rendering

**Cons:**

- ⚠️ Less realistic than 3D projection
- ⚠️ Static image doesn't adapt to extreme angles

---

## 5. Waypoint Compatibility

**Good news:** The waypoint API is **fully compatible** with GazeFace's input:

```typescript
// From our unified challenge protocol:
type Waypoint = {
  targetYawDeg: number // ← Perfect for GazeFace
  targetPitchDeg: number // ← Perfect for GazeFace
  // ... other fields
}

// Could use GazeFace like:
face.drawAtPose(
  waypoint.targetYawDeg * (Math.PI / 180), // convert to radians
  waypoint.targetPitchDeg * (Math.PI / 180),
)
```

✅ **Data structure is compatible.** The constraint is platform, not API design.

---

## 6. Recommendation for Phase 3

### Current Situation (Recommended)

Continue with **PNG + Reanimated transforms**:

```typescript
// In GazeChallengeComponentFace.tsx (Phase 3):
export function GazeChallengeComponentFace(props: GazeChallengeComponentProps) {
  return (
    <Animated.Image
      source={GUIDING_FACE_IMAGE}
      style={animatedFaceStyle}
    />
  )
}
```

**Rationale:**

1. ✅ Already integrated and tested
2. ✅ Works on iOS/Android
3. ✅ GPU-accelerated
4. ✅ Lightweight
5. ✅ Good enough for UX (users don't need photorealism)
6. ✅ Maintains current behavior

### Future Enhancement (Optional)

If more realism is desired post-launch:

**Option 1: React Native Skia Port** (Medium effort)

- Port GazeFace math to Skia
- Use `face.png` as background, draw eyes + iris dynamically
- ~200 lines of Skia code
- ~2-4 hours work
- Benefits: More adaptive (works at extreme angles), smoother iris animation

**Option 2: Custom SVG Component** (Low effort, medium quality)

- Use react-native-svg to draw simple face geometr
- Simple ellipses for eyes, mouth
- Good compromise between realism and simplicity
- ~150 lines of code
- ~1-2 hours work

---

## 7. Summary Table

| Aspect                | GazeFace (Canvas) | Current PNG        | Skia Port         |
| --------------------- | ----------------- | ------------------ | ----------------- |
| **Platform**          | Web only          | ✅ Mobile          | ✅ Mobile         |
| **Realism**           | High              | Medium             | High              |
| **Performance**       | GPU-accelerated   | ✅ GPU-accelerated | GPU-accelerated   |
| **Complexity**        | 300 lines         | ✅ 20 lines        | 200 lines         |
| **Dependencies**      | None              | ✅ None new        | react-native-skia |
| **Ready for Phase 3** | ❌ No             | ✅ Yes             | ⏳ Later          |
| **Maintenance**       | -                 | ✅ Low             | Medium            |

---

## Conclusion

**GazeFace is not directly usable in React Native**, but its concepts (sphere projection, iris positioning, `drawAtPose` pattern) are valuable for future enhancements.

**For Phase 3, stick with the current PNG + Reanimated approach:**

- It works
- It performs well
- It's simple
- Users will have a good experience

**Future work:** If users want more sophisticated face animation, consider a React Native Skia port that ported GazeFace's drawing logic to Skia's 2D API.

---
