import {
  buildGazeChallengeResult,
  evaluateGazeSample,
  type GazeDetectorFace,
  type GazeSample,
  type GazeWaypoint,
  generateGazeWaypoints,
} from '@iland/passport-verification'
import { useIsFocused, useNavigation } from '@react-navigation/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Text, useWindowDimensions, View } from 'react-native'
import { Pressable } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  Camera as VisionCamera,
  runAsync,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera'
import {
  type FrameFaceDetectionOptions,
  useFaceDetector,
} from 'react-native-vision-camera-face-detector'
import { Worklets } from 'react-native-worklets-core'

import { Steps, useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'
import { UiButton, UiIcon } from '@/ui'

type GazeState = 'idle' | 'running' | 'success' | 'failed'

const WAYPOINT_DWELL_MS = 1500
const WAYPOINT_ANIMATION_MS = 500
const CAMERA_STARTUP_DELAY_MS = 250
const USER_FRIENDLY_GAZE_CONFIG = {
  waypointCount: 4,
  yawRange: 18,
  pitchRange: 10,
  errorThreshold: 16,
  passRatioThreshold: 0.4,
}

export default function GazeChallengeStep(): JSX.Element {
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const isFocused = useIsFocused()
  const { width, height } = useWindowDimensions()
  const { setCurrentStep, setFaceGazeResult } = useDocumentScanContext()

  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice('front')

  const [gazeState, setGazeState] = useState<GazeState>('idle')
  const [faceDetected, setFaceDetected] = useState(false)
  const [currentWaypointIndex, setCurrentWaypointIndex] = useState(0)
  const [latestScorePercent, setLatestScorePercent] = useState(0)
  const [cameraReady, setCameraReady] = useState(false)

  const runningRef = useRef(false)
  const finishedRef = useRef(false)
  const startedAtRef = useRef(0)
  const waypointsRef = useRef<GazeWaypoint[]>([])
  const samplesRef = useRef<GazeSample[]>([])
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const faceDetectionOptions = useRef<FrameFaceDetectionOptions>({
    performanceMode: 'fast',
    classificationMode: 'all',
    landmarkMode: 'all',
    contourMode: 'none',
    cameraFacing: 'front',
    autoMode: true,
  }).current
  const { detectFaces, stopListeners } = useFaceDetector(faceDetectionOptions)

  const dotX = useSharedValue(width / 2)
  const dotY = useSharedValue(height / 2)

  useEffect(() => {
    if (!hasPermission) {
      void requestPermission()
    }
  }, [hasPermission, requestPermission])

  useEffect(() => {
    const timeout = setTimeout(() => {
      setCameraReady(true)
    }, CAMERA_STARTUP_DELAY_MS)

    return () => {
      clearTimeout(timeout)
      setCameraReady(false)
    }
  }, [])

  useEffect(() => {
    return () => {
      stopListeners()
    }
  }, [stopListeners])

  useEffect(() => {
    return () => {
      runningRef.current = false
      finishedRef.current = false
      if (dwellTimerRef.current) {
        clearTimeout(dwellTimerRef.current)
        dwellTimerRef.current = null
      }
    }
  }, [])

  const totalTargets = waypointsRef.current.length
  const isCameraActive = Boolean(isFocused && hasPermission && device && cameraReady)

  const statusText = useMemo(() => {
    if (!hasPermission) return 'Camera permission is required for gaze challenge.'
    if (!device) return 'Front camera is not available on this device.'
    if (gazeState === 'running') return 'Follow the white dot with your eyes.'
    if (gazeState === 'success') return 'Gaze challenge completed.'
    if (gazeState === 'failed') {
      return 'Gaze challenge did not pass. Retry with your face centered and stable lighting.'
    }
    return faceDetected ? 'Face detected. Start when ready.' : 'Position your face in view.'
  }, [device, faceDetected, gazeState, hasPermission])

  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dotX.value - 14 }, { translateY: dotY.value - 14 }],
  }))

  const completeChallenge = () => {
    if (finishedRef.current) return

    finishedRef.current = true
    runningRef.current = false
    if (dwellTimerRef.current) {
      clearTimeout(dwellTimerRef.current)
      dwellTimerRef.current = null
    }

    const completedAt = Date.now()
    const result = buildGazeChallengeResult({
      samples: samplesRef.current,
      targetsCompleted: waypointsRef.current.length,
      targetsTotal: waypointsRef.current.length,
      startedAt: startedAtRef.current,
      completedAt,
      passRatioThreshold: USER_FRIENDLY_GAZE_CONFIG.passRatioThreshold,
    })

    const score = typeof result.score === 'number' ? result.score : 0
    setLatestScorePercent(Math.round(score * 100))

    if (result.passed) {
      setGazeState('success')
      setFaceGazeResult(result)
      setCurrentStep(Steps.FaceComparisonStep)
      return
    }

    setGazeState('failed')
  }

  const moveToWaypoint = (index: number) => {
    const waypoint = waypointsRef.current[index]
    if (!waypoint) {
      completeChallenge()
      return
    }

    setCurrentWaypointIndex(index)
    dotX.value = withTiming(waypoint.x, { duration: WAYPOINT_ANIMATION_MS })
    dotY.value = withTiming(waypoint.y, { duration: WAYPOINT_ANIMATION_MS })

    if (dwellTimerRef.current) {
      clearTimeout(dwellTimerRef.current)
    }

    dwellTimerRef.current = setTimeout(() => {
      moveToWaypoint(index + 1)
    }, WAYPOINT_DWELL_MS)
  }

  const startGazeChallenge = () => {
    const waypoints = generateGazeWaypoints({ width, height }, USER_FRIENDLY_GAZE_CONFIG)

    waypointsRef.current = waypoints
    samplesRef.current = []
    runningRef.current = true
    finishedRef.current = false
    startedAtRef.current = Date.now()
    setLatestScorePercent(0)
    setCurrentWaypointIndex(0)
    setGazeState('running')

    moveToWaypoint(0)
  }

  const handleFacesDetected = (faces: GazeDetectorFace[]) => {
    const hasFace = faces.length > 0
    setFaceDetected(hasFace)

    if (!runningRef.current || finishedRef.current || !hasFace) return

    const activeFace = faces[0]
    const activeWaypoint = waypointsRef.current[currentWaypointIndex]
    if (!activeFace || !activeWaypoint) return

    const evaluation = evaluateGazeSample(
      activeFace,
      activeWaypoint,
      { width, height },
      USER_FRIENDLY_GAZE_CONFIG,
    )
    samplesRef.current.push({
      ...evaluation,
      waypointIndex: currentWaypointIndex,
      timestamp: Date.now(),
    })
  }

  const onFacesDetected = Worklets.createRunOnJS((faces: GazeDetectorFace[]) => {
    handleFacesDetected(faces)
  })

  const frameProcessor = useFrameProcessor(
    frame => {
      'worklet'
      runAsync(frame, () => {
        'worklet'
        const faces = detectFaces(frame)
        onFacesDetected(faces as unknown as GazeDetectorFace[])
      })
    },
    [detectFaces, onFacesDetected],
  )

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

      {gazeState === 'running' ? (
        <Animated.View
          style={dotStyle}
          className='absolute h-7 w-7 rounded-full border border-white/70 bg-white shadow-2xl'
          pointerEvents='none'
        />
      ) : null}

      <View className='flex-1 bg-black/45 p-6'>
        <View className='flex-row items-center'>
          <Text className='typography-h5 text-white'>Gaze Challenge</Text>
          <View className='flex-1' />
          <Pressable onPress={() => navigation.navigate('App', { screen: 'Home' })}>
            <View className='h-10 w-10 items-center justify-center rounded-full bg-white/15'>
              <UiIcon customIcon='closeIcon' size={20} className='color-white' />
            </View>
          </Pressable>
        </View>

        <View className='mt-6 rounded-xl bg-black/40 p-4'>
          <Text className='typography-body3 text-white'>{statusText}</Text>
          {gazeState === 'running' ? (
            <Text className='typography-body4 mt-2 text-white/80'>
              Target {Math.min(currentWaypointIndex + 1, totalTargets)} of {totalTargets}
            </Text>
          ) : null}
          {gazeState === 'failed' ? (
            <Text className='typography-body4 mt-2 text-white/80'>
              Last score: {latestScorePercent}%
            </Text>
          ) : null}
        </View>

        <View className='mt-auto gap-3'>
          <UiButton
            title={gazeState === 'failed' ? 'Retry Gaze Challenge' : 'Start Gaze Challenge'}
            onPress={startGazeChallenge}
            className='w-full'
            disabled={!faceDetected || !hasPermission || !device}
          />
          <UiButton
            title='Back to Liveness'
            variant='outlined'
            onPress={() => setCurrentStep(Steps.FaceLivenessStep)}
            className='w-full'
            disabled={gazeState === 'running'}
          />
        </View>
      </View>
    </View>
  )
}
