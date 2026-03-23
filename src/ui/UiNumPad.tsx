import type { ReactNode } from 'react'
import { useCallback, useMemo } from 'react'
import { Text, TouchableOpacity, View, type ViewProps } from 'react-native'

import { cn } from '@/theme'

import UiIcon from './UiIcon'

type Props = {
  value: string
  setValue: (value: string) => void
  extra?: ReactNode
  onExtraPress?: () => void
} & ViewProps

export default function UiNumPad({
  value,
  setValue,
  className,
  extra,
  onExtraPress,
  ...rest
}: Props) {
  const numArray = useMemo(() => {
    return [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      ['', '0', '<-'],
    ]
  }, [])

  const handlePress = useCallback(
    (num: string) => {
      if (!num) return

      if (num === '<-') {
        setValue(value.slice(0, -1))
      } else {
        setValue(value + num)
      }
    },
    [setValue, value],
  )

  return (
    <View {...rest} className={cn('gap-gutter', className)}>
      {numArray.map((row, rowIndex) => (
        <View key={rowIndex} className='flex-row gap-gutter'>
          {row.map((num, colIndex) => {
            const numElement = !num ? (
              extra
            ) : num === '<-' ? (
              <UiIcon customIcon='backspaceIcon' size={32} className='color-textPrimary' />
            ) : (
              <Text className='typography-h4 text-center text-textPrimary'>{num}</Text>
            )

            const onPress = () => {
              if (num) {
                handlePress(num)
              } else if (extra && onExtraPress) {
                onExtraPress()
              }
            }

            return (
              <TouchableOpacity
                key={`${rowIndex}-${colIndex}-${num || 'extra'}`}
                onPress={onPress}
                className={cn(
                  'h-20 flex-1 items-center justify-center rounded-xl',
                  numElement && 'bg-backgroundContainer',
                )}
              >
                {numElement}
              </TouchableOpacity>
            )
          })}
        </View>
      ))}
    </View>
  )
}
