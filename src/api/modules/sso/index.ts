import axios from 'axios'

import { Config } from '@/config'

// Separate axios instance for the SSO service (different base URL from the relayer).
export const ssoClient = axios.create({
  baseURL: Config.SSO_API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

export type WalletChallengeResponse = {
  challenge: string
  expires_at: string
}

export type RegisterWalletRequest = {
  walletAddress: string
  publicKey: { x: string; y: string }
  challenge: string
  walletSignature: string
  appAttestation: Record<string, unknown>
}

export type RegisterWalletResponse = {
  walletRegistered: boolean
}

// POST /v1/wallets/challenge
export const requestWalletChallenge = async (platform: 'ios' | 'android') => {
  return ssoClient.post<WalletChallengeResponse>('/v1/wallets/challenge', { platform })
}

// POST /v1/wallets/register
export const registerWallet = async (body: RegisterWalletRequest) => {
  return ssoClient.post<RegisterWalletResponse>('/v1/wallets/register', body)
}

// ── M3 ────────────────────────────────────────────────────────────────────────

export type VerifyAuthorizeRequest = {
  challenge: string
  walletAddress: string
  walletSignature: string
  appAssertion?: Record<string, unknown>
}

export type VerifyAuthorizeResponse = {
  redirect_url: string
}

// POST /v1/authorize/verify
// Called by SsoConsentScreen after the user approves the SSO consent.
// Returns the redirect URL that should be opened in the browser to complete
// the OAuth2 auth-code flow.
export const verifyAuthorize = async (body: VerifyAuthorizeRequest) => {
  return ssoClient.post<VerifyAuthorizeResponse>('/v1/authorize/verify', body)
}

// ── M4: public client metadata ────────────────────────────────────────────────

export type ClientMetadata = {
  id: string
  name: string
  logo_url?: string
  redirect_uris: string[]
  zk_required: boolean
}

// GET /v1/clients/:id
// Unauthenticated lookup used by the consent screen to render the requesting
// app's name and logo instead of a raw client_id. Never returns client_secret.
export const fetchClientMetadata = async (
  clientId: string,
  client: typeof ssoClient = ssoClient,
) => {
  return client.get<ClientMetadata>(`/v1/clients/${encodeURIComponent(clientId)}`)
}
