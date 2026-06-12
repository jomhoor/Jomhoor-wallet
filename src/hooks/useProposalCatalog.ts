import { useQuery } from '@tanstack/react-query'

import { loadProposalCatalog } from '@/api/modules/proposals'

export const proposalCatalogQueryKey = ['proposalCatalog'] as const

export const useProposalCatalog = () =>
  useQuery({
    queryKey: proposalCatalogQueryKey,
    queryFn: loadProposalCatalog,
    staleTime: 30_000,
  })
