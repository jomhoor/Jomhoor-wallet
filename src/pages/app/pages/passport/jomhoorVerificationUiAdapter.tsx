import type { VerificationUiAdapter } from '@iland/passport-verification/shared'
import type { PropsWithChildren } from 'react'
import { ActivityIndicator, ScrollView, Text, View } from 'react-native'

import { UiButton, UiCard } from '@/ui'

function Screen({ children }: PropsWithChildren): JSX.Element {
  return (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1,
      }}
      className='flex-1 bg-backgroundPrimary p-6'
    >
      <View className='gap-3'>{children}</View>
    </ScrollView>
  )
}

function VerificationText({
  children,
  tone = 'primary',
}: PropsWithChildren<{
  tone?: 'primary' | 'secondary' | 'error' | 'success' | 'muted'
}>): JSX.Element {
  const classNameByTone: Record<typeof tone, string> = {
    primary: 'text-textPrimary',
    secondary: 'text-textSecondary',
    error: 'text-errorMain',
    success: 'text-successMain',
    muted: 'text-textSecondary',
  }

  return <Text className={`typography-body3 ${classNameByTone[tone]}`}>{children}</Text>
}

function Button({
  title,
  onPress,
  disabled,
  loading,
  variant = 'primary',
}: {
  title: string
  onPress: () => void
  disabled?: boolean
  loading?: boolean
  variant?: 'primary' | 'secondary' | 'danger'
}): JSX.Element {
  const colorByVariant = {
    primary: 'primary',
    secondary: 'secondary',
    danger: 'error',
  } as const

  return (
    <UiButton
      title={loading ? `${title}...` : title}
      onPress={onPress}
      disabled={disabled || loading}
      color={colorByVariant[variant]}
      variant='filled'
      className='w-full'
    />
  )
}

function Card({ children }: PropsWithChildren): JSX.Element {
  return <UiCard className='gap-2'>{children}</UiCard>
}

function Loader({ label }: { label?: string }): JSX.Element {
  return (
    <View className='items-center justify-center gap-2'>
      <ActivityIndicator className='color-primaryMain' />
      {label ? <VerificationText tone='secondary'>{label}</VerificationText> : null}
    </View>
  )
}

function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }): JSX.Element {
  return (
    <View className='gap-3'>
      <VerificationText tone='error'>{message}</VerificationText>
      {onRetry ? <Button title='Retry' onPress={onRetry} variant='danger' /> : null}
    </View>
  )
}

export const jomhoorVerificationUiAdapter: VerificationUiAdapter = {
  Screen,
  Text: VerificationText,
  Button,
  Card,
  Loader,
  ErrorView,
}
