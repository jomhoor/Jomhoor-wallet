# Iranian Biometric Passport Support — Action Plan

> Date: 27 February 2026
> Status: Planning
> Approach: Fix & wire up existing Rarimo-based infrastructure (Option A)

## Background

Iranian biometric passports use **RSA 2048 + SHA256** — the most commonly supported signature type across all ZK passport platforms. Both Rarimo's Circom and Noir circuits already support this configuration (sigType=1). The infrastructure is in place; the blockers are implementation bugs and missing wiring in our mobile app.

We evaluated three options:

| Option                                       | Description                                | Verdict                           |
| -------------------------------------------- | ------------------------------------------ | --------------------------------- |
| **A. Fix our Rarimo-based approach**         | Fix 3 bugs/gaps in our codebase            | **Recommended** ✅                |
| B. Integrate zkpassport SDK alongside Rarimo | Use zkpassport for proof, bridge to Rarimo | Breaks decentralization model     |
| C. Switch entirely to zkpassport             | Abandon Rarimo, deploy on Ethereum         | Lose FreedomTool interoperability |

## Why Option A

- Circuits for RSA 2048 SHA256 **already exist** (both Circom and Noir variants on Rarimo's GCS)
- Registration strategies (`CircomEPassportRegistration`, `NoirEPassportRegistration`) are **already implemented** but not wired up
- Same Rarimo L2 infrastructure we already use for INID — no new contracts needed
- Users registered via FreedomTool / rarime can also vote on our proposals (shared RegistrationSMT)
- Privacy model preserved: passport data never leaves the device

---

## Action Items

### 1. Fix Barrett Reduction Bug (Critical)

**File:** `src/utils/circuits/registration/noir-registration-circuit.ts` line 53

**Problem:** The RSA Barrett reduction parameter is correctly computed inside `if (pubKey instanceof RSAPublicKey)`, then **unconditionally overwritten with zeros** on the next line:

```typescript
// Line 36-55 (current, broken)
let reduction: string[] = []

if (pubKey instanceof RSAPublicKey) {
  const unpaddedModulus = new Uint8Array(
    pubKey.modulus[0] === 0x00 ? pubKey.modulus.slice(1) : pubKey.modulus,
  )

  reduction = RegistrationCircuit.splitBigIntToChunks(
    120,
    defaultChunkedParams.chunk_number,
    NoirEPassportBasedRegistrationCircuit.computeBarretReduction(
      unpaddedModulus.length * 4 + 2,
      toBigInt(unpaddedModulus),
    ),
  )
}

// ❌ BUG: This line unconditionally overwrites the correctly computed reduction
reduction = RegistrationCircuit.splitBigIntToChunks(120, defaultChunkedParams.chunk_number, 0n)
```

**Fix:** Remove line 53 (the unconditional overwrite). The `reduction` variable is already initialized to `[]` and correctly set for RSA keys:

```typescript
// After fix: remove the overwrite, keep the if-block result
if (pubKey instanceof RSAPublicKey) {
  // ... computes reduction correctly
}
// Line 53 deleted — reduction stays as computed for RSA, or [] for non-RSA

return { ...super.chunkedParams, reduction }
```

**Impact:** Without this fix, all Noir-based passport registration proofs with RSA keys will produce invalid proofs (Barrett parameter = 0 → wrong modular reduction).

**Reference:** zkpassport's Barrett reduction in `Dev0/zkpassport-packages/packages/zkpassport-utils/src/barrett-reduction.ts` computes the same parameter correctly: `floor(2^(2k + overflow_bits) / modulus)`. Compare our `computeBarretReduction()` implementation against theirs if further issues arise.

---

### 2. Add Dynamic Strategy Selection in ScanProvider

**File:** `src/pages/app/pages/document-scan/ScanProvider/index.tsx` lines 94-95

**Problem:** Strategy is hardcoded to INID:

```typescript
// TODO: add circuit strategy selection
const registrationStrategy = new NoirEIDRegistration()
```

**Fix:** Detect document type from the scanned passport and select the appropriate strategy:

```typescript
import { CircomEPassportRegistration } from '@/api/modules/registration/variants/circom-epassport'
import { NoirEPassportRegistration } from '@/api/modules/registration/variants/noir-epassport'
import { NoirEIDRegistration } from '@/api/modules/registration/variants/noir-eid'

function getRegistrationStrategy(eDoc: EDocument) {
  // INID (Iranian National ID card) — TD1 format with specific circuit
  if (eDoc instanceof EID) {
    return { strategy: new NoirEIDRegistration(), description: 'INID → Noir' }
  }

  // ePassport — detect signature algorithm
  const sigAlgo = eDoc.sod?.slaveCertificate?.signatureAlgorithm
  const isECDSA = sigAlgo?.includes('1.2.840.10045') // EC OID prefix

  if (isECDSA) {
    // ECDSA passports (German, etc.) → Noir only
    return { strategy: new NoirEPassportRegistration(), description: 'ECDSA passport → Noir' }
  }

  // RSA passports (Iranian, most countries) → Circom (Groth16) or Noir
  // Circom is more mature for RSA 2048; Noir also works (after Barrett fix)
  return { strategy: new CircomEPassportRegistration(), description: 'RSA passport → Circom' }
}
```

**Decision needed:** For RSA passports, prefer Circom (more tested, same proof accepted by Registration2) or Noir (newer, unified proving system)? Circom is safer for initial rollout.

---

### 3. Add Passport-Based Voting Circuit

**Problem:** Only INID voting works via `executeINID` and `queryIdentity_inid_ca`. Passport-based voting needs `executeNoir` and a corresponding query identity circuit.

**Files to create/modify:**

| File                                                          | Action                                                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/utils/circuits/passport-based-query-identity-circuit.ts` | **Create** — analogous to `eid-based-query-identity-circuit.ts` but for TD3 passports                     |
| `src/pages/app/pages/poll/index.tsx`                          | **Modify** — detect document type and call `executeNoir` for passports vs `executeINID` for INID          |
| Voting contract proposal creation                             | **Modify** — ensure proposals support both passport and INID voters (dual selector or separate proposals) |

**Key differences between passport and INID voting:**

| Aspect          | Passport (`executeNoir`)                     | INID (`executeINID`)       |
| --------------- | -------------------------------------------- | -------------------------- |
| Public signals  | 24                                           | 23                         |
| UserData struct | 3 fields (nullifier, citizenship, timestamp) | 4 fields (+personalNumber) |
| Selector bits   | Different bit layout                         | 65569 (0x10021)            |
| Date handling   | Real dates from MRZ                          | ZERO_DATE constants        |
| Circuit         | `queryIdentity`                              | `queryIdentity_inid_ca`    |

**Note:** The `queryIdentity` Circom circuit `.zkey` is available on Rarimo's GCS. Check the rarime-android-app for the exact circuit name and download URL — they use `circuit_query_zkey.zkey` + `query_identity_dat` for Groth16-based voting.

---

### 4. (Optional) Borrow zkpassport Utilities

These utilities from `@zkpassport/zkpassport-utils` can improve robustness:

| Utility                    | File in zkpassport                                        | Use case                                                                                                                 |
| -------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **SOD parser**             | `packages/zkpassport-utils/src/passport/sod.ts`           | More robust `signedAttrs` reconstruction — handles edge cases where raw ASN.1 bytes differ from what was actually signed |
| **Signature verification** | `packages/zkpassport-utils/src/signature-verification.ts` | Brute-force hash algorithm detection — tries all hash algorithms when passport declares wrong one                        |
| **Barrett reduction**      | `packages/zkpassport-utils/src/barrett-reduction.ts`      | Reference implementation: `floor(2^(2k + overflow_bits) / modulus)` — compare against our `computeBarretReduction()`     |

**These are NOT reusable** (incompatible proof systems):

- Circuit input preparation (expects Poseidon2 commitments, 4-stage chaining)
- Merkle tree (Poseidon2 IMT depth 16 vs our PoseidonSMT depth 80)
- Certificate hashing (Poseidon2 vs keccak256)
- On-chain contracts (Ethereum L1 vs Rarimo L2)

---

## Testing Plan

Since we have no Iranian passport to test physically:

1. **Unit test circuit input construction** — mock an RSA 2048 SHA256 passport SOD and verify the circuit inputs are correctly formatted (dg1, encapsulatedContent, signedAttributes, pk_chunked, reduction, sig_chunked)
2. **Test Barrett reduction** — verify `computeBarretReduction(2050, modulus)` produces the correct parameter for a known RSA 2048 modulus (compare against zkpassport's output)
3. **Test strategy selection** — mock `EPassport` and `EID` objects and verify `getRegistrationStrategy()` returns the correct strategy
4. **Local Hardhat e2e** — use a synthetic passport (if available from Rarimo test fixtures) to test the full registration flow against local contracts
5. **Production smoke test** — find a volunteer with an Iranian biometric passport to test on Rarimo mainnet

## Architecture Compatibility Note

Our app and Rarimo's rarime-android-app share the same on-chain identity infrastructure:

```
Shared (Rarimo L2 mainnet):
├── Registration2    → 0x11BB4B14AA6e4b836580F3DBBa741dD89423B971
├── StateKeeper      → 0x61aa5b68D811884dA4FEC2De4a7AA0464df166E1
├── RegistrationSMT  → 0x479F84502Db545FA8d2275372E0582425204A879
└── CertificatesSMT  → 0xA8b350d699632569D5351B20ffC1b31202AcEDD8

Our contracts (separate deployment):
├── NoirIDVoting     → 0x4Fb46c52C3dFB374D0059866862992389fB25D5f
├── ProposalsState   → 0xa16d9BC3d71acfC4F188A51417811661b285428A
└── ProposalSMT      → 0x9E298125048e17170f2690AAd82a07693a1b64C6
```

An Iranian passport holder who registers via FreedomTool or rarime gets an identity in the **same RegistrationSMT** — and can then vote on our proposals. This interoperability is preserved by staying on Rarimo's infrastructure.

zkpassport uses completely separate infrastructure (Ethereum L1, Poseidon2 trees, UltraHonk proofs) and cannot interoperate with Rarimo.
