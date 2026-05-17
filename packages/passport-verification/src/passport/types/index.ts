export type MrzInput = string | string[]

export type PassportFieldInput = {
  documentNumber?: string | null
  dateOfBirth?: string | null
  dateOfExpiry?: string | null
}

export type PassportCredentialsInput = PassportFieldInput & {
  mrzKey?: string | null
}

export type PassportCredentials = {
  documentNumber: string
  dateOfBirth: string
  dateOfExpiry: string
  mrzKey: string
}

export const MRZ_FORMATS = {
  TD1: 'TD1',
  TD2: 'TD2',
  TD3: 'TD3',
} as const

export type MrzFormat = (typeof MRZ_FORMATS)[keyof typeof MRZ_FORMATS]

export type ParsedMrzCheckDigits = {
  documentNumber: number | null
  dateOfBirth: number | null
  dateOfExpiry: number | null
  optionalData?: number | null
  composite?: number | null
}

export type ParsedMrz = {
  format: MrzFormat
  lines: string[]
  documentCode: string
  issuingState: string
  nationality: string
  surname: string
  givenNames: string[]
  fullName: string
  documentNumber: string
  documentNumberMrz: string
  dateOfBirth: string
  dateOfExpiry: string
  sex: string | null
  optionalData: string
  checkDigits: ParsedMrzCheckDigits
  compositeCheckSource: string
}

export type MrzValidationResult = {
  isValid: boolean
  errors: string[]
  checks: Record<string, boolean>
  normalized?: {
    documentNumber: string
    dateOfBirth: string
    dateOfExpiry: string
  }
}
