import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useLayoutEffect } from 'react'

import { useAgoraDeepLink } from '@/hooks/useAgoraDeepLink'
import InviteOthers from '@/pages/app/pages/invite-others'
import type {
  AppStackParamsList,
  AppStackScreenProps,
  AppTabParamsList,
  RootStackScreenProps,
} from '@/route-types'
import { authStore } from '@/store'
import { localAuthStore } from '@/store/modules/local-auth'
import { UiIcon } from '@/ui'

import BottomTabBar from './components/BottomTabBarTabBar'
import CompassScreen from './pages/compass'
import DocumentScanScreen from './pages/document-scan'
import DocumentsScreen from './pages/documents'
import HubScreen from './pages/hub'
import PollScreen from './pages/poll'
import ProfileScreen from './pages/profile'
import ProposalsScreen from './pages/proposals'
import WalletScreen from './pages/wallet'

const Stack = createNativeStackNavigator<AppStackParamsList>()
const Tab = createBottomTabNavigator<AppTabParamsList>()

// eslint-disable-next-line no-empty-pattern
function AppTabs({}: AppStackScreenProps<'Tabs'>) {
  return (
    <Tab.Navigator
      tabBar={props => <BottomTabBar {...props} />}
      screenOptions={{
        tabBarStyle: {
          position: 'absolute',
          bottom: 0,
          left: 0,
        },
      }}
      initialRouteName='Documents'
    >
      {/* <Tab.Screen
        name='Home'
        component={HomeScreen}
        options={{
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <UiIcon libIcon='FontAwesome' name='home' size={size} color={color} />
          ),
        }}
      /> */}
      <Tab.Screen
        name='Documents'
        component={DocumentsScreen}
        options={{
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <UiIcon libIcon='Fontisto' name='passport-alt' size={20} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name='Proposals'
        component={ProposalsScreen}
        options={{
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <UiIcon libIcon='FontAwesome' name='list-ul' size={20} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name='Hub'
        component={HubScreen}
        options={{
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <UiIcon libIcon='Ionicons' name='chatbubbles-outline' size={20} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name='Compass'
        component={CompassScreen}
        options={{
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <UiIcon libIcon='Ionicons' name='compass-outline' size={20} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name='Wallet'
        component={WalletScreen}
        options={{
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <UiIcon libIcon='Ionicons' name='wallet-outline' size={20} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name='Profile'
        component={ProfileScreen}
        options={{
          headerShown: false,
          tabBarIcon: ({ color }) => <UiIcon customIcon='userIcon' size={20} color={color} />,
        }}
      />
    </Tab.Navigator>
  )
}

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
        headerShown: false,
      }}
    >
      <Stack.Screen name='Tabs' component={AppTabs} />
      <Stack.Screen
        name='InviteOthers'
        component={InviteOthers}
        options={{
          animation: 'fade',
        }}
      />
      <Stack.Screen
        name='Scan'
        component={DocumentScanScreen}
        options={{
          headerShown: false,
        }}
      />

      <Stack.Screen
        name='Poll'
        options={{
          headerShown: false,
        }}
        component={PollScreen}
      />
    </Stack.Navigator>
  )
}
