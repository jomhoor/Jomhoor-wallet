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
    },
    set => ({
      setProfile: (profile: DemoPassportProfile) => {
        set({ profile })
      },
      clearProfile: () => {
        set({ profile: undefined })
      },
    }),
  ),
)

export const demoPassportProfileStore = {
  useDemoPassportProfileStore,
}
