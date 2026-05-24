/// <reference types="jest" />

import { resolvePassportNfcBackendFromEnv } from '../resolvePassportNfcBackend'

describe('resolvePassportNfcBackendFromEnv', () => {
  it('defaults to platform-native when env is missing', () => {
    expect(resolvePassportNfcBackendFromEnv(undefined, 'ios')).toBe('native-ios')
    expect(resolvePassportNfcBackendFromEnv(undefined, 'android')).toBe('native-android')
  })

  it('defaults to platform-native on unknown env value', () => {
    expect(resolvePassportNfcBackendFromEnv('unknown', 'ios')).toBe('native-ios')
    expect(resolvePassportNfcBackendFromEnv('unknown', 'android')).toBe('native-android')
  })

  it('maps native to platform backend', () => {
    expect(resolvePassportNfcBackendFromEnv('native', 'ios')).toBe('native-ios')
    expect(resolvePassportNfcBackendFromEnv('native', 'android')).toBe('native-android')
  })
})
