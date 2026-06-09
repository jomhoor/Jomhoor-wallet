// M5 item 1: SSO ZK escalation — stable circuit_id mapping.
//
// sso-svc maintains a multi-circuit registry keyed by stable wire names (see
// platform/services/sso-svc/config.yaml#zkp.circuits). The wallet must emit the
// SAME string in POST /v1/assertions/zk so the server picks the right VK and
// signal layout for verification.
//
// This map translates the wallet's internal identity class names (see
// src/store/modules/identity/Identity.ts) into those wire names. The split is
// intentional: identity classes describe HOW the wallet stores a registered
// document; circuit_id describes WHICH proving system the server expects.
// They can evolve independently (e.g. a single class may later switch its
// underlying proof circuit without renaming the storage type).
//
// Adding a new variant = add an entry here AND a config block in
// sso-svc/config.yaml#zkp.circuits. No other wallet code changes.
import type { IdentityItem } from '@/store/modules/identity/Identity'

/**
 * Stable wire names accepted by sso-svc's `circuit_id` field.
 * MUST match keys in sso-svc/config.yaml#zkp.circuits.
 */
export type SSOCircuitId =
  | 'inid_rsa_2048'
  | 'passport_rsa_2048_sha256_e65537'
  | 'passport_rsa_2048_sha1_e58333'

/**
 * Returns the SSO `circuit_id` for the given registered identity, or `null`
 * if the wallet has no proof circuit wired for that identity class yet.
 *
 * Today only INID is wired (the EIDBasedQueryIdentityCircuit class generates
 * `queryIdentity_inid_ca` proofs). Passport variants return `null` until the
 * corresponding query-identity circuit is wired into the wallet — callers
 * should treat that as "ZK escalation not yet supported for this document".
 */
export function ssoCircuitIdForIdentity(identity: IdentityItem): SSOCircuitId | null {
  switch (identity.identityType) {
    case 'NoirEIDIdentity':
      return 'inid_rsa_2048'
    case 'NoirEpassportIdentity':
      // TODO: wire passport query-identity circuit in the wallet, then return
      // the matching wire name (likely `passport_rsa_2048_sha256_e65537` for
      // most modern passports; the strategy factory will need to distinguish
      // Iranian Variant A `passport_rsa_2048_sha1_e58333`).
      return null
    case 'CircomEpassportIdentity':
      // TODO: same — Circom passport variants not yet wired for SSO.
      return null
    default:
      return null
  }
}
