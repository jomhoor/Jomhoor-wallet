import type {
  MapContext,
  MapMarker,
  ProposalParticipationPolicy,
} from '@/api/modules/map/contracts'
import type { MapCellDefinition } from '@/api/modules/map/privacy'

export const MOCK_MAP_SCHEMA_VERSION = 1 as const

export type MockMapProposalRow = {
  proposalId: string
  policy: ProposalParticipationPolicy
  questionOptionCounts: number[]
  createdAt: string
  updatedAt: string
}

export type MockMapVoteEventStatus = 'pending' | 'finalized'

export type MockMapVoteEventRow = {
  id: string
  chainId: number
  proposalStateAddress: string
  proposalId: string
  nullifierKeyHash: string
  transactionHash: string
  logIndex: number
  blockNumber: number
  blockHash: string
  status: MockMapVoteEventStatus
  finalizedAt: string | null
}

export type MockMapVoteAnswerRow = {
  voteEventId: string
  questionIndex: number
  optionIndex: number
}

export type MockMapPendingBindingState = 'pending' | 'consumed' | 'expired'

export type MockMapPendingBindingRow = {
  relayRequestId: string
  proposalId: string
  mapContext: MapContext
  transactionHash: string | null
  receiptHash: string
  receivedAt: string
  expiresAt: string
  state: MockMapPendingBindingState
}

export type MockMapLocationClaimRow = {
  voteEventId: string
  cellId: string
  cellResolution: MapContext['cellResolution']
  source: MapContext['source']
  policyVersion: number
  consentVersion: number
  claimReceiptHash: string
  receivedAt: string
}

export type MockMapMarkerCacheRow = {
  proposalId: string
  questionIndex: number
  publicationWindowStartedAt: string
  refreshedAt: string
  markers: MapMarker[]
}

export type MockMapDatabase = {
  schemaVersion: typeof MOCK_MAP_SCHEMA_VERSION
  cells: MapCellDefinition[]
  proposals: MockMapProposalRow[]
  voteEvents: MockMapVoteEventRow[]
  voteAnswers: MockMapVoteAnswerRow[]
  pendingBindings: MockMapPendingBindingRow[]
  locationClaims: MockMapLocationClaimRow[]
  markerCache: MockMapMarkerCacheRow[]
}

export const createEmptyMockMapDatabase = (): MockMapDatabase => ({
  schemaVersion: MOCK_MAP_SCHEMA_VERSION,
  cells: [],
  proposals: [],
  voteEvents: [],
  voteAnswers: [],
  pendingBindings: [],
  locationClaims: [],
  markerCache: [],
})
