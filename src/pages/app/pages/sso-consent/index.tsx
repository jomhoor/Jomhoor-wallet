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
 *   3. Open redirect_url in the system browser to complete the OAuth2 flow
 *
 * On Reject: navigate back without calling the backend.
 */

import { useNavigation } from '@react-navigation/native'
import * as Linking from 'expo-linking'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Image, Platform, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { type ClientMetadata, fetchClientMetadata, ssoClient } from '@/api/modules/sso'
import type { AppStackScreenProps } from '@/route-types'
import { ssoStore, walletStore } from '@/store'
import { UiButton } from '@/ui'

export default function SsoConsentScreen({ route }: AppStackScreenProps<'SsoConsent'>) {
  const { challenge, clientId, state: _state } = route.params
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()

  // SECURITY (M0): the sso-svc origin is locked to build-time Config.SSO_API_URL
  // via the shared `ssoClient`. We deliberately do NOT accept an api_url from
  // the deep link — see useSsoDeepLink.ts for rationale.
  const apiClient = ssoClient

  const walletAddress = walletStore.useWalletAddress()
  const publicKey = walletStore.usePublicKey()
  const signChallenge = walletStore.useSignChallenge()
  const { walletRegistered, setWalletRegistered } = ssoStore.useSsoStore()

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
    if (!walletAddress) {
      Alert.alert('Wallet not ready', 'No wallet address found. Please create a wallet first.')
      return
    }

    setLoading(true)
    try {
      // Ensure this wallet is known to the SSO service before calling verify.
      // This handles the case where wallet creation happened before sso-svc was reachable.
      if (!walletRegistered) {
        const platform = Platform.OS === 'ios' ? 'ios' : 'android'
        const { data: challengeData } = await apiClient.post<{ challenge: string }>(
          '/v1/wallets/challenge',
          { platform },
        )
        const regSig = await signChallenge(challengeData.challenge)
        const pkPoint = publicKey.p as [bigint, bigint]
        const regPayload = {
          walletAddress,
          publicKey: {
            x: '0x' + pkPoint[0].toString(16).padStart(64, '0'),
            y: '0x' + pkPoint[1].toString(16).padStart(64, '0'),
          },
          challenge: challengeData.challenge,
          walletSignature: regSig,
          appAttestation: {},
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
        setWalletRegistered(true)
      }

      const signature = await signChallenge(challenge)

      const { data } = await apiClient.post<{ redirect_url: string }>('/v1/authorize/verify', {
        challenge,
        walletAddress,
        walletSignature: signature,
      })

      // Hand the browser the auth code via the redirect URL.
      // The RP's server will exchange it for tokens server-side.
      await Linking.openURL(data.redirect_url)
      navigation.goBack()
    } catch (err) {
      console.error('[SsoConsent] verify failed:', err)
      Alert.alert('Authentication Failed', 'Could not complete authentication. Please try again.')
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
          {' is requesting access to your Jomhoor identity.'}
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

// Minimal Axios error shape check (avoids importing axios just for the type guard).
function isAxiosError(err: unknown): err is { response?: { status: number } } {
  return typeof err === 'object' && err !== null && 'response' in err
}
