import {
  createDefaultOptionalLocationPolicy,
  MAP_CELL_SCHEME,
  MAP_CONTRACT_VERSION,
  MAP_DEFAULT_COLLECTION_RESOLUTION,
  MAP_DEFAULT_PRIVACY_THRESHOLD_K,
  MAP_DEFAULT_PUBLICATION_WINDOW_SECONDS,
  MAP_MIN_PUBLISHED_RESOLUTION,
  MAP_PRIVACY_POLICY_VERSION,
  mapContextSchema,
  mapMarkerSchema,
  proposalParticipationPolicySchema,
  validateMapContextForPolicy,
} from '../contracts'

describe('map contracts', () => {
  it('creates a valid default optional location policy', () => {
    const policy = createDefaultOptionalLocationPolicy()

    expect(policy).toEqual({
      mode: 'optional',
      source: 'either',
      cellScheme: MAP_CELL_SCHEME,
      collectionResolution: MAP_DEFAULT_COLLECTION_RESOLUTION,
      minimumPublishedResolution: MAP_MIN_PUBLISHED_RESOLUTION,
      privacyThresholdK: MAP_DEFAULT_PRIVACY_THRESHOLD_K,
      publicationWindowSeconds: MAP_DEFAULT_PUBLICATION_WINDOW_SECONDS,
      allowedCellIds: [],
      policyVersion: MAP_PRIVACY_POLICY_VERSION,
      consentVersion: 1,
    })

    expect(
      proposalParticipationPolicySchema.safeParse({
        contractVersion: MAP_CONTRACT_VERSION,
        proposalId: '42',
        nationality: { mode: 'identified' },
        age: { mode: 'range', minimumAge: 18, maximumAge: null },
        location: policy,
      }).success,
    ).toBe(true)
  })

  it('rejects map contexts containing raw coordinates', () => {
    const result = mapContextSchema.safeParse({
      contractVersion: MAP_CONTRACT_VERSION,
      cellScheme: MAP_CELL_SCHEME,
      cellId: '862a1072fffffff',
      cellResolution: MAP_DEFAULT_COLLECTION_RESOLUTION,
      source: 'current_device_area',
      policyVersion: 1,
      consentVersion: 1,
      latitude: 35.6892,
      longitude: 51.389,
    })

    expect(result.success).toBe(false)
  })

  it('rejects proposal privacy thresholds below five', () => {
    const result = proposalParticipationPolicySchema.safeParse({
      contractVersion: MAP_CONTRACT_VERSION,
      proposalId: '42',
      nationality: { mode: 'any' },
      age: { mode: 'any' },
      location: {
        ...createDefaultOptionalLocationPolicy(),
        privacyThresholdK: 4,
      },
    })

    expect(result.success).toBe(false)
  })

  it('rejects invalid age and map resolution ranges', () => {
    const result = proposalParticipationPolicySchema.safeParse({
      contractVersion: MAP_CONTRACT_VERSION,
      proposalId: '42',
      nationality: { mode: 'allowlist', allowedCountryCodes: ['IR'] },
      age: { mode: 'range', minimumAge: 65, maximumAge: 18 },
      location: {
        ...createDefaultOptionalLocationPolicy(),
        collectionResolution: 4,
        minimumPublishedResolution: 5,
      },
    })

    expect(result.success).toBe(false)
  })

  it('requires suppressed marker breakdowns to be empty', () => {
    const result = mapMarkerSchema.safeParse({
      contractVersion: MAP_CONTRACT_VERSION,
      proposalId: '42',
      questionIndex: 0,
      cellScheme: MAP_CELL_SCHEME,
      cellId: '852a1073fffffff',
      cellResolution: 5,
      parentCellId: '842a107ffffffff',
      latitude: 35.7,
      longitude: 51.4,
      totalMappedVotes: 10,
      optionBreakdown: [{ optionIndex: 0, count: 10, percentage: 1 }],
      breakdownSuppressed: true,
      privacy: {
        thresholdK: 5,
        policyVersion: 1,
        mergedCellCount: 2,
        maxMergeDepth: 1,
        publicationWindowSeconds: MAP_DEFAULT_PUBLICATION_WINDOW_SECONDS,
      },
    })

    expect(result.success).toBe(false)
  })

  it('enforces disabled, optional, and required location policies', () => {
    const optionalPolicy = createDefaultOptionalLocationPolicy()
    const requiredPolicy = {
      ...optionalPolicy,
      mode: 'required' as const,
    }
    const mapContext = {
      contractVersion: MAP_CONTRACT_VERSION,
      cellScheme: MAP_CELL_SCHEME,
      cellId: '862a1072fffffff',
      cellResolution: MAP_DEFAULT_COLLECTION_RESOLUTION,
      source: 'current_device_area' as const,
      policyVersion: MAP_PRIVACY_POLICY_VERSION,
      consentVersion: 1,
    }

    expect(validateMapContextForPolicy({ mode: 'disabled' }, undefined)).toEqual({
      ok: true,
      mapContext: null,
    })
    expect(validateMapContextForPolicy({ mode: 'disabled' }, mapContext)).toEqual({
      ok: false,
      errorCode: 'LOCATION_DISABLED',
    })
    expect(validateMapContextForPolicy(optionalPolicy, undefined)).toEqual({
      ok: true,
      mapContext: null,
    })
    expect(validateMapContextForPolicy(requiredPolicy, undefined)).toEqual({
      ok: false,
      errorCode: 'LOCATION_REQUIRED',
    })
    expect(validateMapContextForPolicy(requiredPolicy, mapContext)).toEqual({
      ok: true,
      mapContext,
    })
  })

  it('rejects stale, disallowed, and raw-coordinate map contexts', () => {
    const policy = {
      ...createDefaultOptionalLocationPolicy(),
      mode: 'required' as const,
      source: 'saved_home_area' as const,
      allowedCellIds: ['allowed-cell'],
    }
    const baseContext = {
      contractVersion: MAP_CONTRACT_VERSION,
      cellScheme: MAP_CELL_SCHEME,
      cellId: 'allowed-cell',
      cellResolution: MAP_DEFAULT_COLLECTION_RESOLUTION,
      source: 'saved_home_area' as const,
      policyVersion: MAP_PRIVACY_POLICY_VERSION,
      consentVersion: 1,
    }

    expect(
      validateMapContextForPolicy(policy, {
        ...baseContext,
        policyVersion: 2,
      }),
    ).toEqual({
      ok: false,
      errorCode: 'POLICY_VERSION_MISMATCH',
    })
    expect(
      validateMapContextForPolicy(policy, {
        ...baseContext,
        source: 'current_device_area',
      }),
    ).toEqual({
      ok: false,
      errorCode: 'LOCATION_SOURCE_NOT_ALLOWED',
    })
    expect(
      validateMapContextForPolicy(policy, {
        ...baseContext,
        cellId: 'outside-allowed-area',
      }),
    ).toEqual({
      ok: false,
      errorCode: 'LOCATION_CELL_NOT_ALLOWED',
    })
    expect(
      validateMapContextForPolicy(policy, {
        ...baseContext,
        latitude: 35.6892,
        longitude: 51.389,
      }),
    ).toEqual({
      ok: false,
      errorCode: 'INVALID_MAP_CONTEXT',
    })
  })

  it('requires visible marker option counts to cover the published total', () => {
    const result = mapMarkerSchema.safeParse({
      contractVersion: MAP_CONTRACT_VERSION,
      proposalId: '42',
      questionIndex: 0,
      cellScheme: MAP_CELL_SCHEME,
      cellId: '852a1073fffffff',
      cellResolution: 5,
      parentCellId: '842a107ffffffff',
      latitude: 35.7,
      longitude: 51.4,
      totalMappedVotes: 10,
      optionBreakdown: [{ optionIndex: 0, count: 5, percentage: 0.5 }],
      breakdownSuppressed: false,
      privacy: {
        thresholdK: 5,
        policyVersion: 1,
        mergedCellCount: 2,
        maxMergeDepth: 1,
        publicationWindowSeconds: MAP_DEFAULT_PUBLICATION_WINDOW_SECONDS,
      },
    })

    expect(result.success).toBe(false)
  })
})
