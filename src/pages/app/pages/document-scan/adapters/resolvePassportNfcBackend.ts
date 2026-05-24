import { Platform } from 'react-native'

export type ResolvedPassportNfcBackend = 'native-ios' | 'native-android'

// Always use native NFC backend (no environment variable override)
export function resolvePassportNfcBackend(
  platform: string = Platform.OS,
): ResolvedPassportNfcBackend {
  if (platform === 'ios') return 'native-ios'
  if (platform === 'android') return 'native-android'
  // Fallback to ios (shouldn't happen in practice)
  return 'native-ios'
}
