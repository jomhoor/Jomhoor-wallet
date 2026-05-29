import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { NidNfcReadResult } from '../types'

export type NidLivenessFaceStepProps = {
  stepIndex: number
  totalSteps: number
  nfc?: NidNfcReadResult
  errorMessage?: string
  onComplete: () => void
  onBack: () => void
  onCancel?: () => void
}

export function NidLivenessFaceStep({
  stepIndex,
  totalSteps,
  nfc,
  errorMessage,
  onComplete,
  onBack,
  onCancel,
}: NidLivenessFaceStepProps): JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.stepCounter}>{`Step ${stepIndex + 1}/${totalSteps}`}</Text>
      <Text style={styles.title}>Liveness + Face Comparison</Text>
      <Text style={styles.subtitle}>
        Phase 1 runs mocked liveness/gaze/face outputs using shared challenge and comparison logic.
      </Text>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>NFC Snapshot</Text>
        <Text style={styles.summaryRow}>{`National ID: ${nfc?.nationalId?.value ?? '-'}`}</Text>
        <Text style={styles.summaryRow}>{`First name: ${nfc?.firstName?.value ?? '-'}`}</Text>
        <Text style={styles.summaryRow}>{`Last name: ${nfc?.lastName?.value ?? '-'}`}</Text>
      </View>

      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      <Pressable style={styles.primaryButton} onPress={onComplete}>
        <Text style={styles.primaryButtonText}>Complete Verification</Text>
      </Pressable>

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
  error: {
    color: '#DC2626',
    fontSize: 13,
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
  summaryCard: {
    backgroundColor: '#F9FAFB',
    borderColor: '#E5E7EB',
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    padding: 14,
  },
  summaryRow: {
    color: '#374151',
    fontSize: 13,
  },
  summaryTitle: {
    color: '#111827',
    fontWeight: '600',
    marginBottom: 4,
  },
  title: {
    color: '#111827',
    fontSize: 24,
    fontWeight: '700',
  },
})
