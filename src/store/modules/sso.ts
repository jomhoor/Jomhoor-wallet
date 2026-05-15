import { create } from 'zustand'
import { combine, createJSONStorage, persist } from 'zustand/middleware'

import { zustandStorage } from '@/store/helpers'

// Persists wallet SSO registration state so the app doesn't re-register on every launch.
const useSsoStore = create(
  persist(
    combine(
      {
        walletRegistered: false,
      },
      set => ({
        setWalletRegistered: (value: boolean) => set({ walletRegistered: value }),
        reset: () => set({ walletRegistered: false }),
      }),
    ),
    {
      name: 'sso',
      storage: createJSONStorage(() => zustandStorage),
    },
  ),
)

export const ssoStore = {
  useSsoStore,
}
