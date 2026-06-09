# Passport Verification Full Migration Plan

## Executive Summary

This migration should remain incremental and adapter-driven, not a big-bang replacement.

Recommended end-state:

1. Keep Jomhoor as the host application owner of navigation, proof generation, wallet/identity persistence, relayer/backend calls, and final post-verification routing.
2. Move reusable verification capabilities into `packages/passport-verification` with strict domain boundaries:
   - `passport`: MRZ utilities, optional MRZ UI, NFC UI, NFC backends.
   - `face`: liveness, gaze challenge, face comparison, model loading.
   - `identity-flow`: orchestrator + review/confirm + typed aggregate result.
3. Use one Jomhoor wrapper screen for package flow. Package returns typed result. Jomhoor decides what to do next.
4. For risk control, keep current Jomhoor production document scan/proof flow untouched until the new package flow is validated end-to-end.

Practical recommendation based on current code:

- Keep current Jomhoor MRZ UI as initial default and normalize its output to package credentials.
- Use package native iOS NFC backend as the long-term iOS source of truth, with Jomhoor JS backend fallback during rollout.
- Migrate iLand face/liveness/gaze/comparison into package because Jomhoor has no equivalent production flow.
- Do Android native NFC after iOS stabilizes and contract tests are green.

## Current State

Jomhoor package status (`/Users/shooresh/Documents/hello1/jomhoor/mobile-Iranians.vote/packages/passport-verification`):

- Exists and is consumed as local dependency:
  - `"@iland/passport-verification": "file:./packages/passport-verification"`.
- TypeScript package structure exists:
  - `src/passport/*` implemented for MRZ/access-key + NFC contract/runtime.
  - `src/face/index.ts` placeholder.
  - `src/identity-flow/index.ts` placeholder.
  - `src/shared/index.ts` placeholder.
- Native module linking is already proven.
- iOS native passport module and LocalPods are already present in package.
- Android package native module currently exposes minimal status API only.
- Jomhoor `Passport` route currently shows native debug status JSON.
- Existing production flow is still Jomhoor-owned in `document-scan` and remains functional.

Jomhoor app context:

- Expo SDK `52`, React Native `0.76.9`, Yarn `4.5.0`.
- Existing NFC plugin already configures iOS entitlements/select-identifiers including passport AID `A0000002471001`.
- Current `ios/Podfile` already references package LocalPods and includes NFCPassportReader race patch logic.

## Recommended Final Source of Truth by Area

| Area                                    | Recommended source of truth                      | Why                                                                         | Migration policy                                                                                    |
| --------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| MRZ scan UI                             | Hybrid (Jomhoor first, package optional later)   | Jomhoor photo-based MRZ is already integrated and stable with current UX    | Keep Jomhoor MRZ for initial package flow mode; add package MRZ live scanner as optional mode later |
| MRZ parsing                             | Package (`passport` domain)                      | Parser/check-digit/access-key should be reusable and app-agnostic           | Continue converging parsing utilities into package and unit-test with vectors                       |
| MRZ output schema/access-key            | Package contract                                 | Required for consistent NFC input and cross-platform behavior               | Jomhoor MRZ output must be normalized into `PassportCredentials` before NFC                         |
| Barcode scan                            | Package optional feature (from iLand)            | iLand already has implementation patterns                                   | Add after baseline flow works; keep disabled by default                                             |
| NFC UI                                  | Package (adapted from iLand + Jomhoor copy tone) | Package should own reusable NFC step UI and state machine                   | Start with package NFC screen in new flow only; leave production screen untouched                   |
| NFC native backend iOS                  | Package (iLand-derived)                          | Richer DG reading and structured output, already partially moved            | Stabilize as explicit backend selection and make default only after rollout                         |
| NFC native backend Android              | Package (iLand-derived), but phased              | iLand has full native Android module; high risk due deps/session complexity | Keep fallback path until Android native passes device tests                                         |
| NFC result mapping to Jomhoor EPassport | Jomhoor adapter layer                            | Proof pipeline expects Jomhoor `EPassport` model                            | Keep mapping outside package core                                                                   |
| Liveness                                | Package (from iLand)                             | Jomhoor lacks equivalent                                                    | Port to TS + decouple navigation/i18n                                                               |
| Gaze challenge                          | Package (from iLand)                             | Jomhoor lacks equivalent                                                    | Port to TS + normalize result contract                                                              |
| Face comparison                         | Package (from iLand)                             | Jomhoor lacks equivalent and iLand already has model logic                  | Port with lazy model loading and optional dependency checks                                         |
| Review/confirm screen                   | Package UI + host callbacks                      | Reusable screen, but host-specific side effects must stay outside           | Remove iLand wallet/issuer/store calls; emit typed confirmation result                              |
| Final proof/wallet/relayer flow         | Jomhoor only                                     | App-specific business logic and persistence                                 | Package must never directly execute these operations                                                |

## iLand Source Map

Primary reusable sources from `/Users/shooresh/Documents/hello1/iland24/iland`:

Passport MRZ utilities:

- `src/utils/passportMrz.js`
- `src/utils/passportMrzScan.js`

Passport MRZ UI:

- `src/screens/MrzScanScreen.js`
- `src/components/MrzScanner.js`

Passport barcode support:

- `src/hooks/useNidBarcode.js`
- Barcode portions inside `MrzScanner.js`

Passport NFC JS wrapper/UI:

- `src/utils/passportNfc.js`
- `src/screens/NFCInstruction.js`
- `src/screens/NFCScreen.js`
- `src/components/NFCScanner.js`

iOS native NFC:

- `ios/iland/PassportNfcModule.swift`
- `ios/iland/PassportNfcSessionManager.swift`
- `ios/iland/PassportNfcResultMapper.swift`
- `ios/iland/PassportNfcErrorMapper.swift`
- `ios/iland/PassportNfcInputValidator.swift`
- Bridge files in `ios/iland/PassportNfcModuleBridge.*`

iOS LocalPods:

- `ios/LocalPods/NFCPassportReader`
- `ios/LocalPods/OpenSSLLocal`

Android native NFC:

- `android/app/src/main/java/com/shooresh/iland/nativebridge/PassportNfcModule.kt`
- `android/app/src/main/java/com/shooresh/iland/nativebridge/IlandNativeModulesPackage.kt`
- Android dependencies currently used in iLand app gradle:
  - `org.jmrtd:jmrtd`
  - `net.sf.scuba:scuba-sc-android`
  - BouncyCastle provider usage in module

Face/liveness/gaze/comparison/model:

- `src/verification/VerificationFlow.js`
- `src/verification/StepRenderer.js`
- `src/verification/steps/LivenessStep.js`
- `src/verification/steps/GazeChallengeStep.js`
- `src/verification/steps/FaceComparisonStep.js`
- `src/identity/facialRecognition.js`
- `assets/mobilefacenet/model.json`
- `assets/mobilefacenet/model.bin`

Review UI concept:

- `src/verification/steps/ReviewStep.js`

App-specific iLand code that must not move directly:

- iLand navigation assumptions in verification screens.
- iLand `react-intl` label usage.
- iLand identity/wallet credential issuance (`walletManager`, `scanStatusStore`, review side effects).

## Jomhoor Flow Map

Primary Jomhoor flow sources from `/Users/shooresh/Documents/hello1/jomhoor/mobile-Iranians.vote`:

Existing production passport flow:

- `src/pages/app/pages/document-scan/index.tsx`
- `src/pages/app/pages/document-scan/ScanProvider/index.tsx`
- `src/pages/app/pages/document-scan/components/ScanMrzStep.tsx`
- `src/pages/app/pages/document-scan/components/ScanPassportNfcStep.tsx`
- `src/utils/e-document/passport-nfc-reader.ts`
- `src/utils/e-document/e-document.ts`

Current migration debug entry:

- `src/pages/app/pages/passport/index.tsx`
- Home route item points to `Passport` in `src/pages/app/pages/home/index.tsx`

What Jomhoor proof/identity pipeline expects:

- `EPassport` object with DG bytes and `personDetails`.
- Existing registration strategy in `ScanProvider` and `NoirEPassportRegistration` path.

What must remain Jomhoor-owned:

- `ScanProvider` orchestration for existing production flow.
- proof generation + identity creation + relayer/backend registration + persistent identity/wallet storage.
- app route policy and post-success navigation.

## Target Package Architecture

Recommended final package structure:

```txt
packages/passport-verification/
  package.json
  tsconfig.json
  src/
    index.ts
    passport/
      index.ts
      mrz/
      barcode/
      nfc/
      ui/
      types/
      errors/
    face/
      index.ts
      liveness/
      gaze/
      comparison/
      model/
      ui/
      types/
      errors/
    identity-flow/
      index.ts
      flow/
      review/
      ui/
      types/
      errors/
    shared/
      index.ts
      ui/
      theme/
      labels/
      native/
      utils/
  ios/
  android/
  plugins/
  assets/
    mobilefacenet/
  tests/
  docs/
```

Boundary rules:

- `passport` cannot import heavy face/model code.
- `face` is independently usable for non-passport flows.
- `identity-flow` may depend on both `passport` and `face`.

## Public API Design

Root exports:

```ts
export * from '@iland/passport-verification'
export * from '@iland/passport-verification/face'
export * from '@iland/passport-verification/identity-flow'
```

Passport domain:

```ts
import {
  parseMrz,
  buildPassportAccessKey,
  readPassportNfc,
  probePassportChip,
  cancelPassportNfcSession,
  PassportMrzScanScreen,
  PassportNfcScanScreen,
  type PassportCredentials,
  type PassportNfcReadInput,
  type PassportNfcReadResult,
  type PassportNfcError,
  type PassportNfcBackend,
} from '@iland/passport-verification'
```

Face domain:

```ts
import {
  FaceLivenessScreen,
  GazeChallengeScreen,
  FaceComparisonScreen,
  loadFaceModel,
  compareFaces,
  type LivenessResult,
  type GazeChallengeResult,
  type FaceComparisonResult,
} from '@iland/passport-verification/face'
```

Identity-flow domain:

```ts
import {
  PassportIdentityFlow,
  ReviewIdentityScreen,
  type PassportIdentityFlowProps,
  type PassportIdentityVerificationResult,
} from '@iland/passport-verification/identity-flow'
```

Core flow props:

```ts
export type PassportIdentityFlowProps = {
  initialStep?: 'mrz' | 'nfc' | 'liveness' | 'gaze' | 'comparison' | 'review'
  nfcBackend?: 'native-ios' | 'native-android' | 'jomhoor-js' | 'stub'
  mrzMode?: 'host-provided' | 'package-photo' | 'package-live'
  uiAdapter?: VerificationUiAdapter
  theme?: VerificationTheme
  labels?: VerificationLabels
  initialCredentials?: PassportCredentials
  onRequestHostMrz?: () => Promise<PassportCredentials>
  onCancel?: () => void
  onError?: (error: VerificationError) => void
  onComplete: (result: PassportIdentityVerificationResult) => void
}
```

Result returned to Jomhoor:

```ts
export type PassportIdentityVerificationResult = {
  passport: {
    credentials?: PassportCredentials
    mrz?: ParsedMrzResult
    nfc?: PassportNfcReadResult
    normalized?: {
      documentNumber?: string
      firstName?: string
      lastName?: string
      birthDate?: string
      expiryDate?: string
      nationality?: string
      sex?: string
    }
    portrait?: { base64?: string; filePath?: string }
  }
  face?: {
    liveness?: LivenessResult
    gaze?: GazeChallengeResult
    comparison?: FaceComparisonResult
  }
  finalDecision: 'verified' | 'failed' | 'manual_review' | 'cancelled'
  errors?: VerificationError[]
  debug?: { backend?: string; timingsMs?: Record<string, number> }
}
```

## UI/Theme/Labels Strategy

Recommendation:

- Package should not import Jomhoor `@/ui`, `@/theme`, or iLand `react-intl`.
- Package accepts adapter + theme + labels and has fallback defaults.

Adapter contract:

```ts
export type VerificationUiAdapter = {
  Screen: React.ComponentType<{ children: React.ReactNode }>
  Text: React.ComponentType<{ children: React.ReactNode; tone?: 'primary' | 'secondary' | 'error' }>
  Button: React.ComponentType<{
    title: string
    onPress: () => void
    disabled?: boolean
    variant?: 'primary' | 'secondary' | 'danger'
  }>
  Card?: React.ComponentType<{ children: React.ReactNode }>
  Loader?: React.ComponentType<{ label?: string }>
  ErrorView?: React.ComponentType<{ message: string; onRetry?: () => void }>
}

export type VerificationTheme = {
  colors: Record<string, string>
  spacing: Record<string, number>
  radius?: Record<string, number>
}

export type VerificationLabels = Record<string, string>
```

Jomhoor should provide:

- wrappers around `UiButton`, `UiCard`, `UiIcon`, `Text`, `View`.
- translations using `react-i18next`.
- palette values from `useAppTheme()`.

## Native iOS Migration Plan

Current state:

- iOS native NFC implementation is already mostly present in package.
- LocalPods are already in package and Podfile currently references them from node_modules.
- Existing Jomhoor NFC plugin already configures required iOS permissions/entitlements/AIDs.

Remaining iOS actions:

1. Stabilize and lock module naming:
   - JS module name should remain stable (`PassportVerification` or `PassportVerificationModule`), and TS wrapper should hide naming differences.
2. Consolidate API surface in TS wrapper:
   - `readPassportNfc`, `probePassportChip`, `cancelPassportNfcSession`, `getPassportVerificationNativeStatus`.
3. Validate podspec wiring for fresh clone:
   - `PassportVerification.podspec` should fully resolve local source and pod dependencies.
4. Keep NFCPassportReader race patch in Podfile or move patch to package plugin script with clear ownership.
5. Ensure no duplicate entitlement/plugin behavior:
   - Reuse existing Jomhoor plugin unless package plugin adds missing required config only.
6. Harden typed error mapping and no-PII logging.

iOS validation gates:

- `npx pod-install` succeeds from Jomhoor root.
- `yarn ios` builds.
- Real iPhone: start read, cancel, retry, background/foreground, timeout, second immediate retry.
- DG1/SOD mandatory checks and typed error handling validated.

## Native Android Migration Plan

Current state:

- Package Android module is minimal status-only.
- iLand has a full Android native passport module under app namespace with JMRTD/Scuba dependencies.

Migration strategy:

1. Create package-native Android NFC module in package namespace `com.iland.passportverification`.
2. Port iLand module logic in stages:
   - session lifecycle and read command scaffolding.
   - BAC/PACE + DG reads.
   - result mapping to package TS contract.
3. Move required dependencies from iLand app Gradle into package `android/build.gradle`:
   - `org.jmrtd:jmrtd`
   - `net.sf.scuba:scuba-sc-android`
   - bouncycastle if needed by module path.
4. Keep Android backend behind explicit selection flag until stable.
5. Keep Jomhoor JS backend fallback until Android native passes device matrix.

Android validation gates:

- `yarn android` build succeeds with package autolink.
- JS call to package native status and read methods resolves.
- Real passport read on Android works for happy path and error paths.

## Phase-by-Phase Migration Plan

### Phase 0 — Baseline freeze

| Item                | Details                                                                      |
| ------------------- | ---------------------------------------------------------------------------- |
| Goal                | Freeze contracts and current behavior before large migration                 |
| Source files        | Existing package NFC types/runtime, Jomhoor current document-scan flow       |
| Target files        | `packages/passport-verification/src/passport/nfc/*`, docs                    |
| Exact changes       | Lock public TS interfaces; add explicit deprecation notes for unstable names |
| Commands            | `yarn type-check`, `npx tsc -p packages/passport-verification/tsconfig.json` |
| Expected result     | No behavior changes; contracts documented                                    |
| Risk                | Low                                                                          |
| Rollback            | Revert docs/contracts only                                                   |
| Acceptance criteria | Contracts reviewed and versioned                                             |

### Phase 1 — Shared UI foundation in package

| Item                | Details                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Goal                | Introduce adapter/theme/labels primitives and screen shell                                 |
| Source files        | N/A (new foundation)                                                                       |
| Target files        | `src/shared/ui/*`, `src/shared/theme/*`, `src/shared/labels/*`, `src/shared/index.ts`      |
| Exact changes       | Add `VerificationUiAdapter`, `VerificationTheme`, `VerificationLabels`, default primitives |
| Commands            | `npx tsc -p packages/passport-verification/tsconfig.json`                                  |
| Expected result     | Package can render placeholder screens with no host coupling                               |
| Risk                | Low                                                                                        |
| Rollback            | Remove new shared files                                                                    |
| Acceptance criteria | TS build passes and root exports compile                                                   |

### Phase 2 — Identity-flow placeholder state machine

| Item                | Details                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| Goal                | Create package-owned flow orchestration skeleton                                                              |
| Source files        | Conceptual sequence from iLand verification flow                                                              |
| Target files        | `src/identity-flow/flow/*`, `src/identity-flow/ui/*`, `src/identity-flow/types/*`                             |
| Exact changes       | Implement placeholder steps: `mrz -> nfc -> liveness -> gaze -> comparison -> review`; emit mock typed result |
| Commands            | `npx tsc -p packages/passport-verification/tsconfig.json`                                                     |
| Expected result     | Wrapper can mount flow and receive typed callback                                                             |
| Risk                | Low                                                                                                           |
| Rollback            | Keep current debug screen                                                                                     |
| Acceptance criteria | Jomhoor can mount placeholder flow route                                                                      |

### Phase 3 — Jomhoor wrapper route integration

| Item                | Details                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Goal                | Connect `Profile -> Document -> Create digital identity -> Passport` to package wrapper without touching production flow |
| Source files        | Jomhoor `src/pages/app/pages/passport/index.tsx`, `route-types`, home route item                                         |
| Target files        | Same files + optional adapter module in `src/pages/app/pages/passport/*`                                                 |
| Exact changes       | Replace debug-only UI with wrapper that calls package placeholder flow; no proof call yet                                |
| Commands            | `yarn type-check`, `yarn start`                                                                                          |
| Expected result     | Navigation path opens package flow shell and returns mock result                                                         |
| Risk                | Low                                                                                                                      |
| Rollback            | Restore debug screen                                                                                                     |
| Acceptance criteria | Existing `Scan` route remains unchanged and functional                                                                   |

### Phase 4 — MRZ adapter first (keep Jomhoor scanner)

| Item                | Details                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Goal                | Use Jomhoor MRZ as source and normalize into package credentials contract                          |
| Source files        | Jomhoor `ScanMrzStep.tsx`, package passport types                                                  |
| Target files        | `src/pages/app/pages/passport/adapters/*`, package `passport/types/*`                              |
| Exact changes       | Add pure adapter `FieldRecords -> PassportCredentials`; add parity tests vs package MRZ/access-key |
| Commands            | `yarn type-check`, package tests for vectors                                                       |
| Expected result     | Credentials fed to package flow without replacing production MRZ camera                            |
| Risk                | Low                                                                                                |
| Rollback            | Switch to existing MRZ object usage                                                                |
| Acceptance criteria | Adapter output validated on real MRZ samples                                                       |

### Phase 5 — Package NFC UI port (JS/TS)

| Item                | Details                                                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| Goal                | Port iLand NFC instruction/scan UI into package with adapter-based styling           |
| Source files        | iLand `NFCInstruction.js`, `NFCScreen.js`, `NFCScanner.js`                           |
| Target files        | `src/passport/ui/*`, `src/passport/nfc/*`                                            |
| Exact changes       | Convert to TS, remove navigation/store coupling, expose callbacks and typed statuses |
| Commands            | package type-check + Jomhoor type-check                                              |
| Expected result     | Package NFC step works in wrapper route                                              |
| Risk                | Medium                                                                               |
| Rollback            | Keep Jomhoor NFC step only                                                           |
| Acceptance criteria | Package NFC UI can run with backend selector and controlled retries                  |

### Phase 6 — iOS native NFC hardening in package

| Item                | Details                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Goal                | Complete iOS native backend reliability and mapping                                          |
| Source files        | Existing package iOS native files, iLand references                                          |
| Target files        | `packages/passport-verification/ios/*`, TS mappers                                           |
| Exact changes       | Stabilize method names, ensure error mapping, confirm Pod integration and plugin consistency |
| Commands            | `npx pod-install`, `yarn ios`                                                                |
| Expected result     | Native iOS backend stable behind explicit flag                                               |
| Risk                | Medium                                                                                       |
| Rollback            | Use `jomhoor-js` backend in wrapper                                                          |
| Acceptance criteria | Real iPhone read/cancel/retry/background tests pass                                          |

### Phase 7 — Android native NFC migration

| Item                | Details                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------- |
| Goal                | Port full iLand Android native backend into package                                     |
| Source files        | iLand `PassportNfcModule.kt` + gradle deps                                              |
| Target files        | `packages/passport-verification/android/src/main/java/com/iland/passportverification/*` |
| Exact changes       | Namespace migration, dependency setup, result mapper parity with iOS contract           |
| Commands            | `yarn android`, Gradle build checks                                                     |
| Expected result     | `native-android` backend operational                                                    |
| Risk                | High                                                                                    |
| Rollback            | Keep `jomhoor-js` fallback for Android                                                  |
| Acceptance criteria | Real Android passport read with typed errors and retry behavior                         |

### Phase 8 — Face domain migration (liveness + gaze)

| Item                | Details                                                                      |
| ------------------- | ---------------------------------------------------------------------------- |
| Goal                | Port iLand liveness and gaze steps into package TS                           |
| Source files        | `LivenessStep.js`, `GazeChallengeStep.js`, `VerificationFlow.js` fragments   |
| Target files        | `src/face/liveness/*`, `src/face/gaze/*`, `src/face/types/*`                 |
| Exact changes       | Decouple navigation/i18n, remove console-heavy logs, emit typed step results |
| Commands            | package type-check and runtime smoke in wrapper                              |
| Expected result     | Liveness + gaze steps integrated in package flow                             |
| Risk                | Medium                                                                       |
| Rollback            | Disable face phases in flow config                                           |
| Acceptance criteria | Deterministic step transitions and cancel behavior                           |

### Phase 9 — Face comparison + model loading migration

| Item                | Details                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| Goal                | Port MobileFaceNet pipeline and comparison UI                          |
| Source files        | `FaceComparisonStep.js`, `identity/facialRecognition.js`, model assets |
| Target files        | `src/face/comparison/*`, `src/face/model/*`, `assets/mobilefacenet/*`  |
| Exact changes       | TS conversion, lazy model loading, dependency guards, no PII logging   |
| Commands            | package type-check, device runtime checks                              |
| Expected result     | Face comparison step returns typed score/decision                      |
| Risk                | High                                                                   |
| Rollback            | Bypass comparison step with feature flag                               |
| Acceptance criteria | Model loads reliably and mismatch/hard-fail states handled             |

### Phase 10 — Review screen and final typed result

| Item                | Details                                                          |
| ------------------- | ---------------------------------------------------------------- |
| Goal                | Add package review/confirm step without host side effects        |
| Source files        | iLand `ReviewStep.js` concept only                               |
| Target files        | `src/identity-flow/review/*`                                     |
| Exact changes       | Remove wallet/store/issuer calls; emit `onComplete` payload only |
| Commands            | type-check + wrapper integration checks                          |
| Expected result     | Package flow can complete and return final typed result          |
| Risk                | Medium                                                           |
| Rollback            | Keep host-side review screen                                     |
| Acceptance criteria | No host-specific imports in package                              |

### Phase 11 — Jomhoor result adapter to proof pipeline

| Item                | Details                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------- |
| Goal                | Map package result into existing Jomhoor identity/proof flow                            |
| Source files        | Jomhoor `EPassport`, `ScanProvider`, registration strategies                            |
| Target files        | Jomhoor wrapper adapter module only                                                     |
| Exact changes       | Convert result to `EPassport` inputs; trigger existing pipeline on explicit user action |
| Commands            | `yarn type-check`, end-to-end manual flow                                               |
| Expected result     | New package route can feed existing proof/wallet flow                                   |
| Risk                | Medium                                                                                  |
| Rollback            | Keep route returning result without proof trigger                                       |
| Acceptance criteria | No regression in existing production route                                              |

## Jomhoor Integration Plan

Integration shape:

1. Keep existing `Scan` route unchanged for production continuity.
2. Convert `Passport` route into package wrapper route.
3. Wrapper responsibilities:
   - provide `uiAdapter/theme/labels`.
   - select NFC backend from env/feature flag.
   - map package result to Jomhoor pipeline only when enabled.
4. Suggested backend flag behavior:
   - default: `jomhoor-js` for rollout safety.
   - opt-in iOS native: `native-ios`.
   - opt-in Android native later: `native-android`.

## Testing and Validation Plan

Package tests:

- MRZ parser vectors and check-digit tests.
- Access-key derivation vectors.
- Jomhoor MRZ -> `PassportCredentials` adapter tests.
- NFC native result/error mapping tests.
- Identity-flow state machine transition tests.
- Face step deterministic behavior tests with mocks.
- Model loading and fallback tests.

Jomhoor integration tests:

- Package import resolution from app runtime.
- Wrapper screen mounts and receives flow callbacks.
- No regressions in existing document-scan route.
- Mapping from package result to `EPassport` pipeline contract.

Build/device validation:

- `npx tsc -p packages/passport-verification/tsconfig.json`
- `yarn type-check`
- `npx pod-install`
- `yarn ios`
- `yarn android`

Real device scenarios:

- iOS passport read success path.
- Android passport read success path.
- NFC permission denied.
- NFC unavailable.
- user cancel mid-session.
- immediate retry after failure.
- app background during NFC session.
- no DG2 portrait.
- face mismatch.
- model load failure.

## Safety and Privacy Rules

Mandatory rules:

1. Do not log passport number, MRZ lines, DG raw payloads, portrait base64, or PII-heavy fields in production logs.
2. Package does not permanently store passport or face data by default.
3. Package does not call proof generation, wallet registration, relayer, or backend directly.
4. Host app (Jomhoor) controls data persistence and deletion policy.
5. Keep sensitive buffers in memory only as long as needed and clear references after step completion.
6. Review all debug logs imported from iLand and remove or gate by strict dev flags.

## Risks and Rollback Plan

Top risks:

- iOS pod/linking fragility around LocalPods and post-install patching.
- Android native migration complexity (JMRTD stack + session lifecycle).
- Face dependency churn and performance regressions on low-end devices.
- Contract drift between package NFC result and Jomhoor `EPassport` expectations.
- UI coupling if package imports host internals.

Rollback strategy:

1. Keep existing Jomhoor `Scan` route untouched until new route is certified.
2. Feature-flag backend selection and flow activation.
3. Roll back by routing users back to existing `Scan` route.
4. Keep adapter boundaries narrow so package changes are isolated from proof pipeline.

## Recommended Next Coding Slice

Safest next slice:

1. Add shared package UI foundation only:
   - `VerificationUiAdapter`
   - `VerificationTheme`
   - `VerificationLabels`
2. Add `PassportIdentityFlow` placeholder state machine and placeholder screens for:
   - MRZ
   - NFC
   - liveness
   - gaze
   - face comparison
   - review
3. Mount that placeholder flow from the existing Jomhoor `Passport` route wrapper.
4. Return a mock typed result to Jomhoor callback and show it in UI.
5. Do not port VisionCamera screens, native NFC behavior changes, or face model assets in this slice.

This gives a low-risk structural milestone and verifies the end integration seam before moving heavy runtime code.
