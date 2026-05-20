# NFC Portrait End-to-End Trace

## Executive Summary
The portrait is most likely lost at **backend selection/runtime path**, not at DG2 request shape.

- Jomhoor now correctly builds native input with `DG2` + `includeImageBase64: true` + `persistDg2ImageFile: true`.
- Package bridge now forwards those flags to iOS native.
- iOS native mapper can emit DG2 portrait fields (`imageBase64`, `filePath`) when flags are enabled.
- However, Jomhoor still defaults to the **JS backend** unless `EXPO_PUBLIC_PASSPORT_NFC_BACKEND` is explicitly set to native; JS backend does not read DG2 portrait.
- This differs from iLand’s working flow, which calls native read directly with DG2+portrait flags.

## Stage-by-Stage Trace

### 1) Jomhoor NFC Request
Files:
- `src/pages/app/pages/document-scan/adapters/mrzToPackageNfcReadInput.ts`
- `src/utils/e-document/passport-nfc-reader.ts`

Findings:
- `requestedDataGroups` includes `DG2`.
- For native backend (`native-ios`/`native-android`) input includes:
  - `includeImageBase64: true`
  - `persistDg2ImageFile: true`
- Native path is only used when backend resolver returns native.

### 2) Package JS/Native Bridge
Files:
- `packages/passport-verification/src/shared/native/passport-native-module.ts`
- `packages/passport-verification/src/passport/nfc/runtime.ts`

Findings:
- `toNativeReadPayload` forwards:
  - `credentials`
  - `dataGroups`
  - `includeImageBase64`
  - `persistDg2ImageFile`
- Runtime mapping preserves `DG2.imageBase64` and `DG2.filePath` into:
  - `files.DG2.base64`
  - `files.DG2.filePath`
  - `result.portrait`

### 3) iOS Native Package
Files:
- `packages/passport-verification/ios/PassportVerificationInputValidator.swift`
- `packages/passport-verification/ios/PassportVerificationSessionManager.swift`
- `packages/passport-verification/ios/PassportVerificationResultMapper.swift`

Findings:
- Input validator reads `includeImageBase64` and `persistDg2ImageFile`.
- Session manager passes those values into DG2 mapping.
- DG2 mapper emits:
  - top-level `imageBase64`
  - top-level `filePath`
  - parsed metadata including image byte length and image flags

### 4) Jomhoor Adapters/UI
Files:
- `src/pages/app/pages/document-scan/adapters/extractPackageNfcDisplayDetails.ts`
- `src/pages/app/pages/document-scan/adapters/packageNfcResultToEPassport.ts`
- `src/pages/app/pages/document-scan/ScanProvider/index.tsx`
- `src/pages/app/pages/document-scan/components/PassportNfcDetailsStep.tsx`
- `src/pages/app/pages/document-scan/components/FaceComparisonStep.tsx`

Findings:
- `extractPackageNfcDisplayDetails` reads portrait from:
  - `result.portrait.base64/filePath`
  - `files.DG2.base64/filePath`
  - `files.DG2.parsed.imageBase64/filePath`
- ScanProvider preserves `portrait` in `passportNfcDetails` state.
- UI correctly builds URI from either base64 or file path.

Conclusion: adapter/UI layers are structurally correct; they can render portrait if upstream data exists.

## iLand vs Jomhoor Difference

### iLand (working)
Files:
- `iland/src/components/NFCScanner.js`
- `iland/src/utils/passportNfc.js`

iLand calls native `readPassport(...)` directly with:
- `dataGroups: ['COM','SOD','DG1','DG2','DG11','DG12','DG13','DG15','CardAccess']`
- `includeImageBase64: true`
- `persistDg2ImageFile: true`

### Jomhoor
- Has backend switch (`js` default).
- Native path is equivalent when selected.
- JS path does not produce portrait and is still default when env is absent/invalid.

## Exact Stage Where Portrait Is Most Likely Lost
Primary likely loss stage:
- **Stage 0: backend selection** (`resolvePassportNfcBackend`) picking `js` path.

Why:
- Default behavior is `js`.
- JS reader path in `passport-nfc-reader.ts` reads DG1/DG15/SOD only and does not produce DG2 portrait output.
- If app isn’t actually running with `EXPO_PUBLIC_PASSPORT_NFC_BACKEND=native-ios`, portrait will always be missing.

Secondary possibility:
- Native path is selected, but iOS runtime returns DG2 status ok with no `imageBase64/filePath` (document-specific or decode issue). This must be verified with metadata traces below.

## Safe Debug Metadata Added (Dev-Gated)
Enabled only when:
- `EXPO_PUBLIC_PASSPORT_NFC_DEBUG=enabled|true|1`

Added logs (non-sensitive only):
- `src/utils/e-document/passport-nfc-reader.ts`
  - `backend-selection`
  - `native-request` (backend, groups, flag booleans)
  - `native-response` (file keys, DG2 status, DG2 byte length, portrait presence booleans)
  - `native-display-details` (portrait presence booleans)
  - `js-backend-response` (indicates no portrait fields)
- `src/pages/app/pages/document-scan/components/PassportNfcDetailsStep.tsx`
  - `ui-portrait-source` (base64/filePath/none)

No raw DG data, base64 payload, MRZ, document IDs, DOB/expiry, names, or NIDN are logged.

## Minimal Fix Proposal
1. Ensure runtime actually uses native backend during test:
   - `EXPO_PUBLIC_PASSPORT_NFC_BACKEND=native-ios`
2. Use the metadata traces to confirm:
   - native selected
   - DG2 returned
   - `hasDg2ImageBase64Field` or `hasDg2FilePathField` true
   - `hasResultPortraitBase64`/`hasResultPortraitFilePath` true
   - UI portrait source is `base64` or `filePath`
3. If native selected but DG2 image still absent:
   - inspect iOS DG2 decode outcome (image format/bytes) for that passport
   - add a small fallback in JS mapping to consume parsed DG2 path/base64 if top-level fields are null (if metadata shows parsed contains value)

## Files to Change (if fix is needed after trace)
Likely minimal set:
- `src/pages/app/pages/document-scan/adapters/resolvePassportNfcBackend.ts` (only if env resolution issue is found)
- `src/utils/e-document/passport-nfc-reader.ts` (native-path guard/fallback)
- `packages/passport-verification/src/passport/nfc/runtime.ts` (only if key-shape mismatch found)

## Tests to Add
1. Backend selection integration test:
- confirms env `native-ios` actually chooses native path.
2. Portrait presence mapping test:
- DG2 top-level image fields -> `result.portrait` -> UI source selected.
3. JS-backend regression test:
- confirms JS path does not claim portrait availability.

## Real-Device Validation Steps
1. Run with native backend + debug:
```bash
EXPO_PUBLIC_PASSPORT_NFC_BACKEND=native-ios EXPO_PUBLIC_PASSPORT_NFC_DEBUG=enabled yarn ios
```
2. Complete MRZ + NFC scan.
3. Verify logs (non-sensitive):
- `backend-selection` => `native-ios`
- `native-request` => DG2 requested, both flags true
- `native-response` => DG2 present, DG2 status, portrait booleans
- `native-display-details` => portrait booleans
- `ui-portrait-source` => not `none`

If `backend-selection` shows `js`, portrait missing is expected and is the root cause.
