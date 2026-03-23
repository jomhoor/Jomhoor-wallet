import { DefaultTheme, type Theme } from '@react-navigation/native'
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack'

import type { BaseTheme } from '@/theme/config/colors'

export function getNavigationTheme(palette: BaseTheme, isDark: boolean): Theme {
  return {
    dark: isDark,
    colors: {
      primary: palette.primaryMain,
      background: palette.backgroundPrimary,
      card: palette.backgroundPure,
      text: palette.textPrimary,
      border: palette.additionalLayerBorder,
      notification: palette.errorMain,
    },
    fonts: DefaultTheme.fonts,
  }
}

/** Default native-stack chrome for in-app flows with visible headers. */
export function getAppStackScreenOptions(palette: BaseTheme): NativeStackNavigationOptions {
  return {
    headerBackTitle: '',
    headerShadowVisible: false,
    headerStyle: { backgroundColor: 'transparent' },
    headerTitle: '',
    headerTintColor: palette.textPrimary,
  }
}
