# Release Readiness Audit

**Date:** 2026-06-12  
**Scope:** jomhoor-wallet (`release` branch) + platform (`feat/sso` branch)  
**Status:** Pre-release snapshot created; cleanup in progress  

---

## What Was Shipped (Pre-Release Snapshot)

| Feature | Status |
|---------|--------|
| Iranian Passport Variant B (RSA-3072 SHA-1, sigType 9) — Registration | ✅ End-to-end tested |
| Iranian Passport Variant B — Voting via Noir Ultra Honk (queryIdentity) | ✅ End-to-end tested |
| Iranian National ID card (INID) — Registration (`registerIdentity_inid_ca`) | ✅ Tested previously |
| INID — Voting via `executeINID` + 23-signal builder | ✅ Tested previously |
| Iranian Passport Variant A (RSA-2048 exponent 0xE3DD SHA-1, sigType 6) | ⚠️ Code path exists, not yet tested end-to-end |
| ECDSA brainpoolP384r1 passports (German) | ❌ Registration WIP on separate branch |
| Circom/Groth16 fallback for passport registration | ✅ Fallback in ScanProvider |
| `ZERO_DATE` proposal creation | ✅ Fixed (Proposal 2 on local Hardhat) |

---

## Security & Quality Findings (From Audit 2026-06-12)

### 🔴 HIGH — PII and proof material logged on client

**Files affected:**
- [`src/utils/circuits/passport-based-query-identity-circuit.ts`](../src/utils/circuits/passport-based-query-identity-circuit.ts) — line ~108: logs full normalized inputs including `sk_identity`, `dg1` byte array, SMT siblings, and passport hash context
- [`src/utils/circuits/eid-based-query-identity-circuit.ts`](../src/utils/circuits/eid-based-query-identity-circuit.ts) — lines ~180–250: logs raw proof inputs, DG1 commitment comparisons, SMT value comparisons, full siblings array
- [`src/api/modules/registration/variants/noir-epassport.ts`](../src/api/modules/registration/variants/noir-epassport.ts) — `[DIAG-NOIR-PUBLIC-INPUTS]` block: logs all pub_signals and proof byte count

**Risk:** Device logs (Xcode console, Sentry-like tools, developer device syncs) can expose passport data including MRZ-derived fields, identity private key derivative, and nullifiers.

**Fix:** Replace `console.log` with dev-only guard (`if (__DEV__) {...}`) and redact sensitive fields (never log `sk_identity`, `dg1` array contents, full proof blobs, siblings). Keep only lengths/hash prefixes.

---

### 🔴 HIGH — Proof calldata logged on relayer server

**File:** [`platform/services/proof-verification-relayer/internal/service/api/handlers/vote_v3.go`](../platform/services/proof-verification-relayer/internal/service/api/handlers/vote_v3.go) — line ~60: structured log field `"calldata": calldata` logs full ABI-encoded proof payload.

**Risk:** Server log retention (e.g. CloudWatch, Elasticsearch, Grafana Loki) could archive users' proof data and nullifier-adjacent material indefinitely, increasing legal/privacy exposure.

**Fix:** Remove `"calldata"` from the log field set. Keep: `proposal_id`, `destination`, `user-agent`, selector bytes only.

---

### 🟡 MEDIUM — INID relayer decoder is schema-misaligned with wallet's 4-field tuple

**File:** [`platform/services/proof-verification-relayer/internal/service/api/handlers/vote_v3.go`](../platform/services/proof-verification-relayer/internal/service/api/handlers/vote_v3.go) — `decodeUserData()`: decodes the inner tuple as `(nullifier, citizenship, timestampUpperbound)` (3 fields).

**Wallet encodes:** `tuple(uint256,uint256,uint256,uint256)` = `(nullifier, citizenship, identityCreationTimestamp, personalNumber)` for INID via `executeINID`.

**Risk:** Works today because the relayer only uses `ProposalID` and `Vote` (decoded before the tuple), but if the relayer ever reads UserData fields (e.g. for logging or gas accounting), it will silently misread values.

**Fix:** Add an explicit `executeINID` decode branch in `parseNoirCallData`/`decodeUserData` that uses a 4-field tuple type.

---

### 🟡 MEDIUM — Local-chain date branch uses inconsistent comparisons

**File:** [`src/pages/app/pages/poll/index.tsx`](../src/pages/app/pages/poll/index.tsx)

- Line ~158: `String(Config.RMO_CHAIN_ID) === '31337'` — string-safe ✅  
- Line ~421: `Config.RMO_CHAIN_ID === '31337'` — direct string compare, but `Config.RMO_CHAIN_ID` comes from `Env` which is typed as `string`, so consistent. Still, both should use the same pattern.

**Fix:** Define `const isLocalChain = String(Config.RMO_CHAIN_ID) === '31337'` once at module level and reuse.

---

### 🟢 LOW — ZERO_DATE comment has wrong decimal value

**File:** [`src/pages/app/pages/poll/constants.ts`](../src/pages/app/pages/poll/constants.ts#L5)

```ts
export const ZERO_DATE_HEX = '0x303030303030' // "000000" in ASCII - minimum date (as integer: 52983525093424)
```

`0x303030303030` = **52983525027888** (not 52983525093424). The hex is correct; the comment is wrong.

**Fix:** Correct the comment to `52983525027888`.

---

### 🟢 LOW — Verbose debug console.warn calls in logIdentityDiagnostic

**File:** [`src/helpers/identity-proof-diagnostics.ts`](../src/helpers/identity-proof-diagnostics.ts)

Uses `console.warn` even for routine diagnostic events (dispatcher selection, certificate counts, etc.). In production, these appear as yellow warnings in device logs with no way to suppress them.

**Fix:** Replace `console.warn` with `console.log` or add `if (__DEV__)` guard for routine info events; keep `console.warn` only for genuinely unexpected states.

---

### 🟢 LOW — Debug/temp files in platform

Untracked files that should be gitignored or removed before merge:
- `platform/services/passport-contracts/curl_payload.json`
- Various debug scripts in `platform/services/passport-contracts/scripts/` (analyze-*, debug-*, check-*)
- `modules/noir/ios/Frameworks/SwoirenbergLib.xcframework.poseidon-bak/` (backup directory)

---

### 🟢 LOW — create-test-proposals.js has stale contract addresses

**File:** [`platform/services/passport-voting-contracts/scripts/create-test-proposals.js`](../platform/services/passport-voting-contracts/scripts/create-test-proposals.js) — hardcoded addresses (`0xAe2563b4...`, `0x49149a23...`, `0x021DBfF4...`) are stale. Script reads migrate-storage at runtime to verify, but may mislead.

**Fix:** Update hardcoded addresses or replace with dynamic lookup from `cache/.migrate.storage.json`.

---

## Commit Plan (Post Snapshot, In Order)

1. **`chore: remove/redact PII and proof material from client logs`**  
   - `src/utils/circuits/passport-based-query-identity-circuit.ts`
   - `src/utils/circuits/eid-based-query-identity-circuit.ts`
   - `src/api/modules/registration/variants/noir-epassport.ts`
   - `src/helpers/identity-proof-diagnostics.ts`

2. **`fix(relayer): remove raw calldata from vote_v3 log fields`**  
   - `platform/services/proof-verification-relayer/internal/service/api/handlers/vote_v3.go`

3. **`fix(relayer): add 4-field INID tuple decode for executeINID`**  
   - `platform/services/proof-verification-relayer/internal/service/api/handlers/vote_v3.go`

4. **`fix: correct ZERO_DATE comment, unify local-chain chain-id checks`**  
   - `src/pages/app/pages/poll/constants.ts`
   - `src/pages/app/pages/poll/index.tsx`

5. **`chore: gitignore debug artifacts, remove poseidon-bak`**  
   - `.gitignore` updates in both repos

6. **`feat: NoirPassportQueryHonkVerifier + queryIdentity circuit integration`**  
   - All new/modified verifier and circuit files (platform + wallet)

---

## Variant A (Iranian Passport RSA-2048 exponent 0xE3DD) — Status

Code path exists:
- sigType 6 mapped in `registration-circuit.ts` (line ~263)
- Dispatcher name resolves to `C_RSA_SHA1_2048_58333`
- Registration uses same `NoirEPassportRegistration.createIdentity` flow

**Not yet tested end-to-end because:**
- Variant A passport not physically available during current session
- On Rarimo mainnet the `C_RSA_SHA1_2048_58333` dispatcher exists (deployed by Rarimo)
- Local Hardhat: dispatcher needs to be registered if testing locally

**Action item:** Obtain a Variant A passport to test, or verify against Rarimo testnet.

---

## INID Voting Architecture Notes (Reference)

Contract entry point: `IDCardVoting.executeINID(bytes32 root, uint256 date, bytes userPayload, bytes proof)`  
Circuit: `queryIdentity_inid_ca` — 23 public signals, TD3-style layout  
UserData tuple: `(nullifier, citizenship, identityCreationTimestamp, personalNumber)` — 4 fields  
Selector for IR voting: `65569` (0x10021 = bits 0 + 5 + 16)  
All date bounds must be `ZERO_DATE` (0x303030303030)  

## Passport B Voting Architecture Notes (Reference)

Contract entry point: `BioPassportVoting.executeNoir(bytes32 root, uint256 date, bytes userPayload, bytes proof)`  
Circuit: `queryIdentity` — 23 public signals  
UserData tuple: `(nullifier, citizenship, identityCreationTimestamp)` — 3 fields  
Selector for IR voting: `33` (bits 0 + 5)  
All date bounds in proposal must be `ZERO_DATE` (0x303030303030) — NOT numeric 0  
