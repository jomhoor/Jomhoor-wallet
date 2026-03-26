import { useNavigation } from '@react-navigation/native'
import { useCallback } from 'react'

import { translate } from '@/core'
import type { LocalAuthStackScreenProps } from '@/route-types'
import { localAuthStore } from '@/store'
import { useAppTheme } from '@/theme'
import { UiButton, UiIcon } from '@/ui'

import LocalAuthPageLayout from '../components/LocalAuthPageLayout'
import { LocalAuthPromoHero } from '../components/LocalAuthPromoHero'

export default function EnablePasscode(_props: LocalAuthStackScreenProps<'EnablePasscode'>) {
  const navigation = useNavigation()
  const { palette } = useAppTheme()

  const disablePasscode = localAuthStore.useLocalAuthStore(s => s.disablePasscode)

  const goToSetPasscode = useCallback(() => {
    navigation.navigate('LocalAuth', { screen: 'SetPasscode' })
  }, [navigation])

  const skipPasscode = useCallback(() => {
    disablePasscode()
  }, [disablePasscode])

  return (
    <LocalAuthPageLayout
      topClassName='gap-10'
      bottomClassName='gap-4'
      top={
        <LocalAuthPromoHero
          icon={<UiIcon customIcon='lockIcon' size={64} color={palette.baseWhite} />}
          title={translate('enable-passcode.title')}
        />
      }
      bottom={
        <>
          <UiButton
            className='typography-buttonMedium w-full text-textPrimary'
            title={translate('enable-passcode.enable-btn')}
            onPress={goToSetPasscode}
          />
          <UiButton
            variant='outlined'
            color='secondary'
            className='typography-buttonMedium w-full text-textSecondary'
            title={translate('enable-passcode.skip-btn')}
            onPress={skipPasscode}
          />
        </>
      }
    />
  )
}
