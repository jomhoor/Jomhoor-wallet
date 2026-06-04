import { useNavigation } from '@react-navigation/core'
import { Image } from 'expo-image'
import { Text, View } from 'react-native'
import { Pressable } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Steps, useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'
import { appCapabilitiesStore } from '@/store'
import { UiButton, UiIcon, UiScreenScrollable } from '@/ui'

import DemoModeBanner from './DemoModeBanner'

const formatDisplayDate = (value?: string): string => {
  if (!value) return '—'
  const digits = value.replace(/\D/g, '')
  if (digits.length === 6) {
    const yy = digits.slice(0, 2)
    const mm = digits.slice(2, 4)
    const dd = digits.slice(4, 6)
    const year = Number.parseInt(yy, 10) > 30 ? `19${yy}` : `20${yy}`
    return `${dd}/${mm}/${year}`
  }
  if (digits.length === 8) {
    const yyyy = digits.slice(0, 4)
    const mm = digits.slice(4, 6)
    const dd = digits.slice(6, 8)
    return `${dd}/${mm}/${yyyy}`
  }
  return value
}

const maskDocumentIdentifier = (value?: string): string => {
  if (!value) return '—'
  const compact = value.replace(/\s+/g, '')
  if (compact.length <= 4) return `${compact.slice(0, 1)}***`
  return `${compact.slice(0, 2)}****${compact.slice(-2)}`
}

const buildPortraitUri = (details?: {
  portrait?: { base64?: string; filePath?: string }
}): string | undefined => {
  const base64 = details?.portrait?.base64
  if (typeof base64 === 'string' && base64.length > 0) {
    return `data:image/jpeg;base64,${base64}`
  }

  const filePath = details?.portrait?.filePath
  if (typeof filePath !== 'string' || filePath.length === 0) return undefined
  return filePath.startsWith('file://') ? filePath : `file://${filePath}`
}

export default function PassportNfcDetailsStep(): JSX.Element {
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const {
    passportNfcDetails,
    passportMrzBarcode,
    setCurrentStep,
    verificationMode,
    verificationUserData,
  } = useDocumentScanContext()
  const passportDemoModeEnabled = appCapabilitiesStore.usePassportDemoModeEnabled()
  const isDemoMode = verificationMode === 'demo' && passportDemoModeEnabled
  const storedPassport = verificationUserData.document.passport
  const reviewDetails = passportNfcDetails ?? storedPassport.nfc

  const portraitUri = buildPortraitUri(reviewDetails)
  const nidn =
    reviewDetails?.normalized?.nidn ??
    passportMrzBarcode?.barcode?.nidn ??
    storedPassport.mrz?.parsedBarcode?.nidn

  return (
    <UiScreenScrollable
      className='flex-1 px-6'
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <View className='flex-row items-center'>
        <Text className='typography-h5 text-textPrimary'>Review Passport Information</Text>
        <View className='flex-1' />
        <Pressable onPress={() => navigation.navigate('App', { screen: 'Home' })}>
          <View className='h-10 w-10 items-center justify-center rounded-full bg-componentPrimary'>
            <UiIcon customIcon='closeIcon' size={20} className='color-textPrimary' />
          </View>
        </Pressable>
      </View>

      <Text className='typography-body3 mt-2 text-textSecondary'>
        Confirm the information read from your passport chip before face verification.
      </Text>

      {isDemoMode ? (
        <View className='mt-4'>
          <DemoModeBanner message='Demo mode: these passport details are fictional and were not read from an NFC document.' />
        </View>
      ) : null}

      <View className='mt-5 rounded-xl bg-componentPrimary p-4'>
        {portraitUri ? (
          <View className='mb-4 items-center'>
            <Image
              style={{ width: 120, height: 120, borderRadius: 1000 }}
              source={{ uri: portraitUri }}
            />
          </View>
        ) : null}

        <View className='gap-2'>
          <View className='flex-row justify-between gap-4'>
            <Text className='typography-body3 text-textSecondary'>Name</Text>
            <Text className='typography-subtitle4 text-textPrimary'>
              {reviewDetails?.normalized?.firstName ?? '—'}
            </Text>
          </View>
          <View className='flex-row justify-between gap-4'>
            <Text className='typography-body3 text-textSecondary'>Surname</Text>
            <Text className='typography-subtitle4 text-textPrimary'>
              {reviewDetails?.normalized?.lastName ?? '—'}
            </Text>
          </View>
          <View className='flex-row justify-between gap-4'>
            <Text className='typography-body3 text-textSecondary'>Nationality</Text>
            <Text className='typography-subtitle4 text-textPrimary'>
              {reviewDetails?.normalized?.nationality ?? '—'}
            </Text>
          </View>
          <View className='flex-row justify-between gap-4'>
            <Text className='typography-body3 text-textSecondary'>NIDN</Text>
            <Text className='typography-subtitle4 text-textPrimary'>{nidn ?? '—'}</Text>
          </View>
          <View className='flex-row justify-between gap-4'>
            <Text className='typography-body3 text-textSecondary'>Expiry Date</Text>
            <Text className='typography-subtitle4 text-textPrimary'>
              {formatDisplayDate(reviewDetails?.normalized?.expiryDate)}
            </Text>
          </View>
          <View className='flex-row justify-between gap-4'>
            <Text className='typography-body3 text-textSecondary'>Document #</Text>
            <Text className='typography-subtitle4 text-textPrimary'>
              {maskDocumentIdentifier(reviewDetails?.normalized?.documentNumber)}
            </Text>
          </View>
        </View>
      </View>

      <View className='mt-6 gap-3'>
        <UiButton
          title='Continue to Face Verification'
          onPress={() => setCurrentStep(Steps.FaceGazeStep)}
          className='w-full'
        />
        <UiButton
          title='Back to NFC Read'
          variant='outlined'
          onPress={() => setCurrentStep(Steps.ScanPassportNfcStep)}
          className='w-full'
        />
      </View>
    </UiScreenScrollable>
  )
}
