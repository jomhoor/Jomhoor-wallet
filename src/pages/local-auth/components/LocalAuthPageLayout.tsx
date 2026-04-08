import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { cn } from '@/theme'
import { UiScreenScrollable } from '@/ui'

type Props = {
  top?: ReactNode
  bottom?: ReactNode
  promoIcon?: ReactNode
  promoTitle?: string
  className?: string
  topClassName?: string
  bottomClassName?: string
}

export default function LocalAuthPageLayout({
  top,
  bottom,
  promoIcon,
  promoTitle,
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
          className={cn(
            'my-auto flex w-full items-center gap-10 px-screen-x py-gutter',
            topClassName,
          )}
        >
          {promoIcon && promoTitle && (
            <View className='flex w-full items-center gap-6'>
              <View className='flex size-[120] items-center justify-center rounded-full bg-primaryMain'>
                {promoIcon}
              </View>
              <Text className={cn('typography-h4 text-center text-textPrimary')}>{promoTitle}</Text>
            </View>
          )}
          {top}
        </View>

        {bottom && (
          <View className={cn('flex w-full gap-4 px-screen-x py-gutter', bottomClassName)}>
            {bottom}
          </View>
        )}
      </View>
    </UiScreenScrollable>
  )
}
