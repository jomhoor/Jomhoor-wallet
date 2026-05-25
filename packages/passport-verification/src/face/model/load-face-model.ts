import * as tf from '@tensorflow/tfjs'
import '@tensorflow/tfjs-backend-cpu'
import { bundleResourceIO, decodeJpeg } from '@tensorflow/tfjs-react-native'
import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system'
import * as ImageManipulator from 'expo-image-manipulator'
import { Platform } from 'react-native'
import { Image as NativeImage } from 'react-native'

type GraphModelLike = {
  executeAsync: (input: unknown) => Promise<unknown>
}

const modelJson = require('../../../assets/mobilefacenet/model.json')
const modelWeights = require('../../../assets/mobilefacenet/model.bin')

type ModelJsonLike = {
  modelTopology?: unknown
  weightsManifest?: Array<{ weights?: unknown[] }>
  format?: string
  generatedBy?: string
  convertedBy?: string
}

let tfReadyPromise: Promise<void> | null = null
let modelPromise: Promise<GraphModelLike> | null = null

function resolveWeightSpecs(json: ModelJsonLike): unknown[] {
  const specs = json.weightsManifest?.[0]?.weights
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new Error('FACE_MODEL_WEIGHT_SPECS_MISSING')
  }

  return specs
}

async function loadGraphModelFromExpoAssetFallback(): Promise<GraphModelLike> {
  const [loadedAsset] = await Asset.loadAsync(modelWeights)
  const moduleAsset = Asset.fromModule(modelWeights)
  await moduleAsset.downloadAsync()

  const candidateUris = [
    loadedAsset?.localUri,
    loadedAsset?.uri,
    moduleAsset.localUri,
    moduleAsset.uri,
    Platform.OS === 'ios' && FileSystem.bundleDirectory
      ? `${FileSystem.bundleDirectory}assets/node_modules/@iland/passport-verification/assets/mobilefacenet/model.bin`
      : null,
    Platform.OS === 'ios' && FileSystem.bundleDirectory
      ? `${FileSystem.bundleDirectory}assets/face-models/model.bin`
      : null,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)

  // eslint-disable-next-line no-console
  console.log(
    '[JOMHOOR_FACE_MODEL_DEBUG]',
    JSON.stringify({
      event: 'face_model_asset_candidates',
      loadedAssetUri: loadedAsset?.uri ?? null,
      loadedAssetLocalUri: loadedAsset?.localUri ?? null,
      moduleAssetUri: moduleAsset.uri ?? null,
      moduleAssetLocalUri: moduleAsset.localUri ?? null,
      candidateCount: candidateUris.length,
      candidateUris,
    }),
  )

  if (candidateUris.length === 0) {
    throw new Error('FACE_MODEL_WEIGHT_URI_MISSING')
  }

  let weightsBase64: string | null = null
  let resolvedWeightsUri: string | null = null

  for (const candidateUri of candidateUris) {
    try {
      const info = await FileSystem.getInfoAsync(candidateUri)
      if (info.exists) {
        weightsBase64 = await FileSystem.readAsStringAsync(candidateUri, {
          encoding: FileSystem.EncodingType.Base64,
        })
        resolvedWeightsUri = candidateUri
        break
      }
    } catch {
      // Keep trying next candidate.
    }

    try {
      const cacheUri = `${FileSystem.cacheDirectory ?? ''}mobilefacenet-model.bin`
      await FileSystem.copyAsync({
        from: candidateUri,
        to: cacheUri,
      })
      const copiedInfo = await FileSystem.getInfoAsync(cacheUri)
      if (copiedInfo.exists) {
        weightsBase64 = await FileSystem.readAsStringAsync(cacheUri, {
          encoding: FileSystem.EncodingType.Base64,
        })
        resolvedWeightsUri = cacheUri
        break
      }
    } catch {
      // Keep trying next candidate.
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    '[JOMHOOR_FACE_MODEL_DEBUG]',
    JSON.stringify({
      event: 'face_model_asset_resolved',
      resolvedWeightsUri,
      hadBase64: Boolean(weightsBase64),
    }),
  )

  if (!weightsBase64 || !resolvedWeightsUri) {
    throw new Error('FACE_MODEL_WEIGHT_READ_FAILED')
  }

  const weightData = tf.util.encodeString(weightsBase64, 'base64').buffer

  const parsed = modelJson as ModelJsonLike
  const ioHandler = tf.io.fromMemory({
    modelTopology: parsed.modelTopology,
    weightSpecs: resolveWeightSpecs(parsed),
    weightData,
    format: parsed.format,
    generatedBy: parsed.generatedBy,
    convertedBy: parsed.convertedBy,
  } as tf.io.ModelArtifacts)

  return (await tf.loadGraphModel(ioHandler)) as unknown as GraphModelLike
}

function ensureTfReady(): Promise<void> {
  if (!tfReadyPromise) {
    tfReadyPromise = (async () => {
      await tf.ready()
      if (tf.getBackend() !== 'cpu') {
        await tf.setBackend('cpu')
        await tf.ready()
      }
    })()
  }

  return tfReadyPromise
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

async function preprocessFaceToTensor(uri: string): Promise<tf.Tensor4D> {
  const { width, height } = await getImageSize(uri)
  const needsResize = width !== 112 || height !== 112
  const result = needsResize
    ? await ImageManipulator.manipulateAsync(
        uri,
        [
          {
            resize: {
              width: 112,
              height: 112,
            },
          },
        ],
        {
          compress: 1,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        },
      )
    : await ImageManipulator.manipulateAsync(uri, [], {
        compress: 1,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      })

  if (!result.base64) {
    throw new Error('FACE_IMAGE_PREPROCESS_FAILED')
  }

  const bytes = tf.util.encodeString(result.base64, 'base64')
  const imageTensor = decodeJpeg(bytes, 3)
  const normalized = imageTensor.toFloat().sub(127.5).div(127.5).expandDims(0) as tf.Tensor4D
  imageTensor.dispose()

  return normalized
}

export async function loadFaceModel(): Promise<GraphModelLike> {
  await ensureTfReady()

  if (!modelPromise) {
    modelPromise = (async () => {
      try {
        const loadedModel = await tf.loadGraphModel(bundleResourceIO(modelJson, modelWeights))
        // eslint-disable-next-line no-console
        console.log(
          '[JOMHOOR_FACE_MODEL_DEBUG]',
          JSON.stringify({
            event: 'face_model_loaded_bundle_resource_io',
          }),
        )
        return loadedModel as unknown as GraphModelLike
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // eslint-disable-next-line no-console
        console.log(
          '[JOMHOOR_FACE_MODEL_DEBUG]',
          JSON.stringify({
            event: 'face_model_bundle_resource_io_failed',
            message,
          }),
        )
        return loadGraphModelFromExpoAssetFallback()
      }
    })()
  }

  return modelPromise
}

export async function extractFaceEmbeddingFromUri(
  model: GraphModelLike,
  uri: string,
): Promise<Float32Array> {
  const inputTensor = await preprocessFaceToTensor(uri)
  const phaseTrain = tf.scalar(false, 'bool')

  let executionResult: unknown
  try {
    executionResult = await model.executeAsync({
      img_inputs: inputTensor,
      phase_train: phaseTrain,
    })
  } finally {
    inputTensor.dispose()
    phaseTrain.dispose()
  }

  const outputTensor = Array.isArray(executionResult)
    ? (executionResult.find(candidate =>
        Boolean(
          candidate &&
            typeof candidate === 'object' &&
            'shape' in candidate &&
            Array.isArray((candidate as { shape?: unknown }).shape) &&
            (candidate as { shape: number[] }).shape[1] === 128,
        ),
      ) ?? executionResult[executionResult.length - 1])
    : executionResult

  if (!outputTensor || typeof outputTensor !== 'object' || !('data' in outputTensor)) {
    throw new Error('FACE_EMBEDDING_FAILED')
  }

  const tensorWithData = outputTensor as {
    data: () => Promise<TypedArrayLike>
    dispose?: () => void
  }

  const embedding = await tensorWithData.data()
  if (typeof tensorWithData.dispose === 'function') {
    tensorWithData.dispose()
  }

  return Float32Array.from(embedding)
}

type TypedArrayLike = ArrayLike<number>

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0
  }

  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index]
    normA += a[index] * a[index]
    normB += b[index] * b[index]
  }

  if (normA === 0 || normB === 0) {
    return 0
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
