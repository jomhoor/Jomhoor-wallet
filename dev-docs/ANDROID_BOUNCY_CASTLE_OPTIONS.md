# Android Bouncy Castle Options (Phase 14 Investigation)

## Executive Summary

- iLand Android NFC code uses Bouncy Castle **directly** only to register the provider (`BouncyCastleProvider`) at runtime.
- `org.jmrtd:jmrtd:0.7.42` already brings BC transitively (`bcprov-jdk18on:1.78`, `bcutil-jdk18on:1.78`).
- Jomhoor currently has app-level excludes for `bcprov-jdk15to18` and `bcutil-jdk15to18`, likely to avoid duplicate BC classes from Expo modules.
- Recommended for Phase 14: **Option 2 first** (transitive BC via JMRTD/Scuba), keep current Jomhoor excludes as-is, then only add explicit BC if runtime/compile evidence requires it.

## Direct BC Usage Found

### iLand NFC module

File:

- `iland/android/app/src/main/java/com/shooresh/iland/nativebridge/PassportNfcModule.kt`

Direct usage:

- `import org.bouncycastle.jce.provider.BouncyCastleProvider`
- `ensureBouncyCastleProvider()` replaces/inserts provider in `Security`

No other direct imports of BC utility/ASN1 APIs were found in the NFC module.

### Jomhoor package module (current)

- No BC usage yet in `packages/passport-verification/android` (module is still status-only).

## Dependency Tree Comparison

## iLand (resolved)

Command used:

- `./gradlew :app:dependencies --configuration debugRuntimeClasspath`
- `./gradlew :app:dependencyInsight --configuration debugRuntimeClasspath --dependency org.bouncycastle:bcutil-jdk18on`

Resolved relevant deps:

- `org.jmrtd:jmrtd:0.7.42`
  - `org.bouncycastle:bcprov-jdk18on:1.78`
  - `org.bouncycastle:bcutil-jdk18on:1.78`
- `net.sf.scuba:scuba-sc-android:0.0.26`
  - `net.sf.scuba:scuba-smartcards:0.0.20`

No `bcutil-jdk15to18` resolved in iLand runtime classpath.

## Jomhoor (declared/configured)

- App declares:
  - `implementation("org.jmrtd:jmrtd:0.7.42")`
- App has global excludes:
  - `exclude org.bouncycastle:bcprov-jdk15to18`
  - `exclude org.bouncycastle:bcutil-jdk15to18`
- Expo module `expo-updates` declares:
  - `implementation("org.bouncycastle:bcutil-jdk15to18:1.78.1")`

Note:

- Full `:app:dependencies` resolution in Jomhoor currently fails earlier due unrelated Expo/Gradle configuration issue, so this investigation used declared deps + file-level evidence there.

## Option 1 — Explicit BC Dependency in Package Module

Definition:

- Add BC dependencies explicitly in `packages/passport-verification/android/build.gradle`.

Feasibility:

- Technically feasible.
- Works if you pin BC artifacts/versions consistently with JMRTD path.

Risk:

- Higher duplicate-class risk if explicit BC does not match already-resolved BC family.
- Jomhoor already has mixed BC families in ecosystem (`jdk18on` via JMRTD and `jdk15to18` via Expo modules), with excludes used as conflict control.
- Explicitly adding BC may increase conflict surface unless strict version/alignment strategy is applied.

When to use:

- If transitive-only path yields missing-class/provider errors after migration.
- If you need strict package-owned dependency declaration for clarity/compliance.

## Option 2 — Transitive-only BC via JMRTD/Scuba

Definition:

- Do not add explicit BC dependency in package module.
- Rely on JMRTD transitive BC (`jdk18on`) like iLand does.

Feasibility:

- High; this mirrors iLand’s working pattern.
- iLand module’s direct BC usage (provider registration only) is compatible with JMRTD-provided BC.

Risk:

- Relies on host app dependency graph behavior.
- If host-level excludes/substitutions change later, BC availability could regress.

When to use:

- Best first attempt for minimal churn and parity with iLand.

## Recommendation for Phase 14

- Start with **Option 2** (transitive-only BC).
- Keep Jomhoor’s current BC excludes unchanged initially.
- Migrate Android NFC module and validate compile/runtime.
- Only move to Option 1 if there is concrete evidence of missing BC provider/classes.

Rationale:

- Lowest risk and least changes.
- Closest to known working iLand behavior.
- Avoids introducing extra BC alignment logic before actual need.

## Exact Gradle Changes to Try First

### Step A (first attempt)

1. In `packages/passport-verification/android/build.gradle`, add only:
   - `implementation("org.jmrtd:jmrtd:0.7.42")`
   - `implementation("net.sf.scuba:scuba-sc-android:0.0.26")`
2. Do **not** add explicit BC dependency yet.
3. Keep Jomhoor app excludes as currently configured.

### Step B (only if Step A fails with BC missing-class/provider errors)

1. Add explicit BC in package module:
   - `implementation("org.bouncycastle:bcprov-jdk18on:1.78")`
   - optionally `implementation("org.bouncycastle:bcutil-jdk18on:1.78")`
2. Re-run Android dependency checks and resolve duplicate-class conflicts by aligning/excluding one BC family globally.

## Practical Validation Commands (for migration phase)

- `cd android && ./gradlew :app:assembleDebug`
- `cd android && ./gradlew :app:dependencyInsight --configuration debugRuntimeClasspath --dependency org.bouncycastle`
- Device run with:
  - `EXPO_PUBLIC_PASSPORT_NFC_BACKEND=native-android`

## Summary Decision

- Preferred initial strategy: **Option 2 (transitive-only BC)**.
- Escalation strategy: switch to Option 1 only if BC/provider resolution fails after migration.
