import type { FaceComparisonResult } from '../types'
import * as FileSystem from 'expo-file-system'
import * as ImageManipulator from 'expo-image-manipulator'
import { Image as NativeImage } from 'react-native'

export type FaceImageSource = {
  base64?: string
  filePath?: string
  uri?: string
}

export type CompareFacesInput = {
  liveImageUri: string
  referenceImage: FaceImageSource
  threshold?: number
  modelName?: string
}

export const DEFAULT_FACE_COMPARISON_THRESHOLD = 0.1
const FACE_MODEL_INPUT_SIZE = 112

type ModelRuntime = {
  loadFaceModel: () => Promise<unknown>
  extractFaceEmbeddingFromUri: (model: unknown, uri: string) => Promise<Float32Array>
  cosineSimilarity: (a: Float32Array, b: Float32Array) => number
}

type DetectedFace = {
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
}

function loadModelRuntime(): ModelRuntime {
  return require('../model') as ModelRuntime
}

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    NativeImage.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      error => reject(error),
    )
  })
}

export async function getCenteredFaceSquareCrop(uri: string): Promise<string> {
  const detectorImageSource = await getFaceDetectorCompatibleUri(uri)
  const detectedFace = await detectExactlyOneFace(detectorImageSource)
  const { width, height } = await getImageSize(uri)

  if (width <= 0 || height <= 0) {
    throw new Error('FACE_IMAGE_SIZE_UNAVAILABLE')
  }

  const faceBox = detectedFace.bounds
  const rawCropSize = Math.max(faceBox.width, faceBox.height)
  const cropSize = Math.min(Math.max(rawCropSize, 1), width, height)

  const centerX = faceBox.x + faceBox.width / 2
  const centerY = faceBox.y + faceBox.height / 2

  const originX = clamp(Math.round(centerX - cropSize / 2), 0, Math.max(width - cropSize, 0))
  const originY = clamp(Math.round(centerY - cropSize / 2), 0, Math.max(height - cropSize, 0))

  const cropped = await ImageManipulator.manipulateAsync(
    uri,
    [
      {
        crop: {
          originX,
          originY,
          width: cropSize,
          height: cropSize,
        },
      },
      {
        resize: {
          width: FACE_MODEL_INPUT_SIZE,
          height: FACE_MODEL_INPUT_SIZE,
        },
      },
    ],
    {
      compress: 1,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: false,
    },
  )

  await cleanupTemporaryImage(detectorImageSource, uri)

  return cropped.uri.startsWith('file://') ? cropped.uri : `file://${cropped.uri}`
}

async function detectExactlyOneFace(imageUri: string): Promise<DetectedFace> {
  const detectorModule = require('react-native-vision-camera-face-detector') as {
    detectFaces: (params: {
      image: string
      options: Record<string, unknown>
    }) => Promise<DetectedFace[]>
  }
  const detectFaces = detectorModule.detectFaces

  const faces = await detectFaces({
    image: imageUri,
    options: {
      performanceMode: 'accurate',
      contourMode: 'none',
      landmarkMode: 'none',
      classificationMode: 'none',
      minFaceSize: 0.1,
      trackingEnabled: false,
    },
  })

  if (faces.length === 0) {
    const error = new Error('No face detected in image')
    error.name = 'FACE_NOT_DETECTED'
    throw error
  }

  if (faces.length > 1) {
    const error = new Error('Multiple faces detected in image')
    error.name = 'MULTIPLE_FACES_DETECTED'
    throw error
  }

  return faces[0]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function tryParseDataUri(uri: string): { mimeType: string; base64: string } | null {
  const match = /^data:(.+?);base64,(.+)$/.exec(uri)
  if (!match) return null
  return { mimeType: match[1], base64: match[2] }
}

function getFileExtensionFromMimeType(mimeType: string): string {
  if (mimeType.includes('png')) return 'png'
  if (mimeType.includes('webp')) return 'webp'
  return 'jpg'
}

async function getFaceDetectorCompatibleUri(uri: string): Promise<string> {
  const parsedDataUri = tryParseDataUri(uri)
  if (!parsedDataUri) return uri

  const extension = getFileExtensionFromMimeType(parsedDataUri.mimeType)
  const targetPath = `${FileSystem.cacheDirectory ?? ''}passport-face-${Date.now()}.${extension}`
  if (!targetPath) {
    const error = new Error('Cannot create cache file for face detection')
    error.name = 'FACE_IMAGE_PREPARE_FAILED'
    throw error
  }

  await FileSystem.writeAsStringAsync(targetPath, parsedDataUri.base64, {
    encoding: FileSystem.EncodingType.Base64,
  })

  return targetPath.startsWith('file://') ? targetPath : `file://${targetPath}`
}

async function cleanupTemporaryImage(preparedUri: string, originalUri: string): Promise<void> {
  if (preparedUri === originalUri) return
  if (!preparedUri.startsWith('file://')) return

  try {
    const fileInfo = await FileSystem.getInfoAsync(preparedUri)
    if (fileInfo.exists) {
      await FileSystem.deleteAsync(preparedUri, { idempotent: true })
    }
  } catch {
    // Best effort cleanup only.
  }
}

export function resolveFaceImageUri(source: FaceImageSource): string | undefined {
  if (typeof source.uri === 'string' && source.uri.length > 0) {
    return source.uri
  }

  if (typeof source.base64 === 'string' && source.base64.length > 0) {
    return `data:image/jpeg;base64,${source.base64}`
  }

  if (typeof source.filePath !== 'string' || source.filePath.length === 0) {
    return undefined
  }

  return source.filePath.startsWith('file://') ? source.filePath : `file://${source.filePath}`
}

export function toFaceComparisonResult(params: {
  similarity: number
  threshold?: number
  model?: string
  liveImage?: FaceImageSource
  referenceImage?: FaceImageSource
}): FaceComparisonResult {
  const threshold = params.threshold ?? DEFAULT_FACE_COMPARISON_THRESHOLD
  const similarity = Number(params.similarity.toFixed(3))

  return {
    passed: similarity >= threshold,
    similarity,
    threshold,
    ...(typeof params.model === 'string' && params.model.length > 0 ? { model: params.model } : {}),
    ...(params.liveImage
      ? {
          liveImage: {
            ...(params.liveImage.base64 ? { base64: params.liveImage.base64 } : {}),
            ...(params.liveImage.filePath ? { filePath: params.liveImage.filePath } : {}),
          },
        }
      : {}),
    ...(params.referenceImage
      ? {
          referenceImage: {
            ...(params.referenceImage.base64 ? { base64: params.referenceImage.base64 } : {}),
            ...(params.referenceImage.filePath ? { filePath: params.referenceImage.filePath } : {}),
          },
        }
      : {}),
  }
}

export async function preloadFaceComparisonModel(): Promise<void> {
  const modelRuntime = loadModelRuntime()
  await modelRuntime.loadFaceModel()
}

export async function compareFaces(input: CompareFacesInput): Promise<FaceComparisonResult> {
  const referenceUri = resolveFaceImageUri(input.referenceImage)
  if (!referenceUri) {
    const error = new Error('REFERENCE_IMAGE_UNAVAILABLE')
    error.name = 'REFERENCE_IMAGE_UNAVAILABLE'
    throw error
  }

  if (!input.liveImageUri || input.liveImageUri.length === 0) {
    const error = new Error('LIVE_IMAGE_UNAVAILABLE')
    error.name = 'LIVE_IMAGE_UNAVAILABLE'
    throw error
  }

  const modelRuntime = loadModelRuntime()
  const model = await modelRuntime.loadFaceModel()

  const preparedReferenceUri = await getCenteredFaceSquareCrop(referenceUri)
  const preparedLiveUri = await getCenteredFaceSquareCrop(input.liveImageUri)

  let referenceEmbedding: Float32Array
  let liveEmbedding: Float32Array
  try {
    ;[referenceEmbedding, liveEmbedding] = await Promise.all([
      modelRuntime.extractFaceEmbeddingFromUri(model, preparedReferenceUri),
      modelRuntime.extractFaceEmbeddingFromUri(model, preparedLiveUri),
    ])
  } finally {
    await Promise.all([
      cleanupTemporaryImage(preparedReferenceUri, referenceUri),
      cleanupTemporaryImage(preparedLiveUri, input.liveImageUri),
    ])
  }

  const similarity = modelRuntime.cosineSimilarity(referenceEmbedding, liveEmbedding)
  return toFaceComparisonResult({
    similarity,
    threshold: input.threshold,
    model: input.modelName ?? 'mobilefacenet',
    liveImage: { filePath: input.liveImageUri.replace(/^file:\/\//, '') },
    referenceImage: input.referenceImage,
  })
}
