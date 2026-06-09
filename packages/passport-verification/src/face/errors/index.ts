import type { VerificationError } from '../../shared/errors'

export type FaceVerificationError = VerificationError & {
  domain?: 'face'
}
