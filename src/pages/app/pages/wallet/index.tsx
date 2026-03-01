import { Text, View } from 'react-native'

import { useEvmAddress } from '@/helpers/evm-wallet'
import type { AppTabScreenProps } from '@/route-types'
import { cn, useAppPaddings, useBottomBarOffset } from '@/theme'
import { UiScreenScrollable } from '@/ui'

import AppContainer from '../../components/AppContainer'
import AddressDisplay from './components/AddressDisplay'
import BalanceCard from './components/BalanceCard'
import SendSheet from './components/SendSheet'

/* eslint-disable-next-line unused-imports/no-unused-vars */
export default function WalletScreen(_props: AppTabScreenProps<'Wallet'>) {
  const address = useEvmAddress()
  const paddings = useAppPaddings()
  const bottomOffset = useBottomBarOffset()

  if (!address) {
    return (
      <AppContainer>
        <View className={cn('flex flex-1 items-center justify-center p-8')}>
          <Text className='text-textSecondary text-center text-base'>
            No wallet available. Create a profile first to generate your wallet.
          </Text>
        </View>
      </AppContainer>
    )
  }

  return (
    <AppContainer>
      <UiScreenScrollable
        scrollViewProps={{
          contentContainerStyle: {
            paddingHorizontal: paddings.left,
            paddingTop: 24,
            paddingBottom: bottomOffset + 16,
            gap: 16,
          },
        }}
      >
        <Text className='text-textPrimary text-2xl font-bold'>Wallet</Text>

        <BalanceCard />

        <AddressDisplay />

        <View style={{ paddingHorizontal: 16 }}>
          <SendSheet />
        </View>
      </UiScreenScrollable>
    </AppContainer>
  )
}
