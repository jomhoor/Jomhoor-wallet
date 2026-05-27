import type { PassportNfcReadResult } from '@iland/passport-verification'

export type PassportNfcDisplayDetails = {
  firstName?: string
  lastName?: string
  nationality?: string
  nidn?: string
  expiryDate?: string
  documentNumber?: string
  portrait?: {
    base64?: string
    filePath?: string
  }
}

const readParsedFile = (
  result: PassportNfcReadResult,
  key: string,
): Record<string, unknown> | undefined => {
  const entry = result.files[key]
  if (!entry || entry.status !== 'ok' || !entry.data || typeof entry.data !== 'object') {
    return undefined
  }

  const data = entry.data as Record<string, unknown>
  if (!data.parsed || typeof data.parsed !== 'object') return undefined
  return data.parsed as Record<string, unknown>
}

const readFileLevelBase64 = (result: PassportNfcReadResult, key: string): string | undefined => {
  const entry = result.files[key]
  return typeof entry?.base64 === 'string' ? entry.base64 : undefined
}

const readFileLevelPath = (result: PassportNfcReadResult, key: string): string | undefined => {
  const entry = result.files[key]
  return typeof entry?.filePath === 'string' ? entry.filePath : undefined
}

const asNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function extractPackageNfcDisplayDetails(
  result: PassportNfcReadResult,
): PassportNfcDisplayDetails {
  const normalized = result.normalized
  const dg1Parsed = readParsedFile(result, 'DG1')
  const dg11Parsed = readParsedFile(result, 'DG11')
  const dg2Parsed = readParsedFile(result, 'DG2')

  const nidn =
    asNonEmptyString(dg11Parsed?.personalNumber) ??
    asNonEmptyString(dg1Parsed?.personalNumber) ??
    asNonEmptyString(dg11Parsed?.personalSummary)

  const portraitBase64 =
    asNonEmptyString(result.portrait?.base64) ??
    readFileLevelBase64(result, 'DG2') ??
    asNonEmptyString(dg2Parsed?.imageBase64)

  const portraitFilePath =
    asNonEmptyString(result.portrait?.filePath) ??
    readFileLevelPath(result, 'DG2') ??
    asNonEmptyString(dg2Parsed?.filePath)

  return {
    firstName: asNonEmptyString(normalized?.firstName) ?? asNonEmptyString(dg1Parsed?.firstName),
    lastName: asNonEmptyString(normalized?.lastName) ?? asNonEmptyString(dg1Parsed?.lastName),
    nationality:
      asNonEmptyString(normalized?.nationality) ?? asNonEmptyString(dg1Parsed?.nationality),
    expiryDate:
      asNonEmptyString(normalized?.expiryDate) ?? asNonEmptyString(dg1Parsed?.documentExpiryDate),
    documentNumber:
      asNonEmptyString(normalized?.documentNumber) ?? asNonEmptyString(dg1Parsed?.documentNumber),
    nidn,
    ...(portraitBase64 || portraitFilePath
      ? {
          portrait: {
            ...(portraitBase64 ? { base64: portraitBase64 } : {}),
            ...(portraitFilePath ? { filePath: portraitFilePath } : {}),
          },
        }
      : {}),
  }
}
