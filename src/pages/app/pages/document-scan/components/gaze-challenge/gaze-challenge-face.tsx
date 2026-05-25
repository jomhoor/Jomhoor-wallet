import { View } from 'react-native'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'

import type { GazeChallengeComponentProps } from './types'

const GUIDING_FACE_IMAGE = require('@assets/guiding-face.png')

type GazeChallengeComponentFaceProps = GazeChallengeComponentProps & {
  guideYaw: Animated.SharedValue<number>
  guidePitch: Animated.SharedValue<number>
  challengeMaxYawDeg: number
  challengeMaxPitchDeg: number
}

/**
 * Face Mode Visualization
 *
 * Renders a rotating guiding face avatar that the user matches their head pose to.
 * The face rotates in 3D space (yaw/pitch) to guide the user to each waypoint.
 *
 * Uses a PNG image with Reanimated 3D transforms:
 * - rotateY for yaw (head turning left/right)
 * - rotateX for pitch (head tilting up/down)
 *
 * Props:
 * - guideYaw, guidePitch: Reanimated shared values for face rotation
 * - challengeMaxYawDeg, challengeMaxPitchDeg: Max rotation range from challenge config
 * - All standard GazeChallengeComponentProps
 */
export function GazeChallengeComponentFace(props: GazeChallengeComponentFaceProps): JSX.Element {
  const { guideYaw, guidePitch, isRunning, challengeMaxYawDeg, challengeMaxPitchDeg } = props
  const overlaySize = 500

  const guideFaceStyle = useAnimatedStyle(() => {
    const maxYaw = Math.max(challengeMaxYawDeg, 1)
    const maxPitch = Math.max(challengeMaxPitchDeg, 1)

    return {
      transform: [
        { translateX: (guideYaw.value / maxYaw) * 18 },
        { translateY: (-guidePitch.value / maxPitch) * 14 },
        { perspective: 800 },
        { rotateY: `${guideYaw.value}deg` },
        { rotateX: `${-guidePitch.value}deg` },
      ],
    }
  })

  // Only render when challenge is running
  if (!isRunning) {
    return <View />
  }

  return (
    <View className='absolute inset-0 items-center justify-center' pointerEvents='none'>
      <Animated.Image
        source={GUIDING_FACE_IMAGE}
        resizeMode='contain'
        style={[guideFaceStyle, { width: overlaySize, height: overlaySize, opacity: 0.82 }]}
      />
    </View>
  )
}
