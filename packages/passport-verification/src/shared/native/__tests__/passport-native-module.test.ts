/// <reference types="jest" />

import { toNativeReadPayload } from '../passport-native-module'

describe('toNativeReadPayload', () => {
  it('forwards portrait-output flags when provided', () => {
    const payload = toNativeReadPayload({
      documentNumber: 'AB1234567',
      dateOfBirthYYMMDD: '900101',
      expiryDateYYMMDD: '300101',
      mrzKey: 'AB1234567090010173001019',
      requestedDataGroups: ['DG1', 'DG2'],
      includeImageBase64: true,
      persistDg2ImageFile: true,
    })

    expect(payload).toMatchObject({
      dataGroups: ['DG1', 'DG2'],
      includeImageBase64: true,
      persistDg2ImageFile: true,
    })
  })

  it('does not include portrait-output flags when not provided', () => {
    const payload = toNativeReadPayload({
      documentNumber: 'AB1234567',
      dateOfBirthYYMMDD: '900101',
      expiryDateYYMMDD: '300101',
      mrzKey: 'AB1234567090010173001019',
      requestedDataGroups: ['DG1', 'DG2'],
    })

    expect(payload).not.toHaveProperty('includeImageBase64')
    expect(payload).not.toHaveProperty('persistDg2ImageFile')
  })

  it('maps legacy date fields to native credential keys', () => {
    const payload = toNativeReadPayload({
      documentNumber: 'AB1234567',
      // Keep required typed fields present.
      dateOfBirthYYMMDD: '900101',
      expiryDateYYMMDD: '300101',
      mrzKey: 'AB1234567090010173001019',
      requestedDataGroups: ['DG1'],
      // Simulate legacy keys from bridged input while preserving compile-time type safety.
      ...( {
        dateOfBirth: '900101',
        dateOfExpiry: '300101',
      } as Record<string, string>),
    } as Parameters<typeof toNativeReadPayload>[0])

    expect(payload).toMatchObject({
      credentials: {
        dateOfBirth: '900101',
        dateOfExpiry: '300101',
      },
    })
  })
})
