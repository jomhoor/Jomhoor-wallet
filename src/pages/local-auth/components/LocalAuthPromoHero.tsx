import type { ReactNode } from 'react'
import { Text, View } from 'react-native'

import { cn } from '@/theme'

type Props = {
  icon: ReactNode
  title: string
  className?: string
}

/** Shared lock / biometrics onboarding header (circle + title). */
export function LocalAuthPromoHero({ icon, title, className }: Props) {
  return (
    <View className={cn('my-auto flex w-full items-center gap-6 px-screen-x py-gutter', className)}>
      <View className='flex size-[120] items-center justify-center rounded-full bg-primaryMain'>
        {icon}
      </View>
      <Text className={cn('typography-h4 text-center text-textPrimary')}>{title}</Text>
    </View>
  )
}
