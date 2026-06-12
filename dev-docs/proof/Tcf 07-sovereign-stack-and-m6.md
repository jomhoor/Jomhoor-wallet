# 07 — The Sovereign Identity Stack on Rarimo L2 (M6)

This explainer answers two questions that look similar but are very different:

1. _"Are you running your own blockchain?"_ — **No.**
2. _"Are you running your own identity contracts?"_ — **Yes, that's what M6
   is about.**

Most people in the space conflate these. This file separates them carefully,
because the strategic point of M6 is exactly the gap between them.

## "Chain" vs. "contracts" — the distinction that powers M6

A blockchain has two parts:

- **The chain itself.** The shared notebook, plus the validators who keep
  appending pages to it, plus the consensus protocol they follow. Rarimo L2
  is the chain we use (chain id 7368, RMO gas token, anchored to Ethereum).
  See [`01-blockchain-and-rarimo-l2.md`](01-blockchain-and-rarimo-l2.md).
- **The smart contracts deployed onto it.** These are programs at specific
  addresses. The chain doesn't care who deployed them; it just runs them.

Today, Jomhoor uses **both** Rarimo's chain and Rarimo's deployed identity
contracts. After M6, Jomhoor still uses Rarimo's chain — but the contracts
are ours.

## What Rarimo's contracts currently do for us

Rarimo has deployed, on Rarimo L2 mainnet, a complete identity stack:

| Contract              | What it holds                                       | Today    |
| --------------------- | --------------------------------------------------- | -------- |
| `Registration2`       | Entry point for new identity registrations          | Rarimo's |
| `StateKeeper`         | Keeps the ICAO root + admin permissions             | Rarimo's |
| `RegistrationSMT`     | Sparse Merkle tree of identity commitments          | Rarimo's |
| `CertificatesSMT`     | Sparse Merkle tree of DS certificate hashes         | Rarimo's |
| Dispatchers (~25)     | Per-algorithm certificate decoders (RSA-2048, etc.) | Rarimo's |
| ZK verifier contracts | One per circuit, called from `Registration2`        | Rarimo's |

Each of those is governed by Rarimo. They decide:

- Which CSCAs go into the ICAO root.
- When the ICAO root is updated.
- Which signature algorithms get dispatchers.
- Who can call admin functions on the SMTs.
- When and how to upgrade the contracts.

For our test phase this is fine. For a sovereign Iranian civic platform, it
is not.

## Why Rarimo's contracts don't work for us long-term

Three concrete reasons, in increasing order of severity:

### 1. We can't change the ICAO root they ship

The on-chain ICAO Merkle root that Rarimo's `StateKeeper` checks against is
set by Rarimo's admin keys. The CSCA bundle itself (`master_000316.pem`,
ICAO PKD master list version 316, ~857 certs) is the same upstream ICAO
snapshot that Rarimo's own reference wallet ships — we inherited it from
their codebase. What we can't change is which root is committed on-chain,
when it's rotated, or which CSCAs get added or revoked. That decision lives
with whoever holds Rarimo's admin keys.

### 2. Iranian passport Variant B is blocked

Iran issues passports under at least three signature variants. Variant B
(RSA-3072, SHA-1, exponent 33259) requires a dispatcher (`C_RSA_3072_33259`)
that does **not exist** on Rarimo mainnet, and Rarimo's existing 3072-bit
dispatcher has a `keyByteLength=512` bug that breaks key extraction (see
[`docs/rarimo-dispatcher-bug-report.md`](../rarimo-dispatcher-bug-report.md)).
Until that's fixed by Rarimo — on Rarimo's timeline — those passports cannot
register. That is a meaningful fraction of older Iranian travel documents.

### 3. The trust root for our voting system is governed by someone else

This is the structural one. Every vote that ever happens on Jomhoor is gated
by an identity registration that was admitted by `Registration2`. Who is
allowed to register, and against which CSCAs, is decided by whoever admins
that contract. Right now, that is not us. For a platform whose mission is
_sovereign civic infrastructure for Iran_, that is the wrong topology.

## What M6 changes

```
                        ┌────────────────────────────────┐
                        │       Rarimo L2 (chain)        │
                        │  • chain id 7368               │
                        │  • RMO gas token               │
                        │  • Rarimo-operated validators  │
                        │  • Anchored to Ethereum        │
                        │  ── STAYS THE SAME ──          │
                        └────────────────────────────────┘
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            │                                                     │
            ▼                                                     ▼
   ┌────────────────────┐                                ┌────────────────────┐
   │ Rarimo's contracts │                                │ Jomhoor's contracts│
   │ Registration2      │      ──── M6 migration ──→     │ Registration2      │
   │ StateKeeper        │                                │ StateKeeper        │
   │ RegistrationSMT    │                                │ RegistrationSMT    │
   │ CertificatesSMT    │                                │ CertificatesSMT    │
   │ Dispatchers        │                                │ Dispatchers        │
   │ Verifiers          │                                │ Verifiers          │
   │  Governed by       │                                │  Governed by       │
   │  Rarimo            │                                │  Jomhoor multisig  │
   └────────────────────┘                                └────────────────────┘
```

Same chain. Same gas token. Same ZK circuit family
(`passport-zk-circuits`, open source, Rarimo's). Same block explorer
(`scan.rarimo.com`). New contract addresses, new admin keys, new ICAO root.

## What M6 does, concretely

1. **Deploy our copies** of `Registration2`, `StateKeeper`, `RegistrationSMT`,
   `CertificatesSMT`, and the full Iranian-passport dispatcher set to Rarimo
   L2 mainnet (chain id 7368).
2. **Seed our StateKeeper** with the ICAO root computed from
   `master_000316.pem` (ICAO PKD master list v316, 857 CSCAs) — the same
   upstream bundle Rarimo's reference wallet ships, but now committed under
   _our_ admin keys, so we control rotations.
3. **Deploy missing dispatchers**, including `C_RSA_3072_33259` for Variant B,
   built on the same dispatcher framework but with the `keyByteLength` bug
   fixed.
4. **Repoint our infrastructure**:
   - relayer configs (`platform/configs/registration-relayer.yaml`,
     `proof-verification-relayer.yaml`),
   - wallet `.env.production`,
   - `sso-svc`'s `zkp.registration_smt_address`,
   - voting contracts (`NoirIDVoting`, `ProposalsState`) — already ours.
5. **Re-registration UX**: existing users registered against Rarimo's
   `Registration2` are NOT in our `RegistrationSMT`. They must re-scan their
   document once. We hide this behind a friendly "we upgraded our identity
   layer — please re-register" screen.
6. **Governance progression**:
   - Phase A: single EOA admin during test deployment.
   - Phase B: migrate to a Gnosis Safe multisig on Rarimo L2 (≥3 signers, 2-of-3
     for routine ops, 3-of-3 for ICAO-root and contract upgrades) **before**
     any non-test relying party goes live.
   - Phase C (long-term): explore on-chain governance via DeXe or similar.

## What M6 does **not** do

This list matters because the language around "sovereignty" tends to overclaim.

- **Does not leave Rarimo L2.** Chain id stays 7368. Gas token stays RMO.
  Validators stay Rarimo's. If Rarimo's validator network halts, we halt
  with them. Validator-set sovereignty is a separate, much larger workstream
  (own L2 rollup, or migrate to a different host chain).
- **Does not replace the ZK circuits.** We continue to use `passport-zk-circuits`
  (Rarimo's open-source repository) and the same Noir / Circom proving stack.
- **Does not break interoperability with the ICAO PKD.** Our trust still
  bottoms out at ICAO-published CSCAs. We just curate the snapshot ourselves.
- **Does not give us better cryptography.** The circuits and the
  verification math are identical. M6 changes _who admins the trust root_,
  not _how trust is computed_.
- **Does not solve the issuer-trust limit** named in
  [`05-passport-trust-chain.md`](05-passport-trust-chain.md). A compromised
  CSCA still produces signatures our system accepts as valid. M6 lets us
  _respond faster_ (we can drop a compromised CSCA from our tree without
  asking Rarimo), but does not prevent the attack.

## Migration story — operational realities

We chose May 2026 as the moment to do this because the migration cost grows
monotonically with user count. Concretely:

| Phase                             | Registered users (rough) | Migration friction               |
| --------------------------------- | ------------------------ | -------------------------------- |
| Today (pre-M6)                    | Hundreds of test users   | Trivial — re-scan once           |
| Post-M6, pre-public-launch        | Low thousands            | Modest — UX banner + re-register |
| If we delayed until 100k+ users   | Tens of thousands        | Expensive — drop-off risk        |
| If we delayed until public launch | All users                | Catastrophic — credibility loss  |

M6 happens before public launch because every month after public launch makes
this strictly worse.

## What about interoperability with FreedomTool?

We are intentionally losing this. Today, an identity registered through
Rarimo's FreedomTool flow can vote on our proposals because we share
`Registration2`. After M6, that one-way bridge closes.

The reasons we accept this:

1. **FreedomTool users are not our users.** They never went through Jomhoor's
   onboarding, never agreed to our terms, never opened the wallet.
2. **Their trust root is Rarimo's curated ICAO tree.** We can't audit which
   CSCAs they accepted.
3. **It is a privacy concern.** Cross-platform identity sharing without
   user consent is exactly what "Sign in with Jomhoor" exists to avoid.

Future interop, if we want it, will be via explicit cross-registration
proofs, not by sharing a contract.

## Governance — the part most people skip past

A multisig is only as safe as the people holding the keys. Our plan for the
key set:

| Role                | Who                            | Why                               |
| ------------------- | ------------------------------ | --------------------------------- |
| Founder signer      | Jomhoor founders               | Operational continuity            |
| Technical signer    | Lead engineer                  | Daily ops, dispatcher updates     |
| Independent signer  | Civic-tech NGO or auditor      | Limits founder unilateral control |
| Optional 4th signer | Iranian diaspora legal counsel | Adds jurisdictional separation    |

Threshold scheme:

- **2-of-3 (or 2-of-4)** for routine ops: relayer wallet top-ups, dispatcher
  additions, non-breaking upgrades.
- **3-of-3 (or 3-of-4)** for: ICAO root changes, contract upgrades, admin
  key rotation.

We commit to publishing the multisig address and signer set before public
launch. Transparency on governance is part of the credibility we promise.

## Why this is the _right_ amount of sovereignty

We could go further:

- Run our own validator set (a separate L2 rollup, Cosmos zone, etc.).
- Anchor to a different L1 (Ethereum directly, Polygon, Base, Arbitrum).
- Build our own proof system from scratch.

We don't do these because **the marginal sovereignty gain is small and the
operational cost is huge.** The credible threats we face — coordinated
disinformation, state-level capture, censorship — are not solved by owning
the validator set. They are solved by:

- owning our trust root (M6),
- owning our admin keys (multisig),
- owning our content gate (normative compliance — see
  [`08-two-gates-identity-and-speech.md`](08-two-gates-identity-and-speech.md)),
- being transparent about what we don't own and what we can't solve
  ([`05-passport-trust-chain.md`](05-passport-trust-chain.md)).

M6 is the right point on that curve.

## Glossary

| Term                          | Meaning                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| **Rarimo L2**                 | The Ethereum-anchored L2 we run on. Chain id 7368.                                   |
| **Registration2**             | Smart contract entry point for new identity registrations.                           |
| **StateKeeper**               | Smart contract holding the ICAO root and admin permissions.                          |
| **RegistrationSMT**           | On-chain Sparse Merkle Tree of identity commitments.                                 |
| **CertificatesSMT**           | On-chain Sparse Merkle Tree of DS certificate hashes.                                |
| **Dispatcher**                | Per-algorithm contract that decodes specific certificate types (e.g., `C_RSA_2048`). |
| **ICAO root**                 | Merkle root over the snapshotted CSCAs we accept.                                    |
| **EOA**                       | Externally-Owned Account — a single-key wallet (deprecated as our admin model).      |
| **Gnosis Safe**               | Standard multisig wallet contract on EVM chains.                                     |
| **Validator-set sovereignty** | Owning the consensus layer, not just contracts. We do not do this.                   |

## Next

- [`08-two-gates-identity-and-speech.md`](08-two-gates-identity-and-speech.md)
  — the second chokepoint: normative compliance against the 11 UN human-rights
  conventions, and why identity proofs alone don't stop platform capture.
