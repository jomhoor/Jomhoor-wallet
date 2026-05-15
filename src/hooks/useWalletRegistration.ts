import { useCallback } from 'react'
import { Platform } from 'react-native'

import { registerWallet, requestWalletChallenge } from '@/api/modules/sso'
import { ssoStore } from '@/store/modules/sso'
import { walletStore } from '@/store/modules/wallet'

/**
 * useWalletRegistration returns a `register` callback that:
 *  1. Skips if the wallet is already registered (persisted flag).
 *  2. Requests a one-time challenge from the SSO service.
 *  3. Signs the challenge with the wallet's BabyJubjub private key.
 *  4. Posts the registration payload to the SSO service.
 *  5. Sets `walletRegistered: true` on success or HTTP 409 (already registered).
 *
 * Errors are logged but not thrown — registration is a background side-effect
 * and must not block the wallet creation UX.
 */
export function useWalletRegistration() {
  const { walletRegistered, setWalletRegistered } = ssoStore.useSsoStore()
  const publicKey = walletStore.usePublicKey()
  const walletAddress = walletStore.useWalletAddress()
  const signChallenge = walletStore.useSignChallenge()

  const register = useCallback(async () => {
    if (walletRegistered) return

    const platform = Platform.OS === 'ios' ? 'ios' : 'android'

    try {
      const { data: challengeData } = await requestWalletChallenge(platform)
      const { challenge } = challengeData

      const walletSignature = await signChallenge(challenge)

      const pkPoint = publicKey.p as [bigint, bigint]

      await registerWallet({
        walletAddress,
        publicKey: {
          x: '0x' + pkPoint[0].toString(16).padStart(64, '0'),
          y: '0x' + pkPoint[1].toString(16).padStart(64, '0'),
        },
        challenge,
        walletSignature,
        appAttestation: {},
      })

      setWalletRegistered(true)
    } catch (err: unknown) {
      // HTTP 409 means the wallet is already registered — treat as success.
      if (isAxiosError(err) && err.response?.status === 409) {
        setWalletRegistered(true)
        return
      }
      // Non-fatal: log and let the app continue. Registration will be retried on next launch.
      console.warn('[useWalletRegistration] registration failed:', err)
    }
  }, [walletRegistered, setWalletRegistered, publicKey, walletAddress, signChallenge])

  return { register }
}

// Minimal Axios error shape check (avoids importing axios just for the type).
function isAxiosError(err: unknown): err is { response?: { status: number } } {
  return typeof err === 'object' && err !== null && 'response' in err
}
