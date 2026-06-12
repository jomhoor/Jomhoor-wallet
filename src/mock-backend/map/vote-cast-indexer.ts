import { type CanonicalBlock, MockMapBackend, type MockVoteCastLog } from './backend'
import type { MockMapVoteEventRow } from './schema'

/**
 * Mock event source for Phase 2. A production indexer can replace this class
 * without changing the map tables, decoder, finality, or cache interfaces.
 */
export class MockVoteCastIndexer {
  constructor(private readonly backend: MockMapBackend) {}

  ingest(log: MockVoteCastLog, observedHeadBlock: number): MockMapVoteEventRow {
    return this.backend.indexVoteCast(log, observedHeadBlock)
  }

  advanceChainHead(chainId: number, headBlock: number): void {
    this.backend.advanceChainHead(chainId, headBlock)
  }

  reconcileCanonicalBlock(block: CanonicalBlock): void {
    this.backend.reconcileCanonicalBlock(block)
  }
}
