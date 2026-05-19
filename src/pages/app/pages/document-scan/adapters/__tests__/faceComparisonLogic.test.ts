import {
  DEFAULT_FACE_COMPARISON_THRESHOLD,
  resolveFaceImageUri,
  toFaceComparisonResult,
} from '@iland/passport-verification'

describe('face comparison helpers', () => {
  it('builds a passed result when similarity is above threshold', () => {
    const result = toFaceComparisonResult({
      similarity: 0.91,
      threshold: 0.75,
      model: 'mobilefacenet',
    })

    expect(result.passed).toBe(true)
    expect(result.similarity).toBe(0.91)
    expect(result.threshold).toBe(0.75)
    expect(result.model).toBe('mobilefacenet')
  })

  it('builds a failed result when similarity is below threshold', () => {
    const result = toFaceComparisonResult({
      similarity: 0.2,
      threshold: 0.75,
    })

    expect(result.passed).toBe(false)
    expect(result.similarity).toBe(0.2)
  })

  it('uses default threshold when not provided', () => {
    const result = toFaceComparisonResult({
      similarity: DEFAULT_FACE_COMPARISON_THRESHOLD + 0.01,
    })

    expect(result.threshold).toBe(DEFAULT_FACE_COMPARISON_THRESHOLD)
    expect(result.passed).toBe(true)
  })

  it('resolves a base64 portrait to a data URI', () => {
    const uri = resolveFaceImageUri({ base64: 'abc123' })
    expect(uri).toBe('data:image/jpeg;base64,abc123')
  })

  it('returns undefined for an empty image source', () => {
    expect(resolveFaceImageUri({})).toBeUndefined()
  })
})
