import { useCallback, useEffect, useRef, useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera'

export type NidFrontScanStepProps = {
  stepIndex: number
  totalSteps: number
  errorMessage?: string
  onSubmit: (frontImageUri: string) => void
  onCancel?: () => void
}

export function NidFrontScanStep({
  stepIndex,
  totalSteps,
  errorMessage,
  onSubmit,
  onCancel,
}: NidFrontScanStepProps): JSX.Element {
  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice('back')
  const cameraRef = useRef<Camera>(null)

  const [busy, setBusy] = useState(false)
  const [capturedFrontUri, setCapturedFrontUri] = useState<string>()

  useEffect(() => {
    if (hasPermission) return
    void requestPermission()
  }, [hasPermission, requestPermission])

  const captureFront = useCallback(async () => {
    if (!cameraRef.current || !device || busy) return
    setBusy(true)
    try {
      const photo = await cameraRef.current.takePhoto()
      const uri = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`
      setCapturedFrontUri(uri)
    } finally {
      setBusy(false)
    }
  }, [busy, device])

  return (
    <View style={styles.container}>
      <Text style={styles.stepCounter}>{`Step ${stepIndex + 1}/${totalSteps}`}</Text>
      <Text style={styles.title}>Capture NID Front</Text>
      <Text style={styles.subtitle}>
        Capture a clear image of the front side. No OCR is used in this flow.
      </Text>

      <View style={styles.previewFrame}>
        {capturedFrontUri ? (
          <Image
            source={{ uri: capturedFrontUri }}
            style={styles.previewImage}
            resizeMode='cover'
          />
        ) : hasPermission && device ? (
          <Camera ref={cameraRef} style={styles.camera} device={device} isActive photo />
        ) : (
          <View style={styles.cameraPlaceholder}>
            <Text style={styles.placeholderText}>Camera permission is required.</Text>
            <Pressable style={styles.secondaryButton} onPress={() => void requestPermission()}>
              <Text style={styles.secondaryButtonText}>Grant Camera Permission</Text>
            </Pressable>
          </View>
        )}
      </View>

      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      <View style={styles.row}>
        {capturedFrontUri ? (
          <Pressable
            style={[styles.secondaryButton, busy ? styles.disabledButton : null]}
            onPress={() => {
              setCapturedFrontUri(undefined)
            }}
            disabled={busy}
          >
            <Text style={styles.secondaryButtonText}>Retake</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.secondaryButton, busy ? styles.disabledButton : null]}
            onPress={() => {
              void captureFront()
            }}
            disabled={busy || !hasPermission || !device}
          >
            <Text style={styles.secondaryButtonText}>
              {busy ? 'Capturing...' : 'Capture Front'}
            </Text>
          </Pressable>
        )}

        <Pressable
          style={[styles.primaryButton, !capturedFrontUri ? styles.disabledButton : null]}
          onPress={() => {
            if (!capturedFrontUri) return
            onSubmit(capturedFrontUri)
          }}
          disabled={!capturedFrontUri}
        >
          <Text style={styles.primaryButtonText}>Continue to Back Scan</Text>
        </Pressable>
      </View>

      {onCancel ? (
        <Pressable style={styles.secondaryButton} onPress={onCancel}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  camera: {
    flex: 1,
  },
  cameraPlaceholder: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16,
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
  placeholderText: {
    color: '#4B5563',
    fontSize: 14,
    marginBottom: 10,
  },
  previewFrame: {
    backgroundColor: '#111827',
    borderRadius: 12,
    height: 260,
    overflow: 'hidden',
    width: '100%',
  },
  previewImage: {
    flex: 1,
    width: '100%',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#111827',
    borderRadius: 12,
    flex: 1,
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
