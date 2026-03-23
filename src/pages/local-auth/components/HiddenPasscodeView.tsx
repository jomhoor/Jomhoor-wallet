import type { ViewProps } from 'react-native'
import { View } from 'react-native'

import { cn } from '@/theme/utils'

type Props = {
  length: number
  maxLength: number
  isError?: boolean
} & ViewProps

export default function HiddenPasscodeView({ length, maxLength, isError = false }: Props) {
  return (
    <View className='flex h-[32] flex-row-reverse items-center gap-8'>
      {Array.from({ length: maxLength }).map((_, i) => (
        <View
          key={i}
          className={cn(
            'size-[32] rounded-full',
            isError
              ? 'border-4 border-errorMain bg-errorMain'
              : i < length
                ? 'border-4 border-white bg-primaryMain'
                : 'bg-textSecondary',
          )}
        />
      ))}
    </View>
  )
}
