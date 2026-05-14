import { AuthenticationType } from 'expo-local-authentication'
import { useCallback } from 'react'

import { ErrorHandler, translate } from '@/core'
import type { LocalAuthStackScreenProps } from '@/route-types'
import { localAuthStore } from '@/store'
import { useAppTheme } from '@/theme'
import { UiButton, UiIcon } from '@/ui'

import LocalAuthPageLayout from '../components/LocalAuthPageLayout'

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
  const { palette } = useAppTheme()

  const biometricTypes = localAuthStore.useLocalAuthStore(s => s.biometricAuthTypes)
  const enableBiometrics = localAuthStore.useLocalAuthStore(s => s.enableBiometrics)
  const disableBiometrics = localAuthStore.useLocalAuthStore(s => s.disableBiometrics)

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
    <LocalAuthPageLayout
      promoIcon={<BiometricTypeIcon type={primaryBiometryType} color={palette.baseWhite} />}
      promoTitle={translate('enable-biometrics.title')}
      bottom={
        <>
          <UiButton
            className='typography-buttonMedium w-full text-textPrimary'
            title={translate('enable-biometrics.enable-btn')}
            onPress={() => void enable()}
          />
          <UiButton
            variant='outlined'
            color='secondary'
            className='typography-buttonMedium w-full text-textSecondary'
            title={translate('enable-biometrics.skip-btn')}
            onPress={skip}
          />
        </>
      }
    />
  )
}
