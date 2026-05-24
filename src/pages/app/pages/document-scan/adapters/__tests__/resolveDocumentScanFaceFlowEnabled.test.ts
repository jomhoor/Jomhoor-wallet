/// <reference types="jest" />

import { resolveDocumentScanFaceFlowEnabledFromEnv } from '../resolveDocumentScanFaceFlowEnabled'
import { resolveNextPassportStepAfterNfc } from '../resolveNextPassportStepAfterNfc'

describe('resolveDocumentScanFaceFlowEnabledFromEnv', () => {
  it('defaults to true when env is missing', () => {
    expect(resolveDocumentScanFaceFlowEnabledFromEnv(undefined)).toBe(true)
  })

  it('does not depend on env value by default', () => {
    expect(resolveDocumentScanFaceFlowEnabledFromEnv('enabled')).toBe(true)
    expect(resolveDocumentScanFaceFlowEnabledFromEnv('ENABLED')).toBe(true)
    expect(resolveDocumentScanFaceFlowEnabledFromEnv('true')).toBe(true)
    expect(resolveDocumentScanFaceFlowEnabledFromEnv('disabled')).toBe(true)
  })
})

describe('resolveNextPassportStepAfterNfc', () => {
  it('routes to preview when face flow is disabled', () => {
    expect(resolveNextPassportStepAfterNfc(false, false)).toBe('preview')
  })

  it('routes to nfc-details when face flow is enabled and details are available', () => {
    expect(resolveNextPassportStepAfterNfc(true, true)).toBe('nfc-details')
  })

  it('routes to nfc-details when face flow is enabled and details are unavailable', () => {
    expect(resolveNextPassportStepAfterNfc(true, false)).toBe('nfc-details')
  })
})
