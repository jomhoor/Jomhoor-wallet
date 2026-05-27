import { Pressable, StyleSheet, Text, View } from 'react-native'

export type NidNfcReadStepProps = {
  stepIndex: number
  totalSteps: number
  busy?: boolean
  errorMessage?: string
  onRead: () => void
  onBack: () => void
  onCancel?: () => void
}

export function NidNfcReadStep({
  stepIndex,
  totalSteps,
  busy,
  errorMessage,
  onRead,
  onBack,
  onCancel,
}: NidNfcReadStepProps): JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.stepCounter}>{`Step ${stepIndex + 1}/${totalSteps}`}</Text>
      <Text style={styles.title}>Read NID NFC Chip</Text>
      <Text style={styles.subtitle}>
        Phase 1 uses a mocked NFC result. Phase 2 will replace this with real native reads.
      </Text>

      {busy ? <Text style={styles.info}>Reading NFC (mock)...</Text> : null}
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      <Pressable
        style={[styles.primaryButton, busy ? styles.disabledButton : null]}
        onPress={onRead}
        disabled={busy}
      >
        <Text style={styles.primaryButtonText}>
          {busy ? 'Reading...' : 'Start NFC Read (Mock)'}
        </Text>
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
