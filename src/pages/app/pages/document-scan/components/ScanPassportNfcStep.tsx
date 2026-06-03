import { useNavigation } from '@react-navigation/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { Pressable } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  mapPassportNfcErrorToMessage,
  resolvePassportNfcBackend,
} from '@/pages/app/pages/document-scan/adapters'
import {
  createDemoPassportNfcScanOutput,
  DEMO_SCAN_DELAY_MS,
} from '@/pages/app/pages/document-scan/demo/passport-demo-fixtures'
import { Steps, useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'
import { UiButton, UiIcon } from '@/ui'
import {
  clearPassportNfcTemporaryData,
  readPassportScanOutput,
  stopPassportNfc,
} from '@/utils/e-document/passport-nfc-reader'

import DemoModeBanner from './DemoModeBanner'

type ReadState = 'idle' | 'waiting' | 'reading' | 'error'

/** Format YYMMDD → DD/MM/YYYY for display */
function formatDate(yymmdd: string): string {
  if (yymmdd.length !== 6) return yymmdd
  const yy = yymmdd.slice(0, 2)
  const mm = yymmdd.slice(2, 4)
  const dd = yymmdd.slice(4, 6)
  const year = parseInt(yy, 10) > 30 ? `19${yy}` : `20${yy}`
  return `${dd}/${mm}/${year}`
}

export default function ScanPassportNfcStep() {
  const {
    setCurrentStep,
    setPassportNfcScanOutput,
    tempMRZ,
    verificationMode,
    verificationUserData,
  } = useDocumentScanContext()
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()

  const [readState, setReadState] = useState<ReadState>('idle')
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [errorDetail, setErrorDetail] = useState<string>('')
  const [errorCode, setErrorCode] = useState<string>('')
  const readInFlightRef = useRef(false)
  const demoReadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const storedMrz = verificationUserData.document.passport.mrz
  const mrzFields = tempMRZ ?? storedMrz?.fields
  const docNumber = String(
    mrzFields?.documentNumber ?? storedMrz?.credentials?.documentNumber ?? '',
  )
  const birthDate = String(mrzFields?.birthDate ?? storedMrz?.credentials?.dateOfBirthYYMMDD ?? '')
  const expiryDate = String(
    mrzFields?.expirationDate ?? storedMrz?.credentials?.expiryDateYYMMDD ?? '',
  )
  const selectedBackend = verificationMode === 'demo' ? 'stub' : resolvePassportNfcBackend()
  const debugEnabled =
    process.env.EXPO_PUBLIC_PASSPORT_NFC_DEBUG === '1' ||
    process.env.EXPO_PUBLIC_PASSPORT_NFC_DEBUG === 'true'

  const cancelRead = useCallback(() => {
    readInFlightRef.current = false
    if (demoReadTimeoutRef.current) {
      clearTimeout(demoReadTimeoutRef.current)
      demoReadTimeoutRef.current = null
    }
    if (verificationMode !== 'demo') {
      stopPassportNfc()
    }
  }, [verificationMode])

  const onReadPress = useCallback(async () => {
    if (readInFlightRef.current) return

    if (!mrzFields && !storedMrz?.credentials) {
      setErrorMsg('MRZ data is missing. Please go back and scan MRZ first.')
      setErrorDetail('')
      setErrorCode('')
      setReadState('error')
      return
    }

    if (!docNumber || !birthDate || !expiryDate) {
      setErrorMsg('Incomplete MRZ data. Please rescan the MRZ.')
      setErrorDetail('')
      setErrorCode('')
      setReadState('error')
      return
    }

    readInFlightRef.current = true
    setErrorMsg('')
    setErrorDetail('')
    setErrorCode('')
    setReadState('waiting')

    if (verificationMode === 'demo') {
      setReadState('reading')
      demoReadTimeoutRef.current = setTimeout(() => {
        demoReadTimeoutRef.current = null
        if (!readInFlightRef.current) return

        setPassportNfcScanOutput(createDemoPassportNfcScanOutput())
        readInFlightRef.current = false
      }, DEMO_SCAN_DELAY_MS)
      return
    }

    try {
      await stopPassportNfc()
      const passportOutput = await readPassportScanOutput(docNumber, birthDate, expiryDate, {
        onConnected: () => setReadState('reading'),
        onReading: () => setReadState('reading'),
      })

      setPassportNfcScanOutput(passportOutput)
      await clearPassportNfcTemporaryData()
    } catch (e: unknown) {
      const mappedError = mapPassportNfcErrorToMessage(e, { debugEnabled })
      setErrorMsg(mappedError.primary)
      setErrorDetail(mappedError.secondary ?? '')
      setErrorCode(mappedError.code ?? '')
      setReadState('error')
    } finally {
      readInFlightRef.current = false
    }
  }, [
    mrzFields,
    storedMrz?.credentials,
    docNumber,
    birthDate,
    expiryDate,
    setPassportNfcScanOutput,
    debugEnabled,
    verificationMode,
  ])

  useEffect(() => {
    return () => {
      cancelRead()
    }
  }, [cancelRead])

  const isScanning = readState === 'waiting' || readState === 'reading'

  return (
    <View style={{ paddingBottom: insets.bottom, paddingTop: insets.top }} className='flex-1 p-6'>
      <View className='flex-row items-center'>
        <Text className='typography-h5 text-textPrimary'>Passport NFC Read</Text>
        <View className='flex-1' />
        <Pressable
          onPress={() => {
            cancelRead()
            navigation.navigate('App', { screen: 'Home' })
          }}
        >
          <View className='h-10 w-10 items-center justify-center rounded-full bg-componentPrimary'>
            <UiIcon customIcon='closeIcon' size={20} className='color-textPrimary' />
          </View>
        </Pressable>
      </View>

      <Text className='typography-body3 mb-4 mt-1 text-textSecondary'>
        Open your passport to the photo page, then hold it flat against the back of your phone.
      </Text>
      {verificationMode === 'demo' ? (
        <View className='mb-4'>
          <DemoModeBanner message='Demo mode: tap Start NFC Read. Fictional chip data will load after 3 seconds without using NFC.' />
        </View>
      ) : null}
      {debugEnabled ? (
        <Text className='typography-body4 mb-3 text-textSecondary'>
          NFC backend: {selectedBackend}
        </Text>
      ) : null}

      {/* MRZ data card — always visible so user can verify */}
      {mrzFields && (
        <View className='mb-4 rounded-xl bg-componentPrimary p-4'>
          <Text className='typography-subtitle4 mb-2 text-textPrimary'>Scanned MRZ Data</Text>
          <View className='gap-1'>
            <View className='flex-row justify-between'>
              <Text className='typography-body3 text-textSecondary'>Document #</Text>
              <Text className='typography-subtitle5 font-mono text-textPrimary'>
                {docNumber || '—'}
              </Text>
            </View>
            <View className='flex-row justify-between'>
              <Text className='typography-body3 text-textSecondary'>Date of Birth</Text>
              <Text className='typography-subtitle5 text-textPrimary'>
                {birthDate ? formatDate(birthDate) : '—'}
              </Text>
            </View>
            <View className='flex-row justify-between'>
              <Text className='typography-body3 text-textSecondary'>Expiry Date</Text>
              <Text className='typography-subtitle5 text-textPrimary'>
                {expiryDate ? formatDate(expiryDate) : '—'}
              </Text>
            </View>
            {mrzFields.firstName && (
              <View className='flex-row justify-between'>
                <Text className='typography-body3 text-textSecondary'>Name</Text>
                <Text className='typography-subtitle5 text-textPrimary'>
                  {String(mrzFields.firstName ?? '')} {String(mrzFields.lastName ?? '')}
                </Text>
              </View>
            )}
          </View>
          <Text className='typography-body4 mt-2 text-textSecondary'>
            Verify this matches your passport. If wrong, rescan the MRZ.
          </Text>
        </View>
      )}

      {/* Status messages */}
      {readState === 'waiting' && (
        <View className='mb-4 rounded-xl bg-componentPrimary p-4'>
          <Text className='typography-body2 text-center text-textPrimary'>
            Waiting for passport... Hold it steady against the back of your phone.
          </Text>
        </View>
      )}

      {readState === 'reading' && (
        <View className='mb-4 rounded-xl bg-componentPrimary p-4'>
          <Text className='typography-body2 text-center text-textPrimary'>
            Reading passport data... Keep holding steady.
          </Text>
        </View>
      )}

      {readState === 'error' && (
        <View className='bg-errorMain/10 mb-4 rounded-xl p-4'>
          <Text className='typography-body2 text-center text-errorMain'>{errorMsg}</Text>
          {errorDetail ? (
            <Text className='typography-body3 mt-2 text-center text-textSecondary'>
              {errorDetail}
            </Text>
          ) : null}
          {debugEnabled && errorCode ? (
            <Text className='typography-body4 mt-2 text-center text-textSecondary'>
              code: {errorCode}
            </Text>
          ) : null}
        </View>
      )}

      {isScanning && <ActivityIndicator className='my-4' size='large' />}

      <View className='mt-auto gap-3'>
        <UiButton
          onPress={onReadPress}
          title={
            isScanning ? 'Reading...' : readState === 'error' ? 'Retry NFC Read' : 'Start NFC Read'
          }
          className='w-full'
          disabled={isScanning}
        />
        <UiButton
          onPress={() => {
            cancelRead()
            setCurrentStep(Steps.ScanMrzStep)
          }}
          title='Rescan MRZ'
          variant='outlined'
          className='w-full'
          disabled={isScanning}
        />
      </View>
    </View>
  )
}
