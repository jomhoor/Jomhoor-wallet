export enum PassportUtilityErrorCode {
  INVALID_PASSPORT_FIELDS = 'INVALID_PASSPORT_FIELDS',
  INVALID_MRZ_KEY = 'INVALID_MRZ_KEY',
  INVALID_MRZ_PARSE = 'INVALID_MRZ_PARSE',
  MRZ_KEY_FIELD_MISMATCH = 'MRZ_KEY_FIELD_MISMATCH',
}

export class PassportUtilityError extends Error {
  public readonly code: PassportUtilityErrorCode

  constructor(code: PassportUtilityErrorCode, message: string) {
    super(message)
    this.name = 'PassportUtilityError'
    this.code = code
  }
}
