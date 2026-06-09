import { create } from 'zustand'
import { combine, createJSONStorage, persist } from 'zustand/middleware'

import { zustandStorage } from '@/store/helpers'

const usePassportBadgeStore = create(
  persist(
    combine(
      {
        hasPassportBadge: false,
        awardedAt: '' as string,
      },
      set => ({
        awardPassportBadge: () =>
          set({
            hasPassportBadge: true,
            awardedAt: new Date().toISOString(),
          }),
        clearPassportBadge: () =>
          set({
            hasPassportBadge: false,
            awardedAt: '',
          }),
      }),
    ),
    {
      name: 'passport-badge',
      version: 1,
      storage: createJSONStorage(() => zustandStorage),
      partialize: state => ({
        hasPassportBadge: state.hasPassportBadge,
        awardedAt: state.awardedAt,
      }),
    },
  ),
)

export const passportBadgeStore = {
  usePassportBadgeStore,
  useAwardPassportBadge: () => usePassportBadgeStore(state => state.awardPassportBadge),
  useClearPassportBadge: () => usePassportBadgeStore(state => state.clearPassportBadge),
}
