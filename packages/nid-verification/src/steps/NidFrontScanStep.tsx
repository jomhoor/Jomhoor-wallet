import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

export type NidFrontScanStepProps = {
  stepIndex: number
  totalSteps: number
  defaultNationalId?: string
  errorMessage?: string
  onSubmit: (nationalIdInput?: string) => void
  onCancel?: () => void
}

export function NidFrontScanStep({
  stepIndex,
  totalSteps,
  defaultNationalId,
  errorMessage,
  onSubmit,
  onCancel,
}: NidFrontScanStepProps): JSX.Element {
  const [nationalId, setNationalId] = useState(defaultNationalId ?? '')

  return (
    <View style={styles.container}>
      <Text style={styles.stepCounter}>{`Step ${stepIndex + 1}/${totalSteps}`}</Text>
      <Text style={styles.title}>Scan NID Front</Text>
      <Text style={styles.subtitle}>
        Phase 1 uses manual fallback for the national ID while front image capture stays mocked.
      </Text>

      <TextInput
        style={styles.input}
        placeholder='National ID (manual fallback)'
        autoCapitalize='none'
        keyboardType='number-pad'
        value={nationalId}
        onChangeText={setNationalId}
      />

      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      <Pressable style={styles.primaryButton} onPress={() => onSubmit(nationalId)}>
        <Text style={styles.primaryButtonText}>Continue to Back Scan</Text>
      </Pressable>

      {onCancel ? (
        <Pressable style={styles.secondaryButton} onPress={onCancel}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
      ) : null}
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
  input: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D1D5DB',
    borderRadius: 12,
    borderWidth: 1,
    color: '#111827',
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
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
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#D1D5DB',
    borderRadius: 12,
    borderWidth: 1,
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
