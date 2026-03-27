import { BottomSheetView } from '@gorhom/bottom-sheet'
import WheelPicker from '@quidone/react-native-wheel-picker'
import * as Haptics from 'expo-haptics'
import { version } from 'package.json'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Text, TouchableOpacity, useColorScheme, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useSelectedLanguage } from '@/core'
import { type Language, resources } from '@/core/localization/resources'
import type { AppStackScreenProps } from '@/route-types'
import { BiometricStatuses, localAuthStore, PasscodeStatuses } from '@/store'
import { cn, ColorSchemeType, useAppPaddings, useAppTheme, useSelectedTheme } from '@/theme'
import {
  UiBottomSheet,
  UiButton,
  UiCard,
  UiHorizontalDivider,
  UiIcon,
  UiSwitcher,
  useUiBottomSheet,
} from '@/ui'

import { AppStackScrollLayout } from '../../components/app-stack-scroll-layout'
import { ProfileListButton } from '../../components/profile-list-button'

export default function SettingsScreen({}: AppStackScreenProps<'Settings'>) {
  const { t } = useTranslation()

  return (
    <AppStackScrollLayout title={t('settings.title')}>
      <SettingsCard />
      <AppVersionCard />
    </AppStackScrollLayout>
  )
}

function LangCard() {
  const { t } = useTranslation()
  const { language, setLanguage } = useSelectedLanguage()
  const languageBottomSheet = useUiBottomSheet()
  const appPaddings = useAppPaddings()
  const [value, setValue] = useState<string>(language)
  const { palette } = useAppTheme()
  return (
    <>
      <View className='flex w-full flex-col gap-4'>
        <ProfileListButton
          title={t('settings.language')}
          leadingIcon={<UiIcon customIcon='earthLineIcon' className='text-textPrimary' size={24} />}
          onPress={languageBottomSheet.present}
          trailingContent={<Text className='typography-body2 text-textSecondary'>{language}</Text>}
        />
      </View>
      <UiBottomSheet
        title={t('settings.select-language')}
        ref={languageBottomSheet.ref}
        detached={true}
        enableDynamicSizing={false}
        snapPoints={['25%']}
        enableContentPanningGesture={false}
        headerComponent={
          <View className='flex-row items-center justify-center py-0'>
            <UiButton
              variant='text'
              title={t('home.cancel')}
              onPress={languageBottomSheet.dismiss}
            />
            <UiHorizontalDivider className='mx-auto h-3 w-14 rounded-full' />
            <UiButton
              variant='text'
              title={t('settings.submit')}
              onPress={() => {
                setLanguage(value as Language)
                languageBottomSheet.dismiss()
              }}
            />
          </View>
        }
      >
        <BottomSheetView
          className='w-full'
          style={{
            paddingLeft: appPaddings.left,
            paddingRight: appPaddings.right,
          }}
        >
          <View className={cn('justify-top flex gap-2')}>
            <WheelPicker
              data={Object.keys(resources).map(el => ({
                label: {
                  en: 'English',
                  fa: 'فارسی',
                  ar: 'العربية',
                  uk: 'Українська',
                }[el],
                value: el,
              }))}
              itemTextStyle={{ color: palette.textPrimary }}
              value={value}
              onValueChanged={({ item: { value } }) => setValue(value)}
              onValueChanging={Haptics.selectionAsync}
              enableScrollByTapOnItem
              itemHeight={30}
            />
          </View>
        </BottomSheetView>
      </UiBottomSheet>
    </>
  )
}

function ThemeCard() {
  const { t } = useTranslation()
  const appPaddings = useAppPaddings()
  const bottomSheet = useUiBottomSheet()
  const { selectedTheme, setSelectedTheme } = useSelectedTheme()
  const colorSchemeName = useColorScheme()

  return (
    <>
      <ProfileListButton
        leadingIcon={(() => {
          if (!colorSchemeName) {
            return (
              <UiIcon
                libIcon='FontAwesome'
                name='paint-brush'
                className='text-textPrimary'
                size={4 * 4}
              />
            )
          }

          return {
            light: (
              <UiIcon
                libIcon='Fontisto'
                name='day-sunny'
                className='text-textPrimary'
                size={4.5 * 4}
              />
            ),
            dark: (
              <UiIcon customIcon='nightClearIcon' className='text-textPrimary' size={4.5 * 4} />
            ),
          }[colorSchemeName]
        })()}
        title={t('settings.theme')}
        trailingContent={
          <Text className='typography-body4 capitalize text-textSecondary'>{selectedTheme}</Text>
        }
        onPress={bottomSheet.present}
      />

      <UiBottomSheet
        title={t('settings.select-theme')}
        ref={bottomSheet.ref}
        detached={true}
        enableDynamicSizing={false}
        snapPoints={['20%']}
        headerComponent={
          <>
            <UiHorizontalDivider className='mx-auto my-4 mb-0 h-3 w-14 rounded-full' />
          </>
        }
      >
        <BottomSheetView
          className='mt-3 flex size-full gap-2 pt-6'
          style={{
            paddingLeft: appPaddings.left,
            paddingRight: appPaddings.right,
          }}
        >
          <View className={cn('flex flex-row justify-center gap-4')}>
            {[
              {
                title: 'light',
                value: 'light',
                icon: (
                  <UiIcon
                    libIcon='Fontisto'
                    name='day-sunny'
                    size={6 * 4}
                    className='text-textPrimary'
                  />
                ),
              },
              {
                title: 'dark',
                value: 'dark',
                icon: (
                  <UiIcon customIcon='nightClearIcon' size={6 * 4} className='text-textPrimary' />
                ),
              },
              {
                title: 'system',
                value: 'system',
                icon: (
                  <UiIcon
                    libIcon='Entypo'
                    name='mobile'
                    size={6 * 4}
                    className='text-textPrimary'
                  />
                ),
              },
            ].map(({ value, title, icon }, idx) => (
              <TouchableOpacity
                key={idx}
                className={cn(
                  'flex w-1/4 items-center gap-4 rounded-lg border-2 border-componentPrimary p-3',
                  selectedTheme === value ? 'border-primaryMain' : 'border-componentPrimary',
                )}
                onPress={() => setSelectedTheme(value as ColorSchemeType)}
              >
                {icon}
                <Text className='typography-caption1 capitalize text-textSecondary'>{title}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </BottomSheetView>
      </UiBottomSheet>
    </>
  )
}

function LocalAuthMethodCard() {
  const { t } = useTranslation()
  const passcodeStatus = localAuthStore.useLocalAuthStore(state => state.passcodeStatus)
  const biometricStatus = localAuthStore.useLocalAuthStore(state => state.biometricStatus)
  const disablePasscode = localAuthStore.useLocalAuthStore(state => state.disablePasscode)
  const disableBiometric = localAuthStore.useLocalAuthStore(state => state.disableBiometrics)
  const authMethodBottomSheet = useUiBottomSheet()
  const setPasscodeStatus = localAuthStore.useLocalAuthStore(state => state.setPasscodeStatus)
  const setBiometricsStatus = localAuthStore.useLocalAuthStore(state => state.setBiometricsStatus)
  const insets = useSafeAreaInsets()
  const appPaddings = useAppPaddings()
  const isPasscodeEnabled = useMemo(
    () => passcodeStatus === PasscodeStatuses.Enabled,
    [passcodeStatus],
  )

  const isBiometricsEnrolled = useMemo(() => {
    return ![BiometricStatuses.NotSupported, BiometricStatuses.NotEnrolled].includes(
      biometricStatus,
    )
  }, [biometricStatus])

  const isBiometricsEnabled = useMemo(
    () => biometricStatus === BiometricStatuses.Enabled,
    [biometricStatus],
  )

  const handleChangePasscodeStatus = useCallback(() => {
    if (isPasscodeEnabled) {
      disablePasscode()

      return
    }

    setPasscodeStatus(PasscodeStatuses.NotSet)
  }, [disablePasscode, isPasscodeEnabled, setPasscodeStatus])

  const handleChangeBiometricStatus = useCallback(() => {
    if (biometricStatus === BiometricStatuses.Enabled) {
      disableBiometric()

      return
    }

    setBiometricsStatus(BiometricStatuses.NotSet)
  }, [biometricStatus, disableBiometric, setBiometricsStatus])

  return (
    <>
      <View className='flex w-full flex-col gap-4'>
        <ProfileListButton
          title={t('settings.auth-methods')}
          leadingIcon={
            <UiIcon customIcon='shieldCheckIcon' className='text-textPrimary' size={24} />
          }
          onPress={authMethodBottomSheet.present}
        />
      </View>
      <UiBottomSheet
        detached={true}
        title={t('settings.auth-method-sheet-title')}
        ref={authMethodBottomSheet.ref}
        enableDynamicSizing={false}
        snapPoints={['30%']}
      >
        <BottomSheetView
          style={{
            paddingBottom: insets.bottom + 20,
            paddingLeft: appPaddings.left,
            paddingRight: appPaddings.right,
            paddingTop: 20,
          }}
          className='gap-2'
        >
          <View className='w-full flex-row items-center gap-2 rounded-3xl border border-componentPrimary px-3 py-2'>
            <UiIcon className='color-textPrimary' customIcon='passwordIcon' />
            <Text className='typography-body2 text-textPrimary'>{t('settings.passcode')}</Text>
            <View className='flex-1' />
            <UiSwitcher
              value={isPasscodeEnabled}
              onValueChange={handleChangePasscodeStatus}
              style={{
                transform: [{ scaleX: 1.2 }, { scaleY: 1.2 }],
              }}
            />
          </View>

          {isBiometricsEnrolled && (
            <View className='w-full flex-row items-center gap-2 rounded-3xl border border-componentPrimary px-3 py-2'>
              <UiIcon
                className={!isPasscodeEnabled ? 'color-textSecondary' : 'color-textPrimary'}
                customIcon='fingerprintIcon'
              />
              <Text
                className={cn(
                  'typography-body2',
                  !isPasscodeEnabled ? 'text-textSecondary' : 'text-textPrimary',
                )}
              >
                {t('settings.biometric')}
              </Text>
              <View className='flex-1' />
              <UiSwitcher
                value={isBiometricsEnabled}
                onValueChange={handleChangeBiometricStatus}
                disabled={!isPasscodeEnabled}
                style={{
                  transform: [{ scaleX: 1.2 }, { scaleY: 1.2 }],
                }}
              />
            </View>
          )}
        </BottomSheetView>
      </UiBottomSheet>
    </>
  )
}

function AppVersionCard() {
  const { t } = useTranslation()

  return (
    <UiCard className='items-center rounded-3xl'>
      <Text className='typography-body3 text-textSecondary'>
        {t('settings.app-version', { version })}
      </Text>
    </UiCard>
  )
}

function SettingsCard() {
  return (
    <UiCard className='items-center gap-3 rounded-3xl'>
      <LocalAuthMethodCard />
      <LangCard />
      <ThemeCard />
    </UiCard>
  )
}
