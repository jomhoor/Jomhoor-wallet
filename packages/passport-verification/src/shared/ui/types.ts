import type React from 'react'

export type VerificationUiAdapter = {
  Screen: React.ComponentType<{ children: React.ReactNode }>
  Text: React.ComponentType<{
    children: React.ReactNode
    tone?: 'primary' | 'secondary' | 'error' | 'success' | 'muted'
  }>
  Button: React.ComponentType<{
    title: string
    onPress: () => void
    disabled?: boolean
    loading?: boolean
    variant?: 'primary' | 'secondary' | 'danger'
  }>
  Card?: React.ComponentType<{ children: React.ReactNode }>
  Loader?: React.ComponentType<{ label?: string }>
  ErrorView?: React.ComponentType<{
    message: string
    onRetry?: () => void
  }>
}
