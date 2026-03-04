# Current Repo (Rarimo/Custom) vs ZKPassport

## Capability Comparison

| Capability                             | Current Repo (Rarimo)                                     | ZKPassport                                              |
| -------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| **Iranian National ID Card (INID)**    | **Working end-to-end** (custom Pardis/MAV4 NFC protocol)  | **Not supported, ever** (non-ICAO proprietary protocol) |
| **Iranian Passport**                   | Backend code exists, NFC reader NOT implemented           | **75% support** (some cert variants missing)            |
| **Passport NFC Reading**               | Must implement BAC yourself                               | Handled by their mobile app (closed-source)             |
| **MRZ Scanning**                       | Camera OCR component exists (`ScanMrzStep`)               | Handled by their mobile app                             |
| **ZK Proof Generation**                | On-device via Noir (UltraPlonk) + Circom (Groth16)        | On-device in their app (Noir/Barretenberg UltraHonk)    |
| **Registration (identity onboarding)** | On-chain via Rarimo relayer                               | Not applicable (different model)                        |
| **Voting with ZK proof**               | Working for INID, **missing circuit for passport**        | Not a voting system — it's identity verification only   |
| **Selective Disclosure**               | No (all-or-nothing registration proof)                    | **Yes** (age, nationality, name, sanctions check)       |
| **Sybil Resistance**                   | Nullifier via identity key in voting circuit              | Nullifier scoped per domain+scope                       |
| **Self-contained App**                 | **Yes** — one app does everything                         | **No** — users must install ZKPassport app separately   |
| **Blockchain**                         | Rarimo EVM (custom chain)                                 | 10 EVM chains (Ethereum, Base, Arbitrum, etc.)          |
| **React Native SDK**                   | N/A (it IS the React Native app)                          | **No React Native SDK** — closed-source mobile app only |
| **ID Card support (ICAO TD1)**         | Only INID (proprietary)                                   | Yes, for ICAO-compliant ID cards                        |
| **Production readiness**               | INID flow works; passport blocked by build + missing code | Late beta, apps on App Store + Google Play              |
| **Open source**                        | Yes (this repo)                                           | SDK yes, mobile app **no** (planned "after testing")    |

## The Critical Tradeoff

**ZKPassport cannot replace this repo** for two fundamental reasons:

1. **INID support** — The Iranian National ID card uses a proprietary protocol (Pardis/MAV4). ZKPassport only supports ICAO 9303 documents. INID will **never** work with ZKPassport. This is the primary identity document for Iranians inside Iran.

2. **Architecture mismatch** — ZKPassport is a _verifier SDK + wallet app_ model. Users would need to install a second app (ZKPassport), scan a QR code, approve, then come back. You can't embed their NFC reading or proof generation in your app. There's no React Native SDK and the mobile app is closed-source.

## What ZKPassport CAN Do

If you want **passport-only** verification (no INID), ZKPassport could handle:

- Passport NFC reading (BAC + PACE)
- Proof generation for age/nationality/identity verification
- On-chain verification on major EVM chains
- Selective disclosure (prove "Iranian nationality" without revealing name)

## Recommendation

| Scenario                                | Recommendation                                                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Need INID support** (most Iranians)   | **Stay with current repo** — only option                                                                                          |
| **Passport-only, want fast launch**     | Consider ZKPassport as external wallet (QR flow), but 75% Iranian passport coverage is risky                                      |
| **Passport + INID, self-contained app** | **Stay with current repo**, fix the build issues, implement passport BAC reader                                                   |
| **Long-term, both documents**           | Current repo for INID + potentially integrate ZKPassport's open-source circuits/utils for passport (same Noir/Barretenberg stack) |

## Bottom Line

The current repo's approach is the right one for Iranians.Vote. The build issues are solvable (worklets-core version bump, LFS now fixed). The passport NFC reader is the main missing piece (~500 lines of TypeScript implementing ICAO 9303 BAC protocol over `react-native-nfc-manager` IsoDep). ZKPassport is impressive but architecturally incompatible with a self-contained voting app that needs INID support.
