import * as tf from '@tensorflow/tfjs'
import '@tensorflow/tfjs-backend-cpu'
import { bundleResourceIO, decodeJpeg } from '@tensorflow/tfjs-react-native'
import * as ImageManipulator from 'expo-image-manipulator'
import { Image as NativeImage } from 'react-native'

type GraphModelLike = {
  executeAsync: (input: unknown) => Promise<unknown>
}

const modelJson = require('../../../assets/mobilefacenet/model.json')
const modelWeights = require('../../../assets/mobilefacenet/model.bin')

let tfReadyPromise: Promise<void> | null = null
let modelPromise: Promise<GraphModelLike> | null = null

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
      const loadedModel = await tf.loadGraphModel(bundleResourceIO(modelJson, modelWeights))
      return loadedModel as unknown as GraphModelLike
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
