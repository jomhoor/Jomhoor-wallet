import { View } from 'react-native'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'

import type { GazeChallengeComponentProps } from './types'

const DOT_RADIUS_PX = 14

type GazeChallengeComponentDotProps = GazeChallengeComponentProps & {
  dotX: Animated.SharedValue<number>
  dotY: Animated.SharedValue<number>
}

/**
 * Dot Mode Visualization
 *
 * Renders a small glowing dot that the user follows with their gaze.
 * The dot animates to each waypoint position based on screenX/screenY.
 *
 * Props:
 * - dotX, dotY: Reanimated shared values for dot position
 * - All standard GazeChallengeComponentProps
 */
export function GazeChallengeComponentDot(props: GazeChallengeComponentDotProps): JSX.Element {
  const { dotX, dotY, isRunning } = props

  const dotStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: dotX.value - DOT_RADIUS_PX },
      { translateY: dotY.value - DOT_RADIUS_PX },
    ],
  }))

  // Only render when challenge is running
  if (!isRunning) {
    return <View />
  }

  return (
    <Animated.View
      style={dotStyle}
      className='absolute h-7 w-7 rounded-full border border-white/70 bg-white shadow-2xl'
      pointerEvents='none'
    />
  )
}
