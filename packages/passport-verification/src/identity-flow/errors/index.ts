import type { VerificationError } from '../../shared/errors'

export type IdentityFlowError = VerificationError & {
  domain?: 'identity-flow'
}
