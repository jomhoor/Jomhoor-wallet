# Passport/Face/Identity Package Export + Jomhoor Import Plan

## Executive Summary

This plan exports reusable verification logic from iLand into a **local package inside Jomhoor** at:

`/Users/shooresh/Documents/hello1/jomhoor/mobile-Iranians.vote/packages/passport-verification/`

The safest path is incremental:

1. Create/normalize package skeleton.
2. Move only pure TypeScript passport utilities first (MRZ parsing + access-key).
3. Import in Jomhoor via local dependency and validate TypeScript + Metro.
4. Keep Jomhoor’s current document-scan orchestration, NFC flow, proof generation, wallet/storage, and relayer calls unchanged.
5. Move NFC native and face/model code only in later phases.

## Decision: Package Location Under Jomhoor

Decision: keep package as first-party code under Jomhoor repo:

- `packages/passport-verification/`

Why:

- Single PR/review surface for app + package integration.
- Easier integration testing with current Jomhoor flow.
- No cross-repo sync overhead during early extraction.

## Existing Report Assumptions Revalidated

Reports reviewed first:

- `/Users/shooresh/Documents/hello1/iland24/PASSPORT_VERIFICATION_PACKAGE_INVESTIGATION.md`
- `/Users/shooresh/Documents/hello1/iland24/JOMHOOR_PACKAGE_REUSE_INVESTIGATION.md`

Current-state checks:

- iLand still contains reusable MRZ + access-key logic in pure JS utilities.
- iLand still contains large iOS native NFC surface with `NFCPassportReader` + `OpenSSLLocal`.
- iLand Android native passport module exists (`PassportNfcModule.kt`), so Android is not “missing,” but still high-risk to migrate immediately.
- Jomhoor already has a working passport scan path (MRZ step + JS NFC step + proof creation pipeline), so replacing orchestration now would increase risk.
- Jomhoor already has NFC config-plugin plumbing; package-native integration should reuse or merge this later, not in Phase 1.

## Current Jomhoor Package Setup

Verified in `/Users/shooresh/Documents/hello1/jomhoor/mobile-Iranians.vote`:

- Package manager: **Yarn 4.5.0** (`nodeLinker: node-modules`).
- No root `workspaces` field currently.
- Existing lockfile: `yarn.lock`.
- TS config:
  - `tsconfig.json` includes `"**/*.ts"`, `"**/*.tsx"`.
  - Existing aliases: `@/*`, `@assets/*`, `@modules/*`, `@env`.
- Metro config:
  - Standard Expo SDK 52 config + SVG/nativewind/reanimated wrappers.
  - No explicit monorepo/workspace customization.
- Expo app config:
  - SDK 52, RN 0.76.9, new architecture enabled.
  - NFC plugin enabled: `./plugins/withNfc.plugin/build/index.js`.

Implication:

- Local package is feasible now.
- For minimum churn, start with `file:` dependency first.

## Existing User-Created Package Structure

Current state under `packages/passport-verification/`:

- `src/passport/mrz/`
- `src/passport/access-key/`
- `src/passport/types/`
- `src/passport/errors/`
- `src/face/`
- `src/identity-flow/`
- `src/shared/`

Observations:

- Structure is a good starting point and should be preserved.
- Missing files: `package.json`, `tsconfig.json`, `src/index.ts`, domain `index.ts`, README/docs, tests.

## iLand Source Map

Source project audited: `/Users/shooresh/Documents/hello1/iland24/iland/`

### Passport domain candidates

- Pure utilities:
  - `/Users/shooresh/Documents/hello1/iland24/iland/src/utils/passportMrz.js`
  - `/Users/shooresh/Documents/hello1/iland24/iland/src/utils/passportMrzScan.js` (only pure parts)
- JS/native NFC wrapper (later phases):
  - `/Users/shooresh/Documents/hello1/iland24/iland/src/utils/passportNfc.js`
- iOS native (later phases):
  - `/Users/shooresh/Documents/hello1/iland24/iland/ios/iland/PassportNfcModule.swift`
  - `/Users/shooresh/Documents/hello1/iland24/iland/ios/iland/PassportNfcSessionManager.swift`
  - `/Users/shooresh/Documents/hello1/iland24/iland/ios/iland/PassportNfc*Mapper.swift`
  - `/Users/shooresh/Documents/hello1/iland24/iland/ios/LocalPods/NFCPassportReader/*`
  - `/Users/shooresh/Documents/hello1/iland24/iland/ios/LocalPods/OpenSSLLocal/*`
- Android native (later phases):
  - `/Users/shooresh/Documents/hello1/iland24/iland/android/app/src/main/java/com/shooresh/iland/nativebridge/PassportNfcModule.kt`

### Face domain candidates

- `/Users/shooresh/Documents/hello1/iland24/iland/src/verification/steps/LivenessStep.js`
- `/Users/shooresh/Documents/hello1/iland24/iland/src/verification/steps/GazeChallengeStep.js`
- `/Users/shooresh/Documents/hello1/iland24/iland/src/verification/steps/FaceComparisonStep.js`
- `/Users/shooresh/Documents/hello1/iland24/iland/src/identity/facialRecognition.js`
- model assets under iLand assets (move later, lazy-loaded)

### Identity-flow candidates

- `/Users/shooresh/Documents/hello1/iland24/iland/src/verification/VerificationFlow.js`
- `/Users/shooresh/Documents/hello1/iland24/iland/src/verification/StepRenderer.js`

### iLand app-coupled code to avoid direct migration

- iLand navigation assumptions in screens.
- iLand `react-intl` string usage.
- iLand wallet/issuer/onboarding/store coupling.

## Jomhoor Integration Points

Jomhoor’s current passport flow:

- `/Users/shooresh/Documents/hello1/jomhoor/mobile-Iranians.vote/src/pages/app/pages/document-scan/ScanProvider/index.tsx`
- `/Users/shooresh/Documents/hello1/jomhoor/mobile-Iranians.vote/src/pages/app/pages/document-scan/components/ScanMrzStep.tsx`
- `/Users/shooresh/Documents/hello1/jomhoor/mobile-Iranians.vote/src/pages/app/pages/document-scan/components/ScanPassportNfcStep.tsx`
- `/Users/shooresh/Documents/hello1/jomhoor/mobile-Iranians.vote/src/utils/e-document/passport-nfc-reader.ts`

Best first integration point:

- `ScanMrzStep.tsx` and/or `passport-nfc-reader.ts` for **pure MRZ + access-key helpers only**.

Keep as Jomhoor-owned adapter/orchestration:

- `ScanProvider/index.tsx` step transitions and identity creation pipeline.
- `NoirEPassportRegistration` proof + relayer registration.
- identity store/wallet store persistence.

Face/liveness status in Jomhoor now:

- No existing face/liveness/gaze/comparison pipeline detected.
- So face domain should be added later, independently.

## Recommended Local Package Strategy

### Option A: `file:` dependency (recommended immediate)

Example:

```json
"@iland/passport-verification": "file:./packages/passport-verification"
```

Pros:

- Minimal repo churn.
- No workspace restructuring.
- Lowest immediate risk for current app.

Cons:

- Yarn `file:` copies package content; edits may require reinstall to refresh installed copy.
- Slightly slower inner-loop while iterating package internals.

Metro/TS implications:

- Metro resolves package from `node_modules` like normal dependency.
- Keep package build output stable (`dist`) for predictable resolution.

Risk: Low

### Option B: Yarn workspaces (`workspace:*`)

Example root additions:

```json
"workspaces": ["packages/*"]
```

and dependency:

```json
"@iland/passport-verification": "workspace:*"
```

Pros:

- Better local dev loop for package changes.
- Cleaner monorepo model long-term.

Cons:

- Requires repo-wide package manager structure change.
- Can surface Metro/symlink edge-cases and CI changes.

Risk: Medium

### Option C: TS path alias only

Pros:

- Fast to wire for editor/type-check.

Cons:

- Not a real runtime package boundary.
- Metro/runtime drift risk.
- Poor long-term dependency discipline.

Risk: Medium

### Recommendation

- Immediate: **Option A** (`file:`).
- Long-term (after package stabilizes): **Option B** (workspace).

## Package Name Recommendation

Recommended now: `@iland/passport-verification`

Why:

- Matches source lineage and existing investigation naming.
- Avoids immediate rename churn.
- Still allows subpath exports for `passport`, `face`, `identity-flow`.

Alternative later:

- rename to `@iland/identity-verification` once face + identity-flow are mature.

## Package Boundary Rules

### Package must not

- Import Jomhoor navigation/routes.
- Import Jomhoor stores (`identityStore`, `walletStore`).
- Call Jomhoor backend/relayer directly.
- Persist identity/passport data in app storage directly.
- Depend on iLand `react-intl` or Jomhoor `i18next` directly.

### Package may

- Parse/sanitize/validate MRZ.
- Build BAC access key parameters.
- Define typed error/result models.
- Provide NFC provider interfaces and normalization logic.
- Provide face/liveness/comparison domain APIs later.
- Provide app-agnostic identity flow state machine later.

### Jomhoor must remain owner of

- Navigation + step screen orchestration.
- Proof generation and registration calls.
- Wallet and identity persistence.
- Session lifecycle and user-facing policy decisions.

## Target Package Structure

Target local package:

```text
/Users/shooresh/Documents/hello1/jomhoor/mobile-Iranians.vote/packages/passport-verification/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    passport/
      index.ts
      mrz/
        index.ts
        parse-mrz.ts
        check-digit.ts
        sanitize.ts
      access-key/
        index.ts
        build-passport-access-key.ts
      nfc/
        index.ts
      types/
        index.ts
      errors/
        index.ts
    face/
      index.ts
      liveness/
      gaze/
      comparison/
      model/
      types/
    identity-flow/
      index.ts
      flow/
      state-machine/
      types/
    shared/
      index.ts
      types/
      utils/
      i18n/
  ios/
  android/
  plugins/
  docs/
  tests/
```

Initial scope only:

- `passport/mrz/*`
- `passport/access-key/*`
- `passport/types/*`
- `passport/errors/*`
- minimal indexes + README

## Step-by-Step Implementation Plan

## Phase Details

### Phase 0 — Baseline audit

Goal:

- Confirm current app/package/tooling baseline before edits.

Files to inspect:

- Root config files, package manager files, document-scan flow files, iLand source files.

Commands:

```bash
cd /Users/shooresh/Documents/hello1/jomhoor/mobile-Iranians.vote
cat package.json tsconfig.json metro.config.js babel.config.js app.config.ts
find packages -maxdepth 6 -type d -o -type f | sort

cd /Users/shooresh/Documents/hello1/iland24/iland
cat package.json
find src -type f | rg -i "passport|mrz|nfc|face|liveness|gaze|verification"
```

Expected result:

- Confirmed source map and integration targets.

Risk level:

- Low

Rollback:

- None (read-only).

Acceptance criteria:

- Source and target file map documented.

### Phase 1 — Normalize package skeleton under Jomhoor

Goal:

- Add minimal package metadata and domain entrypoints.

Files to create/update:

- `packages/passport-verification/package.json`
- `packages/passport-verification/tsconfig.json`
- `packages/passport-verification/README.md`
- `packages/passport-verification/src/index.ts`
- `packages/passport-verification/src/passport/index.ts`
- `packages/passport-verification/src/face/index.ts`
- `packages/passport-verification/src/identity-flow/index.ts`
- `packages/passport-verification/src/shared/index.ts`

Commands:

```bash
cd /Users/shooresh/Documents/hello1/jomhoor/mobile-Iranians.vote
# create/update files
```

Expected result:

- Package compiles (even if face/identity-flow export placeholders only).

Risk level:

- Low

Rollback:

- Remove package files and dependency entry.

Acceptance criteria:

- `yarn` and `yarn type-check` still run.

### Phase 2 — Export passport pure utilities only (MRZ/access-key)

Goal:

- Move/copy pure TypeScript logic from iLand into package.

Source -> destination mapping:

1. `/Users/shooresh/Documents/hello1/iland24/iland/src/utils/passportMrz.js`
   -> `packages/passport-verification/src/passport/mrz/*`
2. Pure portions of `/Users/shooresh/Documents/hello1/iland24/iland/src/utils/passportMrzScan.js`
   -> `packages/passport-verification/src/passport/mrz/*` (OCR-safe sanitize/corrections only)
3. Access key derivation logic from iLand MRZ utilities
   -> `packages/passport-verification/src/passport/access-key/build-passport-access-key.ts`

Add types/errors:

- `packages/passport-verification/src/passport/types/index.ts`
- `packages/passport-verification/src/passport/errors/index.ts`

Initial required exports:

- `parseMrz`
- `buildPassportAccessKey`
- `PassportCredentials` type
- package error types

Expected result:

- Pure TS utilities compile with no React Native/native deps.

Risk level:

- Low

Rollback:

- Keep old Jomhoor local utility logic and revert imports.

Acceptance criteria:

- Package build passes and APIs are importable.

### Phase 3 — Add local dependency in Jomhoor

Goal:

- Wire package as local dependency.

Files to change:

- `/Users/shooresh/Documents/hello1/jomhoor/mobile-Iranians.vote/package.json`

Dependency entry:

```json
"@iland/passport-verification": "file:./packages/passport-verification"
```

Commands:

```bash
cd /Users/shooresh/Documents/hello1/jomhoor/mobile-Iranians.vote
yarn install
```

Expected result:

- Dependency appears in `node_modules/@iland/passport-verification`.

Risk level:

- Low

Rollback:

- Remove dependency line and run `yarn install`.

Acceptance criteria:

- Install succeeds with no new fatal peer errors.

### Phase 4 — Import validation with minimal behavior risk

Goal:

- Prove package resolves in TypeScript + Metro with minimal behavior impact.

Recommended validation point:

- Use small integration in `ScanMrzStep.tsx` or `src/utils/e-document/passport-nfc-reader.ts` only for pure utility import.

Rules:

- Do not change flow control/UI/native behavior yet.
- Keep fallback to existing logic during first validation if needed.

Commands:

```bash
cd /Users/shooresh/Documents/hello1/jomhoor/mobile-Iranians.vote
yarn type-check
yarn start
```

Expected result:

- TypeScript resolves `@iland/passport-verification`.
- Metro starts and app launches.

Risk level:

- Low

Rollback:

- Revert import line(s) and reinstall if needed.

Acceptance criteria:

- No runtime module resolution error.

### Phase 5 — Replace only MRZ/access-key logic in Jomhoor adapter layer

Goal:

- Replace local duplicate pure logic with package utilities.

Files likely to change:

- `/Users/shooresh/Documents/hello1/jomhoor/mobile-Iranians.vote/src/pages/app/pages/document-scan/components/ScanMrzStep.tsx`
- `/Users/shooresh/Documents/hello1/jomhoor/mobile-Iranians.vote/src/utils/e-document/passport-nfc-reader.ts`

Rules:

- Keep current NFC JS flow and return types.
- Keep ScanProvider and identity creation unchanged.

Expected result:

- Same behavior, package-owned MRZ/access-key implementation.

Risk level:

- Low-Medium

Rollback:

- Restore previous local helper implementations.

Acceptance criteria:

- MRZ scan success/failure behavior unchanged.

### Phase 6 — Add passport NFC JS wrapper in package (no native move yet)

Goal:

- Introduce a package-level typed JS NFC interface while still using current Jomhoor backend.

Approach:

- Define `passport/nfc` interfaces and normalized result types.
- Use adapter/provider so Jomhoor can pass current `readPassport` implementation.

Expected result:

- Package defines stable NFC contract without forcing native migration.

Risk level:

- Medium

Rollback:

- Continue calling Jomhoor NFC reader directly.

Acceptance criteria:

- Package contract used without changing native stack.

### Phase 7 — iOS native integration (later)

Goal:

- Integrate iLand iOS native NFC module into package with Expo plugin support.

Scope:

- Copy/rename iLand Swift bridge and mappers into package `ios/`.
- Add package plugin to apply Info.plist/entitlements/pod integration.
- Reconcile with existing Jomhoor `withNfc` plugin.

Risk level:

- High

Rollback:

- Feature flag back to JS NFC backend.

Acceptance criteria:

- Real iPhone passport read via package native backend.

### Phase 8 — Android native integration (later)

Goal:

- Evaluate iLand Android native module vs current JS NFC path.

Options:

- Keep JS backend as default MVP.
- Add native backend behind provider switch.

Risk level:

- High

Rollback:

- Keep/restore JS backend default.

Acceptance criteria:

- Typed `NOT_IMPLEMENTED` or fallback works safely where native unavailable.

### Phase 9 — Face domain extraction

Goal:

- Add liveness/gaze/comparison/model APIs with isolation from passport domain.

Rules:

- Lazy model loading.
- Optional dependencies for tfjs/face libs.
- No navigation/store/backend coupling.

Risk level:

- High

Rollback:

- Keep face exports experimental and opt-in.

Acceptance criteria:

- Face APIs compile and run independently.

### Phase 10 — Identity-flow domain extraction

Goal:

- Build app-agnostic flow/state-machine that composes passport + face.

Rules:

- Callbacks only, no Jomhoor backend/storage calls.

Risk level:

- Medium-High

Rollback:

- Jomhoor keeps own orchestration (`ScanProvider`).

Acceptance criteria:

- Package returns typed `IdentityVerificationResult`; host app decides persistence/registration.

## Commands

Baseline + validation commands to standardize execution:

```bash
cd /Users/shooresh/Documents/hello1/jomhoor/mobile-Iranians.vote

# dependency install
yarn install

# app type-check
yarn type-check

# package build (after package scripts exist)
yarn --cwd packages/passport-verification build

# start Metro
yarn start

# optional native smoke checks
yarn ios
yarn android
```

## Testing and Validation

### Package-level tests

- MRZ parse tests (TD1/TD2/TD3, noisy OCR input).
- Check-digit tests.
- Access-key derivation tests.
- Passport credential normalization tests.
- Error mapping tests.

### Jomhoor integration tests

- Import resolution test for `@iland/passport-verification`.
- `yarn type-check` green or only pre-existing unrelated failures.
- Metro startup without module resolution errors.
- Document-scan flow unchanged for MRZ and NFC step transitions.

### Device/manual checks (later phases)

- MRZ scan on real camera input.
- NFC read on iPhone with real passport.
- Retry/cancel/background edge cases.
- Android fallback behavior (if native not yet active).

## Native Integration Later

### iOS plan (not in first implementation step)

- Move iLand `PassportNfcModule` Swift/bridge files into package `ios/`.
- Add package config plugin for:
  - `NFCReaderUsageDescription`
  - `com.apple.developer.nfc.readersession.formats`
  - `com.apple.developer.nfc.readersession.iso7816.select-identifiers`
- Decide local pod strategy for `NFCPassportReader` + `OpenSSLLocal`.
- Reconcile with current Jomhoor `withNfc.plugin` to avoid duplicated/competing mods.

### Android plan (not in first step)

- Evaluate iLand `PassportNfcModule.kt` extraction feasibility.
- Keep typed fallback path for unsupported/no-native conditions.

## Git and Version Control Workflow

- Keep package committed as normal Jomhoor source under `packages/`.
- Do **not** use git submodule at this stage.
- Keep package versioned even locally (start at `0.0.1` or `0.1.0`).
- Add package `README.md` with source provenance from iLand.
- Keep app-specific adapters in Jomhoor `src/`, not in package.
- Add `CHANGELOG.md` in package once migration starts producing releases.

Sync policy from iLand:

- Track source mapping in docs (`iLand file -> package file`).
- Port changes intentionally by domain; avoid ad-hoc copy-paste across random app files.

## Risks and Rollback Plan

Primary risks:

1. Local dependency refresh confusion with `file:` protocol copies.
2. Accidental coupling of package code to Jomhoor app services.
3. Behavior regressions if MRZ utility replacement changes parsing edge-cases.
4. Native NFC integration complexity (Podfile/plugins/entitlements) when phase arrives.

Mitigations:

- Start with pure TS only.
- Keep adapters in host app.
- Add targeted MRZ/access-key test vectors before replacing logic.
- Delay native and face/model migrations.

Rollback strategy:

- Each phase uses small commits and explicit fallback path.
- For MRZ/access-key migration, revert import line(s) to old local helpers.
- For dependency issues, remove package dependency and reinstall.

## Recommended First Coding Step

1. Keep package under:
   - `/Users/shooresh/Documents/hello1/jomhoor/mobile-Iranians.vote/packages/passport-verification/`
2. Create/normalize only package skeleton files:
   - `package.json`
   - `tsconfig.json`
   - `src/index.ts`
   - `src/passport/index.ts`
   - `src/face/index.ts`
   - `src/identity-flow/index.ts`
   - `src/shared/index.ts`
   - `README.md`
3. Copy/convert only pure MRZ + access-key utilities from iLand.
4. Add dependency in Jomhoor root `package.json`:
   - `"@iland/passport-verification": "file:./packages/passport-verification"`
5. Run:
   - `yarn install`
   - `yarn --cwd packages/passport-verification build`
   - `yarn type-check`
   - `yarn start`
6. Validate import using a minimal TypeScript-level integration in MRZ flow.
7. Do **not** move native NFC bridge code, VisionCamera UI components, or face/model assets yet.
