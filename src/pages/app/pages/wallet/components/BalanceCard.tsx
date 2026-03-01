import { useCallback, useEffect, useState } from 'react'
import { Text, View } from 'react-native'

import { fetchBalance, truncateAddress, useEvmAddress } from '@/helpers/evm-wallet'
import { useCopyWithHaptics } from '@/hooks/copyWithHaptics'
import { cn } from '@/theme'
import { UiButton, UiCard } from '@/ui'

export default function BalanceCard() {
  const address = useEvmAddress()
  const { isCopied, copy } = useCopyWithHaptics()
  const [balance, setBalance] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const loadBalance = useCallback(async () => {
    if (!address) return
    setIsLoading(true)
    try {
      const bal = await fetchBalance(address)
      setBalance(bal)
    } catch {
      setBalance(null)
    } finally {
      setIsLoading(false)
    }
  }, [address])

  useEffect(() => {
    loadBalance()
  }, [loadBalance])

  if (!address) return null

  const displayBalance = balance ? `${parseFloat(balance).toFixed(4)} RMO` : '—'

  return (
    <UiCard className={cn('flex flex-col gap-4 p-5')}>
      {/* Balance */}
      <View className='flex flex-col items-center gap-1'>
        <Text className='text-textSecondary text-sm'>Balance</Text>
        <Text className='text-textPrimary text-3xl font-bold'>
          {isLoading ? '...' : displayBalance}
        </Text>
      </View>

      {/* Address */}
      <View className='flex flex-row items-center justify-center gap-2'>
        <Text className='text-textSecondary text-sm font-mono'>
          {truncateAddress(address)}
        </Text>
        <UiButton
          variant='text'
          size='small'
          leadingIconProps={{
            libIcon: 'Ionicons',
            name: isCopied ? 'checkmark' : 'copy-outline',
            size: 16,
          }}
          onPress={() => copy(address)}
        />
      </View>

      {/* Refresh */}
      <View className='flex items-center'>
        <UiButton
          variant='text'
          size='small'
          title='Refresh'
          leadingIconProps={{
            libIcon: 'Ionicons',
            name: 'refresh',
            size: 16,
          }}
          onPress={loadBalance}
          disabled={isLoading}
        />
      </View>
    </UiCard>
  )
}
