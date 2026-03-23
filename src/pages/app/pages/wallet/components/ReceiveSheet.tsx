import { BottomSheetView } from '@gorhom/bottom-sheet'
import { forwardRef, useImperativeHandle } from 'react'
import { useTranslation } from 'react-i18next'
import { Text, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { truncateAddress, useEvmAddress } from '@/helpers/evm-wallet'
import { useCopyWithHaptics } from '@/hooks/copyWithHaptics'
import { useAppTheme } from '@/theme'
import { GRID_UNIT, SCREEN_PADDING_X } from '@/theme/config/spacing'
import { UiBottomSheet, UiButton, UiHorizontalDivider, useUiBottomSheet } from '@/ui'

export interface ReceiveSheetRef {
  present: () => void
}

const ReceiveSheet = forwardRef<ReceiveSheetRef>(function ReceiveSheet(_props, ref) {
  const { t } = useTranslation()
  const address = useEvmAddress()
  const { palette } = useAppTheme()
  const insets = useSafeAreaInsets()
  const { isCopied, copy } = useCopyWithHaptics()

  const bottomSheet = useUiBottomSheet()

  useImperativeHandle(
    ref,
    () => ({
      present: () => bottomSheet.present(),
    }),
    [bottomSheet],
  )

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
          paddingBottom: insets.bottom + GRID_UNIT * 4,
          paddingHorizontal: SCREEN_PADDING_X + GRID_UNIT * 2,
          paddingTop: GRID_UNIT * 2,
          gap: GRID_UNIT * 5,
          alignItems: 'center',
        }}
      >
        <Text className='typography-h6 text-textPrimary'>{t('wallet.receive')}</Text>

        <UiHorizontalDivider />

        {/* QR Code */}
        <View
          style={{
            padding: GRID_UNIT * 4,
            borderRadius: GRID_UNIT * 5,
            backgroundColor: palette.baseWhite,
          }}
        >
          <QRCode
            value={address}
            size={180}
            backgroundColor={palette.baseWhite}
            color={palette.baseBlack}
          />
        </View>

        {/* Address */}
        <Text className='typography-caption2 text-textSecondary'>
          {truncateAddress(address, 10)}
        </Text>

        <Text className='typography-caption3 text-center text-textPlaceholder'>
          {t('wallet.receive-hint')}
        </Text>

        <UiButton
          variant='outlined'
          color='primary'
          size='large'
          title={isCopied ? t('wallet.copied') : t('wallet.copy-address')}
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
