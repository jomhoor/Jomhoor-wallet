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

import { Steps, useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'
import { UiButton, UiIcon } from '@/ui'
import { DocType } from '@/utils/e-document'

type ComparisonState = 'loading-model' | 'preparing-images' | 'comparing' | 'failed' | 'success'

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

function getComparisonStatusText(params: {
  errorMessage: string | null
  isNidFlow: boolean
  state: ComparisonState
}): string {
  if (params.state === 'loading-model') return 'Preparing face model...'
  if (params.state === 'preparing-images') {
    return params.isNidFlow
      ? 'Preparing NID card face and captured live face...'
      : 'Preparing passport portrait and captured live face...'
  }
  if (params.state === 'comparing') {
    return params.isNidFlow
      ? 'Comparing live face with NID front image face crop...'
      : 'Comparing live face with passport portrait...'
  }
  if (params.state === 'success') return 'Face comparison passed.'
  return params.errorMessage ?? 'Face comparison did not pass.'
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
  const storedBiometrics = verificationUserData.biometrics
  const storedNidVerificationResult =
    nidVerificationResult ?? verificationUserData.document.nid.verification
  const storedPassportNfcDetails = passportNfcDetails ?? verificationUserData.document.passport.nfc
  const storedNidFrontImageUri = verificationUserData.document.nid.front?.imageUri
  const liveCaptureUri = storedBiometrics.images?.liveCaptureUri

  const [comparisonState, setComparisonState] = useState<ComparisonState>('loading-model')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [comparisonResult, setComparisonResult] = useState<FaceComparisonResult | null>(null)
  const [croppedPreviewUris, setCroppedPreviewUris] = useState<{
    referenceUri: string
    liveUri: string
  } | null>(null)
  const comparisonRunKeyRef = useRef<string | null>(null)
  const successTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const portraitUri = useMemo(
    () =>
      isNidFlow ? storedNidFrontImageUri : buildPortraitUri(storedPassportNfcDetails?.portrait),
    [isNidFlow, storedNidFrontImageUri, storedPassportNfcDetails?.portrait],
  )

  useEffect(() => {
    return () => {
      if (successTransitionTimeoutRef.current) {
        clearTimeout(successTransitionTimeoutRef.current)
        successTransitionTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const runKey = `${portraitUri ?? 'missing-reference'}:${liveCaptureUri ?? 'missing-live'}`

    const runComparison = async () => {
      if (!portraitUri) {
        setComparisonState('failed')
        setErrorMessage(
          isNidFlow
            ? 'NID front image was not found. Retry front capture and NFC.'
            : 'Passport portrait was not found. Please retry NFC read.',
        )
        return
      }

      if (!liveCaptureUri) {
        setComparisonState('failed')
        setErrorMessage('Live face photo was not captured. Retry face verification.')
        return
      }

      if (comparisonRunKeyRef.current === runKey) return
      comparisonRunKeyRef.current = runKey

      try {
        setComparisonState('loading-model')
        setErrorMessage(null)
        setComparisonResult(null)
        setCroppedPreviewUris(null)

        logFaceDebug('prepare-start', {
          hasLiveCaptureUri: true,
          hasPortraitBase64: typeof storedPassportNfcDetails?.portrait?.base64 === 'string',
          hasPortraitFilePath: typeof storedPassportNfcDetails?.portrait?.filePath === 'string',
          hasPortraitUri: true,
        })

        await preloadFaceComparisonModel()
        if (!mounted) return

        setComparisonState('preparing-images')
        const [preparedReferenceUri, preparedLiveUri] = await Promise.all([
          getCenteredFaceSquareCrop(portraitUri),
          getCenteredFaceSquareCrop(liveCaptureUri),
        ])
        if (!mounted) return

        setCroppedPreviewUris({
          liveUri: preparedLiveUri,
          referenceUri: preparedReferenceUri,
        })
        setVerificationUserData(previous => ({
          ...previous,
          biometrics: {
            ...previous.biometrics,
            images: {
              ...previous.biometrics.images,
              liveCaptureUri,
              liveCropUri: preparedLiveUri,
              referenceCropUri: preparedReferenceUri,
              referenceUri: portraitUri,
            },
          },
          evidence: [
            ...previous.evidence,
            {
              keys: [
                'biometrics.images.referenceUri',
                'biometrics.images.referenceCropUri',
                'biometrics.images.liveCropUri',
              ],
              source: 'camera',
              step: 'face-comparison-prepare',
              storedAt: Date.now(),
            },
          ],
        }))

        setComparisonState('comparing')
        const result = await compareFaces({
          liveImageUri: preparedLiveUri,
          referenceImage: { uri: preparedReferenceUri },
          threshold: DEFAULT_FACE_COMPARISON_THRESHOLD,
          modelName: 'mobilefacenet',
          alreadyPreprocessed: true,
        })
        if (!mounted) return

        logFaceDebug('compare-result', {
          passed: result.passed,
          similarity: result.similarity,
          threshold: result.threshold,
        })

        setComparisonResult(result)

        if (!result.passed) {
          setComparisonState('failed')
          setErrorMessage(
            'Face match confidence is too low. Retry with better lighting and framing.',
          )
          return
        }

        setFaceComparisonResult(result)
        if (docType === DocType.ID) {
          if (!storedNidVerificationResult) {
            setComparisonState('failed')
            setErrorMessage('NID verification data is missing. Retry NID verification.')
            return
          }

          const livenessResult =
            faceVerification.liveness ??
            storedBiometrics.liveness ??
            storedNidVerificationResult.face.liveness
          const gazeResult =
            faceVerification.gaze ?? storedBiometrics.gaze ?? storedNidVerificationResult.face.gaze
          const facePassed = Boolean(livenessResult?.passed && gazeResult?.passed && result.passed)
          const verified = Boolean(storedNidVerificationResult.verified && facePassed)
          const mergedFaceResult: NidVerificationResult = {
            ...storedNidVerificationResult,
            verified,
            finalDecision: verified ? 'verified' : 'failed',
            face: {
              passed: facePassed,
              liveness: livenessResult,
              gaze: gazeResult,
              comparison: result,
              liveFaceImageUri: liveCaptureUri,
              referenceFaceImageUri: preparedReferenceUri,
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
        if (!mounted) return
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
          setErrorMessage('Live capture failed. Please retry face verification.')
        } else if (code === 'FACE_NOT_DETECTED') {
          setErrorMessage('No face detected. Retry face verification with your face centered.')
        } else if (code === 'MULTIPLE_FACES_DETECTED') {
          setErrorMessage('Multiple faces detected. Ensure only one face is in frame and retry.')
        } else {
          setErrorMessage(
            isFaceDebugEnabled()
              ? `Face comparison failed (${code}). Please retry.`
              : 'Face comparison failed. Please retry.',
          )
        }
      }
    }

    void runComparison()
    return () => {
      mounted = false
    }
  }, [
    createIdentity,
    docType,
    faceVerification.gaze,
    faceVerification.liveness,
    isNidFlow,
    liveCaptureUri,
    portraitUri,
    setCurrentStep,
    setFaceComparisonResult,
    setNidProofInputAdapter,
    setNidVerificationResult,
    setVerificationUserData,
    storedBiometrics.gaze,
    storedBiometrics.liveness,
    storedNidVerificationResult,
    storedPassportNfcDetails?.portrait?.base64,
    storedPassportNfcDetails?.portrait?.filePath,
  ])

  const similarityPercent =
    comparisonResult && typeof comparisonResult.similarity === 'number'
      ? Math.round(comparisonResult.similarity * 100)
      : null
  const isBusy =
    comparisonState === 'loading-model' ||
    comparisonState === 'preparing-images' ||
    comparisonState === 'comparing'

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
        We captured your live face at the final centered waypoint and are comparing it
        automatically.
      </Text>

      <View className='mt-6 rounded-xl bg-componentPrimary p-4'>
        {portraitUri ? (
          <View className='mb-4 items-center'>
            <Image
              source={{ uri: portraitUri }}
              style={{ width: 92, height: 92, borderRadius: 999 }}
            />
            <Text className='typography-body4 mt-2 text-textSecondary'>
              {isNidFlow ? 'NID front image loaded' : 'Passport portrait loaded'}
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
                {isNidFlow ? 'Card front crop' : 'Passport crop'}
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
          {getComparisonStatusText({
            errorMessage,
            isNidFlow,
            state: comparisonState,
          })}
        </Text>

        {isBusy ? <ActivityIndicator className='mt-3 color-primaryMain' /> : null}

        {similarityPercent !== null ? (
          <Text className='typography-body4 mt-2 text-textSecondary'>
            Similarity score: {similarityPercent}%
          </Text>
        ) : null}
      </View>

      <View className='mt-auto gap-3'>
        <UiButton
          title='Retry Face Verification'
          variant='outlined'
          onPress={() => {
            comparisonRunKeyRef.current = null
            setComparisonResult(null)
            setCroppedPreviewUris(null)
            setErrorMessage(null)
            if (successTransitionTimeoutRef.current) {
              clearTimeout(successTransitionTimeoutRef.current)
              successTransitionTimeoutRef.current = null
            }
            setCurrentStep(Steps.FaceGazeStep)
          }}
          className='w-full'
          disabled={isBusy || comparisonState === 'success'}
        />
        <UiButton
          title='Back to Face Verification'
          variant='outlined'
          onPress={() => setCurrentStep(Steps.FaceGazeStep)}
          className='w-full'
          disabled={isBusy || comparisonState === 'success'}
        />
        {!isNidFlow ? (
          <UiButton
            title='Skip to Document Preview'
            variant='outlined'
            onPress={() => setCurrentStep(Steps.DocumentPreviewStep)}
            className='w-full'
            disabled={isBusy || comparisonState === 'success'}
          />
        ) : null}
      </View>
    </View>
  )
}
