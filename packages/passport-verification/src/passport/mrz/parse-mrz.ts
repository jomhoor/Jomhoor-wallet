import { PassportUtilityError, PassportUtilityErrorCode } from '../errors'
import {
  MRZ_FORMATS,
  type MrzFormat,
  type MrzInput,
  type MrzValidationResult,
  type ParsedMrz,
  type PassportCredentials,
  type PassportCredentialsInput,
  type PassportFieldInput,
} from '../types'

const CHECK_DIGIT_WEIGHTS = [7, 3, 1]
const DIGIT_PATTERN = /^\d$/
const DATE_PATTERN = /^\d{6}$/
const DOCUMENT_NUMBER_PATTERN = /^[A-Z0-9]{1,9}$/
const MRZ_KEY_PATTERN = /^[A-Z0-9<]{24}$/

const coerceLines = (input: MrzInput): string[] => {
  if (Array.isArray(input)) return input
  if (typeof input === 'string') return input.split(/\r?\n/)
  return []
}

const normalizeAscii = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')

const decodeMrzText = (value: string): string => sanitizeMrzText(value).replace(/<+/g, ' ').trim()

const stripFillers = (value: string): string => sanitizeMrzText(value).replace(/</g, '')

const padMrzField = (value: string, length: number): string =>
  sanitizeMrzText(value).slice(0, length).padEnd(length, '<')

const toCheckDigitNumber = (value: unknown): number | null => {
  const normalized = sanitizeMrzText(value)
  if (!normalized || !DIGIT_PATTERN.test(normalized[0])) {
    return null
  }
  return Number(normalized[0])
}

const parseNames = (value: string) => {
  const normalized = padMrzField(value, sanitizeMrzText(value).length || 0)
  const [surnamePart, givenPart = ''] = normalized.split('<<', 2)
  const surname = decodeMrzText(surnamePart)
  const givenNames = decodeMrzText(givenPart).split(/\s+/).filter(Boolean)

  return {
    surname,
    givenNames,
    fullName: [surname, ...givenNames].filter(Boolean).join(' ').trim(),
  }
}

const decodeSex = (value: string): string | null => {
  const normalized = sanitizeMrzText(value)
  if (!normalized || normalized[0] === '<') {
    return null
  }
  return normalized[0]
}

const invalidParseResult = (message: string): MrzValidationResult => ({
  isValid: false,
  errors: [message],
  checks: {},
})

const buildCheckResult = (
  label: string,
  source: string,
  digit: number | null | undefined,
  errors: string[],
): boolean => {
  if (!DIGIT_PATTERN.test(String(digit ?? ''))) {
    errors.push(`Missing ${label} check digit.`)
    return false
  }

  const valid = verifyMrzCheckDigit(source, digit)
  if (!valid) {
    errors.push(`Invalid ${label} check digit.`)
  }
  return valid
}

const parseTd3 = (lines: string[]): ParsedMrz => {
  const line1 = padMrzField(lines[0], 44)
  const line2 = padMrzField(lines[1], 44)
  const names = parseNames(line1.slice(5, 44))
  const documentNumberMrz = line2.slice(0, 9)

  return {
    format: MRZ_FORMATS.TD3,
    lines: [line1, line2],
    documentCode: stripFillers(line1.slice(0, 2)),
    issuingState: stripFillers(line1.slice(2, 5)),
    nationality: stripFillers(line2.slice(10, 13)),
    surname: names.surname,
    givenNames: names.givenNames,
    fullName: names.fullName,
    documentNumber: stripFillers(documentNumberMrz),
    documentNumberMrz,
    dateOfBirth: line2.slice(13, 19),
    dateOfExpiry: line2.slice(21, 27),
    sex: decodeSex(line2[20]),
    optionalData: line2.slice(28, 42),
    checkDigits: {
      documentNumber: toCheckDigitNumber(line2[9]),
      dateOfBirth: toCheckDigitNumber(line2[19]),
      dateOfExpiry: toCheckDigitNumber(line2[27]),
      optionalData: toCheckDigitNumber(line2[42]),
      composite: toCheckDigitNumber(line2[43]),
    },
    compositeCheckSource: `${line2.slice(0, 10)}${line2.slice(13, 20)}${line2.slice(21, 43)}`,
  }
}

const parseTd2 = (lines: string[]): ParsedMrz => {
  const line1 = padMrzField(lines[0], 36)
  const line2 = padMrzField(lines[1], 36)
  const names = parseNames(line1.slice(5, 36))
  const documentNumberMrz = line2.slice(0, 9)

  return {
    format: MRZ_FORMATS.TD2,
    lines: [line1, line2],
    documentCode: stripFillers(line1.slice(0, 2)),
    issuingState: stripFillers(line1.slice(2, 5)),
    nationality: stripFillers(line2.slice(10, 13)),
    surname: names.surname,
    givenNames: names.givenNames,
    fullName: names.fullName,
    documentNumber: stripFillers(documentNumberMrz),
    documentNumberMrz,
    dateOfBirth: line2.slice(13, 19),
    dateOfExpiry: line2.slice(21, 27),
    sex: decodeSex(line2[20]),
    optionalData: line2.slice(28, 35),
    checkDigits: {
      documentNumber: toCheckDigitNumber(line2[9]),
      dateOfBirth: toCheckDigitNumber(line2[19]),
      dateOfExpiry: toCheckDigitNumber(line2[27]),
      composite: toCheckDigitNumber(line2[35]),
    },
    compositeCheckSource: `${line2.slice(0, 10)}${line2.slice(13, 20)}${line2.slice(21, 35)}`,
  }
}

const parseTd1 = (lines: string[]): ParsedMrz => {
  const line1 = padMrzField(lines[0], 30)
  const line2 = padMrzField(lines[1], 30)
  const line3 = padMrzField(lines[2], 30)
  const names = parseNames(line3)
  const documentNumberMrz = line1.slice(5, 14)

  return {
    format: MRZ_FORMATS.TD1,
    lines: [line1, line2, line3],
    documentCode: stripFillers(line1.slice(0, 2)),
    issuingState: stripFillers(line1.slice(2, 5)),
    nationality: stripFillers(line2.slice(15, 18)),
    surname: names.surname,
    givenNames: names.givenNames,
    fullName: names.fullName,
    documentNumber: stripFillers(documentNumberMrz),
    documentNumberMrz,
    dateOfBirth: line2.slice(0, 6),
    dateOfExpiry: line2.slice(8, 14),
    sex: decodeSex(line2[7]),
    optionalData: `${line1.slice(15, 30)}${line2.slice(18, 29)}`,
    checkDigits: {
      documentNumber: toCheckDigitNumber(line1[14]),
      dateOfBirth: toCheckDigitNumber(line2[6]),
      dateOfExpiry: toCheckDigitNumber(line2[14]),
      composite: toCheckDigitNumber(line2[29]),
    },
    compositeCheckSource: `${line1.slice(5, 30)}${line2.slice(0, 7)}${line2.slice(8, 15)}${line2.slice(18, 29)}`,
  }
}

export const sanitizeMrzText = (value: unknown): string =>
  normalizeAscii(value)
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9<]/g, '')

export const normalizeMrzLines = (input: MrzInput): string[] =>
  coerceLines(input).map(sanitizeMrzText).filter(Boolean)

export const normalizeDocumentNumber = (value: unknown): string =>
  stripFillers(String(value ?? '')).slice(0, 9)

export const normalizeMrzDate = (value: unknown): string =>
  String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, 6)

export const normalizeMrzKey = (value: unknown): string => sanitizeMrzText(value)

export const detectMrzFormat = (input: MrzInput): MrzFormat | null => {
  const lines = normalizeMrzLines(input)

  if (lines.length >= 2 && lines[0].length >= 44 && lines[1].length >= 44) {
    return MRZ_FORMATS.TD3
  }

  if (
    lines.length >= 3 &&
    lines[0].length >= 30 &&
    lines[1].length >= 30 &&
    lines[2].length >= 30
  ) {
    return MRZ_FORMATS.TD1
  }

  if (lines.length >= 2 && lines[0].length >= 36 && lines[1].length >= 36) {
    return MRZ_FORMATS.TD2
  }

  return null
}

export const calculateMrzCheckDigit = (value: string): number => {
  const normalized = sanitizeMrzText(value)

  let total = 0
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]
    let charValue = 0

    if (char >= '0' && char <= '9') {
      charValue = Number(char)
    } else if (char >= 'A' && char <= 'Z') {
      charValue = char.charCodeAt(0) - 55
    } else if (char !== '<') {
      throw new Error(`Unsupported MRZ character "${char}" in check digit calculation.`)
    }

    total += charValue * CHECK_DIGIT_WEIGHTS[index % CHECK_DIGIT_WEIGHTS.length]
  }

  return total % 10
}

export const verifyMrzCheckDigit = (value: string, checkDigit: unknown): boolean => {
  const digit = toCheckDigitNumber(checkDigit)
  if (digit === null) {
    return false
  }

  return calculateMrzCheckDigit(value) === digit
}

export const parseMrz = (input: MrzInput): ParsedMrz | null => {
  const lines = normalizeMrzLines(input)
  const format = detectMrzFormat(lines)

  if (format === MRZ_FORMATS.TD3) return parseTd3(lines)
  if (format === MRZ_FORMATS.TD1) return parseTd1(lines)
  if (format === MRZ_FORMATS.TD2) return parseTd2(lines)

  return null
}

export const validatePassportFields = (
  input: PassportFieldInput,
): {
  isValid: boolean
  errors: string[]
  normalized: {
    documentNumber: string
    dateOfBirthYYMMDD: string
    expiryDateYYMMDD: string
    /** @deprecated use `dateOfBirthYYMMDD` */
    dateOfBirth: string
    /** @deprecated use `expiryDateYYMMDD` */
    dateOfExpiry: string
  }
} => {
  const rawDateOfBirth = input?.dateOfBirthYYMMDD ?? input?.dateOfBirth
  const rawDateOfExpiry = input?.expiryDateYYMMDD ?? input?.dateOfExpiry

  const dateOfBirthYYMMDD = normalizeMrzDate(rawDateOfBirth)
  const expiryDateYYMMDD = normalizeMrzDate(rawDateOfExpiry)

  const normalized = {
    documentNumber: normalizeDocumentNumber(input?.documentNumber),
    dateOfBirthYYMMDD,
    expiryDateYYMMDD,
    dateOfBirth: dateOfBirthYYMMDD,
    dateOfExpiry: expiryDateYYMMDD,
  }
  const errors: string[] = []

  if (!DOCUMENT_NUMBER_PATTERN.test(normalized.documentNumber)) {
    errors.push('Document number must contain 1 to 9 MRZ-safe alphanumeric characters.')
  }

  if (!DATE_PATTERN.test(normalized.dateOfBirthYYMMDD)) {
    errors.push('Date of birth must be a 6-digit YYMMDD value.')
  }

  if (!DATE_PATTERN.test(normalized.expiryDateYYMMDD)) {
    errors.push('Date of expiry must be a 6-digit YYMMDD value.')
  }

  return {
    isValid: errors.length === 0,
    errors,
    normalized,
  }
}

export const buildMrzKey = (input: PassportFieldInput): string => {
  const { isValid, errors, normalized } = validatePassportFields(input)
  if (!isValid) {
    throw new PassportUtilityError(
      PassportUtilityErrorCode.INVALID_PASSPORT_FIELDS,
      errors.join(' '),
    )
  }

  const documentNumberMrz = padMrzField(normalized.documentNumber, 9)
  const documentNumberCheckDigit = calculateMrzCheckDigit(documentNumberMrz)
  const dateOfBirthCheckDigit = calculateMrzCheckDigit(normalized.dateOfBirthYYMMDD)
  const dateOfExpiryCheckDigit = calculateMrzCheckDigit(normalized.expiryDateYYMMDD)

  return `${documentNumberMrz}${documentNumberCheckDigit}${normalized.dateOfBirthYYMMDD}${dateOfBirthCheckDigit}${normalized.expiryDateYYMMDD}${dateOfExpiryCheckDigit}`
}

export const parseMrzKey = (
  value: unknown,
): {
  mrzKey: string
  documentNumber: string
  documentNumberMrz: string
  dateOfBirthYYMMDD: string
  expiryDateYYMMDD: string
  /** @deprecated use `dateOfBirthYYMMDD` */
  dateOfBirth: string
  /** @deprecated use `expiryDateYYMMDD` */
  dateOfExpiry: string
  checkDigits: {
    documentNumber: number | null
    dateOfBirth: number | null
    dateOfExpiry: number | null
  }
} | null => {
  const normalized = normalizeMrzKey(value)
  if (!MRZ_KEY_PATTERN.test(normalized)) {
    return null
  }

  const documentNumberMrz = normalized.slice(0, 9)

  return {
    mrzKey: normalized,
    documentNumber: stripFillers(documentNumberMrz),
    documentNumberMrz,
    dateOfBirthYYMMDD: normalized.slice(10, 16),
    expiryDateYYMMDD: normalized.slice(17, 23),
    dateOfBirth: normalized.slice(10, 16),
    dateOfExpiry: normalized.slice(17, 23),
    checkDigits: {
      documentNumber: toCheckDigitNumber(normalized[9]),
      dateOfBirth: toCheckDigitNumber(normalized[16]),
      dateOfExpiry: toCheckDigitNumber(normalized[23]),
    },
  }
}

type MrzKeyValidationResult = {
  isValid: boolean
  errors: string[]
  checks: Record<string, boolean>
  normalized: string
  parsed: ReturnType<typeof parseMrzKey> | null
}

export const validateMrzKey = (value: unknown): MrzKeyValidationResult => {
  const normalized = normalizeMrzKey(value)
  const parsed = parseMrzKey(normalized)
  if (!parsed) {
    return {
      isValid: false,
      errors: ['MRZ key must be 24 MRZ-safe characters.'],
      checks: {},
      normalized,
      parsed,
    }
  }

  const errors: string[] = []
  const checks = {
    documentNumber: buildCheckResult(
      'document number',
      parsed.documentNumberMrz,
      parsed.checkDigits.documentNumber,
      errors,
    ),
    dateOfBirth: buildCheckResult(
      'date of birth',
      parsed.dateOfBirthYYMMDD,
      parsed.checkDigits.dateOfBirth,
      errors,
    ),
    dateOfExpiry: buildCheckResult(
      'date of expiry',
      parsed.expiryDateYYMMDD,
      parsed.checkDigits.dateOfExpiry,
      errors,
    ),
  }

  if (!DATE_PATTERN.test(parsed.dateOfBirthYYMMDD)) {
    errors.push('MRZ key date of birth segment must be a 6-digit YYMMDD value.')
  }

  if (!DATE_PATTERN.test(parsed.expiryDateYYMMDD)) {
    errors.push('MRZ key date of expiry segment must be a 6-digit YYMMDD value.')
  }

  return {
    isValid: errors.length === 0,
    errors,
    checks,
    normalized,
    parsed,
  }
}

export const validateParsedMrz = (parsed: ParsedMrz | null): MrzValidationResult => {
  if (!parsed || typeof parsed !== 'object') {
    return invalidParseResult('MRZ could not be parsed.')
  }

  const fieldValidation = validatePassportFields(parsed)
  const errors = [...fieldValidation.errors]
  const checks: Record<string, boolean> = {
    documentNumber: buildCheckResult(
      'document number',
      parsed.documentNumberMrz,
      parsed.checkDigits?.documentNumber,
      errors,
    ),
    dateOfBirth: buildCheckResult(
      'date of birth',
      parsed.dateOfBirth,
      parsed.checkDigits?.dateOfBirth,
      errors,
    ),
    dateOfExpiry: buildCheckResult(
      'date of expiry',
      parsed.dateOfExpiry,
      parsed.checkDigits?.dateOfExpiry,
      errors,
    ),
  }

  if (parsed.checkDigits && 'composite' in parsed.checkDigits) {
    checks.composite = buildCheckResult(
      'composite',
      parsed.compositeCheckSource,
      parsed.checkDigits.composite,
      errors,
    )
  }

  return {
    isValid: errors.length === 0,
    errors,
    checks,
    normalized: fieldValidation.normalized,
  }
}

export const createPassportCredentials = (
  input: PassportCredentialsInput = {},
): PassportCredentials => {
  const hasMrzKey = typeof input?.mrzKey === 'string' && input.mrzKey.trim().length > 0
  const hasFields =
    input?.documentNumber != null ||
    input?.dateOfBirthYYMMDD != null ||
    input?.expiryDateYYMMDD != null ||
    input?.dateOfBirth != null ||
    input?.dateOfExpiry != null

  if (hasMrzKey) {
    const mrzKeyValidation = validateMrzKey(input.mrzKey)
    if (!mrzKeyValidation.isValid || !mrzKeyValidation.parsed) {
      throw new PassportUtilityError(
        PassportUtilityErrorCode.INVALID_MRZ_KEY,
        mrzKeyValidation.errors.join(' '),
      )
    }

    const fromMrzKey: PassportCredentials = {
      documentNumber: mrzKeyValidation.parsed.documentNumber,
      dateOfBirthYYMMDD: mrzKeyValidation.parsed.dateOfBirthYYMMDD,
      expiryDateYYMMDD: mrzKeyValidation.parsed.expiryDateYYMMDD,
      dateOfBirth: mrzKeyValidation.parsed.dateOfBirthYYMMDD,
      dateOfExpiry: mrzKeyValidation.parsed.expiryDateYYMMDD,
      mrzKey: mrzKeyValidation.normalized,
    }

    if (!hasFields) {
      return fromMrzKey
    }

    const fieldValidation = validatePassportFields(input)
    if (!fieldValidation.isValid) {
      throw new PassportUtilityError(
        PassportUtilityErrorCode.INVALID_PASSPORT_FIELDS,
        fieldValidation.errors.join(' '),
      )
    }

    if (
      fieldValidation.normalized.documentNumber !== fromMrzKey.documentNumber ||
      fieldValidation.normalized.dateOfBirthYYMMDD !== fromMrzKey.dateOfBirthYYMMDD ||
      fieldValidation.normalized.expiryDateYYMMDD !== fromMrzKey.expiryDateYYMMDD
    ) {
      throw new PassportUtilityError(
        PassportUtilityErrorCode.MRZ_KEY_FIELD_MISMATCH,
        'Provided MRZ key does not match the supplied passport fields.',
      )
    }

    return fromMrzKey
  }

  const fieldValidation = validatePassportFields(input)
  if (!fieldValidation.isValid) {
    throw new PassportUtilityError(
      PassportUtilityErrorCode.INVALID_PASSPORT_FIELDS,
      fieldValidation.errors.join(' '),
    )
  }

  return {
    documentNumber: fieldValidation.normalized.documentNumber,
    dateOfBirthYYMMDD: fieldValidation.normalized.dateOfBirthYYMMDD,
    expiryDateYYMMDD: fieldValidation.normalized.expiryDateYYMMDD,
    dateOfBirth: fieldValidation.normalized.dateOfBirthYYMMDD,
    dateOfExpiry: fieldValidation.normalized.expiryDateYYMMDD,
    mrzKey: buildMrzKey(fieldValidation.normalized),
  }
}

export const createPassportCredentialsFromMrz = (input: MrzInput): PassportCredentials => {
  const parsed = parseMrz(input)
  const validation = validateParsedMrz(parsed)

  if (!validation.isValid || !validation.normalized) {
    throw new PassportUtilityError(
      PassportUtilityErrorCode.INVALID_MRZ_PARSE,
      validation.errors.join(' '),
    )
  }

  return createPassportCredentials(validation.normalized)
}
