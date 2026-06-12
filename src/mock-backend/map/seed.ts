import {
  createDefaultOptionalLocationPolicy,
  type EnabledProposalLocationPolicy,
  MAP_CELL_SCHEME,
  MAP_CONTRACT_VERSION,
  type MapContext,
  type ProposalLocationPolicy,
  type ProposalParticipationPolicy,
} from '@/api/modules/map/contracts'

import { MockMapBackend, type MockMapBackendOptions } from './backend'

const MOCK_CHAIN_ID = 7368
const MOCK_PROPOSAL_STATE_ADDRESS = '0x1000000000000000000000000000000000000001'

const createParticipationPolicy = (
  proposalId: string,
  location: ProposalLocationPolicy,
): ProposalParticipationPolicy => ({
  contractVersion: MAP_CONTRACT_VERSION,
  proposalId,
  nationality: { mode: 'any' },
  age: { mode: 'any' },
  location,
})

const enabledPolicy = (
  mode: 'optional' | 'required',
  source: 'current_device_area' | 'saved_home_area' | 'either',
): EnabledProposalLocationPolicy => ({
  ...createDefaultOptionalLocationPolicy(),
  mode,
  source,
})

const contextFor = (policy: EnabledProposalLocationPolicy, cellId: string): MapContext => ({
  contractVersion: MAP_CONTRACT_VERSION,
  cellScheme: MAP_CELL_SCHEME,
  cellId,
  cellResolution: policy.collectionResolution,
  source: policy.source === 'saved_home_area' ? 'saved_home_area' : 'current_device_area',
  policyVersion: policy.policyVersion,
  consentVersion: policy.consentVersion,
})

const toHex = (value: number, width = 64): string => `0x${value.toString(16).padStart(width, '0')}`

export const createSeededMockMapBackend = (options: MockMapBackendOptions = {}): MockMapBackend => {
  const backend = new MockMapBackend(options)
  backend.setCellHierarchy([
    {
      cellId: 'mock-h3-3-iran',
      resolution: 3,
      parentCellId: null,
      latitude: 32.4279,
      longitude: 53.688,
    },
    {
      cellId: 'mock-h3-4-tehran',
      resolution: 4,
      parentCellId: 'mock-h3-3-iran',
      latitude: 35.6892,
      longitude: 51.389,
    },
    {
      cellId: 'mock-h3-5-tehran-west',
      resolution: 5,
      parentCellId: 'mock-h3-4-tehran',
      latitude: 35.7219,
      longitude: 51.3347,
    },
    {
      cellId: 'mock-h3-5-tehran-east',
      resolution: 5,
      parentCellId: 'mock-h3-4-tehran',
      latitude: 35.7167,
      longitude: 51.5233,
    },
    {
      cellId: 'mock-h3-6-tehran-west-a',
      resolution: 6,
      parentCellId: 'mock-h3-5-tehran-west',
      latitude: 35.735,
      longitude: 51.31,
    },
    {
      cellId: 'mock-h3-6-tehran-west-b',
      resolution: 6,
      parentCellId: 'mock-h3-5-tehran-west',
      latitude: 35.705,
      longitude: 51.355,
    },
    {
      cellId: 'mock-h3-6-tehran-east-a',
      resolution: 6,
      parentCellId: 'mock-h3-5-tehran-east',
      latitude: 35.73,
      longitude: 51.5,
    },
    {
      cellId: 'mock-h3-6-tehran-east-b',
      resolution: 6,
      parentCellId: 'mock-h3-5-tehran-east',
      latitude: 35.695,
      longitude: 51.545,
    },
  ])

  const optionalPolicy = enabledPolicy('optional', 'either')
  const requiredPolicy = enabledPolicy('required', 'current_device_area')
  backend.registerProposal(createParticipationPolicy('1', optionalPolicy), [2, 3])
  backend.registerProposal(createParticipationPolicy('2', requiredPolicy), [2])
  backend.registerProposal(createParticipationPolicy('3', { mode: 'disabled' }), [2])

  let sequence = 1
  const seedVote = (
    proposalId: string,
    policy: EnabledProposalLocationPolicy,
    cellId: string,
    optionIndexes: number[],
  ) => {
    const relayRequestId = `mock-relay-${sequence}`
    const transactionHash = toHex(sequence)
    const blockNumber = 1_000 + sequence
    backend.createPendingBinding({
      relayRequestId,
      proposalId,
      mapContext: contextFor(policy, cellId),
    })
    backend.bindPendingVoteToTransaction(relayRequestId, transactionHash)
    backend.indexVoteCast(
      {
        chainId: MOCK_CHAIN_ID,
        proposalStateAddress: MOCK_PROPOSAL_STATE_ADDRESS,
        proposalId,
        userNullifier: BigInt(100_000 + sequence),
        voteMasks: optionIndexes.map(optionIndex => 1n << BigInt(optionIndex)),
        transactionHash,
        logIndex: 0,
        blockNumber,
        blockHash: toHex(blockNumber + 10_000),
      },
      blockNumber + 10,
    )
    sequence += 1
  }

  for (let index = 0; index < 3; index += 1) {
    seedVote('1', optionalPolicy, 'mock-h3-6-tehran-west-a', [0, index % 3])
    seedVote('1', optionalPolicy, 'mock-h3-6-tehran-west-b', [0, index % 3])
  }
  for (let index = 0; index < 6; index += 1) {
    seedVote('1', optionalPolicy, 'mock-h3-6-tehran-east-a', [index === 5 ? 1 : 0, 1])
  }
  for (let index = 0; index < 5; index += 1) {
    seedVote('1', optionalPolicy, 'mock-h3-6-tehran-east-b', [1, 2])
    seedVote('2', requiredPolicy, 'mock-h3-6-tehran-east-b', [index % 2])
  }

  backend.refreshMarkerCache()
  return backend
}
