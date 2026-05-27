import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

export type NidBackScanStepProps = {
  stepIndex: number
  totalSteps: number
  nationalIdHint?: string
  errorMessage?: string
  onSubmit: (barcodeRaw?: string) => void
  onBack: () => void
  onCancel?: () => void
}

export function NidBackScanStep({
  stepIndex,
  totalSteps,
  nationalIdHint,
  errorMessage,
  onSubmit,
  onBack,
  onCancel,
}: NidBackScanStepProps): JSX.Element {
  const defaultBarcode = useMemo(() => {
    if (!nationalIdHint) return ''
    return `NID*${nationalIdHint}*IRN`
  }, [nationalIdHint])

  const [barcodeRaw, setBarcodeRaw] = useState(defaultBarcode)

  return (
    <View style={styles.container}>
      <Text style={styles.stepCounter}>{`Step ${stepIndex + 1}/${totalSteps}`}</Text>
      <Text style={styles.title}>Scan NID Back Barcode</Text>
      <Text style={styles.subtitle}>
        Phase 1 accepts manual barcode payload input and parses it with shared barcode logic.
      </Text>

      <TextInput
        style={styles.input}
        placeholder='Barcode payload'
        autoCapitalize='none'
        value={barcodeRaw}
        onChangeText={setBarcodeRaw}
      />

      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      <Pressable style={styles.primaryButton} onPress={() => onSubmit(barcodeRaw)}>
        <Text style={styles.primaryButtonText}>Continue to NFC Read</Text>
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
