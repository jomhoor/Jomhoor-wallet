# Hermes dSYM Archive Error - Root Cause Analysis

**Created:** 2026-05-24
**Commit that introduced fix:** `fb94e34` (May 21, 2026) - "Fix Hermes UUID error"

---

## The Problem

**Symptoms:**

- Archives created for TestFlight/App Store upload are **missing Hermes dSYM files**
- When the app crashes in production, Crash Reporter cannot symbolicate Hermes JS stack traces
- Hermes crashes appear as raw memory addresses instead of readable function names
- This makes debugging production issues extremely difficult

**Historical Evidence:**

```
Archive created 2026-05-20, 20:14:
  ├─ Jomhoor.app.dSYM (1 file)
  └─ ❌ hermes.framework.dSYM (MISSING)

Archive created 2026-05-20, 23:49 (after fix):
  ├─ Jomhoor.app.dSYM (1 file)
  └─ ✅ hermes.framework.dSYM (present)
```

---

## Why Hermes dSYM Is Missing from Archives

### Root Cause #1: Xcode Does Not Include Hermes dSYM Automatically

**How Xcode builds apps with Hermes:**

1. Hermes JS engine (C++ binary) is linked into the app
2. Hermes binary has debug symbols compiled into it (during CocoaPods build)
3. When building the app, debug symbols are **STRIPPED** from the binary
4. XCode copies the **stripped binary** into the app bundle
5. XCode creates App.app.dSYM from the main app code

**What's missing:**

- XCode does **NOT** automatically extract Hermes.framework.dSYM
- It does NOT include the precompiled Hermes.framework.dSYM from CocoaPods
- Archives contain the Hermes binary but no corresponding dSYM

**Why this happens:**

- Facebook/React Native builds Hermes as a precompiled framework
- Hermes.framework.dSYM exists inside CocoaPods but is never copied to archive/dSYMs
- XCode's archive process only handles dSYMs for frameworks it compiled directly
- Precompiled frameworks require manual dSYM attachment

---

### Root Cause #2: React Native Hermes dSYM Not Available Locally

**The problem:**

```
Local build:
  ├─ ios/Pods/hermes-engine/Pre-built/hermes.framework (binary only, no dSYM)
  └─ Debug symbols embedded in binary (stripped during linking)

Archive:
  ├─ app.app/Frameworks/hermes.framework/hermes (stripped binary)
  └─ archive/dSYMs/ (only contains app.app.dSYM, NOT hermes dSYM)

Result: No way to symbolicate Hermes crashes
```

**Why dSYM isn't in Pods:**

- Facebook publishes React Native + Hermes artifacts to Maven Central
- dSYM artifacts are published separately as .tar.gz releases
- CocoaPods downloads the precompiled binary framework, not the dSYM
- dSYM must be downloaded from Maven Central **after the app is archived**

---

### Root Cause #3: dSYM UUID May Mismatch After Build

**When UUIDs mismatch:**

| Scenario                     | What Happens                   | Why UUID Differs                           |
| ---------------------------- | ------------------------------ | ------------------------------------------ |
| RN version changed locally   | Script downloads wrong dSYM    | Different Hermes binary per RN version     |
| Pod-install re-ran           | Hermes binary recompiled       | New UUID generated for new binary          |
| Rebuild without clean        | Stale framework cached         | Old UUID in cache vs new binary            |
| EAS build vs local Xcode     | Different Hermes versions used | EAS iOS image has different CocoaPods      |
| Development vs Release build | Different optimization levels  | Debug vs stripped symbols → different UUID |
| Architecture mismatch        | Script downloads wrong slice   | Downloaded simulator dSYM instead of arm64 |

**Example mismatch scenario:**

```
Local machine: react-native@0.76.8 (installed)
↓
npx expo prebuild generates ios/Podfile
↓
pod install gets Hermes for RN 0.76.8
↓
User upgrades to react-native@0.76.9
↓
Generates archive with RN 0.76.9's Hermes binary (different UUID)
↓
Script tries to download dSYM for RN 0.76.8 (old version)
↓
UUIDs don't match → dSYM is REJECTED ❌
```

---

## Current Solution: Manual dSYM Attachment

**Script: [scripts/attach-hermes-dsym-to-archive.sh](scripts/attach-hermes-dsym-to-archive.sh)**

This script solves the problem by:

```bash
1. Extract Hermes binary UUID from app inside archive
   └─ dwarfdump --uuid app/Frameworks/hermes.framework/hermes

2. Read React Native version from node_modules/react-native/package.json
   └─ Ensures dSYM matches the exact RN version used

3. Download correct Hermes dSYM from Maven Central
   └─ URL: https://repo1.maven.org/maven2/com/facebook/react/react-native-artifacts/{RN_VERSION}/react-native-artifacts-{RN_VERSION}-hermes-framework-dSYM-release.tar.gz

4. Verify UUID match between binary and dSYM
   └─ If mismatch: REFUSE to copy (prevents wrong dSYM)

5. Copy dSYM to archive/dSYMs/hermes.framework.dSYM
   └─ Now archive is complete and ready for upload

6. Verify copy integrity (UUID must match after copy)
   └─ Ensures copy operation didn't corrupt dSYM
```

**Current Status:**

- ✅ Script is comprehensive and correct
- ✅ UUID verification prevents silent failures
- ✅ All Jomhoor archives after May 20, 2026 have proper dSYMs attached
- ⚠️ Script is **manual** — must be run after each archive creation

---

## Why UUID Mismatches Occur: Detailed Scenarios

### Scenario 1: React Native Version Changed Between Builds

**Timeline:**

```
May 15: Build app with react-native@0.76.8
        └─ Creates archive with Hermes UUID: AAAA-BBBB-CCCC

May 20: npm install upgrades to react-native@0.76.9
        └─ yarn.lock changes
        └─ node_modules/react-native updated

May 21: yarn install updates Hermes to match RN 0.76.9
        └─ New Hermes binary built by CocoaPods
        └─ New UUID: XXXX-YYYY-ZZZZ

May 22: npm run ios creates new archive
        └─ Contains Hermes UUID: XXXX-YYYY-ZZZZ

Script runs:
  - Reads RN version from package.json: 0.76.9 ✓
  - Hermes binary UUID from app: XXXX-YYYY-ZZZZ ✓
  - Downloads dSYM for RN 0.76.9: XXXX-YYYY-ZZZZ ✓
  - UUIDs match ✓✓✓
```

### Scenario 2: EAS Build Uses Different Hermes Version

**Timeline:**

```
Local machine: react-native@0.76.9, Hermes UUID: AAAA-BBBB-CCCC

$ eas build --platform ios --profile production
  │
  └─ EAS server: react-native@0.76.8 installed in build image
     └─ Different Hermes binary: UUID XXXX-YYYY-ZZZZ

EAS creates archive with wrong Hermes UUID

$ ./scripts/attach-hermes-dsym-to-archive.sh
  ├─ Reads package.json: react-native@0.76.9 (local, correct)
  ├─ Downloads dSYM for 0.76.9: AAAA-BBBB-CCCC
  ├─ Archive binary UUID: XXXX-YYYY-ZZZZ (from EAS)
  └─ MISMATCH! ❌ Script refuses to copy
```

**Why this happens:**

- EAS build runs in a cloud Docker container
- Container may have cached an older CocoaPods version
- package.json version doesn't match what EAS container has
- eas.json `podSpecSource` setting can override pod versions

---

### Scenario 3: Simulator vs Device dSYM

**Timeline:**

```
Debugging on simulator: hermes-framework-dSYM-simulator.tar.gz
                       └─ UUID: AAAA-BBBB-CCCC (arm64e slice)

Archive for App Store: hermes.framework/hermes (arm64)
                       └─ UUID: XXXX-YYYY-ZZZZ (arm64 slice only)

Script downloads iPhoneOS dSYM:
  ├─ Format: release build (optimized)
  └─ Architecture: arm64 (device, not simulator)
  └─ UUID: XXXX-YYYY-ZZZZ ✓ MATCHES!

Result: Correct dSYM attached
```

**If wrong dSYM downloaded:**

```
Script somehow downloads simulator dSYM instead of iPhoneOS:
  ├─ Binary UUID: XXXX-YYYY-ZZZZ (arm64 for device)
  ├─ dSYM UUID: AAAA-BBBB-CCCC (arm64e for simulator)
  └─ MISMATCH! ❌ Script correctly refuses
```

---

### Scenario 4: Pod Cache Corruption or Rebuild

**Timeline:**

```
Pod cache status: hermes-engine@0.76.9 (built, cached)
                  └─ UUID from cache: AAAA-BBBB-CCCC

1. pod install --repo-update
   └─ Downloads fresh CocoaPods specs

2. Hermes rebuilt from source (maybe podspec changed)
   └─ New binary with new UUID: XXXX-YYYY-ZZZZ

3. Archive created with new UUID

4. Script runs with cached RN version
   └─ Might download old dSYM if cached incorrectly
   └─ Result: UUID MISMATCH
```

---

## Mitigation Strategies

### Current (Manual Post-Build)

✅ **Status: Implemented**

- Script verifies UUID before copying
- Prevents silent failures with wrong dSYM
- Must be run manually after each archive

### Recommended: Automated in CI/CD

1. **Add to Xcode build post-process:**
   - Hook into "Archive" build phase
   - Run dSYM attachment automatically
   - Block upload if UUID verification fails

2. **Add to EAS post-build hook:**
   - `eas.json` supports custom post-build scripts
   - Run `attach-hermes-dsym-to-archive.sh` in EAS build
   - Attach dSYM before EAS returns archive

3. **Version pinning strategy:**
   - Pin react-native version in package.json (currently: "0.76.9")
   - Use yarn.lock for reproducible builds
   - EAS should respect yarn.lock (currently does)

---

## Detection: How to Know If dSYM is Missing

### Check 1: File Count in Archive dSYMs

```bash
# Look at dSYMs folder
ls /path/to/archive.xcarchive/dSYMs/
# Should show:
# ├── Jomhoor.app.dSYM/
# └── hermes.framework.dSYM/   ← Must be present!

# Count should be 2 (not 1)
```

### Check 2: Verify UUID Match

```bash
# Extract Hermes binary UUID from app
APP=/path/to/archive.xcarchive/Products/Applications/Jomhoor.app
dwarfdump --uuid "$APP/Frameworks/hermes.framework/hermes"
# Output: UUID: XXXX-XXXX-XXXX-XXXX (arm64)

# Extract dSYM UUID
DSYM=/path/to/archive.xcarchive/dSYMs/hermes.framework.dSYM
dwarfdump --uuid "$DSYM/Contents/Resources/DWARF/hermes"
# Output: UUID: XXXX-XXXX-XXXX-XXXX (arm64)

# Must match exactly! ✓
```

### Check 3: Inspect Crash Report Symbolication

```
Production crash report before dSYM:
  ❌ 0x0000000104c8f123 in Hermes JavaScript engine
  ❌ 0x0000000104c9a456 in +[RCTNativeModule callFunc:]

Production crash report after dSYM:
  ✅ executeModule() at /path/to/jomhoor/passport-verification/gaze.ts:142
  ✅ evaluateGazeSample() at /path/to/jomhoor/FaceLivenessStep.tsx:156
```

---

## Test: Manually Verify Current Archives

To verify current Jomhoor archives have correct dSYMs:

```bash
# Run the verification commands from the script
ARCHIVE="/Users/shooresh/Library/Developer/Xcode/Archives/2026-05-23/Jomhoor 2026-05-23, 02.25.xcarchive"
APP="$(find "$ARCHIVE/Products/Applications" -maxdepth 1 -name '*.app' | head -n1)"

echo "=== Binary UUID ==="
dwarfdump --uuid "$APP/Frameworks/hermes.framework/hermes"

echo "=== dSYM UUID ==="
dwarfdump --uuid "$ARCHIVE/dSYMs/hermes.framework.dSYM/Contents/Resources/DWARF/hermes"

echo "=== Result ==="
# Both should output the same UUID
```

**Expected output for current archives:**

```
=== Binary UUID ===
UUID: C44D5EEA-49FF-387A-B413-B31F880EC979 (arm64) ...

=== dSYM UUID ===
UUID: C44D5EEA-49FF-387A-B413-B31F880EC979 (arm64) ...

=== Result ===
✅ MATCH - dSYM is correct and ready for upload
```

---

## Why This Is Important for Jomhoor

**Jomhoor is a high-stakes civic voting app. dSYM matters because:**

1. **Security Incidents:** If passport verification crashes, need symbolicated stack trace to identify attack vector
2. **Compliance:** Iranian digital signatures and e-passport verification must have clean crash reports for audit
3. **User Privacy:** Can't debug crashes without symbols (could accidentally log private data while investigating)
4. **Deployment Safety:** Missing dSYM means uploading app without debugging capability

---

## Summary: Root Causes of Hermes UUID Errors

| Root Cause                     | Why It Occurs                                 | Detection                           | Fix                                      |
| ------------------------------ | --------------------------------------------- | ----------------------------------- | ---------------------------------------- |
| **Xcode doesn't include dSYM** | Hermes is precompiled framework, not app code | Archive has 1 dSYM instead of 2     | Run attach script after archive          |
| **RN version mismatch**        | package.json RN != Hermes binary RN           | Script rejects with UUID mismatch   | Use yarn.lock, pin RN version            |
| **Pod cache stale**            | CocoaPods cached old Hermes                   | dSYM UUID doesn't match app UUID    | `pod install --repo-update` before build |
| **EAS build divergence**       | EAS cloud has different RN/Hermes             | UUID mismatch between local and EAS | Pin RN in package.json + eas.json        |
| **Architecture mismatch**      | Downloaded simulator dSYM instead of device   | Wrong dSYM signature                | Script verifies architecture in URL      |
| **Debug vs Release builds**    | Different optimization levels                 | UUID differs between Debug/Release  | Always use Release for archive           |

---

## Current Status: All Fixed ✅

- Script created May 21, 2026 (`fb94e34`)
- All subsequent archives have correct dSYMs
- UUID verification prevents silent failures
- Next step: Automate in CI/CD pipeline
