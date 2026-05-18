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

// ── M5: ZK escalation ─────────────────────────────────────────────────────────

export type ZKAssertionStatus = {
  valid: boolean
  expires_at?: string
}

// GET /v1/wallets/:address/assertions/zk
// Pre-flight check used by the consent screen BEFORE asking the user to sign,
// when the relying party advertises zk_required=true. Lets the wallet route
// the user through ZK escalation up-front instead of hitting a silent 403
// from /v1/authorize/verify. Unauthenticated — returns only a boolean and an
// optional expiry, never the nullifier hash or assertion source.
export const fetchZkAssertionStatus = async (
  walletAddress: string,
  client: typeof ssoClient = ssoClient,
) => {
  return client.get<ZKAssertionStatus>(
    `/v1/wallets/${encodeURIComponent(walletAddress)}/assertions/zk`,
  )
}

// Wire shape for POST /v1/assertions/zk. The server forwards `proof` as
// the raw `bytes` argument of the on-chain verifier (`verify(bytes,bytes32[])`)
// and `pub_signals` as the bytes32[] argument. Both Noir (UltraPlonk) and
// Circom (Groth16) circuits emit values that map cleanly onto this shape:
// `proof` is the hex blob the verifier contract expects, and each
// `pub_signals[i]` is a field element (decimal or hex).
export type SubmitZkAssertionRequest = {
  walletAddress: string
  circuit_id: string
  proof: string
  pub_signals: string[]
}

// POST /v1/assertions/zk
// Wallet posts a fresh query proof bound to the SSO event_id. On success
// sso-svc inserts an `assertions` row that /v1/tokens/validate surfaces live.
// Empty body on success.
export const submitZkAssertion = async (
  body: SubmitZkAssertionRequest,
  client: typeof ssoClient = ssoClient,
) => {
  return client.post<void>('/v1/assertions/zk', body)
}

// ── M5: ZK-nullifier wallet recovery ──────────────────────────────────────────

// Same wire shape as SubmitZkAssertionRequest — sso-svc uses the same
// on-chain verifier path. The semantic difference is what the server does
// after a successful verify: rebind `assertions` + `pairwise_subjects` from
// the wallet that previously bound this nullifier_hash to the new wallet
// passed here, so relying parties keep seeing the same pairwise `sub`.
export type RecoverWalletRequest = SubmitZkAssertionRequest

export type RecoverWalletResponse = {
  walletRecovered: boolean
  // false → nullifier was never seen before; the call was a no-op recovery
  // (a fresh assertion was still inserted, but no rebind happened).
  priorWalletExisted: boolean
}

// POST /v1/wallets/recover
// Called after the user installs the wallet on a new device, completes
// /v1/wallets/register, and re-scans their ID. The fresh ZK proof is the
// only authority — sso-svc does NOT require the old wallet's signature
// (that key is presumed lost). See docs/SSO/plan.txt §"ACCOUNT RECOVERY MODEL".
export const recoverWallet = async (
  body: RecoverWalletRequest,
  client: typeof ssoClient = ssoClient,
) => {
  return client.post<RecoverWalletResponse>('/v1/wallets/recover', body)
}
