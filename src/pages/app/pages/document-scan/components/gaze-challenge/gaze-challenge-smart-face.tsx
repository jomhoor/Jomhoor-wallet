import { View } from 'react-native'
import Animated, { useAnimatedProps, useDerivedValue } from 'react-native-reanimated'
import Svg, { Circle, Ellipse } from 'react-native-svg'

import type { GazeChallengeComponentProps } from './types'

const BLUE = '#00e5ff'
const BLUE_DIM = 'rgba(0,180,220,0.25)'
const BLUE_MID = 'rgba(0,210,240,0.65)'
const FACE_FILL = 'rgba(0,30,45,0.55)'
const SOCKET_FILL = 'rgba(0,15,25,0.7)'

const R = 118
const FOV = 2.2
const GAZE_RADIUS = 0.72
const DEG_TO_RAD = Math.PI / 180

interface Vec3 {
  x: number
  y: number
  z: number
}

interface ProjectedPoint extends Vec3 {
  visible: boolean
}

interface ShapeProps {
  cx: number
  cy: number
  rx?: number
  ry?: number
  r?: number
  opacity: number
}

interface SmartFaceGeometry {
  face: ShapeProps
  faceGlow: ShapeProps
  leftEye: ShapeProps
  leftEyeGlow: ShapeProps
  rightEye: ShapeProps
  rightEyeGlow: ShapeProps
  leftIris: ShapeProps
  leftIrisGlow: ShapeProps
  leftPupil: ShapeProps
  rightIris: ShapeProps
  rightIrisGlow: ShapeProps
  rightPupil: ShapeProps
  mouth: ShapeProps
  mouthGlow: ShapeProps
}

type SmartFaceProps = GazeChallengeComponentProps & {
  guideYaw: Animated.SharedValue<number>
  guidePitch: Animated.SharedValue<number>
  challengeMaxYawDeg: number
  challengeMaxPitchDeg: number
}

const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse)
const AnimatedCircle = Animated.createAnimatedComponent(Circle)

function rotateYP(x: number, y: number, z: number, yaw: number, pitch: number): Vec3 {
  'worklet'
  const x1 = x * Math.cos(yaw) + z * Math.sin(yaw)
  const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw)
  const y1 = y
  const y2 = y1 * Math.cos(pitch) - z1 * Math.sin(pitch)
  const z2 = y1 * Math.sin(pitch) + z1 * Math.cos(pitch)
  return { x: x1, y: y2, z: z2 }
}

function project(
  sx: number,
  sy: number,
  sz: number,
  yaw: number,
  pitch: number,
  CX: number,
  CY: number,
): ProjectedPoint {
  'worklet'
  const r = rotateYP(sx, sy, sz, yaw, pitch)
  const z = r.z + FOV
  return {
    x: CX + (r.x / z) * FOV * R,
    y: CY + (r.y / z) * FOV * R,
    z: r.z,
    visible: r.z > -0.55,
  }
}

function computeGeometry(
  yawDeg: number,
  pitchDeg: number,
  CX: number,
  CY: number,
): SmartFaceGeometry {
  'worklet'
  const yaw = yawDeg * DEG_TO_RAD
  const pitch = pitchDeg * DEG_TO_RAD
  const gazeAngle = Math.atan2(-pitch, yaw)

  // Face ellipse with foreshortening
  const fRx = R * (1 - Math.abs(yaw) * 0.03)
  const fRy = R * (1.07 - Math.abs(pitch) * 0.03)
  const fCx = CX + yaw * R * 0.04
  const fCy = CY + pitch * R * 0.04

  // Eyes
  const leftEyeProj = project(-0.3, -0.13, 0.94, yaw, pitch, CX, CY)
  const rightEyeProj = project(0.3, -0.13, 0.94, yaw, pitch, CX, CY)

  const leftLat = -yaw
  const rightLat = yaw

  const leftEyeRx = R * 0.115 * (1 - Math.abs(leftLat) * 0.22)
  const leftEyeRy = R * 0.068 * (1 - Math.abs(pitch) * 0.1)
  const rightEyeRx = R * 0.115 * (1 - Math.abs(rightLat) * 0.22)
  const rightEyeRy = R * 0.068 * (1 - Math.abs(pitch) * 0.1)

  const leftEyeVisible = leftEyeProj.visible && leftEyeRx > 2
  const rightEyeVisible = rightEyeProj.visible && rightEyeRx > 2

  // Iris offset (clamped to eye bounds)
  const leftIrisMaxOff = leftEyeRx * 0.4
  const leftIrisX = leftEyeProj.x + Math.cos(gazeAngle) * GAZE_RADIUS * leftIrisMaxOff
  const leftIrisY = leftEyeProj.y + Math.sin(gazeAngle) * GAZE_RADIUS * leftIrisMaxOff * 0.78
  const leftIrisR = leftEyeRx * 0.58 * (1 - leftLat * 0.05)

  const rightIrisMaxOff = rightEyeRx * 0.4
  const rightIrisX = rightEyeProj.x + Math.cos(gazeAngle) * GAZE_RADIUS * rightIrisMaxOff
  const rightIrisY = rightEyeProj.y + Math.sin(gazeAngle) * GAZE_RADIUS * rightIrisMaxOff * 0.78
  const rightIrisR = rightEyeRx * 0.58 * (1 - rightLat * 0.05)

  // Mouth
  const mouthProj = project(0, 0.44, 0.9, yaw, pitch, CX, CY)
  const mouthVisible = mouthProj.visible
  const mouthRx = R * 0.2 * (1 - Math.abs(yaw) * 0.45)
  const mouthRy = R * 0.055 * (1 - Math.abs(pitch) * 0.3)

  return {
    face: { cx: fCx, cy: fCy, rx: fRx, ry: fRy, opacity: 1 },
    faceGlow: { cx: fCx, cy: fCy, rx: fRx, ry: fRy, opacity: 1 },
    leftEye: {
      cx: leftEyeProj.x,
      cy: leftEyeProj.y,
      rx: leftEyeRx,
      ry: leftEyeRy,
      opacity: leftEyeVisible ? 1 : 0,
    },
    leftEyeGlow: {
      cx: leftEyeProj.x,
      cy: leftEyeProj.y,
      rx: leftEyeRx,
      ry: leftEyeRy,
      opacity: leftEyeVisible ? 1 : 0,
    },
    rightEye: {
      cx: rightEyeProj.x,
      cy: rightEyeProj.y,
      rx: rightEyeRx,
      ry: rightEyeRy,
      opacity: rightEyeVisible ? 1 : 0,
    },
    rightEyeGlow: {
      cx: rightEyeProj.x,
      cy: rightEyeProj.y,
      rx: rightEyeRx,
      ry: rightEyeRy,
      opacity: rightEyeVisible ? 1 : 0,
    },
    leftIris: { cx: leftIrisX, cy: leftIrisY, r: leftIrisR, opacity: leftEyeVisible ? 1 : 0 },
    leftIrisGlow: { cx: leftIrisX, cy: leftIrisY, r: leftIrisR, opacity: leftEyeVisible ? 1 : 0 },
    leftPupil: {
      cx: leftIrisX,
      cy: leftIrisY,
      r: leftIrisR * 0.36,
      opacity: leftEyeVisible ? 1 : 0,
    },
    rightIris: { cx: rightIrisX, cy: rightIrisY, r: rightIrisR, opacity: rightEyeVisible ? 1 : 0 },
    rightIrisGlow: {
      cx: rightIrisX,
      cy: rightIrisY,
      r: rightIrisR,
      opacity: rightEyeVisible ? 1 : 0,
    },
    rightPupil: {
      cx: rightIrisX,
      cy: rightIrisY,
      r: rightIrisR * 0.36,
      opacity: rightEyeVisible ? 1 : 0,
    },
    mouth: {
      cx: mouthProj.x,
      cy: mouthProj.y,
      rx: mouthRx,
      ry: mouthRy,
      opacity: mouthVisible ? 1 : 0,
    },
    mouthGlow: {
      cx: mouthProj.x,
      cy: mouthProj.y,
      rx: mouthRx,
      ry: mouthRy,
      opacity: mouthVisible ? 1 : 0,
    },
  }
}

export function GazeChallengeComponentSmartFace(props: SmartFaceProps): JSX.Element {
  const { guideYaw, guidePitch, isRunning, screenWidth, screenHeight } = props

  const CX = screenWidth / 2
  const CY = screenHeight * 0.42

  const geometry = useDerivedValue(() => computeGeometry(guideYaw.value, guidePitch.value, CX, CY))

  const faceFillProps = useAnimatedProps(() => {
    const { face } = geometry.value
    return { cx: face.cx, cy: face.cy, rx: face.rx, ry: face.ry, opacity: face.opacity }
  })

  const faceGlowProps = useAnimatedProps(() => {
    const { faceGlow } = geometry.value
    return {
      cx: faceGlow.cx,
      cy: faceGlow.cy,
      rx: faceGlow.rx,
      ry: faceGlow.ry,
      opacity: faceGlow.opacity,
    }
  })

  const leftEyeFillProps = useAnimatedProps(() => {
    const { leftEye } = geometry.value
    return {
      cx: leftEye.cx,
      cy: leftEye.cy,
      rx: leftEye.rx,
      ry: leftEye.ry,
      opacity: leftEye.opacity,
    }
  })

  const leftEyeGlowProps = useAnimatedProps(() => {
    const { leftEyeGlow } = geometry.value
    return {
      cx: leftEyeGlow.cx,
      cy: leftEyeGlow.cy,
      rx: leftEyeGlow.rx,
      ry: leftEyeGlow.ry,
      opacity: leftEyeGlow.opacity,
    }
  })

  const rightEyeFillProps = useAnimatedProps(() => {
    const { rightEye } = geometry.value
    return {
      cx: rightEye.cx,
      cy: rightEye.cy,
      rx: rightEye.rx,
      ry: rightEye.ry,
      opacity: rightEye.opacity,
    }
  })

  const rightEyeGlowProps = useAnimatedProps(() => {
    const { rightEyeGlow } = geometry.value
    return {
      cx: rightEyeGlow.cx,
      cy: rightEyeGlow.cy,
      rx: rightEyeGlow.rx,
      ry: rightEyeGlow.ry,
      opacity: rightEyeGlow.opacity,
    }
  })

  const leftIrisGlowProps = useAnimatedProps(() => {
    const { leftIrisGlow } = geometry.value
    return {
      cx: leftIrisGlow.cx,
      cy: leftIrisGlow.cy,
      r: leftIrisGlow.r,
      opacity: leftIrisGlow.opacity,
    }
  })

  const leftIrisCrispProps = useAnimatedProps(() => {
    const { leftIris } = geometry.value
    return { cx: leftIris.cx, cy: leftIris.cy, r: leftIris.r, opacity: leftIris.opacity }
  })

  const leftPupilProps = useAnimatedProps(() => {
    const { leftPupil } = geometry.value
    return { cx: leftPupil.cx, cy: leftPupil.cy, r: leftPupil.r, opacity: leftPupil.opacity }
  })

  const rightIrisGlowProps = useAnimatedProps(() => {
    const { rightIrisGlow } = geometry.value
    return {
      cx: rightIrisGlow.cx,
      cy: rightIrisGlow.cy,
      r: rightIrisGlow.r,
      opacity: rightIrisGlow.opacity,
    }
  })

  const rightIrisCrispProps = useAnimatedProps(() => {
    const { rightIris } = geometry.value
    return { cx: rightIris.cx, cy: rightIris.cy, r: rightIris.r, opacity: rightIris.opacity }
  })

  const rightPupilProps = useAnimatedProps(() => {
    const { rightPupil } = geometry.value
    return { cx: rightPupil.cx, cy: rightPupil.cy, r: rightPupil.r, opacity: rightPupil.opacity }
  })

  const mouthGlowProps = useAnimatedProps(() => {
    const { mouthGlow } = geometry.value
    return {
      cx: mouthGlow.cx,
      cy: mouthGlow.cy,
      rx: mouthGlow.rx,
      ry: mouthGlow.ry,
      opacity: mouthGlow.opacity,
    }
  })

  const mouthCrispProps = useAnimatedProps(() => {
    const { mouth } = geometry.value
    return { cx: mouth.cx, cy: mouth.cy, rx: mouth.rx, ry: mouth.ry, opacity: mouth.opacity }
  })

  if (!isRunning) {
    return <View />
  }

  return (
    <View className='absolute inset-0 items-center justify-center' pointerEvents='none'>
      <Svg width={screenWidth} height={screenHeight}>
        {/* Face ellipse */}
        <AnimatedEllipse animatedProps={faceFillProps} fill={FACE_FILL} strokeWidth={0} />
        <AnimatedEllipse
          animatedProps={faceGlowProps}
          fill='none'
          stroke={BLUE_DIM}
          strokeWidth={5}
        />
        <AnimatedEllipse
          animatedProps={faceFillProps}
          fill='none'
          stroke={BLUE}
          strokeWidth={1.5}
        />

        {/* Left eye */}
        <AnimatedEllipse animatedProps={leftEyeFillProps} fill={SOCKET_FILL} strokeWidth={0} />
        <AnimatedEllipse
          animatedProps={leftEyeGlowProps}
          fill='none'
          stroke={BLUE_DIM}
          strokeWidth={4}
        />
        <AnimatedEllipse
          animatedProps={leftEyeFillProps}
          fill='none'
          stroke={BLUE}
          strokeWidth={1.2}
        />

        {/* Right eye */}
        <AnimatedEllipse animatedProps={rightEyeFillProps} fill={SOCKET_FILL} strokeWidth={0} />
        <AnimatedEllipse
          animatedProps={rightEyeGlowProps}
          fill='none'
          stroke={BLUE_DIM}
          strokeWidth={4}
        />
        <AnimatedEllipse
          animatedProps={rightEyeFillProps}
          fill='none'
          stroke={BLUE}
          strokeWidth={1.2}
        />

        {/* Left iris + pupil */}
        <AnimatedCircle
          animatedProps={leftIrisGlowProps}
          fill='none'
          stroke={BLUE_DIM}
          strokeWidth={4}
        />
        <AnimatedCircle
          animatedProps={leftIrisCrispProps}
          fill='none'
          stroke={BLUE_MID}
          strokeWidth={1.2}
        />
        <AnimatedCircle animatedProps={leftPupilProps} fill={BLUE} />

        {/* Right iris + pupil */}
        <AnimatedCircle
          animatedProps={rightIrisGlowProps}
          fill='none'
          stroke={BLUE_DIM}
          strokeWidth={4}
        />
        <AnimatedCircle
          animatedProps={rightIrisCrispProps}
          fill='none'
          stroke={BLUE_MID}
          strokeWidth={1.2}
        />
        <AnimatedCircle animatedProps={rightPupilProps} fill={BLUE} />

        {/* Mouth */}
        <AnimatedEllipse
          animatedProps={mouthGlowProps}
          fill='none'
          stroke={BLUE_DIM}
          strokeWidth={4}
        />
        <AnimatedEllipse
          animatedProps={mouthCrispProps}
          fill='none'
          stroke={BLUE}
          strokeWidth={1.2}
        />
      </Svg>
    </View>
  )
}
