import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, RefreshControl, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { fetchAllTransactions, type TransactionRecord, useEvmAddress } from '@/helpers/evm-wallet'
import type { AppTabScreenProps } from '@/route-types'
import { cn, useAppPaddings, useBottomBarOffset } from '@/theme'
import { UiCard, UiHorizontalDivider, UiIcon, UiScreenScrollable } from '@/ui'

import AppContainer from '../../components/AppContainer'
import ActionButtons from './components/ActionButtons'
import BalanceCard, { type BalanceCardRef } from './components/BalanceCard'
import ReceiveSheet, { type ReceiveSheetRef } from './components/ReceiveSheet'
import SendSheet, { type SendSheetRef } from './components/SendSheet'
import TransactionItem from './components/TransactionItem'

export default function WalletScreen(_props: AppTabScreenProps<'Wallet'>) {
  const { t } = useTranslation()
  const address = useEvmAddress()
  const insets = useSafeAreaInsets()
  const paddings = useAppPaddings()
  const bottomOffset = useBottomBarOffset()

  const balanceRef = useRef<BalanceCardRef>(null)
  const sendSheetRef = useRef<SendSheetRef>(null)
  const receiveSheetRef = useRef<ReceiveSheetRef>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [transactions, setTransactions] = useState<TransactionRecord[]>([])
  const [txLoading, setTxLoading] = useState(false)

  const loadTransactions = useCallback(async () => {
    if (!address) return
    setTxLoading(true)
    try {
      const txs = await fetchAllTransactions(address)
      setTransactions(txs)
    } catch {
      // keep previous
    } finally {
      setTxLoading(false)
    }
  }, [address])

  // Load transactions on mount
  useEffect(() => {
    loadTransactions()
  }, [loadTransactions])

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    await Promise.all([balanceRef.current?.refresh(), loadTransactions()])
    setIsRefreshing(false)
  }, [loadTransactions])

  if (!address) {
    return (
      <AppContainer>
        <View className={cn('flex flex-1 items-center justify-center gap-4 p-8')}>
          <UiIcon
            libIcon='Ionicons'
            name='wallet-outline'
            size={48}
            className='text-textSecondary'
          />
          <Text className='typography-subtitle3 text-center text-textSecondary'>
            {t('wallet.no-wallet')}
          </Text>
          <Text className='typography-body3 text-center text-textPlaceholder'>
            {t('wallet.no-wallet-hint')}
          </Text>
        </View>
      </AppContainer>
    )
  }

  return (
    <AppContainer>
      <UiScreenScrollable
        scrollViewProps={{
          refreshControl: <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />,
          contentContainerStyle: {
            paddingHorizontal: paddings.left,
            paddingTop: insets.top + 16,
            paddingBottom: bottomOffset + 16,
            gap: 24,
          },
        }}
      >
        {/* Header */}
        <Text className='typography-h5 mb-4 text-center text-textPrimary'>{t('wallet.title')}</Text>

        {/* Balance card */}
        <BalanceCard ref={balanceRef} />

        {/* Action buttons */}
        <View style={{ paddingTop: 8 }}>
          <ActionButtons
            onSendPress={() => sendSheetRef.current?.present()}
            onReceivePress={() => receiveSheetRef.current?.present()}
          />
        </View>

        {/* Activity section */}
        <View className='gap-3'>
          <Text className='typography-subtitle3 text-textPrimary'>{t('wallet.activity')}</Text>

          {txLoading && transactions.length === 0 ? (
            <UiCard className='items-center py-10'>
              <ActivityIndicator size='small' />
            </UiCard>
          ) : transactions.length === 0 ? (
            <UiCard className='items-center gap-3 py-10'>
              <UiIcon
                libIcon='Ionicons'
                name='receipt-outline'
                size={32}
                className='text-textSecondary'
              />
              <Text className='typography-body3 text-textSecondary'>
                {t('wallet.no-transactions')}
              </Text>
            </UiCard>
          ) : (
            <UiCard className='py-1'>
              {transactions.map((tx, idx) => (
                <View key={tx.hash}>
                  <TransactionItem tx={tx} />
                  {idx < transactions.length - 1 && <UiHorizontalDivider />}
                </View>
              ))}
            </UiCard>
          )}
        </View>
      </UiScreenScrollable>

      {/* Bottom sheets */}
      <SendSheet ref={sendSheetRef} />
      <ReceiveSheet ref={receiveSheetRef} />
    </AppContainer>
  )
}
