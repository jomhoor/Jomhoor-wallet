/// <reference types="jest" />

import { parseNidBarcode } from '@iland/nid-verification/barcode'

import { createDemoProofRegistrationRecord } from '../demo-fixtures'
import {
  createDemoNidNfcResult,
  createDemoNidProfile,
  DEMO_NID_BARCODE_RAW,
  DEMO_NID_NATIONAL_ID,
} from '../nid-demo-fixtures'

describe('NID demo fixtures', () => {
  it('uses a valid fictional Iranian national ID barcode', () => {
    expect(parseNidBarcode(DEMO_NID_BARCODE_RAW)?.nidn).toBe(DEMO_NID_NATIONAL_ID)
  })

  it('creates a successful mocked NFC result without real certificate material', () => {
    const result = createDemoNidNfcResult()

    expect(result.status).toBe('success')
    expect(result.nationalId?.value).toBe(DEMO_NID_NATIONAL_ID)
    expect(result.debug?.mocked).toBe(true)
    expect(result.debug?.backend).toBe('demo')
  })

  it('creates a separate local demo NID profile', () => {
    const nfc = createDemoNidNfcResult()
    const proof = createDemoProofRegistrationRecord()
    const profile = createDemoNidProfile(
      {
        verified: true,
        finalDecision: 'verified',
        front: { frontImageUri: 'demo://nid-front' },
        back: {
          barcodeRaw: DEMO_NID_BARCODE_RAW,
          nationalId: { value: DEMO_NID_NATIONAL_ID, source: 'barcode' },
        },
        nfc,
        face: {
          passed: true,
          liveness: { passed: true, challenges: [] },
          gaze: { passed: true, score: 1 },
          comparison: { passed: true, similarity: 1, threshold: 0.1 },
        },
        identity: {
          nationalId: DEMO_NID_NATIONAL_ID,
          firstName: nfc.firstName?.value,
          lastName: nfc.lastName?.value,
          birthDate: nfc.birthDate?.value,
          cardNumber: nfc.cardNumber?.value,
          expiryDate: nfc.expiryDate?.value,
        },
      },
      proof,
    )

    expect(profile.kind).toBe('demo-nid-profile')
    expect(profile.nationalId).toBe(DEMO_NID_NATIONAL_ID)
    expect(profile.proof).toBe(proof)
  })
})
