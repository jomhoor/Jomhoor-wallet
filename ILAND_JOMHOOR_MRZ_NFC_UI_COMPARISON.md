# iLand vs Jomhoor MRZ/NFC/Verification UI Comparison

## Executive Summary

- Current local package status in Jomhoor is good for incremental migration: pure passport TS utilities are in place, local dependency works, and minimal native linkage is already proven.
- iLand has richer reusable verification UI assets (MRZ/NFC/face/liveness/gaze/comparison/review), but many screens are tightly coupled to iLand navigation, `react-intl`, and iLand identity/wallet service calls.
- Jomhoor already has a production passport pipeline (`ScanProvider` -> MRZ -> NFC -> preview -> proof). This must remain stable while package UI migration is validated.
- Lowest-risk next direction: add package UI foundations first (adapter/theme/labels + placeholder state machine + wrapper screen), then port MRZ UI, then NFC UI, then face flow.
- Recommended integration shape for the new flow: one Jomhoor wrapper screen that mounts one package flow component and receives typed results; Jomhoor keeps ownership of proof/wallet/storage/backend and navigation policy.

## Current Package Status

Package path:

- `/Users/shooresh/Documents/hello1/jomhoor/mobile-Iranians.vote/packages/passport-verification/`

What exists now:

- Domain skeleton:
  - `src/passport/*`
  - `src/face/index.ts` (placeholder)
  - `src/identity-flow/index.ts` (placeholder)
  - `src/shared/index.ts` (placeholder)
- MRZ/access-key pure TS is implemented.
- NFC runtime contract/types are implemented in package (`src/passport/nfc/*`).
- Minimal + iOS native module wiring is present under `ios/` and local pods are present.
- Exports currently from root/passport/native; package builds to `dist`.

Current exports snapshot:

- Root `src/index.ts`: `passport`, `face`, `identity-flow`, `shared`.
- `src/passport/index.ts`: `mrz`, `access-key`, `types`, `errors`, `nfc`.
- Package metadata in `package.json` includes:
  - name `@iland/passport-verification`
  - `main: dist/index.js`, `types: dist/index.d.ts`
  - exports for `.`, `./passport`, `./native`

What should be preserved:

- Local package location under Jomhoor repo.
- Jomhoor-owned production orchestration (`ScanProvider`, proof pipeline, identity storage, relayer flow).
- Provider/backend separation in NFC adapter.

## iLand MRZ Flow

Primary iLand MRZ files:

- `src/screens/MrzScanScreen.js`
- `src/components/MrzScanner.js`
- `src/utils/passportMrz.js`
- `src/utils/passportMrzScan.js`

Key characteristics:

- Live camera scan (not photo capture) using VisionCamera.
- Combined detection model:
  - Barcode scan in upper safe area (`useCodeScanner`)
  - MRZ OCR in lower safe area (`useTextRecognition` frame processor + Worklets)
- Finalizes only after both barcode + MRZ are detected (in current iLand scanner lifecycle).
- Includes camera release barriers before navigation handoff.
- Has robust MRZ utilities for TD1/TD2/TD3 parsing, check digits, and access key generation.
- Strong coupling in screen layer:
  - `react-intl`
  - iLand navigation route names
  - iLand `userInfo` persistence helpers

## Jomhoor MRZ Flow

Primary Jomhoor MRZ files:

- `src/pages/app/pages/document-scan/components/ScanMrzStep.tsx`
- `src/pages/app/pages/document-scan/ScanProvider/index.tsx`

Key characteristics:

- Photo-based MRZ flow:
  - capture photo with VisionCamera
  - run OCR with `PhotoRecognizer` from `react-native-vision-camera-text-recognition`
- Heavy in-step resilience:
  - custom sanitization
  - check digit computation
  - OCR correction substitutions
  - direct line-2 positional extraction fallback
  - VIZ-based repair fallback
- Uses `mrz` parser plus custom fallbacks.
- Produces MRZ field records that feed Jomhoor `ScanProvider` step transitions.
- UI already matches Jomhoor theme (`UiButton`, `UiIcon`, nativewind classes, theme palette).

## MRZ Comparison Table

| Area                | iLand implementation                     | Jomhoor implementation                       | Better source                      | Migration decision                                                                   |
| ------------------- | ---------------------------------------- | -------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------ |
| Scan modality       | Live frame scanning with dual zones      | Photo capture + OCR pass                     | Tie (different tradeoffs)          | Keep Jomhoor production as-is until package MRZ UI is proven                         |
| Barcode support     | Integrated barcode + MRZ synchronization | No passport barcode in current step          | iLand                              | Port barcode capability later as optional package feature                            |
| OCR strategy        | Continuous frame OCR + safe regions      | Single-shot OCR + fallback heuristics        | Jomhoor (stability in current app) | Reuse package parser utilities; port iLand live scanner later behind opt-in          |
| MRZ parsing core    | `passportMrz.js` TD1/TD2/TD3 + checks    | `mrz` package + custom corrections/fallbacks | Mixed                              | Keep package pure parser contract stable; add adapters to support both parser styles |
| Error handling      | Scanner lifecycle messaging              | Rich user-facing fallback messages           | Jomhoor                            | Preserve Jomhoor messaging tone in initial package screens via labels adapter        |
| Permission handling | Dedicated permission state helpers       | `useCameraPermission` in-step                | Jomhoor                            | Initial package MRZ screen should support host-provided permission UI labels         |
| Navigation coupling | Direct route transitions                 | Context-driven step state                    | Jomhoor                            | Package MRZ screen must be callback-driven, not route-name-driven                    |
| Theme/i18n coupling | iLand styles + `react-intl`              | Jomhoor nativewind + i18next                 | Jomhoor                            | Package UI should use host `uiAdapter/theme/labels`, no direct iLand style imports   |

## iLand NFC Flow

Primary iLand NFC files:

- JS/UI:
  - `src/screens/NFCInstruction.js`
  - `src/screens/NFCScreen.js`
  - `src/components/NFCScanner.js`
  - `src/utils/passportNfc.js`
- Native:
  - iOS `PassportNfc*` native module files
  - Android passport module exists in iLand repo

Key characteristics:

- iLand JS wrapper expects package-native NFC responses with `finalStatus`, `files`, access-control metadata.
- Includes probe paths (`probePassportChip`, `probeRawNfcTag`) and extensive session diagnostics.
- NFC UI includes detailed status handling, session cooldown, retry/cancel patterns.
- NFCScreen currently couples into iLand verification pipeline (`VerificationFlow`, `ReviewInformation`, user info persistence).

## Jomhoor NFC Flow

Primary Jomhoor NFC files:

- `src/pages/app/pages/document-scan/components/ScanPassportNfcStep.tsx`
- `src/utils/e-document/passport-nfc-reader.ts`
- NFC plugin: `plugins/withNfc.plugin/build/index.js`

Key characteristics:

- `ScanPassportNfcStep` remains Jomhoor-owned UX for current production flow.
- `passport-nfc-reader.ts` now contains backend switch capability and can call package `readPassportNfc` for native iOS backend when enabled.
- Default behavior remains existing JS/BAC path unless env enables native backend.
- Output is normalized into Jomhoor `EPassport` model used by proof pipeline (`NoirEPassportRegistration`).
- Jomhoor plugin already configures iOS NFC permissions/entitlements/select identifiers and Android NFC manifest/build gradle adjustments.

## NFC Comparison Table

| Area                        | iLand implementation                                  | Jomhoor implementation                             | Better source                                    | Migration decision                                                               |
| --------------------------- | ----------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------- |
| Backend model               | Native-first wrapper with diagnostics                 | Production JS path + optional package-native iOS   | Jomhoor for safety, iLand for richer native APIs | Keep Jomhoor JS default; enable package native iOS only by explicit backend flag |
| Session management          | Strong session lifecycle/cooldown controls            | Simpler step-level state + stop on unmount         | iLand                                            | Port iLand session patterns into package NFC screen components                   |
| Data groups/result richness | Rich result (`files`, access control, probe metadata) | Converts to `EPassport` expected by proof pipeline | Tie                                              | Package should keep rich typed results; Jomhoor adapter maps to `EPassport`      |
| Error mapping               | Many NFC-specific codes with diagnostics              | User-friendly messages in `ScanPassportNfcStep`    | Mixed                                            | Preserve package typed error codes + host-mapped messages in Jomhoor             |
| Plugin/entitlements         | iLand-native assumptions                              | Existing Jomhoor Expo plugin already active        | Jomhoor                                          | Reuse Jomhoor plugin infrastructure; avoid duplicate plugin ownership            |
| Android status              | Native exists in iLand but not migrated here          | Jomhoor JS path works                              | Jomhoor (current)                                | Keep Android native out of current UI slice                                      |
| Proof pipeline expectations | iLand review/wallet issue path                        | Jomhoor proof/identity registration path           | Jomhoor                                          | Package must not call proof/wallet/relayer directly                              |

## iLand Face/Liveness/Gaze/Comparison Flow

Primary iLand files:

- `src/verification/VerificationFlow.js`
- `src/verification/StepRenderer.js`
- `src/verification/steps/LivenessStep.js`
- `src/verification/steps/GazeChallengeStep.js`
- `src/verification/steps/FaceComparisonStep.js`
- `src/verification/steps/ReviewStep.js`
- `src/identity/facialRecognition.js`

Key characteristics:

- Multi-step state machine already exists (`liveness -> gaze -> faceComparison -> review`).
- Uses VisionCamera face detector plugin + Reanimated.
- Face comparison uses tfjs/mobilefacenet assets and expo image/file processing helpers.
- Important coupling to remove before reuse:
  - iLand navigation route assumptions
  - iLand review step directly issues wallet credential / scan store updates
  - extensive debug logging and runtime assumptions

## Jomhoor Face Verification Status

- No equivalent production face liveness/gaze/face-comparison flow is currently integrated in Jomhoor app flow.
- Jomhoor dependencies currently **do not include** `react-native-vision-camera-face-detector` or TFJS stack used by iLand face flow.
- Therefore face domain migration requires dependency onboarding + lazy-loading strategy + optional dependency boundaries.

Dependency deltas (high-impact):

- Present in iLand, missing in Jomhoor:
  - `react-native-vision-camera-face-detector`
  - `@tensorflow/tfjs`
  - `@tensorflow/tfjs-react-native`
  - `expo-image-manipulator`
  - `expo-camera` (for tfjs helpers in some iLand paths)
  - `react-intl` (iLand UI i18n approach)

## Jomhoor UI/Theme System

Observed conventions in Jomhoor:

- UI primitives under `src/ui/*` (`UiButton`, `UiCard`, `UiScreenScrollable`, `UiIcon`, etc.).
- Theming via nativewind + CSS variables + palette from `useAppTheme`.
- Localization with `react-i18next` and locale JSON files.
- App navigation via native-stack with typed route params (`AppStackParamsList`).

Implication for package UI:

- Avoid importing `@/ui` or Jomhoor internals directly from package.
- Use host-injected adapter props and label dictionary.
- Keep package screens visually neutral by default; host adapter can render Jomhoor-native components.

## Recommended Package UI Architecture

Recommended domain ownership:

- `passport`: MRZ + NFC screens/components + passport-specific hooks/services.
- `face`: liveness/gaze/face-comparison UI + model services.
- `identity-flow`: orchestrator/state machine + review screen + aggregate result.
- `shared`: ui adapter types, theme types, labels, common error/result contracts.

Suggested internal TS contracts:

```ts
export type VerificationUiAdapter = {
  Screen: React.ComponentType<{ children: React.ReactNode }>
  Button: React.ComponentType<{
    title: string
    onPress: () => void
    disabled?: boolean
    variant?: 'primary' | 'secondary' | 'danger'
  }>
  Text: React.ComponentType<{ children: React.ReactNode; tone?: 'primary' | 'secondary' | 'error' }>
  Card?: React.ComponentType<{ children: React.ReactNode }>
  Loader?: React.ComponentType<{ label?: string }>
  ErrorView?: React.ComponentType<{ message: string; onRetry?: () => void }>
}

export type VerificationTheme = {
  colors: {
    background: string
    text: string
    primary: string
    danger: string
    muted: string
  }
  spacing: Record<string, number>
}
```

Adapter principles:

- Package UI should work with default RN components if no adapter is provided.
- Jomhoor injects adapter for full visual consistency.

## Recommended Jomhoor Navigation Integration

Current route context:

- Jomhoor app stack has:
  - `Scan` (existing production document scan flow)
  - `Passport` (currently debug native status screen)

Best integration point for new package flow:

- Replace current debug `Passport` screen with a wrapper screen for package flow.
- Keep existing `Scan` route untouched as production fallback during rollout.

Recommended wrapper pattern:

```tsx
function PassportIdentityFlowScreen() {
  return (
    <PassportIdentityFlow
      uiAdapter={jomhoorUiAdapter}
      theme={jomhoorTheme}
      backend={selectedBackend}
      onCancel={() => navigation.goBack()}
      onComplete={result => {
        // map result -> existing Jomhoor proof/wallet flow
      }}
      onError={error => {
        // Jomhoor toast/dialog policy
      }}
    />
  )
}
```

Why one wrapper screen:

- Avoids registering many package internals in Jomhoor navigator.
- Keeps host ownership of post-verification decisions.
- Easier rollback to old flow.

## Integration Strategy Comparison

### Option A — Package low-level APIs only

Pros:

- Minimal UI churn.
- Keeps full control in Jomhoor.

Cons:

- Duplicates screen logic between app and package.
- Slower toward reuse goal of package-owned verification UI.

Risk:

- Low.

### Option B — Register package screens individually in Jomhoor navigation

Pros:

- Reuses package UI directly.

Cons:

- Route coupling explosion.
- Harder to keep package internals private/stable.

Risk:

- Medium-high.

### Option C — One package-owned state-machine component mounted by one Jomhoor wrapper screen

Pros:

- Clear ownership boundary.
- Minimal navigation integration surface.
- Easier to version and test as reusable unit.

Cons:

- Requires careful adapter design for UI/theming and host callbacks.

Risk:

- Medium (best tradeoff).

### Option D — Hybrid (package owns MRZ/NFC/face screens, Jomhoor owns final review/proof)

Pros:

- Preserves Jomhoor final confirmation policy.

Cons:

- Boundary can blur; two review UIs may diverge.

Risk:

- Medium.

## Recommended Strategy

Recommended now:

- **Option C** for the new `Passport` route (wrapper screen + package internal state machine), while preserving existing `Scan` route unchanged until validated.

Recommended rollout behavior:

- Keep old flow accessible/fallback.
- Feature-flag package flow entry if needed.
- Do not auto-trigger proof pipeline on first rollout; let wrapper explicitly decide after user confirmation.

## Proposed Public UI API

Recommended exports (separated by domain):

```ts
import {
  PassportMrzScanScreen,
  PassportNfcScanScreen,
  readPassportNfc,
  type PassportNfcReadResult,
} from '@iland/passport-verification/passport'

import {
  FaceLivenessScreen,
  GazeChallengeScreen,
  FaceComparisonScreen,
  type LivenessResult,
  type GazeChallengeResult,
  type FaceComparisonResult,
} from '@iland/passport-verification/face'

import {
  PassportIdentityFlow,
  ReviewIdentityScreen,
  type PassportIdentityVerificationResult,
  type PassportIdentityFlowProps,
} from '@iland/passport-verification/identity-flow'
```

Suggested `PassportIdentityFlowProps`:

```ts
type PassportIdentityFlowProps = {
  initialStep?: 'mrz' | 'nfc' | 'liveness' | 'gaze' | 'comparison' | 'review'
  backend?: 'native-ios' | 'native-android' | 'jomhoor-js' | 'stub'
  uiAdapter?: VerificationUiAdapter
  theme?: VerificationTheme
  labels?: Record<string, string>
  onCancel?: () => void
  onComplete: (result: PassportIdentityVerificationResult) => void
  onError?: (error: VerificationError) => void
}
```

## Result Type Returned to Jomhoor

```ts
type PassportIdentityVerificationResult = {
  passport: {
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
    portrait?: {
      base64?: string
      filePath?: string
    }
  }
  face?: {
    liveness?: LivenessResult
    gaze?: GazeChallengeResult
    comparison?: FaceComparisonResult
  }
  finalDecision: 'verified' | 'failed' | 'manual_review' | 'cancelled'
  errors?: VerificationError[]
}
```

Boundary rule (critical):

- Package returns this typed result only.
- Jomhoor decides proof generation, wallet storage, relayer registration, and final navigation.

## Phased Implementation Plan

### Phase A — Comparison + mapping (current task)

Goal:

- Freeze migration decisions and boundaries.

Outputs:

- This report.

Risk:

- Low.

Rollback:

- N/A.

---

### Phase B — Package UI foundation (no real scanning logic moved yet)

Goal:

- Add reusable UI contracts and flow shell.

Create/change:

- `packages/passport-verification/src/shared/ui/*` (adapter + theme + labels types)
- `packages/passport-verification/src/identity-flow/flow/PassportIdentityFlow.tsx`
- placeholder screens for `mrz/nfc/liveness/gaze/comparison/review`
- exports from domain index files

Jomhoor wrapper:

- replace current debug passport screen with wrapper mounting placeholder flow

Commands:

- `npx tsc -p packages/passport-verification/tsconfig.json`
- `yarn type-check`

Acceptance:

- Wrapper route opens and can complete with mock typed result.

Risk:

- Low.

Rollback:

- Route back to previous debug screen.

---

### Phase C — Port MRZ UI from iLand to package TS

Goal:

- Port package-owned MRZ screen/components using adapter/theme.

Source iLand:

- `src/screens/MrzScanScreen.js`
- `src/components/MrzScanner.js`
- `src/utils/passportMrzScan.js`

Target package:

- `src/passport/ui/PassportMrzScanScreen.tsx`
- `src/passport/ui/MrzScanner.tsx`
- `src/passport/mrz/*` (reuse existing package parser helpers)

Host integration:

- Use MRZ package screen only inside new wrapper route.

Acceptance:

- MRZ screen returns typed credentials to flow state machine.

Risk:

- Medium.

Rollback:

- Keep placeholder MRZ step in flow.

---

### Phase D — Port NFC UI from iLand to package TS

Goal:

- Package-owned NFC instruction/read UI calling package `readPassportNfc`.

Source iLand:

- `src/screens/NFCInstruction.js`
- `src/screens/NFCScreen.js`
- `src/components/NFCScanner.js`

Target package:

- `src/passport/ui/PassportNfcInstructionScreen.tsx`
- `src/passport/ui/PassportNfcScanScreen.tsx`

Host integration:

- default backend for existing production flow remains unchanged.
- wrapper route can explicitly select backend.

Acceptance:

- NFC UI step emits normalized `PassportNfcReadResult` and does not call host stores/services.

Risk:

- Medium.

Rollback:

- keep placeholder NFC step and use existing Jomhoor flow.

---

### Phase E — Port face liveness/gaze/comparison

Goal:

- Add package `face` domain screens and services with optional dependencies.

Source iLand:

- `src/verification/steps/LivenessStep.js`
- `src/verification/steps/GazeChallengeStep.js`
- `src/verification/steps/FaceComparisonStep.js`
- `src/identity/facialRecognition.js`

Target package:

- `src/face/liveness/*`
- `src/face/gaze/*`
- `src/face/comparison/*`
- `src/face/model/*`

Acceptance:

- Steps run from package flow and return typed results.

Risk:

- High (dependency + runtime).

Rollback:

- keep face steps disabled in flow config.

---

### Phase F — Package review/confirm screen

Goal:

- Add package review UI over normalized flow result.

Important:

- No wallet/proof/backend calls in package.

Acceptance:

- review step returns `finalDecision` only.

Risk:

- Medium.

Rollback:

- let Jomhoor wrapper do final review.

---

### Phase G — Jomhoor wrapper route production candidate

Goal:

- Route `Passport` uses package flow in non-destructive way.

Change:

- `src/pages/app/pages/passport/index.tsx`
- optional feature flag gating.

Acceptance:

- End-to-end package flow returns typed result to wrapper.

Risk:

- Medium.

Rollback:

- route back to old debug/legacy screen.

---

### Phase H — Optional proof pipeline mapping

Goal:

- Map successful package result into existing Jomhoor proof registration path.

Change:

- wrapper-only adapter code; do not move Jomhoor relayer/store logic into package.

Acceptance:

- Verified path triggers existing Jomhoor pipeline by explicit wrapper action.

Risk:

- High.

Rollback:

- disable mapping and keep package flow as capture-only.

## Risks and Open Questions

1. Face dependency gap

- Jomhoor currently lacks several iLand face dependencies. Need decision on when to add them and whether to lazy-load by route.

2. iLand review-step coupling

- iLand `ReviewStep` and `ReviewInformation` call wallet/issuer/voting services directly. Must not be ported as-is.

3. MRZ strategy divergence

- iLand live dual-zone scan vs Jomhoor photo+OCR fallback. Need product decision whether to keep both modes configurable.

4. NFC backend ownership

- Existing production default should remain Jomhoor JS path until native iOS path is fully device-validated across retries/cancellations.

5. Theming and i18n adapters

- Need final shape for adapter props so package stays reusable while still looking native in Jomhoor.

6. Data sensitivity policy

- Ensure package UI avoids logging/storing sensitive MRZ/passport portrait data except in memory required for current flow.

## Recommended Next Coding Slice

Safest next slice:

1. Add package UI foundation only (no full port yet):
   - `VerificationTheme`
   - `VerificationUiAdapter`
   - `labels` contract
   - `PassportIdentityFlow` placeholder state machine
   - placeholder screens for `mrz/nfc/liveness/gaze/comparison/review`
2. Replace current Jomhoor `Passport` debug screen with one wrapper route mounting placeholder package flow.
3. Confirm navigation and callback contract:
   - open route from existing home item
   - complete flow with mock typed result returned to Jomhoor
4. Do **not** port real MRZ/NFC/face UI in this slice.

After that, start real UI migration with MRZ first (Phase C).
