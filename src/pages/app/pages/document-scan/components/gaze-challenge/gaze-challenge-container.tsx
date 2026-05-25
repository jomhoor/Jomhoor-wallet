import {
  buildUnifiedGazeChallengeResult,
  type ChallengeSample,
  createHeadPoseMirrorValidationState,
  evaluateUnifiedGazeSample,
  GAZE_CHALLENGE_MODE,
  generateUnifiedGazeWaypoints,
  getDefaultUnifiedChallengeConfig,
  type HeadPose,
  type HeadPoseMirrorMode,
  type HeadPoseMirrorValidationState,
  resolveHeadPoseMirrorModeFromValidation,
  updateHeadPoseMirrorValidationState,
  updateUnifiedWaypointProgress,
  type Waypoint,
  type WaypointProgressState,
} from '@iland/passport-verification'
import { useIsFocused, useNavigation } from '@react-navigation/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Platform, Text, useWindowDimensions, View } from 'react-native'
import { Pressable } from 'react-native-gesture-handler'
import { useSharedValue, withTiming } from 'react-native-reanimated'
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
import { Worklets } from 'react-native-worklets-core'

import { Steps, useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'
import { UiButton, UiIcon } from '@/ui'

import { GazeChallengeComponentDot } from './gaze-challenge-dot'
import { GazeChallengeComponentFace } from './gaze-challenge-face'
import { GazeChallengeComponentSmartFace } from './gaze-challenge-smart-face'

type GazeState = 'idle' | 'running' | 'success' | 'failed'
type LivenessGuideMode = 'headPoseOverlay' | 'dot' | 'smartFace'

const CAMERA_STARTUP_DELAY_MS = 250
const WAYPOINT_ANIMATION_MS = 380
const WAYPOINT_SETTLE_MS = 220
const MAX_PROGRESS_DELTA_MS = 250

type GazeDetectorFace = {
  yawAngle?: number
  pitchAngle?: number
  headEulerAngleX?: number
  headEulerAngleY?: number
  headEulerAngleZ?: number
  rollAngle?: number
}

function toHeadPose(face: GazeDetectorFace): HeadPose {
  const yawDegCandidate = face.yawAngle ?? face.headEulerAngleY ?? 0
  const pitchDegCandidate = face.pitchAngle ?? face.headEulerAngleX ?? 0
  const rollDegCandidate = face.rollAngle ?? face.headEulerAngleZ

  const yawDeg = Number.isFinite(yawDegCandidate) ? yawDegCandidate : 0
  const pitchDeg = Number.isFinite(pitchDegCandidate) ? pitchDegCandidate : 0

  return {
    yawDeg,
    pitchDeg,
    ...(typeof rollDegCandidate === 'number' ? { rollDeg: rollDegCandidate } : {}),
  }
}

function getPromptForWaypoint(waypoint: Waypoint | undefined): string {
  if (!waypoint) return 'Match the face pose.'

  const absYaw = Math.abs(waypoint.targetYawDeg)
  const absPitch = Math.abs(waypoint.targetPitchDeg)

  if (absYaw < 6 && absPitch < 6) return 'Hold your head centered.'

  if (absYaw >= absPitch) {
    return waypoint.targetYawDeg >= 0 ? 'Turn slightly right.' : 'Turn slightly left.'
  }

  return waypoint.targetPitchDeg >= 0 ? 'Look up slightly.' : 'Look down slightly.'
}

function normalizeMirrorModeLabel(mode: HeadPoseMirrorMode): string {
  if (mode === 'mirrored') return 'Mirrored'
  if (mode === 'normal') return 'Normal'
  return 'Calibrating'
}

function getGuideModeForConfiguration(): LivenessGuideMode {
  if (GAZE_CHALLENGE_MODE === 'face') return 'headPoseOverlay'
  if (GAZE_CHALLENGE_MODE === 'smart-face') return 'smartFace'
  return 'dot'
}

export default function GazeChallengeContainer(): JSX.Element {
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const isFocused = useIsFocused()
  const { width, height } = useWindowDimensions()
  const { setCurrentStep, setFaceGazeResult } = useDocumentScanContext()

  const challengeConfig = useMemo(() => getDefaultUnifiedChallengeConfig(), [])
  const guideMode: LivenessGuideMode = getGuideModeForConfiguration()

  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice('front')

  const [gazeState, setGazeState] = useState<GazeState>('idle')
  const [faceDetected, setFaceDetected] = useState(false)
  const [multipleFaces, setMultipleFaces] = useState(false)
  const [currentWaypointIndex, setCurrentWaypointIndex] = useState(0)
  const [latestScorePercent, setLatestScorePercent] = useState(0)
  const [cameraReady, setCameraReady] = useState(false)
  const [mirrorModeLabel, setMirrorModeLabel] = useState<HeadPoseMirrorMode>('unknown')

  const runningRef = useRef(false)
  const finishedRef = useRef(false)
  const startedAtRef = useRef(0)
  const waypointsRef = useRef<Waypoint[]>([])
  const samplesRef = useRef<ChallengeSample[]>([])
  const currentWaypointProgressRef = useRef<WaypointProgressState>({
    stableMs: 0,
    elapsedMs: 0,
    completed: false,
    timedOut: false,
  })
  const mirrorValidationRef = useRef<HeadPoseMirrorValidationState>(
    createHeadPoseMirrorValidationState(),
  )
  const mirrorModeRef = useRef<HeadPoseMirrorMode>('unknown')
  const lastProgressTickAtRef = useRef(0)
  const waypointValidationUnlockedAtRef = useRef(0)

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
  const guideYaw = useSharedValue(0)
  const guidePitch = useSharedValue(0)

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
    }
  }, [])

  const totalTargets = waypointsRef.current.length
  const activeWaypoint = waypointsRef.current[currentWaypointIndex]
  const isCameraActive = Boolean(isFocused && hasPermission && device && cameraReady)

  const statusText = useMemo(() => {
    if (!hasPermission) return 'Camera permission is required for gaze challenge.'
    if (!device) return 'Front camera is not available on this device.'
    if (gazeState === 'running') {
      if (multipleFaces) return 'Only one face should be visible in the camera.'
      if (!faceDetected) return 'Keep your face centered in the frame.'
      return 'Match the guide face pose.'
    }
    if (gazeState === 'success') return 'Gaze challenge completed.'
    if (gazeState === 'failed') return 'Gaze challenge did not pass. Please retry.'
    return faceDetected ? 'Face detected. Start when ready.' : 'Position your face in view.'
  }, [device, faceDetected, gazeState, hasPermission, multipleFaces])

  const promptText = useMemo(() => {
    if (gazeState !== 'running') return 'You will follow face pose prompts.'
    return getPromptForWaypoint(activeWaypoint)
  }, [activeWaypoint, gazeState])

  const finalizeChallenge = (passed: boolean, failureReason?: string) => {
    if (finishedRef.current) return

    finishedRef.current = true
    runningRef.current = false

    const completedAt = Date.now()

    const result = buildUnifiedGazeChallengeResult({
      samples: samplesRef.current,
      targetsCompleted: Math.min(
        currentWaypointIndex + (passed ? 1 : 0),
        waypointsRef.current.length,
      ),
      targetsTotal: waypointsRef.current.length,
      startedAt: startedAtRef.current,
      completedAt,
      passRatioThreshold: 0.5,
    })

    setLatestScorePercent(Math.round(result.score * 100))

    setFaceGazeResult({
      ...result,
      debug: {
        ...result.debug,
        mirrorMode: mirrorModeRef.current,
        mirrorValidationSamples: mirrorValidationRef.current.sampleCount,
        failureReason,
        platform: Platform.OS,
      },
    })

    if (passed) {
      setGazeState('success')
      setCurrentStep(Steps.FaceComparisonStep)
      return
    }

    setGazeState('failed')
  }

  const moveGuideToWaypoint = (waypoint: Waypoint) => {
    guideYaw.value = withTiming(waypoint.targetYawDeg, { duration: WAYPOINT_ANIMATION_MS })
    guidePitch.value = withTiming(waypoint.targetPitchDeg, { duration: WAYPOINT_ANIMATION_MS })

    dotX.value = withTiming(waypoint.screenX * width, { duration: WAYPOINT_ANIMATION_MS })
    dotY.value = withTiming(waypoint.screenY * height, { duration: WAYPOINT_ANIMATION_MS })
  }

  const moveToWaypoint = (index: number) => {
    const waypoint = waypointsRef.current[index]
    if (!waypoint) {
      finalizeChallenge(true)
      return
    }

    setCurrentWaypointIndex(index)
    currentWaypointProgressRef.current = {
      stableMs: 0,
      elapsedMs: 0,
      completed: false,
      timedOut: false,
    }
    lastProgressTickAtRef.current = Date.now()
    waypointValidationUnlockedAtRef.current = Date.now() + WAYPOINT_SETTLE_MS

    moveGuideToWaypoint(waypoint)
  }

  const startGazeChallenge = () => {
    const waypoints = generateUnifiedGazeWaypoints(
      { width, height },
      {
        waypointCount: challengeConfig.waypointCount,
      },
    )

    waypointsRef.current = waypoints
    samplesRef.current = []
    runningRef.current = true
    finishedRef.current = false
    startedAtRef.current = Date.now()
    setLatestScorePercent(0)
    setCurrentWaypointIndex(0)
    setMirrorModeLabel('unknown')

    mirrorValidationRef.current = createHeadPoseMirrorValidationState()
    mirrorModeRef.current = 'unknown'
    currentWaypointProgressRef.current = {
      stableMs: 0,
      elapsedMs: 0,
      completed: false,
      timedOut: false,
    }

    setGazeState('running')

    moveToWaypoint(0)
  }

  const pushProgress = (matched: boolean, now: number) => {
    const deltaMs = Math.min(
      Math.max(now - lastProgressTickAtRef.current, 0),
      MAX_PROGRESS_DELTA_MS,
    )
    lastProgressTickAtRef.current = now

    const next = updateUnifiedWaypointProgress(currentWaypointProgressRef.current, {
      deltaMs,
      matched,
      config: challengeConfig,
    })

    currentWaypointProgressRef.current = next

    if (next.timedOut) {
      finalizeChallenge(false, 'waypoint_timeout')
      return
    }

    if (next.completed) {
      moveToWaypoint(currentWaypointIndex + 1)
    }
  }

  const handleFacesDetected = (faces: GazeDetectorFace[]) => {
    const hasSingleFace = faces.length === 1
    setFaceDetected(hasSingleFace)
    setMultipleFaces(faces.length > 1)

    if (!runningRef.current || finishedRef.current) return

    const active = waypointsRef.current[currentWaypointIndex]
    if (!active) return

    const now = Date.now()
    if (now < waypointValidationUnlockedAtRef.current) {
      lastProgressTickAtRef.current = now
      return
    }

    if (!hasSingleFace) {
      pushProgress(false, now)
      return
    }

    const headPose = toHeadPose(faces[0])

    mirrorValidationRef.current = updateHeadPoseMirrorValidationState(mirrorValidationRef.current, {
      detectedYawDeg: headPose.yawDeg,
      targetYawDeg: active.targetYawDeg,
      config: challengeConfig,
    })

    const resolvedMirrorMode = resolveHeadPoseMirrorModeFromValidation(mirrorValidationRef.current)
    if (resolvedMirrorMode !== mirrorModeRef.current) {
      mirrorModeRef.current = resolvedMirrorMode
      setMirrorModeLabel(resolvedMirrorMode)
    }

    const evaluation = evaluateUnifiedGazeSample(
      headPose.yawDeg,
      headPose.pitchDeg,
      active.targetYawDeg,
      active.targetPitchDeg,
      challengeConfig,
    )

    samplesRef.current.push({
      passed: evaluation.passed,
      yawErrorDeg: evaluation.yawErrorDeg,
      pitchErrorDeg: evaluation.pitchErrorDeg,
      expectedYaw: active.targetYawDeg,
      expectedPitch: active.targetPitchDeg,
      actualYaw: headPose.yawDeg,
      actualPitch: headPose.pitchDeg,
      waypointIndex: currentWaypointIndex,
      timestamp: now,
      mirrorMode: mirrorModeRef.current === 'unknown' ? undefined : mirrorModeRef.current,
    })

    pushProgress(evaluation.passed, now)
  }

  const onFacesDetected = Worklets.createRunOnJS((faces: GazeDetectorFace[]) => {
    handleFacesDetected(faces)
  })

  const frameProcessor = useFrameProcessor(
    frame => {
      'worklet'
      try {
        const faces = detectFaces(frame)
        onFacesDetected(faces as unknown as GazeDetectorFace[])
      } catch (error) {
        onFacesDetected([])
      }
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

      {guideMode === 'dot' && (
        <GazeChallengeComponentDot
          isRunning={gazeState === 'running'}
          waypointIndex={currentWaypointIndex}
          waypoints={waypointsRef.current}
          latestScorePercent={latestScorePercent}
          totalTargets={totalTargets}
          faceDetected={faceDetected}
          multipleFaces={multipleFaces}
          mirrorMode={mirrorModeRef.current === 'unknown' ? undefined : mirrorModeRef.current}
          screenWidth={width}
          screenHeight={height}
          onStart={startGazeChallenge}
          onRetry={startGazeChallenge}
          onExit={() => setCurrentStep(Steps.FaceLivenessStep)}
          dotX={dotX}
          dotY={dotY}
        />
      )}

      {guideMode === 'headPoseOverlay' && (
        <GazeChallengeComponentFace
          isRunning={gazeState === 'running'}
          waypointIndex={currentWaypointIndex}
          waypoints={waypointsRef.current}
          latestScorePercent={latestScorePercent}
          totalTargets={totalTargets}
          faceDetected={faceDetected}
          multipleFaces={multipleFaces}
          mirrorMode={mirrorModeRef.current === 'unknown' ? undefined : mirrorModeRef.current}
          screenWidth={width}
          screenHeight={height}
          onStart={startGazeChallenge}
          onRetry={startGazeChallenge}
          onExit={() => setCurrentStep(Steps.FaceLivenessStep)}
          guideYaw={guideYaw}
          guidePitch={guidePitch}
          challengeMaxYawDeg={challengeConfig.maxYawDeg}
          challengeMaxPitchDeg={challengeConfig.maxPitchDeg}
        />
      )}

      {guideMode === 'smartFace' && (
        <GazeChallengeComponentSmartFace
          isRunning={gazeState === 'running'}
          waypointIndex={currentWaypointIndex}
          waypoints={waypointsRef.current}
          latestScorePercent={latestScorePercent}
          totalTargets={totalTargets}
          faceDetected={faceDetected}
          multipleFaces={multipleFaces}
          mirrorMode={mirrorModeRef.current === 'unknown' ? undefined : mirrorModeRef.current}
          screenWidth={width}
          screenHeight={height}
          onStart={startGazeChallenge}
          onRetry={startGazeChallenge}
          onExit={() => setCurrentStep(Steps.FaceLivenessStep)}
          guideYaw={guideYaw}
          guidePitch={guidePitch}
          challengeMaxYawDeg={challengeConfig.maxYawDeg}
          challengeMaxPitchDeg={challengeConfig.maxPitchDeg}
        />
      )}

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
          <Text className='typography-body4 mt-2 text-white/80'>{promptText}</Text>
          {gazeState === 'running' ? (
            <Text className='typography-body4 mt-2 text-white/80'>
              Target {Math.min(currentWaypointIndex + 1, totalTargets)} of {totalTargets}
            </Text>
          ) : null}
          {gazeState === 'running' ? (
            <Text className='typography-body4 mt-2 text-white/70'>
              Mirror mode: {normalizeMirrorModeLabel(mirrorModeLabel)}
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
            disabled={!hasPermission || !device || multipleFaces}
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
