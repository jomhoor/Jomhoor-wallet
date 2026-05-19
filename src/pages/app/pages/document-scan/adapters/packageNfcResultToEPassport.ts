import type { PassportNfcReadResult } from '@iland/passport-verification'

import { EPassport, type PersonDetails } from '@/utils/e-document'

export class PackageNfcMappingError extends Error {
  public readonly code: 'MISSING_DG1' | 'MISSING_SOD' | 'INVALID_HEX'

  constructor(code: 'MISSING_DG1' | 'MISSING_SOD' | 'INVALID_HEX', message: string) {
    super(message)
    this.name = 'PackageNfcMappingError'
    this.code = code
  }
}

const hexToUint8Array = (hex: string): Uint8Array => {
  const normalized = hex.trim()
  if (normalized.length === 0 || normalized.length % 2 !== 0 || /[^a-fA-F0-9]/.test(normalized)) {
    throw new PackageNfcMappingError(
      'INVALID_HEX',
      'Native NFC payload contained invalid hex data.',
    )
  }

  const bytes = normalized.match(/.{1,2}/g)?.map(b => parseInt(b, 16)) ?? []
  return new Uint8Array(bytes)
}

type NativeFileData = {
  rawHex?: unknown
  parsed?: unknown
  imageBase64?: unknown
}

const readFileData = (result: PassportNfcReadResult, key: string): NativeFileData | undefined => {
  const entry = result.files[key]
  if (!entry || entry.status !== 'ok' || !entry.data || typeof entry.data !== 'object')
    return undefined
  return entry.data as NativeFileData
}

const readRawHex = (result: PassportNfcReadResult, key: string): string | undefined => {
  const file = readFileData(result, key)
  return typeof file?.rawHex === 'string' ? file.rawHex : undefined
}

const readParsed = (
  result: PassportNfcReadResult,
  key: string,
): Record<string, unknown> | undefined => {
  const file = readFileData(result, key)
  if (!file?.parsed || typeof file.parsed !== 'object') return undefined
  return file.parsed as Record<string, unknown>
}

function buildPersonDetails(result: PassportNfcReadResult): PersonDetails {
  const normalized = result.normalized
  const parsed = readParsed(result, 'DG1')
  const dg2 = readFileData(result, 'DG2')

  return {
    firstName:
      normalized?.firstName ?? (typeof parsed?.firstName === 'string' ? parsed.firstName : null),
    lastName:
      normalized?.lastName ?? (typeof parsed?.lastName === 'string' ? parsed.lastName : null),
    gender:
      normalized?.sex ??
      (typeof parsed?.gender === 'string'
        ? parsed.gender
        : typeof parsed?.sex === 'string'
          ? parsed.sex
          : null),
    birthDate:
      normalized?.birthDate ??
      (typeof parsed?.dateOfBirth === 'string' ? parsed.dateOfBirth : null),
    expiryDate:
      normalized?.expiryDate ??
      (typeof parsed?.documentExpiryDate === 'string' ? parsed.documentExpiryDate : null),
    documentNumber:
      normalized?.documentNumber ??
      (typeof parsed?.documentNumber === 'string' ? parsed.documentNumber : null),
    nationality:
      normalized?.nationality ??
      (typeof parsed?.nationality === 'string' ? parsed.nationality : null),
    issuingAuthority:
      typeof parsed?.issuingAuthority === 'string'
        ? parsed.issuingAuthority
        : typeof parsed?.issuer === 'string'
          ? parsed.issuer
          : null,
    passportImageRaw:
      result.portrait?.base64 ?? (typeof dg2?.imageBase64 === 'string' ? dg2.imageBase64 : null),
  }
}

export function packageNfcResultToEPassport(result: PassportNfcReadResult): EPassport {
  const dg1RawHex = readRawHex(result, 'DG1')
  if (!dg1RawHex) {
    throw new PackageNfcMappingError('MISSING_DG1', 'Native NFC read did not return DG1.')
  }

  const sodRawHex = readRawHex(result, 'SOD')
  if (!sodRawHex) {
    throw new PackageNfcMappingError('MISSING_SOD', 'Native NFC read did not return SOD.')
  }

  const dg15RawHex = readRawHex(result, 'DG15')
  const dg11RawHex = readRawHex(result, 'DG11')
  const activeAuthentication =
    result.raw && typeof result.raw === 'object'
      ? ((result.raw as Record<string, unknown>).activeAuthentication as
          | Record<string, unknown>
          | undefined)
      : undefined

  const aaSignatureHex =
    activeAuthentication && typeof activeAuthentication.signature === 'string'
      ? activeAuthentication.signature
      : undefined

  return new EPassport({
    docCode: 'P',
    personDetails: buildPersonDetails(result),
    sodBytes: hexToUint8Array(sodRawHex),
    dg1Bytes: hexToUint8Array(dg1RawHex),
    ...(typeof dg15RawHex === 'string' ? { dg15Bytes: hexToUint8Array(dg15RawHex) } : {}),
    ...(typeof dg11RawHex === 'string' ? { dg11Bytes: hexToUint8Array(dg11RawHex) } : {}),
    ...(typeof aaSignatureHex === 'string' ? { aaSignature: hexToUint8Array(aaSignatureHex) } : {}),
  })
}
