import { useNavigation } from '@react-navigation/native'
import { isHexString } from 'ethers'
import { useCallback, useMemo } from 'react'
import type { ViewProps } from 'react-native'
import { Text, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ErrorHandler, translate } from '@/core'
import { useCopyToClipboard, useForm, useLoading } from '@/hooks'
import type { AuthStackScreenProps } from '@/route-types'
import { localAuthStore, walletStore } from '@/store'
import { cn } from '@/theme'
import { UiButton, UiCard, UiHorizontalDivider, UiIcon, UiScreenScrollable } from '@/ui'
import { ControlledUiInput } from '@/ui/UiInput'

type Props = ViewProps & AuthStackScreenProps<'CreateWallet'>

export default function CreateWallet({ route }: Props) {
  const generatePrivateKey = walletStore.useGeneratePrivateKey()
  const setPrivateKey = walletStore.useWalletStore(state => state.setPrivateKey)

  const isImporting = useMemo(() => {
    return route?.params?.isImporting
  }, [route])

  const navigation = useNavigation()

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

  const submit = useCallback(async () => {
    disableForm()
    try {
      const privateKey = formState.privateKey.startsWith('0x')
        ? formState.privateKey.substring(2)
        : formState.privateKey
      setPrivateKey(privateKey)
      // await login(privateKey)

      setIsFirstEnter(false)
    } catch (error) {
      // TODO: network inspector
      ErrorHandler.process(error)
    }
    enableForm()
  }, [disableForm, enableForm, formState, setIsFirstEnter, setPrivateKey])

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
            <UiIcon customIcon='keyIcon' className='size-[200px] justify-center text-primaryMain' />
            <Text className='typography-h4 text-textPrimary'>Your key</Text>
          </View>
          {isImporting ? (
            <View className='flex flex-1 flex-col items-center justify-center gap-4'>
              <View>
                <UiCard className='mt-5 flex w-full flex-row items-center justify-between gap-3 bg-warningLight'>
                  <UiIcon customIcon='infoIcon' className='color-warningMain' />
                  <Text className='typography-body4 flex-1 text-warningMain'>
                    {translate('auth.sign-in.tip')}
                  </Text>
                </UiCard>
              </View>
              <ControlledUiInput
                name='privateKey'
                placeholder='Your private key'
                control={control}
                disabled={isFormDisabled}
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
                    title='Copy to Clipboard'
                    onPress={() => copy(formState.privateKey)}
                  />
                </>
              </UiCard>
              <UiCard className='mt-5 flex w-full flex-row items-center justify-between gap-3 bg-warningLight'>
                <UiIcon customIcon='infoIcon' className='color-warningMain' />
                <Text className='typography-body4 flex-1 text-warningMain'>
                  {translate('auth.sign-up.tip')}
                </Text>
              </UiCard>
            </View>
          )}
        </View>
        <View className='px-screen-x py-gutter'>
          <UiHorizontalDivider />
        </View>
        <View className='flex w-full flex-row px-screen-x'>
          <UiButton
            title={isImporting ? 'Import Key' : 'Create Key'}
            className='mb-5 mt-auto w-full'
            onPress={handleSubmit(submit)}
            disabled={isFormDisabled}
          />
        </View>
      </KeyboardAvoidingView>
    </UiScreenScrollable>
  )
}
