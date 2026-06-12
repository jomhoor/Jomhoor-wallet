import { JsonRpcProvider } from 'ethers'

import { apiClient } from '@/api/client'
import { RARIMO_CHAINS } from '@/api/modules/rarimo'
import { Config } from '@/config'
import { createProposalContract } from '@/helpers'
import { type ProposalMetadata, ProposalStatus } from '@/pages/app/pages/poll/types'
import { parseProposalFromContract } from '@/pages/app/pages/poll/utils'

import {
  buildFallbackProposalMetadata,
  parseInlineProposalMetadata,
  validateProposalMetadata,
} from './metadata'

const rmoProvider = new JsonRpcProvider(RARIMO_CHAINS[Config.RMO_CHAIN_ID].rpcEvm)
const proposalContract = createProposalContract(Config.PROPOSAL_STATE_CONTRACT_ADDRESS, rmoProvider)

export type ProposalCatalogItem = {
  id: number
  title: string
  description: string
  metadata: ProposalMetadata
  status: ProposalStatus
  startTimestamp: number
  duration: number
  nationalities: string[]
  totalVotes: number
}

const loadProposalMetadata = async (
  proposalId: number,
  cid: string,
  voteResults: readonly (readonly number[])[],
): Promise<ProposalMetadata> => {
  const fallback = buildFallbackProposalMetadata(proposalId, voteResults, cid)
  const inlineMetadata = parseInlineProposalMetadata(cid)
  if (inlineMetadata) return inlineMetadata

  if (String(Config.RMO_CHAIN_ID) === '31337' || !cid.trim()) return fallback

  try {
    const cleanCid = cid.replace(/^ipfs:\/\//, '')
    const response = await apiClient.get<unknown>(`${Config.IPFS_NODE_URL}/${cleanCid}`)
    return validateProposalMetadata(response.data) ?? fallback
  } catch {
    return fallback
  }
}

export const loadProposalCatalog = async (): Promise<ProposalCatalogItem[]> => {
  const lastProposalId = await proposalContract.contractInstance.lastProposalId()
  const proposalCount = Number(lastProposalId)
  if (proposalCount === 0) return []

  const proposals = await Promise.all(
    Array.from({ length: proposalCount }, async (_, index): Promise<ProposalCatalogItem | null> => {
      const proposalId = index + 1
      try {
        const raw = await proposalContract.contractInstance.getProposalInfo(BigInt(proposalId))
        const parsed = parseProposalFromContract(raw)
        if (parsed.status === ProposalStatus.DoNotShow || parsed.status === ProposalStatus.None) {
          return null
        }

        const metadata = await loadProposalMetadata(proposalId, parsed.cid, parsed.voteResults)
        const totalVotes = parsed.voteResults.reduce(
          (sum, questionVotes) =>
            sum + questionVotes.reduce((questionSum, count) => questionSum + count, 0),
          0,
        )

        return {
          id: proposalId,
          title: metadata.title,
          description: metadata.description,
          metadata,
          status: parsed.status,
          startTimestamp: parsed.startTimestamp,
          duration: parsed.duration,
          nationalities: parsed.votingWhitelistData?.nationalities ?? [],
          totalVotes,
        } satisfies ProposalCatalogItem
      } catch {
        return null
      }
    }),
  )

  return proposals.filter((proposal): proposal is ProposalCatalogItem => proposal !== null)
}
