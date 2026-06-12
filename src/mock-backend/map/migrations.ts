import { createEmptyMockMapDatabase, type MockMapDatabase } from './schema'

export const MOCK_MAP_MIGRATIONS = [
  {
    version: 1,
    tables: [
      'map_poll_policies',
      'map_vote_events',
      'map_vote_answers',
      'map_pending_bindings',
      'map_location_claims',
      'map_marker_cache',
    ],
    constraints: [
      'unique_chain_event',
      'unique_proposal_nullifier',
      'one_answer_per_question',
      'one_location_claim_per_vote',
      'privacy_threshold_at_least_five',
    ],
  },
] as const

export const migrateMockMapDatabase = (database?: MockMapDatabase): MockMapDatabase => {
  const migrated = database ?? createEmptyMockMapDatabase()
  if (migrated.schemaVersion !== MOCK_MAP_MIGRATIONS.at(-1)?.version) {
    throw new Error(`Unsupported mock map schema version: ${migrated.schemaVersion}`)
  }
  return migrated
}
