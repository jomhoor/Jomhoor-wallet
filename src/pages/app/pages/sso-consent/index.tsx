/**
 * SSO Consent Screen (M3)
 *
 * Shown when the Jomhoor wallet receives a deep link from an OAuth2 relying party
 * requesting the user to authenticate via their wallet.
 *
 * The user sees:
 *   - Which service is requesting access (client_id displayed for now; will be
 *     replaced by client metadata lookup in M4)
 *   - Their wallet address (truncated) so they know which identity will be shared
 *   - Approve / Reject buttons
 *
 * On Approve:
 *   1. Sign the challenge nonce with the BabyJubjub wallet key
 *   2. POST /v1/authorize/verify  → { redirect_url }
 *   3a. [Mobile flow] Open redirect_url in the system browser to complete the OAuth2 flow
 *   3b. [Desktop QR flow] Parse the code from redirect_url and POST it to the
 *       Taraaz backend /api/v1/auth/sso/desktop/mobile-complete. The desktop polls
 *       for completion and gets logged in.
 *
 * On Reject: navigate back without calling the backend.
 */

import { useNavigation } from '@react-navigation/native'
import { isAxiosError } from 'axios'
import * as Linking from 'expo-linking'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Image, Platform, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { type ClientMetadata, fetchClientMetadata, ssoClient } from '@/api/modules/sso'
import { Config } from '@/config'
import { AttestationNotSupportedError, collectAttestation } from '@/hooks/useWalletRegistration'
import type { AppStackScreenProps } from '@/route-types'
import { ssoStore, walletStore } from '@/store'
import { UiButton } from '@/ui'

export default function SsoConsentScreen({ route }: AppStackScreenProps<'SsoConsent'>) {
  const { challenge, clientId, state: _state, desktopSessionId } = route.params
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()

  // SECURITY (M0): the sso-svc origin is locked to build-time Config.SSO_API_URL
  // via the shared `ssoClient`. We deliberately do NOT accept an api_url from
  // the deep link — see useSsoDeepLink.ts for rationale.
  const apiClient = ssoClient

  const walletAddress = walletStore.useWalletAddress()
  const publicKey = walletStore.usePublicKey()
  const signChallenge = walletStore.useSignChallenge()
  const isWalletReady = walletStore.useIsWalletReady()
  const { registeredAddress, setRegisteredAddress } = ssoStore.useSsoStore()

  const [loading, setLoading] = useState(false)
  const [clientMeta, setClientMeta] = useState<ClientMetadata | null>(null)
  const [clientMetaError, setClientMetaError] = useState(false)

  // M4: fetch the requesting app's display metadata (name, logo) so the
  // consent screen doesn't show a raw client_id. Falls back gracefully if the
  // endpoint 404s or the network fails — the user still sees the client_id.
  useEffect(() => {
    let cancelled = false
    fetchClientMetadata(clientId, apiClient)
      .then(({ data }) => {
        if (!cancelled) setClientMeta(data)
      })
      .catch(err => {
        console.warn('[SsoConsent] fetchClientMetadata failed:', err?.message ?? err)
        if (!cancelled) setClientMetaError(true)
      })
    return () => {
      cancelled = true
    }
  }, [clientId, apiClient])

  const displayName = clientMeta?.name ?? clientId
  const logoUrl = clientMeta?.logo_url

  const truncated = walletAddress ? `${walletAddress.slice(0, 8)}…${walletAddress.slice(-6)}` : '—'

  async function handleApprove() {
    if (!isWalletReady || !walletAddress) {
      Alert.alert(
        'Wallet not ready',
        'No wallet found on this device. Please complete wallet setup before signing in.',
      )
      return
    }

    // Defence in depth: refuse to ever register/sign with the BabyJubjub identity
    // point (x=0, y=1), which is what mulPointEScalar(Base8, 0) returns when the
    // private key is empty. Hitting this means hydration raced the SSO deep link.
    const pkPoint = publicKey.p as [bigint, bigint]
    if (pkPoint[0] === 0n) {
      Alert.alert(
        'Wallet not ready',
        'Wallet key is not initialised yet. Please reopen the app and try again.',
      )
      return
    }

    setLoading(true)
    try {
      // Ensure this wallet is known to the SSO service before calling verify.
      // Compare addresses (not a boolean) so a regenerated private key after reinstall
      // forces a fresh registration instead of trusting a stale flag.
      if (registeredAddress !== walletAddress) {
        const platform = Platform.OS === 'ios' ? 'ios' : 'android'
        const { data: challengeData } = await apiClient.post<{ challenge: string }>(
          '/v1/wallets/challenge',
          { platform },
        )
        const regSig = await signChallenge(challengeData.challenge)
        const regPayload = {
          walletAddress,
          publicKey: {
            x: '0x' + pkPoint[0].toString(16).padStart(64, '0'),
            y: '0x' + pkPoint[1].toString(16).padStart(64, '0'),
          },
          challenge: challengeData.challenge,
          walletSignature: regSig,
          appAttestation: await collectAttestation(challengeData.challenge),
        }
        try {
          await apiClient.post('/v1/wallets/register', regPayload)
        } catch (regErr: unknown) {
          // 409 = wallet already registered by a previous successful call — treat as success.
          if (!isAxiosError(regErr) || regErr.response?.status !== 409) {
            console.error('[SsoConsent] wallet register failed:', regErr)
            throw regErr
          }
        }
        setRegisteredAddress(walletAddress)
      }

      const signature = await signChallenge(challenge)

      const { data } = await apiClient.post<{ redirect_url: string }>('/v1/authorize/verify', {
        challenge,
        walletAddress,
        walletSignature: signature,
      })

      if (desktopSessionId) {
        // Desktop QR flow: extract the OAuth code from the redirect URL and send it
        // to the Taraaz backend so the desktop session can be completed.
        // SECURITY: We use build-time Config.AGORA_ORIGIN, never a URL from the deep link.
        const redirectUrl = new URL(data.redirect_url)
        const code = redirectUrl.searchParams.get('code')
        if (!code) {
          throw new Error('[SsoConsent] redirect_url missing code param')
        }
        const agoraOrigin = Config.AGORA_ORIGIN
        const resp = await fetch(`${agoraOrigin}/api/v1/auth/sso/desktop/mobile-complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: desktopSessionId, code }),
        })
        if (!resp.ok) {
          const body = await resp.text()
          console.error('[SsoConsent] mobile-complete failed:', resp.status, body)
          throw new Error('Desktop session completion failed')
        }
        Alert.alert(
          'Sign-in complete',
          'Your desktop browser has been signed in. You can return to it now.',
        )
        navigation.goBack()
      } else {
        // Mobile flow: hand the browser the auth code via the redirect URL.
        await Linking.openURL(data.redirect_url)
        navigation.goBack()
      }
    } catch (err) {
      if (err instanceof AttestationNotSupportedError) {
        Alert.alert(
          'Device Not Supported',
          'This device does not support the security features required to sign in. Please use a physical iOS device or an Android device with Google Play Services.',
        )
      } else if (isAxiosError(err)) {
        console.error(
          '[SsoConsent] verify failed:',
          err.response?.status,
          err.response?.data ?? err.message,
        )
        Alert.alert('Authentication Failed', 'Could not complete authentication. Please try again.')
      } else {
        console.error('[SsoConsent] verify failed:', err)
        Alert.alert('Authentication Failed', 'Could not complete authentication. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  function handleReject() {
    navigation.goBack()
  }

  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 24,
        justifyContent: 'space-between',
      }}
    >
      {/* Header */}
      <View style={{ alignItems: 'center', gap: 16 }}>
        {logoUrl ? (
          <Image
            source={{ uri: logoUrl }}
            style={{ width: 72, height: 72, borderRadius: 16, backgroundColor: '#e5e7eb' }}
            resizeMode='contain'
            onError={() => setClientMetaError(true)}
          />
        ) : (
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 16,
              backgroundColor: '#e5e7eb',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 32 }}>🔐</Text>
          </View>
        )}

        <Text style={{ fontSize: 20, fontWeight: '600', textAlign: 'center' }}>
          Sign in request
        </Text>

        <Text style={{ fontSize: 15, color: '#6b7280', textAlign: 'center' }}>
          <Text style={{ fontWeight: '600', color: '#111827' }}>{displayName}</Text>
          {desktopSessionId
            ? ' is requesting access from a desktop browser.'
            : ' is requesting access to your Jomhoor identity.'}
        </Text>
        {clientMetaError && (
          <Text style={{ fontSize: 12, color: '#b45309', textAlign: 'center' }}>
            Could not verify app identity — proceed only if you trust this request.
          </Text>
        )}
      </View>

      {/* Wallet info */}
      <View
        style={{
          backgroundColor: '#f3f4f6',
          borderRadius: 12,
          padding: 16,
          gap: 4,
        }}
      >
        <Text style={{ fontSize: 13, color: '#6b7280' }}>Signing with wallet</Text>
        <Text style={{ fontSize: 15, fontWeight: '500', fontFamily: 'monospace' }}>
          {truncated}
        </Text>
        <Text style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
          Only your pseudonymous wallet address is shared — not your identity documents.
        </Text>
      </View>

      {/* Actions */}
      <View style={{ gap: 12 }}>
        {loading ? (
          <ActivityIndicator size='large' />
        ) : (
          <>
            <UiButton title='Approve' onPress={handleApprove} />
            <UiButton title='Reject' onPress={handleReject} color='secondary' />
          </>
        )}
      </View>
    </View>
  )
}
