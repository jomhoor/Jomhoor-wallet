export type VerificationTheme = {
  colors: {
    background: string
    text: string
    primary: string
    danger: string
    muted: string
    success?: string
    card?: string
    border?: string
  }
  spacing: Record<string, number>
  radius?: Record<string, number>
}
