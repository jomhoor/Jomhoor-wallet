export type OneHotAnswerMask = bigint | number | string

const normalizeMask = (mask: OneHotAnswerMask): bigint => {
  if (typeof mask === 'number' && (!Number.isSafeInteger(mask) || mask < 0)) {
    throw new Error('Vote answer masks provided as numbers must be non-negative safe integers')
  }

  try {
    return BigInt(mask)
  } catch {
    throw new Error('Vote answer mask is not a valid integer')
  }
}

export const decodeOneHotAnswerMask = (
  input: OneHotAnswerMask,
  supportedOptionCount: number,
): number => {
  if (!Number.isInteger(supportedOptionCount) || supportedOptionCount <= 0) {
    throw new Error('Supported option count must be a positive integer')
  }

  const mask = normalizeMask(input)
  if (mask <= 0n || (mask & (mask - 1n)) !== 0n) {
    throw new Error('Vote answer mask must contain exactly one selected option')
  }

  let optionIndex = 0
  let cursor = mask
  while (cursor > 1n) {
    cursor >>= 1n
    optionIndex += 1
  }

  if (optionIndex >= supportedOptionCount) {
    throw new Error('Vote answer mask selects an unsupported option')
  }

  return optionIndex
}

export const decodeOneHotAnswerMasks = (
  masks: readonly OneHotAnswerMask[],
  questionOptionCounts: readonly number[],
): number[] => {
  if (masks.length !== questionOptionCounts.length) {
    throw new Error('Vote answer count does not match the proposal question count')
  }

  return masks.map((mask, questionIndex) =>
    decodeOneHotAnswerMask(mask, questionOptionCounts[questionIndex]),
  )
}
