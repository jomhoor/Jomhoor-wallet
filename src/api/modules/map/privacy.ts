import {
  MAP_DEFAULT_PRIVACY_THRESHOLD_K,
  MAP_MIN_PRIVACY_THRESHOLD_K,
  MAP_MIN_PUBLISHED_RESOLUTION,
  type MapCellResolution,
} from './contracts'

export type MapCellDefinition = {
  cellId: string
  resolution: MapCellResolution
  parentCellId: string | null
  latitude: number
  longitude: number
}

export type MapLeafVoteBucket = {
  cellId: string
  totalVotes: number
  optionCounts: Readonly<Record<string, number>>
}

export type PrivacySafeOptionBreakdown = {
  optionIndex: number
  count: number
  percentage: number
}

export type PrivacySafeCellAggregate = {
  cellId: string
  cellResolution: MapCellResolution
  parentCellId: string | null
  latitude: number
  longitude: number
  totalMappedVotes: number
  optionBreakdown: PrivacySafeOptionBreakdown[]
  breakdownSuppressed: boolean
  mergedCellCount: number
  maxMergeDepth: number
}

export type MapPrivacyAggregationResult = {
  aggregates: PrivacySafeCellAggregate[]
  suppressedVoteCount: number
}

export type MapPrivacyAggregationOptions = {
  thresholdK?: number
  minimumPublishedResolution?: MapCellResolution
}

type WorkingBucket = {
  cellId: string
  totalVotes: number
  optionCounts: Record<string, number>
  sourceCellIds: Set<string>
  maxMergeDepth: number
}

const assertNonNegativeInteger = (value: number, field: string): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`)
  }
}

const assertCoordinate = (value: number, field: string, minimum: number, maximum: number): void => {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${field} is outside its valid range`)
  }
}

const validateCellHierarchy = (
  cells: readonly MapCellDefinition[],
): Map<string, MapCellDefinition> => {
  const cellsById = new Map<string, MapCellDefinition>()

  for (const cell of cells) {
    if (!cell.cellId.trim()) {
      throw new Error('Map cell IDs must not be empty')
    }
    if (cellsById.has(cell.cellId)) {
      throw new Error(`Duplicate map cell definition: ${cell.cellId}`)
    }

    assertCoordinate(cell.latitude, `${cell.cellId}.latitude`, -90, 90)
    assertCoordinate(cell.longitude, `${cell.cellId}.longitude`, -180, 180)
    cellsById.set(cell.cellId, cell)
  }

  for (const cell of cells) {
    if (!cell.parentCellId) continue

    const parent = cellsById.get(cell.parentCellId)
    if (!parent) {
      throw new Error(`Missing parent cell definition: ${cell.parentCellId}`)
    }
    if (parent.resolution >= cell.resolution) {
      throw new Error(
        `Parent cell ${parent.cellId} must have a lower resolution than ${cell.cellId}`,
      )
    }
  }

  for (const cell of cells) {
    const visited = new Set<string>([cell.cellId])
    let parentCellId = cell.parentCellId

    while (parentCellId) {
      if (visited.has(parentCellId)) {
        throw new Error(`Map cell hierarchy contains a cycle at ${parentCellId}`)
      }
      visited.add(parentCellId)
      parentCellId = cellsById.get(parentCellId)?.parentCellId ?? null
    }
  }

  return cellsById
}

const mergeOptionCounts = (
  target: Record<string, number>,
  source: Readonly<Record<string, number>>,
): void => {
  for (const [optionIndex, count] of Object.entries(source)) {
    target[optionIndex] = (target[optionIndex] ?? 0) + count
  }
}

const validateLeafBucket = (
  bucket: MapLeafVoteBucket,
  cellsById: ReadonlyMap<string, MapCellDefinition>,
): void => {
  if (!cellsById.has(bucket.cellId)) {
    throw new Error(`Missing map cell definition for vote bucket: ${bucket.cellId}`)
  }

  assertNonNegativeInteger(bucket.totalVotes, `${bucket.cellId}.totalVotes`)

  let optionVoteCount = 0
  for (const [optionIndex, count] of Object.entries(bucket.optionCounts)) {
    if (!/^(0|[1-9]\d*)$/.test(optionIndex)) {
      throw new Error(`Invalid option index in ${bucket.cellId}: ${optionIndex}`)
    }
    assertNonNegativeInteger(count, `${bucket.cellId}.optionCounts.${optionIndex}`)
    optionVoteCount += count
  }

  if (optionVoteCount !== bucket.totalVotes) {
    throw new Error(
      `Option counts for ${bucket.cellId} must add up to totalVotes (${bucket.totalVotes})`,
    )
  }
}

const createWorkingBuckets = (
  leafBuckets: readonly MapLeafVoteBucket[],
  cellsById: ReadonlyMap<string, MapCellDefinition>,
): Map<string, WorkingBucket> => {
  const workingBuckets = new Map<string, WorkingBucket>()

  for (const leafBucket of leafBuckets) {
    validateLeafBucket(leafBucket, cellsById)
    if (leafBucket.totalVotes === 0) continue

    const existing = workingBuckets.get(leafBucket.cellId)
    if (existing) {
      existing.totalVotes += leafBucket.totalVotes
      mergeOptionCounts(existing.optionCounts, leafBucket.optionCounts)
      continue
    }

    workingBuckets.set(leafBucket.cellId, {
      cellId: leafBucket.cellId,
      totalVotes: leafBucket.totalVotes,
      optionCounts: { ...leafBucket.optionCounts },
      sourceCellIds: new Set([leafBucket.cellId]),
      maxMergeDepth: 0,
    })
  }

  return workingBuckets
}

const mergeBucketIntoParent = (
  bucket: WorkingBucket,
  parentCellId: string,
  workingBuckets: Map<string, WorkingBucket>,
): void => {
  const parentBucket = workingBuckets.get(parentCellId)
  if (parentBucket) {
    parentBucket.totalVotes += bucket.totalVotes
    mergeOptionCounts(parentBucket.optionCounts, bucket.optionCounts)
    bucket.sourceCellIds.forEach(cellId => parentBucket.sourceCellIds.add(cellId))
    parentBucket.maxMergeDepth = Math.max(parentBucket.maxMergeDepth, bucket.maxMergeDepth + 1)
    return
  }

  workingBuckets.set(parentCellId, {
    cellId: parentCellId,
    totalVotes: bucket.totalVotes,
    optionCounts: { ...bucket.optionCounts },
    sourceCellIds: new Set(bucket.sourceCellIds),
    maxMergeDepth: bucket.maxMergeDepth + 1,
  })
}

const buildSafeOptionBreakdown = (
  bucket: WorkingBucket,
  thresholdK: number,
): {
  optionBreakdown: PrivacySafeOptionBreakdown[]
  breakdownSuppressed: boolean
} => {
  const nonZeroOptions = Object.entries(bucket.optionCounts)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => Number(left) - Number(right))

  // Publishing safe options alongside an exact total can reveal the count of
  // hidden minority options by subtraction. Suppress the entire breakdown if
  // any non-zero option is below k.
  if (nonZeroOptions.some(([, count]) => count < thresholdK)) {
    return {
      optionBreakdown: [],
      breakdownSuppressed: true,
    }
  }

  return {
    optionBreakdown: nonZeroOptions.map(([optionIndex, count]) => ({
      optionIndex: Number(optionIndex),
      count,
      percentage: count / bucket.totalVotes,
    })),
    breakdownSuppressed: false,
  }
}

export const aggregatePrivacySafeMapBuckets = (
  leafBuckets: readonly MapLeafVoteBucket[],
  cellHierarchy: readonly MapCellDefinition[],
  options: MapPrivacyAggregationOptions = {},
): MapPrivacyAggregationResult => {
  const thresholdK = options.thresholdK ?? MAP_DEFAULT_PRIVACY_THRESHOLD_K
  const minimumPublishedResolution =
    options.minimumPublishedResolution ?? MAP_MIN_PUBLISHED_RESOLUTION

  if (!Number.isInteger(thresholdK) || thresholdK < MAP_MIN_PRIVACY_THRESHOLD_K) {
    throw new Error(`Map privacy threshold must be at least ${MAP_MIN_PRIVACY_THRESHOLD_K}`)
  }

  const cellsById = validateCellHierarchy(cellHierarchy)
  const workingBuckets = createWorkingBuckets(leafBuckets, cellsById)
  let suppressedVoteCount = 0

  while (true) {
    const sparseBuckets = Array.from(workingBuckets.values())
      .filter(bucket => bucket.totalVotes < thresholdK)
      .sort((left, right) => {
        const resolutionDifference =
          (cellsById.get(right.cellId)?.resolution ?? 0) -
          (cellsById.get(left.cellId)?.resolution ?? 0)
        return resolutionDifference || left.cellId.localeCompare(right.cellId)
      })

    if (sparseBuckets.length === 0) break

    for (const sparseBucket of sparseBuckets) {
      const currentBucket = workingBuckets.get(sparseBucket.cellId)
      if (!currentBucket || currentBucket.totalVotes >= thresholdK) continue

      const cell = cellsById.get(currentBucket.cellId)
      if (!cell) {
        throw new Error(`Missing map cell definition during aggregation: ${currentBucket.cellId}`)
      }

      workingBuckets.delete(currentBucket.cellId)
      const parent = cell.parentCellId ? cellsById.get(cell.parentCellId) : null
      if (!parent || parent.resolution < minimumPublishedResolution) {
        suppressedVoteCount += currentBucket.totalVotes
        continue
      }

      mergeBucketIntoParent(currentBucket, parent.cellId, workingBuckets)
    }
  }

  const aggregates = Array.from(workingBuckets.values())
    .map(bucket => {
      const cell = cellsById.get(bucket.cellId)
      if (!cell) {
        throw new Error(`Missing map cell definition for published bucket: ${bucket.cellId}`)
      }

      const breakdown = buildSafeOptionBreakdown(bucket, thresholdK)
      return {
        cellId: bucket.cellId,
        cellResolution: cell.resolution,
        parentCellId: cell.parentCellId,
        latitude: cell.latitude,
        longitude: cell.longitude,
        totalMappedVotes: bucket.totalVotes,
        ...breakdown,
        mergedCellCount: bucket.sourceCellIds.size,
        maxMergeDepth: bucket.maxMergeDepth,
      }
    })
    .sort((left, right) => {
      if (right.totalMappedVotes !== left.totalMappedVotes) {
        return right.totalMappedVotes - left.totalMappedVotes
      }
      return left.cellId.localeCompare(right.cellId)
    })

  return {
    aggregates,
    suppressedVoteCount,
  }
}
