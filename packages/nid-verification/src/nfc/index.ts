import type { NidNfcReadResult } from '../types'

export type ReadMockNidNfcInput = {
  expectedNationalId?: string
}

const wait = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms)
  })

export async function readMockNidNfc(input: ReadMockNidNfcInput = {}): Promise<NidNfcReadResult> {
  await wait(800)

  const resolvedNationalId = input.expectedNationalId ?? '0084575948'

  return {
    status: 'success',
    nationalId: {
      value: resolvedNationalId,
      source: 'nfc',
      confidence: 1,
    },
    firstName: {
      value: 'MOCK',
      source: 'nfc',
      confidence: 1,
    },
    lastName: {
      value: 'USER',
      source: 'nfc',
      confidence: 1,
    },
    birthDate: {
      value: '1990-01-01',
      source: 'nfc',
      confidence: 1,
    },
    cardNumber: {
      value: 'NID-MOCK-001',
      source: 'nfc',
      confidence: 1,
    },
    expiryDate: {
      value: '2030-01-01',
      source: 'nfc',
      confidence: 1,
    },
    // Phase 1 uses placeholders; real certs arrive in Phase 2 integration.
    signingCertHex: 'PHASE1_MOCK_SIGNING_CERT_HEX',
    authCertHex: 'PHASE1_MOCK_AUTH_CERT_HEX',
    debug: {
      mocked: true,
      readAt: Date.now(),
    },
  }
}
