import { Alert, Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Steps, useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'
import { appCapabilitiesStore } from '@/store'
import { UiCard, UiIcon } from '@/ui'

type PassportCountryOption = {
  code: string
  name: string
  isDemo?: boolean
}

const DEMO_PASSPORT_COUNTRY_OPTION: PassportCountryOption = {
  code: 'DEMO',
  name: 'Demo (No passport required)',
  isDemo: true,
}

const PASSPORT_COUNTRY_OPTIONS: PassportCountryOption[] = [
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
  const passportDemoModeEnabled = appCapabilitiesStore.usePassportDemoModeEnabled()
  const passportCountryOptions = passportDemoModeEnabled
    ? [DEMO_PASSPORT_COUNTRY_OPTION, ...PASSPORT_COUNTRY_OPTIONS]
    : PASSPORT_COUNTRY_OPTIONS

  const continueToMrz = (countryCode: string) => {
    setVerificationMode('live')
    setPassportCountryCode(countryCode)
    setCurrentStep(Steps.ScanMrzStep)
  }

  const continueToDemo = () => {
    if (!passportDemoModeEnabled) return
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
      <View className='gap-4 px-5 pb-3'>
        <Text
          className='typography-h4 my-4 text-center text-textPrimary'
          style={{ lineHeight: 42 }}
        >
          Select Passport Country
        </Text>
      </View>

      <ScrollView
        className='flex-1'
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}
        showsVerticalScrollIndicator={false}
      >
        <View className='flex flex-col gap-3'>
          {passportCountryOptions.map(option => (
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
      </ScrollView>

      <View
        className='px-5 pt-3'
        style={{
          paddingBottom: Math.max(insets.bottom, 20),
        }}
      >
        <Pressable
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
    </View>
  )
}
