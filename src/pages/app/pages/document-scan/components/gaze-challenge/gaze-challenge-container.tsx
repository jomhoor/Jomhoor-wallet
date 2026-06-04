import {
  buildLivenessResult,
  buildUnifiedGazeChallengeResult,
  type ChallengeDefinition,
  type ChallengeSample,
  createHeadPoseMirrorValidationState,
  evaluateLivenessChallenge,
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
import { ActivityIndicator, Alert, Platform, Text, useWindowDimensions, View } from 'react-native'
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

import {
  appendFinalCenterCaptureWaypoint,
  createRequiredFaceLivenessSequence,
} from '@/pages/app/pages/document-scan/adapters'
import { Steps, useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'
import { UiButton, UiIcon } from '@/ui'
import { DocType } from '@/utils/e-document'

import { GazeChallengeComponentDot } from './gaze-challenge-dot'
import { GazeChallengeComponentFace } from './gaze-challenge-face'
import { GazeChallengeComponentSmartFace } from './gaze-challenge-smart-face'

type GazeState = 'idle' | 'running' | 'success' | 'failed'
type FaceChallengePhase = 'liveness' | 'gaze'
type FaceCountFailureReason = 'face_missing' | 'multiple_faces'
type LivenessGuideMode = 'headPoseOverlay' | 'dot' | 'smartFace'

const ENABLE_GAZE_DIAGNOSTICS = false
const GAZE_LOG_THROTTLE_MS = 200
const CAMERA_STARTUP_DELAY_MS = 250
const WAYPOINT_ANIMATION_MS = 380
const WAYPOINT_SETTLE_MS = 220
const MAX_PROGRESS_DELTA_MS = 250
const LIVENESS_STEP_DEBOUNCE_MS = 450
const FACE_COUNT_FAILURE_REASONS = new Set(['face_missing', 'multiple_faces'])

type GazeDetectorFace = {
  yawAngle?: number
  pitchAngle?: number
  headEulerAngleX?: number
  headEulerAngleY?: number
  headEulerAngleZ?: number
  leftEyeOpenProbability?: number
  rollAngle?: number
  rightEyeOpenProbability?: number
  smilingProbability?: number
}

function toHeadPose(face: GazeDetectorFace): HeadPose {
  const yawDegCandidate = face.yawAngle ?? face.headEulerAngleY ?? 0
  const pitchDegCandidate = face.pitchAngle ?? face.headEulerAngleX ?? 0
  const rollDegCandidate = face.rollAngle ?? face.headEulerAngleZ

  // Front camera preview/detection can be mirrored on many devices.
  // Apply deterministic correction for this flow: always flip yaw sign.
  const yawDeg = Number.isFinite(yawDegCandidate) ? -yawDegCandidate : 0
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

function getFaceCountFailureReason(faceCount: number): FaceCountFailureReason | undefined {
  if (faceCount === 1) return undefined
  return faceCount < 1 ? 'face_missing' : 'multiple_faces'
}

function formatNowTimestamp(value: number): string {
  const date = new Date(value)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  const ms = String(date.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

function toPositiveDegrees(value: number): number {
  const normalized = value % 360
  return normalized < 0 ? normalized + 360 : normalized
}

function toWaypointLabel(yaw: number, pitch: number): string {
  const yawLabel = yaw > 3 ? 'RIGHT' : yaw < -3 ? 'LEFT' : 'CENTER'
  const pitchLabel = pitch > 3 ? 'UP' : pitch < -3 ? 'DOWN' : 'CENTER'
  if (yawLabel === 'CENTER' && pitchLabel === 'CENTER') return 'CENTER'
  if (yawLabel === 'CENTER') return pitchLabel
  if (pitchLabel === 'CENTER') return yawLabel
  return `${pitchLabel}-${yawLabel}`
}

function logGazeDiagnostics(tag: string, payload: string) {
  if (!ENABLE_GAZE_DIAGNOSTICS) return
  const timestamp = formatNowTimestamp(Date.now())
  // eslint-disable-next-line no-console
  console.log(`[${tag.padEnd(8, ' ')} ${timestamp}] ${payload}`)
}

function resolveFaceVerificationBackStep(docType: DocType | undefined): Steps {
  if (docType === DocType.PASSPORT) return Steps.PassportNfcDetailsStep
  if (docType === DocType.ID) return Steps.ScanNfcStep
  return Steps.SelectDocTypeStep
}

function normalizePhotoUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`
}

export default function GazeChallengeContainer(): JSX.Element {
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const isFocused = useIsFocused()
  const { width, height } = useWindowDimensions()
  const {
    docType,
    setCurrentStep,
    setFaceGazeResult,
    setFaceLivenessResult,
    setVerificationUserData,
  } = useDocumentScanContext()

  const challengeConfig = useMemo(() => getDefaultUnifiedChallengeConfig(), [])
  const guideMode: LivenessGuideMode = getGuideModeForConfiguration()

  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice('front')

  const [gazeState, setGazeState] = useState<GazeState>('idle')
  const [challengePhase, setChallengePhase] = useState<FaceChallengePhase>('liveness')
  const [faceDetected, setFaceDetected] = useState(false)
  const [livenessChallengeIndex, setLivenessChallengeIndex] = useState(0)
  const [multipleFaces, setMultipleFaces] = useState(false)
  const [currentWaypointIndex, setCurrentWaypointIndex] = useState(0)
  const [latestScorePercent, setLatestScorePercent] = useState(0)
  const [cameraReady, setCameraReady] = useState(false)
  const [capturingFinalPhoto, setCapturingFinalPhoto] = useState(false)
  const [mirrorModeLabel, setMirrorModeLabel] = useState<HeadPoseMirrorMode>('unknown')

  const cameraRef = useRef<VisionCamera>(null)
  const challengePhaseRef = useRef<FaceChallengePhase>('liveness')
  const captureInFlightRef = useRef(false)
  const currentFaceCountRef = useRef(0)
  const faceCountFailureAlertShownRef = useRef(false)
  const finalCaptureWaypointIndexRef = useRef<number | null>(null)
  const liveCaptureUriRef = useRef<string | null>(null)
  const runningRef = useRef(false)
  const finishedRef = useRef(false)
  const livenessChallengeIndexRef = useRef(0)
  const livenessConfidenceRef = useRef<Partial<Record<ChallengeDefinition['key'], number>>>({})
  const livenessSequenceRef = useRef<ChallengeDefinition[]>(createRequiredFaceLivenessSequence())
  const livenessStartedAtRef = useRef(0)
  const livenessStepPassedRef = useRef(false)
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
  const lastGazeLogAtRef = useRef(0)
  const lastFaceCountRef = useRef<number | null>(null)

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

  const gazeTargetCount = waypointsRef.current.length
  const livenessTargetCount = livenessSequenceRef.current.length
  const totalTargets = challengePhase === 'liveness' ? livenessTargetCount : gazeTargetCount
  const activeWaypoint = waypointsRef.current[currentWaypointIndex]
  const activeLivenessChallenge = livenessSequenceRef.current[livenessChallengeIndex]
  const isCameraActive = Boolean(isFocused && hasPermission && device && cameraReady)

  const statusText = useMemo(() => {
    if (!hasPermission) return 'Camera permission is required for face verification.'
    if (!device) return 'Front camera is not available on this device.'
    if (gazeState === 'running') {
      if (capturingFinalPhoto) return 'Capturing a clear face photo.'
      if (multipleFaces) return 'Only one face should be visible in the camera.'
      if (!faceDetected) return 'Keep your face centered in the frame.'
      if (challengePhase === 'liveness') return 'Complete the liveness prompt.'
      return 'Match the guide face pose.'
    }
    if (gazeState === 'success') return 'Face verification completed.'
    if (gazeState === 'failed') return 'Face verification did not pass. Please retry.'
    return faceDetected ? 'Face detected. Start when ready.' : 'Position your face in view.'
  }, [
    capturingFinalPhoto,
    challengePhase,
    device,
    faceDetected,
    gazeState,
    hasPermission,
    multipleFaces,
  ])

  const promptText = useMemo(() => {
    if (gazeState !== 'running') return 'You will complete blink, smile, and face pose prompts.'
    if (capturingFinalPhoto) return 'Hold still while we capture your comparison photo.'
    if (challengePhase === 'liveness') {
      return activeLivenessChallenge?.prompt ?? 'Follow the liveness prompt.'
    }
    return getPromptForWaypoint(activeWaypoint)
  }, [
    activeLivenessChallenge?.prompt,
    activeWaypoint,
    capturingFinalPhoto,
    challengePhase,
    gazeState,
  ])

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
        finalCenterCapture: Boolean(liveCaptureUriRef.current),
        livenessMerged: true,
        mirrorMode: mirrorModeRef.current,
        mirrorValidationSamples: mirrorValidationRef.current.sampleCount,
        failureReason,
        platform: Platform.OS,
      },
    })

    if (passed) {
      setCapturingFinalPhoto(false)
      setGazeState('success')
      setCurrentStep(Steps.FaceComparisonStep)
      return
    }

    setCapturingFinalPhoto(false)
    if (failureReason && FACE_COUNT_FAILURE_REASONS.has(failureReason)) {
      setGazeState('idle')
      if (!faceCountFailureAlertShownRef.current) {
        faceCountFailureAlertShownRef.current = true
        Alert.alert(
          'Face verification restarted',
          failureReason === 'face_missing'
            ? 'Your face left the camera view. Keep exactly one face in view and start again.'
            : 'More than one face was detected. Keep exactly one face in view and start again.',
          [
            {
              text: 'OK',
              onPress: () => {
                faceCountFailureAlertShownRef.current = false
              },
            },
          ],
        )
      }
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

    const normalizedYaw = waypoint.targetYawDeg / challengeConfig.maxYawDeg
    const normalizedPitch = waypoint.targetPitchDeg / challengeConfig.maxPitchDeg
    const rawAngle = Math.atan2(normalizedPitch, normalizedYaw)
    const angleDeg = toPositiveDegrees((rawAngle * 180) / Math.PI)
    const label = toWaypointLabel(waypoint.targetYawDeg, waypoint.targetPitchDeg)
    logGazeDiagnostics(
      'WAYPOINT',
      `→ label:"${label}" angle:${rawAngle.toFixed(2)}rad (deg:${Math.round(angleDeg)}°) target:(yaw:${normalizedYaw.toFixed(2)}, pitch:${normalizedPitch.toFixed(2)}) targetDeg:(yaw:${waypoint.targetYawDeg.toFixed(1)}, pitch:${waypoint.targetPitchDeg.toFixed(1)}) screen:(${waypoint.screenX.toFixed(3)}, ${waypoint.screenY.toFixed(3)}) holdMs:${waypoint.holdMs}`,
    )

    moveGuideToWaypoint(waypoint)
  }

  const startGazeWaypointChallenge = () => {
    startedAtRef.current = Date.now()
    challengePhaseRef.current = 'gaze'
    setChallengePhase('gaze')
    setCurrentWaypointIndex(0)
    currentWaypointProgressRef.current = {
      stableMs: 0,
      elapsedMs: 0,
      completed: false,
      timedOut: false,
    }
    moveToWaypoint(0)
  }

  const startGazeChallenge = () => {
    const faceCountFailureReason = getFaceCountFailureReason(currentFaceCountRef.current)
    if (faceCountFailureReason) return

    const generatedWaypoints = generateUnifiedGazeWaypoints(
      { height, width },
      { waypointCount: challengeConfig.waypointCount },
    )
    const waypoints = appendFinalCenterCaptureWaypoint(
      generatedWaypoints,
      challengeConfig.minHoldMs,
    )

    waypointsRef.current = waypoints
    finalCaptureWaypointIndexRef.current = generatedWaypoints.length
    const waypointLogPayload = waypoints
      .map(waypoint => {
        const normalizedYaw = waypoint.targetYawDeg / challengeConfig.maxYawDeg
        const normalizedPitch = waypoint.targetPitchDeg / challengeConfig.maxPitchDeg
        const rawAngle = Math.atan2(normalizedPitch, normalizedYaw)
        const angleDeg = toPositiveDegrees((rawAngle * 180) / Math.PI)
        const label = toWaypointLabel(waypoint.targetYawDeg, waypoint.targetPitchDeg)
        return `#${waypoint.index + 1} ${label} angle:${rawAngle.toFixed(2)}rad (${Math.round(angleDeg)}°) target:(${normalizedYaw.toFixed(2)},${normalizedPitch.toFixed(2)}) targetDeg:(${waypoint.targetYawDeg.toFixed(1)},${waypoint.targetPitchDeg.toFixed(1)}) screen:(${waypoint.screenX.toFixed(3)},${waypoint.screenY.toFixed(3)}) hold:${waypoint.holdMs}`
      })
      .join(' | ')
    logGazeDiagnostics('WAYPOINTS', waypointLogPayload)
    logGazeDiagnostics(
      'CONFIG',
      `mode:${guideMode} waypointCount:${challengeConfig.waypointCount} maxYawDeg:${challengeConfig.maxYawDeg} maxPitchDeg:${challengeConfig.maxPitchDeg} yawToleranceDeg:${challengeConfig.yawToleranceDeg} pitchToleranceDeg:${challengeConfig.pitchToleranceDeg} minHoldMs:${challengeConfig.minHoldMs} maxWaypointMs:${challengeConfig.maxWaypointMs}`,
    )

    samplesRef.current = []
    runningRef.current = true
    finishedRef.current = false
    startedAtRef.current = 0
    livenessChallengeIndexRef.current = 0
    livenessConfidenceRef.current = {}
    livenessSequenceRef.current = createRequiredFaceLivenessSequence()
    livenessStartedAtRef.current = Date.now()
    livenessStepPassedRef.current = false
    captureInFlightRef.current = false
    currentFaceCountRef.current = 1
    faceCountFailureAlertShownRef.current = false
    liveCaptureUriRef.current = null
    setLatestScorePercent(0)
    setCapturingFinalPhoto(false)
    challengePhaseRef.current = 'liveness'
    setChallengePhase('liveness')
    setCurrentWaypointIndex(0)
    setLivenessChallengeIndex(0)
    setMirrorModeLabel('unknown')

    mirrorValidationRef.current = createHeadPoseMirrorValidationState()
    mirrorModeRef.current = 'unknown'
    lastFaceCountRef.current = null
    lastGazeLogAtRef.current = 0
    currentWaypointProgressRef.current = {
      stableMs: 0,
      elapsedMs: 0,
      completed: false,
      timedOut: false,
    }

    setGazeState('running')

    if (livenessSequenceRef.current.length === 0) {
      startGazeWaypointChallenge()
    }
  }

  const processLivenessChallenge = (face: GazeDetectorFace) => {
    const activeChallenge = livenessSequenceRef.current[livenessChallengeIndexRef.current]
    if (!activeChallenge) {
      startGazeWaypointChallenge()
      return
    }

    const evaluation = evaluateLivenessChallenge(activeChallenge, face)
    if (!evaluation.passed || livenessStepPassedRef.current) {
      return
    }

    livenessStepPassedRef.current = true
    livenessConfidenceRef.current = {
      ...livenessConfidenceRef.current,
      ...(typeof evaluation.confidence === 'number'
        ? { [activeChallenge.key]: evaluation.confidence }
        : {}),
    }

    setTimeout(() => {
      if (!runningRef.current || finishedRef.current) return

      livenessStepPassedRef.current = false
      const nextIndex = livenessChallengeIndexRef.current + 1
      livenessChallengeIndexRef.current = nextIndex

      if (nextIndex >= livenessSequenceRef.current.length) {
        const result = buildLivenessResult({
          sequence: livenessSequenceRef.current,
          confidenceByKey: livenessConfidenceRef.current,
          startedAt: livenessStartedAtRef.current,
          completedAt: Date.now(),
        })

        setFaceLivenessResult(result)
        startGazeWaypointChallenge()
        return
      }

      setLivenessChallengeIndex(nextIndex)
    }, LIVENESS_STEP_DEBOUNCE_MS)
  }

  const captureFinalFacePhoto = async () => {
    if (captureInFlightRef.current || liveCaptureUriRef.current) return

    captureInFlightRef.current = true
    setCapturingFinalPhoto(true)

    try {
      const photo = await cameraRef.current?.takePhoto()
      if (!runningRef.current || finishedRef.current) return

      const faceCountFailureReason = getFaceCountFailureReason(currentFaceCountRef.current)
      if (faceCountFailureReason) {
        finalizeChallenge(false, faceCountFailureReason)
        return
      }

      if (!photo?.path) {
        finalizeChallenge(false, 'final_capture_unavailable')
        return
      }

      const liveCaptureUri = normalizePhotoUri(photo.path)
      liveCaptureUriRef.current = liveCaptureUri
      setVerificationUserData(previous => ({
        ...previous,
        biometrics: {
          ...previous.biometrics,
          images: {
            ...previous.biometrics.images,
            liveCaptureUri,
            liveCropUri: undefined,
            referenceCropUri: undefined,
          },
        },
        evidence: [
          ...previous.evidence,
          {
            keys: ['biometrics.images.liveCaptureUri'],
            source: 'camera',
            step: 'face-final-center-capture',
            storedAt: Date.now(),
          },
        ],
      }))

      finalizeChallenge(true)
    } catch (error) {
      logGazeDiagnostics(
        'CAPTURE',
        error instanceof Error ? error.message : 'final center capture failed',
      )
      finalizeChallenge(false, 'final_capture_failed')
    } finally {
      captureInFlightRef.current = false
      setCapturingFinalPhoto(false)
    }
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
      if (currentWaypointIndex === finalCaptureWaypointIndexRef.current) {
        void captureFinalFacePhoto()
        return
      }
      moveToWaypoint(currentWaypointIndex + 1)
    }
  }

  const handleFacesDetected = (faces: GazeDetectorFace[]) => {
    if (lastFaceCountRef.current !== faces.length) {
      lastFaceCountRef.current = faces.length
      logGazeDiagnostics('FACE', `count:${faces.length}`)
    }

    const hasSingleFace = faces.length === 1
    currentFaceCountRef.current = faces.length
    setFaceDetected(hasSingleFace)
    setMultipleFaces(faces.length > 1)

    if (!runningRef.current || finishedRef.current) return

    const faceCountFailureReason = getFaceCountFailureReason(faces.length)
    if (faceCountFailureReason) {
      finalizeChallenge(false, faceCountFailureReason)
      return
    }

    if (challengePhaseRef.current === 'liveness') {
      processLivenessChallenge(faces[0])
      return
    }

    const active = waypointsRef.current[currentWaypointIndex]
    if (!active) return

    const now = Date.now()
    if (now < waypointValidationUnlockedAtRef.current) {
      lastProgressTickAtRef.current = now
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
      logGazeDiagnostics(
        'MIRROR',
        `mode:${resolvedMirrorMode} sampleCount:${mirrorValidationRef.current.sampleCount}`,
      )
    }

    const evaluation = evaluateUnifiedGazeSample(
      headPose.yawDeg,
      headPose.pitchDeg,
      active.targetYawDeg,
      active.targetPitchDeg,
      challengeConfig,
    )

    if (now - lastGazeLogAtRef.current >= GAZE_LOG_THROTTLE_MS) {
      lastGazeLogAtRef.current = now
      const normalizedYaw = headPose.yawDeg / challengeConfig.maxYawDeg
      const normalizedPitch = headPose.pitchDeg / challengeConfig.maxPitchDeg
      const rawAngle = Math.atan2(normalizedPitch, normalizedYaw)
      const angleDeg = toPositiveDegrees((rawAngle * 180) / Math.PI)
      const gazeRadius = Math.sqrt(
        normalizedYaw * normalizedYaw + normalizedPitch * normalizedPitch,
      )
      logGazeDiagnostics(
        'GAZE',
        `raw_angle:${rawAngle.toFixed(2)}rad deg:${Math.round(angleDeg)}° gazeRadius:${gazeRadius.toFixed(2)} mapped:(yaw:${normalizedYaw.toFixed(2)}, pitch:${normalizedPitch.toFixed(2)}) actualDeg:(yaw:${headPose.yawDeg.toFixed(1)}, pitch:${headPose.pitchDeg.toFixed(1)}) expectedDeg:(yaw:${active.targetYawDeg.toFixed(1)}, pitch:${active.targetPitchDeg.toFixed(1)}) errDeg:(yaw:${evaluation.yawErrorDeg.toFixed(1)}, pitch:${evaluation.pitchErrorDeg.toFixed(1)}) pass:${evaluation.passed} mirror:${mirrorModeRef.current}`,
      )
    }

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
          ref={cameraRef}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          device={device}
          isActive={isCameraActive}
          frameProcessor={frameProcessor}
          pixelFormat='yuv'
          photo
        />
      ) : (
        <View className='absolute inset-0 items-center justify-center bg-backgroundPrimary'>
          <ActivityIndicator size='large' className='color-primaryMain' />
        </View>
      )}

      {guideMode === 'dot' && (
        <GazeChallengeComponentDot
          isRunning={gazeState === 'running' && challengePhase === 'gaze'}
          waypointIndex={currentWaypointIndex}
          waypoints={waypointsRef.current}
          latestScorePercent={latestScorePercent}
          totalTargets={gazeTargetCount}
          faceDetected={faceDetected}
          multipleFaces={multipleFaces}
          mirrorMode={mirrorModeRef.current === 'unknown' ? undefined : mirrorModeRef.current}
          screenWidth={width}
          screenHeight={height}
          onStart={startGazeChallenge}
          onRetry={startGazeChallenge}
          onExit={() => setCurrentStep(resolveFaceVerificationBackStep(docType))}
          dotX={dotX}
          dotY={dotY}
        />
      )}

      {guideMode === 'headPoseOverlay' && (
        <GazeChallengeComponentFace
          isRunning={gazeState === 'running' && challengePhase === 'gaze'}
          waypointIndex={currentWaypointIndex}
          waypoints={waypointsRef.current}
          latestScorePercent={latestScorePercent}
          totalTargets={gazeTargetCount}
          faceDetected={faceDetected}
          multipleFaces={multipleFaces}
          mirrorMode={mirrorModeRef.current === 'unknown' ? undefined : mirrorModeRef.current}
          screenWidth={width}
          screenHeight={height}
          onStart={startGazeChallenge}
          onRetry={startGazeChallenge}
          onExit={() => setCurrentStep(resolveFaceVerificationBackStep(docType))}
          guideYaw={guideYaw}
          guidePitch={guidePitch}
          challengeMaxYawDeg={challengeConfig.maxYawDeg}
          challengeMaxPitchDeg={challengeConfig.maxPitchDeg}
        />
      )}

      {guideMode === 'smartFace' && (
        <GazeChallengeComponentSmartFace
          isRunning={gazeState === 'running' && challengePhase === 'gaze'}
          waypointIndex={currentWaypointIndex}
          waypoints={waypointsRef.current}
          latestScorePercent={latestScorePercent}
          totalTargets={gazeTargetCount}
          faceDetected={faceDetected}
          multipleFaces={multipleFaces}
          mirrorMode={mirrorModeRef.current === 'unknown' ? undefined : mirrorModeRef.current}
          screenWidth={width}
          screenHeight={height}
          onStart={startGazeChallenge}
          onRetry={startGazeChallenge}
          onExit={() => setCurrentStep(resolveFaceVerificationBackStep(docType))}
          guideYaw={guideYaw}
          guidePitch={guidePitch}
          challengeMaxYawDeg={challengeConfig.maxYawDeg}
          challengeMaxPitchDeg={challengeConfig.maxPitchDeg}
        />
      )}

      <View className='flex-1 bg-black/45 p-6'>
        <View className='flex-row items-center'>
          <Text className='typography-h5 text-white'>Face Verification</Text>
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
              {challengePhase === 'liveness' ? 'Check' : 'Target'}{' '}
              {Math.min(
                (challengePhase === 'liveness' ? livenessChallengeIndex : currentWaypointIndex) + 1,
                totalTargets,
              )}{' '}
              of {totalTargets}
            </Text>
          ) : null}
          {gazeState === 'running' && challengePhase === 'gaze' ? (
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
            title={gazeState === 'failed' ? 'Retry Face Verification' : 'Start Face Verification'}
            onPress={startGazeChallenge}
            className='w-full'
            disabled={!hasPermission || !device || !faceDetected || multipleFaces}
          />
          <UiButton
            title='Back'
            variant='outlined'
            onPress={() => setCurrentStep(resolveFaceVerificationBackStep(docType))}
            className='w-full'
            disabled={gazeState === 'running'}
          />
        </View>
      </View>
    </View>
  )
}
