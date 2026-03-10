import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Text, View } from 'react-native'
import Animated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { UiButton, UiHorizontalDivider, UiIcon } from '@/ui'

const PollLoadingScreen = () => {
  const { t } = useTranslation()
  return (
    <View className='h-full items-center justify-center bg-backgroundPrimary'>
      <ActivityIndicator size='large' color='#6366f1' />
      <Text className='typography-body3 mt-4 text-textSecondary'>{t('poll.loading')}</Text>
    </View>
  )
}

const PollErrorScreen = ({ message, onRetry }: { message?: string; onRetry?: () => void }) => {
  const { t } = useTranslation()
  return (
    <View className='h-full items-center justify-center bg-backgroundPrimary px-6'>
      <UiIcon customIcon='warningIcon' size={48} className='mb-4 color-errorMain' />
      <Text className='typography-h6 mb-2 text-errorMain'>{t('poll.error-title')}</Text>
      <Text className='typography-body3 mb-6 text-center text-textSecondary'>
        {message || t('poll.error-default')}
      </Text>
      {onRetry && <UiButton title={t('poll.try-again')} onPress={onRetry} />}
    </View>
  )
}

const PollNoIdentity = ({ onGoBack }: { onGoBack: () => void }) => {
  const insets = useSafeAreaInsets()
  const { t } = useTranslation()

  return (
    <View
      className='h-full justify-center gap-3 bg-backgroundPrimary p-4'
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <View className='w-full flex-1 items-center justify-center gap-6 px-4'>
        <View className='mb-4 size-[80px] flex-row items-center justify-center rounded-full bg-warningLight'>
          <UiIcon customIcon='infoIcon' size={40} className='color-warningMain' />
        </View>
        <View className='items-center'>
          <Text className='typography-h5 mb-2 text-center text-textPrimary'>
            {t('poll.no-identity-title')}
          </Text>
          <Text className='typography-body3 mb-6 text-textSecondary'>
            {t('poll.no-identity-subtitle')}
          </Text>
        </View>
        <View className='absolute inset-x-0 bottom-0 p-4'>
          <UiButton title={t('poll.create-identity')} onPress={onGoBack} className='w-full' />
        </View>
      </View>
    </View>
  )
}
const PollAlreadyVotedScreen = ({ onGoBack }: { onGoBack: () => void }) => {
  const insets = useSafeAreaInsets()
  const { t } = useTranslation()

  return (
    <View
      className='h-full justify-center gap-3 bg-backgroundPrimary p-4'
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <View className='w-full flex-1 items-center justify-center gap-6 px-4'>
        <View className='mb-4 size-[80px] flex-row items-center justify-center rounded-full bg-warningLight'>
          <UiIcon customIcon='infoIcon' size={40} className='color-warningMain' />
        </View>
        <View className='items-center'>
          <Text className='typography-h5 mb-2 text-textPrimary'>
            {t('poll.already-voted-title')}
          </Text>
          <Text className='typography-body3 mb-6 text-textSecondary'>
            {t('poll.already-voted-subtitle')}
          </Text>
        </View>
        <View className='absolute inset-x-0 bottom-0 p-4'>
          <UiButton title={t('poll.go-back')} onPress={onGoBack} className='w-full' />
        </View>
      </View>
    </View>
  )
}

function SubmittingScreen({ animatedValue }: { animatedValue: SharedValue<number> }) {
  const barStyle = useAnimatedStyle(() => ({ width: `${animatedValue.value}%` }))
  const insets = useSafeAreaInsets()
  const { t } = useTranslation()

  return (
    <View
      className='h-full justify-center gap-3 bg-backgroundPrimary p-4'
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <View className='w-full items-center gap-6'>
        <View className='mb-4 size-[80px] flex-row items-center justify-center rounded-full bg-warningLight'>
          <ActivityIndicator className='size-[40px] color-warningMain' />
        </View>
        <Text className='typography-h5 mb-2 text-textPrimary'>{t('poll.submitting-title')}</Text>
        <Text className='typography-body3 mb-6 text-textSecondary'>
          {t('poll.submitting-subtitle')}
        </Text>
        <View className='mb-4 h-2 w-4/5 rounded-full bg-componentPrimary'>
          <Animated.View className='h-full rounded-full bg-primaryMain' style={barStyle} />
        </View>
        <UiHorizontalDivider />
        <View className='w-full flex-row items-center rounded-lg bg-warningLight p-3'>
          <UiIcon customIcon='infoIcon' size={18} className='mr-2 color-warningMain' />
          <Text className='typography-body4 flex-1 text-warningMain'>
            {t('poll.submitting-warning')}
          </Text>
        </View>
      </View>
    </View>
  )
}

function FinishScreen({ onGoBack }: { onGoBack: () => void }) {
  const insets = useSafeAreaInsets()
  const { t } = useTranslation()
  return (
    <View
      className='h-full justify-center gap-3 bg-backgroundPrimary p-4'
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <View className='w-full flex-1 items-center justify-center gap-6 px-4'>
        <View className='mb-4 size-[80px] flex-row items-center justify-center rounded-full bg-successLight'>
          <UiIcon customIcon='checkIcon' size={40} className='color-successMain' />
        </View>
        <View className='w-full items-center text-center'>
          <Text className='typography-h5 mb-2 text-textPrimary'>{t('poll.finished-title')}</Text>
          <Text className='typography-body3 mb-6 text-textSecondary'>
            {t('poll.finished-subtitle')}
          </Text>
        </View>
        <View className='absolute inset-x-0 bottom-0 w-full p-2'>
          <UiButton title={t('poll.go-back')} onPress={onGoBack} className='w-full' />
        </View>
      </View>
    </View>
  )
}

const PollStateScreen = {
  Loading: PollLoadingScreen,
  NoIdentity: PollNoIdentity,
  Error: PollErrorScreen,
  Submitting: SubmittingScreen,
  AlreadyVoted: PollAlreadyVotedScreen,
  Finished: FinishScreen,
}

export default PollStateScreen
