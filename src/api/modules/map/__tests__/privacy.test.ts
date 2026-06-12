import { aggregatePrivacySafeMapBuckets,type MapCellDefinition } from '../privacy'

const hierarchy: MapCellDefinition[] = [
  {
    cellId: 'world',
    resolution: 3,
    parentCellId: null,
    latitude: 30,
    longitude: 45,
  },
  {
    cellId: 'region-a',
    resolution: 4,
    parentCellId: 'world',
    latitude: 35,
    longitude: 50,
  },
  {
    cellId: 'region-b',
    resolution: 4,
    parentCellId: 'world',
    latitude: 40,
    longitude: 55,
  },
  {
    cellId: 'city-a',
    resolution: 6,
    parentCellId: 'region-a',
    latitude: 35.6,
    longitude: 51.3,
  },
  {
    cellId: 'city-b',
    resolution: 6,
    parentCellId: 'region-a',
    latitude: 35.7,
    longitude: 51.4,
  },
  {
    cellId: 'city-c',
    resolution: 6,
    parentCellId: 'region-b',
    latitude: 38.1,
    longitude: 54.2,
  },
]

describe('aggregatePrivacySafeMapBuckets', () => {
  it('merges sparse sibling cells into their parent at k=5', () => {
    const result = aggregatePrivacySafeMapBuckets(
      [
        { cellId: 'city-a', totalVotes: 2, optionCounts: { 0: 2 } },
        { cellId: 'city-b', totalVotes: 3, optionCounts: { 0: 3 } },
      ],
      hierarchy,
    )

    expect(result.suppressedVoteCount).toBe(0)
    expect(result.aggregates).toEqual([
      {
        cellId: 'region-a',
        cellResolution: 4,
        parentCellId: 'world',
        latitude: 35,
        longitude: 50,
        totalMappedVotes: 5,
        optionBreakdown: [{ optionIndex: 0, count: 5, percentage: 1 }],
        breakdownSuppressed: false,
        mergedCellCount: 2,
        maxMergeDepth: 1,
      },
    ])
  })

  it('recursively merges sparse regions into the next parent', () => {
    const result = aggregatePrivacySafeMapBuckets(
      [
        { cellId: 'city-a', totalVotes: 2, optionCounts: { 0: 2 } },
        { cellId: 'city-c', totalVotes: 3, optionCounts: { 0: 3 } },
      ],
      hierarchy,
    )

    expect(result.aggregates).toEqual([
      expect.objectContaining({
        cellId: 'world',
        totalMappedVotes: 5,
        mergedCellCount: 2,
        maxMergeDepth: 2,
      }),
    ])
    expect(result.suppressedVoteCount).toBe(0)
  })

  it('suppresses votes that remain below k at the minimum resolution', () => {
    const result = aggregatePrivacySafeMapBuckets(
      [{ cellId: 'city-a', totalVotes: 4, optionCounts: { 0: 4 } }],
      hierarchy,
    )

    expect(result.aggregates).toEqual([])
    expect(result.suppressedVoteCount).toBe(4)
  })

  it('keeps a safe child marker while independently suppressing a sparse branch', () => {
    const result = aggregatePrivacySafeMapBuckets(
      [
        { cellId: 'city-a', totalVotes: 5, optionCounts: { 0: 5 } },
        { cellId: 'city-c', totalVotes: 2, optionCounts: { 0: 2 } },
      ],
      hierarchy,
    )

    expect(result.aggregates).toEqual([
      expect.objectContaining({
        cellId: 'city-a',
        totalMappedVotes: 5,
      }),
    ])
    expect(result.suppressedVoteCount).toBe(2)
  })

  it('suppresses the entire option breakdown when any answer count is below k', () => {
    const result = aggregatePrivacySafeMapBuckets(
      [{ cellId: 'city-a', totalVotes: 6, optionCounts: { 0: 5, 1: 1 } }],
      hierarchy,
    )

    expect(result.aggregates[0]).toMatchObject({
      totalMappedVotes: 6,
      optionBreakdown: [],
      breakdownSuppressed: true,
    })
  })

  it('publishes a breakdown only when every non-zero answer count reaches k', () => {
    const result = aggregatePrivacySafeMapBuckets(
      [{ cellId: 'city-a', totalVotes: 10, optionCounts: { 0: 5, 1: 5 } }],
      hierarchy,
    )

    expect(result.aggregates[0]).toMatchObject({
      breakdownSuppressed: false,
      optionBreakdown: [
        { optionIndex: 0, count: 5, percentage: 0.5 },
        { optionIndex: 1, count: 5, percentage: 0.5 },
      ],
    })
  })

  it('rejects thresholds below five and inconsistent vote totals', () => {
    expect(() =>
      aggregatePrivacySafeMapBuckets([], hierarchy, {
        thresholdK: 4,
      }),
    ).toThrow('Map privacy threshold must be at least 5')

    expect(() =>
      aggregatePrivacySafeMapBuckets(
        [{ cellId: 'city-a', totalVotes: 5, optionCounts: { 0: 4 } }],
        hierarchy,
      ),
    ).toThrow('must add up to totalVotes')
  })
})
