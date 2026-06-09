/// <reference types="jest" />

import { resolvePassportNfcBackend } from '../resolvePassportNfcBackend'

describe('resolvePassportNfcBackend', () => {
  it('returns native-ios on iOS', () => {
    expect(resolvePassportNfcBackend('ios')).toBe('native-ios')
  })

  it('returns native-android on Android', () => {
    expect(resolvePassportNfcBackend('android')).toBe('native-android')
  })

  it('defaults to native-ios for unknown platform', () => {
    expect(resolvePassportNfcBackend('unknown')).toBe('native-ios')
  })
})
