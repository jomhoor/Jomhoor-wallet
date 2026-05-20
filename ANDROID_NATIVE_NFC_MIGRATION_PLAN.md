# Android Native NFC Migration Plan (Phase 14)

## Current Android Status

- Jomhoor production `document-scan` flow is orchestrated in app code and already supports backend selection.
- Default NFC backend is still JS (`EXPO_PUBLIC_PASSPORT_NFC_BACKEND` unset/unknown -> `js`).
- Package native Android module exists but is status-only:
  - `packages/passport-verification/android/src/main/java/com/iland/passportverification/PassportVerificationModule.kt`
  - currently exposes only `getPassportVerificationNativeStatus`.
- Package TS runtime explicitly returns `NOT_IMPLEMENTED` for `native-android` in:
  - `packages/passport-verification/src/passport/nfc/runtime.ts`.

## iLand Source Map (Android NFC)

Primary implementation source:

- `iland/android/app/src/main/java/com/shooresh/iland/nativebridge/PassportNfcModule.kt`

Related iLand wiring:

- `iland/android/app/src/main/java/com/shooresh/iland/nativebridge/IlandNativeModulesPackage.kt`
- `iland/android/app/src/main/java/com/shooresh/iland/MainApplication.kt`
- `iland/android/app/build.gradle`
- `iland/android/app/src/main/AndroidManifest.xml`

What exists in iLand module:

- ReaderMode-based NFC session handling (`NfcAdapter.enableReaderMode` + `IsoDep`).
- MRZ key parsing + BAC key construction + input validation.
- PACE/BAC auth flow with fallback.
- DG reads: `COM`, `SOD`, `DG1`, `DG2`, `DG11`, `DG12`, `DG13`, `DG15`, `CardAccess`.
- DG2 portrait extraction (`imageBase64` and cache `filePath` when flags enabled).
- Session timeout, cancellation (`disconnect`), cleanup, and structured error codes.
- Rich result payload with `files`, `accessControl`, `finalStatus`, `metadata`.

## Dependency Comparison

| Area                | iLand Android app                                   | Jomhoor Android app                                                     | Package android module (current) | Action                                                                     |
| ------------------- | --------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------- |
| JMRTD               | `org.jmrtd:jmrtd:0.7.42`                            | `org.jmrtd:jmrtd:0.7.42`                                                | none                             | Add to package module to keep ownership local                              |
| Scuba               | `net.sf.scuba:scuba-sc-android:0.0.26`              | none                                                                    | none                             | Add to package module                                                      |
| BouncyCastle        | used via `BouncyCastleProvider` import (transitive) | app currently excludes `bcprov-jdk15to18` + `bcutil-jdk15to18` globally | none                             | Resolve via package-level explicit bc provider version and conflict policy |
| Android NFC APIs    | yes (`NfcAdapter`, `IsoDep`)                        | app has NFC permission/feature                                          | none                             | Add native implementation in package                                       |
| React Native bridge | custom package in app                               | autolinked packages in app                                              | minimal package class exists     | keep autolink, expand module methods                                       |

## Native Dependency Notes

- **Must add in package Android library**:
  - `implementation("org.jmrtd:jmrtd:0.7.42")`
  - `implementation("net.sf.scuba:scuba-sc-android:0.0.26")`
- **BouncyCastle risk**:
  - Jomhoor app currently excludes bc modules globally in `android/app/build.gradle`.
  - Android native module uses `org.bouncycastle.jce.provider.BouncyCastleProvider` directly.
  - This can break runtime or compile if provider classes are absent.
- **Recommended approach**:
  - Keep package self-contained: declare explicit BC dependency in package module and align exclusion strategy at app level only if duplicate-class errors appear.
  - Validate with full `./gradlew :app:assembleDebug` and on-device NFC run.

## Files to Copy/Change

### 1) Package Android native implementation

- Replace/minimally port logic from iLand module into package namespace:
  - From: `com.shooresh.iland.nativebridge.PassportNfcModule`
  - To: `com.iland.passportverification.PassportVerificationModule`
- Target files:
  - `packages/passport-verification/android/src/main/java/com/iland/passportverification/PassportVerificationModule.kt`
  - `packages/passport-verification/android/src/main/java/com/iland/passportverification/PassportVerificationPackage.kt` (likely unchanged except module name consistency)

### 2) Package Android Gradle

- Update:
  - `packages/passport-verification/android/build.gradle`
- Add dependencies (JMRTD + Scuba + BC strategy).
- Keep Java/Kotlin compatibility with app (currently Java 17 / Kotlin 1.9.25 compatible).

### 3) Package Android Manifest

- Update library manifest if needed:
  - `packages/passport-verification/android/src/main/AndroidManifest.xml`
- Keep minimal; app already declares NFC permission/feature. Do not force duplicate declarations unless required.

### 4) TS bridge + runtime

- Ensure native methods are callable with existing shared bridge:
  - `packages/passport-verification/src/shared/native/passport-native-module.ts`
- Ensure Android path is implemented in runtime (remove current `NOT_IMPLEMENTED` branch):
  - `packages/passport-verification/src/passport/nfc/runtime.ts`

### 5) Jomhoor app config

- Keep backend opt-in only (already exists):
  - `src/pages/app/pages/document-scan/adapters/resolvePassportNfcBackend.ts`
- Keep JS fallback untouched.

## Namespace / Renaming Plan

- Package/module name in RN bridge: keep `PassportVerification`/`PassportVerificationModule` for parity with existing package.
- Kotlin package namespace: keep `com.iland.passportverification`.
- Replace iLand-specific constants/log tags as needed:
  - `PassportNfcModule` -> `PassportVerificationModule`
  - avoid app-name-specific identifiers in logs/messages.

## Gradle / Manifest Changes

### Package module (`packages/passport-verification/android/build.gradle`)

- Add:
  - `implementation 'org.jmrtd:jmrtd:0.7.42'`
  - `implementation 'net.sf.scuba:scuba-sc-android:0.0.26'`
- Add BC compatibility strategy if needed after first build attempt:
  - either explicit `org.bouncycastle:bcprov-...` dependency
  - or remove/adjust app-level global excludes that currently target BC artifacts.

### Jomhoor app (`android/app/build.gradle`)

- Current global BC excludes may conflict with native provider usage.
- Plan:
  1. Try build with package changes only.
  2. If BC class missing/duplicate, apply smallest scoped fix in app gradle.
  3. Document final resolved BC policy in package docs.

### Manifest

- App already has:
  - `android.permission.NFC`
  - `uses-feature android.hardware.nfc` (currently `required=true` in Jomhoor)
- No immediate manifest expansion needed for module migration.

## TS/Native Bridge Changes

- Native methods to support on Android module:
  - `readPassport(input)`
  - `disconnect()` and/or `cancelSession()`
  - optional `probePassportChip(input)` parity (recommended).
- JS bridge already expects:
  - `readPassport`
  - `probePassportChip` (optional)
  - `cancelSession` or fallback to `disconnect`
- Keep payload shape parity with iOS mapper expectations:
  - `files` entries with `status`, `parsed`, optional `imageBase64`, optional `filePath`, `reason`.
  - `accessControl`, `finalStatus`, and errors with stable `code` strings.

## Result / Error Mapping Plan

### Result parity target

- Ensure Android returns shape consumable by existing TS normalizer in `runtime.ts`:
  - `files.DG1.parsed.*`
  - `files.DG2.imageBase64` and/or `files.DG2.filePath`
  - `files.DG2.parsed.imageByteLength`
  - `finalStatus`: `success | partial_success | error`

### Error code parity target

Map Android native errors to current package codes:

- `INVALID_INPUT` -> `INVALID_INPUT`
- `NFC_SESSION_BUSY` -> `NFC_SESSION_BUSY`
- `USER_CANCELED` -> `NFC_SESSION_CANCELED`
- `NFC_TIMEOUT` -> `NFC_TIMEOUT`
- `INVALID_CREDENTIALS`/`BAC_FAILED` -> `BAC_AUTH_FAILED`
- `PACE_FAILED`/`PACE_UNSUPPORTED` -> `PACE_FAILED`
- `NO_DATA_READ` -> `NO_DATA_READ`
- unknown/native transport errors -> `UNKNOWN_NATIVE_ERROR`

## Tests to Add

### Package unit tests (TS)

- `packages/passport-verification/src/passport/nfc/__tests__/runtime.native-android.test.ts`
  - verify Android `backend='native-android'` path no longer returns `NOT_IMPLEMENTED`.
  - verify code mapping for Android-native error codes.

### Jomhoor adapter tests

- existing adapter tests should include Android-native-shaped payload fixtures:
  - `packageNfcResultToEPassport`
  - portrait extraction fallback chain (`result.portrait` / `files.DG2.base64` / `files.DG2.filePath`).

### Build validation

- Android compile checks:
  - `./gradlew :app:assembleDebug`
  - `./gradlew :app:lintDebug` (if used)

## Real Android Device Validation Steps

1. Build/install debug app with backend default (`js`) and confirm unchanged behavior.
2. Set backend flag:
   - `EXPO_PUBLIC_PASSPORT_NFC_BACKEND=native-android`
3. Run document-scan flow on real NFC Android phone + real passport.
4. Validate:
   - session starts and tag detected
   - auth succeeds (PACE or BAC)
   - DG list includes `DG1/DG2/SOD` at minimum
   - portrait returned (`base64` or `filePath`)
   - cancel/retry works without stuck session
   - fallback to JS still works when flag changed back.

## Risks

- **BC dependency conflicts** with existing global excludes.
- ReaderMode behavior differences across OEMs (session invalidation/tag lost frequency).
- DG2 formats (JPEG2000/WSQ) may be unsupported for display without conversion.
- Package autolink works, but Android module method name/signature mismatch could fail at runtime.

## Rollback Plan

- Keep default backend `js` unchanged.
- Gate Android native exclusively by env flag (`native-android`).
- If native Android fails in QA/device tests:
  - keep code merged but flag off in all environments, or
  - temporarily revert runtime branch for `native-android` to `NOT_IMPLEMENTED` while retaining source code in package.

## Recommended Execution Order (Phase 14 Implementation)

1. Port Kotlin module from iLand into package namespace with minimal behavior changes.
2. Add package-level Gradle deps (JMRTD/Scuba + BC strategy).
3. Implement runtime Android branch in `runtime.ts`.
4. Run local Android build and resolve dependency conflicts.
5. Add/adjust TS mapping tests.
6. Real-device validation with `native-android` flag.
7. Keep JS default; ship behind opt-in until stable.
