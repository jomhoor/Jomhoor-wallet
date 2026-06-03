import {
  createPassportMrzScanResult,
  type PassportMrzBarcodeResult,
  type PassportNfcReadResult,
} from '@iland/passport-verification'

import type {
  DemoPassportProfile,
  DemoProofRegistrationRecord,
} from '@/store/modules/demo-passport-profile'
import { EPassport, type PersonDetails } from '@/utils/e-document'
import type { PassportNfcScanOutput } from '@/utils/e-document/passport-nfc-reader'

export const DEMO_SCAN_DELAY_MS = 3000
export const DEMO_PROOF_DELAY_MS = 3000

const DEMO_MRZ_LINES = [
  'P<UTODEMO<<REVIEWER<<<<<<<<<<<<<<<<<<<<<<<<<',
  'L898902C36UTO7408122F3001019ZE184226B<<<<<16',
]

const DEMO_PERSON_DETAILS: PersonDetails = {
  firstName: 'Reviewer',
  lastName: 'Demo',
  gender: 'F',
  birthDate: '740812',
  expiryDate: '300101',
  documentNumber: 'L898902C3',
  nationality: 'UTO',
  issuingAuthority: 'UTO',
  passportImageRaw: null,
}

const demoMrzResult = createPassportMrzScanResult(DEMO_MRZ_LINES.join('\n'))

if (!demoMrzResult) {
  throw new Error('Demo passport MRZ fixture is invalid')
}

export const DEMO_PASSPORT_MRZ_BARCODE_RESULT: PassportMrzBarcodeResult = {
  credentials: demoMrzResult.credentials,
  parsedMrz: demoMrzResult.parsed,
  barcode: {
    raw: 'DEMO-REVIEWER-0001',
    nidn: 'DEMO-REVIEWER-0001',
    fields: {
      source: 'demo',
    },
  },
}

const createDemoPackageNfcResult = (): PassportNfcReadResult => ({
  finalStatus: 'success',
  backend: 'stub',
  accessControl: {
    method: 'BAC',
    bacStatus: 'success',
    fallbackUsed: false,
  },
  files: {
    DG1: {
      status: 'ok',
      data: {
        rawHex: '6102AA55',
        parsed: {
          documentNumber: DEMO_PERSON_DETAILS.documentNumber,
          firstName: DEMO_PERSON_DETAILS.firstName,
          lastName: DEMO_PERSON_DETAILS.lastName,
          dateOfBirth: DEMO_PERSON_DETAILS.birthDate,
          documentExpiryDate: DEMO_PERSON_DETAILS.expiryDate,
          nationality: DEMO_PERSON_DETAILS.nationality,
          sex: DEMO_PERSON_DETAILS.gender,
          issuingAuthority: DEMO_PERSON_DETAILS.issuingAuthority,
        },
      },
    },
    DG11: {
      status: 'ok',
      data: {
        rawHex: '6B02AA55',
        parsed: {
          personalNumber: 'DEMO-REVIEWER-0001',
        },
      },
    },
    SOD: {
      status: 'ok',
      data: {
        rawHex: '7702AA55',
      },
    },
  },
  normalized: {
    documentNumber: DEMO_PERSON_DETAILS.documentNumber ?? undefined,
    firstName: DEMO_PERSON_DETAILS.firstName ?? undefined,
    lastName: DEMO_PERSON_DETAILS.lastName ?? undefined,
    birthDate: DEMO_PERSON_DETAILS.birthDate ?? undefined,
    expiryDate: DEMO_PERSON_DETAILS.expiryDate ?? undefined,
    nationality: DEMO_PERSON_DETAILS.nationality ?? undefined,
    sex: DEMO_PERSON_DETAILS.gender ?? undefined,
  },
  raw: {
    demo: true,
  },
})

export const createDemoPassportNfcScanOutput = (): PassportNfcScanOutput => {
  const packageNfcResult = createDemoPackageNfcResult()

  return {
    ePassport: new EPassport({
      docCode: 'P',
      personDetails: { ...DEMO_PERSON_DETAILS },
      dg1Bytes: new Uint8Array([0x61, 0x02, 0xaa, 0x55]),
      sodBytes: new Uint8Array([0x77, 0x02, 0xaa, 0x55]),
      dg11Bytes: new Uint8Array([0x6b, 0x02, 0xaa, 0x55]),
    }),
    packageNfcResult,
    normalized: {
      ...packageNfcResult.normalized,
      nidn: 'DEMO-REVIEWER-0001',
    },
  }
}

const createDemoIdentifier = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

export const createDemoProofRegistrationRecord = (): DemoProofRegistrationRecord => ({
  kind: 'demo',
  proofId: createDemoIdentifier('demo-proof'),
  registrationId: createDemoIdentifier('demo-registration'),
  generatedAt: new Date().toISOString(),
})

export const createDemoPassportProfile = (
  proof: DemoProofRegistrationRecord,
): DemoPassportProfile => ({
  kind: 'demo-passport-profile',
  firstName: DEMO_PERSON_DETAILS.firstName ?? 'Reviewer',
  lastName: DEMO_PERSON_DETAILS.lastName ?? 'Demo',
  birthDate: DEMO_PERSON_DETAILS.birthDate ?? '',
  expiryDate: DEMO_PERSON_DETAILS.expiryDate ?? '',
  documentNumber: DEMO_PERSON_DETAILS.documentNumber ?? '',
  nationality: DEMO_PERSON_DETAILS.nationality ?? 'UTO',
  issuingAuthority: DEMO_PERSON_DETAILS.issuingAuthority ?? 'UTO',
  createdAt: proof.generatedAt,
  proof,
})
