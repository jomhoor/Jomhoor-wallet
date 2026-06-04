/// <reference types="jest" />

jest.mock('@/utils/e-document', () => ({
  EPassport: class MockEPassport {
    constructor(_params: unknown) {}
  },
}))

import {
  createDemoPassportNfcScanOutput,
  createDemoPassportProfile,
  createDemoProofRegistrationRecord,
  DEMO_PASSPORT_MRZ_BARCODE_RESULT,
} from '../passport-demo-fixtures'

describe('passport demo fixtures', () => {
  it('provides a validated fictional Iranian passport result for proposal eligibility', () => {
    expect(DEMO_PASSPORT_MRZ_BARCODE_RESULT.credentials.documentNumber).toBe('L898902C3')
    expect(DEMO_PASSPORT_MRZ_BARCODE_RESULT.parsedMrz.issuingState).toBe('IRN')
    expect(DEMO_PASSPORT_MRZ_BARCODE_RESULT.parsedMrz.nationality).toBe('IRN')
    expect(DEMO_PASSPORT_MRZ_BARCODE_RESULT.barcode?.nidn).toBe('DEMO-REVIEWER-0001')
  })

  it('marks NFC data as a stub result', () => {
    const output = createDemoPassportNfcScanOutput()

    expect(output.packageNfcResult?.backend).toBe('stub')
    expect(output.packageNfcResult?.finalStatus).toBe('success')
    expect(output.normalized?.nationality).toBe('IRN')
    expect(output.normalized?.nidn).toBe('DEMO-REVIEWER-0001')
  })

  it('creates demo-only proof metadata and profile data', () => {
    const proof = createDemoProofRegistrationRecord()
    const profile = createDemoPassportProfile(proof)

    expect(proof.kind).toBe('demo')
    expect(profile.kind).toBe('demo-passport-profile')
    expect(profile.nationality).toBe('IRN')
    expect(profile.proof).toBe(proof)
  })
})
