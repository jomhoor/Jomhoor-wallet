import {
  createPassportCredentialsFromMrz,
  parseMrz,
  sanitizeMrzText,
  validateParsedMrz,
  verifyMrzCheckDigit,
} from './parse-mrz'
import type { ParsedMrz, PassportCredentials } from '../types'

const PASSPORT_LINE_LENGTH = 44
const MIN_PASSPORT_LINE1_LENGTH = 30
const MIN_PASSPORT_LINE2_LENGTH = 28

const NUMERIC_POSITION_CORRECTIONS: Record<string, string> = Object.freeze({
  O: '0',
  Q: '0',
  D: '0',
  U: '0',
  I: '1',
  L: '1',
  Z: '2',
  S: '5',
  B: '8',
  G: '6',
})

const DOCUMENT_NUMBER_CORRECTIONS: Record<string, string> = Object.freeze({
  O: '0',
  Q: '0',
  D: '0',
  U: '0',
})

const ALPHA_POSITION_CORRECTIONS: Record<string, string> = Object.freeze({
  '0': 'O',
  '1': 'I',
  '2': 'Z',
  '5': 'S',
  '6': 'G',
  '8': 'B',
})

const PASSPORT_LINE2_NUMERIC_POSITIONS = new Set([
  9, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 42, 43,
])
const PASSPORT_LINE2_ALPHA_POSITIONS = new Set([10, 11, 12, 20])

const toLines = (input: string[] | string): string[] => {
  if (Array.isArray(input)) return input
  if (typeof input === 'string') return input.split(/\r?\n/)
  return []
}

export const sanitizeOcrMrzLine = (value: string): string =>
  sanitizeMrzText(
    String(value ?? '')
      .replace(/[«‹]/g, '<<')
      .replace(/[|]/g, 'I'),
  )

const normalizePassportLine = (value: string, length: number): string =>
  sanitizeOcrMrzLine(value).slice(0, length).padEnd(length, '<')

const applyPositionCorrections = (
  line: string,
  numericPositions: Set<number>,
  alphaPositions: Set<number>,
): string => {
  const chars = line.split('')

  for (let index = 0; index < chars.length; index += 1) {
    const value = chars[index]

    if (numericPositions.has(index) && NUMERIC_POSITION_CORRECTIONS[value]) {
      chars[index] = NUMERIC_POSITION_CORRECTIONS[value]
      continue
    }

    if (alphaPositions.has(index) && ALPHA_POSITION_CORRECTIONS[value]) {
      chars[index] = ALPHA_POSITION_CORRECTIONS[value]
    }
  }

  return chars.join('')
}

const normalizePassportLine1 = (value: string): string => {
  let normalized = normalizePassportLine(value, PASSPORT_LINE_LENGTH)

  if (normalized[0] !== 'P') {
    normalized = `P${normalized.slice(1)}`
  }

  if (normalized[1] !== '<') {
    normalized = `${normalized[0]}<${normalized.slice(2)}`
  }

  return normalized
}

const normalizePassportLine2 = (value: string): string => {
  let normalized = applyPositionCorrections(
    normalizePassportLine(value, PASSPORT_LINE_LENGTH),
    PASSPORT_LINE2_NUMERIC_POSITIONS,
    PASSPORT_LINE2_ALPHA_POSITIONS,
  )

  const checkDigit = normalized[9]
  const documentNumber = normalized.slice(0, 9)

  const hasValidCheckDigit = verifyMrzCheckDigit(documentNumber, checkDigit)

  if (!hasValidCheckDigit) {
    const correctedDocumentNumber = documentNumber
      .split('')
      .map(char => DOCUMENT_NUMBER_CORRECTIONS[char] || char)
      .join('')
    normalized = `${correctedDocumentNumber}${normalized.slice(9)}`
  }

  return normalized
}

export const extractPassportMrzLines = (input: string[] | string): string[] | null => {
  const sanitizedLines = toLines(input).map(sanitizeOcrMrzLine).filter(Boolean)

  const mrzLine1Index = sanitizedLines.findIndex(
    line =>
      /^P[A-Z<]/.test(line) && line.includes('<<') && line.length >= MIN_PASSPORT_LINE1_LENGTH,
  )

  if (mrzLine1Index === -1) return null

  const mrzLine2Index = mrzLine1Index + 1
  if (mrzLine2Index >= sanitizedLines.length) return null

  const line1 = sanitizedLines[mrzLine1Index]
  const line2 = sanitizedLines[mrzLine2Index]

  if (line2.length < MIN_PASSPORT_LINE2_LENGTH) return null

  return [normalizePassportLine1(line1), normalizePassportLine2(line2)]
}

export type PassportMrzScanResult = {
  rawLines: string[]
  mrzLines: string[]
  mrzText: string
  parsed: ParsedMrz
  validation: ReturnType<typeof validateParsedMrz>
  credentials: PassportCredentials
}

export const createPassportMrzScanResult = (
  input: string[] | string,
): PassportMrzScanResult | null => {
  const rawLines = toLines(input)
    .map(line => String(line ?? '').trim())
    .filter(Boolean)

  const mrzLines = extractPassportMrzLines(rawLines)
  if (!mrzLines) return null

  const parsed = parseMrz(mrzLines)
  if (!parsed) return null

  const validation = validateParsedMrz(parsed)
  if (!validation.isValid) return null

  const credentials = createPassportCredentialsFromMrz(mrzLines)

  return {
    rawLines,
    mrzLines,
    mrzText: mrzLines.join('\n'),
    parsed,
    validation,
    credentials,
  }
}
