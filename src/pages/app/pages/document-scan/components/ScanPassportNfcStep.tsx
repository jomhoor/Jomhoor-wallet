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
import { appCapabilitiesStore } from '@/store'
import { UiButton, UiIcon } from '@/ui'
import {
  clearPassportNfcTemporaryData,
  readPassportScanOutput,
  stopPassportNfc,
} from '@/utils/e-document/passport-nfc-reader'

import DemoModeBanner from './DemoModeBanner'

type ReadState = 'idle' | 'waiting' | 'found' | 'authorizing' | 'reading' | 'error'

const scanStatusContent: Record<
  Exclude<ReadState, 'idle' | 'error'>,
  { title: string; body: string }
> = {
  waiting: {
    title: 'Waiting for tag',
    body: 'Move the back of your phone slowly over the passport chip area.',
  },
  found: {
    title: 'Found tag',
    body: 'Keep the phone and passport still.',
  },
  authorizing: {
    title: 'Authorizing tag',
    body: 'Checking the passport access keys. Do not move the phone.',
  },
  reading: {
    title: 'Reading tag',
    body: 'Reading passport data. Keep holding steady.',
  },
}

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
  const passportDemoModeEnabled = appCapabilitiesStore.usePassportDemoModeEnabled()
  const isDemoMode = verificationMode === 'demo' && passportDemoModeEnabled
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
  const selectedBackend = isDemoMode ? 'stub' : resolvePassportNfcBackend()
  const debugEnabled =
    process.env.EXPO_PUBLIC_PASSPORT_NFC_DEBUG === '1' ||
    process.env.EXPO_PUBLIC_PASSPORT_NFC_DEBUG === 'true'

  const cancelRead = useCallback(() => {
    readInFlightRef.current = false
    if (demoReadTimeoutRef.current) {
      clearTimeout(demoReadTimeoutRef.current)
      demoReadTimeoutRef.current = null
    }
    if (!isDemoMode) {
      stopPassportNfc()
    }
  }, [isDemoMode])

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

    if (isDemoMode) {
      setReadState('waiting')
      demoReadTimeoutRef.current = setTimeout(() => {
        demoReadTimeoutRef.current = null
        if (!readInFlightRef.current) return

        setReadState('reading')
        setPassportNfcScanOutput(createDemoPassportNfcScanOutput())
        readInFlightRef.current = false
      }, DEMO_SCAN_DELAY_MS)
      return
    }

    try {
      await stopPassportNfc()
      const passportOutput = await readPassportScanOutput(docNumber, birthDate, expiryDate, {
        onScanStatus: event => {
          switch (event.status) {
            case 'waiting_for_tag':
              setReadState('waiting')
              break
            case 'found_tag':
              setReadState('found')
              break
            case 'authorizing_tag':
              setReadState('authorizing')
              break
            case 'reading_tag':
              setReadState('reading')
              break
          }
        },
        onConnected: () => setReadState('found'),
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
    isDemoMode,
  ])

  useEffect(() => {
    return () => {
      cancelRead()
    }
  }, [cancelRead])

  const scanStatus =
    readState === 'waiting' ||
    readState === 'found' ||
    readState === 'authorizing' ||
    readState === 'reading'
      ? scanStatusContent[readState]
      : null
  const isScanning = scanStatus != null

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
      {isDemoMode ? (
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
      {scanStatus && (
        <View className='mb-4 rounded-xl bg-componentPrimary p-4'>
          <Text className='typography-body2 text-center text-textPrimary'>{scanStatus.title}</Text>
          <Text className='typography-body3 mt-2 text-center text-textSecondary'>
            {scanStatus.body}
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
