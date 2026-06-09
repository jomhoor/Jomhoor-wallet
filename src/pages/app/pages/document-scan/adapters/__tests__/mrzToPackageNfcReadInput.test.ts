/// <reference types="jest" />

import { createPackageNfcReadInput } from '../mrzToPackageNfcReadInput'

describe('createPackageNfcReadInput', () => {
  it('builds normalized package input and mrzKey from synthetic MRZ data', () => {
    const input = createPackageNfcReadInput({
      documentNumber: 'ab123456<',
      dateOfBirth: '90-01-01',
      expiryDate: '30-01-01',
      backend: 'native-ios',
    })

    expect(input.documentNumber).toBe('AB123456')
    expect(input.dateOfBirthYYMMDD).toBe('900101')
    expect(input.expiryDateYYMMDD).toBe('300101')
    expect(input.backend).toBe('native-ios')
    expect(input.mrzKey).toHaveLength(24)
    expect(input.includeImageBase64).toBe(true)
    expect(input.persistDg2ImageFile).toBe(true)
  })

  it('does not force portrait flags for non-native backend', () => {
    const input = createPackageNfcReadInput({
      documentNumber: 'ab123456<',
      dateOfBirth: '90-01-01',
      expiryDate: '30-01-01',
      backend: 'jomhoor-js',
    })

    expect(input.backend).toBe('jomhoor-js')
    expect(input.includeImageBase64).toBeUndefined()
    expect(input.persistDg2ImageFile).toBeUndefined()
  })
})
