import { create } from 'zustand'
import { combine } from 'zustand/middleware'

export type DemoProofRegistrationRecord = {
  kind: 'demo'
  proofId: string
  registrationId: string
  generatedAt: string
}

type DemoProfileBase = {
  firstName: string
  lastName: string
  birthDate: string
  expiryDate: string
  nationality: string
  createdAt: string
  proof: DemoProofRegistrationRecord
}

export type DemoPassportProfile = DemoProfileBase & {
  kind: 'demo-passport-profile'
  documentNumber: string
  issuingAuthority: string
}

export type DemoNidProfile = DemoProfileBase & {
  kind: 'demo-nid-profile'
  nationalId: string
  cardNumber: string
}

export type DemoDocumentProfile = DemoPassportProfile | DemoNidProfile

const useDemoPassportProfileStore = create(
  combine(
    {
      profile: undefined as DemoDocumentProfile | undefined,
      votedProposalIds: [] as string[],
    },
    (set, get) => ({
      setProfile: (profile: DemoDocumentProfile) => {
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
