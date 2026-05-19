/// <reference types="jest" />

import { resolvePassportNfcBackendFromEnv } from '../resolvePassportNfcBackend'

describe('resolvePassportNfcBackendFromEnv', () => {
  it('defaults to js when env is missing', () => {
    expect(resolvePassportNfcBackendFromEnv(undefined, 'ios')).toBe('js')
  })

  it('defaults to js on unknown env value', () => {
    expect(resolvePassportNfcBackendFromEnv('unknown', 'ios')).toBe('js')
  })

  it('maps native to platform backend', () => {
    expect(resolvePassportNfcBackendFromEnv('native', 'ios')).toBe('native-ios')
    expect(resolvePassportNfcBackendFromEnv('native', 'android')).toBe('native-android')
  })
})
