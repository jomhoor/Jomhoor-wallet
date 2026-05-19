/// <reference types="jest" />

import { resolveDocumentScanFaceFlowEnabledFromEnv } from '../resolveDocumentScanFaceFlowEnabled'
import { resolveNextPassportStepAfterNfc } from '../resolveNextPassportStepAfterNfc'

describe('resolveDocumentScanFaceFlowEnabledFromEnv', () => {
  it('defaults to false when env is missing', () => {
    expect(resolveDocumentScanFaceFlowEnabledFromEnv(undefined)).toBe(false)
  })

  it('returns true only for enabled', () => {
    expect(resolveDocumentScanFaceFlowEnabledFromEnv('enabled')).toBe(true)
    expect(resolveDocumentScanFaceFlowEnabledFromEnv('ENABLED')).toBe(true)
    expect(resolveDocumentScanFaceFlowEnabledFromEnv('true')).toBe(false)
  })
})

describe('resolveNextPassportStepAfterNfc', () => {
  it('routes to preview when face flow is disabled', () => {
    expect(resolveNextPassportStepAfterNfc(false)).toBe('preview')
  })

  it('routes to liveness when face flow is enabled', () => {
    expect(resolveNextPassportStepAfterNfc(true)).toBe('face-liveness')
  })
})
