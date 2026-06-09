import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
} from 'react-native-vision-camera'

import { parseNidBarcode } from '../barcode'

const BARCODE_CODE_TYPES = [
  'code-39',
  'code-128',
  'code-93',
  'codabar',
  'ean-13',
  'ean-8',
  'itf',
  'upc-e',
  'upc-a',
  'qr',
  'pdf-417',
  'aztec',
  'data-matrix',
] as const

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
  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice('back')
  const lastScannedRawRef = useRef<string>()

  const defaultBarcode = useMemo(() => {
    if (!nationalIdHint) return ''
    return `NID*${nationalIdHint}*IRN`
  }, [nationalIdHint])

  const [barcodeRaw, setBarcodeRaw] = useState(defaultBarcode)
  const parsedBarcode = useMemo(() => parseNidBarcode(barcodeRaw.trim()), [barcodeRaw])
  const hasValidBarcode = Boolean(parsedBarcode?.nidn)

  useEffect(() => {
    if (hasPermission) return
    void requestPermission()
  }, [hasPermission, requestPermission])

  const codeScanner = useCodeScanner({
    codeTypes: [...BARCODE_CODE_TYPES],
    onCodeScanned: codes => {
      const detectedCodes = Array.isArray(codes) ? codes : []
      const firstValue = detectedCodes.find(entry => typeof entry.value === 'string')?.value?.trim()
      if (!firstValue) return
      if (lastScannedRawRef.current === firstValue) return

      const parsed = parseNidBarcode(firstValue)
      if (!parsed?.nidn) return

      lastScannedRawRef.current = firstValue
      setBarcodeRaw(firstValue)
    },
  })

  return (
    <View style={styles.container}>
      <Text style={styles.stepCounter}>{`Step ${stepIndex + 1}/${totalSteps}`}</Text>
      <Text style={styles.title}>Scan NID Back Barcode</Text>
      <Text style={styles.subtitle}>
        Scan the back barcode with camera. You can also enter the national ID number manually.
      </Text>

      <View style={styles.cameraFrame}>
        {hasPermission && device ? (
          <>
            <Camera style={styles.camera} device={device} isActive codeScanner={codeScanner} />
            <View pointerEvents='none' style={styles.cardGuide}>
              <View style={[styles.cardGuideCorner, styles.cardGuideTopLeft]} />
              <View style={[styles.cardGuideCorner, styles.cardGuideTopRight]} />
              <View style={[styles.cardGuideCorner, styles.cardGuideBottomLeft]} />
              <View style={[styles.cardGuideCorner, styles.cardGuideBottomRight]} />
            </View>
          </>
        ) : (
          <View style={styles.cameraPlaceholder}>
            <Text style={styles.placeholderText}>Camera permission is required.</Text>
            <Pressable style={styles.secondaryButton} onPress={() => void requestPermission()}>
              <Text style={styles.secondaryButtonText}>Grant Camera Permission</Text>
            </Pressable>
          </View>
        )}
      </View>

      <TextInput
        style={styles.input}
        placeholder='Barcode payload'
        autoCapitalize='none'
        value={barcodeRaw}
        onChangeText={setBarcodeRaw}
      />

      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      <Pressable
        style={[styles.primaryButton, !hasValidBarcode ? styles.disabledButton : null]}
        onPress={() => onSubmit(barcodeRaw)}
        disabled={!hasValidBarcode}
      >
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
  camera: {
    flex: 1,
  },
  cameraFrame: {
    backgroundColor: '#111827',
    borderRadius: 12,
    height: 210,
    overflow: 'hidden',
    width: '100%',
  },
  cameraPlaceholder: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  cardGuide: {
    bottom: '15%',
    left: '8%',
    position: 'absolute',
    right: '8%',
    top: '15%',
  },
  cardGuideBottomLeft: {
    borderBottomLeftRadius: 14,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    bottom: 0,
    left: 0,
  },
  cardGuideBottomRight: {
    borderBottomRightRadius: 14,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    bottom: 0,
    right: 0,
  },
  cardGuideCorner: {
    borderColor: '#FFFFFF',
    height: 34,
    position: 'absolute',
    width: 34,
  },
  cardGuideTopLeft: {
    borderLeftWidth: 4,
    borderTopLeftRadius: 14,
    borderTopWidth: 4,
    left: 0,
    top: 0,
  },
  cardGuideTopRight: {
    borderRightWidth: 4,
    borderTopRightRadius: 14,
    borderTopWidth: 4,
    right: 0,
    top: 0,
  },
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
  placeholderText: {
    color: '#4B5563',
    fontSize: 14,
    marginBottom: 10,
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
