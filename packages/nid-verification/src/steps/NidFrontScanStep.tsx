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
      <Text style={styles.subtitle}>Capture a clear image of the front side.</Text>

      <View style={styles.previewFrame}>
        {capturedFrontUri ? (
          <Image
            source={{ uri: capturedFrontUri }}
            style={styles.previewImage}
            resizeMode='cover'
          />
        ) : hasPermission && device ? (
          <>
            <Camera ref={cameraRef} style={styles.camera} device={device} isActive photo />
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

      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      <View style={styles.actionList}>
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
  actionList: {
    gap: 8,
  },
  camera: {
    flex: 1,
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
    justifyContent: 'center',
    minHeight: 48,
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
    justifyContent: 'center',
    minHeight: 48,
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
