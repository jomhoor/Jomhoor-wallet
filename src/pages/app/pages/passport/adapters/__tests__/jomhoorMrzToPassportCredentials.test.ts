/// <reference types="jest" />

import { jomhoorMrzToPassportCredentials } from '../jomhoorMrzToPassportCredentials'

describe('jomhoorMrzToPassportCredentials', () => {
  it('normalizes valid Jomhoor MRZ payload into package credentials', () => {
    const credentials = jomhoorMrzToPassportCredentials({
      documentNumber: 'ab123456<',
      birthDate: '90-01-01',
      expirationDate: '30-01-01',
    })

    expect(credentials.documentNumber).toBe('AB123456')
    expect(credentials.dateOfBirthYYMMDD).toBe('900101')
    expect(credentials.expiryDateYYMMDD).toBe('300101')
    expect(credentials.mrzKey).toHaveLength(24)
  })

  it('throws on missing document number', () => {
    expect(() =>
      jomhoorMrzToPassportCredentials({
        birthDate: '900101',
        expirationDate: '300101',
      }),
    ).toThrow('MRZ document number is missing.')
  })
})
