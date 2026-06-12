import {
  createDefaultOptionalLocationPolicy,
  type EnabledProposalLocationPolicy,
  MAP_CELL_SCHEME,
  MAP_CONTRACT_VERSION,
  type MapContext,
  type ProposalParticipationPolicy,
} from '@/api/modules/map/contracts'

import { decodeOneHotAnswerMask, decodeOneHotAnswerMasks } from '../answer-mask'
import { MockMapBackend, type MockVoteCastLog } from '../backend'
import { MOCK_MAP_MIGRATIONS } from '../migrations'
import { MockMapRoutes } from '../routes'

const CHAIN_ID = 1
const CONTRACT = '0x1000000000000000000000000000000000000001'

const createHarness = (mode: 'disabled' | 'optional' | 'required' = 'optional') => {
  let now = Date.parse('2026-06-10T12:00:00.000Z')
  const backend = new MockMapBackend({
    now: () => now,
    finalityConfirmations: 3,
  })
  backend.setCellHierarchy([
    {
      cellId: 'root',
      resolution: 3,
      parentCellId: null,
      latitude: 35,
      longitude: 51,
    },
    {
      cellId: 'parent',
      resolution: 5,
      parentCellId: 'root',
      latitude: 35.5,
      longitude: 51.5,
    },
    {
      cellId: 'child',
      resolution: 6,
      parentCellId: 'parent',
      latitude: 35.6,
      longitude: 51.6,
    },
  ])

  const enabledLocation: EnabledProposalLocationPolicy = {
    ...createDefaultOptionalLocationPolicy(),
    mode: mode === 'required' ? 'required' : 'optional',
    source: 'either',
    publicationWindowSeconds: 300,
  }
  const policy: ProposalParticipationPolicy = {
    contractVersion: MAP_CONTRACT_VERSION,
    proposalId: '42',
    nationality: { mode: 'any' },
    age: { mode: 'any' },
    location: mode === 'disabled' ? { mode: 'disabled' } : enabledLocation,
  }
  backend.registerProposal(policy, [2, 3])

  const context: MapContext = {
    contractVersion: MAP_CONTRACT_VERSION,
    cellScheme: MAP_CELL_SCHEME,
    cellId: 'child',
    cellResolution: 6,
    source: 'current_device_area',
    policyVersion: 1,
    consentVersion: 1,
  }

  const createLog = (sequence: number, voteMasks: readonly bigint[] = [1n, 2n]) => {
    const hex = sequence.toString(16).padStart(64, '0')
    return {
      chainId: CHAIN_ID,
      proposalStateAddress: CONTRACT,
      proposalId: '42',
      userNullifier: BigInt(sequence),
      voteMasks,
      transactionHash: `0x${hex}`,
      logIndex: 0,
      blockNumber: 100,
      blockHash: `0x${(sequence + 100).toString(16).padStart(64, '0')}`,
    } satisfies MockVoteCastLog
  }

  const bind = (sequence: number, mapContext: unknown = context) => {
    const log = createLog(sequence)
    const relayRequestId = `relay-${sequence}`
    backend.createPendingBinding({
      relayRequestId,
      proposalId: '42',
      mapContext,
    })
    backend.bindPendingVoteToTransaction(relayRequestId, log.transactionHash)
    return log
  }

  return {
    backend,
    context,
    createLog,
    bind,
    advanceWindow: () => {
      now += 301_000
    },
  }
}

describe('mock map backend', () => {
  it('decodes exactly one supported option per question', () => {
    expect(decodeOneHotAnswerMask(1n, 3)).toBe(0)
    expect(decodeOneHotAnswerMask(4n, 3)).toBe(2)
    expect(decodeOneHotAnswerMasks([2n, 4n], [2, 3])).toEqual([1, 2])
    expect(() => decodeOneHotAnswerMask(0n, 3)).toThrow('exactly one')
    expect(() => decodeOneHotAnswerMask(3n, 3)).toThrow('exactly one')
    expect(() => decodeOneHotAnswerMask(8n, 3)).toThrow('unsupported')
    expect(() => decodeOneHotAnswerMasks([1n], [2, 3])).toThrow('question count')
  })

  it('defines the Phase 2 mock tables and privacy constraints', () => {
    expect(MOCK_MAP_MIGRATIONS[0].tables).toContain('map_vote_events')
    expect(MOCK_MAP_MIGRATIONS[0].tables).toContain('map_marker_cache')
    expect(MOCK_MAP_MIGRATIONS[0].constraints).toContain('privacy_threshold_at_least_five')
  })

  it('enforces disabled, optional, required, and strict map context policies', () => {
    const optional = createHarness('optional')
    expect(
      optional.backend.createPendingBinding({
        relayRequestId: 'without-location',
        proposalId: '42',
      }),
    ).toBeNull()
    expect(() =>
      optional.backend.createPendingBinding({
        relayRequestId: 'raw-coordinate',
        proposalId: '42',
        mapContext: { ...optional.context, latitude: 35.6 },
      }),
    ).toThrow('INVALID_MAP_CONTEXT')
    expect(() =>
      optional.backend.createPendingBinding({
        relayRequestId: 'unknown-cell',
        proposalId: '42',
        mapContext: { ...optional.context, cellId: 'unknown' },
      }),
    ).toThrow('LOCATION_CELL_NOT_FOUND')

    const required = createHarness('required')
    expect(() =>
      required.backend.createPendingBinding({
        relayRequestId: 'missing',
        proposalId: '42',
      }),
    ).toThrow('LOCATION_REQUIRED')

    const disabled = createHarness('disabled')
    expect(() =>
      disabled.backend.createPendingBinding({
        relayRequestId: 'disabled',
        proposalId: '42',
        mapContext: disabled.context,
      }),
    ).toThrow('LOCATION_DISABLED')
  })

  it('indexes idempotently and rejects invalid or duplicate anonymous votes', () => {
    const { backend, createLog } = createHarness()
    const log = createLog(1)
    const first = backend.indexVoteCast(log, 100)
    const second = backend.indexVoteCast(log, 100)

    expect(second.id).toBe(first.id)
    expect(backend.database.voteEvents).toHaveLength(1)
    expect(() => backend.indexVoteCast(createLog(2, [3n, 2n]), 100)).toThrow('exactly one')
    expect(() =>
      backend.indexVoteCast(
        {
          ...createLog(3),
          userNullifier: log.userNullifier,
        },
        100,
      ),
    ).toThrow('already indexed')
  })

  it('publishes finalized votes only at a new fixed cache window', () => {
    const { backend, bind, advanceWindow } = createHarness()
    backend.refreshMarkerCache()

    for (let sequence = 1; sequence <= 5; sequence += 1) {
      backend.indexVoteCast(bind(sequence), 100)
    }
    expect(backend.database.locationClaims).toHaveLength(0)

    backend.advanceChainHead(CHAIN_ID, 102)
    expect(backend.database.locationClaims).toHaveLength(5)

    backend.refreshMarkerCache()
    expect(backend.getMarkers({ proposalId: '42', questionIndex: 0 })).toEqual([])

    advanceWindow()
    backend.refreshMarkerCache()
    const markers = backend.getMarkers({ proposalId: '42', questionIndex: 0 })
    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({
      cellId: 'child',
      totalMappedVotes: 5,
      latitude: 35.6,
      longitude: 51.6,
    })
  })

  it('removes orphaned events and releases their pending binding for replacement', () => {
    const { backend, bind } = createHarness()
    const log = bind(1)
    backend.indexVoteCast(log, 100)

    backend.reconcileCanonicalBlock({
      chainId: CHAIN_ID,
      blockNumber: log.blockNumber,
      blockHash: `0x${'f'.repeat(64)}`,
    })

    expect(backend.database.voteEvents).toHaveLength(0)
    expect(backend.database.voteAnswers).toHaveLength(0)
    expect(backend.database.pendingBindings[0]).toMatchObject({
      state: 'pending',
      transactionHash: null,
    })
  })

  it('serves endpoint-shaped policy and marker responses without event identifiers', async () => {
    const { backend, bind, advanceWindow } = createHarness()
    for (let sequence = 1; sequence <= 5; sequence += 1) {
      backend.indexVoteCast(bind(sequence), 102)
    }
    advanceWindow()
    backend.refreshMarkerCache()

    const routes = new MockMapRoutes(backend)
    const policy = await routes.request({
      method: 'GET',
      path: '/v1/map/policies/42',
    })
    const markers = await routes.request({
      method: 'GET',
      path: '/v1/map/markers',
      query: { proposalId: '42', questionIndex: 0, resolution: 6 },
    })
    const publicPayload = JSON.stringify({ policy, markers })

    expect(publicPayload).not.toContain('nullifier')
    expect(publicPayload).not.toContain('transactionHash')
    expect(publicPayload).not.toContain('receiptHash')
    await expect(
      routes.request({
        method: 'GET',
        path: '/v1/map/markers',
        query: { proposalId: '42', questionIndex: 0, resolution: 5 },
      }),
    ).rejects.toMatchObject({ status: 400 })
  })
})
