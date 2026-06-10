import {
  type MapCellResolution,
  mapMarkersQuerySchema,
  mapMarkersResponseSchema,
  mapProposalCatalogResponseSchema,
  proposalParticipationPolicySchema,
} from '@/api/modules/map/contracts'

import type { MockMapBackend } from './backend'

export class MockBackendHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'MockBackendHttpError'
  }
}

export type MockBackendRequest = {
  method: 'GET'
  path: string
  query?: Readonly<Record<string, string | number | undefined>>
}

export class MockMapRoutes {
  constructor(private readonly backend: MockMapBackend) {}

  async request(request: MockBackendRequest): Promise<unknown> {
    if (request.method !== 'GET') {
      throw new MockBackendHttpError(405, 'Method not allowed')
    }

    if (request.path === '/v1/map/markers') {
      try {
        const resolution = request.query?.resolution
        const query = mapMarkersQuerySchema.parse({
          proposalId: request.query?.proposalId,
          questionIndex: Number(request.query?.questionIndex),
          resolution:
            resolution === undefined ? undefined : (Number(resolution) as MapCellResolution),
        })
        return mapMarkersResponseSchema.parse(this.backend.getMarkers(query))
      } catch (error) {
        throw new MockBackendHttpError(
          400,
          error instanceof Error ? error.message : 'Invalid marker request',
        )
      }
    }

    if (request.path === '/v1/map/catalog') {
      return mapProposalCatalogResponseSchema.parse(this.backend.getCatalog())
    }

    const policyMatch = request.path.match(/^\/v1\/map\/policies\/([^/]+)$/)
    if (policyMatch) {
      try {
        return proposalParticipationPolicySchema.parse(
          this.backend.getPolicy(decodeURIComponent(policyMatch[1])),
        )
      } catch (error) {
        throw new MockBackendHttpError(
          404,
          error instanceof Error ? error.message : 'Map policy not found',
        )
      }
    }

    throw new MockBackendHttpError(404, 'Mock endpoint not found')
  }
}
