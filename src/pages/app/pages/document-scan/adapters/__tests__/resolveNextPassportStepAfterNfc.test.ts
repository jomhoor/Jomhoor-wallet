/// <reference types="jest" />

import { resolveNextPassportStepAfterNfc } from '../resolveNextPassportStepAfterNfc'

describe('resolveNextPassportStepAfterNfc', () => {
  it('routes to preview when face flow is disabled', () => {
    expect(resolveNextPassportStepAfterNfc(false, false)).toBe('preview')
    expect(resolveNextPassportStepAfterNfc(false, true)).toBe('preview')
  })

  it('routes to nfc-details when face flow enabled and enriched details exist', () => {
    expect(resolveNextPassportStepAfterNfc(true, true)).toBe('nfc-details')
  })

  it('routes to nfc-details when face flow enabled and no enriched details exist', () => {
    expect(resolveNextPassportStepAfterNfc(true, false)).toBe('nfc-details')
  })
})
