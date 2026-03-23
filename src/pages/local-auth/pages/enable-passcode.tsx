import { useNavigation } from '@react-navigation/native'
import { useCallback, useMemo } from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { translate } from '@/core'
import type { LocalAuthStackScreenProps } from '@/route-types'
import { localAuthStore } from '@/store'
import { cn, useAppTheme } from '@/theme'
import { UiButton, UiIcon, UiScreenScrollable } from '@/ui'

import { LocalAuthPromoHero } from '../components/LocalAuthPromoHero'

export default function EnablePasscode(_props: LocalAuthStackScreenProps<'EnablePasscode'>) {
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { palette } = useAppTheme()

  const disablePasscode = localAuthStore.useLocalAuthStore(s => s.disablePasscode)

  const scrollBottomInset = useMemo(() => ({ bottom: insets.bottom }), [insets.bottom])

  const goToSetPasscode = useCallback(() => {
    navigation.navigate('LocalAuth', { screen: 'SetPasscode' })
  }, [navigation])

  const skipPasscode = useCallback(() => {
    disablePasscode()
  }, [disablePasscode])

  return (
    <UiScreenScrollable
      style={scrollBottomInset}
      className={cn('flex flex-1 items-center justify-center')}
    >
      <View className={cn('flex-1')}>
        <LocalAuthPromoHero
          icon={<UiIcon customIcon='lockIcon' size={64} color={palette.baseWhite} />}
          title={translate('enable-passcode.title')}
        />

        <View className={cn('flex w-full gap-section px-screen-x py-gutter')}>
          <UiButton
            className='typography-buttonMedium text-textPrimary'
            title={translate('enable-passcode.enable-btn')}
            onPress={goToSetPasscode}
          />
          <UiButton
            className='typography-buttonMedium text-textSecondary'
            title={translate('enable-passcode.skip-btn')}
            onPress={skipPasscode}
          />
        </View>
      </View>
    </UiScreenScrollable>
  )
}
