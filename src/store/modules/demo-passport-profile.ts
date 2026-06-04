import { create } from 'zustand'
import { combine } from 'zustand/middleware'

export type DemoProofRegistrationRecord = {
  kind: 'demo'
  proofId: string
  registrationId: string
  generatedAt: string
}

export type DemoPassportProfile = {
  kind: 'demo-passport-profile'
  firstName: string
  lastName: string
  birthDate: string
  expiryDate: string
  documentNumber: string
  nationality: string
  issuingAuthority: string
  createdAt: string
  proof: DemoProofRegistrationRecord
}

const useDemoPassportProfileStore = create(
  combine(
    {
      profile: undefined as DemoPassportProfile | undefined,
      votedProposalIds: [] as string[],
    },
    (set, get) => ({
      setProfile: (profile: DemoPassportProfile) => {
        set({ profile, votedProposalIds: [] })
      },
      markProposalVoted: (proposalId: string) => {
        if (get().votedProposalIds.includes(proposalId)) return
        set({ votedProposalIds: [...get().votedProposalIds, proposalId] })
      },
      clearProfile: () => {
        set({ profile: undefined, votedProposalIds: [] })
      },
    }),
  ),
)

export const demoPassportProfileStore = {
  useDemoPassportProfileStore,
}
