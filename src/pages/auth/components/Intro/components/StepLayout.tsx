import type { ReactElement } from 'react'
import type { ViewProps } from 'react-native'
import { Text, View } from 'react-native'

import { cn } from '@/theme'

type StepLayoutProps = ViewProps & {
  title: string
  subtitle: string
  media: ReactElement
}

export default function StepLayout({
  title,
  subtitle,
  media,
  className,
  ...rest
}: StepLayoutProps) {
  return (
    <View {...rest} className={cn('flex flex-col items-center justify-center', className)}>
      <View className={cn('flex-grow items-center justify-center')}>{media}</View>

      <View className={cn('flex flex-col items-center justify-center')}>
        <Text
          className={cn('typography-h4 text-center text-textPrimary')}
          style={{ lineHeight: 52, paddingTop: 8 }}
        >
          {title}
        </Text>
        <Text className={cn('typography-body2 mt-5 text-center text-textSecondary')}>
          {subtitle}
        </Text>
      </View>
    </View>
  )
}
