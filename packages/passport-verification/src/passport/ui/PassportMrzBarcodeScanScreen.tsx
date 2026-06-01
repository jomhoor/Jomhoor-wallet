import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import {
  ActivityIndicator,
  AppState,
  StyleSheet,
  Text,
  View,
  type AppStateStatus,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { Pressable } from 'react-native-gesture-handler'

import { parseNidBarcode, type ParsedNidBarcode } from '../barcode'
import { createPassportMrzScanResult, type PassportMrzScanResult } from '../mrz'
import type { ParsedMrz, PassportCredentials } from '../types'

export type PassportMrzBarcodeResult = {
  credentials: PassportCredentials
  parsedMrz: ParsedMrz
  barcode?: {
    raw?: string
    nidn?: string
    fields?: Record<string, unknown>
  }
}

export type PassportMrzBarcodeScanScreenProps = {
  onDetected: (result: PassportMrzBarcodeResult) => void
  onCancel?: () => void
  style?: StyleProp<ViewStyle>
}

type VisionCameraModule = {
  Camera: ComponentType<Record<string, unknown>>
  useCameraDevice: (position: 'front' | 'back') => unknown
  useCameraPermission: () => {
    hasPermission: boolean
    requestPermission: () => Promise<boolean>
  }
  useCodeScanner: (config: {
    codeTypes: readonly string[]
    onCodeScanned: (
      codes: Array<Record<string, unknown>>,
      scannerFrame: { height?: number },
    ) => void
  }) => unknown
  useFrameProcessor: (
    processor: (frame: Record<string, unknown>) => void,
    deps: ReadonlyArray<unknown>,
  ) => unknown
  runAtTargetFps: (fps: number, callback: () => void) => void
}

type TextRecognitionModule = {
  useTextRecognition: (_options: { language: 'latin' }) => {
    scanText: (frame: unknown) => unknown
  }
}

type WorkletsModule = {
  Worklets: {
    createRunOnJS: <T extends (...args: never[]) => unknown>(fn: T) => T
  }
}

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

const SCAN_FPS = 2
type ScanPhase = 'barcode' | 'mrz'

const loadVisionCameraModule = (): VisionCameraModule | null => {
  try {
    return require('react-native-vision-camera') as VisionCameraModule
  } catch {
    return null
  }
}

const loadTextRecognitionModule = (): TextRecognitionModule | null => {
  try {
    return require('react-native-vision-camera-text-recognition') as TextRecognitionModule
  } catch {
    return null
  }
}

const loadWorkletsModule = (): WorkletsModule | null => {
  try {
    return require('react-native-worklets-core') as WorkletsModule
  } catch {
    return null
  }
}

const fallbackUseCameraPermission = () => ({
  hasPermission: false,
  requestPermission: async () => false,
})

const fallbackUseCameraDevice = () => null
const fallbackUseCodeScanner = () => undefined
const fallbackUseFrameProcessor = () => undefined
const fallbackRunAtTargetFps = (_fps: number, callback: () => void) => callback()
const fallbackUseTextRecognition = () => ({
  scanText: (frameData: unknown) => {
    void frameData
    return null
  },
})

const maskValue = (value?: string): string => {
  if (!value) return '—'
  if (value.length <= 4) return '*'.repeat(value.length)
  return `${value.slice(0, 2)}${'*'.repeat(Math.max(value.length - 4, 0))}${value.slice(-2)}`
}

const toBarcodePayload = (
  value?: ParsedNidBarcode,
): PassportMrzBarcodeResult['barcode'] | undefined => {
  if (!value) return undefined
  return {
    raw: value.raw,
    nidn: value.nidn,
    fields: value.fields,
  }
}

export function PassportMrzBarcodeScanScreen({
  onDetected,
  onCancel,
  style,
}: PassportMrzBarcodeScanScreenProps) {
  const visionCameraModule = useMemo(loadVisionCameraModule, [])
  const textRecognitionModule = useMemo(loadTextRecognitionModule, [])
  const workletsModule = useMemo(loadWorkletsModule, [])

  const CameraComponent = visionCameraModule?.Camera
  const useCameraPermissionHook =
    visionCameraModule?.useCameraPermission ?? fallbackUseCameraPermission
  const useCameraDeviceHook = visionCameraModule?.useCameraDevice ?? fallbackUseCameraDevice
  const useCodeScannerHook = visionCameraModule?.useCodeScanner ?? fallbackUseCodeScanner
  const useFrameProcessorHook = visionCameraModule?.useFrameProcessor ?? fallbackUseFrameProcessor
  const runAtTargetFpsHook = visionCameraModule?.runAtTargetFps ?? fallbackRunAtTargetFps
  const useTextRecognitionHook =
    textRecognitionModule?.useTextRecognition ?? fallbackUseTextRecognition

  const device = useCameraDeviceHook('back')
  const { hasPermission, requestPermission } = useCameraPermissionHook()
  const { scanText } = useTextRecognitionHook({ language: 'latin' })

  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState)
  const [statusMessage, setStatusMessage] = useState('Scan barcode to continue.')
  const [scanPhase, setScanPhase] = useState<ScanPhase>('barcode')
  const [mrzResult, setMrzResult] = useState<PassportMrzScanResult>()
  const [barcodeResult, setBarcodeResult] = useState<ParsedNidBarcode>()
  const [isFinalizing, setIsFinalizing] = useState(false)

  const hasCompletedRef = useRef(false)
  const mrzResultRef = useRef<PassportMrzScanResult>()
  const barcodeResultRef = useRef<ParsedNidBarcode>()

  useEffect(() => {
    if (hasPermission) return
    requestPermission()
  }, [hasPermission, requestPermission])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      setAppState(nextState)
    })
    return () => {
      subscription.remove()
    }
  }, [])

  const completeIfReady = useCallback(() => {
    if (hasCompletedRef.current) return

    const currentMrz = mrzResultRef.current
    const currentBarcode = barcodeResultRef.current
    if (!currentMrz || !currentBarcode?.nidn) return

    hasCompletedRef.current = true
    setIsFinalizing(true)
    setStatusMessage('MRZ and barcode detected. Finalizing...')
    onDetected({
      credentials: currentMrz.credentials,
      parsedMrz: currentMrz.parsed,
      barcode: toBarcodePayload(currentBarcode),
    })
  }, [onDetected])

  const handleDetectedText = useCallback(
    (payload: { fullText: string }) => {
      if (scanPhase !== 'mrz') return
      if (hasCompletedRef.current || mrzResultRef.current) return

      const nextMrz = createPassportMrzScanResult(payload.fullText)
      if (!nextMrz) return

      mrzResultRef.current = nextMrz
      setMrzResult(nextMrz)
      setStatusMessage(
        barcodeResultRef.current?.nidn
          ? 'MRZ and barcode detected. Finalizing...'
          : 'MRZ detected. Keep scanning barcode.',
      )
      completeIfReady()
    },
    [completeIfReady, scanPhase],
  )

  const runOnDetectedText = useMemo(() => {
    const createRunOnJS =
      workletsModule?.Worklets?.createRunOnJS ??
      ((fn: (payload: { fullText: string }) => void) => fn)
    return createRunOnJS((payload: { fullText: string }) => {
      handleDetectedText(payload)
    })
  }, [handleDetectedText, workletsModule?.Worklets?.createRunOnJS])

  const frameProcessor = useFrameProcessorHook(
    frame => {
      'worklet'
      if (hasCompletedRef.current) return

      runAtTargetFpsHook(SCAN_FPS, () => {
        'worklet'
        const recognizedData = scanText(frame)

        let fullText = ''
        if (Array.isArray(recognizedData)) {
          fullText = recognizedData
            .map(entry =>
              entry &&
              typeof entry === 'object' &&
              typeof (entry as { resultText?: unknown }).resultText === 'string'
                ? String((entry as { resultText?: unknown }).resultText)
                : '',
            )
            .filter(Boolean)
            .join('\n')
        } else if (
          recognizedData &&
          typeof recognizedData === 'object' &&
          typeof (recognizedData as { resultText?: unknown }).resultText === 'string'
        ) {
          fullText = String((recognizedData as { resultText?: unknown }).resultText)
        }

        if (!fullText) return

        runOnDetectedText({
          fullText,
        })
      })
    },
    [runAtTargetFpsHook, runOnDetectedText, scanText],
  )

  const handleCodeScanned = useCallback(
    (codes: Array<Record<string, unknown>>) => {
      if (scanPhase !== 'barcode') return
      if (hasCompletedRef.current || barcodeResultRef.current?.nidn) return
      const detectedCodes = Array.isArray(codes) ? codes : []

      const firstCode = detectedCodes.find(entry => {
        const value = typeof entry.value === 'string' ? entry.value.trim() : ''
        return value.length > 0
      })

      const rawValue = typeof firstCode?.value === 'string' ? firstCode.value.trim() : ''
      if (!rawValue) return

      const parsed = parseNidBarcode(rawValue)
      if (!parsed?.nidn) return

      barcodeResultRef.current = parsed
      setBarcodeResult(parsed)
      setScanPhase('mrz')
      setStatusMessage('Barcode detected. Keep the MRZ visible in the camera.')
      completeIfReady()
    },
    [completeIfReady, scanPhase],
  )

  const codeScanner = useCodeScannerHook({
    codeTypes: [...BARCODE_CODE_TYPES],
    onCodeScanned: handleCodeScanned,
  })

  const isActive = appState === 'active' && !isFinalizing
  const activeCodeScanner = scanPhase === 'barcode' ? codeScanner : undefined
  const activeFrameProcessor = scanPhase === 'mrz' ? frameProcessor : undefined

  if (!hasPermission) {
    return (
      <View style={[styles.screen, style]}>
        <Text style={styles.helperText}>Camera permission is required.</Text>
      </View>
    )
  }

  if (!visionCameraModule || !textRecognitionModule || !CameraComponent || !device) {
    return (
      <View style={[styles.screen, style]}>
        <Text style={styles.helperText}>Scanner modules are unavailable on this build.</Text>
      </View>
    )
  }

  return (
    <View style={[styles.screen, style]}>
      <Text style={styles.title}>Scan Passport MRZ + Barcode</Text>
      <Text style={styles.subtitle}>Live scan requires both barcode and MRZ before continue.</Text>

      <View style={styles.cameraFrame}>
        <CameraComponent
          style={styles.camera}
          device={device}
          isActive={isActive}
          photo={false}
          video={false}
          audio={false}
          mode='recognize'
          codeScanner={activeCodeScanner}
          frameProcessor={activeFrameProcessor}
        />
        <View pointerEvents='none' style={styles.overlay}>
          <View
            style={[
              styles.safeAreaBox,
              styles.barcodeSafeArea,
              barcodeResult?.nidn ? styles.detected : null,
            ]}
          >
            <Text style={styles.fieldLabel}>Barcode</Text>
            <Text style={styles.fieldValue}>
              {barcodeResult?.nidn ? maskValue(barcodeResult.nidn) : 'Scanning barcode...'}
            </Text>
          </View>
          <View
            style={[styles.safeAreaBox, styles.mrzSafeArea, mrzResult ? styles.detected : null]}
          >
            <Text style={styles.fieldLabel}>MRZ</Text>
            <Text style={styles.fieldValue}>
              {mrzResult?.parsed.documentNumber
                ? `Passport: ${maskValue(mrzResult.parsed.documentNumber)}`
                : 'Scanning MRZ...'}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.statusCard}>
        {isFinalizing ? <ActivityIndicator style={styles.loader} /> : null}
        <Text style={styles.helperText}>{statusMessage}</Text>
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
  barcodeSafeArea: {
    height: '20%',
    left: '10%',
    top: 40,
    width: '75%',
  },
  camera: {
    height: '100%',
    width: '100%',
  },
  cameraFrame: {
    backgroundColor: '#111827',
    borderRadius: 16,
    height: 560,
    overflow: 'hidden',
    width: '100%',
  },
  detected: {
    backgroundColor: 'rgba(16,185,129,0.16)',
    borderColor: '#10b981',
  },
  fieldLabel: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  fieldValue: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  helperText: {
    color: '#6b7280',
    fontSize: 14,
    lineHeight: 20,
  },
  loader: {
    marginBottom: 8,
  },
  mrzSafeArea: {
    alignSelf: 'center',
    bottom: 20,
    height: '20%',
    width: '90%',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17,24,39,0.12)',
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  safeAreaBox: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderColor: 'rgba(15,23,42,0.65)',
    borderRadius: 22,
    borderWidth: 2,
    justifyContent: 'center',
    paddingHorizontal: 18,
    position: 'absolute',
  },
  screen: {
    flex: 1,
    padding: 24,
  },
  secondaryButton: {
    borderColor: '#d1d5db',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
    padding: 14,
  },
  secondaryButtonText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
  },
  statusCard: {
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    marginTop: 14,
    padding: 16,
  },
  subtitle: {
    color: '#6b7280',
    fontSize: 14,
    marginBottom: 16,
    marginTop: 4,
  },
  title: {
    color: '#111827',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 2,
  },
})
