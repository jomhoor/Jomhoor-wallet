import { useNavigation } from '@react-navigation/native'
import { Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAppPaddings } from '@/theme'
import { UiButton, UiIcon } from '@/ui'
import UiJumpingDotsLoader from '@/ui/UiJumpingDotsLoader'

import { GenProofSteps, useDocumentScanContext } from '../ScanProvider'

export default function GenerateProofStep() {
  const insets = useSafeAreaInsets()
  const appPaddings = useAppPaddings()

  const { creatingIdentityStep } = useDocumentScanContext()

  const navigation = useNavigation()

  return (
    <View
      className='flex-1 justify-center p-6'
      style={{
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        paddingLeft: appPaddings.left,
        paddingRight: appPaddings.right,
      }}
    >
      {
        {
          [GenProofSteps.DownloadCircuit]: (
            <>
              <View className='mb-8 items-center'>
                <View className='h-16 w-16 items-center justify-center rounded-full bg-warningLight'>
                  <UiJumpingDotsLoader size={9} color='warningMain' />
                </View>
                <Text className='typography-h5 mb-2 text-center text-textPrimary'>Please wait</Text>
                <Text className='typography-body3 text-center text-textSecondary'>
                  Creating your digital profile
                </Text>
              </View>
              <View className='mb-8 w-full px-4'>
                <StepRow title='Download Circuit' status='processing' />
                <StepRow title='Create Proof' status='pending' />
                <StepRow title='Profile creation' status='pending' />
              </View>
            </>
          ),

          [GenProofSteps.GenerateProof]: (
            <>
              <View className='mb-8 items-center'>
                <View className='h-16 w-16 items-center justify-center rounded-full bg-warningLight'>
                  <UiJumpingDotsLoader size={9} color='warningMain' />
                </View>
                <Text className='typography-h5 mb-2 text-center text-textPrimary'>Please wait</Text>
                <Text className='typography-body3 text-center text-textSecondary'>
                  Creating your digital profile
                </Text>
              </View>
              <View className='mb-8 w-full px-4'>
                <StepRow title='Download Circuit' status='completed' />
                <StepRow title='Create Proof' status='processing' />
                <StepRow title='Profile creation' status='pending' />
              </View>
            </>
          ),

          [GenProofSteps.CreateProfile]: (
            <>
              <View className='mb-8 items-center'>
                <View className='h-16 w-16 items-center justify-center rounded-full bg-warningLight'>
                  <UiJumpingDotsLoader size={9} color='warningMain' />
                </View>
                <Text className='typography-h5 mb-2 text-center text-textPrimary'>Please wait</Text>
                <Text className='typography-body3 text-center text-textSecondary'>
                  Creating your digital profile
                </Text>
              </View>
              <View className='mb-8 w-full px-4'>
                <StepRow title='Download Circuit' status='completed' />
                <StepRow title='Create Proof' status='completed' />
                <StepRow title='Profile creation' status='processing' />
              </View>
            </>
          ),

          [GenProofSteps.Final]: (
            <>
              <View className='mb-8 mt-auto items-center'>
                <View className='h-16 w-16 items-center justify-center rounded-full bg-successLight'>
                  <UiIcon customIcon='checkIcon' size={40} className='color-successMain' />
                </View>
                <Text className='typography-h5 mb-2 text-center text-textPrimary'>Ready</Text>
                <Text className='typography-body3 text-center text-textSecondary'>
                  A digital profile created
                </Text>
              </View>
              <View className='mb-8 w-full px-4'>
                <StepRow title='Download Circuit' status='completed' />
                <StepRow title='Create Proof' status='completed' />
                <StepRow title='Profile creation' status='completed' />
              </View>
              <View className='mt-auto w-full'>
                <UiButton
                  title='Home Page'
                  onPress={() => {
                    navigation.navigate('App', {
                      screen: 'Documents',
                    })
                  }}
                  className='w-full'
                />
              </View>
            </>
          ),
        }[creatingIdentityStep]
      }
    </View>
  )
}

const StepRow = ({
  title,
  status,
}: {
  title: string
  status: 'completed' | 'processing' | 'pending'
}) => {
  const rightContent = (() => {
    if (status === 'pending') {
      return (
        <View className='h-10 w-10 items-center justify-center rounded-full bg-componentHovered'>
          <UiJumpingDotsLoader size={5} color='primaryMain' />
        </View>
      )
    }

    if (status === 'completed') {
      return (
        <View className='h-9 w-9 items-center justify-center rounded-full bg-successLight'>
          <UiIcon customIcon='checkIcon' size={20} className='color-successMain' />
        </View>
      )
    }

    return (
      <View className='flex flex-row items-center gap-2'>
        <Text className='text-textPrimary'>Processing...</Text>
        <View className='h-10 w-10 items-center justify-center rounded-full bg-componentHovered'>
          <UiJumpingDotsLoader size={5} color='primaryMain' />
        </View>
      </View>
    )
  })()

  return (
    <View className='flex-row items-center justify-between border-b border-componentHovered py-2'>
      <Text className='typography-body2 text-textPrimary'>{title}</Text>
      {rightContent}
    </View>
  )
}
