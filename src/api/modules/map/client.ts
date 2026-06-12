import { getMockBackendRoutes } from '@/mock-backend'

import {
  type MapMarkersQuery,
  mapMarkersQuerySchema,
  type MapMarkersResponse,
  mapMarkersResponseSchema,
  type MapProposalCatalogResponse,
  mapProposalCatalogResponseSchema,
  type ProposalParticipationPolicy,
  proposalParticipationPolicySchema,
} from './contracts'

export const getMapMarkers = async (queryInput: MapMarkersQuery): Promise<MapMarkersResponse> => {
  const query = mapMarkersQuerySchema.parse(queryInput)
  const response = await getMockBackendRoutes().request({
    method: 'GET',
    path: '/v1/map/markers',
    query,
  })
  return mapMarkersResponseSchema.parse(response)
}

export const getProposalMapPolicy = async (
  proposalId: string,
): Promise<ProposalParticipationPolicy> => {
  const response = await getMockBackendRoutes().request({
    method: 'GET',
    path: `/v1/map/policies/${encodeURIComponent(proposalId)}`,
  })
  return proposalParticipationPolicySchema.parse(response)
}

export const getMapProposalCatalog = async (): Promise<MapProposalCatalogResponse> => {
  const response = await getMockBackendRoutes().request({
    method: 'GET',
    path: '/v1/map/catalog',
  })
  return mapProposalCatalogResponseSchema.parse(response)
}
