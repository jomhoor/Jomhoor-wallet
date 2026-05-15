/**
 * Deep link handler for Agora wallet authentication.
 *
 * Handles `jomhoor://auth/agora?challenge=<token>` deep links triggered by
 * scanning the QR code shown on the desktop Agora wallet-auth page.
 *
 * SECURITY (M0): The Agora API origin is ALWAYS taken from build-time
 * `Config.AGORA_ORIGIN`. Any `apiBaseUrl` (or similarly-named) query param in
 * the deep link is IGNORED. Allowing the QR to specify the destination would
 * let a malicious QR exfiltrate `{challenge, walletAddress, nationality}` to
 * an attacker-controlled host (phishing-via-QR). Multi-environment support
 * must be done via build-time config, never via untrusted runtime input.
 *
 * Flow:
 * 1. Desktop Agora shows QR code containing `jomhoor://auth/agora?challenge=...`
 * 2. User scans QR with phone camera
 * 3. iOS opens the Jomhoor app via the registered URL scheme
 * 4. This hook intercepts the URL, extracts the challenge
 * 5. Submits { challenge, walletAddress, nationality } to `Config.AGORA_ORIGIN`
 * 6. Desktop Agora's polling picks up the result and completes authentication
 */

import { babyJub, ffUtils, Hex, poseidon } from '@iden3/js-crypto'
import * as Linking from 'expo-linking'
import { useEffect } from 'react'
import { Alert } from 'react-native'

import { Config } from '@/config'
import { identityStore, walletStore } from '@/store'

const DEFAULT_AGORA_API_URL = Config.AGORA_ORIGIN

/**
 * Module-level set of URLs already handled. Survives component remounts
 * (but not full app process restarts, which is the desired behavior —
 * a process restart means a fresh deep link invocation).
 */
const handledUrls = new Set<string>()

export function useAgoraDeepLink() {
  const privateKeyHex = walletStore.useWalletStore(s => s.privateKey)
  const identities = identityStore.useIdentityStore(s => s.identities)

  useEffect(() => {
    // Derive wallet address from private key
    function getWalletAddress(): string | null {
      if (!privateKeyHex) return null
      try {
        const skBuff = Hex.decodeString(privateKeyHex)
        const skBig = ffUtils.beBuff2int(skBuff)
        const point = babyJub.mulPointEScalar(babyJub.Base8, skBig)
        const hash = poseidon.hash(point)
        const hashBuf = ffUtils.beInt2Buff(hash, 32)
        return (
          '0x' +
          Array.from(new Uint8Array(hashBuf))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')
        )
      } catch {
        return null
      }
    }

    async function handleUrl(url: string) {
      // Skip URLs we've already handled (prevents re-triggering on effect re-runs
      // AND component remounts, since handledUrls is module-level)
      if (handledUrls.has(url)) return
      handledUrls.add(url)

      // Parse the URL: jomhoor://auth/agora?challenge=<token>&apiBaseUrl=<url>
      const parsed = Linking.parse(url)

      // Check if it's an Agora auth deep link
      // Linking.parse('jomhoor://auth/agora?challenge=xxx') →
      //   { hostname: 'auth', path: 'agora', queryParams: { challenge: 'xxx' } }
      if (parsed.hostname !== 'auth' || parsed.path !== 'agora' || !parsed.queryParams?.challenge) {
        return // Not an Agora auth link
      }

      const challenge = parsed.queryParams.challenge as string
      // SECURITY: never honor `apiBaseUrl` from the QR payload. See file header.
      if (parsed.queryParams.apiBaseUrl) {
        console.warn(
          '[DeepLink] Ignoring untrusted apiBaseUrl from QR; using build-time Config.AGORA_ORIGIN',
        )
      }
      const apiBaseUrl = DEFAULT_AGORA_API_URL

      const walletAddress = getWalletAddress()
      if (!walletAddress) {
        Alert.alert(
          'Wallet not ready',
          'Please create a wallet in Jomhoor before authenticating with Agora.',
        )
        return
      }

      const nationality =
        identities.length > 0 ? (identities[0].document.personDetails.nationality ?? 'IR') : 'IR'

      // Auto-submit — only pseudonymous wallet ID + nationality are shared.

      console.log('[DeepLink] Submitting Agora challenge:', challenge.slice(0, 8) + '…')

      try {
        const res = await fetch(`${apiBaseUrl}/api/v1/auth/wallet/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ challenge, walletAddress, nationality }),
        })

        const body = await res.json()
        console.log('[DeepLink] Submit response:', body)

        if (body.success) {
          Alert.alert(
            'Agora Authentication',
            'Your desktop session has been authenticated. You can return to your browser.',
          )
        } else {
          const message =
            body.reason === 'challenge_expired'
              ? 'The QR code has expired. Please refresh the page and scan again.'
              : body.reason === 'challenge_already_used'
                ? 'This QR code has already been used.'
                : body.reason === 'invalid_challenge'
                  ? 'This QR code is no longer valid. The desktop session may already be authenticated.'
                  : 'Failed to authenticate. Please try again.'
          Alert.alert('Authentication Failed', message)
        }
      } catch (err) {
        console.error('[DeepLink] Failed to submit Agora challenge:', err)
        Alert.alert(
          'Connection Error',
          'Could not connect to the Agora server. Make sure you are on the same network.',
        )
      }
    }

    // Handle URL that opened the app (cold start)
    Linking.getInitialURL().then(url => {
      if (url) void handleUrl(url)
    })

    // Handle URLs while app is already running (warm start)
    const subscription = Linking.addEventListener('url', event => {
      void handleUrl(event.url)
    })

    return () => subscription.remove()
  }, [privateKeyHex, identities])
}
