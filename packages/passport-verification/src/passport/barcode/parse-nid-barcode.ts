export type ParsedNidBarcode = {
  raw: string
  nidn?: string
  fields?: Record<string, unknown>
}

const CANDIDATE_DELIMITERS = ['*', ';', '|', ',', '\t']

const normalizePersianDigits = (value: string): string =>
  value
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))

const toAsciiDigits = (value: string): string => normalizePersianDigits(value).replace(/\D/g, '')

const isValidNationalCode = (value: string): boolean => {
  const digits = toAsciiDigits(value)
  if (digits.length !== 10) return false
  if (/^(.)\1+$/.test(digits)) return false

  const numbers = digits.split('').map(Number)
  const checkDigit = numbers[9]
  const sum = numbers.slice(0, 9).reduce((acc, digit, index) => acc + digit * (10 - index), 0)
  const remainder = sum % 11
  return remainder < 2 ? checkDigit === remainder : checkDigit === 11 - remainder
}

const findNationalCodeInTokens = (tokens: string[]): string | undefined => {
  for (const token of tokens) {
    const normalized = toAsciiDigits(token)
    if (isValidNationalCode(normalized)) {
      return normalized
    }
  }

  return undefined
}

export const parseNidBarcode = (rawValue: string): ParsedNidBarcode | null => {
  const raw = String(rawValue ?? '').trim()
  if (!raw) return null

  const delimiters = CANDIDATE_DELIMITERS.filter(delimiter => raw.includes(delimiter))
  const valuesToCheck = delimiters.length > 0 ? delimiters : [' ']

  for (const delimiter of valuesToCheck) {
    const tokens =
      delimiter === ' '
        ? raw.split(/\s+/).filter(Boolean)
        : raw
            .split(delimiter)
            .map(entry => entry.trim())
            .filter(Boolean)
    if (tokens.length === 0) continue

    const nidn = findNationalCodeInTokens(tokens)
    if (!nidn) continue

    return {
      raw,
      nidn,
      fields: {
        delimiter,
        tokensCount: tokens.length,
      },
    }
  }

  return {
    raw,
  }
}
