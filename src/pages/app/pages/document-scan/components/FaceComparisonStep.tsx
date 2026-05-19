import {
  compareFaces,
  DEFAULT_FACE_COMPARISON_THRESHOLD,
  type FaceComparisonResult,
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

type ComparisonState = 'initializing' | 'ready' | 'capturing' | 'failed' | 'success'

const CAMERA_STARTUP_DELAY_MS = 250

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

  const { passportNfcDetails, setCurrentStep, setFaceComparisonResult } = useDocumentScanContext()

  const [comparisonState, setComparisonState] = useState<ComparisonState>('initializing')
  const [cameraReady, setCameraReady] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [comparisonResult, setComparisonResult] = useState<FaceComparisonResult | null>(null)

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
      } catch {
        if (!mounted) return
        setComparisonState('failed')
        setErrorMessage('Face model is unavailable on this build. Please retry.')
      }
    }

    void prepare()
    return () => {
      mounted = false
    }
  }, [portraitUri])

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

  const handleCaptureAndCompare = async () => {
    if (isBusy) return
    if (!cameraRef.current || !device || !portraitUri) return

    setIsBusy(true)
    setErrorMessage(null)
    setComparisonState('capturing')

    try {
      const capturedPhoto = await cameraRef.current.takePhoto()
      const liveImageUri = capturedPhoto.path.startsWith('file://')
        ? capturedPhoto.path
        : `file://${capturedPhoto.path}`

      const result = await compareFaces({
        liveImageUri,
        referenceImage: passportNfcDetails?.portrait ?? {},
        threshold: DEFAULT_FACE_COMPARISON_THRESHOLD,
        modelName: 'mobilefacenet',
      })

      setComparisonResult(result)

      if (!result.passed) {
        setComparisonState('failed')
        setErrorMessage('Face match confidence is too low. Retry with better lighting and framing.')
        return
      }

      setFaceComparisonResult(result)
      setComparisonState('success')
      setCurrentStep(Steps.DocumentPreviewStep)
    } catch (error) {
      const code = error instanceof Error ? error.name || error.message : 'unknown_error'
      setComparisonState('failed')
      if (code === 'REFERENCE_IMAGE_UNAVAILABLE') {
        setErrorMessage('Passport portrait is missing. Please retry NFC read.')
      } else if (code === 'LIVE_IMAGE_UNAVAILABLE') {
        setErrorMessage('Live capture failed. Please retry.')
      } else {
        setErrorMessage('Face comparison failed. Please retry.')
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
        Capture a live selfie and match it with the passport portrait read from NFC.
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

        <Text className='typography-body3 text-textPrimary'>
          {comparisonState === 'initializing'
            ? 'Preparing face model...'
            : comparisonState === 'capturing'
              ? 'Comparing live face with passport portrait...'
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
          title='Capture and Compare'
          onPress={handleCaptureAndCompare}
          className='w-full'
          disabled={
            comparisonState === 'initializing' ||
            comparisonState === 'capturing' ||
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
            setErrorMessage(null)
            setComparisonState(portraitUri ? 'ready' : 'failed')
          }}
          className='w-full'
          disabled={comparisonState === 'capturing'}
        />
        <UiButton
          title='Back to Gaze Challenge'
          variant='outlined'
          onPress={() => setCurrentStep(Steps.FaceGazeStep)}
          className='w-full'
          disabled={comparisonState === 'capturing'}
        />
        <UiButton
          title='Skip to Document Preview'
          variant='outlined'
          onPress={() => setCurrentStep(Steps.DocumentPreviewStep)}
          className='w-full'
          disabled={comparisonState === 'capturing'}
        />
      </View>
    </View>
  )
}
