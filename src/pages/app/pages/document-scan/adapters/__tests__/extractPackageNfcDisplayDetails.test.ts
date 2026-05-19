/// <reference types="jest" />

import type { PassportNfcReadResult } from '@iland/passport-verification'

import { extractPackageNfcDisplayDetails } from '../extractPackageNfcDisplayDetails'

const createResult = (): PassportNfcReadResult => ({
  finalStatus: 'success',
  backend: 'native-ios',
  files: {},
})

describe('extractPackageNfcDisplayDetails', () => {
  it('extracts normalized fields with portrait base64 when available', () => {
    const result = createResult()
    result.normalized = {
      firstName: 'Mock',
      lastName: 'User',
      nationality: 'UTO',
      expiryDate: '2030-01-01',
      documentNumber: 'AB1234567',
    }
    result.portrait = { base64: 'base64-image' }

    const details = extractPackageNfcDisplayDetails(result)

    expect(details.firstName).toBe('Mock')
    expect(details.lastName).toBe('User')
    expect(details.nationality).toBe('UTO')
    expect(details.expiryDate).toBe('2030-01-01')
    expect(details.documentNumber).toBe('AB1234567')
    expect(details.portrait?.base64).toBe('base64-image')
  })

  it('extracts NIDN from DG11 personalNumber fallback', () => {
    const result = createResult()
    result.files.DG11 = {
      status: 'ok',
      data: {
        parsed: {
          personalNumber: 'MOCK-NIDN-001',
        },
      },
    }

    const details = extractPackageNfcDisplayDetails(result)
    expect(details.nidn).toBe('MOCK-NIDN-001')
  })

  it('extracts portrait from DG2 filePath when portrait block missing', () => {
    const result = createResult()
    result.files.DG2 = {
      status: 'ok',
      filePath: '/tmp/mock-face.jpg',
      data: {
        parsed: {
          imageBase64: 'unused-base64',
        },
      },
    }

    const details = extractPackageNfcDisplayDetails(result)
    expect(details.portrait?.filePath).toBe('/tmp/mock-face.jpg')
  })
})
