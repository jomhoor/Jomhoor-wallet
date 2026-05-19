import type { FaceComparisonResult } from '@iland/passport-verification'
import { useNavigation } from '@react-navigation/core'
import { Text, View } from 'react-native'
import { Pressable } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Steps, useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'
import { UiButton, UiIcon } from '@/ui'

const mockFaceComparisonResult: FaceComparisonResult = {
  passed: true,
  similarity: 0.99,
  threshold: 0.75,
  model: 'mock',
}

export default function FaceComparisonStep(): JSX.Element {
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { setCurrentStep, setFaceComparisonResult } = useDocumentScanContext()

  return (
    <View style={{ paddingTop: insets.top, paddingBottom: insets.bottom }} className='flex-1 p-6'>
      <View className='flex-row items-center'>
        <Text className='typography-h5 text-textPrimary'>Face Comparison</Text>
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
        Placeholder step for face comparison. Real model-based comparison will be integrated later.
      </Text>

      <View className='mt-6 rounded-xl bg-componentPrimary p-4'>
        <Text className='typography-body3 text-textPrimary'>
          Synthetic result only (no biometric persistence).
        </Text>
      </View>

      <View className='mt-auto gap-3'>
        <UiButton
          title='Continue to Document Preview'
          onPress={() => {
            setFaceComparisonResult(mockFaceComparisonResult)
            setCurrentStep(Steps.DocumentPreviewStep)
          }}
          className='w-full'
        />
        <UiButton
          title='Back to Gaze Challenge'
          variant='outlined'
          onPress={() => setCurrentStep(Steps.FaceGazeStep)}
          className='w-full'
        />
      </View>
    </View>
  )
}
