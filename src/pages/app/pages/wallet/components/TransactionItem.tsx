import { Text, View } from 'react-native'

import type { TransactionRecord } from '@/helpers/evm-wallet'
import { truncateAddress, WALLET_CHAINS } from '@/helpers/evm-wallet'
import { UiIcon } from '@/ui'

function formatTimestamp(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  const diffHr = Math.floor(diffMs / 3_600_000)
  const diffDay = Math.floor(diffMs / 86_400_000)

  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay < 7) return `${diffDay}d ago`

  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface Props {
  tx: TransactionRecord
}

export default function TransactionItem({ tx }: Props) {
  const isReceived = tx.direction === 'received'
  const chain = WALLET_CHAINS.find(c => c.id === tx.chainId)
  const amt = parseFloat(tx.value)
  const displayAmt = amt < 0.0001 ? '< 0.0001' : amt.toFixed(4)
  const counterparty = isReceived ? tx.from : tx.to

  return (
    <View className='flex flex-row items-center justify-between px-2 py-3'>
      {/* Left: direction icon + details */}
      <View className='flex flex-row items-center gap-3'>
        <View
          className='flex size-9 items-center justify-center rounded-full'
          style={{ backgroundColor: isReceived ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)' }}
        >
          <UiIcon
            libIcon='Ionicons'
            name={isReceived ? 'arrow-down' : 'arrow-up'}
            size={18}
            className={isReceived ? 'text-successMain' : 'text-errorMain'}
          />
        </View>
        <View className='gap-0.5'>
          <Text className='typography-subtitle4 text-textPrimary'>
            {isReceived ? 'Received' : 'Sent'}
          </Text>
          <Text className='typography-caption3 text-textSecondary'>
            {counterparty ? truncateAddress(counterparty, 4) : '—'}
            {chain ? ` · ${chain.name}` : ''}
          </Text>
        </View>
      </View>

      {/* Right: amount + time */}
      <View className='items-end gap-0.5'>
        <Text
          className={`typography-subtitle4 ${isReceived ? 'text-successMain' : 'text-textPrimary'}`}
        >
          {isReceived ? '+' : '-'}
          {displayAmt} {chain?.symbol ?? ''}
        </Text>
        <Text className='typography-caption3 text-textSecondary'>
          {formatTimestamp(tx.timestamp)}
        </Text>
      </View>
    </View>
  )
}
