import type {
  NidNfcReadResult,
  NidVerificationResult,
  ReadNidNfcInput,
} from '@iland/nid-verification'

import type {
  DemoNidProfile,
  DemoProofRegistrationRecord,
} from '@/store/modules/demo-passport-profile'

import { DEMO_SCAN_DELAY_MS } from './demo-fixtures'

export { DEMO_SCAN_DELAY_MS }

export const DEMO_NID_NATIONAL_ID = '0084575948'
export const DEMO_NID_BARCODE_RAW = `NID*${DEMO_NID_NATIONAL_ID}*IRN`
export const DEMO_NID_FRONT_IMAGE_URI = 'demo://nid-front'

export const createDemoNidNfcResult = (input: ReadNidNfcInput = {}): NidNfcReadResult => ({
  status: 'success',
  nationalId: {
    value: input.expectedNationalId ?? DEMO_NID_NATIONAL_ID,
    source: 'nfc',
    confidence: 1,
  },
  firstName: {
    value: 'Reviewer',
    source: 'nfc',
    confidence: 1,
  },
  lastName: {
    value: 'Demo',
    source: 'nfc',
    confidence: 1,
  },
  birthDate: {
    value: '1990-01-01',
    source: 'nfc',
    confidence: 1,
  },
  cardNumber: {
    value: 'NID-DEMO-001',
    source: 'nfc',
    confidence: 1,
  },
  expiryDate: {
    value: '2030-01-01',
    source: 'nfc',
    confidence: 1,
  },
  signingCertHex: '00',
  authCertHex: '00',
  debug: {
    backend: 'demo',
    mocked: true,
    readAt: Date.now(),
  },
})

export const createDemoNidProfile = (
  result: NidVerificationResult,
  proof: DemoProofRegistrationRecord,
): DemoNidProfile => ({
  kind: 'demo-nid-profile',
  firstName: result.identity?.firstName ?? 'Reviewer',
  lastName: result.identity?.lastName ?? 'Demo',
  birthDate: result.identity?.birthDate ?? '1990-01-01',
  expiryDate: result.identity?.expiryDate ?? '2030-01-01',
  nationality: 'IRN',
  nationalId: result.identity?.nationalId ?? DEMO_NID_NATIONAL_ID,
  cardNumber: result.identity?.cardNumber ?? 'NID-DEMO-001',
  createdAt: proof.generatedAt,
  proof,
})
