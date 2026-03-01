import { BottomSheetView } from '@gorhom/bottom-sheet'
import { forwardRef, useImperativeHandle } from 'react'
import { Text, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { truncateAddress, useEvmAddress } from '@/helpers/evm-wallet'
import { useCopyWithHaptics } from '@/hooks/copyWithHaptics'
import { useAppTheme } from '@/theme'
import { UiBottomSheet, UiButton, UiHorizontalDivider, useUiBottomSheet } from '@/ui'

export interface ReceiveSheetRef {
  present: () => void
}

const ReceiveSheet = forwardRef<ReceiveSheetRef>(function ReceiveSheet(_props, ref) {
  const address = useEvmAddress()
  const { palette } = useAppTheme()
  const insets = useSafeAreaInsets()
  const { isCopied, copy } = useCopyWithHaptics()

  const bottomSheet = useUiBottomSheet()

  useImperativeHandle(ref, () => ({
    present: () => bottomSheet.present(),
  }), [bottomSheet])

  if (!address) return null

  return (
    <UiBottomSheet
      ref={bottomSheet.ref}
      backgroundStyle={{ backgroundColor: palette.backgroundContainer }}
      enableDynamicSizing={false}
      snapPoints={['70%']}
    >
      <BottomSheetView
        style={{
          paddingBottom: insets.bottom + 16,
          paddingHorizontal: 24,
          paddingTop: 8,
          gap: 20,
          alignItems: 'center',
        }}
      >
        <Text className='typography-h6 text-textPrimary'>Receive</Text>

        <UiHorizontalDivider />

        {/* QR Code */}
        <View
          style={{
            padding: 16,
            borderRadius: 20,
            backgroundColor: '#FFFFFF',
          }}
        >
          <QRCode
            value={address}
            size={180}
            backgroundColor='#FFFFFF'
            color='#000000'
          />
        </View>

        {/* Address */}
        <Text className='typography-caption2 text-textSecondary'>
          {truncateAddress(address, 10)}
        </Text>

        <Text className='typography-caption3 text-center text-textPlaceholder'>
          Send only EVM-compatible tokens to this address
        </Text>

        <UiButton
          variant='outlined'
          color='primary'
          size='large'
          title={isCopied ? 'Copied!' : 'Copy Address'}
          leadingIconProps={{
            libIcon: 'Ionicons',
            name: isCopied ? 'checkmark-circle' : 'copy-outline',
            size: 18,
          }}
          onPress={() => copy(address)}
        />
      </BottomSheetView>
    </UiBottomSheet>
  )
})

export default ReceiveSheet
