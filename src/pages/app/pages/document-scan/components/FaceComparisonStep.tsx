import { type NidVerificationResult, toNidProofInputAdapterData } from '@iland/nid-verification'
import {
  compareFaces,
  DEFAULT_FACE_COMPARISON_THRESHOLD,
  type FaceComparisonResult,
  getCenteredFaceSquareCrop,
  preloadFaceComparisonModel,
} from '@iland/passport-verification'
import { useNavigation } from '@react-navigation/core'
import { Image } from 'expo-image'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { Pressable } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera'

import { Steps, useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'
import { UiButton, UiIcon } from '@/ui'
import { DocType } from '@/utils/e-document'

type ComparisonState = 'initializing' | 'ready' | 'capturing' | 'cropped' | 'failed' | 'success'

const CAMERA_STARTUP_DELAY_MS = 250

function isFaceDebugEnabled(): boolean {
  return __DEV__ && process.env.EXPO_PUBLIC_DOCUMENT_SCAN_FACE_DEBUG === 'enabled'
}

function logFaceDebug(event: string, metadata: Record<string, unknown>) {
  if (!isFaceDebugEnabled()) return
  // eslint-disable-next-line no-console
  console.log('[FACE-COMPARISON][STEP]', event, metadata)
}

const buildPortraitUri = (portrait?: {
  base64?: string
  filePath?: string
}): string | undefined => {
  if (typeof portrait?.base64 === 'string' && portrait.base64.length > 0) {
    return `data:image/jpeg;base64,${portrait.base64}`
  }

  if (typeof portrait?.filePath !== 'string' || portrait.filePath.length === 0) {
    return undefined
  }

  return portrait.filePath.startsWith('file://') ? portrait.filePath : `file://${portrait.filePath}`
}

export default function FaceComparisonStep(): JSX.Element {
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice('front')
  const cameraRef = useRef<Camera>(null)

  const {
    docType,
    faceVerification,
    nidVerificationResult,
    passportNfcDetails,
    runMockNidProofGeneration,
    setCurrentStep,
    setFaceComparisonResult,
    setNidVerificationResult,
  } = useDocumentScanContext()

  const [comparisonState, setComparisonState] = useState<ComparisonState>('initializing')
  const [cameraReady, setCameraReady] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [comparisonResult, setComparisonResult] = useState<FaceComparisonResult | null>(null)
  const [croppedPreviewUris, setCroppedPreviewUris] = useState<{
    referenceUri: string
    liveUri: string
  } | null>(null)
  const successTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const portraitUri = useMemo(
    () => buildPortraitUri(passportNfcDetails?.portrait),
    [passportNfcDetails?.portrait],
  )

  useEffect(() => {
    if (!hasPermission) {
      void requestPermission()
    }
  }, [hasPermission, requestPermission])

  useEffect(() => {
    let mounted = true
    const prepare = async () => {
      try {
        logFaceDebug('prepare-start', {
          hasPortraitUri: Boolean(portraitUri),
          hasPortraitBase64: typeof passportNfcDetails?.portrait?.base64 === 'string',
          hasPortraitFilePath: typeof passportNfcDetails?.portrait?.filePath === 'string',
        })
        await preloadFaceComparisonModel()
        if (!mounted) return

        if (!portraitUri) {
          setComparisonState('failed')
          setErrorMessage(
            'Passport portrait was not found. You can retry NFC or continue to preview.',
          )
          return
        }

        setComparisonState('ready')
        logFaceDebug('prepare-ready', {
          hasDevice: Boolean(device),
          hasPermission,
        })
      } catch (error) {
        if (!mounted) return
        setComparisonState('failed')
        const errorMessage = error instanceof Error ? error.message : String(error)
        setErrorMessage(
          `Face model is unavailable on this build. Error: ${errorMessage}. Please retry.`,
        )
        // eslint-disable-next-line no-console
        console.log('[FaceComparisonStep] Model preload failed:', error)
        logFaceDebug('prepare-failed', { error: errorMessage })
      }
    }

    void prepare()
    return () => {
      mounted = false
    }
  }, [
    device,
    hasPermission,
    passportNfcDetails?.portrait?.base64,
    passportNfcDetails?.portrait?.filePath,
    portraitUri,
  ])

  useEffect(() => {
    return () => {
      if (successTransitionTimeoutRef.current) {
        clearTimeout(successTransitionTimeoutRef.current)
        successTransitionTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (comparisonState !== 'ready') {
      setCameraReady(false)
      return
    }

    const timer = setTimeout(() => {
      setCameraReady(true)
    }, CAMERA_STARTUP_DELAY_MS)

    return () => {
      clearTimeout(timer)
      setCameraReady(false)
    }
  }, [comparisonState])

  const handleCaptureAndPrepare = async () => {
    if (isBusy) return
    if (!cameraRef.current || !device || !portraitUri) return

    logFaceDebug('capture-start', {
      hasDevice: Boolean(device),
      hasPortraitUri: Boolean(portraitUri),
      hasPermission,
    })
    setIsBusy(true)
    setErrorMessage(null)
    setComparisonResult(null)
    setCroppedPreviewUris(null)
    setComparisonState('capturing')

    try {
      const capturedPhoto = await cameraRef.current.takePhoto()
      const liveImageUri = capturedPhoto.path.startsWith('file://')
        ? capturedPhoto.path
        : `file://${capturedPhoto.path}`
      logFaceDebug('capture-complete', {
        liveImageUriKind: liveImageUri.startsWith('file://') ? 'file-uri' : 'other',
      })

      const [preparedReferenceUri, preparedLiveUri] = await Promise.all([
        getCenteredFaceSquareCrop(portraitUri),
        getCenteredFaceSquareCrop(liveImageUri),
      ])

      logFaceDebug('crop-preview-ready', {
        preparedReferenceUriKind: preparedReferenceUri.startsWith('file://') ? 'file-uri' : 'other',
        preparedLiveUriKind: preparedLiveUri.startsWith('file://') ? 'file-uri' : 'other',
      })

      setCroppedPreviewUris({
        referenceUri: preparedReferenceUri,
        liveUri: preparedLiveUri,
      })
      setComparisonState('cropped')
    } catch (error) {
      const code = error instanceof Error ? error.name || error.message : 'unknown_error'
      const message = error instanceof Error ? error.message : 'unknown_error'
      logFaceDebug('prepare-error', {
        code,
        message,
      })
      setComparisonState('failed')
      if (code === 'FACE_NOT_DETECTED') {
        setErrorMessage('No face detected. Keep your face centered and retry.')
      } else if (code === 'MULTIPLE_FACES_DETECTED') {
        setErrorMessage('Multiple faces detected. Ensure only one face is in frame and retry.')
      } else {
        setErrorMessage('Face preparation failed. Please retry.')
      }
    } finally {
      setIsBusy(false)
    }
  }

  const handleComparePrepared = async () => {
    if (isBusy) return
    if (!croppedPreviewUris) return

    setIsBusy(true)
    setErrorMessage(null)
    setComparisonState('capturing')

    try {
      const result = await compareFaces({
        liveImageUri: croppedPreviewUris.liveUri,
        referenceImage: { uri: croppedPreviewUris.referenceUri },
        threshold: DEFAULT_FACE_COMPARISON_THRESHOLD,
        modelName: 'mobilefacenet',
        alreadyPreprocessed: true,
      })
      logFaceDebug('compare-result', {
        passed: result.passed,
        similarity: result.similarity,
        threshold: result.threshold,
      })

      setComparisonResult(result)

      if (!result.passed) {
        setComparisonState('failed')
        setErrorMessage('Face match confidence is too low. Retry with better lighting and framing.')
        return
      }

      setFaceComparisonResult(result)
      if (docType === DocType.ID && nidVerificationResult) {
        const mergedFaceResult: NidVerificationResult = {
          ...nidVerificationResult,
          verified: Boolean(
            nidVerificationResult.verified &&
              faceVerification.liveness?.passed &&
              faceVerification.gaze?.passed &&
              result.passed,
          ),
          finalDecision:
            nidVerificationResult.verified &&
            faceVerification.liveness?.passed &&
            faceVerification.gaze?.passed &&
            result.passed
              ? 'verified'
              : 'failed',
          face: {
            passed: Boolean(
              faceVerification.liveness?.passed && faceVerification.gaze?.passed && result.passed,
            ),
            liveness: faceVerification.liveness ?? nidVerificationResult.face.liveness,
            gaze: faceVerification.gaze ?? nidVerificationResult.face.gaze,
            comparison: result,
            liveFaceImageUri: nidVerificationResult.face.liveFaceImageUri,
            referenceFaceImageUri: nidVerificationResult.face.referenceFaceImageUri,
          },
          debug: {
            mockedFace: false,
            mockedNfc: nidVerificationResult.debug?.mockedNfc ?? false,
            stepsCompleted: nidVerificationResult.debug?.stepsCompleted ?? [
              'front-scan',
              'back-scan',
              'nfc-read',
            ],
          },
        }

        setNidVerificationResult(mergedFaceResult)
        setComparisonState('success')
        await runMockNidProofGeneration(toNidProofInputAdapterData(mergedFaceResult))
        return
      }
      setComparisonState('success')
      successTransitionTimeoutRef.current = setTimeout(() => {
        setCurrentStep(Steps.DocumentPreviewStep)
      }, 2000)
    } catch (error) {
      const code = error instanceof Error ? error.name || error.message : 'unknown_error'
      const message = error instanceof Error ? error.message : 'unknown_error'
      logFaceDebug('compare-error', {
        code,
        message,
      })
      setComparisonState('failed')
      if (code === 'REFERENCE_IMAGE_UNAVAILABLE') {
        setErrorMessage('Passport portrait is missing. Please retry NFC read.')
      } else if (code === 'LIVE_IMAGE_UNAVAILABLE') {
        setErrorMessage('Live capture failed. Please retry.')
      } else if (code === 'FACE_NOT_DETECTED') {
        setErrorMessage('No face detected. Keep your face centered and retry.')
      } else if (code === 'MULTIPLE_FACES_DETECTED') {
        setErrorMessage('Multiple faces detected. Ensure only one face is in frame and retry.')
      } else {
        setErrorMessage(
          isFaceDebugEnabled()
            ? `Face comparison failed (${code}). Please retry.`
            : 'Face comparison failed. Please retry.',
        )
      }
    } finally {
      setIsBusy(false)
    }
  }

  const similarityPercent =
    comparisonResult && typeof comparisonResult.similarity === 'number'
      ? Math.round(comparisonResult.similarity * 100)
      : null

  return (
    <View style={{ paddingTop: insets.top, paddingBottom: insets.bottom }} className='flex-1 p-6'>
      {comparisonState === 'ready' && cameraReady && device ? (
        <Camera
          ref={cameraRef}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          device={device}
          isActive
          photo
        />
      ) : (
        <View className='absolute inset-0 bg-backgroundPrimary' />
      )}

      <View className='flex-row items-center'>
        <Text className='typography-h5 text-textPrimary'>Face Comparison</Text>
        <View className='flex-1' />
        <Pressable
          onPress={() => {
            navigation.navigate('App', { screen: 'Home' })
          }}
        >
          <View className='h-10 w-10 items-center justify-center rounded-full bg-componentPrimary'>
            <UiIcon customIcon='closeIcon' size={20} className='color-textPrimary' />
          </View>
        </Pressable>
      </View>

      <Text className='typography-body3 mt-3 text-textSecondary'>
        Capture a live selfie, preview both 112x112 cropped faces, then run comparison.
      </Text>

      <View className='mt-6 rounded-xl bg-componentPrimary p-4'>
        {portraitUri ? (
          <View className='mb-4 items-center'>
            <Image
              source={{ uri: portraitUri }}
              style={{ width: 92, height: 92, borderRadius: 999 }}
            />
            <Text className='typography-body4 mt-2 text-textSecondary'>
              Passport portrait loaded
            </Text>
          </View>
        ) : null}

        {croppedPreviewUris ? (
          <View className='mb-4 flex-row items-start justify-center gap-5'>
            <View className='items-center'>
              <Image
                source={{ uri: croppedPreviewUris.referenceUri }}
                style={{ width: 112, height: 112, borderRadius: 10 }}
              />
              <Text className='typography-body4 mt-2 text-textSecondary'>Passport crop</Text>
            </View>
            <View className='items-center'>
              <Image
                source={{ uri: croppedPreviewUris.liveUri }}
                style={{ width: 112, height: 112, borderRadius: 10 }}
              />
              <Text className='typography-body4 mt-2 text-textSecondary'>Live crop</Text>
            </View>
          </View>
        ) : null}

        <Text className='typography-body3 text-textPrimary'>
          {comparisonState === 'initializing'
            ? 'Preparing face model...'
            : comparisonState === 'capturing'
              ? 'Comparing live face with passport portrait...'
              : comparisonState === 'cropped'
                ? 'Cropped previews ready. Review them, then compare.'
                : comparisonState === 'success'
                  ? 'Face comparison passed.'
                  : comparisonState === 'failed'
                    ? (errorMessage ?? 'Face comparison did not pass.')
                    : 'Align your face and capture when ready.'}
        </Text>

        {comparisonState === 'initializing' || comparisonState === 'capturing' ? (
          <ActivityIndicator className='mt-3 color-primaryMain' />
        ) : null}

        {similarityPercent !== null ? (
          <Text className='typography-body4 mt-2 text-textSecondary'>
            Similarity score: {similarityPercent}%
          </Text>
        ) : null}
      </View>

      <View className='mt-auto gap-3'>
        <UiButton
          title={comparisonState === 'cropped' ? 'Compare Cropped Faces' : 'Capture and Prepare'}
          onPress={comparisonState === 'cropped' ? handleComparePrepared : handleCaptureAndPrepare}
          className='w-full'
          disabled={
            comparisonState === 'initializing' ||
            comparisonState === 'capturing' ||
            comparisonState === 'success' ||
            !portraitUri ||
            !device ||
            !hasPermission
          }
        />
        <UiButton
          title='Retry'
          variant='outlined'
          onPress={() => {
            setComparisonResult(null)
            setCroppedPreviewUris(null)
            setErrorMessage(null)
            if (successTransitionTimeoutRef.current) {
              clearTimeout(successTransitionTimeoutRef.current)
              successTransitionTimeoutRef.current = null
            }
            setComparisonState(portraitUri ? 'ready' : 'failed')
          }}
          className='w-full'
          disabled={comparisonState === 'capturing' || comparisonState === 'success'}
        />
        <UiButton
          title='Back to Gaze Challenge'
          variant='outlined'
          onPress={() => setCurrentStep(Steps.FaceGazeStep)}
          className='w-full'
          disabled={comparisonState === 'capturing' || comparisonState === 'success'}
        />
        <UiButton
          title='Skip to Document Preview'
          variant='outlined'
          onPress={() => setCurrentStep(Steps.DocumentPreviewStep)}
          className='w-full'
          disabled={comparisonState === 'capturing' || comparisonState === 'success'}
        />
      </View>
    </View>
  )
}
