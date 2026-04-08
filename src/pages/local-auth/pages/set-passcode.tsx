import { useNavigation } from '@react-navigation/native'
import { useCallback, useState } from 'react'
import { Text, View } from 'react-native'

import { ErrorHandler, translate } from '@/core'
import type { LocalAuthStackScreenProps } from '@/route-types'
import { BiometricStatuses, localAuthStore } from '@/store'
import { cn } from '@/theme'
import { UiButton, UiNumPad } from '@/ui'

import HiddenPasscodeView from '../components/HiddenPasscodeView'
import LocalAuthPageLayout from '../components/LocalAuthPageLayout'

const PASSCODE_MAX_LENGTH = 4

type Phase = 'create' | 'confirm'

function SetPasscodeHeader({
  phase,
  showMismatchError,
}: {
  phase: Phase
  showMismatchError: boolean
}) {
  const title =
    phase === 'create' ? translate('set-passcode.title') : translate('set-passcode.reenter-title')

  const subtitle = showMismatchError
    ? translate('set-passcode.error-mismatch')
    : phase === 'create'
      ? translate('set-passcode.subtitle')
      : translate('set-passcode.reenter-subtitle')

  return (
    <View className={cn('items-center gap-2')}>
      <Text className={cn('typography-h4 text-center text-textPrimary')}>{title}</Text>
      <Text
        className={cn('typography-body3 text-center', {
          'text-errorMain': showMismatchError,
          'text-textSecondary': !showMismatchError,
        })}
      >
        {subtitle}
      </Text>
    </View>
  )
}

export default function SetPasscode(_props: LocalAuthStackScreenProps<'SetPasscode'>) {
  const navigation = useNavigation()

  const setPasscodeInStore = localAuthStore.useLocalAuthStore(s => s.setPasscode)
  const biometricStatus = localAuthStore.useLocalAuthStore(s => s.biometricStatus)

  const [phase, setPhase] = useState<Phase>('create')
  const [passcode, setPasscode] = useState('')
  const [confirmPasscode, setConfirmPasscode] = useState('')
  const [showMismatchError, setShowMismatchError] = useState(false)

  const resetFlow = useCallback(() => {
    setPasscode('')
    setConfirmPasscode('')
    setPhase('create')
    setShowMismatchError(false)
  }, [])

  const onCreatePasscodeChange = useCallback((value: string) => {
    if (value.length > PASSCODE_MAX_LENGTH) return
    setPasscode(value)
  }, [])

  const onConfirmPasscodeChange = useCallback((value: string) => {
    if (value.length > PASSCODE_MAX_LENGTH) return
    setConfirmPasscode(value)
    setShowMismatchError(false)
  }, [])

  const goToConfirmPhase = useCallback(() => {
    setPhase('confirm')
  }, [])

  const savePasscode = useCallback(() => {
    if (phase !== 'confirm' || confirmPasscode.length !== PASSCODE_MAX_LENGTH) {
      return
    }

    if (passcode !== confirmPasscode) {
      setShowMismatchError(true)
      return
    }

    try {
      setPasscodeInStore(passcode)

      if (biometricStatus === BiometricStatuses.NotSet) {
        navigation.navigate('LocalAuth', { screen: 'EnableBiometrics' })
      }
    } catch (error) {
      ErrorHandler.processWithoutFeedback(error)
    }
  }, [biometricStatus, confirmPasscode, navigation, passcode, phase, setPasscodeInStore])

  const activeValue = phase === 'create' ? passcode : confirmPasscode
  const onNumpadChange = phase === 'create' ? onCreatePasscodeChange : onConfirmPasscodeChange
  const isPasscodeComplete = activeValue.length === PASSCODE_MAX_LENGTH

  const primaryLabel =
    phase === 'create'
      ? translate('set-passcode.continue-btn')
      : translate('set-passcode.submit-btn')

  const onPrimaryPress = phase === 'create' ? goToConfirmPhase : savePasscode

  return (
    <LocalAuthPageLayout
      top={
        <>
          <SetPasscodeHeader phase={phase} showMismatchError={showMismatchError} />
          <HiddenPasscodeView length={activeValue.length} maxLength={PASSCODE_MAX_LENGTH} />
        </>
      }
      bottom={
        <>
          <View className='min-h-12' />
          <UiNumPad value={activeValue} setValue={onNumpadChange} />
          <UiButton title={primaryLabel} onPress={onPrimaryPress} disabled={!isPasscodeComplete} />
          {phase === 'confirm' && (
            <UiButton
              title={translate('set-passcode.reset-btn')}
              variant='outlined'
              onPress={resetFlow}
            />
          )}
        </>
      }
    />
  )
}
