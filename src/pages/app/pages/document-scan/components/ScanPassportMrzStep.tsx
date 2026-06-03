import type { PassportMrzBarcodeResult } from '@iland/passport-verification'
import { PassportMrzBarcodeScanScreen } from '@iland/passport-verification'
import type { FieldRecords } from 'mrz'
import { useCallback, useEffect, useRef } from 'react'
import { View } from 'react-native'

import {
  DEMO_PASSPORT_MRZ_BARCODE_RESULT,
  DEMO_SCAN_DELAY_MS,
} from '@/pages/app/pages/document-scan/demo/passport-demo-fixtures'
import { useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'

import DemoModeBanner from './DemoModeBanner'

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
  const { setTempMrz, setPassportMrzBarcode, verificationMode } = useDocumentScanContext()
  const hasCompletedRef = useRef(false)

  const completeScan = useCallback(
    (result: PassportMrzBarcodeResult) => {
      if (hasCompletedRef.current) return
      hasCompletedRef.current = true
      setPassportMrzBarcode({
        credentials: result.credentials,
        parsedMrz: result.parsedMrz,
        barcode: result.barcode,
      })
      setTempMrz(mapResultToFieldRecords(result))
    },
    [setPassportMrzBarcode, setTempMrz],
  )

  const handleDetected = useCallback(
    (result: PassportMrzBarcodeResult) => {
      if (verificationMode === 'demo') return
      completeScan(result)
    },
    [completeScan, verificationMode],
  )

  useEffect(() => {
    if (verificationMode !== 'demo') return

    const timeout = setTimeout(() => {
      completeScan(DEMO_PASSPORT_MRZ_BARCODE_RESULT)
    }, DEMO_SCAN_DELAY_MS)

    return () => {
      clearTimeout(timeout)
    }
  }, [completeScan, verificationMode])

  return (
    <View className='flex-1 bg-backgroundPrimary'>
      <PassportMrzBarcodeScanScreen onDetected={handleDetected} />
      {verificationMode === 'demo' ? (
        <View className='absolute left-4 right-4 top-16'>
          <DemoModeBanner message='Demo mode: the scanner will load fictional MRZ and barcode data after 3 seconds.' />
        </View>
      ) : null}
    </View>
  )
}
