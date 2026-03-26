import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { cn } from '@/theme'
import { UiScreenScrollable } from '@/ui'

type Props = {
  top: ReactNode
  bottom: ReactNode
  className?: string
  topClassName?: string
  bottomClassName?: string
}

export default function LocalAuthPageLayout({
  top,
  bottom,
  className,
  topClassName,
  bottomClassName,
}: Props) {
  const insets = useSafeAreaInsets()
  const safeAreaPadding = useMemo(
    () => ({
      paddingTop: insets.top,
      paddingBottom: insets.bottom,
    }),
    [insets.bottom, insets.top],
  )

  return (
    <UiScreenScrollable className={cn('flex flex-1 items-center justify-center', className)}>
      <View style={safeAreaPadding} className={cn('w-full flex-1')}>
        <View
          className={cn('my-auto flex w-full items-center px-screen-x py-gutter', topClassName)}
        >
          {top}
        </View>

        <View className={cn('flex w-full px-screen-x py-gutter', bottomClassName)}>{bottom}</View>
      </View>
    </UiScreenScrollable>
  )
}
