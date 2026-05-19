import {
  createPassportCredentials,
  type PassportNfcBackend,
  type PassportNfcReadInput,
} from '@iland/passport-verification'

type MrzToNfcInputParams = {
  documentNumber: string
  dateOfBirth: string
  expiryDate: string
  backend?: PassportNfcBackend
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
}: MrzToNfcInputParams): PassportNfcReadInput {
  const credentials = createPassportCredentials({
    documentNumber,
    dateOfBirthYYMMDD: normalizeDate(dateOfBirth),
    expiryDateYYMMDD: normalizeDate(expiryDate),
  })

  return {
    documentNumber: credentials.documentNumber,
    dateOfBirthYYMMDD: credentials.dateOfBirthYYMMDD,
    expiryDateYYMMDD: credentials.expiryDateYYMMDD,
    mrzKey: credentials.mrzKey,
    ...(backend ? { backend } : {}),
    requestedDataGroups: ['COM', 'SOD', 'DG1', 'DG2', 'DG11', 'DG12', 'DG13', 'DG15', 'CardAccess'],
  }
}
