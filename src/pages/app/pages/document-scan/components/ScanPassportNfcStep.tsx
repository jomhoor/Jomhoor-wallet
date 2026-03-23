import { useNavigation } from '@react-navigation/core'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { Pressable } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Steps, useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'
import { UiButton, UiIcon } from '@/ui'
import { readPassport, stopPassportNfc } from '@/utils/e-document/passport-nfc-reader'

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
  const { tempMRZ, setTempEDoc, setCurrentStep } = useDocumentScanContext()
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()

  const [readState, setReadState] = useState<ReadState>('idle')
  const [errorMsg, setErrorMsg] = useState<string>('')

  const docNumber = String(tempMRZ?.documentNumber ?? '')
  const birthDate = String(tempMRZ?.birthDate ?? '')
  const expiryDate = String(tempMRZ?.expirationDate ?? '')

  const onReadPress = useCallback(async () => {
    if (!tempMRZ) {
      setErrorMsg('MRZ data is missing. Please go back and scan MRZ first.')
      setReadState('error')
      return
    }

    if (!docNumber || !birthDate || !expiryDate) {
      setErrorMsg('Incomplete MRZ data. Please rescan the MRZ.')
      setReadState('error')
      return
    }

    setErrorMsg('')
    setReadState('waiting')

    try {
      const passport = await readPassport(docNumber, birthDate, expiryDate, {
        onConnected: () => setReadState('reading'),
        onReading: () => setReadState('reading'),
      })

      setTempEDoc(passport)
    } catch (e: unknown) {
      const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e)
      console.error('[ScanPassportNfcStep] error:', msg)
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setReadState('error')
    }
  }, [tempMRZ, docNumber, birthDate, expiryDate, setTempEDoc])

  useEffect(() => {
    return () => {
      stopPassportNfc()
    }
  }, [])

  const isScanning = readState === 'waiting' || readState === 'reading'
  const isAuthError = errorMsg.includes('EXTERNAL AUTHENTICATE') || errorMsg.includes('6982')
  const isConnectionError =
    errorMsg.toLowerCase().includes('nfc connection lost') ||
    errorMsg.toLowerCase().includes('transceive fail')

  return (
    <View style={{ paddingBottom: insets.bottom, paddingTop: insets.top }} className='flex-1 p-6'>
      <View className='flex-row items-center'>
        <Text className='typography-h5 text-textPrimary'>Passport NFC Read</Text>
        <View className='flex-1' />
        <Pressable
          onPress={() => {
            stopPassportNfc()
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

      {/* MRZ data card — always visible so user can verify */}
      {tempMRZ && (
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
            {tempMRZ.firstName && (
              <View className='flex-row justify-between'>
                <Text className='typography-body3 text-textSecondary'>Name</Text>
                <Text className='typography-subtitle5 text-textPrimary'>
                  {String(tempMRZ.firstName ?? '')} {String(tempMRZ.lastName ?? '')}
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
          <Text className='typography-body2 text-center text-errorMain'>
            {isAuthError
              ? 'Authentication failed — the passport rejected the MRZ data.'
              : isConnectionError
                ? 'NFC connection lost.'
                : errorMsg}
          </Text>
          {isAuthError && (
            <Text className='typography-body3 mt-2 text-center text-textSecondary'>
              The document number, date of birth, or expiry date from the MRZ scan may be incorrect.
              Please rescan the MRZ page and check that the data above matches your passport.
            </Text>
          )}
          {isConnectionError && (
            <Text className='typography-body3 mt-2 text-center text-textSecondary'>
              Hold your passport flat against the back of the phone and keep it completely still
              until reading finishes.
            </Text>
          )}
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
            stopPassportNfc()
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
