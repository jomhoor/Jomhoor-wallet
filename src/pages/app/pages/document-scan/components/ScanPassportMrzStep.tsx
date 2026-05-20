import type { PassportMrzBarcodeResult } from '@iland/passport-verification'
import { PassportMrzBarcodeScanScreen } from '@iland/passport-verification'
import type { FieldRecords } from 'mrz'
import { useCallback } from 'react'
import { View } from 'react-native'

import { resolveDocumentScanFaceFlowEnabled } from '@/pages/app/pages/document-scan/adapters'
import { useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'

import LegacyScanMrzStep from './ScanMrzStep'

function mapResultToFieldRecords(result: PassportMrzBarcodeResult): FieldRecords {
  const firstName = Array.isArray(result.parsedMrz.givenNames)
    ? result.parsedMrz.givenNames.join(' ')
    : ''

  return {
    birthDate: result.credentials.dateOfBirthYYMMDD,
    documentNumber: result.credentials.documentNumber,
    expirationDate: result.credentials.expiryDateYYMMDD,
    firstName,
    lastName: result.parsedMrz.surname ?? '',
    nationality: result.parsedMrz.nationality ?? '',
  } as unknown as FieldRecords
}

export default function ScanPassportMrzStep() {
  const faceFlowEnabled = resolveDocumentScanFaceFlowEnabled()
  const { setTempMrz, setPassportMrzBarcode } = useDocumentScanContext()

  const handleDetected = useCallback(
    (result: PassportMrzBarcodeResult) => {
      setPassportMrzBarcode({
        credentials: result.credentials,
        parsedMrz: result.parsedMrz,
        barcode: result.barcode,
      })
      setTempMrz(mapResultToFieldRecords(result))
    },
    [setPassportMrzBarcode, setTempMrz],
  )

  if (!faceFlowEnabled) {
    return <LegacyScanMrzStep />
  }

  return (
    <View className='flex-1 bg-backgroundPrimary'>
      <PassportMrzBarcodeScanScreen onDetected={handleDetected} />
    </View>
  )
}
