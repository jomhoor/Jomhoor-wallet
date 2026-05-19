/// <reference types="jest" />

import type { PassportNfcReadResult } from '@iland/passport-verification/passport'

jest.mock('@/utils/e-document', () => ({
  EPassport: class MockEPassport {
    constructor(_: unknown) {}
  },
}))

import {
  PackageNfcMappingError,
  packageNfcResultToEPassport,
} from '../packageNfcResultToEPassport'

function createBaseResult(): PassportNfcReadResult {
  return {
    finalStatus: 'success',
    backend: 'native-ios',
    files: {},
  }
}

describe('packageNfcResultToEPassport', () => {
  it('throws controlled error when DG1 is missing', () => {
    const payload = createBaseResult()

    expect(() => packageNfcResultToEPassport(payload)).toThrow(PackageNfcMappingError)
    expect(() => packageNfcResultToEPassport(payload)).toThrow('DG1')
  })

  it('throws controlled error when SOD is missing', () => {
    const payload = createBaseResult()
    payload.files.DG1 = {
      status: 'ok',
      data: { rawHex: '6102AA55', parsed: { documentNumber: 'MOCK1234' } },
    }

    expect(() => packageNfcResultToEPassport(payload)).toThrow(PackageNfcMappingError)
    expect(() => packageNfcResultToEPassport(payload)).toThrow('SOD')
  })
})
