import {
  createPassportCredentials,
  type PassportCredentials,
} from '@iland/passport-verification/passport'

export class JomhoorMrzAdapterError extends Error {
  public readonly code: 'INVALID_INPUT' | 'MISSING_FIELD' | 'INVALID_DATE'

  constructor(code: 'INVALID_INPUT' | 'MISSING_FIELD' | 'INVALID_DATE', message: string) {
    super(message)
    this.name = 'JomhoorMrzAdapterError'
    this.code = code
  }
}

type JomhoorMrzInput = {
  documentNumber?: unknown
  birthDate?: unknown
  expirationDate?: unknown
}

const normalizeDocumentNumber = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, '').toUpperCase().replace(/<+$/g, '')
}

const normalizeMrzDate = (value: unknown): string => {
  if (typeof value !== 'string') return ''

  const compact = value.trim().replace(/[^0-9]/g, '')
  if (compact.length === 6) {
    return compact
  }

  if (compact.length === 8) {
    return compact.slice(2)
  }

  return ''
}

const readMrzValue = (input: unknown): JomhoorMrzInput => {
  if (!input || typeof input !== 'object') {
    throw new JomhoorMrzAdapterError('INVALID_INPUT', 'MRZ payload is not an object.')
  }

  return input as JomhoorMrzInput
}

export function jomhoorMrzToPassportCredentials(input: unknown): PassportCredentials {
  const mrz = readMrzValue(input)

  const documentNumber = normalizeDocumentNumber(mrz.documentNumber)
  const dateOfBirthYYMMDD = normalizeMrzDate(mrz.birthDate)
  const expiryDateYYMMDD = normalizeMrzDate(mrz.expirationDate)

  if (!documentNumber) {
    throw new JomhoorMrzAdapterError('MISSING_FIELD', 'MRZ document number is missing.')
  }
  if (!dateOfBirthYYMMDD) {
    throw new JomhoorMrzAdapterError('INVALID_DATE', 'MRZ birth date is missing or malformed.')
  }
  if (!expiryDateYYMMDD) {
    throw new JomhoorMrzAdapterError('INVALID_DATE', 'MRZ expiry date is missing or malformed.')
  }

  return createPassportCredentials({
    documentNumber,
    dateOfBirthYYMMDD,
    expiryDateYYMMDD,
  })
}
