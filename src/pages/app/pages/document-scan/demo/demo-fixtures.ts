import type { DemoProofRegistrationRecord } from '@/store/modules/demo-passport-profile'

export const DEMO_SCAN_DELAY_MS = 3000
export const DEMO_PROOF_DELAY_MS = 3000

export const createDemoIdentifier = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

export const createDemoProofRegistrationRecord = (): DemoProofRegistrationRecord => ({
  kind: 'demo',
  proofId: createDemoIdentifier('demo-proof'),
  registrationId: createDemoIdentifier('demo-registration'),
  generatedAt: new Date().toISOString(),
})
