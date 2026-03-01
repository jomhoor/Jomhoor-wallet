import { Pressable, Text, View } from 'react-native'

import { useEvmAddress } from '@/helpers/evm-wallet'
import { useCopyWithHaptics } from '@/hooks/copyWithHaptics'
import { UiIcon } from '@/ui'

interface ActionButtonsProps {
  onSendPress: () => void
  onReceivePress: () => void
}

export default function ActionButtons({ onSendPress, onReceivePress }: ActionButtonsProps) {
  const address = useEvmAddress()
  const { isCopied, copy } = useCopyWithHaptics()

  if (!address) return null

  return (
    <View className='flex flex-row justify-center gap-6'>
      <ActionItem
        icon='arrow-up-circle-outline'
        label='Send'
        onPress={onSendPress}
      />
      <ActionItem
        icon={isCopied ? 'checkmark-circle-outline' : 'copy-outline'}
        label={isCopied ? 'Copied!' : 'Copy'}
        onPress={() => copy(address)}
      />
      <ActionItem
        icon='qr-code-outline'
        label='Receive'
        onPress={onReceivePress}
      />
    </View>
  )
}

function ActionItem({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: string
  label: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className='flex items-center gap-2'
      style={{ opacity: disabled ? 0.4 : 1 }}
    >
      <View className='flex size-12 items-center justify-center rounded-full bg-primaryMain'>
        <UiIcon
          libIcon='Ionicons'
          name={icon}
          size={22}
          className='text-baseWhite'
        />
      </View>
      <Text className='typography-caption2 text-textSecondary'>{label}</Text>
    </Pressable>
  )
}
