import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { NidNfcReadResult } from '../types'

function formatNfcDebug(result: NidNfcReadResult): string {
  return JSON.stringify(
    {
      authCertLength: result.authCertHex?.length ?? 0,
      birthDate: result.birthDate?.value,
      cardNumber: result.cardNumber?.value,
      debug: result.debug,
      expiryDate: result.expiryDate?.value,
      firstName: result.firstName?.value,
      hasAuthCert: Boolean(result.authCertHex),
      hasSigningCert: Boolean(result.signingCertHex),
      lastName: result.lastName?.value,
      nationalId: result.nationalId?.value,
      signingCertLength: result.signingCertHex?.length ?? 0,
      status: result.status,
    },
    null,
    2,
  )
}

export type NidNfcReadStepProps = {
  stepIndex: number
  totalSteps: number
  busy?: boolean
  errorMessage?: string
  nfcResult?: NidNfcReadResult
  onContinue?: () => void
  onRead: () => void
  onBack: () => void
  onCancel?: () => void
}

export function NidNfcReadStep({
  stepIndex,
  totalSteps,
  busy,
  errorMessage,
  nfcResult,
  onContinue,
  onRead,
  onBack,
  onCancel,
}: NidNfcReadStepProps): JSX.Element {
  const hasNfcSuccess = nfcResult?.status === 'success'
  const nfcDebugText = nfcResult ? formatNfcDebug(nfcResult) : undefined

  return (
    <View style={styles.container}>
      <Text style={styles.stepCounter}>{`Step ${stepIndex + 1}/${totalSteps}`}</Text>
      <Text style={styles.title}>Read NID NFC Chip</Text>
      <Text style={styles.subtitle}>
        This step uses the configured NFC reader and validates certificate availability.
      </Text>

      {busy ? <Text style={styles.info}>Reading NFC chip...</Text> : null}
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      <Pressable
        style={[styles.primaryButton, busy ? styles.disabledButton : null]}
        onPress={onRead}
        disabled={busy}
      >
        <Text style={styles.primaryButtonText}>{busy ? 'Reading...' : 'Start NFC Read'}</Text>
      </Pressable>

      {nfcDebugText ? (
        <View style={styles.debugCard}>
          <Text style={styles.debugTitle}>NFC Debug Data</Text>
          <Text style={styles.debugValue}>{nfcDebugText}</Text>
        </View>
      ) : null}

      {hasNfcSuccess && onContinue ? (
        <Pressable style={styles.primaryButton} onPress={onContinue}>
          <Text style={styles.primaryButtonText}>Continue</Text>
        </Pressable>
      ) : null}

      <View style={styles.row}>
        <Pressable style={styles.secondaryButton} onPress={onBack}>
          <Text style={styles.secondaryButtonText}>Back</Text>
        </Pressable>
        {onCancel ? (
          <Pressable style={styles.secondaryButton} onPress={onCancel}>
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  debugCard: {
    backgroundColor: '#F9FAFB',
    borderColor: '#E5E7EB',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
    padding: 12,
  },
  debugTitle: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  debugValue: {
    color: '#374151',
    fontFamily: 'Courier',
    fontSize: 12,
    lineHeight: 17,
  },
  disabledButton: {
    opacity: 0.6,
  },
  error: {
    color: '#DC2626',
    fontSize: 13,
  },
  info: {
    color: '#0F766E',
    fontSize: 14,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#111827',
    borderRadius: 12,
    marginTop: 8,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#D1D5DB',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: '#374151',
    fontSize: 15,
    fontWeight: '500',
  },
  stepCounter: {
    color: '#6B7280',
    fontSize: 12,
  },
  subtitle: {
    color: '#4B5563',
    fontSize: 14,
    lineHeight: 20,
  },
  title: {
    color: '#111827',
    fontSize: 24,
    fontWeight: '700',
  },
})
