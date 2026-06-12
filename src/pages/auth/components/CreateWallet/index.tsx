import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { isHexString } from 'ethers'
import { useCallback, useMemo } from 'react'
import type { ViewProps } from 'react-native'
import { Text, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ErrorHandler, translate } from '@/core'
import {
  AttestationNotSupportedError,
  useCopyToClipboard,
  useForm,
  useLoading,
  useWalletRegistration,
} from '@/hooks'
import type { AuthStackParamsList, AuthStackScreenProps } from '@/route-types'
import { localAuthStore, walletStore } from '@/store'
import { cn } from '@/theme'
import { UiButton, UiCard, UiHorizontalDivider, UiIcon, UiScreenScrollable } from '@/ui'
import { ControlledUiInput } from '@/ui/UiInput'

type Props = ViewProps & AuthStackScreenProps<'CreateWallet'>

export default function CreateWallet({ route }: Props) {
  const generatePrivateKey = walletStore.useGeneratePrivateKey()
  const setPrivateKey = walletStore.useWalletStore(state => state.setPrivateKey)
  const { register: registerWithSSO } = useWalletRegistration()

  const isImporting = useMemo(() => {
    return route?.params?.isImporting
  }, [route])

  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamsList>>()

  const insets = useSafeAreaInsets()

  const { isCopied, copy, fetchFromClipboard } = useCopyToClipboard()

  const { formState, isFormDisabled, handleSubmit, disableForm, enableForm, control, setValue } =
    useForm(
      {
        privateKey: '',
      },
      yup =>
        yup.object().shape({
          privateKey: yup.string().test('is-valid-pk', 'Invalid private key', value => {
            if (!isImporting) return true
            if (!value) return false
            const normalizedValue = value.startsWith('0x') ? value : `0x${value}`
            if (!isHexString(normalizedValue, 32)) return false
            return true
          }),
        }),
    )

  const setIsFirstEnter = localAuthStore.useLocalAuthStore(state => state.setIsFirstEnter)
  const disablePasscode = localAuthStore.useLocalAuthStore(state => state.disablePasscode)

  const submit = useCallback(async () => {
    disableForm()
    try {
      const privateKey = formState.privateKey.startsWith('0x')
        ? formState.privateKey.substring(2)
        : formState.privateKey
      setPrivateKey(privateKey)
      // await login(privateKey)

      setIsFirstEnter(false)

      // Skip the post-creation PIN setup prompt — the user was already offered
      // PIN/security setup earlier in the flow, so showing EnablePasscode again
      // here is a duplicate. Users can enable PIN from Settings at any time.
      disablePasscode()

      // Non-blocking background registration with the SSO service.
      // The hook reads the freshly stored key from the wallet store.
      registerWithSSO().catch(err => {
        if (err instanceof AttestationNotSupportedError) {
          navigation.navigate('DeviceNotSupported')
          return
        }
        console.warn('[CreateWallet] SSO registration error:', err)
      })
    } catch (error) {
      // TODO: network inspector
      ErrorHandler.process(error)
    }
    enableForm()
  }, [
    disableForm,
    enableForm,
    formState,
    navigation,
    setIsFirstEnter,
    setPrivateKey,
    registerWithSSO,
    disablePasscode,
  ])

  // eslint-disable-next-line unused-imports/no-unused-vars
  const pasteFromClipboard = useCallback(async () => {
    const res = await fetchFromClipboard()
    setValue('privateKey', res)
  }, [fetchFromClipboard, setValue])

  useLoading(
    false,
    async () => {
      if (isImporting) {
        return true
      }

      const pk = await generatePrivateKey()

      setValue('privateKey', pk)

      return true
    },
    {
      loadOnMount: true,
    },
  )

  return (
    <UiScreenScrollable style={{ paddingBottom: insets.bottom, paddingTop: insets.top }}>
      <KeyboardAvoidingView behavior='padding' keyboardVerticalOffset={10} style={{ flex: 1 }}>
        <View className='flex w-full flex-row'>
          <UiButton
            leadingIconProps={{
              customIcon: 'arrowLeftIcon',
            }}
            variant='text'
            onPress={() => {
              navigation.goBack()
            }}
          />
        </View>
        <View className='flex flex-1 flex-col px-screen-x'>
          <View className='flex flex-col items-center gap-5'>
            <UiIcon customIcon='keyIcon' className='size-[140px] justify-center text-primaryMain' />
            <Text className='typography-h4 text-textPrimary' style={{ lineHeight: 52 }}>
              {translate('auth.create-wallet.title')}
            </Text>
          </View>
          {isImporting ? (
            <View className='flex flex-1 flex-col items-center justify-center gap-4'>
              <View>
                <UiCard className='mt-5 w-full bg-warningLight'>
                  <View
                    style={{
                      width: '100%',
                      flexDirection: 'row-reverse',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <UiIcon customIcon='infoIcon' className='color-warningMain' />
                    <Text
                      className='typography-body4 text-warningMain'
                      style={{ flex: 1, textAlign: 'left' }}
                    >
                      {translate('auth.sign-in.tip')}
                    </Text>
                  </View>
                </UiCard>
              </View>
              <ControlledUiInput
                name='privateKey'
                placeholder={translate('auth.create-wallet.private-key-ph')}
                control={control}
                disabled={isFormDisabled}
                multiline
                style={{ height: 80, textAlignVertical: 'top' }}
              />
            </View>
          ) : (
            <View className='flex flex-1 flex-col items-center justify-center gap-4'>
              <UiCard className={cn('mt-5 flex gap-4')}>
                <>
                  <UiCard className='bg-backgroundPrimary'>
                    <Text className='typography-body3 text-textPrimary'>
                      {formState.privateKey}
                    </Text>
                  </UiCard>
                  <UiButton
                    variant='text'
                    color='text'
                    leadingIconProps={{
                      customIcon: isCopied ? 'checkIcon' : 'copySimpleIcon',
                    }}
                    title={translate('auth.create-wallet.copy-btn')}
                    onPress={() => copy(formState.privateKey)}
                  />
                </>
              </UiCard>
              <UiCard className='mt-5 w-full bg-warningLight'>
                <View
                  style={{
                    width: '100%',
                    flexDirection: 'row-reverse',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <UiIcon customIcon='infoIcon' className='color-warningMain' />
                  <Text
                    className='typography-body4 text-warningMain'
                    style={{ flex: 1, textAlign: 'left' }}
                  >
                    {translate('auth.sign-up.tip')}
                  </Text>
                </View>
              </UiCard>
              {/*
                M5 #5 — Phase-1 wallet-loss warning.
                Per docs/SSO/plan.txt §"ACCOUNT RECOVERY MODEL": a freshly
                created wallet that has NOT yet bound a nullifier (i.e. the
                user has not scanned their ID and obtained a Jomhoor SSO
                assertion) cannot be recovered. Recovery (M5 #3) only
                migrates assertions/pairwise subjects bound to a prior
                wallet via the same nullifier_hash — Phase 1 has no such
                anchor. Make this explicit before the user finishes
                creating the wallet.
              */}
              <UiCard className='mt-3 w-full bg-errorLight'>
                <View
                  style={{
                    width: '100%',
                    flexDirection: 'row-reverse',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <UiIcon customIcon='infoIcon' className='color-errorMain' />
                  <Text
                    className='typography-body4 text-errorMain'
                    style={{ flex: 1, textAlign: 'left' }}
                  >
                    {translate('auth.sign-up.wallet-loss-warning')}
                  </Text>
                </View>
              </UiCard>
            </View>
          )}
        </View>
        <View className='px-screen-x py-gutter'>
          <UiHorizontalDivider />
        </View>
        <View className='flex w-full flex-row px-screen-x'>
          <UiButton
            title={
              isImporting
                ? translate('auth.create-wallet.import-btn')
                : translate('auth.create-wallet.create-btn')
            }
            className='mb-5 mt-auto w-full'
            onPress={handleSubmit(submit)}
            disabled={isFormDisabled}
          />
        </View>
      </KeyboardAvoidingView>
    </UiScreenScrollable>
  )
}
