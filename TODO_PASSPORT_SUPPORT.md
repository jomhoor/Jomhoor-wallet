# TODO: Add Passport Support to Iranians.Vote

> **Current State:** The app currently supports **Iranian National ID Cards (INID)** with full registration and voting flows. This document outlines the work needed to add **international passport support** (TD3 documents).

---

## Executive Summary

### What Works Now ✅

- **INID (Iranian ID Card)** registration and voting via `NoirEIDRegistration`
- Custom INID NFC reader (`inid-nfc-reader.ts`)
- EID-based query identity circuit for voting (`queryIdentity_inid_ca`)
- Local INID circuits bundled in app

### What Needs to Be Added ⏳

- **Passport NFC scanning** (native module exists but not integrated in UI)
- **Passport registration strategies** (exist but need testing/fixing)
- **Passport query identity circuits** (for voting after registration)
- **UI flow for passport document type**
- **German/ECDSA passport fixes** (work in progress on `german-pass` branch)

---

## Phase 1: Core Infrastructure (Registration) ✅ Mostly Done

### 1.1 Passport NFC Reader Module

**Status:** ✅ EXISTS
**Location:** [modules/passport-reader/](../iranians.vote/modules/passport-reader/)

- Native module for iOS and Android passport reading
- Reads DG1, DG2, DG15, SOD via NFC
- Supports Active Authentication challenge

**Files:**

- [modules/passport-reader/index.ts](../iranians.vote/modules/passport-reader/index.ts)
- [modules/passport-reader/ios/](../iranians.vote/modules/passport-reader/ios/)
- [modules/passport-reader/android/](../iranians.vote/modules/passport-reader/android/)

### 1.2 EPassport Document Class

**Status:** ✅ EXISTS
**Location:** [src/utils/e-document/e-document.ts](../iranians.vote/src/utils/e-document/e-document.ts)

- `EPassport` class with SOD, DG1, DG15 parsing
- Signature verification helpers
- Serialization/deserialization

### 1.3 SOD Parsing

**Status:** ✅ EXISTS
**Location:** [src/utils/e-document/sod.ts](../iranians.vote/src/utils/e-document/sod.ts)

- X.509 certificate extraction
- Signature parsing (RSA and ECDSA)
- Encapsulated content extraction

### 1.4 Circuit Detection

**Status:** ✅ EXISTS
**Location:** [src/utils/circuits/circuit-detector.ts](../iranians.vote/src/utils/circuits/circuit-detector.ts)

- Detects RSA vs ECDSA from signature algorithm
- Selects Circom (Groth16) for RSA, Noir for ECDSA
- Hash algorithm extraction

### 1.5 Registration Strategies

**Status:** ✅ EXISTS
**Location:** [src/api/modules/registration/variants/](../iranians.vote/src/api/modules/registration/variants/)

| Strategy        | File                  | Status         |
| --------------- | --------------------- | -------------- |
| Circom Passport | `circom-epassport.ts` | ✅ Implemented |
| Noir Passport   | `noir-epassport.ts`   | ✅ Implemented |
| Noir EID        | `noir-eid.ts`         | ✅ Working     |

### 1.6 Registration Circuits

**Status:** ⚠️ PARTIAL
**Location:** [modules/noir/index.ts](../iranians.vote/modules/noir/index.ts) (line 200+)

**Supported circuits (downloadable from Google Cloud):**

- `registerIdentity_25_384_3_3_336_232_NA` - ECDSA brainpoolP384r1 SHA384
- `registerIdentity_26_512_3_3_336_248_NA` - ECDSA brainpoolP512r1 SHA512
- `registerIdentity_2_256_3_*` - RSA 4096 SHA256 variants
- `registerIdentity_1_256_3_*` - RSA 2048 SHA256 variants
- `registerIdentity_20_256_3_*` - ECDSA secp256r1 SHA256
- Many more...

**Issues:**

- [ ] German passport circuit uses wrong hash combo (fixed locally with `registerIdentity_25_384_512_3_3_336_232_NA`)
- [ ] Circuit name matching logic needs testing with real passports

---

## Phase 2: UI Integration ⏳ TODO

### 2.1 Document Type Selection Screen

**Status:** ⏳ NEEDS WORK
**Location:** [src/pages/app/pages/document-scan/ScanProvider/index.tsx](../iranians.vote/src/pages/app/pages/document-scan/ScanProvider/index.tsx)

**Current behavior:**

- `DocType.PASSPORT` → Shows MRZ scan step first
- `DocType.ID` → Goes directly to NFC scan

**TODO:**

- [ ] Add proper MRZ scanning UI for passports
- [ ] Integrate passport NFC reader in scan flow
- [ ] Show passport-specific error messages

### 2.2 MRZ Scanning

**Status:** ⏳ NEEDS UI
**Location:** Need to create or integrate MRZ scanner component

**Options:**

1. Use camera-based MRZ OCR (like Rarimo's FreedomTool)
2. Manual MRZ entry (fallback)

**TODO:**

- [ ] Integrate MRZ scanning library (e.g., `react-native-mrz-scanner` or camera + vision)
- [ ] Parse MRZ to extract BAC parameters (document number, DOB, expiry)
- [ ] Create `ScanMrzStep` component

### 2.3 Passport Preview Screen

**Status:** ⏳ NEEDS WORK
**Location:** [src/pages/app/pages/document-scan/components/](../iranians.vote/src/pages/app/pages/document-scan/components/)

**TODO:**

- [ ] Display passport holder info after NFC read
- [ ] Show nationality, document number, name
- [ ] Handle photo display from DG2 (optional)

---

## Phase 3: Passport Voting Flow ⏳ TODO

### 3.1 Passport Query Identity Circuit

**Status:** ❌ MISSING
**Current:** Only have `queryIdentity_inid_ca` for INID

**Need:**

- Query identity circuit for passports (TD3)
- Similar to INID circuit but with different DG1 structure

**TODO:**

- [ ] Build or obtain `queryIdentity_td3` circuit for passports
- [ ] Add to `supportedNoirCircuits` in [modules/noir/index.ts](../iranians.vote/modules/noir/index.ts)
- [ ] Create `EPassportBasedQueryIdentityCircuit` class

### 3.2 Passport-Based Query Identity Implementation

**Status:** ❌ MISSING
**Current:** Only `EIDBasedQueryIdentityCircuit` exists

**Location to create:** `src/utils/circuits/epassport-based-query-identity-circuit.ts`

**TODO:**

- [ ] Implement `EPassportBasedQueryIdentityCircuit` class
- [ ] Handle TD3 DG1 format (93 bytes vs TD1's smaller format)
- [ ] Compute nullifier correctly for passport identity
- [ ] Integrate with voting flow

### 3.3 Voting Contract Integration

**Status:** ⚠️ PARTIAL
**Current:** `NoirIdVoting` contract deployed, but app uses EID-specific circuit

**Files:**

- [src/pages/app/pages/poll/index.tsx](../iranians.vote/src/pages/app/pages/poll/index.tsx)
- [src/utils/circuits/eid-based-query-identity-circuit.ts](../iranians.vote/src/utils/circuits/eid-based-query-identity-circuit.ts)

**TODO:**

- [ ] Create passport version of query circuit class
- [ ] Modify voting flow to detect identity type and use appropriate circuit
- [ ] Test with passport-registered identities

---

## Phase 4: German Passport Support ⚠️ WIP

### 4.1 Current Issues

**Branch:** `german-pass`

**Problem:** German passports use ECDSA brainpoolP384r1 with a **cross-curve certificate chain**:

- CSCA signs DS cert with **brainpoolP512r1 + SHA512**
- DS cert signs passport with **brainpoolP384r1 + SHA384**

**Known bugs found:**

1. ❌ Using wrong signature source (`slaveCertificate.signatureValue` instead of `sod.signature`)
2. ❌ Hash algorithm mismatch (DG hash vs signature hash)

### 4.2 Fixes Applied

**Location:** [src/utils/circuits/registration/noir-registration-circuit.ts](../iranians.vote/src/utils/circuits/registration/noir-registration-circuit.ts)

- Fixed signature source to use `sod.signature` (line 140+)
- Added custom circuit `registerIdentity_25_384_512_3_3_336_232_NA`

### 4.3 Remaining German Passport Work

**TODO:**

- [ ] Test with real German passport
- [ ] Verify ICAO Merkle proof (may need custom CSCA tree)
- [ ] Check if standard Rarimo dispatchers work
- [ ] Consider using Rarimo's FreedomTool approach for reference

---

## Phase 5: Testing & Validation

### 5.1 Local Development Testing

**TODO:**

- [ ] Set up local Hardhat with deployed contracts
- [ ] Deploy MockEvidenceRegistry
- [ ] Test registration with mock passport data
- [ ] Test voting flow end-to-end

### 5.2 Testnet Testing

**TODO:**

- [ ] Test with real Iranian passport
- [ ] Test with EU/US passport (RSA-based)
- [ ] Test with German passport (ECDSA)
- [ ] Verify circuit selection logic

### 5.3 Production Deployment

**TODO:**

- [ ] Ensure Rarimo mainnet has required dispatchers
- [ ] Verify CSCA certificates are in ICAO tree
- [ ] Update environment variables for mainnet contracts
- [ ] Test with production relayer

---

## Implementation Checklist

### Must Have (MVP)

- [x] Passport NFC reader native module
- [x] EPassport document class
- [x] SOD/Certificate parsing
- [x] Circuit detection (RSA vs ECDSA)
- [x] Circom registration strategy
- [x] Noir registration strategy
- [x] Registration circuits (downloadable)
- [ ] **MRZ scanning UI**
- [ ] **Passport query identity circuit**
- [ ] **EPassportBasedQueryIdentityCircuit class**
- [ ] **Integration in voting flow**

### Should Have

- [ ] German passport support
- [ ] Active Authentication verification
- [ ] Passport photo display
- [ ] Better error messages for passport issues

### Nice to Have

- [ ] Camera-based MRZ OCR
- [ ] Support for all Rarimo circuit variants
- [ ] TD1 passport support (if any country uses it)

---

## File Changes Summary

### Files to Create

| File                                                           | Purpose                         |
| -------------------------------------------------------------- | ------------------------------- |
| `src/utils/circuits/epassport-based-query-identity-circuit.ts` | Passport voting circuit wrapper |
| `src/pages/app/pages/document-scan/components/ScanMrzStep.tsx` | MRZ scanning UI                 |
| `assets/circuits/noir/query-identity/passport/byte_code.json`  | Bundled passport query circuit  |

### Files to Modify

| File                                                       | Changes                                      |
| ---------------------------------------------------------- | -------------------------------------------- |
| `modules/noir/index.ts`                                    | Add passport query circuit to supported list |
| `src/pages/app/pages/poll/index.tsx`                       | Detect identity type, use correct circuit    |
| `src/pages/app/pages/document-scan/ScanProvider/index.tsx` | Add passport scan flow                       |
| `src/store/modules/identity/Identity.ts`                   | Add passport identity types if needed        |

### Files Already Working

| File                                                        | Status |
| ----------------------------------------------------------- | ------ |
| `src/api/modules/registration/variants/circom-epassport.ts` | ✅     |
| `src/api/modules/registration/variants/noir-epassport.ts`   | ✅     |
| `src/utils/circuits/circuit-detector.ts`                    | ✅     |
| `src/utils/e-document/e-document.ts`                        | ✅     |
| `src/utils/e-document/sod.ts`                               | ✅     |
| `modules/passport-reader/`                                  | ✅     |

---

## Dependencies & Resources

### External Dependencies

- Passport query identity circuit (from Rarimo or build custom)
- MRZ scanning library (TBD)

### Google Cloud Circuit URLs

See [RARIMO_ZK_PASSPORT_VOTING_SOURCES.md](./RARIMO_ZK_PASSPORT_VOTING_SOURCES.md#6-google-cloud-storage-resources)

### Reference Implementations

- [FreedomToolAndroid](https://github.com/rarimo/FreedomToolAndroid) - Rarimo's passport voting app
- [passport-zk-circuits-noir](https://github.com/rarimo/passport-zk-circuits-noir) - Circuit source code

---

## Timeline Estimate

| Phase                   | Effort   | Dependencies               |
| ----------------------- | -------- | -------------------------- |
| Phase 2: UI Integration | 3-5 days | MRZ library selection      |
| Phase 3: Voting Flow    | 3-5 days | Passport query circuit     |
| Phase 4: German Support | 2-3 days | Testing access             |
| Phase 5: Testing        | 3-5 days | Real passports for testing |

**Total:** 2-3 weeks for full passport support

---

## Notes & Open Questions

1. **Query Circuit:** Do we need to build a custom passport query circuit or can we use Rarimo's existing one? Check if they have a downloadable TD3 query circuit.

2. **MRZ Library:** Which MRZ scanning approach?
   - Camera OCR (better UX, more complex)
   - Manual entry (simpler, worse UX)
   - Use native passport-reader module's MRZ parsing

3. **Nationality Filtering:** The voting contracts allow citizenship whitelists. How do we handle:
   - Iranian passports specifically?
   - All passports?
   - Country-specific proposals?

4. **ICAO Tree:** Rarimo's mainnet ICAO tree has 122 CSCAs. Do we need our custom tree with 857 certs for broader support?

5. **Revocation:** Passport identity revocation is implemented in strategies but not tested. Priority?
