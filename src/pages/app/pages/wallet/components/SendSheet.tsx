import { BottomSheetTextInput, BottomSheetView } from '@gorhom/bottom-sheet'
import { parseEther, Wallet } from 'ethers'
import { forwardRef, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { type ChainInfo, getProvider, useEvmWallet, WALLET_CHAINS } from '@/helpers/evm-wallet'
import { useAppTheme } from '@/theme'
import { UiBottomSheet, UiButton, UiHorizontalDivider, UiIcon, useUiBottomSheet } from '@/ui'

export interface SendSheetRef {
  present: () => void
}

const SendSheet = forwardRef<SendSheetRef>(function SendSheet(_props, ref) {
  const { t } = useTranslation()
  const wallet = useEvmWallet()
  const { palette } = useAppTheme()
  const insets = useSafeAreaInsets()

  const bottomSheet = useUiBottomSheet()

  const [selectedChain, setSelectedChain] = useState<ChainInfo>(WALLET_CHAINS[0])
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [isSending, setIsSending] = useState(false)

  useImperativeHandle(
    ref,
    () => ({
      present: () => bottomSheet.present(),
    }),
    [bottomSheet],
  )

  const handleSend = async () => {
    if (!wallet || !recipient || !amount) return

    try {
      setIsSending(true)

      const provider = getProvider(selectedChain)
      const connectedWallet = new Wallet(wallet.privateKey, provider)

      const tx = await connectedWallet.sendTransaction({
        to: recipient.trim(),
        value: parseEther(amount.trim()),
      })

      await tx.wait()

      Alert.alert(
        t('wallet.success'),
        t('wallet.send-success', { network: selectedChain.name, hash: tx.hash }),
      )
      setRecipient('')
      setAmount('')
      bottomSheet.dismiss()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      Alert.alert(t('wallet.send-failed'), message)
    } finally {
      setIsSending(false)
    }
  }

  const isValid = recipient.length === 42 && recipient.startsWith('0x') && parseFloat(amount) > 0

  return (
    <UiBottomSheet
      ref={bottomSheet.ref}
      backgroundStyle={{ backgroundColor: palette.backgroundContainer }}
      enableDynamicSizing={false}
      snapPoints={['65%']}
    >
      <BottomSheetView
        style={{ paddingBottom: insets.bottom + 16, paddingHorizontal: 24, paddingTop: 8, gap: 20 }}
      >
        <Text className='typography-h6 text-textPrimary'>
          {t('wallet.send-symbol', { symbol: selectedChain.symbol })}
        </Text>

        <UiHorizontalDivider />

        {/* Chain selector */}
        <View style={{ gap: 6 }}>
          <Text className='typography-caption1 text-textSecondary'>{t('wallet.network')}</Text>
          <View className='flex flex-row gap-2'>
            {WALLET_CHAINS.map(chain => {
              const isActive = chain.id === selectedChain.id
              return (
                <Pressable
                  key={chain.id}
                  onPress={() => setSelectedChain(chain)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 14,
                    borderWidth: 1.5,
                    borderColor: isActive ? palette.primaryMain : palette.componentPrimary,
                    backgroundColor: isActive ? palette.primaryLight : 'transparent',
                  }}
                >
                  <UiIcon
                    libIcon='Ionicons'
                    name={chain.icon}
                    size={16}
                    className={isActive ? 'text-primaryMain' : 'text-textSecondary'}
                  />
                  <Text
                    className={
                      isActive
                        ? 'typography-caption1 text-primaryMain'
                        : 'typography-caption1 text-textSecondary'
                    }
                  >
                    {chain.symbol}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </View>

        <View style={{ gap: 6 }}>
          <Text className='typography-caption1 text-textSecondary'>
            {t('wallet.recipient-address')}
          </Text>
          <BottomSheetTextInput
            placeholder='0x...'
            placeholderTextColor={palette.textPlaceholder}
            value={recipient}
            onChangeText={setRecipient}
            autoCapitalize='none'
            autoCorrect={false}
            style={{
              borderWidth: 1,
              borderColor:
                recipient && !recipient.startsWith('0x')
                  ? palette.errorMain
                  : palette.componentPrimary,
              borderRadius: 16,
              paddingHorizontal: 16,
              paddingVertical: 14,
              fontSize: 14,
              color: palette.textPrimary,
              fontFamily: 'Parastoo',
              backgroundColor: palette.backgroundPrimary,
            }}
          />
        </View>

        <View style={{ gap: 6 }}>
          <Text className='typography-caption1 text-textSecondary'>
            {t('wallet.amount', { symbol: selectedChain.symbol })}
          </Text>
          <BottomSheetTextInput
            placeholder='0.00'
            placeholderTextColor={palette.textPlaceholder}
            value={amount}
            onChangeText={setAmount}
            keyboardType='decimal-pad'
            style={{
              borderWidth: 1,
              borderColor: palette.componentPrimary,
              borderRadius: 16,
              paddingHorizontal: 16,
              paddingVertical: 14,
              fontSize: 14,
              color: palette.textPrimary,
              fontFamily: 'Parastoo',
              backgroundColor: palette.backgroundPrimary,
            }}
          />
        </View>

        <UiButton
          variant='filled'
          color='primary'
          size='large'
          title={
            isSending
              ? t('wallet.sending')
              : t('wallet.send-symbol', { symbol: selectedChain.symbol })
          }
          onPress={handleSend}
          disabled={!isValid || isSending}
        />
      </BottomSheetView>
    </UiBottomSheet>
  )
})

export default SendSheet
