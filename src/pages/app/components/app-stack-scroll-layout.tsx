import type { ReactNode } from 'react'
import type { ScrollViewProps } from 'react-native'
import { Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { cn, useAppPaddings, useBottomBarOffset } from '@/theme'
import { UiScreenScrollable } from '@/ui'

import AppContainer from './AppContainer'

type AppStackScrollLayoutProps = {
  title: string
  headerRight?: ReactNode
  children: ReactNode
  footer?: ReactNode
  scrollClassName?: string
  contentWrapperClassName?: string
  scrollViewProps?: ScrollViewProps
}

export function AppStackScrollLayout({
  title,
  headerRight,
  children,
  footer,
  scrollClassName,
  contentWrapperClassName,
  scrollViewProps,
}: AppStackScrollLayoutProps) {
  const insets = useSafeAreaInsets()
  const appPaddings = useAppPaddings()
  const offset = useBottomBarOffset()

  const body =
    contentWrapperClassName !== undefined ? (
      <View className={cn(contentWrapperClassName)}>{children}</View>
    ) : (
      children
    )

  return (
    <AppContainer>
      <UiScreenScrollable
        scrollViewProps={scrollViewProps}
        style={{
          paddingTop: insets.top,
          paddingLeft: appPaddings.left,
          paddingRight: appPaddings.right,
          paddingBottom: offset,
        }}
        className={cn('gap-4', scrollClassName)}
      >
        <View className='flex flex-row items-center justify-between'>
          <Text className='typography-h4 text-textPrimary'>{title}</Text>
          {headerRight}
        </View>
        {body}
      </UiScreenScrollable>
      {footer}
    </AppContainer>
  )
}
