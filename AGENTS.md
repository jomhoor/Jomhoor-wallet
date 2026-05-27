# Jomhoor Agent Rules

## VisionCamera Frame Processor Bridge Rule

- In VisionCamera frame processor worklets, when sending detection results back to JS state (for example `onFacesDetected`), use `Worklets.createRunOnJS(...)` from `react-native-worklets-core`.
- Do not replace this bridge with `runOnJS` from `react-native-reanimated` in liveness/face-detection frame processor paths unless validated on real iOS and Android Release builds.
- Reason: this project had a regression where replacing `Worklets.createRunOnJS` with `runOnJS` caused liveness to stall at `"Position your face in view"` because face detection callbacks did not reliably update JS state in Release.

### Canonical Pattern

```ts
import { Worklets } from 'react-native-worklets-core'

const onFacesDetected = Worklets.createRunOnJS((faces: DetectorFace[]) => {
  handleFacesDetected(faces)
})

const frameProcessor = useFrameProcessor(
  frame => {
    'worklet'
    try {
      const faces = detectFaces(frame)
      onFacesDetected(faces as unknown as DetectorFace[])
    } catch {
      onFacesDetected([])
    }
  },
  [detectFaces, onFacesDetected],
)
```
