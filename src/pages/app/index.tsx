import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useLayoutEffect } from 'react'

import { useAgoraDeepLink } from '@/hooks/useAgoraDeepLink'
import InviteOthers from '@/pages/app/pages/invite-others'
import type { AppStackParamsList, RootStackScreenProps } from '@/route-types'
import { authStore } from '@/store'
import { localAuthStore } from '@/store/modules/local-auth'

import CompassScreen from './pages/compass'
import DocumentScanScreen from './pages/document-scan'
import DocumentsScreen from './pages/documents'
import HomeScreen from './pages/home'
import HubScreen from './pages/hub'
import PollScreen from './pages/poll'
import ProfileScreen from './pages/profile'
import ProposalsScreen from './pages/proposals'
import WalletScreen from './pages/wallet'

const Stack = createNativeStackNavigator<AppStackParamsList>()

/* eslint-disable-next-line unused-imports/no-unused-vars */
export default function App(props: RootStackScreenProps<'App'>) {
  const isFirstEnter = localAuthStore.useLocalAuthStore(state => state.isFirstEnter)
  const logout = authStore.useLogout()

  // Handle jomhoor://auth/agora?challenge=... deep links for desktop QR auth
  useAgoraDeepLink()

  useLayoutEffect(() => {
    if (isFirstEnter) {
      logout()
    }
  }, [isFirstEnter, logout])

  return (
    <Stack.Navigator
      screenOptions={{
        headerBackTitle: '',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: 'transparent' },
        headerTitle: '',
        headerTintColor: '#0F2B46',
      }}
    >
      <Stack.Screen name='Home' component={HomeScreen} options={{ headerShown: false }} />
      <Stack.Screen name='Documents' component={DocumentsScreen} />
      <Stack.Screen name='Proposals' component={ProposalsScreen} />
      <Stack.Screen name='Hub' component={HubScreen} />
      <Stack.Screen name='Compass' component={CompassScreen} />
      <Stack.Screen name='Wallet' component={WalletScreen} />
      <Stack.Screen name='Profile' component={ProfileScreen} />
      <Stack.Screen name='InviteOthers' component={InviteOthers} options={{ animation: 'fade' }} />
      <Stack.Screen name='Scan' component={DocumentScanScreen} options={{ headerShown: false }} />
      <Stack.Screen name='Poll' component={PollScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  )
}
