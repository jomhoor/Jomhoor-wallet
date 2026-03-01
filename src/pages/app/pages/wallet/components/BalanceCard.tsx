import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import {
  fetchAllBalances,
  type TokenBalance,
  truncateAddress,
  useEvmAddress,
  WALLET_CHAINS,
} from '@/helpers/evm-wallet'
import { useCopyWithHaptics } from '@/hooks/copyWithHaptics'
import { cn } from '@/theme'
import { UiCard, UiHorizontalDivider, UiIcon } from '@/ui'

export interface BalanceCardRef {
  refresh: () => Promise<void>
}

const BalanceCard = forwardRef<BalanceCardRef>(function BalanceCard(_props, ref) {
  const address = useEvmAddress()
  const { isCopied, copy } = useCopyWithHaptics()
  const [balances, setBalances] = useState<TokenBalance[]>(
    WALLET_CHAINS.map(chain => ({ chain, balance: null })),
  )
  const [isLoading, setIsLoading] = useState(false)

  const loadBalances = useCallback(async () => {
    if (!address) return
    setIsLoading(true)
    try {
      const result = await fetchAllBalances(address)
      setBalances(result)
    } catch {
      // keep previous balances
    } finally {
      setIsLoading(false)
    }
  }, [address])

  useImperativeHandle(ref, () => ({ refresh: loadBalances }), [loadBalances])

  useEffect(() => {
    loadBalances()
  }, [loadBalances])

  if (!address) return null

  return (
    <UiCard className={cn('flex flex-col gap-4 pb-5 pt-6')}>
      {/* Address header */}
      <View className='flex flex-col items-center gap-3'>
        <Pressable
          onPress={() => copy(address)}
          className='flex flex-row items-center gap-2 rounded-full bg-componentPrimary px-4 py-2'
        >
          <Text className='typography-caption2 text-textSecondary'>
            {truncateAddress(address, 8)}
          </Text>
          <UiIcon
            libIcon='Ionicons'
            name={isCopied ? 'checkmark-circle' : 'copy-outline'}
            size={14}
            className={isCopied ? 'text-successMain' : 'text-textSecondary'}
          />
        </Pressable>
      </View>

      <UiHorizontalDivider />

      {/* Token rows */}
      <View className='flex flex-col gap-1'>
        {balances.map((item, idx) => {
          const amt = item.balance ? parseFloat(item.balance) : 0
          const display = item.balance ? amt.toFixed(4) : '—'

          return (
            <View key={item.chain.id}>
              <View className='flex flex-row items-center justify-between px-2 py-3'>
                {/* Left: icon + name */}
                <View className='flex flex-row items-center gap-3'>
                  <View className='flex size-9 items-center justify-center rounded-full bg-componentPrimary'>
                    <UiIcon
                      libIcon='Ionicons'
                      name={item.chain.icon}
                      size={18}
                      className='text-textPrimary'
                    />
                  </View>
                  <View>
                    <Text className='typography-subtitle4 text-textPrimary'>
                      {item.chain.symbol}
                    </Text>
                    <Text className='typography-caption3 text-textSecondary'>
                      {item.chain.name}
                    </Text>
                  </View>
                </View>

                {/* Right: balance */}
                <Text className='typography-subtitle3 text-textPrimary'>
                  {isLoading ? '···' : display}
                </Text>
              </View>

              {idx < balances.length - 1 && <UiHorizontalDivider />}
            </View>
          )
        })}
      </View>
    </UiCard>
  )
})

export default BalanceCard
