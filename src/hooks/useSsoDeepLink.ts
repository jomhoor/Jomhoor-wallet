/**
 * Deep link handler for SSO wallet authentication (M3).
 *
 * Handles Universal Links and custom-scheme URLs of the form:
 *   https://sso.jomhoor.org/auth/sso?challenge=<nonce>&client_id=<id>&state=<state>
 *   jomhoor://auth/sso?challenge=<nonce>&client_id=<id>&state=<state>
 *
 * Flow:
 * 1. RP opens `GET /v1/authorize` → sso-svc 302s browser to one of the above URLs
 * 2. iOS/Android intercepts, opens the Jomhoor wallet app
 * 3. This hook extracts the params and navigates to SsoConsentScreen
 * 4. User approves → SsoConsentScreen signs the challenge + calls POST /v1/authorize/verify
 * 5. sso-svc returns the redirect URL → app opens it in the browser to complete the flow
 */

import type { NavigationProp } from '@react-navigation/native'
import { useNavigation } from '@react-navigation/native'
import * as Linking from 'expo-linking'
import { useEffect } from 'react'

import type { AppStackParamsList } from '@/route-types'

/**
 * Module-level set of URLs already handled. Survives component remounts so
 * a single deep-link invocation is processed exactly once.
 */
const handledUrls = new Set<string>()

export function useSsoDeepLink() {
  const navigation = useNavigation<NavigationProp<AppStackParamsList>>()

  useEffect(() => {
    function handleUrl(url: string) {
      if (handledUrls.has(url)) return
      handledUrls.add(url)

      const parsed = Linking.parse(url)

      // Accept both Universal Link form (host=sso.jomhoor.org, path=auth/sso)
      // and custom-scheme form (hostname=auth, path=sso).
      const isUniversalLink =
        parsed.hostname === 'sso.jomhoor.org' && parsed.path?.startsWith('auth/sso')
      const isCustomScheme = parsed.hostname === 'auth' && parsed.path === 'sso'

      if (!isUniversalLink && !isCustomScheme) return

      const params = parsed.queryParams ?? {}
      const challenge = params['challenge'] as string | undefined
      const clientId = params['client_id'] as string | undefined
      const state = params['state'] as string | undefined
      // SECURITY (M0): never trust `api_url` from the deep link. The sso-svc
      // origin is fixed at build time via Config.SSO_API_URL. A malicious
      // Universal Link/QR could otherwise redirect the consent POST to an
      // attacker-controlled host and steal the signed challenge.
      if (params['api_url']) {
        console.warn(
          '[SsoDeepLink] Ignoring untrusted api_url from deep link; using build-time Config.SSO_API_URL',
        )
      }

      // For cross-device (desktop QR) flow: extract desktop_session_id.
      // SECURITY: this is just an opaque session ID — the wallet uses build-time
      // Config.AGORA_ORIGIN for the POST target, not any URL from the deep link.
      const desktopSessionId = params['desktop_session_id'] as string | undefined

      if (!challenge || !clientId || !state) {
        console.warn('[SsoDeepLink] Missing required params in SSO deep link:', url)
        return
      }

      console.warn('[SsoDeepLink] Navigating to SsoConsent, client_id:', clientId)
      navigation.navigate('SsoConsent', { challenge, clientId, state, desktopSessionId })
    }

    // Cold-start: URL that opened the app
    Linking.getInitialURL().then(url => {
      if (url) handleUrl(url)
    })

    // Warm-start: URL received while app is running
    const subscription = Linking.addEventListener('url', event => {
      handleUrl(event.url)
    })

    return () => subscription.remove()
    // navigation is stable across renders, no need to re-subscribe on change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
