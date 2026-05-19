import type { VerificationError, VerificationErrorCode } from '../../shared/errors'

export enum PassportUtilityErrorCode {
  INVALID_PASSPORT_FIELDS = 'INVALID_PASSPORT_FIELDS',
  INVALID_MRZ_KEY = 'INVALID_MRZ_KEY',
  INVALID_MRZ_PARSE = 'INVALID_MRZ_PARSE',
  MRZ_KEY_FIELD_MISMATCH = 'MRZ_KEY_FIELD_MISMATCH',
}

const verificationCodeByUtilityCode: Record<PassportUtilityErrorCode, VerificationErrorCode> = {
  [PassportUtilityErrorCode.INVALID_PASSPORT_FIELDS]: 'INVALID_CREDENTIALS',
  [PassportUtilityErrorCode.INVALID_MRZ_KEY]: 'INVALID_CREDENTIALS',
  [PassportUtilityErrorCode.INVALID_MRZ_PARSE]: 'MRZ_PARSE_FAILED',
  [PassportUtilityErrorCode.MRZ_KEY_FIELD_MISMATCH]: 'INVALID_CREDENTIALS',
}

export class PassportUtilityError extends Error {
  public readonly code: PassportUtilityErrorCode
  public readonly verificationError: VerificationError

  constructor(code: PassportUtilityErrorCode, message: string) {
    super(message)
    this.name = 'PassportUtilityError'
    this.code = code
    this.verificationError = {
      code: verificationCodeByUtilityCode[code],
      message,
      domain: 'passport',
      debug: {
        passportUtilityCode: code,
      },
    }
  }
}

export type PassportVerificationError = VerificationError & {
  domain?: 'passport'
}

export { createPassportNfcError, PassportNfcException } from '../nfc/errors'
