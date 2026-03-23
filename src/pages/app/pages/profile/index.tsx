import { identicon } from '@dicebear/collection'
import { createAvatar } from '@dicebear/core'
import { BottomSheetView } from '@gorhom/bottom-sheet'
import WheelPicker from '@quidone/react-native-wheel-picker'
import * as Haptics from 'expo-haptics'
import { version } from 'package.json'
import { ReactNode, useCallback, useMemo, useState } from 'react'
import { Text, TouchableOpacity, useColorScheme, View } from 'react-native'
import { TouchableOpacityProps } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { SvgXml } from 'react-native-svg'

import { useSelectedLanguage } from '@/core'
import { type Language, resources } from '@/core/localization/resources'
import { useCopyToClipboard } from '@/hooks'
import { AppTabScreenProps } from '@/route-types'
import {
  authStore,
  BiometricStatuses,
  localAuthStore,
  PasscodeStatuses,
  walletStore,
} from '@/store'
import {
  cn,
  ColorSchemeType,
  useAppPaddings,
  useAppTheme,
  useBottomBarOffset,
  useSelectedTheme,
} from '@/theme'
import {
  UiBottomSheet,
  UiButton,
  UiCard,
  UiHorizontalDivider,
  UiIcon,
  UiScreenScrollable,
  UiSwitcher,
  useUiBottomSheet,
} from '@/ui'

import AppContainer from '../../components/AppContainer'

function ProfileButton({
  leadingIcon,
  trailingIcon,

  title,
  trailingContent,

  className,
  ...rest
}: {
  leadingIcon: ReactNode
  trailingIcon?: ReactNode
  title: string
  trailingContent?: ReactNode
} & Omit<TouchableOpacityProps, 'children'>) {
  return (
    <TouchableOpacity
      {...rest}
      className={cn('flex w-full flex-row items-center gap-2 py-2', className)}
    >
      <View className='flex aspect-square size-8 items-center justify-center rounded-full bg-componentPrimary'>
        {leadingIcon}
      </View>

      <Text className={cn('typography-buttonMedium mr-auto text-textPrimary')}>{title}</Text>

      {trailingContent}

      {trailingIcon || (
        <UiIcon
          libIcon='FontAwesome'
          name='chevron-right'
          className='ml-2 text-textSecondary'
          size={3 * 4}
        />
      )}
    </TouchableOpacity>
  )
}

export default function ProfileScreen({}: AppTabScreenProps<'Profile'>) {
  const insets = useSafeAreaInsets()
  const appPaddings = useAppPaddings()
  const offset = useBottomBarOffset()

  return (
    <AppContainer>
      <UiScreenScrollable
        style={{
          paddingTop: insets.top,
          paddingLeft: appPaddings.left,
          paddingRight: appPaddings.right,
          paddingBottom: offset,
        }}
      >
        <View className='flex flex-1 flex-col gap-4'>
          <ProfileCard />
          <SettingsCard />
          <UiCard className='flex gap-4'>
            <AdvancedCard />
          </UiCard>
          <AppVersionCard />
        </View>
      </UiScreenScrollable>
    </AppContainer>
  )
}
function AdvancedCard() {
  const privateKey = walletStore.useWalletStore(state => state.privateKey)
  const logout = authStore.useLogout()
  const { isCopied, copy } = useCopyToClipboard()
  const appPaddings = useAppPaddings()
  const bottomSheet = useUiBottomSheet()
  return (
    <>
      <View className='flex w-full flex-col gap-4'>
        <ProfileButton
          leadingIcon={
            <UiIcon libIcon='Entypo' name='cog' className='text-textPrimary' size={5 * 4} />
          }
          title='Advanced'
          onPress={bottomSheet.present}
        />
      </View>
      <UiBottomSheet
        title='Advanced'
        ref={bottomSheet.ref}
        detached
        enableDynamicSizing={false}
        snapPoints={['30%']}
        headerComponent={
          <>
            <UiHorizontalDivider className='mx-auto my-4 mb-0 h-3 w-14 rounded-full' />
          </>
        }
      >
        <BottomSheetView
          className='mt-3 flex size-full gap-2 pb-6'
          style={{
            paddingLeft: appPaddings.left,
            paddingRight: appPaddings.right,
          }}
        >
          <View className={cn('flex size-full flex-1 gap-2')}>
            <Text className='typography-caption2 ml-4 font-semibold text-textPrimary'>
              Private key
            </Text>
            <UiCard className='flex-row bg-backgroundPrimary py-6'>
              <Text className='typography-body3 line-clamp-1 w-9/12 truncate whitespace-nowrap text-textPrimary'>
                {privateKey}
              </Text>

              <TouchableOpacity className='ml-auto'>
                <UiIcon
                  customIcon={isCopied ? 'checkIcon' : 'copySimpleIcon'}
                  className='text-textSecondary'
                  size={5 * 4}
                  onPress={() => copy(privateKey)}
                />
              </TouchableOpacity>
            </UiCard>

            <ProfileButton
              className='mt-auto rounded-full bg-componentPrimary p-3 px-4'
              leadingIcon={
                <UiIcon
                  libIcon='MaterialCommunityIcons'
                  name='logout'
                  className='text-errorMain'
                  size={4 * 4}
                />
              }
              trailingIcon={<></>}
              title='Log out'
              onPress={logout}
            />
          </View>
        </BottomSheetView>
      </UiBottomSheet>
    </>
  )
}
function ProfileCard() {
  const publicKeyHash = walletStore.usePublicKeyHash().toString()

  const avatar = createAvatar(identicon, {
    seed: publicKeyHash,
  }).toString()

  return (
    <>
      <View className='w-full items-center justify-center'>
        <View className='size-[85px] items-center overflow-hidden rounded-full bg-componentPrimary'>
          <SvgXml height={80} width={80} xml={avatar} />
        </View>

        <Text className='typography-body1 mt-2 text-center text-textPrimary'>Stranger</Text>
      </View>
    </>
  )
}

function LangCard() {
  // TODO: reload app after change language
  const { language, setLanguage } = useSelectedLanguage()
  const languageBottomSheet = useUiBottomSheet()
  const appPaddings = useAppPaddings()
  const [value, setValue] = useState<string>(language)
  const { palette } = useAppTheme()
  return (
    <>
      <View className='flex w-full flex-col gap-4'>
        <ProfileButton
          title='Language'
          leadingIcon={<UiIcon customIcon='earthLineIcon' className='text-textPrimary' size={24} />}
          onPress={languageBottomSheet.present}
          trailingContent={<Text className='typography-body2 text-textSecondary'>{language}</Text>}
        />
      </View>
      <UiBottomSheet
        title='Select Theme'
        ref={languageBottomSheet.ref}
        detached={true}
        enableDynamicSizing={false}
        snapPoints={['25%']}
        enableContentPanningGesture={false}
        headerComponent={
          <View className='flex-row items-center justify-center py-0'>
            <UiButton variant='text' title='Cancel' onPress={languageBottomSheet.dismiss} />
            <UiHorizontalDivider className='mx-auto h-3 w-14 rounded-full' />
            <UiButton
              variant='text'
              title='Submit'
              onPress={() => {
                setLanguage(value as Language)
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
  const appPaddings = useAppPaddings()

  const bottomSheet = useUiBottomSheet()

  const { selectedTheme, setSelectedTheme } = useSelectedTheme()
  const colorSchemeName = useColorScheme()

  return (
    <>
      <ProfileButton
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
        title='Theme'
        trailingContent={
          <Text className='typography-body4 capitalize text-textSecondary'>{selectedTheme}</Text>
        }
        onPress={bottomSheet.present}
      />

      <UiBottomSheet
        title='Select Theme'
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
        <ProfileButton
          title='Auth methods'
          leadingIcon={
            <UiIcon customIcon='shieldCheckIcon' className='text-textPrimary' size={24} />
          }
          onPress={authMethodBottomSheet.present}
        />
      </View>
      <UiBottomSheet
        detached={true}
        title='Auth Method'
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
            <Text className='typography-body2 text-textPrimary'>Passcode</Text>
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
                Biometric
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
  return (
    <UiCard className='items-center rounded-3xl'>
      <Text className='typography-body3 text-textSecondary'>App Version: {version} </Text>
    </UiCard>
  )
}

function SettingsCard() {
  return (
    <UiCard className='items-center gap-3 rounded-3xl'>
      <Text className='typography-body2 text-textPrimary'>Settings</Text>
      <LocalAuthMethodCard />
      <LangCard />
      <ThemeCard />
    </UiCard>
  )
}
