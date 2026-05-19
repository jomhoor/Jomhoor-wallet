import type { FaceComparisonResult } from '../types'

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

type ModelRuntime = {
  loadFaceModel: () => Promise<unknown>
  extractFaceEmbeddingFromUri: (model: unknown, uri: string) => Promise<Float32Array>
  cosineSimilarity: (a: Float32Array, b: Float32Array) => number
}

function loadModelRuntime(): ModelRuntime {
  return require('../model') as ModelRuntime
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

  const [referenceEmbedding, liveEmbedding] = await Promise.all([
    modelRuntime.extractFaceEmbeddingFromUri(model, referenceUri),
    modelRuntime.extractFaceEmbeddingFromUri(model, input.liveImageUri),
  ])

  const similarity = modelRuntime.cosineSimilarity(referenceEmbedding, liveEmbedding)
  return toFaceComparisonResult({
    similarity,
    threshold: input.threshold,
    model: input.modelName ?? 'mobilefacenet',
    liveImage: { filePath: input.liveImageUri.replace(/^file:\/\//, '') },
    referenceImage: input.referenceImage,
  })
}
