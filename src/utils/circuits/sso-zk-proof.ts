// M5 item 1 — SSO ZK escalation: build a fresh query-identity proof bound to
// the SSO event_id and submit it to sso-svc.
//
// Reuses the existing wallet circuit infrastructure (`EIDBasedQueryIdentityCircuit`)
// — there is no voting involved here, so the on-chain ProposalState passed to
// the constructor is a non-functional stub: only `prove()` is invoked.
//
// Selector = 1 (nullifier reveal only). All date / counter / citizenship
// bounds are widened to "no restriction" so any registered identity satisfies
// the proof — sso-svc itself enforces event_id, the on-chain SMT-root, and
// runs the verifier contract.
//
// Wallet-address binding: we pass `eventData = walletAddress` so the proof's
// pub_signals[event_data_index] equals the submitting wallet. sso-svc rejects
// any proof whose event_data does not match the request's walletAddress —
// without this binding a captured proof could be replayed at /v1/wallets/recover
// against an attacker's freshly-registered wallet to steal the pairwise
// subjects. Same payload is reused at both /v1/assertions/zk and
// /v1/wallets/recover, so the binding protects both endpoints.
import { hexlify, toUtf8Bytes } from 'ethers';

import { recoverWallet, submitZkAssertion, type SubmitZkAssertionRequest } from '@/api/modules/sso';
import { Config } from '@/config';
import { ZERO_DATE_HEX } from '@/pages/app/pages/poll/constants';
import { NoirEIDIdentity } from '@/store/modules/identity/Identity';
import type { ProposalState } from '@/types/contracts';

import { EIDBasedQueryIdentityCircuit } from './eid-based-query-identity-circuit';
import { ssoCircuitIdForIdentity } from './sso-circuit-id';

// Selector bit 0 enables nullifier reveal; all other circuit-side checks are
// disabled by leaving the corresponding bits cleared. sso-svc relies only on
// the nullifier + event_id pinning + SMT-root check.
const SSO_SELECTOR = '1'

// Wide bounds so any registered identity passes the in-circuit range checks.
// (Same convention voting uses for unconstrained fields.)
const MAX_UINT_32 = '0xFFFFFFFF'

function currentDateYYMMDDHex(): string {
  const now = new Date()
  const yymmdd =
    now.getUTCFullYear().toString().slice(2) +
    String(now.getUTCMonth() + 1).padStart(2, '0') +
    String(now.getUTCDate()).padStart(2, '0')
  return hexlify(toUtf8Bytes(yymmdd))
}

/**
 * Builds a fresh SSO-bound query-identity proof for the given INID identity
 * and shapes it for sso-svc's wire format. Pure: no network call. Shared by
 * the escalation flow (POST /v1/assertions/zk) and the recovery flow
 * (POST /v1/wallets/recover) — both endpoints take the same wire shape and
 * run the same on-chain verifier.
 */
export async function buildSsoZkAssertionPayload(args: {
  identity: NoirEIDIdentity
  walletAddress: string
  privateKey: string
}): Promise<SubmitZkAssertionRequest> {
  const { identity, walletAddress, privateKey } = args

  const circuitId = ssoCircuitIdForIdentity(identity)
  if (!circuitId) {
    throw new Error('SSO ZK proof is not yet supported for this identity type')
  }

  if (!Config.SSO_ZKP_EVENT_ID) {
    throw new Error('SSO_ZKP_EVENT_ID is not configured for this build')
  }

  // `proposalContract` is only used by `submitVote` / `getEventId`, neither of
  // which we call here. Casting an empty object keeps `prove()` decoupled from
  // the voting infrastructure.
  const circuit = new EIDBasedQueryIdentityCircuit(identity, {} as ProposalState)

  // We need identityCounter + timestamp from on-chain StateKeeper so the
  // in-circuit registration-SMT proof binds to the same (counter, timestamp)
  // that was committed at registration time.
  const { identityCounter, timestamp } = await circuit.getPassportInfo()

  // event_data = walletAddress. The wallet address is poseidon([pkX, pkY]),
  // already a BN254 field element, so it can be used directly as a circuit
  // input. sso-svc recomputes the same value from the request's walletAddress
  // and rejects the proof if the public input doesn't match.
  const proof = await circuit.prove({
    eventId: String(Config.SSO_ZKP_EVENT_ID),
    eventData: walletAddress,
    selector: SSO_SELECTOR,
    skIdentity: `0x${privateKey}`,
    identityCounter: String(identityCounter),
    timestamp: String(timestamp),
    currentDate: currentDateYYMMDDHex(),
    // Disable every in-circuit check the SSO flow doesn't need.
    citizenshipMask: '0x0',
    identityCountLower: '0',
    identityCountUpper: MAX_UINT_32,
    timestampLower: '0',
    timestampUpper: MAX_UINT_32,
    birthDateLower: ZERO_DATE_HEX,
    birthDateUpper: ZERO_DATE_HEX,
    expirationDateLower: ZERO_DATE_HEX,
    expirationDateUpper: ZERO_DATE_HEX,
  })

  // NoirZKProof emits `proof` and each `pub_signals[i]` as raw hex (no `0x`).
  // sso-svc accepts both, but we send canonical `0x`-prefixed strings so the
  // wire format is unambiguous.
  return {
    walletAddress,
    circuit_id: circuitId,
    proof: '0x' + proof.proof,
    pub_signals: proof.pub_signals.map(s => '0x' + s),
  }
}

/**
 * Generates a fresh SSO query-identity proof and POSTs it to
 * POST /v1/assertions/zk. Used by the consent screen when the relying party
 * sets `zk_required=true` and the pre-flight reports no live assertion.
 *
 * Privacy invariant: the wallet sends `circuit_id` plus the raw proof + public
 * inputs. No document fields, no PII. sso-svc returns 200 with no body.
 */
export async function generateAndSubmitSsoZkAssertion(args: {
  identity: NoirEIDIdentity
  walletAddress: string
  privateKey: string
}): Promise<void> {
  const payload = await buildSsoZkAssertionPayload(args)
  await submitZkAssertion(payload)
}

/**
 * M5 item 3 — wallet recovery.
 *
 * Generates a fresh SSO query-identity proof on the NEW device and POSTs it
 * to POST /v1/wallets/recover. The caller is expected to have already run
 * /v1/wallets/challenge + /v1/wallets/register on this device, so sso-svc
 * recognises `walletAddress` (the new wallet) before recover is invoked.
 *
 * The ZK proof is the only authority for the rebind: sso-svc finds any wallet
 * previously bound to the same nullifier_hash and migrates its assertions +
 * pairwise_subjects to the new wallet, so relying parties keep seeing the
 * same pairwise subject. See docs/SSO/plan.txt §"ACCOUNT RECOVERY MODEL".
 *
 * Returns whether sso-svc found a prior wallet — useful to message the user
 * ("welcome back" vs. "no prior identity to recover").
 */
export async function recoverSsoWalletWithZk(args: {
  identity: NoirEIDIdentity
  walletAddress: string
  privateKey: string
}): Promise<{ priorWalletExisted: boolean }> {
  const payload = await buildSsoZkAssertionPayload(args)
  const { data } = await recoverWallet(payload)
  return { priorWalletExisted: data.priorWalletExisted }
}
