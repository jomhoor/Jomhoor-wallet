/// <reference types="jest" />

import type { DemoPassportProfile } from '../demo-passport-profile'
import { demoPassportProfileStore } from '../demo-passport-profile'

const profile: DemoPassportProfile = {
  kind: 'demo-passport-profile',
  firstName: 'Reviewer',
  lastName: 'Demo',
  birthDate: '740812',
  expiryDate: '300101',
  documentNumber: 'L898902C3',
  nationality: 'IRN',
  issuingAuthority: 'IRN',
  createdAt: '2026-06-03T00:00:00.000Z',
  proof: {
    kind: 'demo',
    proofId: 'demo-proof-1',
    registrationId: 'demo-registration-1',
    generatedAt: '2026-06-03T00:00:00.000Z',
  },
}

describe('demoPassportProfileStore', () => {
  beforeEach(() => {
    demoPassportProfileStore.useDemoPassportProfileStore.getState().clearProfile()
  })

  it('records demo votes in memory without creating a real identity', () => {
    const store = demoPassportProfileStore.useDemoPassportProfileStore

    store.getState().setProfile(profile)
    store.getState().markProposalVoted('42')
    store.getState().markProposalVoted('42')

    expect(store.getState().profile).toEqual(profile)
    expect(store.getState().votedProposalIds).toEqual(['42'])
  })

  it('clears the profile and local vote history together', () => {
    const store = demoPassportProfileStore.useDemoPassportProfileStore

    store.getState().setProfile(profile)
    store.getState().markProposalVoted('42')
    store.getState().clearProfile()

    expect(store.getState().profile).toBeUndefined()
    expect(store.getState().votedProposalIds).toEqual([])
  })
})
