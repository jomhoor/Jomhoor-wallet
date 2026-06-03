import { Alert, Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Steps, useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'
import { UiCard, UiIcon } from '@/ui'

type PassportCountryOption = {
  code: string
  name: string
  isDemo?: boolean
}

const PASSPORT_COUNTRY_OPTIONS: PassportCountryOption[] = [
  { code: 'DEMO', name: 'Demo (No passport required)', isDemo: true },
  { code: 'IRN', name: 'Iran ایران' },
  { code: 'AFG', name: 'Afghanistan افغانستان' },
  { code: 'ARE', name: 'United Arab Emirates الإمارات العربية المتحدة' },
  { code: 'IND', name: 'India भारत' },
  { code: 'JPN', name: 'Japan 日本' },
  { code: 'AUS', name: 'Australia' },
  { code: 'CAN', name: 'Canada' },
  { code: 'DEU', name: 'Germany' },
  { code: 'FRA', name: 'France' },
  { code: 'GBR', name: 'United Kingdom' },
  { code: 'IRQ', name: 'Iraq العراق' },
  { code: 'SWE', name: 'Sweden' },
  { code: 'TUR', name: 'Turkey' },
  { code: 'USA', name: 'United States' },
]

export default function SelectPassportCountryStep() {
  const insets = useSafeAreaInsets()
  const { setCurrentStep, setPassportCountryCode, setVerificationMode } = useDocumentScanContext()

  const continueToMrz = (countryCode: string) => {
    setVerificationMode('live')
    setPassportCountryCode(countryCode)
    setCurrentStep(Steps.ScanMrzStep)
  }

  const continueToDemo = () => {
    setVerificationMode('demo')
    setPassportCountryCode(undefined)
    setCurrentStep(Steps.ScanMrzStep)
  }

  return (
    <View
      className='flex flex-1 flex-col'
      style={{
        paddingTop: insets.top,
      }}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View className='flex flex-1 flex-col gap-4 p-5'>
          <Text
            className='typography-h4 my-4 text-center text-textPrimary'
            style={{ lineHeight: 52 }}
          >
            Select Passport Country
          </Text>

          <Text className='typography-body3 text-center text-textSecondary'>
            Iranian passport is fully supported. Other passport types may have limited support.
          </Text>

          <View className='mt-2 flex flex-col gap-3'>
            {PASSPORT_COUNTRY_OPTIONS.map(option => (
              <Pressable
                key={option.code}
                onPress={() => {
                  if (option.isDemo) {
                    continueToDemo()
                    return
                  }

                  if (option.code === 'IRN') {
                    continueToMrz(option.code)
                    return
                  }

                  Alert.alert(
                    'NOTE',
                    'This type of passport is not fully supported.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Continue',
                        onPress: () => {
                          continueToMrz(option.code)
                        },
                      },
                    ],
                    { cancelable: true },
                  )
                }}
              >
                <UiCard className='flex flex-row items-center gap-3'>
                  <UiIcon customIcon='suitcaseSimpleIcon' className='text-textPrimary' />
                  <View className='flex-1'>
                    <Text className='typography-subtitle4 text-textPrimary'>{option.name}</Text>
                    <Text className='typography-body4 text-textSecondary'>{option.code}</Text>
                    {option.isDemo ? (
                      <Text className='typography-body4 mt-1 text-warningMain'>
                        Fictional data for App Review and product demonstration
                      </Text>
                    ) : null}
                  </View>
                </UiCard>
              </Pressable>
            ))}
          </View>

          <Pressable
            className='mt-4'
            onPress={() => {
              setVerificationMode('live')
              setPassportCountryCode(undefined)
              setCurrentStep(Steps.SelectDocTypeStep)
            }}
          >
            <UiCard className='items-center'>
              <Text className='typography-body3 text-textSecondary'>Back to Document Type</Text>
            </UiCard>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  )
}
