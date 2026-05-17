import { create } from 'zustand'
import { combine, createJSONStorage, persist } from 'zustand/middleware'

import { zustandStorage } from '@/store/helpers'

// Persists which wallet address has been registered with the SSO service so the app
// doesn't re-register on every launch. We track the ADDRESS rather than a boolean
// because on iOS the privateKey (Keychain) and a boolean flag (MMKV) can desync
// across app reinstalls — a new sk would silently keep the stale "registered" flag,
// causing /v1/authorize/verify to fail with "wallet not registered".
const useSsoStore = create(
  persist(
    combine(
      {
        registeredAddress: '' as string,
      },
      set => ({
        setRegisteredAddress: (value: string) => set({ registeredAddress: value }),
        reset: () => set({ registeredAddress: '' }),
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
