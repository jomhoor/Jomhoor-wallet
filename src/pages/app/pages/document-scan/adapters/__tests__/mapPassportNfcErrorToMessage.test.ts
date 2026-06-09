/// <reference types="jest" />

import { mapPassportNfcErrorToMessage } from '../mapPassportNfcErrorToMessage'

describe('mapPassportNfcErrorToMessage', () => {
  it('maps native timeout code to user-friendly message', () => {
    const mapped = mapPassportNfcErrorToMessage(
      {
        detail: {
          code: 'NFC_TIMEOUT',
          message: 'timeout',
        },
      },
      { debugEnabled: true },
    )

    expect(mapped.primary.toLowerCase()).toContain('timed out')
    expect(mapped.code).toBe('NFC_TIMEOUT')
  })

  it('maps BAC/auth style errors to MRZ guidance', () => {
    const mapped = mapPassportNfcErrorToMessage(new Error('EXTERNAL AUTHENTICATE failed'))

    expect(mapped.primary.toLowerCase()).toContain('authentication failed')
    expect(mapped.secondary?.toLowerCase()).toContain('rescan mrz')
  })
})
