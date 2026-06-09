import { create } from 'zustand'
import { combine } from 'zustand/middleware'

import { demoPassportProfileStore } from '@/store/modules/demo-passport-profile'
import { deriveWalletAddressFromPrivateKey, walletStore } from '@/store/modules/wallet'

export type AppCapabilities = {
  documentDemoModeEnabled: boolean
  passportDemoModeEnabled: boolean
}

type AppCapabilitiesStatus = 'idle' | 'loaded'

type AppCapabilitiesResolution = {
  capabilities: AppCapabilities
  walletAddress?: string
}

const DEFAULT_CAPABILITIES: AppCapabilities = {
  documentDemoModeEnabled: false,
  passportDemoModeEnabled: false,
}

export const PASSPORT_DEMO_REVIEW_WALLET_ADDRESSES = [
  '0x0a6f6d69cff72d0c4ab6faa9e4f55408ea8c4930f8190771d16d01323be5b7fd',
] as const

const passportDemoReviewWalletAddressSet = new Set(
  PASSPORT_DEMO_REVIEW_WALLET_ADDRESSES.map(address => address.toLowerCase()),
)

export const isPassportDemoReviewWalletAddress = (walletAddress?: string): boolean => {
  if (!walletAddress) return false
  return passportDemoReviewWalletAddressSet.has(walletAddress.toLowerCase())
}

export const resolveAppCapabilitiesForWalletAddress = (walletAddress?: string): AppCapabilities => {
  const documentDemoModeEnabled = isPassportDemoReviewWalletAddress(walletAddress)

  return {
    documentDemoModeEnabled,
    passportDemoModeEnabled: documentDemoModeEnabled,
  }
}

export const resolveAppCapabilitiesForPrivateKey = (
  privateKey: string,
): AppCapabilitiesResolution => {
  const walletAddress = deriveWalletAddressFromPrivateKey(privateKey)

  return {
    walletAddress,
    capabilities: resolveAppCapabilitiesForWalletAddress(walletAddress),
  }
}

const clearDemoStateIfDisabled = (capabilities: AppCapabilities) => {
  if (capabilities.documentDemoModeEnabled) return
  demoPassportProfileStore.useDemoPassportProfileStore.getState().clearProfile()
}

const useAppCapabilitiesStore = create(
  combine(
    {
      ...DEFAULT_CAPABILITIES,
      status: 'idle' as AppCapabilitiesStatus,
      sourceWalletAddress: undefined as string | undefined,
    },
    set => ({
      setCapabilitiesForWalletAddress: (walletAddress?: string): AppCapabilities => {
        const capabilities = resolveAppCapabilitiesForWalletAddress(walletAddress)
        clearDemoStateIfDisabled(capabilities)
        set({
          ...capabilities,
          sourceWalletAddress: walletAddress,
          status: 'loaded' as AppCapabilitiesStatus,
        })
        return capabilities
      },
      setCapabilitiesForPrivateKey: (privateKey: string): AppCapabilities => {
        const resolution = resolveAppCapabilitiesForPrivateKey(privateKey)
        clearDemoStateIfDisabled(resolution.capabilities)
        set({
          ...resolution.capabilities,
          sourceWalletAddress: resolution.walletAddress,
          status: 'loaded' as AppCapabilitiesStatus,
        })
        return resolution.capabilities
      },
      resetCapabilities: () => {
        clearDemoStateIfDisabled(DEFAULT_CAPABILITIES)
        set({
          ...DEFAULT_CAPABILITIES,
          sourceWalletAddress: undefined,
          status: 'idle' as AppCapabilitiesStatus,
        })
      },
    }),
  ),
)

const usePassportDemoModeEnabled = () => {
  const privateKey = walletStore.useWalletStore(state => state.privateKey)
  return resolveAppCapabilitiesForPrivateKey(privateKey).capabilities.passportDemoModeEnabled
}

const useDocumentDemoModeEnabled = () => {
  const privateKey = walletStore.useWalletStore(state => state.privateKey)
  return resolveAppCapabilitiesForPrivateKey(privateKey).capabilities.documentDemoModeEnabled
}

export const appCapabilitiesStore = {
  useAppCapabilitiesStore,
  useDocumentDemoModeEnabled,
  usePassportDemoModeEnabled,
}
