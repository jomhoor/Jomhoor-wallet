# Iranian Passport: Full Coverage Status & Plan

> Last updated: 23 March 2026

## Current Situation

We need full coverage for **all** Iranian passport variants on the Iranians.Vote platform. After extensive investigation (January–March 2026), we discovered that Iran has issued multiple generations of passports with different cryptographic parameters. Rarimo's existing infrastructure only supports one variant.

We have not yet received a response from the Rarimo team regarding our bug report.

---

## Iranian Passport Variants Discovered

### Variant A — Supported by Rarimo ✅

| Parameter             | Value                                             |
| --------------------- | ------------------------------------------------- |
| DS cert algorithm     | RSA                                               |
| DS cert key size      | 2048-bit (256 bytes)                              |
| DS cert exponent      | **58333** (0xE38D)                                |
| Hash algorithm        | SHA-1 (160-bit)                                   |
| CSCA cert key size    | (unknown — we haven't scanned one)                |
| Rarimo Circuit Type   | **6**                                             |
| Rarimo Circuit        | `registerIdentity_6_160_3_3_336_216_1_1080_3_256` |
| Active Authentication | RSA 1024 (AA type 1)                              |
| Dispatcher            | `C_RSA_2048` (exponent handled by circuit/signer) |

This is the variant Rarimo's FreedomTool already supports. Their app detects exponent 58333 → maps to `CircuitExponentType.E58333` → selects signature type ID 6.

### Variant B — Our Passport ❌ NOT SUPPORTED

| Parameter             | Value                                                                        |
| --------------------- | ---------------------------------------------------------------------------- |
| DS cert algorithm     | RSA                                                                          |
| DS cert key size      | **3072-bit (384 bytes)**                                                     |
| DS cert exponent      | **33259** (0x81EB)                                                           |
| Hash algorithm        | SHA-1 (160-bit)                                                              |
| CSCA cert key size    | 4096-bit                                                                     |
| CSCA cert exponent    | **56611** (0xDD23)                                                           |
| Rarimo Circuit Type   | **None — does not exist**                                                    |
| Dispatcher on Mainnet | `C_RSA_3072_56611` exists but has **keyByteLength bug** (512 instead of 384) |

This is the passport variant we (and likely many other Iranians with newer passports) hold. It has **two problems**:

1. **No ZK circuit exists** — Exponent 33259 is not in Rarimo's supported list (only E3, E65537, E58333, E45347, E46271)
2. **Dispatcher bug on mainnet** — `C_RSA_3072_56611` was deployed with `keyByteLength=512` instead of `384`, causing the contract to extract 512 bytes from the DS cert (384 bytes of actual modulus + 128 bytes of garbage from adjacent cert data)

### What We Don't Know Yet

- **How many variants exist?** We've found two, but there could be more (different issue years, different key sizes)
- **Which variant is more common?** We need more data points from users scanning their passports
- **Does Variant A actually work with Rarimo?** We haven't tested it because our passport is Variant B

---

## Bug Report Sent to Rarimo (No Response)

On ~January 2026, we documented and sent a report about the `C_RSA_3072_56611` dispatcher bug:

**File:** `docs/rarimo-dispatcher-bug-report.md`

### The Bug

In `passport-contracts/deploy/2_registration.migration.ts` line 37:

```typescript
// BUGGY: keyLength "512" should be "384" for RSA 3072-bit keys
await deployCRSADispatcher(deployer, 'SHA2', '56611', '512', '0x0282018100')
//                                            ^^^^    ^^^^
//                                            exp     WRONG: 512 bytes = 4096-bit
//                                                    Should be 384 bytes = 3072-bit
```

Note the irony: the `keyCheckPrefix` is `0x0282018100` which correctly encodes 0x180 = 384 bytes, but the `keyByteLength` parameter is `512`. The contract uses `keyByteLength` to extract the key, not the prefix, so it reads too many bytes.

### Impact

- `registerCertificate` calls with this dispatcher extract 512 bytes from the DS cert
- The DS cert's RSA key is only 384 bytes, so the remaining 128 bytes are garbage from adjacent ASN.1 data
- The resulting `keccak256(key)` hash is wrong → the identity can never be verified for voting
- Even if registration "succeeds", the identity is permanently corrupted in the SMT

### Why Rarimo Hasn't Hit This

Rarimo's own app (FreedomTool) maps Iranian passports to **Type 6** (RSA 2048 / E58333), which uses the `C_RSA_2048` dispatcher. They don't use `C_RSA_3072_56611` at all — it was deployed "for coverage" but the parameters were wrong and likely never tested.

---

## What We Need for Full Iranian Passport Coverage

### For Variant B (RSA 3072 / E33259) — The Hard Part

1. **New signature type** — A new circuit signature type ID (e.g. `9`) for:
   - Algorithm: RSA
   - Key size: 3072-bit (384 bytes)
   - Exponent: 33259
   - Hash: SHA-1 (160-bit)

2. **New Noir circuit** — e.g. `registerIdentity_9_160_3_3_336_216_1_1080_3_256` (based on Type 7/8 templates)
   - Types 7 (E45347) and 8 (E46271) are architecturally identical: same key size, same hash, just different exponent constant
   - The circuit's RSA verification just needs the exponent as a parameter

3. **New on-chain dispatcher** — `C_RSA_3072_33259`:
   - Signer: `CRSASigner` initialized with exponent `33259` and SHA-1 hash
   - `keyByteLength`: `384` (NOT 512!)
   - `keyCheckPrefix`: `0x0282018100` (standard 3072-bit RSA prefix)

4. **App-side support**:
   - Add `E33259` to `CircuitExponentType` enum
   - Add Type 9 to `SupportRegisterIdentityCircuitSignatureType.supported`
   - Add circuit name to `RegisterNoirCircuitData`
   - Add GCS download URL to `BaseConfig`
   - Our jomhoor-wallet already detects the exponent dynamically — just needs the circuit file

### For Variant A (RSA 2048 / E58333) — Already Possible

Variant A should work with Rarimo's existing infrastructure:

- Circuit Type 6 and its Noir circuit already exist
- Dispatcher `C_RSA_2048` handles it (exponent verified in the ZK circuit, not the dispatcher)

We should test this with a Variant A passport to confirm.

### Fix the Existing Bug (C_RSA_3072_56611)

Even though this dispatcher uses CSCA exponent 56611 (not DS cert exponent 33259), it should still be fixed:

- Change `keyByteLength` from `512` to `384` in the deployment
- This affects the **CSCA cert registration** step, not the identity registration step
- The CSCA cert for our passport IS RSA 4096-bit, so the 56611 dispatcher might actually need `keyByteLength=512`... but that depends on whether the dispatcher extracts the CSCA key or the DS key

**Key insight (March 2026):** The dispatcher naming uses the **CSCA exponent** (`56611`), but the `keyByteLength` should match the **DS cert** key size, because `registerCertificate` passes the DS cert's public key to the dispatcher. We confirmed this by reading the contract code — `getCertificateKey()` receives the DS cert's public key bytes.

Wait — actually we need to re-examine this. If the dispatcher is for CSCA validation:

- A CSCA cert using RSA 4096 + exponent 56611 signs DS certs
- The DS cert's key is RSA 3072 (384 bytes)
- The dispatcher extracts the DS cert's key → keyByteLength should be **384**
- The dispatcher's signer verifies the CSCA's signature (using exponent 56611)

So yes, the bug is confirmed: `keyByteLength=512` is wrong, should be `384`.

---

## Can We Test Locally on Hardhat? YES ✅

We can deploy and test the full registration flow on local Hardhat without waiting for Rarimo.

### What Local Hardhat Already Has

The existing migration (`2_registration.migration.ts` + `10_setup.migration.ts`) deploys:

- `Registration2Mock` — full identity registration contract
- `StateKeeperMock` — with `mockChangeICAOMasterTreeRoot()` to set any ICAO root
- `CRSADispatcher` for `C_RSA_3072_56611` — deployed but with the keyByteLength bug
- `CRSASigner` with exponent 56611
- `MockEvidenceRegistry` — mock for local testing
- All SMT contracts (CertificatesSMT, RegistrationSMT)

### What We Need to Add for Local Testing

#### Step 1: Fix the Existing Dispatcher Bug

In `deploy/2_registration.migration.ts`, change line 37:

```diff
- await deployCRSADispatcher(deployer, "SHA2", "56611", "512", "0x0282018100");
+ await deployCRSADispatcher(deployer, "SHA2", "56611", "384", "0x0282018100");
```

#### Step 2: Add C_RSA_3072_33259 Dispatcher

In `scripts/utils/types.ts`, add:

```typescript
export const C_RSA_SHA2_3072_33259 = keccak256(['string'], ['C_RSA_3072_33259'])
```

In `deploy/2_registration.migration.ts`, add:

```typescript
await deployCRSADispatcher(deployer, 'SHA1', '33259', '384', '0x0282018100')
```

Note: hash is `SHA1` (not SHA2) because our passport's DS cert uses SHA-1.

In `deploy/10_setup.migration.ts`, register the dispatcher:

```typescript
import { C_RSA_SHA2_3072_33259 } from '../scripts/utils/types'

const cRsa3072Sha1Dispatcher_33259 = await deployer.deployed(
  CRSADispatcher__factory,
  'CRSADispatcher SHA1 384 33259',
)

await registration.mockAddCertificateDispatcher(
  C_RSA_SHA2_3072_33259,
  await cRsa3072Sha1Dispatcher_33259.getAddress(),
)
```

#### Step 3: Circuit Situation

For local Hardhat testing, **we don't need the full ZK circuit for the dispatcher test**. The registration flow has two steps:

1. **`registerCertificate`** — Registers the DS cert in CertificatesSMT (uses dispatcher)
   - This is what we can test NOW on Hardhat
   - Verifies the CSCA signature on the DS cert
   - Extracts and hashes the DS cert's public key
   - Tests: Does the contract accept our cert? Does it extract the right key?

2. **`registerIdentityLight*`** — Registers the identity using a ZK proof (uses circuit)
   - This requires a compiled ZK circuit for our passport variant
   - We CAN'T test this until we have the circuit

**So for Step 1 (cert registration), we can test immediately after fixing the dispatcher.**

For Step 2 (identity registration), there are two options:

- **Option A:** Ask Rarimo to compile a circuit for E33259 (same as E45347 circuit but with different exponent)
- **Option B:** Compile it ourselves from Rarimo's open-source circuit code (`rarimo/passport-circuits`)

#### Step 4: App-Side Changes for Local Testing

In `jomhoor-wallet/src/api/modules/registration/strategy.ts`, the dispatcher name is already computed dynamically based on the CSCA exponent. When it encounters exponent 56611:

```
dispatcher = "C_RSA_3072_56611"
```

For the DS cert exponent 33259, we might need a **separate dispatcher** based on the DS cert exponent rather than the CSCA exponent — this depends on how the Registration2 contract selects dispatchers. The dispatcher hash in `registerCertificate` is computed from the certificate data type, which includes the signature algorithm of the **CSCA** (since the CSCA signed the DS cert).

**Critical question:** Does the Registration2 contract route to the dispatcher based on:

- (a) The CSCA's signature algorithm (what signed the DS cert) → exponent 56611
- (b) The DS cert's own public key parameters → exponent 33259

If (a), then we only need `C_RSA_3072_56611` with fixed keyByteLength.
If (b), then we need `C_RSA_3072_33259`.

From our code reading, the app sends the dispatcher hash computed from the CSCA cert properties. So it's likely (a).

### Local Test Plan

```bash
# 1. Fix dispatcher in migration
cd platform/services/passport-contracts
# Edit deploy/2_registration.migration.ts: change "512" → "384" on line 37

# 2. Deploy fresh
npx hardhat node --hostname 0.0.0.0
npx hardhat migrate --network localhost
node scripts/deploy-mock-evidence-registry.js

# 3. Verify dispatcher
node -e "
const { ethers } = require('ethers');
const p = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
// Check C_RSA_3072_56611 dispatcher address
const reg = new ethers.Contract('<Registration2_ADDR>',
  ['function certificateDispatchers(bytes32) view returns (address)'], p);
const hash = ethers.solidityPackedKeccak256(['string'], ['C_RSA_3072_56611']);
reg.certificateDispatchers(hash).then(addr => {
  const disp = new ethers.Contract(addr, [
    'function keyByteLength() view returns (uint256)',
    'function keyCheckPrefix() view returns (bytes)',
    'function signer() view returns (address)'
  ], p);
  Promise.all([
    disp.keyByteLength(),
    disp.keyCheckPrefix(),
    disp.signer()
  ]).then(([kbl, kcp, s]) => {
    console.log('keyByteLength:', kbl.toString(), kbl == 384n ? '✅' : '❌ WRONG');
    console.log('keyCheckPrefix:', kcp);
    console.log('signer:', s);
  });
});
"

# 4. Deploy voting contracts
cd ../passport-voting-contracts
npx hardhat migrate --network localhost

# 5. Run app against local Hardhat
cd ../../jomhoor-wallet
# Update .env.local with new contract addresses
# Update src/api/modules/rarimo/constants.ts with local RPC
APP_ENV=local npx expo run:ios --device
```

---

## Architecture Clarification: Dispatcher ≠ Circuit

A common source of confusion is the relationship between **dispatchers** and **circuits**:

```
Certificate Registration (registerCertificate):
  App → sends DS cert + CSCA Merkle proof → Registration2
  Registration2 → routes to DISPATCHER based on cert data type hash
  Dispatcher → SIGNER verifies CSCA signature on DS cert
  Dispatcher → extracts DS cert public key (keyByteLength bytes)
  Registration2 → stores keccak256(DS key) in CertificatesSMT

Identity Registration (registerIdentityLight):
  App → generates ZK PROOF locally using CIRCUIT
  App → sends proof to Registration2
  Registration2 → routes to VERIFIER based on identity method hash
  Verifier → checks ZK proof (proof was generated by circuit)
  Registration2 → stores identity commitment in RegistrationSMT
```

- **Dispatcher** = on-chain contract that validates the DS certificate and extracts the public key
  - Parameters: signer algorithm, key byte length, key check prefix
  - Needs exponent to verify CSCA→DS signature chain
- **Circuit** = ZK circuit that proves passport validity without revealing data
  - Parameters: signature type, hash, document type, SOD offsets
  - Needs exponent to verify DS→SOD signature chain
  - Runs client-side, proof verified on-chain

Both need the RSA exponent, but at different layers:

- Dispatcher signer needs the **CSCA exponent** (56611) to verify CSCA→DS signature
- Circuit needs the **DS cert exponent** (33259) to verify DS→passport data signature

---

## Timeline & Dependencies

| Task                                     | Blocked On                          | Can Do Now?            |
| ---------------------------------------- | ----------------------------------- | ---------------------- |
| Fix keyByteLength bug locally            | Nothing                             | ✅ Yes                 |
| Add C_RSA_3072_33259 dispatcher locally  | Nothing                             | ✅ Yes                 |
| Test cert registration on Hardhat        | Tasks above                         | ✅ Yes                 |
| Compile Noir circuit for RSA 3072/E33259 | Rarimo circuit source code          | ⚠️ Need to investigate |
| Test full identity registration          | Circuit compilation                 | ❌ Blocked             |
| Deploy fix to Rarimo mainnet             | Rarimo team response                | ❌ Blocked             |
| Deploy new dispatcher to mainnet         | Rarimo team (admin is TSS-governed) | ❌ Blocked             |
| Test Variant A (RSA 2048/E58333)         | A user with that variant            | ⚠️ Need test passport  |

## Next Steps

1. **Fix the dispatcher bug** in local deployment and redeploy on Hardhat
2. **Add the E33259 dispatcher** to local deployment
3. **Test cert registration** with our actual passport data on local Hardhat
4. **Investigate Rarimo's circuit source** (`rarimo/passport-circuits`) to see if we can compile an E33259 variant ourselves
5. **Follow up with Rarimo team** on the bug report
6. **Find a Variant A passport holder** to test existing FreedomTool support

---

## Reference Files

| File                                                                             | Purpose                                  |
| -------------------------------------------------------------------------------- | ---------------------------------------- |
| `docs/rarimo-dispatcher-bug-report.md`                                           | Original bug report                      |
| `docs/rarimo-circuits-complete-list.md`                                          | Complete list of all 87 Rarimo circuits  |
| `platform/services/passport-contracts/deploy/2_registration.migration.ts`        | Dispatcher deployment (line 37 = bug)    |
| `platform/services/passport-contracts/deploy/10_setup.migration.ts`              | Dispatcher registration in Registration2 |
| `platform/services/passport-contracts/deploy/helpers/dispatchers/certificate.ts` | `deployCRSADispatcher` helper            |
| `platform/services/passport-contracts/scripts/utils/types.ts`                    | Dispatcher type hash constants           |
| `jomhoor-wallet/src/api/modules/registration/strategy.ts`                        | App-side dispatcher selection            |
| `jomhoor-wallet/src/utils/circuits/circuit-detector.ts`                          | Circuit detection logic                  |
| `platform/services/passport-contracts/scripts/verify-local-setup.js`             | Infrastructure verification              |
