import type { LivenessResult } from '@iland/passport-verification/face'
import { useNavigation } from '@react-navigation/core'
import { Text, View } from 'react-native'
import { Pressable } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Steps, useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'
import { UiButton, UiIcon } from '@/ui'

const mockLivenessResult: LivenessResult = {
  passed: true,
  challenges: [
    { type: 'blink', passed: true, confidence: 1 },
    { type: 'smile', passed: true, confidence: 1 },
  ],
}

export default function FaceLivenessStep(): JSX.Element {
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { setCurrentStep, setFaceLivenessResult } = useDocumentScanContext()

  return (
    <View style={{ paddingTop: insets.top, paddingBottom: insets.bottom }} className='flex-1 p-6'>
      <View className='flex-row items-center'>
        <Text className='typography-h5 text-textPrimary'>Face Liveness Check</Text>
        <View className='flex-1' />
        <Pressable
          onPress={() => {
            navigation.navigate('App', { screen: 'Home' })
          }}
        >
          <View className='h-10 w-10 items-center justify-center rounded-full bg-componentPrimary'>
            <UiIcon customIcon='closeIcon' size={20} className='color-textPrimary' />
          </View>
        </Pressable>
      </View>

      <Text className='typography-body3 mt-3 text-textSecondary'>
        Placeholder step for liveness. Real camera challenge will be integrated in a later phase.
      </Text>

      <View className='mt-6 rounded-xl bg-componentPrimary p-4'>
        <Text className='typography-body3 text-textPrimary'>
          Synthetic result only (no biometric capture).
        </Text>
      </View>

      <View className='mt-auto gap-3'>
        <UiButton
          title='Continue to Gaze Challenge'
          onPress={() => {
            setFaceLivenessResult(mockLivenessResult)
            setCurrentStep(Steps.FaceGazeStep)
          }}
          className='w-full'
        />
        <UiButton
          title='Skip Face Checks'
          variant='outlined'
          onPress={() => setCurrentStep(Steps.DocumentPreviewStep)}
          className='w-full'
        />
      </View>
    </View>
  )
}
