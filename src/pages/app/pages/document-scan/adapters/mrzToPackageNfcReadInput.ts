import {
  createPassportCredentials,
  type PassportNfcBackend,
  type PassportNfcReadInput,
} from '@iland/passport-verification/passport'

type MrzToNfcInputParams = {
  documentNumber: string
  dateOfBirth: string
  expiryDate: string
  backend?: PassportNfcBackend
  /** 8-byte (16 hex char) Active Authentication challenge. */
  activeAuthenticationChallenge?: string
}

const normalizeDate = (value: string): string => {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 8) return digits.slice(2)
  return digits.slice(0, 6)
}

export function createPackageNfcReadInput({
  documentNumber,
  dateOfBirth,
  expiryDate,
  backend,
  activeAuthenticationChallenge,
}: MrzToNfcInputParams): PassportNfcReadInput {
  const credentials = createPassportCredentials({
    documentNumber,
    dateOfBirthYYMMDD: normalizeDate(dateOfBirth),
    expiryDateYYMMDD: normalizeDate(expiryDate),
  })

  const isNativeBackend = backend === 'native-ios' || backend === 'native-android'

  return {
    documentNumber: credentials.documentNumber,
    dateOfBirthYYMMDD: credentials.dateOfBirthYYMMDD,
    expiryDateYYMMDD: credentials.expiryDateYYMMDD,
    mrzKey: credentials.mrzKey,
    ...(backend ? { backend } : {}),
    ...(activeAuthenticationChallenge ? { activeAuthenticationChallenge } : {}),
    requestedDataGroups: ['COM', 'SOD', 'DG1', 'DG2', 'DG11', 'DG12', 'DG13', 'DG15', 'CardAccess'],
    ...(isNativeBackend
      ? {
          includeImageBase64: true,
          persistDg2ImageFile: true,
        }
      : {}),
  }
}
