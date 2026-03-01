import { BottomSheetTextInput, BottomSheetView } from '@gorhom/bottom-sheet'
import { parseEther, Wallet } from 'ethers'
import { useState } from 'react'
import { Alert, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { getRmoProvider, useEvmWallet } from '@/helpers/evm-wallet'
import { useAppTheme } from '@/theme'
import { UiBottomSheet, UiButton, useUiBottomSheet } from '@/ui'

export default function SendSheet() {
  const wallet = useEvmWallet()
  const { palette } = useAppTheme()
  const insets = useSafeAreaInsets()

  const bottomSheet = useUiBottomSheet()

  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [isSending, setIsSending] = useState(false)

  const handleSend = async () => {
    if (!wallet || !recipient || !amount) return

    try {
      setIsSending(true)

      const provider = getRmoProvider()
      const connectedWallet = new Wallet(wallet.privateKey, provider)

      const tx = await connectedWallet.sendTransaction({
        to: recipient.trim(),
        value: parseEther(amount.trim()),
      })

      await tx.wait()

      Alert.alert('Success', `Transaction sent!\n${tx.hash}`)
      setRecipient('')
      setAmount('')
      bottomSheet.dismiss()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      Alert.alert('Send Failed', message)
    } finally {
      setIsSending(false)
    }
  }

  const isValid =
    recipient.length === 42 &&
    recipient.startsWith('0x') &&
    parseFloat(amount) > 0

  return (
    <>
      <UiButton
        variant='filled'
        color='primary'
        size='large'
        title='Send'
        leadingIconProps={{ libIcon: 'Ionicons', name: 'arrow-up-circle', size: 20 }}
        onPress={() => bottomSheet.present()}
      />

      <UiBottomSheet
        ref={bottomSheet.ref}
        backgroundStyle={{ backgroundColor: palette.backgroundContainer }}
        enableDynamicSizing={false}
        snapPoints={['55%']}
      >
        <BottomSheetView style={{ paddingBottom: insets.bottom, padding: 20, gap: 16 }}>
          <Text
            style={{
              fontSize: 20,
              fontWeight: '700',
              color: palette.textPrimary,
            }}
          >
            Send RMO
          </Text>

          <View style={{ gap: 8 }}>
            <Text style={{ color: palette.textSecondary, fontSize: 14 }}>Recipient Address</Text>
            <BottomSheetTextInput
              placeholder='0x...'
              placeholderTextColor={palette.textSecondary}
              value={recipient}
              onChangeText={setRecipient}
              autoCapitalize='none'
              autoCorrect={false}
              style={{
                borderWidth: 1,
                borderColor: palette.textSecondary,
                borderRadius: 12,
                padding: 12,
                fontSize: 14,
                color: palette.textPrimary,
                fontFamily: 'monospace',
              }}
            />
          </View>

          <View style={{ gap: 8 }}>
            <Text style={{ color: palette.textSecondary, fontSize: 14 }}>Amount (RMO)</Text>
            <BottomSheetTextInput
              placeholder='0.0'
              placeholderTextColor={palette.textSecondary}
              value={amount}
              onChangeText={setAmount}
              keyboardType='decimal-pad'
              style={{
                borderWidth: 1,
                borderColor: palette.textSecondary,
                borderRadius: 12,
                padding: 12,
                fontSize: 14,
                color: palette.textPrimary,
              }}
            />
          </View>

          <UiButton
            variant='filled'
            color='primary'
            size='large'
            title={isSending ? 'Sending...' : 'Confirm Send'}
            onPress={handleSend}
            disabled={!isValid || isSending}
          />
        </BottomSheetView>
      </UiBottomSheet>
    </>
  )
}
