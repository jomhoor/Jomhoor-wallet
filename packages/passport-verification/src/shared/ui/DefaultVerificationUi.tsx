import type { PropsWithChildren } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'

import type { VerificationUiAdapter } from './types'

type TextTone = 'primary' | 'secondary' | 'error' | 'success' | 'muted'

const toneColors: Record<TextTone, string> = {
  primary: '#111827',
  secondary: '#374151',
  error: '#B91C1C',
  success: '#047857',
  muted: '#6B7280',
}

function Screen({ children }: PropsWithChildren): JSX.Element {
  return (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1,
        backgroundColor: '#F3F4F6',
        paddingHorizontal: 16,
        paddingVertical: 20,
      }}
    >
      {children}
    </ScrollView>
  )
}

function VerificationText({
  children,
  tone = 'primary',
}: PropsWithChildren<{ tone?: TextTone }>): JSX.Element {
  return (
    <Text
      style={{
        color: toneColors[tone],
        fontSize: 16,
        lineHeight: 22,
      }}
    >
      {children}
    </Text>
  )
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
  const backgroundColorByVariant: Record<'primary' | 'secondary' | 'danger', string> = {
    primary: '#2563EB',
    secondary: '#4B5563',
    danger: '#B91C1C',
  }

  return (
    <Pressable
      accessibilityRole='button'
      onPress={onPress}
      disabled={disabled || loading}
      style={{
        minHeight: 46,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
        paddingVertical: 10,
        opacity: disabled || loading ? 0.6 : 1,
        backgroundColor: backgroundColorByVariant[variant],
      }}
    >
      {loading ? (
        <ActivityIndicator color='#FFFFFF' />
      ) : (
        <Text style={{ color: '#FFFFFF' }}>{title}</Text>
      )}
    </Pressable>
  )
}

function Card({ children }: PropsWithChildren): JSX.Element {
  return (
    <View
      style={{
        borderRadius: 16,
        backgroundColor: '#FFFFFF',
        borderColor: '#E5E7EB',
        borderWidth: 1,
        padding: 16,
      }}
    >
      {children}
    </View>
  )
}

function Loader({ label }: { label?: string }): JSX.Element {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <ActivityIndicator color='#2563EB' />
      {label ? <VerificationText tone='secondary'>{label}</VerificationText> : null}
    </View>
  )
}

function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }): JSX.Element {
  return (
    <View style={{ gap: 12 }}>
      <VerificationText tone='error'>{message}</VerificationText>
      {onRetry ? <Button title='Retry' onPress={onRetry} variant='danger' /> : null}
    </View>
  )
}

export const DefaultVerificationUi: VerificationUiAdapter = {
  Screen,
  Text: VerificationText,
  Button,
  Card,
  Loader,
  ErrorView,
}
