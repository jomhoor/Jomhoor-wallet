import { useNavigation } from '@react-navigation/native'
import { AuthenticationType } from 'expo-local-authentication'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ErrorHandler, nu, translate } from '@/core'
import HiddenPasscodeView from '@/pages/local-auth/components/HiddenPasscodeView'
import type { LocalAuthStackScreenProps } from '@/route-types'
import { authStore, BiometricStatuses, localAuthStore, MAX_ATTEMPTS } from '@/store'
import { cn, useAppTheme } from '@/theme'
import { UiButton, UiIcon, UiNumPad, UiScreenScrollable } from '@/ui'

type SafeAreaPadding = { paddingTop: number; paddingBottom: number }

const PASSCODE_MAX_LENGTH = 4
const WRONG_PASSCODE_FEEDBACK_MS = 1000

function useBiometricUnlock() {
  const tryUnlock = localAuthStore.useLocalAuthStore(state => state.tryUnlockWithBiometrics)

  return useCallback(async () => {
    try {
      await tryUnlock()
    } catch (error) {
      ErrorHandler.processWithoutFeedback(error)
    }
  }, [tryUnlock])
}

function useWrongPasscodeFeedback(attemptsLeft: number, onClearPasscode: () => void) {
  const [showError, setShowError] = useState(false)
  const prevAttemptsLeft = useRef(attemptsLeft)

  useEffect(() => {
    const attemptsDecreased = attemptsLeft < prevAttemptsLeft.current
    prevAttemptsLeft.current = attemptsLeft

    if (!attemptsDecreased) {
      return
    }

    setShowError(true)
    const timeoutId = setTimeout(() => {
      setShowError(false)
      onClearPasscode()
    }, WRONG_PASSCODE_FEEDBACK_MS)

    return () => clearTimeout(timeoutId)
  }, [attemptsLeft, onClearPasscode])

  return showError
}

export default function Lockscreen({}: LocalAuthStackScreenProps<'Lockscreen'>) {
  const { i18n } = useTranslation()
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()

  const biometricStatus = localAuthStore.useLocalAuthStore(s => s.biometricStatus)
  const attemptsLeft = localAuthStore.useLocalAuthStore(s => s.attemptsLeft)
  const lockDeadline = localAuthStore.useLocalAuthStore(s => s.lockDeadline)
  const tryUnlockWithPasscode = localAuthStore.useLocalAuthStore(s => s.tryUnlockWithPasscode)
  const resetLocalAuthStore = localAuthStore.useLocalAuthStore(s => s.resetStore)
  const checkLockDeadline = localAuthStore.useCheckLockDeadline()
  const logout = authStore.useLogout()

  const unlockWithBiometrics = useBiometricUnlock()

  const [passcode, setPasscode] = useState('')
  const clearPasscode = useCallback(() => setPasscode(''), [])
  const passcodeError = useWrongPasscodeFeedback(attemptsLeft, clearPasscode)

  const safeAreaPadding = useMemo(
    () => ({
      paddingTop: insets.top,
      paddingBottom: insets.bottom,
    }),
    [insets.bottom, insets.top],
  )

  const tryLogout = useCallback(async () => {
    logout()
    await resetLocalAuthStore()
    navigation.navigate('Auth', { screen: 'Intro' })
  }, [logout, navigation, resetLocalAuthStore])

  const submitPasscode = useCallback(
    (value: string) => {
      if (value.length !== PASSCODE_MAX_LENGTH) return
      tryUnlockWithPasscode(value)
    },
    [tryUnlockWithPasscode],
  )

  const onPasscodeChange = useCallback(
    (value: string) => {
      if (value.length > PASSCODE_MAX_LENGTH) return
      setPasscode(value)
      if (value.length === PASSCODE_MAX_LENGTH) {
        submitPasscode(value)
      }
    },
    [submitPasscode],
  )

  useEffect(() => {
    if (biometricStatus !== BiometricStatuses.Enabled) return
    void unlockWithBiometrics()
    // Prompt once when the screen mounts — avoid re-running when the callback identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isAccountLocked = lockDeadline != null

  return (
    <UiScreenScrollable className={cn('flex flex-1 items-center justify-center')}>
      {isAccountLocked ? (
        <LockedOutContent
          safeAreaPadding={safeAreaPadding}
          lockDeadline={lockDeadline}
          onLockExpired={checkLockDeadline}
          onLogout={tryLogout}
        />
      ) : (
        <PasscodeEntryContent
          safeAreaPadding={safeAreaPadding}
          passcode={passcode}
          passcodeError={passcodeError}
          attemptsLeft={attemptsLeft}
          i18nLanguage={i18n.language}
          biometricStatus={biometricStatus}
          onPasscodeChange={onPasscodeChange}
          onBiometricPress={unlockWithBiometrics}
          onForgot={tryLogout}
        />
      )}
    </UiScreenScrollable>
  )
}

function LockedOutContent({
  safeAreaPadding,
  lockDeadline,
  onLockExpired,
  onLogout,
}: {
  safeAreaPadding: SafeAreaPadding
  lockDeadline: number
  onLockExpired: () => void
  onLogout: () => void | Promise<void>
}) {
  const isPermanent = lockDeadline === Infinity

  return (
    <View style={safeAreaPadding} className='w-full flex-1'>
      {isPermanent ? (
        <View className='flex flex-1 items-center gap-2 px-gutter'>
          <Text className={cn('typography-h4 my-auto text-center text-textPrimary')}>
            {translate('lockscreen.locked-permanently')}
          </Text>
          <UiButton
            className='mt-auto w-full'
            title={translate('lockscreen.logout-btn')}
            onPress={() => void onLogout()}
          />
        </View>
      ) : (
        <View className='my-auto flex items-center gap-2'>
          <Text className={cn('typography-h4 text-center text-textPrimary')}>
            {translate('lockscreen.locked-temp')}
          </Text>
          <Countdown deadline={lockDeadline} onFinish={onLockExpired} />
        </View>
      )}
    </View>
  )
}

function PasscodeEntryContent({
  safeAreaPadding,
  passcode,
  passcodeError,
  attemptsLeft,
  i18nLanguage,
  biometricStatus,
  onPasscodeChange,
  onBiometricPress,
  onForgot,
}: {
  safeAreaPadding: SafeAreaPadding
  passcode: string
  passcodeError: boolean
  attemptsLeft: number
  i18nLanguage: string
  biometricStatus: BiometricStatuses
  onPasscodeChange: (value: string) => void
  onBiometricPress: () => Promise<void>
  onForgot: () => void | Promise<void>
}) {
  const biometricsEnabled = biometricStatus === BiometricStatuses.Enabled
  const showAttemptsWarning = attemptsLeft < MAX_ATTEMPTS

  return (
    <View style={safeAreaPadding} className='w-full flex-1'>
      <View className={cn('my-auto flex w-full items-center gap-10 px-screen-x py-gutter')}>
        <Text className={cn('typography-h4 text-center text-textPrimary')}>
          {translate('lockscreen.default-title')}
        </Text>

        <HiddenPasscodeView
          isError={passcodeError}
          length={passcode.length}
          maxLength={PASSCODE_MAX_LENGTH}
        />
      </View>

      <View className={cn('flex w-full gap-10 px-screen-x py-gutter')}>
        {showAttemptsWarning ? (
          <Text className={cn('typography-subtitle1 min-h-12 text-center text-errorDark')}>
            {translate('lockscreen.attempts-left', {
              attemptsLeft: nu.localized(attemptsLeft, i18nLanguage),
            })}
          </Text>
        ) : (
          <View className='min-h-12' />
        )}

        <UiNumPad
          value={passcode}
          setValue={onPasscodeChange}
          onExtraPress={biometricsEnabled ? () => void onBiometricPress() : undefined}
          extra={biometricsEnabled ? <BiometricsIcon size={32} /> : undefined}
        />

        <UiButton
          variant='outlined'
          color='error'
          title={translate('lockscreen.forgot-btn')}
          onPress={() => void onForgot()}
        />
      </View>
    </View>
  )
}

function Countdown({ deadline, onFinish }: { deadline: number; onFinish: () => void }) {
  const { i18n } = useTranslation()
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.trunc((deadline - Date.now()) / 1000)),
  )

  useEffect(() => {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      onFinish()
      return
    }

    setSecondsLeft(Math.trunc(remainingMs / 1000))

    const intervalId = setInterval(() => {
      const ms = deadline - Date.now()
      if (ms <= 0) {
        clearInterval(intervalId)
        onFinish()
        return
      }
      setSecondsLeft(Math.trunc(ms / 1000))
    }, 1000)

    return () => clearInterval(intervalId)
  }, [deadline, onFinish])

  return (
    <Text className='typography-subtitle1 text-textPrimary'>
      {translate('lockscreen.countdown-seconds', {
        seconds: nu.localized(secondsLeft, i18n.language),
      })}
    </Text>
  )
}

function BiometricsIcon({ ...rest }: { size?: number; color?: string }) {
  const { palette } = useAppTheme()
  const biometricTypes = localAuthStore.useLocalAuthStore(state => state.biometricAuthTypes)

  return {
    [AuthenticationType.FINGERPRINT]: (
      <UiIcon customIcon='fingerprintIcon' size={50} color={palette.textPrimary} {...rest} />
    ),
    [AuthenticationType.FACIAL_RECOGNITION]: (
      <UiIcon
        libIcon='MaterialCommunityIcons'
        name='face-recognition'
        size={50}
        color={palette.textPrimary}
        {...rest}
      />
    ),
    [AuthenticationType.IRIS]: (
      <UiIcon customIcon='fingerprintIcon' size={50} color={palette.textPrimary} {...rest} />
    ),
  }[biometricTypes[0]]
}
