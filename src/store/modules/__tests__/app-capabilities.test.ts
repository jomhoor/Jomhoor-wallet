/// <reference types="jest" />

import type { DemoPassportProfile } from '@/store/modules/demo-passport-profile'

const mockReviewWalletAddress =
  '0x0a6f6d69cff72d0c4ab6faa9e4f55408ea8c4930f8190771d16d01323be5b7fd'

jest.mock('@/store/modules/wallet', () => ({
  deriveWalletAddressFromPrivateKey: jest.fn((privateKey: string) => {
    if (privateKey === 'review-private-key-fixture') return mockReviewWalletAddress
    return undefined
  }),
  walletStore: {
    useWalletStore: jest.fn(),
  },
}))

import {
  appCapabilitiesStore,
  isPassportDemoReviewWalletAddress,
  PASSPORT_DEMO_REVIEW_WALLET_ADDRESSES,
  resolveAppCapabilitiesForPrivateKey,
  resolveAppCapabilitiesForWalletAddress,
} from '../app-capabilities'
import { demoPassportProfileStore } from '../demo-passport-profile'

const demoProfile: DemoPassportProfile = {
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
    proofId: 'demo-proof',
    registrationId: 'demo-registration',
    generatedAt: '2026-06-03T00:00:00.000Z',
  },
}

describe('appCapabilitiesStore', () => {
  beforeEach(() => {
    appCapabilitiesStore.useAppCapabilitiesStore.getState().resetCapabilities()
    demoPassportProfileStore.useDemoPassportProfileStore.getState().clearProfile()
  })

  it('enables passport demo mode for the allowlisted review wallet address', () => {
    const reviewWalletAddress = PASSPORT_DEMO_REVIEW_WALLET_ADDRESSES[0]

    expect(isPassportDemoReviewWalletAddress(reviewWalletAddress)).toBe(true)
    expect(resolveAppCapabilitiesForWalletAddress(reviewWalletAddress)).toEqual({
      passportDemoModeEnabled: true,
    })

    const capabilities = appCapabilitiesStore.useAppCapabilitiesStore
      .getState()
      .setCapabilitiesForWalletAddress(reviewWalletAddress)

    expect(capabilities.passportDemoModeEnabled).toBe(true)
    expect(appCapabilitiesStore.useAppCapabilitiesStore.getState()).toMatchObject({
      passportDemoModeEnabled: true,
      sourceWalletAddress: reviewWalletAddress,
      status: 'loaded',
    })
  })

  it('enables passport demo mode when an imported private key derives to the review wallet', () => {
    expect(resolveAppCapabilitiesForPrivateKey('review-private-key-fixture')).toEqual({
      walletAddress: PASSPORT_DEMO_REVIEW_WALLET_ADDRESSES[0],
      capabilities: {
        passportDemoModeEnabled: true,
      },
    })
  })

  it('fails closed and clears demo state for unknown wallets', () => {
    const unknownWalletAddress =
      '0x1111111111111111111111111111111111111111111111111111111111111111'

    demoPassportProfileStore.useDemoPassportProfileStore.getState().setProfile(demoProfile)

    const capabilities = appCapabilitiesStore.useAppCapabilitiesStore
      .getState()
      .setCapabilitiesForWalletAddress(unknownWalletAddress)

    expect(capabilities.passportDemoModeEnabled).toBe(false)
    expect(appCapabilitiesStore.useAppCapabilitiesStore.getState()).toMatchObject({
      passportDemoModeEnabled: false,
      sourceWalletAddress: unknownWalletAddress,
      status: 'loaded',
    })
    expect(demoPassportProfileStore.useDemoPassportProfileStore.getState().profile).toBeUndefined()
  })

  it('fails closed for missing or invalid private keys', () => {
    expect(resolveAppCapabilitiesForPrivateKey('')).toEqual({
      walletAddress: undefined,
      capabilities: {
        passportDemoModeEnabled: false,
      },
    })

    expect(resolveAppCapabilitiesForPrivateKey('not-a-private-key')).toEqual({
      walletAddress: undefined,
      capabilities: {
        passportDemoModeEnabled: false,
      },
    })
  })
})
