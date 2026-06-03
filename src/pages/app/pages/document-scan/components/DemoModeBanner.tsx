import { Text, View } from 'react-native'

export default function DemoModeBanner({
  message = 'Demo mode uses fictional passport data. No real proof or on-chain registration will occur.',
}: {
  message?: string
}) {
  return (
    <View className='bg-warningMain/10 rounded-xl px-4 py-3'>
      <Text className='typography-body4 text-center text-warningMain'>{message}</Text>
    </View>
  )
}
