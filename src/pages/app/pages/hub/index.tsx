import type { NavigationProp } from '@react-navigation/native'
import { useNavigation } from '@react-navigation/native'
import { useCallback } from 'react'
import type { WebViewMessageEvent } from 'react-native-webview'

import { Config } from '@/config'
import type { AppStackParamsList, AppTabScreenProps } from '@/route-types'
import { useAppLanguage } from '@/store'
import { UiDAppBrowser } from '@/ui'

const AGORA_ORIGIN = Config.AGORA_ORIGIN

/**
 * Messages sent from Agora's frontend (running inside this WebView) to the
 * native wallet shell.
 *
 *   JOMHOOR_SSO_DEEPLINK — Agora has initiated an SSO session via sso-svc and
 *   passes the resulting `jomhoor://auth/sso?...` deep link inline instead of
 *   rendering a QR. The wallet parses it and navigates to SsoConsent, which
 *   on approval calls /api/v1/auth/sso/desktop/mobile-complete. Agora's poll
 *   loop inside this WebView then completes the login.
 */
type AgoraMessage = {
  type: 'JOMHOOR_SSO_DEEPLINK'
  deepLink: string
  sessionId: string
}

export default function HubScreen(_props: AppTabScreenProps<'Hub'>) {
  const appLanguage = useAppLanguage()
  const navigation = useNavigation<NavigationProp<AppStackParamsList>>()

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: AgoraMessage
      try {
        msg = JSON.parse(event.nativeEvent.data) as AgoraMessage
      } catch {
        return
      }

      if (msg.type !== 'JOMHOOR_SSO_DEEPLINK') return

      // Parse the same query params that useSsoDeepLink expects for the
      // standard deep-link route. We deliberately do NOT trust any api_url in
      // the deep link — sso-svc origin is locked to build-time Config.
      let parsed: URL
      try {
        parsed = new URL(msg.deepLink)
      } catch (err) {
        console.warn('[HubScreen] Invalid SSO deep link:', err)
        return
      }
      const challenge = parsed.searchParams.get('challenge')
      const clientId = parsed.searchParams.get('client_id')
      const state = parsed.searchParams.get('state')
      const desktopSessionId = parsed.searchParams.get('desktop_session_id') ?? msg.sessionId

      if (!challenge || !clientId || !state) {
        console.warn('[HubScreen] SSO deep link missing required params')
        return
      }

      navigation.navigate('SsoConsent', { challenge, clientId, state, desktopSessionId })
    },
    [navigation],
  )

  const injectedScript = `
    (function() {
      window.__JOMHOOR__ = true;
      localStorage.setItem('displayLanguage', '${appLanguage}');
      true;
    })();
  `

  return (
    <UiDAppBrowser
      uri={AGORA_ORIGIN}
      origin={AGORA_ORIGIN}
      injectedJS={injectedScript}
      onMessage={handleMessage}
      loadingLabel='Loading Hub…'
    />
  )
}
