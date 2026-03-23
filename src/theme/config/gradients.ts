import type { LinearGradientProps } from 'react-native-linear-gradient'

type Gradient = 'aditionalGreenGradient' | 'aditionalPerpleGradient' | 'aditionalDarkGradient'

/** Invite screen — light uses brand pastels; dark uses muted equivalents. */
export const inviteOthersGradients = {
  light: ['#CBE7EC', '#F2F8EE'] as const,
  dark: ['#152028', '#181f14'] as const,
}

export const appGradients: Record<Gradient, LinearGradientProps> = {
  aditionalGreenGradient: {
    colors: ['#1D7F68', '#136854'],
    useAngle: false,
  },
  aditionalPerpleGradient: {
    colors: ['#E7C1FE', '#D3A6EE'],
    useAngle: false,
  },
  aditionalDarkGradient: {
    colors: ['#1D1D1D', '#1A1A1A'],
    useAngle: false,
  },
}
