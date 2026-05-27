import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { AuthStackParamsList } from '@/route-types'
import { UiButton, UiIcon, UiScreenScrollable } from '@/ui'

export default function DeviceNotSupported() {
  const insets = useSafeAreaInsets()
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamsList>>()

  return (
    <UiScreenScrollable>
      <View
        style={{ paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }}
        className='flex-1 items-center justify-center gap-6 px-6'
      >
        <UiIcon customIcon='lockIcon' className='size-16 text-errorMain' />

        <Text className='typography-h3 text-center text-textPrimary'>Device Not Supported</Text>

        <Text className='typography-body2 text-center text-textSecondary'>
          This device does not support the security features required to use this app. Please use a
          physical iOS device or an Android device with Google Play Services installed.
        </Text>

        <UiButton
          title='Go Back'
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack()
            }
          }}
        />
      </View>
    </UiScreenScrollable>
  )
}
