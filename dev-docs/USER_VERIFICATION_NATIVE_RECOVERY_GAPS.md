# Native Integration Recovery Gap Report

## Scope and Context

Goal requested: identify everything needed to integrate `@iland` verification package into regenerated native folders (`ios/`, `android/`) after `npx expo prebuild`, and list what is still missing in `scripts/recover-natives.sh`.

Important current-state finding:
- Requested package path `packages/user-verification/` does **not** exist in this repo.
- Existing package is `packages/passport-verification/` and dependency is `@iland/passport-verification` in root `package.json`.

This report therefore maps requirements against `@iland/passport-verification` and calls out path-generalization work needed for future `user-verification` rename.

---

## Sources Reviewed

- `scripts/recover-natives.sh`
- `app.config.ts`, `package.json`, `ios/Podfile`, `ios/Podfile.lock`
- `android/build.gradle`, `android/app/build.gradle`, `android/settings.gradle`
- `packages/passport-verification/PassportVerification.podspec`
- `packages/passport-verification/android/build.gradle`
- `packages/passport-verification/ios/LocalPods/OpenSSLLocal/OpenSSLLocal.podspec`
- `packages/passport-verification/ios/LocalPods/NFCPassportReader/NFCPassportReader.podspec`
- `plugins/withNfc.plugin/src/index.ts`, `plugins/withNfc.plugin/build/index.js`
- `plugins/withLocalAar.plugin.js`
- `dev-docs/PASSPORT_PACKAGE_DEPENDENCY_AUDIT.md`
- `dev-docs/ANDROID_BOUNCY_CASTLE_OPTIONS.md`
- `dev-docs/ANDROID_NATIVE_NFC_MIGRATION_PLAN.md`

---

## Current Native Integration State (What Exists)

### iOS

- `PassportVerification.podspec` depends on:
  - `OpenSSLLocal`
  - `NFCPassportReader`
- `ios/Podfile` includes local pod path wiring:
  - `pod 'OpenSSLLocal', :path => '../node_modules/@iland/passport-verification/ios/LocalPods/OpenSSLLocal'`
  - `pod 'NFCPassportReader', :path => '../node_modules/@iland/passport-verification/ios/LocalPods/NFCPassportReader'`
- `ios/Podfile.lock` resolves:
  - `PassportVerification`
  - `OpenSSLLocal`
  - `NFCPassportReader`

### Android

- `packages/passport-verification/android/build.gradle` includes:
  - `implementation 'org.jmrtd:jmrtd:0.7.42'`
  - `implementation 'net.sf.scuba:scuba-sc-android:0.0.26'`
- BouncyCastle duplicate-class mitigation is injected by custom Expo plugin (`withNfc`) into `android/app/build.gradle`.
- `withLocalAar.plugin.js` injects `flatDir` repos in `android/build.gradle` for local AAR/JAR modules.

### Config/Prebuild wiring

- `app.config.ts` currently includes:
  - `runtimeVersion: Env.VERSION.toString()`
  - iOS `NSLocationWhenInUseUsageDescription`
  - plugin entries for:
    - `./plugins/withLocalAar.plugin.js`
    - `./plugins/withNfc.plugin/build/index.js`
    - `expo-build-properties` (compile/min/target sdk)

---

## What `recover-natives.sh` Already Covers

Current script handles:
1. `runtimeVersion` fallback from policy form to string form.
2. Adds `NSLocationWhenInUseUsageDescription` to `app.config.ts` if missing.
3. Ensures prebuild command uses `--skip-dependency-update react`.
4. Removes deprecated `withBuildScriptExtMinimumVersion` section in withNfc plugin files.
5. Runs `expo prebuild` (without `--clean`).
6. Ensures `ios/Podfile` has OpenSSLLocal/NFCPassportReader local pod lines.
7. Runs `pod install`.

---

## Missing Actions to Add to `recover-natives.sh`

## Priority 0 (must add)

1. **Resolve package path dynamically (remove hardcoded `passport-verification`)**
- Problem: script hardcodes `../node_modules/@iland/passport-verification/...` paths.
- Risk: breaks immediately if package is renamed to `@iland/user-verification` / `packages/user-verification`.
- Add:
  - Resolve package name from root `package.json` dependency key (`@iland/*verification`).
  - Resolve absolute path using `node -p "require.resolve('<pkg>/package.json')"`.
  - Generate Podfile local pod paths from resolved package directory.

2. **Preflight validation for native artifacts before prebuild/pods**
- Problem: script patches files but does not verify package native assets exist.
- Add checks for:
  - `<pkg>/PassportVerification.podspec`
  - `<pkg>/ios/LocalPods/OpenSSLLocal/OpenSSLLocal.podspec`
  - `<pkg>/ios/LocalPods/NFCPassportReader/NFCPassportReader.podspec`
  - `<pkg>/ios/LocalPods/OpenSSLLocal/output/libcrypto-shooresh.xcframework`
  - `<pkg>/ios/LocalPods/OpenSSLLocal/output/libssl-shooresh.xcframework`
  - `<pkg>/android/build.gradle`

3. **Deduplicate repeated BouncyCastle exclusion blocks in `android/app/build.gradle`**
- Current state observed: `bcprov/bcutil` exclusion block appears **3 times**.
- Cause: plugin appends block repeatedly across prebuild runs.
- Add:
  - post-prebuild cleanup step that keeps one canonical exclusion block.
  - fail if malformed/partial blocks remain.

4. **Ensure plugin entries are present in `app.config.ts`**
- Problem: script currently assumes plugin list remains intact.
- Add checks/patches to guarantee presence of:
  - `./plugins/withNfc.plugin/build/index.js`
  - `./plugins/withLocalAar.plugin.js`
  - `expo-build-properties` entry (compile/min/target sdk section)

5. **Ensure dependencies are installed before native recovery**
- Problem: if `node_modules` is stale/missing, Podfile paths fail.
- Add:
  - `yarn install` (or configurable `--skip-install`) before prebuild.
  - explicit failure if package cannot be resolved from node_modules.

## Priority 1 (strongly recommended)

6. **Validate Android package-native dependencies after recovery**
- Add assertions in `<pkg>/android/build.gradle` for:
  - `org.jmrtd:jmrtd:0.7.42`
  - `net.sf.scuba:scuba-sc-android:0.0.26`
- Reason: these are core for native Android passport flow and can regress silently.

7. **Validate iOS pod resolution result after `pod install`**
- Parse `ios/Podfile.lock` and ensure entries exist for:
  - `PassportVerification`
  - `OpenSSLLocal`
  - `NFCPassportReader`
- Reason: confirms local pod wiring actually resolved.

8. **Validate `android/build.gradle` flatDir block for local AAR/JAR modules**
- Ensure one canonical `flatDir` block exists for:
  - `project(':rapidsnark-wrp')`
  - `project(':noir')`
  - `project(':witnesscalculator')`
- Reason: `withLocalAar` integration is required native setup and should be guarded.

9. **Add environment-explicit mode and checks for APP_ENV correctness**
- Script already accepts `--app-env`, but should verify post-prebuild outputs for that env.
- Add post-checks:
  - iOS `Info.plist` / Expo constants consistency
  - Android `applicationId` suffix consistency for env

## Priority 2 (quality and safety)

10. **Idempotent patch markers or deterministic normalization**
- Replace regex append patterns with marker-based insert/update blocks to avoid drift.
- Especially for gradle injected sections.

11. **Optional `--verify-only` mode**
- Run all checks without mutating files; useful in CI and after manual recovery.

12. **Optional `--package <name>` override**
- Useful during migration from `passport-verification` to `user-verification`.

---

## Dependency-Specific Coverage Gaps

### OpenSSLLocal / NFCPassportReader
Current script:
- Adds Podfile lines only.
Missing:
- Artifact existence checks for OpenSSL XCFramework payloads.
- Podfile.lock verification.
- Dynamic package path handling.

### JMRTD / Scuba
Current script:
- Does not validate package Android gradle deps.
Missing:
- Assert presence of `jmrtd` and `scuba-sc-android` dependencies.

### BouncyCastle
Current script:
- Relies on plugin patch; no dedupe/normalization.
Missing:
- Cleanup of duplicate exclusion blocks.
- Validation that one canonical exclusion block exists.

---

## High-Risk Drift Already Observed

1. `android/app/build.gradle` currently contains duplicated BouncyCastle exclusion blocks (3 copies).
2. Script is package-path hardcoded (`@iland/passport-verification`), incompatible with requested `packages/user-verification` migration target.
3. Script verifies very little after modifications; failures can be discovered late during build/archive.

---

## Suggested Additions to Script Output (Post-Recovery Checklist)

After script runs, print and verify:

- `rg -n "withNfc.plugin|withLocalAar.plugin|runtimeVersion|NSLocationWhenInUseUsageDescription" app.config.ts`
- `rg -n "OpenSSLLocal|NFCPassportReader" ios/Podfile ios/Podfile.lock`
- `rg -n "jmrtd|scuba-sc-android" packages/*verification/android/build.gradle`
- `rg -n "bcprov-jdk15to18|bcutil-jdk15to18" android/app/build.gradle` (expect one block)
- `rg -n "flatDir|rapidsnark-wrp|witnesscalculator|noir" android/build.gradle`

Optional build validations:
- `cd ios && pod install`
- `cd android && ./gradlew :app:assembleDebug`

---

## Conclusion

`recover-natives.sh` covers only part of the native reintegration path. It restores some key iOS prebuild breakages, but it is currently missing critical robustness for:
- package path migration (`passport-verification` -> `user-verification`),
- Android duplication cleanup,
- dependency/artifact validation for `OpenSSLLocal`, `NFCPassportReader`, `jmrtd`, `scuba`, and BouncyCastle policy.

Adding the Priority 0 items will make the script materially safer and suitable as a true post-`prebuild` native recovery tool.
