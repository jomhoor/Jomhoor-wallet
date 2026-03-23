import { AuthenticationType } from 'expo-local-authentication'
import { useCallback, useMemo } from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ErrorHandler, translate } from '@/core'
import type { LocalAuthStackScreenProps } from '@/route-types'
import { localAuthStore } from '@/store'
import { cn, useAppTheme } from '@/theme'
import { UiButton, UiIcon, UiScreenScrollable } from '@/ui'

import { LocalAuthPromoHero } from '../components/LocalAuthPromoHero'

const ICON_SIZE = 50

function BiometricTypeIcon({ type, color }: { type: AuthenticationType; color: string }) {
  switch (type) {
    case AuthenticationType.FACIAL_RECOGNITION:
      return (
        <UiIcon
          libIcon='MaterialCommunityIcons'
          name='face-recognition'
          size={ICON_SIZE}
          color={color}
        />
      )
    case AuthenticationType.IRIS:
    case AuthenticationType.FINGERPRINT:
    default:
      return <UiIcon customIcon='fingerprintIcon' size={ICON_SIZE} color={color} />
  }
}

export default function EnableBiometrics(_props: LocalAuthStackScreenProps<'EnableBiometrics'>) {
  const insets = useSafeAreaInsets()
  const { palette } = useAppTheme()

  const biometricTypes = localAuthStore.useLocalAuthStore(s => s.biometricAuthTypes)
  const enableBiometrics = localAuthStore.useLocalAuthStore(s => s.enableBiometrics)
  const disableBiometrics = localAuthStore.useLocalAuthStore(s => s.disableBiometrics)

  const scrollBottomInset = useMemo(() => ({ bottom: insets.bottom }), [insets.bottom])

  const primaryBiometryType = biometricTypes[0] ?? AuthenticationType.FINGERPRINT

  const enable = useCallback(async () => {
    try {
      await enableBiometrics()
    } catch (error) {
      ErrorHandler.processWithoutFeedback(error)
    }
  }, [enableBiometrics])

  const skip = useCallback(() => {
    disableBiometrics()
  }, [disableBiometrics])

  return (
    <UiScreenScrollable
      style={scrollBottomInset}
      className={cn('flex flex-1 items-center justify-center')}
    >
      <View className={cn('flex-1')}>
        <LocalAuthPromoHero
          icon={<BiometricTypeIcon type={primaryBiometryType} color={palette.baseWhite} />}
          title={translate('enable-biometrics.title')}
        />

        <View className={cn('flex w-full gap-section px-screen-x py-gutter')}>
          <UiButton
            className='typography-buttonMedium text-textPrimary'
            title={translate('enable-biometrics.enable-btn')}
            onPress={() => void enable()}
          />
          <UiButton
            className='typography-buttonMedium text-textSecondary'
            title={translate('enable-biometrics.skip-btn')}
            onPress={skip}
          />
        </View>
      </View>
    </UiScreenScrollable>
  )
}
