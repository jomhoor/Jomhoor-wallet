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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { Pressable } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Steps, useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'
import { appCapabilitiesStore } from '@/store'
import { UiButton, UiIcon } from '@/ui'
import { DocType } from '@/utils/e-document'

import DemoModeBanner from './DemoModeBanner'

type ComparisonState = 'initializing' | 'ready' | 'capturing' | 'cropped' | 'failed' | 'success'

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

  const {
    createIdentity,
    docType,
    faceVerification,
    nidVerificationResult,
    passportNfcDetails,
    setCurrentStep,
    setFaceComparisonResult,
    setNidProofInputAdapter,
    setNidVerificationResult,
    setVerificationUserData,
    verificationUserData,
  } = useDocumentScanContext()
  const isNidFlow = docType === DocType.ID
  const passportDemoModeEnabled = appCapabilitiesStore.usePassportDemoModeEnabled()
  const isDemoMode =
    !isNidFlow && verificationUserData.session.mode === 'demo' && passportDemoModeEnabled
  const storedBiometrics = verificationUserData.biometrics
  const storedNidVerificationResult =
    nidVerificationResult ?? verificationUserData.document.nid.verification
  const storedPassportNfcDetails = passportNfcDetails ?? verificationUserData.document.passport.nfc
  const storedNidFrontImageUri = verificationUserData.document.nid.front?.imageUri
  const liveCaptureUri = storedBiometrics.images?.liveCaptureUri

  const [comparisonState, setComparisonState] = useState<ComparisonState>('initializing')
  const [isBusy, setIsBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [comparisonResult, setComparisonResult] = useState<FaceComparisonResult | null>(null)
  const [croppedPreviewUris, setCroppedPreviewUris] = useState<{
    referenceUri: string
    liveUri: string
  } | null>(null)
  const successTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const portraitUri = useMemo(
    () =>
      isNidFlow
        ? storedNidFrontImageUri
        : isDemoMode
          ? liveCaptureUri
          : buildPortraitUri(storedPassportNfcDetails?.portrait),
    [
      isDemoMode,
      isNidFlow,
      liveCaptureUri,
      storedNidFrontImageUri,
      storedPassportNfcDetails?.portrait,
    ],
  )

  useEffect(() => {
    if (!isDemoMode || !liveCaptureUri) return

    setVerificationUserData(previous => {
      if (previous.document.passport.nfc?.portrait?.filePath === liveCaptureUri) {
        return previous
      }

      return {
        ...previous,
        document: {
          ...previous.document,
          passport: {
            ...previous.document.passport,
            nfc: {
              ...previous.document.passport.nfc,
              portrait: {
                ...previous.document.passport.nfc?.portrait,
                filePath: liveCaptureUri,
              },
            },
          },
        },
      }
    })
  }, [isDemoMode, liveCaptureUri, setVerificationUserData])

  useEffect(() => {
    let mounted = true
    const prepare = async () => {
      try {
        logFaceDebug('prepare-start', {
          hasPortraitUri: Boolean(portraitUri),
          hasPortraitBase64: typeof storedPassportNfcDetails?.portrait?.base64 === 'string',
          hasPortraitFilePath: typeof storedPassportNfcDetails?.portrait?.filePath === 'string',
        })
        await preloadFaceComparisonModel()
        if (!mounted) return

        if (!portraitUri) {
          setComparisonState('failed')
          setErrorMessage(
            isNidFlow
              ? 'NID front image was not found. Retry front capture and NFC.'
              : 'Passport portrait was not found. You can retry NFC or continue to preview.',
          )
          return
        }

        if (!liveCaptureUri) {
          setComparisonState('failed')
          setErrorMessage('Live face photo was not captured. Retry face verification.')
          return
        }

        setComparisonState('ready')
        logFaceDebug('prepare-ready', {
          hasLiveCaptureUri: true,
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
    isNidFlow,
    liveCaptureUri,
    storedPassportNfcDetails?.portrait?.base64,
    storedPassportNfcDetails?.portrait?.filePath,
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

  const handleCaptureAndPrepare = useCallback(async () => {
    if (isBusy) return
    if (!liveCaptureUri || !portraitUri) return

    logFaceDebug('capture-start', {
      hasLiveCaptureUri: true,
      hasPortraitUri: Boolean(portraitUri),
    })
    setIsBusy(true)
    setErrorMessage(null)
    setComparisonResult(null)
    setCroppedPreviewUris(null)
    setComparisonState('capturing')

    try {
      const liveImageUri = liveCaptureUri
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
      setVerificationUserData(previous => ({
        ...previous,
        biometrics: {
          ...previous.biometrics,
          images: {
            ...previous.biometrics.images,
            liveCaptureUri: liveImageUri,
            liveCropUri: preparedLiveUri,
            referenceCropUri: preparedReferenceUri,
            referenceUri: portraitUri,
          },
        },
      }))
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
  }, [isBusy, liveCaptureUri, portraitUri, setVerificationUserData])

  useEffect(() => {
    if (comparisonState === 'ready' && !isBusy) {
      void handleCaptureAndPrepare()
    }
  }, [comparisonState, isBusy, handleCaptureAndPrepare])

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
      if (docType === DocType.ID && storedNidVerificationResult) {
        const mergedFaceResult: NidVerificationResult = {
          ...storedNidVerificationResult,
          verified: Boolean(
            storedNidVerificationResult.verified &&
              (faceVerification.liveness?.passed ?? storedBiometrics.liveness?.passed) &&
              (faceVerification.gaze?.passed ?? storedBiometrics.gaze?.passed) &&
              result.passed,
          ),
          finalDecision:
            storedNidVerificationResult.verified &&
            (faceVerification.liveness?.passed ?? storedBiometrics.liveness?.passed) &&
            (faceVerification.gaze?.passed ?? storedBiometrics.gaze?.passed) &&
            result.passed
              ? 'verified'
              : 'failed',
          face: {
            passed: Boolean(
              (faceVerification.liveness?.passed ?? storedBiometrics.liveness?.passed) &&
                (faceVerification.gaze?.passed ?? storedBiometrics.gaze?.passed) &&
                result.passed,
            ),
            liveness:
              faceVerification.liveness ??
              storedBiometrics.liveness ??
              storedNidVerificationResult.face.liveness,
            gaze:
              faceVerification.gaze ??
              storedBiometrics.gaze ??
              storedNidVerificationResult.face.gaze,
            comparison: result,
            liveFaceImageUri:
              storedBiometrics.images?.liveCaptureUri ??
              storedNidVerificationResult.face.liveFaceImageUri,
            referenceFaceImageUri:
              storedBiometrics.images?.referenceCropUri ??
              storedNidVerificationResult.face.referenceFaceImageUri,
          },
          debug: {
            mockedFace: false,
            mockedNfc: storedNidVerificationResult.debug?.mockedNfc ?? false,
            stepsCompleted: storedNidVerificationResult.debug?.stepsCompleted ?? [
              'front-scan',
              'back-scan',
              'nfc-read',
            ],
          },
        }

        setNidVerificationResult(mergedFaceResult)
        setNidProofInputAdapter(toNidProofInputAdapterData(mergedFaceResult))
        setComparisonState('success')
        await createIdentity()
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
        setErrorMessage(
          isNidFlow
            ? 'NID front image is missing. Retry front capture and NFC read.'
            : 'Passport portrait is missing. Please retry NFC read.',
        )
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
      <View className='absolute inset-0 bg-backgroundPrimary' />

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
        {isNidFlow
          ? 'Prepare the captured live face and compare it with the cropped face from NID front image.'
          : isDemoMode
            ? 'Prepare the captured live face and run the normal comparison path using it as the demo reference.'
            : 'Prepare the captured live face, preview both 112x112 cropped faces, then run comparison.'}
      </Text>

      {isDemoMode ? (
        <View className='mt-4'>
          <DemoModeBanner message='Demo mode: your live capture is used as both the reference and live image. The normal face comparison model still runs.' />
        </View>
      ) : null}

      <View className='mt-6 rounded-xl bg-componentPrimary p-4'>
        {portraitUri ? (
          <View className='mb-4 items-center'>
            <Image
              source={{ uri: portraitUri }}
              style={{ width: 92, height: 92, borderRadius: 999 }}
            />
            <Text className='typography-body4 mt-2 text-textSecondary'>
              {isNidFlow
                ? 'NID front image loaded'
                : isDemoMode
                  ? 'Demo reference image loaded'
                  : 'Passport portrait loaded'}
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
              <Text className='typography-body4 mt-2 text-textSecondary'>
                {isNidFlow
                  ? 'Card front crop'
                  : isDemoMode
                    ? 'Demo reference crop'
                    : 'Passport crop'}
              </Text>
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
              ? isNidFlow
                ? 'Comparing live face with NID front image face crop...'
                : isDemoMode
                  ? 'Comparing live face with demo reference...'
                  : 'Comparing live face with passport portrait...'
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
          title='Compare Cropped Faces'
          onPress={handleComparePrepared}
          className='w-full'
          disabled={comparisonState !== 'cropped' || isBusy}
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
            setComparisonState(portraitUri && liveCaptureUri ? 'ready' : 'failed')
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
