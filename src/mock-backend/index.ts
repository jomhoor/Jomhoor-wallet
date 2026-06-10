import { createSeededMockMapBackend, MockMapRoutes } from './map'

let mapBackend: ReturnType<typeof createSeededMockMapBackend> | undefined
let backendRoutes: MockMapRoutes | undefined

export const getMockMapBackend = () => {
  mapBackend ??= createSeededMockMapBackend()
  return mapBackend
}

export const getMockBackendRoutes = () => {
  backendRoutes ??= new MockMapRoutes(getMockMapBackend())
  return backendRoutes
}

export * from './map'
