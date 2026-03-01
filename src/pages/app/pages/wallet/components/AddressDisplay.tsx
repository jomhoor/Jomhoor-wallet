import { Text, View } from 'react-native'

import { truncateAddress, useEvmAddress } from '@/helpers/evm-wallet'
import { useCopyWithHaptics } from '@/hooks/copyWithHaptics'
import { cn } from '@/theme'
import { UiButton, UiCard } from '@/ui'

export default function AddressDisplay() {
  const address = useEvmAddress()
  const { isCopied, copy } = useCopyWithHaptics()

  if (!address) return null

  return (
    <UiCard className={cn('flex flex-col gap-3 p-5')}>
      <Text className='text-textSecondary text-sm'>Wallet Address</Text>

      <View className='flex flex-col gap-2'>
        <Text
          className='text-textPrimary text-base font-mono'
          selectable
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {address}
        </Text>

        <UiButton
          variant='outlined'
          size='medium'
          title={isCopied ? 'Copied!' : 'Copy Address'}
          leadingIconProps={{
            libIcon: 'Ionicons',
            name: isCopied ? 'checkmark-circle' : 'copy-outline',
            size: 18,
          }}
          onPress={() => copy(address)}
        />
      </View>

      <Text className='text-textSecondary text-xs'>
        Rarimo L2 — {truncateAddress(address, 4)}
      </Text>
    </UiCard>
  )
}
