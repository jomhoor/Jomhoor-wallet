# Passport Package Dependency Audit

## Executive Summary

- The current local package `@iland/passport-verification` is mostly dependency-light on the JS side (`react`, `react-native` only), but its iOS native NFC module depends on `NFCPassportReader` + `OpenSSLLocal` and `CoreNFC`.
- Phase 7 liveness integration in Jomhoor currently depends on `react-native-vision-camera-face-detector` (already present in Jomhoor dependencies), plus existing `react-native-vision-camera`, `react-native-worklets-core`, and `react-native-reanimated`.
- iLand face comparison code is significantly heavier than current Jomhoor: TensorFlow + model assets + `expo-image-manipulator` + `jpeg-js` + `buffer`.
- Android native passport stack from iLand (`jmrtd`, `scuba`, `bouncycastle` usage) is not migrated into the local package yet; Jomhoor already has BouncyCastle exclusion rules, so Android native migration will need conflict planning.
- Import path issue note: Jomhoor currently resolves cleanly with root import `@iland/passport-verification`. Subpath imports can be fragile if `dist` is stale or missing.

## Current Dependency State

- **Jomhoor root** owns runtime dependencies for app screens and native modules.
- **Local package JS** currently imports:
  - `react`
  - `react-native`
- **Local package iOS native** imports:
  - `CoreNFC`
  - `Foundation`
  - `NFCPassportReader`
  - plus podspec dependency on `OpenSSLLocal`
- **Local package Android native** currently minimal:
  - `com.facebook.react:react-android`
  - status method only (no JMRTD/Scuba NFC read implementation yet)

## iLand Import/Dependency Scan

Scope scanned for planned migration areas:

- MRZ: `src/utils/passportMrz.js`, `src/utils/passportMrzScan.js`, `src/components/MrzScanner.js`, `src/screens/MrzScanScreen.js`
- NFC: `src/utils/passportNfc.js`, `src/components/NFCScanner.js`, `src/screens/NFCScreen.js`, `src/screens/NFCInstruction.js`
- Face/Liveness/Gaze/Comparison: `src/verification/*`, `src/identity/facialRecognition.js`, `src/screens/FaceScanScreen.js`, `src/screens/FaceComparisonScreen.js`
- Review: `src/verification/steps/ReviewStep.js`, `src/screens/ReviewInformation.js`, `src/screens/reviewInformationConfirmFlow.js`
- Native iOS: `ios/iland/PassportNfc*.swift`, Podfile, entitlements
- Native Android: `android/app/src/main/java/com/shooresh/iland/nativebridge/PassportNfcModule.kt`, `android/app/build.gradle`

External packages imported in this scope:

- `@react-navigation/core`, `@react-navigation/native`
- `@tensorflow/tfjs`, `@tensorflow/tfjs-react-native`
- `buffer`, `jpeg-js`
- `expo-file-system`, `expo-image-manipulator`
- `react`, `react-native`, `react-intl`
- `react-native-reanimated`
- `react-native-vision-camera`
- `react-native-vision-camera-face-detector`
- `react-native-vision-camera-text-recognition`
- `react-native-worklets-core`

iLand app-coupled imports that should **not** be moved directly into package runtime surfaces:

- `react-intl`
- identity/wallet/store/service couplings (`walletManager`, `scanStatusStore`, `scanItems`, `votingGateway`, app `userInfo` storage)
- direct navigation route assumptions
- iLand-specific screen style/system hooks

## Local Package Import/Dependency Scan

JS/TS imports in `packages/passport-verification/src`:

- External: `react`, `react-native`
- Internal only otherwise

Native imports:

- iOS Swift files (`ios/PassportVerification*.swift`): `CoreNFC`, `Foundation`, `NFCPassportReader`
- Podspec (`PassportVerification.podspec`) dependencies:
  - `React-Core`
  - `OpenSSLLocal`
  - `NFCPassportReader`
- Android module (`android/src/main/java/com/iland/passportverification/PassportVerificationModule.kt`): React bridge only

Current local package capability vs dependency pressure:

- MRZ/access-key/types/errors: pure TS
- Placeholder identity/face types and flow: React + RN only
- Phase 7 reusable liveness logic in package: pure TS logic (no direct VisionCamera dependency in package logic file)
- Real camera liveness UI currently lives in Jomhoor `FaceLivenessStep.tsx`

## Jomhoor Dependency Comparison

Already installed in Jomhoor root and relevant to migration:

- `react-native-vision-camera@4.6.3`
- `react-native-vision-camera-text-recognition@^3.1.1`
- `react-native-worklets-core@1.6.3`
- `react-native-reanimated@3.16.7`
- `react-native-nfc-manager@^3.16.2`
- `expo-file-system@~18.0.4`
- `mrz@^4.2.0`
- `@li0ard/tsemrtd`, `@lukachi/rn-csca` (existing JS e-document path)
- `@iland/passport-verification` local dependency

Now present in Jomhoor and required by current Phase 7 code:

- `react-native-vision-camera-face-detector@~1.10.2`

Missing in Jomhoor for full iLand face-comparison parity (future phases):

- `@tensorflow/tfjs`
- `@tensorflow/tfjs-react-native`
- `@tensorflow/tfjs-backend-cpu` (and potentially other TF backends depending on implementation)
- `expo-image-manipulator`
- `jpeg-js`
- (Buffer polyfill handling must be verified for Metro/runtime usage path)

## Version Comparison Table

| Dependency                                    |      iLand |                        Jomhoor |         Local package | Status                                 | Notes                                                            |
| --------------------------------------------- | ---------: | -----------------------------: | --------------------: | -------------------------------------- | ---------------------------------------------------------------- |
| `expo`                                        |  `~50.0.6` |                      `~52.0.0` |                   n/a | Risky mismatch                         | iLand UI/runtime code must be adapted, not copied blindly.       |
| `react`                                       |   `18.2.0` |                       `18.3.1` |     peer-not-declared | Compatible-ish                         | Declare as package peer dependency.                              |
| `react-native`                                |  `^0.73.5` |                       `0.76.9` |     peer-not-declared | Risky mismatch                         | Native/module APIs changed across versions; adapt code.          |
| `react-native-vision-camera`                  |    `4.6.3` |                        `4.6.3` |                   n/a | Compatible                             | Good alignment.                                                  |
| `react-native-vision-camera-face-detector`    |  `~1.10.2` |                      `~1.10.2` |                   n/a | Compatible                             | Required for Phase 7 liveness UI.                                |
| `react-native-vision-camera-text-recognition` |    `3.1.1` |                       `^3.1.1` |                   n/a | Compatible                             | Used by MRZ scanner path.                                        |
| `react-native-worklets-core`                  |    `1.3.3` |                        `1.6.3` |                   n/a | Usually compatible                     | Confirmed builds in Jomhoor; test runtime behavior.              |
| `react-native-reanimated`                     |   `~3.6.2` |                       `3.16.7` |                   n/a | Usually compatible                     | Re-check any iLand animation helpers during migration.           |
| `react-native-nfc-manager`                    | `^3.14.11` |                      `^3.16.2` |                   n/a | Compatible                             | Jomhoor has newer version.                                       |
| `@tensorflow/tfjs`                            |   `4.17.0` |                        missing |                   n/a | Missing                                | Needed only when porting iLand face comparison stack.            |
| `@tensorflow/tfjs-react-native`               |    `1.0.0` |                        missing |                   n/a | Missing                                | Future face-comparison phase only.                               |
| `expo-image-manipulator`                      |  `~11.8.0` |                        missing |                   n/a | Missing                                | Needed by current iLand `facialRecognition.js` approach.         |
| `expo-file-system`                            |  `^16.0.6` |                      `~18.0.4` |                   n/a | Compatible                             | Present, newer in Jomhoor.                                       |
| `react-intl`                                  |   `^6.5.5` | missing (uses `react-i18next`) |                   n/a | Do not migrate                         | Must remain host-label/adapters, not package runtime dependency. |
| `org.jmrtd:jmrtd` (Android)                   |   `0.7.42` |              not in app gradle | not in package gradle | Not implemented in package Android yet | Needed for Android native passport backend migration.            |
| `net.sf.scuba:scuba-sc-android`               |   `0.0.26` |              not in app gradle | not in package gradle | Not implemented in package Android yet | Needed for Android native passport backend migration.            |

## Native Dependency Notes

### iOS

- iLand and local package both use:
  - `NFCPassportReader` local pod
  - `OpenSSLLocal` local pod
  - `CoreNFC`
- Jomhoor Podfile currently references local package pod paths under `node_modules/@iland/passport-verification/ios/LocalPods/*`.
- Jomhoor already includes NFC plugin/config entries for:
  - `NFCReaderUsageDescription`
  - NFC entitlements
  - ISO7816 identifiers including `A0000002471001`
- `pod install` + iOS rebuild required whenever these pod/native files change.

### Android

- iLand Android native passport module imports:
  - `org.jmrtd.*`
  - `net.sf.scuba.*`
  - `org.bouncycastle.*`
- iLand app gradle explicitly includes:
  - `implementation("org.jmrtd:jmrtd:0.7.42")`
  - `implementation("net.sf.scuba:scuba-sc-android:0.0.26")`
- Jomhoor currently has BouncyCastle excludes in `android/app/build.gradle` to avoid duplicate classes with existing NFC/e-document libs.
- Local package Android module currently does **not** implement real passport read; adding Android native NFC later will require Gradle dependency conflict handling and device validation.

## Dependency Ownership Rules

- **Jomhoor root dependencies** should own all runtime libs needed by app-integrated screens/components/native modules (VisionCamera, face-detector, NFC manager, etc.).
- **Local package peerDependencies** should express host requirements for UI-capable exports (`react`, `react-native`; later optional peers for camera/gesture/reanimated if package starts rendering those screens directly).
- **Local package devDependencies** should remain build/test-only.
- **Do not put host app services in package dependencies**:
  - no Jomhoor stores, relayer, wallet/proof modules
  - no iLand `react-intl` or iLand service modules

## Phase 7 Install Recommendation

### Install now (Phase 7 scope)

- `react-native-vision-camera-face-detector@~1.10.2`
  - Location: **Jomhoor root dependencies**
  - Reason: current `FaceLivenessStep.tsx` runtime dependency
  - Native actions: `pod install`, iOS rebuild, Android rebuild

### Keep as-is (already present and sufficient)

- `react-native-vision-camera@4.6.3`
- `react-native-worklets-core@1.6.3`
- `react-native-reanimated@3.16.7`
- `react-native-vision-camera-text-recognition@^3.1.1`

### Do **not** install yet (Phase 8+)

- TensorFlow stack (`@tensorflow/tfjs*`), `expo-image-manipulator`, `jpeg-js`
  - Only required when replacing placeholder face comparison with iLand model pipeline.

### Import path recommendation (Phase 7 stability)

- Use root import path in app code: `@iland/passport-verification`
- Avoid subpath imports until package export strategy is hardened for Metro + local file package workflow.

## Proposed package.json Changes

No changes applied in this audit (report-only). Recommended next edits:

### `packages/passport-verification/package.json`

- Add peer dependencies:
  - `react` (e.g. `>=18`)
  - `react-native` (e.g. `>=0.76`)
- Optionally add future optional peers (when package exports real camera UI directly):
  - `react-native-vision-camera`
  - `react-native-vision-camera-face-detector`
  - `react-native-reanimated`
  - `react-native-worklets-core`
  - `react-native-gesture-handler`
  - `react-native-safe-area-context`
- Consider adding `react-native` condition in subpath `exports` to reduce Metro subpath resolution risk.

### Jomhoor root `package.json`

- Keep `react-native-vision-camera-face-detector@~1.10.2` in `dependencies`.
- Do not add TensorFlow stack yet.

## Validation Commands

Run after dependency changes:

```bash
cd /Users/shooresh/Documents/hello1/jomhoor/mobile-Iranians.vote

yarn install
npx tsc -p packages/passport-verification/tsconfig.json
yarn type-check
npx eslint src/pages/app/pages/document-scan packages/passport-verification/src --max-warnings=0
yarn test src/pages/app/pages/document-scan --runInBand

# iOS native dependency refresh
npx pod-install

# Runtime/native builds (device/emulator required)
yarn ios
yarn android
```
