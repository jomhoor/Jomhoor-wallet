import { Platform } from 'react-native'

export type ResolvedPassportNfcBackend = 'js' | 'native-ios' | 'native-android'

export function resolvePassportNfcBackendFromEnv(
  envValue: string | undefined,
  platform: string = Platform.OS,
): ResolvedPassportNfcBackend {
  const normalized = envValue?.trim().toLowerCase()

  if (normalized === 'js') return 'js'
  if (normalized === 'native-ios') return 'native-ios'
  if (normalized === 'native-android') return 'native-android'

  if (normalized === 'native') {
    if (platform === 'ios') return 'native-ios'
    if (platform === 'android') return 'native-android'
    return 'js'
  }

  if (platform === 'ios') return 'native-ios'
  if (platform === 'android') return 'native-android'
  return 'js'
}

export function resolvePassportNfcBackend(): ResolvedPassportNfcBackend {
  return resolvePassportNfcBackendFromEnv(process.env.EXPO_PUBLIC_PASSPORT_NFC_BACKEND)
}
