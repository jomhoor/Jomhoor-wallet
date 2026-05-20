# NFC DG2 Portrait Investigation

## Executive Summary

- The most likely regression is **not DG2 request omission**. DG2 is requested in Jomhoor native-package input.
- The likely break is that Jomhoor/package native call path does **not pass portrait-return flags** used in iLand (`includeImageBase64: true`, `persistDg2ImageFile: true`).
- iOS native mapper can read DG2 and produce portrait fields, but only returns usable portrait payload when those flags are enabled.
- Current Jomhoor UI expects portrait in `PassportNfcReadResult.portrait` (or DG2 file-level base64/path). When flags are absent, those fields are typically empty, so UI shows portrait missing.

## Jomhoor NFC Request Path

1. `ScanPassportNfcStep` triggers `readPassportScanOutput(...)`.
2. `readPassportScanOutput` (native backend path) calls `readPassportWithPackageBackendOutput(...)`.
3. `readPassportWithPackageBackendOutput` builds input via `createPackageNfcReadInput(...)` and calls package `readPassportNfc(...)`.
4. `createPackageNfcReadInput` includes DG2 in `requestedDataGroups`.
5. Output is mapped into:
   - `ePassport`
   - `normalized`
   - `portrait` from `extractPackageNfcDisplayDetails`
6. `ScanProvider.setPassportNfcScanOutput(...)` stores `passportNfcDetails.portrait` and routes UI.
7. `PassportNfcDetailsStep` and `FaceComparisonStep` render portrait from `passportNfcDetails.portrait`.

Observed from code:

- DG2 **is requested**: `src/pages/app/pages/document-scan/adapters/mrzToPackageNfcReadInput.ts`
- Portrait is expected at:
  - `result.portrait.base64|filePath`
  - or `result.files.DG2.base64|filePath`

## Package NFC Runtime Path

- `readPassportNfc(...)` native iOS path uses `invokeNativeRead(input)`.
- Native payload builder (`toNativeReadPayload`) currently sends:
  - `credentials`
  - `dataGroups`
- It does **not** send:
  - `includeImageBase64`
  - `persistDg2ImageFile`

Runtime portrait mapping:

- `normalizeReadResult` sets `portrait` from `files.DG2.base64/filePath`.
- `mapNativeFiles` maps these from native file entry top-level `imageBase64` / `filePath`.

If native returns `imageBase64 = NSNull` and `filePath = NSNull`, package portrait becomes empty.

## iOS Native NFC Path

- Native iOS config defaults:
  - `includeImageBase64` default: `false`
  - `persistDg2ImageFile` default: `false`
  - file: `packages/passport-verification/ios/PassportVerificationInputValidator.swift`
- DG2 reader exists and is called when requested.
- DG2 entry contains:
  - `parsed.imageByteLength`, `hasFaceImage`, etc.
  - top-level `imageBase64` only if `includeImageBase64 == true`
  - top-level `filePath` only if `persistDg2ImageFile == true`
  - file: `packages/passport-verification/ios/PassportVerificationResultMapper.swift`

Conclusion:

- DG2 can be read successfully, but portrait may still be unusable in JS/UI if output flags are off.

## Android Native NFC Status

- Android module is still minimal status-only.
- No real passport read / DG2 path implemented yet.
- Portrait issue in this report is primarily iOS native backend.

## iLand Reference Flow

iLand path (working reference):

- `src/components/NFCScanner.js` calls native `readPassport` with:
  - `dataGroups: ['COM','SOD','DG1','DG2','DG11','DG12','DG13','DG15','CardAccess']`
  - `includeImageBase64: true`
  - `persistDg2ImageFile: true`
- iLand UI reads portrait from DG2 using:
  - `dg2.imageBase64` / `dg2.parsed.imageBase64`
  - `dg2.filePath` / `dg2.parsed.filePath`

Migration delta:

- Jomhoor/package preserved DG2 request but dropped those two portrait-output flags in native payload contract.

## DG2/Portrait Diagnosis Table

| Stage                      | Expected DG2/portrait behavior                   | Actual behavior                                 | Evidence/file                                                                                                           | Suspected issue                                                            |
| -------------------------- | ------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Jomhoor input/request      | Request DG2 and request portrait-friendly output | DG2 requested, portrait-output flags not passed | `src/pages/app/pages/document-scan/adapters/mrzToPackageNfcReadInput.ts`, `src/utils/e-document/passport-nfc-reader.ts` | Missing `includeImageBase64` / `persistDg2ImageFile` in package input path |
| Package TS runtime         | Forward all needed native options                | Forwards credentials + `dataGroups` only        | `packages/passport-verification/src/shared/native/passport-native-module.ts`                                            | Payload contract missing portrait flags                                    |
| Native iOS module          | Read DG2 and emit image fields for JS            | DG2 mapper emits image only when flags enabled  | `packages/passport-verification/ios/PassportVerificationResultMapper.swift`                                             | Conditional image emission                                                 |
| Native result defaults     | Reasonable portrait defaults for host UI         | Defaults are both false                         | `packages/passport-verification/ios/PassportVerificationInputValidator.swift`                                           | Portrait disabled unless explicitly requested                              |
| Jomhoor adapter extraction | Keep portrait if available                       | Correctly checks multiple locations             | `src/pages/app/pages/document-scan/adapters/extractPackageNfcDisplayDetails.ts`                                         | Adapter is mostly fine                                                     |
| EPassport mapping          | Keep compatibility + portrait if available       | Uses `result.portrait` or `DG2.imageBase64`     | `src/pages/app/pages/document-scan/adapters/packageNfcResultToEPassport.ts`                                             | Not main loss point                                                        |
| UI rendering               | Render portrait when provided                    | Shows missing portrait when no base64/path      | `src/pages/app/pages/document-scan/components/PassportNfcDetailsStep.tsx`, `FaceComparisonStep.tsx`                     | UI expects populated portrait fields                                       |

## Likely Root Cause

Primary likely root cause:

- **C + D/F combined**: The pipeline requests DG2 but does not request portrait materialization (`includeImageBase64`/`persistDg2ImageFile`), so DG2 metadata can exist while `portrait` remains empty in package/Jomhoor.

Secondary checks (lower probability):

- Key-shape mismatch (`DG2` vs `dg2`) is unlikely; code currently references `DG2` consistently.
- UI field mismatch is unlikely primary cause; UI reads both base64 and filePath correctly if present.

## Recommended Fix

Do not apply broadly in this investigation step; implement next slice as focused fix.

Likely fixes:

1. **A/D (low risk)**: Extend package `PassportNfcReadInput` + native payload to accept and forward:
   - `includeImageBase64?: boolean`
   - `persistDg2ImageFile?: boolean`
2. **E (low risk)**: Set these flags in Jomhoor native path (`createPackageNfcReadInput`) for native backend.
3. **F (low risk)**: Keep current UI extraction logic; only add fallback for any discovered key variant if runtime proves needed.

Files likely to change:

- `packages/passport-verification/src/passport/nfc/types.ts`
- `packages/passport-verification/src/shared/native/passport-native-module.ts`
- `src/pages/app/pages/document-scan/adapters/mrzToPackageNfcReadInput.ts`
- Optional: add safe debug metadata in `src/utils/e-document/passport-nfc-reader.ts`

Risk level:

- Low-to-medium (contract extension across TS + native payload forwarding).

## Tests to Add

1. Adapter unit test: `createPackageNfcReadInput` includes portrait-output flags for native backend path.
2. Runtime unit test: payload builder forwards `includeImageBase64` and `persistDg2ImageFile`.
3. Extraction test: portrait resolves from:
   - `result.portrait.base64`
   - `files.DG2.base64`
   - `files.DG2.filePath`
4. Integration test (mocked native result): `setPassportNfcScanOutput` stores portrait and details.

## Validation Plan

Static checks:

```bash
cd /Users/shooresh/Documents/hello1/jomhoor/mobile-Iranians.vote
npx tsc -p packages/passport-verification/tsconfig.json
yarn type-check
npx eslint src/pages/app/pages/document-scan src/utils/e-document packages/passport-verification/src --max-warnings=0
```

Runtime/device checks (iOS native backend):

```bash
EXPO_PUBLIC_PASSPORT_NFC_BACKEND=native-ios EXPO_PUBLIC_PASSPORT_NFC_DEBUG=enabled yarn ios
```

Verify (without sensitive logs):

- requested DG list includes `DG2`
- returned file keys include `DG2`
- `DG2.status` is `ok`
- `hasPortraitBase64` or `hasPortraitFilePath` true
- `passportNfcDetails.portrait` present
- `PassportNfcDetailsStep` renders image

Note:

- This report is investigation-first; no broad behavior changes applied.
