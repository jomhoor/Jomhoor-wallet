import { requireNativeModule } from 'expo-modules-core'

export type WalletKeyStatus = 'missing' | 'ready' | 'invalidated'

export type WalletPublicMaterial = {
  keyId: string
  publicKeyX: string
  publicKeyY: string
  publicKeyHash: string
  walletAddress: string
}

type CompatibilitySelfTestResult = {
  passed: boolean
  publicMaterialMatches: boolean
  nullifierMatches: boolean
  signatureMatches: boolean
}

type WalletKeyServiceNativeModule = {
  getStatus(): Promise<WalletKeyStatus>
  generateKey(): Promise<WalletPublicMaterial>
  getPublicMaterial(): Promise<WalletPublicMaterial | null>
  signChallenge(challengeHex: string): Promise<string>
  deriveNullifier(eventId: string): Promise<string>
  deleteKey(): Promise<void>
  runCompatibilitySelfTest(): Promise<CompatibilitySelfTestResult>
}

const WalletKeyServiceNative = requireNativeModule<WalletKeyServiceNativeModule>('WalletKeyService')

export const WalletKeyService = {
  getStatus: (): Promise<WalletKeyStatus> => WalletKeyServiceNative.getStatus(),
  generateKey: (): Promise<WalletPublicMaterial> => WalletKeyServiceNative.generateKey(),
  getPublicMaterial: (): Promise<WalletPublicMaterial | null> =>
    WalletKeyServiceNative.getPublicMaterial(),
  signChallenge: (challengeHex: string): Promise<string> =>
    WalletKeyServiceNative.signChallenge(challengeHex),
  deriveNullifier: (eventId: string): Promise<string> =>
    WalletKeyServiceNative.deriveNullifier(eventId),
  deleteKey: (): Promise<void> => WalletKeyServiceNative.deleteKey(),
  runCompatibilitySelfTest: (): Promise<CompatibilitySelfTestResult> =>
    WalletKeyServiceNative.runCompatibilitySelfTest(),
}

export default WalletKeyService
