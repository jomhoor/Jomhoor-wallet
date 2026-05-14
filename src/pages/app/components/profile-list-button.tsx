import { ReactNode } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'
import { TouchableOpacityProps } from 'react-native-gesture-handler'

import { cn } from '@/theme'
import { UiIcon } from '@/ui'

export function ProfileListButton({
  leadingIcon,
  trailingIcon,
  title,
  trailingContent,
  className,
  ...rest
}: {
  leadingIcon: ReactNode
  trailingIcon?: ReactNode
  title: string
  trailingContent?: ReactNode
} & Omit<TouchableOpacityProps, 'children'>) {
  return (
    <TouchableOpacity
      {...rest}
      className={cn('flex w-full flex-row items-center gap-2 py-2', className)}
    >
      <View className='flex aspect-square size-8 items-center justify-center rounded-full bg-componentPrimary'>
        {leadingIcon}
      </View>

      <Text className={cn('typography-buttonMedium mr-auto text-textPrimary')}>{title}</Text>

      {trailingContent}

      {trailingIcon || (
        <UiIcon
          libIcon='FontAwesome'
          name='chevron-right'
          className='ml-2 text-textSecondary'
          size={3 * 4}
        />
      )}
    </TouchableOpacity>
  )
}
