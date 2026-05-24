import type { ChallengeDefinition, DetectorFace } from '@iland/passport-verification'
import {
  buildLivenessResult,
  createLivenessChallengeSequence,
  evaluateLivenessChallenge,
} from '@iland/passport-verification'
import { useIsFocused, useNavigation } from '@react-navigation/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { Pressable } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  Camera as VisionCamera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera'
import {
  type FrameFaceDetectionOptions,
  useFaceDetector,
} from 'react-native-vision-camera-face-detector'

import { Steps, useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'
import { UiButton, UiIcon } from '@/ui'

type LivenessState = 'idle' | 'running' | 'done'

const STEP_DEBOUNCE_MS = 450
const CAMERA_TRANSITION_DELAY_MS = 250

export default function FaceLivenessStep(): JSX.Element {
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const isFocused = useIsFocused()
  const { setCurrentStep, setFaceLivenessResult } = useDocumentScanContext()

  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice('front')

  const [livenessState, setLivenessState] = useState<LivenessState>('idle')
  const [challengeIndex, setChallengeIndex] = useState(0)
  const [faceDetected, setFaceDetected] = useState(false)
  const [cameraEnabled, setCameraEnabled] = useState(true)

  const runningRef = useRef(false)
  const finishedRef = useRef(false)
  const stepPassedRef = useRef(false)
  const challengeIndexRef = useRef(0)
  const confidenceRef = useRef<Partial<Record<string, number>>>({})
  const startedAtRef = useRef(0)
  const sequenceRef = useRef<ChallengeDefinition[]>(createLivenessChallengeSequence())
  const faceDetectionOptions = useRef<FrameFaceDetectionOptions>({
    performanceMode: 'fast',
    classificationMode: 'all',
    landmarkMode: 'all',
    contourMode: 'none',
    cameraFacing: 'front',
    autoMode: true,
  }).current
  const { detectFaces, stopListeners } = useFaceDetector(faceDetectionOptions)

  const isCameraActive = Boolean(isFocused && hasPermission && device && cameraEnabled)
  useEffect(() => {
    if (!hasPermission) {
      void requestPermission()
    }
  }, [hasPermission, requestPermission])

  useEffect(() => {
    return () => {
      stopListeners()
    }
  }, [stopListeners])

  const totalSteps = sequenceRef.current.length
  const currentChallenge = sequenceRef.current[challengeIndex]

  const statusText = useMemo(() => {
    if (!hasPermission) return 'Camera permission is required for liveness check.'
    if (!device) return 'Front camera is not available on this device.'
    if (livenessState === 'done') return 'Liveness check completed.'
    if (livenessState === 'running') {
      return currentChallenge?.prompt ?? 'Follow on-screen instructions.'
    }
    return faceDetected ? 'Face detected. Start when ready.' : 'Position your face in view.'
  }, [currentChallenge?.prompt, device, faceDetected, hasPermission, livenessState])

  const handleFacesDetected = (faces: DetectorFace[]) => {
    const hasFace = faces.length > 0
    setFaceDetected(hasFace)

    if (!runningRef.current || finishedRef.current) {
      return
    }

    if (!hasFace) {
      return
    }

    if (faces.length > 1) {
      return
    }

    const face = faces[0]
    if (!face) return

    const activeChallenge = sequenceRef.current[challengeIndexRef.current]
    if (!activeChallenge) return

    const evaluation = evaluateLivenessChallenge(activeChallenge, face)

    if (!evaluation.passed || stepPassedRef.current) {
      return
    }

    stepPassedRef.current = true

    const nextConfidence = {
      ...confidenceRef.current,
      ...(typeof evaluation.confidence === 'number'
        ? { [activeChallenge.key]: evaluation.confidence }
        : {}),
    }
    confidenceRef.current = nextConfidence

    setTimeout(() => {
      stepPassedRef.current = false

      const next = challengeIndexRef.current + 1
      if (next >= totalSteps) {
        finishedRef.current = true
        runningRef.current = false
        setLivenessState('done')
        setCameraEnabled(false)
        stopListeners()

        const result = buildLivenessResult({
          sequence: sequenceRef.current,
          confidenceByKey: confidenceRef.current,
          startedAt: startedAtRef.current,
          completedAt: Date.now(),
        })

        setFaceLivenessResult(result)
        setTimeout(() => {
          setCurrentStep(Steps.FaceGazeStep)
        }, CAMERA_TRANSITION_DELAY_MS)
        return
      }

      challengeIndexRef.current = next
      setChallengeIndex(next)
    }, STEP_DEBOUNCE_MS)
  }

  const onFacesDetected = Worklets.createRunOnJS((faces: DetectorFace[]) => {
    handleFacesDetected(faces)
  })

  const frameProcessor = useFrameProcessor(
    frame => {
      'worklet'
      try {
        const faces = detectFaces(frame)
        onFacesDetected(faces as unknown as DetectorFace[])
      } catch (error) {
        onFacesDetected([])
      }
    },
    [detectFaces, onFacesDetected],
  )

  const startLiveness = () => {
    setCameraEnabled(true)
    sequenceRef.current = createLivenessChallengeSequence()
    runningRef.current = true
    finishedRef.current = false
    stepPassedRef.current = false
    setChallengeIndex(0)
    challengeIndexRef.current = 0
    confidenceRef.current = {}
    const started = Date.now()
    startedAtRef.current = started
    setLivenessState('running')
  }

  return (
    <View style={{ paddingTop: insets.top, paddingBottom: insets.bottom }} className='flex-1'>
      {isCameraActive && device ? (
        <VisionCamera
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          device={device}
          isActive={isCameraActive}
          frameProcessor={frameProcessor}
          pixelFormat='yuv'
        />
      ) : (
        <View className='absolute inset-0 items-center justify-center bg-backgroundPrimary'>
          <ActivityIndicator size='large' className='color-primaryMain' />
        </View>
      )}

      <View className='flex-1 bg-black/45 p-6'>
        <View className='flex-row items-center'>
          <Text className='typography-h5 text-white'>Face Liveness Check</Text>
          <View className='flex-1' />
          <Pressable onPress={() => navigation.navigate('App', { screen: 'Home' })}>
            <View className='h-10 w-10 items-center justify-center rounded-full bg-white/15'>
              <UiIcon customIcon='closeIcon' size={20} className='color-white' />
            </View>
          </Pressable>
        </View>

        <View className='mt-6 rounded-xl bg-black/40 p-4'>
          <Text className='typography-body3 text-white'>{statusText}</Text>
          <Text className='typography-body4 mt-2 text-white/80'>
            Step {Math.min(challengeIndex + 1, totalSteps)} of {totalSteps}
          </Text>
        </View>

        <View className='mt-auto gap-3'>
          <UiButton
            title={livenessState === 'running' ? 'Restart Liveness Check' : 'Start Liveness Check'}
            onPress={startLiveness}
            className='w-full'
            disabled={!faceDetected || !hasPermission || !device}
          />
          <UiButton
            title='Skip Face Checks'
            variant='outlined'
            onPress={() => setCurrentStep(Steps.DocumentPreviewStep)}
            className='w-full'
            disabled={livenessState === 'running'}
          />
        </View>
      </View>
    </View>
  )
}
