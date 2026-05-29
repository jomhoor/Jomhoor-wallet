# NIDC Verification Investigation & Implementation Plan (`@iland/nid-verification`)

## Summary

This report documents the investigation and implementation plan for a new reusable package:

- **Target package:** `@iland/nid-verification`
- **Target path:** `/Users/shooresh/Documents/hello1/jomhoor/mobile-Iranians.vote/packages/nid-verification`

Goal: support a four-step Iranian National ID verification flow in Jomhoor:

1. Front/back card scan (front OCR/manual + back barcode)
2. NFC chip reading
3. Liveness and face comparison
4. Proof generation via existing app flow

Investigation was performed without code changes.

---

## Current Reusable Code Findings

### Jomhoor Document Scan Flow (Host App)

Primary files:

- `src/pages/app/pages/document-scan/index.tsx`
- `src/pages/app/pages/document-scan/ScanProvider/index.tsx`
- `src/pages/app/pages/document-scan/components/*`

Key behavior:

- Flow is step-driven via `ScanProvider.currentStep`.
- `createIdentity()` in `ScanProvider` is the real proof-generation trigger.
- `GenerateProofStep` is progress UI only.

Important current paths:

- Passport path: MRZ/barcode -> passport NFC -> details -> liveness/gaze/face -> preview -> proof
- ID path: legacy NFC certificate scan (`ScanNfcStep`) -> preview -> proof (EID strategy)

### Reusable from `@iland/passport-verification`

Package conventions to mirror:

- Export structure and subpath exports (`./passport`, `./face`, `./identity-flow`, `./native`, `./shared`)
- TS build setup (`tsconfig`, `dist` output, top-level shim files)
- RN native package structure (`react-native.config.js`, podspec, android module)

Directly reusable functional parts:

- **Barcode parsing:** `parseNidBarcode` (already normalizes Persian/Arabic digits + validates national code checksum)
- **Face/liveness stack:** liveness challenge logic, gaze utilities, face comparison
- **NFC runtime patterns:** input/output contracts, status probing, cancel semantics, error mapping patterns

Asset risk:

- Face model assets live in `@iland/passport-verification` and are copied into app assets by `withFaceModelAssets` plugin.
- Duplicating model assets in `nid-verification` would likely increase bundle size and add release risks.
- Recommended: consume face functions from `@iland/passport-verification` instead of copying assets/models.

### Existing Iranian NFC Logic in Jomhoor

There is already RN APDU logic in app code:

- `src/utils/e-document/inid-nfc-reader.ts`

This currently reads signing/auth certificates and CSN/CRN and mirrors key INIDCA command sequences.

This is the strongest practical baseline for `nid-verification` NFC reuse in RN.

### INIDCA Reuse Findings

INIDCA is a Flutter app (not RN native module package):

- Main logic: `inidca/lib/*`
- Uses `flutter_nfc_kit` and Dart command/parsing code.

Reusable from INIDCA:

- APDU command sequences
- File-selection fallback strategies
- Status-word handling patterns (`61xx`, `6Cxx`, etc.)
- Parsing heuristics for CSN/CRN/date/AFIS metadata tags

Not directly reusable as-is:

- Flutter/Dart runtime and plugin bindings
- App-level UI, logging, export/storage mechanisms

Privacy concerns in INIDCA to avoid in production flow:

- Very verbose logs containing sensitive data
- File export/share flows
- Certificate persistence behaviors for diagnostics

---

## Existing Jomhoor Document-Scan Flow Map

### Step map (current)

Defined in `ScanProvider.Steps`:

1. `SelectDocTypeStep`
2. `ScanMrzStep` (currently bound to `ScanPassportMrzStep`)
3. `ScanPassportNfcStep`
4. `PassportNfcDetailsStep`
5. `FaceLivenessStep`
6. `FaceGazeStep`
7. `FaceComparisonStep`
8. `ScanNfcStep` (legacy EID certificate path)
9. `DocumentPreviewStep`
10. `GenerateProofStep`
11. `RevocationStep`

### Data flow highlights

Context state carries:

- MRZ temp data (`tempMRZ`)
- Document (`tempEDoc`: `EPassport` or `EID`)
- Passport NFC normalized details + portrait + raw package result
- Barcode NIDN from MRZ/barcode step
- Face verification results (liveness/gaze/comparison)

Transitions:

- `setTempMrz` -> `ScanPassportNfcStep`
- `setPassportNfcScanOutput` -> stores `EPassport` + details, then either face steps or preview
- successful face comparison -> `DocumentPreviewStep`
- `DocumentPreviewStep` “Generate Proof” -> `createIdentity()` -> `GenerateProofStep`

Error/retry behavior:

- Passport NFC step has explicit read states, mapped errors, retry, and MRZ rescan
- Face comparison has retry/back/skip actions
- Liveness/gaze allow restart and back/skip paths

---

## INIDCA NFC Reuse Assessment

## Recommended reuse strategy

Do **not** copy INIDCA Flutter implementation as package runtime.

Instead:

1. Use existing RN `inid-nfc-reader.ts` as immediate baseline
2. Lift/generalize into `@iland/nid-verification` `src/nfc` layer
3. Keep an abstraction boundary so host app only sees normalized results and typed errors
4. Introduce Swift/Kotlin native NFC module only if JS IsoDep path cannot satisfy reliability/performance needs

## Minimal NFC API for `nid-verification`

Suggested API:

- `initNidNfc(): Promise<void>`
- `probeNidNfcSupport(): Promise<NidNfcProbeResult>`
- `readNidChip(input: NidNfcReadInput): Promise<NidNfcReadResult>`
- `cancelNidNfcSession(): Promise<void>`

`NidNfcReadInput` should support:

- timeout
- selected read profile (full/minimal)
- optional toggles for certificate-only / metadata-only reads

---

## Proposed `packages/nid-verification` Architecture

Suggested structure:

- `packages/nid-verification/package.json`
- `packages/nid-verification/tsconfig.json`
- `packages/nid-verification/react-native.config.js`
- `packages/nid-verification/NidVerification.podspec` (if native module needed)
- `packages/nid-verification/src/index.ts`
- `packages/nid-verification/src/types/*`
- `packages/nid-verification/src/flow/NidVerificationFlow.tsx`
- `packages/nid-verification/src/hooks/useNidVerification.ts`
- `packages/nid-verification/src/steps/*`
- `packages/nid-verification/src/nfc/*`
- `packages/nid-verification/src/barcode/*`
- `packages/nid-verification/src/ocr/*`
- `packages/nid-verification/src/validation/*`
- `packages/nid-verification/src/adapters/*`
- `packages/nid-verification/src/privacy/*`
- `packages/nid-verification/src/utils/*`
- `packages/nid-verification/ios/*` (conditional)
- `packages/nid-verification/android/*` (conditional)

Guiding principle:

- Package owns verification workflow/components/contracts.
- Host app owns navigation, wallet/store, and registration/proof invocation.

---

## Proposed Public API

Potential public exports:

- `NidVerificationFlow`
- `NidFrontScanStep`
- `NidBackScanStep`
- `NidNfcReadStep`
- `NidLivenessFaceStep`
- `useNidVerification`
- `NidVerificationResult`
- `NidProofInputAdapter`
- `readNidChip`
- `cancelNidNfcSession`
- `probeNidNfcSupport`

Also re-export where practical:

- `parseNidBarcode` from passport package barcode module (or wrapper)

---

## Proposed Data Types

Core modeling should capture both values and evidence source.

Example shape:

```ts
type SourceType = 'ocr' | 'manual' | 'barcode' | 'nfc' | 'derived'

type FieldEvidence<T> = {
  value?: T
  source: SourceType
  confidence?: number
}

type NidFrontScanResult = {
  frontImageUri?: string
  nationalId?: FieldEvidence<string>
  firstName?: FieldEvidence<string>
  lastName?: FieldEvidence<string>
  birthDate?: FieldEvidence<string>
}

type NidBackScanResult = {
  backImageUri?: string
  barcodeRaw?: string
  nationalId?: FieldEvidence<string>
  parsedFields?: Record<string, unknown>
}

type NidNfcResult = {
  nationalId?: FieldEvidence<string>
  firstName?: FieldEvidence<string>
  lastName?: FieldEvidence<string>
  birthDate?: FieldEvidence<string>
  expiryDate?: FieldEvidence<string>
  cardNumber?: FieldEvidence<string>
  csn?: string
  crn?: string
  signingCertHex?: string
  authCertHex?: string
  raw?: unknown
}

type NidFaceLivenessResult = {
  livenessPassed: boolean
  faceComparisonPassed?: boolean
  similarity?: number
  liveFaceImageUri?: string
  referenceFaceImageUri?: string
}

type VerifiedNidIdentity = {
  nationalId: string
  firstName?: string
  lastName?: string
  birthDate?: string
  expiryDate?: string
  cardNumber?: string
  evidence: {
    front?: NidFrontScanResult
    back?: NidBackScanResult
    nfc?: NidNfcResult
    face?: NidFaceLivenessResult
  }
}

type NidVerificationResult = {
  verified: boolean
  identity?: VerifiedNidIdentity
  mismatches?: string[]
  blockingErrors?: string[]
}
```

---

## Validation and Matching Plan

Normalization first:

- Convert Persian/Arabic digits to ASCII for all comparisons.
- Normalize whitespace and common formatting artifacts.

Comparison matrix:

- Front OCR/manual `nationalId` vs back barcode `nationalId`
- Above vs NFC `nationalId` (if available)
- Name/date from OCR vs NFC fields
- Face source (chip/card image if available) vs live face capture

Mismatch/error handling:

- OCR unreadable -> allow manual entry
- Barcode unreadable -> retry, optional continue if NFC/manual can recover
- NFC unavailable/read fail -> blocking for proof path
- National ID mismatch across trusted sources -> block + rescan/review
- Face comparison fail -> retry loop + exit path
- Liveness fail -> retry loop + exit path
- Missing proof-required fields -> block and explain which field is missing

---

## Integration Plan with Jomhoor

### App entry points

Current launcher:

- `DocumentsWithoutDocs` -> `navigation.navigate('App', { screen: 'Scan' })`

Current scan route type:

- `Scan?: { documentType?: DocType }`

### Recommended integration approach

1. Keep host route as `Scan` initially.
2. Add a new selectable verification method for NID in scan selection UX.
3. Use package flow components from `@iland/nid-verification` in the host scan screen/provider.
4. Reuse current `GenerateProofStep` UI for progress.
5. Implement host adapter to convert `NidVerificationResult` to proof-generation input.

### Proof-generation contract alignment

Current proof path:

- Triggered by `ScanProvider.createIdentity()`
- Chooses strategy (`NoirEPassportRegistration` or `NoirEIDRegistration`)

For NID:

- If NID flow yields required EID-like certificate artifacts, adapt into existing `EID`-compatible path.
- Otherwise add a new registration strategy/circuit variant (outside this package scope, but should be planned in host app).

---

## Native / Platform Requirements

### iOS

Current app already has:

- `NFCReaderUsageDescription`
- TAG entitlement
- broad ISO7816 select identifiers (including INID-related identifiers)

Plan:

- Verify minimal required identifiers for NID and keep list maintainable.
- Validate iOS behavior for target APDU sequences (INIDCA itself marks iPhone support incomplete).

### Android

Current app already has:

- `android.permission.NFC`
- `android.hardware.nfc` feature required

Plan:

- Ensure robust `IsoDep` lifecycle: request/cancel, timeout, tag loss, retries.

### Camera / Face

- Camera permissions already configured.
- Reuse existing face runtime/model from passport package to avoid duplication.

### OCR feasibility

Current repository OCR setup indicates active recognition modes are limited (`latin/chinese/devanagari/japanese/korean`) in current API contracts.

Plan:

- Treat Persian OCR as a later enhancement.
- Phase 1/2 should include manual national ID input fallback.

### Release bundling risk

- Avoid second copy of ML models in `nid-verification`.
- Keep face model ownership in one package/plugin path.

---

## Security and Privacy Plan

Requirements:

- Do not persist raw ID images or live face images by default.
- Do not persist raw NFC dumps by default.
- Do not log national ID, names, raw APDU data, or face metadata in production.

State lifecycle and cleanup points:

- Cleanup temporary media on:
  - step retry/rescan
  - flow cancel
  - flow completion
  - component unmount/background
- Keep only minimal normalized fields required for proof adapter and UX review.

Network constraints:

- No raw image upload from package.
- Host-provided proof layer should consume normalized identity/proof artifacts only.

---

## Testing Plan

### Unit tests

- digit normalization (Persian/Arabic -> ASCII)
- barcode parse success/failure
- OCR/manual fallback resolver
- source confidence and precedence
- mismatch detection rules
- proof input adapter mapping

### Flow/state tests

- step transitions and branching
- retry/back/cancel behavior
- blocking error states
- resume/reset semantics

### NFC tests

- mocked success/partial/failure paths
- tag lost / timeout / user cancel handling
- platform-specific branches

### Face tests

- mocked liveness pass/fail
- mocked face comparison pass/fail

### Privacy tests

- temp file cleanup verification
- no sensitive data in logs assertions

---

## Risks and Unknowns

- Whether NID chip exposes a reliable face reference image for face comparison.
- iOS support stability for the full Iranian card APDU flow.
- Practical Persian OCR quality on-device with current stack.
- Proof compatibility if NFC output is insufficient for existing EID/passport circuit requirements.
- Bundle-size/regression risk if assets are duplicated.

---

## Recommended Phased Implementation Plan

## Phase 1

- Create `packages/nid-verification` skeleton (exports/build conventions aligned with passport package).
- Reuse barcode + liveness/gaze/face logic from `@iland/passport-verification`.
- Build step flow with **mocked NFC** result and host wiring.
- Connect to existing `GenerateProofStep` with test adapter data.

## Phase 2

- Integrate real NFC runtime using existing RN APDU baseline (generalized into package).
- Validate iOS/Android permission and session behavior.
- Add NFC mock/test harness layer for deterministic testing.

## Phase 3

- Add front OCR attempt and manual fallback UI.
- Implement full cross-source matching/validation policy.
- Finalize mismatch UX and blocking rules.

## Phase 4

- Privacy hardening and cleanup guarantees.
- Release build validation (assets, native behavior, performance).
- End-to-end scenario validation and regression tests.

---

## Recommendation

Proceed with a **reuse-first package** that imports barcode and face capabilities from `@iland/passport-verification`, moves/generates Iranian NFC logic into `@iland/nid-verification` with clean contracts, and integrates with existing proof UI through a host adapter boundary.

---

## Pre-Phase-1 Proof Compatibility Findings (GenerateProofStep + createIdentity)

### Inspected files

- `src/pages/app/pages/document-scan/components/GenerateProofStep.tsx`
- `src/pages/app/pages/document-scan/ScanProvider/index.tsx` (`createIdentity()`)
- `src/utils/e-document/e-document.ts` (`DocType`, `EID`, `EPassport`)
- `src/utils/circuits/registration/noir-registration-circuit.ts`
- `src/utils/circuits/registration/registration-circuit.ts`
- `src/utils/e-document/inid-nfc-reader.ts`
- `inidca/lib/smart_card_operations.dart`

### What GenerateProofStep actually needs

- `GenerateProofStep` itself is UI progress only.
- Proof input requirements are enforced by `createIdentity()` and downstream registration strategies.

### Exact proof input path for `DocType.ID`

In current host flow, `DocType.ID` uses `NoirEIDRegistration` and expects an `EID` object, where:

- `EID.sigCertificate` is required
- `EID.authCertificate` is required

The EID registration circuit path uses certificate-derived cryptographic material, not just extracted identity fields:

- `tbs` (signing cert TBS bytes)
- `pk` (auth cert public key bytes)
- `signature` (signing cert signature bytes)
- inclusion proof data (`len`, `icao_root`, `inclusion_branches`)
- wallet binding (`sk_identity`)

So existing `DocType.ID` proof path is **certificate-based**.

### Does current ID path already require certs/signatures/challenge-response?

- Current code path requires certs/signatures (via `EID` cert objects).
- No additional NID-specific NFC challenge-response object is required by the current TypeScript proof adapter layer.
- Pure OCR/barcode/manual identity fields are insufficient for current `DocType.ID` proof creation.

### Comparison with `inid-nfc-reader.ts` and INIDCA outputs

Current RN reader (`inid-nfc-reader.ts`):

- `readSigningAndAuthCertificates()` returns:
  - `signingCert` (hex DER cert)
  - `authCert` (hex DER cert)

INIDCA parsing/runtime similarly yields signing/auth certificate data payloads (`certificateData` as hex), with additional metadata in its maps.

Compatibility point:

- Both sources provide the core cert artifacts required to build `EID` in host code (DER parse -> `ExtendedCertificate` -> `EID`).

Gap:

- Output shape is not in proof-ready `EID`/registration input form by default.
- Adapter normalization + validation is needed (parse, verify presence, map errors, sanitize logs, typed handoff).

### Conclusion

**B) NID NFC is partially compatible and needs an adapter.**

Rationale:

- It is compatible at the cryptographic artifact level (signing/auth cert blobs are available).
- It is not plug-and-play compatible at the package contract level without an adapter that converts NFC output into the exact `EID`/proof input expectations and host flow contracts.
- No evidence from inspected code indicates a mandatory new proof circuit for Phase 1 if cert artifacts are correctly mapped.
