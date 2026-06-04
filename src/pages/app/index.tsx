import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useEffect, useLayoutEffect } from 'react'

import InviteOthers from '@/pages/app/pages/invite-others'
import type { AppStackParamsList, RootStackScreenProps } from '@/route-types'
import { appCapabilitiesStore, authStore, walletStore } from '@/store'
import { localAuthStore } from '@/store/modules/local-auth'
import { useAppTheme } from '@/theme'
import { getAppStackScreenOptions } from '@/theme/navigation-theme'

import CompassScreen from './pages/compass'
import DocumentScanScreen from './pages/document-scan'
import DocumentsScreen from './pages/documents'
import HomeScreen from './pages/home'
import HubScreen from './pages/hub'
import PollScreen from './pages/poll'
import ProfileScreen from './pages/profile'
import ProposalsScreen from './pages/proposals'
import SettingsScreen from './pages/settings'
import SsoConsentScreen from './pages/sso-consent'
import WalletScreen from './pages/wallet'

const Stack = createNativeStackNavigator<AppStackParamsList>()

/* eslint-disable-next-line unused-imports/no-unused-vars */
export default function App(props: RootStackScreenProps<'App'>) {
  const { palette } = useAppTheme()
  const isFirstEnter = localAuthStore.useLocalAuthStore(state => state.isFirstEnter)
  const privateKey = walletStore.useWalletStore(state => state.privateKey)
  const logout = authStore.useLogout()
  const setCapabilitiesForPrivateKey = appCapabilitiesStore.useAppCapabilitiesStore(
    state => state.setCapabilitiesForPrivateKey,
  )

  useLayoutEffect(() => {
    if (isFirstEnter) {
      logout()
    }
  }, [isFirstEnter, logout])

  useEffect(() => {
    setCapabilitiesForPrivateKey(privateKey)
  }, [privateKey, setCapabilitiesForPrivateKey])

  return (
    <Stack.Navigator screenOptions={getAppStackScreenOptions(palette)}>
      <Stack.Screen name='Home' component={HomeScreen} options={{ headerShown: false }} />
      <Stack.Screen name='Documents' component={DocumentsScreen} />
      <Stack.Screen name='Proposals' component={ProposalsScreen} />
      <Stack.Screen name='Hub' component={HubScreen} options={{ headerShown: false }} />
      <Stack.Screen name='Compass' component={CompassScreen} options={{ headerShown: false }} />
      <Stack.Screen name='Wallet' component={WalletScreen} />
      <Stack.Screen name='Profile' component={ProfileScreen} />
      <Stack.Screen name='Settings' component={SettingsScreen} />
      <Stack.Screen name='InviteOthers' component={InviteOthers} options={{ animation: 'fade' }} />
      <Stack.Screen name='Scan' component={DocumentScanScreen} options={{ headerShown: false }} />
      <Stack.Screen name='Poll' component={PollScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name='SsoConsent'
        component={SsoConsentScreen}
        options={{ title: 'Sign In Request' }}
      />
    </Stack.Navigator>
  )
}
