import { keccak256, toUtf8Bytes } from 'ethers'

import {
  MAP_CELL_SCHEME,
  MAP_CONTRACT_VERSION,
  type MapCellResolution,
  type MapMarkersQuery,
  mapMarkersQuerySchema,
  type MapMarkersResponse,
  mapMarkersResponseSchema,
  type ProposalParticipationPolicy,
  proposalParticipationPolicySchema,
  validateMapContextForPolicy,
} from '@/api/modules/map/contracts'
import {
  aggregatePrivacySafeMapBuckets,
  type MapCellDefinition,
  type MapLeafVoteBucket,
} from '@/api/modules/map/privacy'

import { decodeOneHotAnswerMasks, type OneHotAnswerMask } from './answer-mask'
import { migrateMockMapDatabase } from './migrations'
import {
  type MockMapDatabase,
  type MockMapLocationClaimRow,
  type MockMapPendingBindingRow,
  type MockMapVoteEventRow,
} from './schema'

const DEFAULT_FINALITY_CONFIRMATIONS = 3
const DEFAULT_BINDING_TTL_SECONDS = 10 * 60

export type MockVoteCastLog = {
  chainId: number
  proposalStateAddress: string
  proposalId: string
  userNullifier: bigint | string
  voteMasks: readonly OneHotAnswerMask[]
  transactionHash: string
  logIndex: number
  blockNumber: number
  blockHash: string
}

export type MockMapBackendOptions = {
  now?: () => number
  finalityConfirmations?: number
  database?: MockMapDatabase
}

export type CreatePendingBindingInput = {
  relayRequestId: string
  proposalId: string
  mapContext?: unknown
  ttlSeconds?: number
}

export type CanonicalBlock = {
  chainId: number
  blockNumber: number
  blockHash: string
}

const normalizeHexIdentifier = (value: string, field: string): string => {
  const normalized = value.trim().toLowerCase()
  if (!/^0x[0-9a-f]+$/.test(normalized)) {
    throw new Error(`${field} must be a hexadecimal identifier`)
  }
  return normalized
}

const eventKey = (event: {
  chainId: number
  proposalStateAddress: string
  transactionHash: string
  logIndex: number
}): string =>
  [
    event.chainId,
    event.proposalStateAddress.toLowerCase(),
    event.transactionHash.toLowerCase(),
    event.logIndex,
  ].join(':')

const voteKey = (event: {
  chainId: number
  proposalStateAddress: string
  proposalId: string
  nullifierKeyHash: string
}): string =>
  [
    event.chainId,
    event.proposalStateAddress.toLowerCase(),
    event.proposalId,
    event.nullifierKeyHash,
  ].join(':')

const hashOpaqueValue = (value: string): string => keccak256(toUtf8Bytes(value))

const clonePolicy = (policy: ProposalParticipationPolicy): ProposalParticipationPolicy =>
  proposalParticipationPolicySchema.parse(policy)

export class MockMapBackend {
  readonly database: MockMapDatabase

  private readonly now: () => number
  private readonly finalityConfirmations: number
  private nextVoteEventId = 1

  constructor(options: MockMapBackendOptions = {}) {
    this.database = migrateMockMapDatabase(options.database)
    this.now = options.now ?? Date.now
    this.finalityConfirmations = options.finalityConfirmations ?? DEFAULT_FINALITY_CONFIRMATIONS

    if (!Number.isInteger(this.finalityConfirmations) || this.finalityConfirmations <= 0) {
      throw new Error('Finality confirmations must be a positive integer')
    }
  }

  setCellHierarchy(cells: readonly MapCellDefinition[]): void {
    const ids = new Set<string>()
    for (const cell of cells) {
      if (ids.has(cell.cellId)) throw new Error(`Duplicate map cell: ${cell.cellId}`)
      ids.add(cell.cellId)
    }

    this.database.cells = cells.map(cell => ({ ...cell }))
  }

  registerProposal(
    policyInput: ProposalParticipationPolicy,
    questionOptionCounts: readonly number[],
  ): void {
    const policy = proposalParticipationPolicySchema.parse(policyInput)
    if (
      questionOptionCounts.length === 0 ||
      questionOptionCounts.some(count => !Number.isInteger(count) || count <= 0)
    ) {
      throw new Error('A map proposal must define a positive option count for every question')
    }

    const timestamp = new Date(this.now()).toISOString()
    const existing = this.database.proposals.find(row => row.proposalId === policy.proposalId)
    if (existing) {
      existing.policy = clonePolicy(policy)
      existing.questionOptionCounts = [...questionOptionCounts]
      existing.updatedAt = timestamp
      return
    }

    this.database.proposals.push({
      proposalId: policy.proposalId,
      policy: clonePolicy(policy),
      questionOptionCounts: [...questionOptionCounts],
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  }

  getPolicy(proposalId: string): ProposalParticipationPolicy {
    return clonePolicy(this.getProposal(proposalId).policy)
  }

  createPendingBinding(input: CreatePendingBindingInput): MockMapPendingBindingRow | null {
    const proposal = this.getProposal(input.proposalId)
    const validation = validateMapContextForPolicy(proposal.policy.location, input.mapContext)
    if (!validation.ok) {
      throw new Error(`Map context rejected: ${validation.errorCode}`)
    }
    if (!validation.mapContext) return null

    const registeredCell = this.database.cells.find(
      cell => cell.cellId === validation.mapContext?.cellId,
    )
    if (!registeredCell || registeredCell.resolution !== validation.mapContext.cellResolution) {
      throw new Error('Map context rejected: LOCATION_CELL_NOT_FOUND')
    }

    if (this.database.pendingBindings.some(row => row.relayRequestId === input.relayRequestId)) {
      throw new Error('Relay request already has a map binding')
    }

    const ttlSeconds = input.ttlSeconds ?? DEFAULT_BINDING_TTL_SECONDS
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new Error('Map binding TTL must be a positive integer')
    }

    const receivedAt = this.now()
    const row: MockMapPendingBindingRow = {
      relayRequestId: input.relayRequestId,
      proposalId: proposal.proposalId,
      mapContext: validation.mapContext,
      transactionHash: null,
      receiptHash: hashOpaqueValue(`map-binding:${input.relayRequestId}`),
      receivedAt: new Date(receivedAt).toISOString(),
      expiresAt: new Date(receivedAt + ttlSeconds * 1000).toISOString(),
      state: 'pending',
    }
    this.database.pendingBindings.push(row)
    return { ...row, mapContext: { ...row.mapContext } }
  }

  bindPendingVoteToTransaction(relayRequestId: string, transactionHash: string): void {
    this.expirePendingBindings()
    const binding = this.database.pendingBindings.find(row => row.relayRequestId === relayRequestId)
    if (!binding || binding.state !== 'pending') {
      throw new Error('Pending map binding is unavailable')
    }

    const normalizedTransactionHash = normalizeHexIdentifier(transactionHash, 'Transaction hash')
    const conflicting = this.database.pendingBindings.find(
      row =>
        row.transactionHash === normalizedTransactionHash &&
        row.relayRequestId !== relayRequestId &&
        row.state !== 'expired',
    )
    if (conflicting) throw new Error('Transaction already has a map binding')

    binding.transactionHash = normalizedTransactionHash
  }

  indexVoteCast(logInput: MockVoteCastLog, observedHeadBlock: number): MockMapVoteEventRow {
    const proposal = this.getProposal(logInput.proposalId)
    const proposalStateAddress = normalizeHexIdentifier(
      logInput.proposalStateAddress,
      'Proposal state address',
    )
    const transactionHash = normalizeHexIdentifier(logInput.transactionHash, 'Transaction hash')
    const blockHash = normalizeHexIdentifier(logInput.blockHash, 'Block hash')

    if (
      !Number.isInteger(logInput.chainId) ||
      logInput.chainId <= 0 ||
      !Number.isInteger(logInput.logIndex) ||
      logInput.logIndex < 0 ||
      !Number.isInteger(logInput.blockNumber) ||
      logInput.blockNumber < 0 ||
      !Number.isInteger(observedHeadBlock) ||
      observedHeadBlock < logInput.blockNumber
    ) {
      throw new Error('VoteCast chain coordinates are invalid')
    }

    const key = eventKey({
      chainId: logInput.chainId,
      proposalStateAddress,
      transactionHash,
      logIndex: logInput.logIndex,
    })
    const existing = this.database.voteEvents.find(row => eventKey(row) === key)
    if (existing) return { ...existing }

    const answers = decodeOneHotAnswerMasks(logInput.voteMasks, proposal.questionOptionCounts)
    const nullifierKeyHash = hashOpaqueValue(
      [
        logInput.chainId,
        proposalStateAddress,
        proposal.proposalId,
        String(logInput.userNullifier),
      ].join(':'),
    )

    const duplicateVote = this.database.voteEvents.some(
      row =>
        voteKey(row) ===
        voteKey({
          chainId: logInput.chainId,
          proposalStateAddress,
          proposalId: proposal.proposalId,
          nullifierKeyHash,
        }),
    )
    if (duplicateVote) throw new Error('VoteCast nullifier was already indexed for this proposal')

    const finalized = observedHeadBlock - logInput.blockNumber + 1 >= this.finalityConfirmations
    const row: MockMapVoteEventRow = {
      id: `map-vote-${this.nextVoteEventId++}`,
      chainId: logInput.chainId,
      proposalStateAddress,
      proposalId: proposal.proposalId,
      nullifierKeyHash,
      transactionHash,
      logIndex: logInput.logIndex,
      blockNumber: logInput.blockNumber,
      blockHash,
      status: finalized ? 'finalized' : 'pending',
      finalizedAt: finalized ? new Date(this.now()).toISOString() : null,
    }
    this.database.voteEvents.push(row)
    answers.forEach((optionIndex, questionIndex) => {
      this.database.voteAnswers.push({
        voteEventId: row.id,
        questionIndex,
        optionIndex,
      })
    })

    if (finalized) this.finalizeLocationClaim(row)
    return { ...row }
  }

  advanceChainHead(chainId: number, headBlock: number): void {
    if (!Number.isInteger(chainId) || chainId <= 0 || !Number.isInteger(headBlock)) {
      throw new Error('Chain head is invalid')
    }

    this.expirePendingBindings()
    for (const event of this.database.voteEvents) {
      if (
        event.chainId !== chainId ||
        event.status !== 'pending' ||
        headBlock - event.blockNumber + 1 < this.finalityConfirmations
      ) {
        continue
      }

      event.status = 'finalized'
      event.finalizedAt = new Date(this.now()).toISOString()
      this.finalizeLocationClaim(event)
    }
  }

  reconcileCanonicalBlock(block: CanonicalBlock): void {
    const blockHash = normalizeHexIdentifier(block.blockHash, 'Canonical block hash')
    const orphanedIds = this.database.voteEvents
      .filter(
        event =>
          event.chainId === block.chainId &&
          event.blockNumber === block.blockNumber &&
          event.blockHash !== blockHash,
      )
      .map(event => event.id)

    if (orphanedIds.length === 0) return

    const orphanedIdSet = new Set(orphanedIds)
    const orphanedTransactions = new Set(
      this.database.voteEvents
        .filter(event => orphanedIdSet.has(event.id))
        .map(event => event.transactionHash),
    )

    this.database.voteEvents = this.database.voteEvents.filter(
      event => !orphanedIdSet.has(event.id),
    )
    this.database.voteAnswers = this.database.voteAnswers.filter(
      answer => !orphanedIdSet.has(answer.voteEventId),
    )
    this.database.locationClaims = this.database.locationClaims.filter(
      claim => !orphanedIdSet.has(claim.voteEventId),
    )

    for (const binding of this.database.pendingBindings) {
      if (!binding.transactionHash || !orphanedTransactions.has(binding.transactionHash)) continue
      binding.transactionHash = null
      binding.state = 'pending'
    }
  }

  refreshMarkerCache(): void {
    const now = this.now()
    for (const proposal of this.database.proposals) {
      const locationPolicy = proposal.policy.location
      if (locationPolicy.mode === 'disabled') continue

      const windowStartedAtMs =
        Math.floor(now / (locationPolicy.publicationWindowSeconds * 1000)) *
        locationPolicy.publicationWindowSeconds *
        1000
      const publicationWindowStartedAt = new Date(windowStartedAtMs).toISOString()

      proposal.questionOptionCounts.forEach((_, questionIndex) => {
        const alreadyPublished = this.database.markerCache.some(
          row =>
            row.proposalId === proposal.proposalId &&
            row.questionIndex === questionIndex &&
            row.publicationWindowStartedAt === publicationWindowStartedAt,
        )
        if (alreadyPublished) return

        const markers = this.buildMarkers(proposal.policy, questionIndex)
        this.database.markerCache.push({
          proposalId: proposal.proposalId,
          questionIndex,
          publicationWindowStartedAt,
          refreshedAt: new Date(now).toISOString(),
          markers,
        })
      })
    }
  }

  getMarkers(queryInput: MapMarkersQuery): MapMarkersResponse {
    const query = mapMarkersQuerySchema.parse(queryInput)
    const proposal = this.getProposal(query.proposalId)
    if (query.questionIndex >= proposal.questionOptionCounts.length) {
      throw new Error('Map question index is outside the proposal question range')
    }

    const locationPolicy = proposal.policy.location
    if (locationPolicy.mode === 'disabled') return []
    if (
      query.resolution !== undefined &&
      query.resolution !== locationPolicy.collectionResolution
    ) {
      throw new Error('Only the proposal publication resolution may be queried')
    }

    const cache = this.database.markerCache
      .filter(
        row => row.proposalId === query.proposalId && row.questionIndex === query.questionIndex,
      )
      .sort((left, right) =>
        right.publicationWindowStartedAt.localeCompare(left.publicationWindowStartedAt),
      )[0]

    return mapMarkersResponseSchema.parse(cache?.markers ?? [])
  }

  private getProposal(proposalId: string) {
    const normalized = proposalId.trim()
    const proposal = this.database.proposals.find(row => row.proposalId === normalized)
    if (!proposal) throw new Error(`Unknown map proposal: ${normalized}`)
    return proposal
  }

  private expirePendingBindings(): void {
    const now = this.now()
    for (const binding of this.database.pendingBindings) {
      if (binding.state === 'pending' && Date.parse(binding.expiresAt) <= now) {
        binding.state = 'expired'
      }
    }
  }

  private finalizeLocationClaim(event: MockMapVoteEventRow): void {
    if (this.database.locationClaims.some(claim => claim.voteEventId === event.id)) return

    this.expirePendingBindings()
    const binding = this.database.pendingBindings.find(
      row =>
        row.state === 'pending' &&
        row.transactionHash === event.transactionHash &&
        row.proposalId === event.proposalId,
    )
    if (!binding) return

    const claim: MockMapLocationClaimRow = {
      voteEventId: event.id,
      cellId: binding.mapContext.cellId,
      cellResolution: binding.mapContext.cellResolution,
      source: binding.mapContext.source,
      policyVersion: binding.mapContext.policyVersion,
      consentVersion: binding.mapContext.consentVersion,
      claimReceiptHash: binding.receiptHash,
      receivedAt: binding.receivedAt,
    }
    this.database.locationClaims.push(claim)
    binding.state = 'consumed'
  }

  private buildMarkers(
    policy: ProposalParticipationPolicy,
    questionIndex: number,
  ): MapMarkersResponse {
    const locationPolicy = policy.location
    if (locationPolicy.mode === 'disabled') return []

    const buckets = new Map<string, MapLeafVoteBucket & { optionCounts: Record<string, number> }>()
    for (const claim of this.database.locationClaims) {
      const event = this.database.voteEvents.find(
        candidate => candidate.id === claim.voteEventId && candidate.status === 'finalized',
      )
      if (!event || event.proposalId !== policy.proposalId) continue
      if (
        claim.policyVersion !== locationPolicy.policyVersion ||
        claim.consentVersion !== locationPolicy.consentVersion
      ) {
        continue
      }

      const answer = this.database.voteAnswers.find(
        candidate =>
          candidate.voteEventId === event.id && candidate.questionIndex === questionIndex,
      )
      if (!answer) continue

      const existing = buckets.get(claim.cellId) ?? {
        cellId: claim.cellId,
        totalVotes: 0,
        optionCounts: {},
      }
      existing.totalVotes += 1
      existing.optionCounts[String(answer.optionIndex)] =
        (existing.optionCounts[String(answer.optionIndex)] ?? 0) + 1
      buckets.set(claim.cellId, existing)
    }

    const result = aggregatePrivacySafeMapBuckets([...buckets.values()], this.database.cells, {
      thresholdK: locationPolicy.privacyThresholdK,
      minimumPublishedResolution: locationPolicy.minimumPublishedResolution as MapCellResolution,
    })

    return mapMarkersResponseSchema.parse(
      result.aggregates.map(aggregate => ({
        contractVersion: MAP_CONTRACT_VERSION,
        proposalId: policy.proposalId,
        questionIndex,
        cellScheme: MAP_CELL_SCHEME,
        cellId: aggregate.cellId,
        cellResolution: aggregate.cellResolution,
        parentCellId: aggregate.parentCellId,
        latitude: aggregate.latitude,
        longitude: aggregate.longitude,
        totalMappedVotes: aggregate.totalMappedVotes,
        optionBreakdown: aggregate.optionBreakdown,
        breakdownSuppressed: aggregate.breakdownSuppressed,
        privacy: {
          thresholdK: locationPolicy.privacyThresholdK,
          policyVersion: locationPolicy.policyVersion,
          mergedCellCount: aggregate.mergedCellCount,
          maxMergeDepth: aggregate.maxMergeDepth,
          publicationWindowSeconds: locationPolicy.publicationWindowSeconds,
        },
      })),
    )
  }
}
