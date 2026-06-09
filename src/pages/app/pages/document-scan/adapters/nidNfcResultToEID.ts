import type { NidNfcReadResult } from '@iland/nid-verification'

import { EID } from '@/utils/e-document/e-document'

export class NidNfcMappingError extends Error {
  public readonly code: 'MISSING_CERT' | 'INVALID_HEX' | 'INVALID_CERT'

  constructor(code: 'MISSING_CERT' | 'INVALID_HEX' | 'INVALID_CERT', message: string) {
    super(message)
    this.name = 'NidNfcMappingError'
    this.code = code
  }
}

export function nidHexToUint8Array(hex: string): Uint8Array {
  const normalized = hex.trim()
  if (normalized.length === 0 || normalized.length % 2 !== 0 || /[^a-fA-F0-9]/.test(normalized)) {
    throw new NidNfcMappingError('INVALID_HEX', 'NID NFC payload contains invalid hex data.')
  }

  const bytes = normalized.match(/.{1,2}/g)?.map(byte => Number.parseInt(byte, 16)) ?? []
  return new Uint8Array(bytes)
}

export function nidNfcResultToEID(result: NidNfcReadResult): EID {
  if (!result.signingCertHex) {
    throw new NidNfcMappingError('MISSING_CERT', 'NID NFC read did not return signing certificate.')
  }

  if (!result.authCertHex) {
    throw new NidNfcMappingError(
      'MISSING_CERT',
      'NID NFC read did not return authentication certificate.',
    )
  }

  try {
    return EID.fromBytes(
      nidHexToUint8Array(result.signingCertHex),
      nidHexToUint8Array(result.authCertHex),
    )
  } catch (error) {
    if (error instanceof NidNfcMappingError) {
      throw error
    }

    throw new NidNfcMappingError(
      'INVALID_CERT',
      `Failed to parse NID NFC certificates: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    )
  }
}
