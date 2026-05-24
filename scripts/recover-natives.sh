#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/recover-natives.sh \
    [--app-env <development|staging|production|local>] \
    [--package <npm-package-name>] \
    [--skip-install] \
    [--no-prebuild] \
    [--no-pod-install] \
    [--verify-only]

Purpose:
  Re-apply and validate native recovery requirements after Expo prebuild regeneration,
  including dependency-specific native wiring for @iland verification package.

Key behaviors:
  - Never runs expo prebuild --clean.
  - Resolves verification package dynamically (or from --package override).
  - Validates OpenSSLLocal/NFCPassportReader artifacts, JMRTD/Scuba deps, BC policy.
  - Normalizes duplicated Gradle injection blocks (BC excludes / flatDir) deterministically.

Examples:
  scripts/recover-natives.sh
  scripts/recover-natives.sh --app-env production
  scripts/recover-natives.sh --verify-only
  scripts/recover-natives.sh --package @iland/passport-verification
USAGE
}

log() {
  printf '\n[recover-natives] %s\n' "$1"
}

warn() {
  printf '\n[recover-natives][warn] %s\n' "$1" >&2
}

die() {
  printf '\n[recover-natives][error] %s\n' "$1" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APP_ENV="${APP_ENV:-development}"
PACKAGE_OVERRIDE=""
RUN_INSTALL=1
RUN_PREBUILD=1
RUN_POD_INSTALL=1
VERIFY_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-env)
      APP_ENV="${2:-}"
      shift 2
      ;;
    --package)
      PACKAGE_OVERRIDE="${2:-}"
      shift 2
      ;;
    --skip-install)
      RUN_INSTALL=0
      shift
      ;;
    --no-prebuild)
      RUN_PREBUILD=0
      shift
      ;;
    --no-pod-install)
      RUN_POD_INSTALL=0
      shift
      ;;
    --verify-only)
      VERIFY_ONLY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

case "$APP_ENV" in
  development|staging|production|local) ;;
  *)
    die "Invalid --app-env '$APP_ENV'. Expected development|staging|production|local."
    ;;
esac

if [[ "$VERIFY_ONLY" -eq 1 ]]; then
  RUN_INSTALL=0
  RUN_PREBUILD=0
  RUN_POD_INSTALL=0
fi

for required_cmd in node rg; do
  command_exists "$required_cmd" || die "Missing required command: $required_cmd"
done

APP_CONFIG_TS="$ROOT_DIR/app.config.ts"
PACKAGE_JSON="$ROOT_DIR/package.json"
PODFILE="$ROOT_DIR/ios/Podfile"
PODFILE_LOCK="$ROOT_DIR/ios/Podfile.lock"
ANDROID_APP_GRADLE="$ROOT_DIR/android/app/build.gradle"
ANDROID_PROJECT_GRADLE="$ROOT_DIR/android/build.gradle"
PLUGIN_TS="$ROOT_DIR/plugins/withNfc.plugin/src/index.ts"
PLUGIN_JS="$ROOT_DIR/plugins/withNfc.plugin/build/index.js"

for required in "$APP_CONFIG_TS" "$PACKAGE_JSON" "$PLUGIN_TS"; do
  [[ -f "$required" ]] || die "Required file not found: $required"
done

log "Resolving verification package"
PACKAGE_META_JSON="$(PACKAGE_OVERRIDE="$PACKAGE_OVERRIDE" node <<'NODE'
const fs = require('fs')
const path = require('path')

const rootPkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'))
const deps = { ...(rootPkg.dependencies || {}), ...(rootPkg.devDependencies || {}) }

let name = (process.env.PACKAGE_OVERRIDE || '').trim()
if (!name) {
  const candidates = Object.keys(deps).filter(key => key.startsWith('@iland/') && key.includes('verification'))
  if (candidates.includes('@iland/passport-verification')) {
    name = '@iland/passport-verification'
  } else if (candidates.length === 1) {
    name = candidates[0]
  } else if (candidates.length > 1) {
    console.error(`Multiple @iland verification candidates found: ${candidates.join(', ')}`)
    process.exit(1)
  } else {
    console.error('No @iland/*verification dependency found in package.json')
    process.exit(1)
  }
}

if (!deps[name]) {
  console.error(`Package '${name}' not found in dependencies/devDependencies`)
  process.exit(1)
}

process.stdout.write(JSON.stringify({ name, spec: deps[name] }))
NODE
)"

PACKAGE_NAME="$(node -e "const x=JSON.parse(process.argv[1]); process.stdout.write(x.name)" "$PACKAGE_META_JSON")"
PACKAGE_SPEC="$(node -e "const x=JSON.parse(process.argv[1]); process.stdout.write(String(x.spec||''))" "$PACKAGE_META_JSON")"

log "Using package: $PACKAGE_NAME ($PACKAGE_SPEC)"

if [[ "$RUN_INSTALL" -eq 1 ]]; then
  command_exists yarn || die "yarn is required for installation step"
  log "Installing dependencies (yarn install)"
  yarn install
fi

PACKAGE_DIR="$(node -e "const fs=require('fs'); const path=require('path'); const pkg=process.argv[1]; let entry; try { entry=require.resolve(pkg); } catch(e) { console.error('Could not resolve package entry for ' + pkg + ': ' + e.message); process.exit(1); } let dir=path.dirname(entry); const root=path.parse(dir).root; while (dir !== root) { if (fs.existsSync(path.join(dir,'package.json'))) { const p=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8')); if (p.name === pkg) { process.stdout.write(dir); process.exit(0); } } dir=path.dirname(dir); } console.error('Could not locate package root for ' + pkg + ' from entry ' + entry); process.exit(1);" "$PACKAGE_NAME")"
[[ -d "$PACKAGE_DIR" ]] || die "Resolved package directory not found: $PACKAGE_DIR"

PACKAGE_WORKSPACE_DIR=""
if [[ "$PACKAGE_SPEC" == file:* ]]; then
  PACKAGE_WORKSPACE_DIR="$ROOT_DIR/${PACKAGE_SPEC#file:}"
fi

log "Resolved node_modules package dir: $PACKAGE_DIR"
if [[ -n "$PACKAGE_WORKSPACE_DIR" ]]; then
  log "Resolved workspace package dir: $PACKAGE_WORKSPACE_DIR"
fi

PACKAGE_PODSPEC="$PACKAGE_DIR/PassportVerification.podspec"
OPENSSL_PODSPEC="$PACKAGE_DIR/ios/LocalPods/OpenSSLLocal/OpenSSLLocal.podspec"
NFCREADER_PODSPEC="$PACKAGE_DIR/ios/LocalPods/NFCPassportReader/NFCPassportReader.podspec"
OPENSSL_LIBCRYPTO="$PACKAGE_DIR/ios/LocalPods/OpenSSLLocal/output/libcrypto-shooresh.xcframework"
OPENSSL_LIBSSL="$PACKAGE_DIR/ios/LocalPods/OpenSSLLocal/output/libssl-shooresh.xcframework"
PACKAGE_ANDROID_GRADLE="$PACKAGE_DIR/android/build.gradle"

log "Preflight validation of package native artifacts"
for required_path in \
  "$PACKAGE_PODSPEC" \
  "$OPENSSL_PODSPEC" \
  "$NFCREADER_PODSPEC" \
  "$OPENSSL_LIBCRYPTO" \
  "$OPENSSL_LIBSSL" \
  "$PACKAGE_ANDROID_GRADLE"; do
  [[ -e "$required_path" ]] || die "Missing required native artifact: $required_path"
done

log "Normalizing app.config.ts (runtime/version/location/plugins)"
VERIFY_ONLY="$VERIFY_ONLY" node <<'NODE'
const fs = require('fs')
const path = require('path')
const filePath = path.resolve('app.config.ts')
const verifyOnly = process.env.VERIFY_ONLY === '1'
let text = fs.readFileSync(filePath, 'utf8')
let changed = false

const ensure = (condition, updater, message) => {
  if (condition()) return
  if (verifyOnly) {
    console.error(message)
    process.exit(1)
  }
  text = updater(text)
  changed = true
}

ensure(
  () => /runtimeVersion:\s*Env\.VERSION\.toString\(\),/.test(text),
  input => input.replace(/runtimeVersion:\s*\{\s*policy:\s*['"]appVersion['"],\s*\},/m, 'runtimeVersion: Env.VERSION.toString(),'),
  'app.config.ts: runtimeVersion must be Env.VERSION.toString()'
)

ensure(
  () => text.includes('NSLocationWhenInUseUsageDescription'),
  input => {
    const marker = /("ITSAppUsesNonExemptEncryption"\s*:\s*false,\s*\n)/
    if (!marker.test(input)) {
      throw new Error('app.config.ts: could not find ITSAppUsesNonExemptEncryption marker')
    }
    return input.replace(
      marker,
      '$1      "NSLocationWhenInUseUsageDescription": "Location access may be used by identity verification features when required.",\n',
    )
  },
  'app.config.ts: NSLocationWhenInUseUsageDescription is missing'
)

ensure(
  () => /['"]expo-build-properties['"]/.test(text),
  input => {
    const pluginsBlockRegex = /(plugins:\s*\[)([\s\S]*?)(\n\s*\],\s*\n\s*extra:)/m
    const m = input.match(pluginsBlockRegex)
    if (!m) throw new Error('app.config.ts: plugins block not found')
    const insertion = `\n    ['expo-build-properties', {\n      android: {\n        minSdkVersion: 27,\n        compileSdkVersion : 35,\n        targetSdkVersion: 35,\n      },\n      ios: {\n        deploymentTarget: '17.5',\n      },\n    }],`
    return input.replace(pluginsBlockRegex, `${m[1]}${m[2]}${insertion}${m[3]}`)
  },
  'app.config.ts: expo-build-properties plugin is missing'
)

const requiredPluginEntries = [
  "'./plugins/withLocalAar.plugin.js'",
  "'./plugins/withNfc.plugin/build/index.js'",
]

for (const pluginEntry of requiredPluginEntries) {
  ensure(
    () => text.includes(pluginEntry) || text.includes(pluginEntry.replace(/'/g, '"')),
    input => {
      const pluginsBlockRegex = /(plugins:\s*\[)([\s\S]*?)(\n\s*\],\s*\n\s*extra:)/m
      const m = input.match(pluginsBlockRegex)
      if (!m) throw new Error('app.config.ts: plugins block not found')
      let body = m[2]
      if (!body.trimEnd().endsWith(',')) body = `${body.trimEnd()},`
      body = `${body}\n    [${pluginEntry}],`
      return input.replace(pluginsBlockRegex, `${m[1]}${body}${m[3]}`)
    },
    `app.config.ts: missing plugin entry ${pluginEntry}`
  )
}

if (!verifyOnly && changed) {
  fs.writeFileSync(filePath, text)
}
NODE

log "Ensuring package.json prebuild script"
VERIFY_ONLY="$VERIFY_ONLY" node <<'NODE'
const fs = require('fs')
const path = require('path')
const filePath = path.resolve('package.json')
const verifyOnly = process.env.VERIFY_ONLY === '1'
const expected = 'npx expo prebuild --skip-dependency-update react && npx pod-install'
const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'))
pkg.scripts = pkg.scripts || {}

if (pkg.scripts.prebuild !== expected) {
  if (verifyOnly) {
    console.error(`package.json scripts.prebuild mismatch. Expected: ${expected}`)
    process.exit(1)
  }
  pkg.scripts.prebuild = expected
  fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n')
}
NODE

patch_plugin_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0

  VERIFY_ONLY="$VERIFY_ONLY" node - "$file" <<'NODE'
const fs = require('fs')
const filePath = process.argv[2]
const verifyOnly = process.env.VERIFY_ONLY === '1'
let text = fs.readFileSync(filePath, 'utf8')
const before = text

text = text.replace(/\n\s*\/\/ We start to support Android 12 from v3\.11\.1, and you will need to update compileSdkVersion to 31,[\s\S]*?withBuildScriptExtMinimumVersion\(config, \{[\s\S]*?minVersion:\s*31,[\s\S]*?\}\);?\n/gm, '\n  // compileSdkVersion is managed by expo-build-properties in app.config.ts.\n')

if (verifyOnly) {
  if (before !== text) {
    console.error(`${filePath}: deprecated withBuildScriptExtMinimumVersion block detected`) 
    process.exit(1)
  }
  process.exit(0)
}

if (before !== text) {
  fs.writeFileSync(filePath, text)
}
NODE
}

log "Normalizing withNfc plugin compileSdk override"
patch_plugin_file "$PLUGIN_TS"
patch_plugin_file "$PLUGIN_JS"

if [[ "$RUN_PREBUILD" -eq 1 ]]; then
  log "Running expo prebuild (no clean) with APP_ENV=$APP_ENV"
  APP_ENV="$APP_ENV" npx expo prebuild --skip-dependency-update react
else
  log "Skipping expo prebuild"
fi

# Podfile patching happens after prebuild since prebuild can regenerate ios/Podfile.
if [[ -f "$PODFILE" ]]; then
  log "Ensuring ios/Podfile contains required local pod paths for $PACKAGE_NAME"

  POD_OPENSSL_PATH="../node_modules/${PACKAGE_NAME}/ios/LocalPods/OpenSSLLocal"
  POD_NFCREADER_PATH="../node_modules/${PACKAGE_NAME}/ios/LocalPods/NFCPassportReader"

  VERIFY_ONLY="$VERIFY_ONLY" POD_OPENSSL_PATH="$POD_OPENSSL_PATH" POD_NFCREADER_PATH="$POD_NFCREADER_PATH" node <<'NODE'
const fs = require('fs')
const path = require('path')
const filePath = path.resolve('ios/Podfile')
const verifyOnly = process.env.VERIFY_ONLY === '1'
const podOpenSslLine = `  pod 'OpenSSLLocal', :path => '${process.env.POD_OPENSSL_PATH}'`
const podNfcLine = `  pod 'NFCPassportReader', :path => '${process.env.POD_NFCREADER_PATH}'`
let text = fs.readFileSync(filePath, 'utf8')

const hasOpenSSLLocal = text.includes(podOpenSslLine)
const hasNFCPassportReader = text.includes(podNfcLine)

if (hasOpenSSLLocal && hasNFCPassportReader) {
  process.exit(0)
}

if (verifyOnly) {
  console.error('ios/Podfile missing required OpenSSLLocal/NFCPassportReader local pod lines')
  process.exit(1)
}

const marker = /target 'Jomhoor' do\n\s*use_expo_modules!\n/
if (!marker.test(text)) {
  throw new Error("Could not find target 'Jomhoor' do + use_expo_modules! in ios/Podfile")
}

const insertion =
  "target 'Jomhoor' do\n" +
  "  use_expo_modules!\n" +
  "  # Local pods required by @iland verification native iOS module.\n" +
  `${podOpenSslLine}\n` +
  `${podNfcLine}\n`

text = text.replace(marker, insertion)
fs.writeFileSync(filePath, text)
NODE
else
  warn "ios/Podfile not found (skip Podfile patch)"
fi

normalize_bouncycastle_block() {
  local file="$1"
  [[ -f "$file" ]] || die "Android app Gradle file missing: $file"

  VERIFY_ONLY="$VERIFY_ONLY" node - "$file" <<'NODE'
const fs = require('fs')
const filePath = process.argv[2]
const verifyOnly = process.env.VERIFY_ONLY === '1'
let text = fs.readFileSync(filePath, 'utf8')

const blockRegex = /\n\s*\/\/ this configuration is added by a custom expo mod \(plugin\) to resolve "Duplicate class org\.bouncycastle\.\." error\n\s*configurations \{\n\s*all\*\.exclude group: 'org\.bouncycastle', module: 'bcprov-jdk15to18'\n\s*all\*\.exclude group: 'org\.bouncycastle', module: 'bcutil-jdk15to18'\n\s*\}\n?/gm
const matches = text.match(blockRegex) || []

const canonical = `\n\n    // this configuration is added by a custom expo mod (plugin) to resolve "Duplicate class org.bouncycastle.." error\n    configurations {\n        all*.exclude group: 'org.bouncycastle', module: 'bcprov-jdk15to18'\n        all*.exclude group: 'org.bouncycastle', module: 'bcutil-jdk15to18'\n    }\n`

if (verifyOnly) {
  if (matches.length !== 1) {
    console.error(`${filePath}: expected exactly one BouncyCastle exclusion block, found ${matches.length}`)
    process.exit(1)
  }
  process.exit(0)
}

text = text.replace(blockRegex, '\n')
text = text.trimEnd() + canonical
fs.writeFileSync(filePath, text)
NODE
}

normalize_flatdir_block() {
  local file="$1"
  [[ -f "$file" ]] || die "Android project Gradle file missing: $file"

  VERIFY_ONLY="$VERIFY_ONLY" node - "$file" <<'NODE'
const fs = require('fs')
const filePath = process.argv[2]
const verifyOnly = process.env.VERIFY_ONLY === '1'
let text = fs.readFileSync(filePath, 'utf8')

const blockRegex = /\n\s*allprojects \{\n\s*repositories \{\n\s*flatDir \{\n\s*dirs project\(':rapidsnark-wrp'\)\.projectDir\.absolutePath \+ '\/libs'\n\s*dirs project\(':noir'\)\.projectDir\.absolutePath \+ '\/libs'\n\s*dirs project\(':witnesscalculator'\)\.projectDir\.absolutePath \+ '\/libs'\n\s*\}\n\s*\}\n\s*\}\n?/gm
const matches = text.match(blockRegex) || []

const canonical = `\n\nallprojects {\n    repositories {\n        flatDir {\n            dirs project(':rapidsnark-wrp').projectDir.absolutePath + '/libs'\n            dirs project(':noir').projectDir.absolutePath + '/libs'\n            dirs project(':witnesscalculator').projectDir.absolutePath + '/libs'\n        }\n    }\n}\n`

if (verifyOnly) {
  if (matches.length !== 1) {
    console.error(`${filePath}: expected exactly one flatDir local AAR block, found ${matches.length}`)
    process.exit(1)
  }
  process.exit(0)
}

text = text.replace(blockRegex, '\n')
text = text.trimEnd() + canonical
fs.writeFileSync(filePath, text)
NODE
}

log "Normalizing Android Gradle injected blocks"
normalize_bouncycastle_block "$ANDROID_APP_GRADLE"
normalize_flatdir_block "$ANDROID_PROJECT_GRADLE"

log "Validating Android package-native dependencies (JMRTD/Scuba)"
rg -q "org\.jmrtd:jmrtd:0\.7\.42" "$PACKAGE_ANDROID_GRADLE" || die "Missing JMRTD dependency in $PACKAGE_ANDROID_GRADLE"
rg -q "net\.sf\.scuba:scuba-sc-android:0\.0\.26" "$PACKAGE_ANDROID_GRADLE" || die "Missing Scuba dependency in $PACKAGE_ANDROID_GRADLE"

if [[ "$RUN_POD_INSTALL" -eq 1 ]]; then
  if [[ -d "$ROOT_DIR/ios" ]]; then
    command_exists pod || die "pod command not found"
    log "Running pod install"
    (cd ios && pod install)
  else
    warn "ios directory not found (skip pod install)"
  fi
else
  log "Skipping pod install"
fi

if [[ -f "$PODFILE_LOCK" ]]; then
  log "Validating Podfile.lock for PassportVerification/OpenSSLLocal/NFCPassportReader"
  rg -q "\bPassportVerification\b" "$PODFILE_LOCK" || die "Podfile.lock missing PassportVerification"
  rg -q "\bOpenSSLLocal\b" "$PODFILE_LOCK" || die "Podfile.lock missing OpenSSLLocal"
  rg -q "\bNFCPassportReader\b" "$PODFILE_LOCK" || die "Podfile.lock missing NFCPassportReader"
else
  warn "ios/Podfile.lock not found"
  [[ "$VERIFY_ONLY" -eq 1 ]] && die "verify-only failed: ios/Podfile.lock missing"
fi

log "Environment consistency checks (APP_ENV=$APP_ENV)"
EXPECTED_PACKAGE="$(APP_ENV="$APP_ENV" node -e "const {Env}=require('./env'); process.stdout.write(Env.PACKAGE)")"
EXPECTED_BUNDLE_ID="$(APP_ENV="$APP_ENV" node -e "const {Env}=require('./env'); process.stdout.write(Env.BUNDLE_ID)")"

# Android applicationId should align with Env.PACKAGE after prebuild.
if ! rg -q "applicationId ['\"]${EXPECTED_PACKAGE}['\"]" "$ANDROID_APP_GRADLE"; then
  die "android/app/build.gradle applicationId does not match expected Env.PACKAGE ($EXPECTED_PACKAGE)"
fi

# iOS native project uses PRODUCT_BUNDLE_IDENTIFIER; ensure expected id appears in app config.
if ! rg -q "bundleIdentifier:\s*Env\.BUNDLE_ID" "$APP_CONFIG_TS"; then
  die "app.config.ts ios.bundleIdentifier is not mapped to Env.BUNDLE_ID"
fi

if [[ -f "$ROOT_DIR/ios/Jomhoor/Info.plist" ]]; then
  if ! rg -q "<key>CFBundleIdentifier</key>" "$ROOT_DIR/ios/Jomhoor/Info.plist"; then
    die "ios/Jomhoor/Info.plist missing CFBundleIdentifier key"
  fi
fi

log "Final validation summary"
rg -n "runtimeVersion|NSLocationWhenInUseUsageDescription|withLocalAar.plugin|withNfc.plugin|expo-build-properties" "$APP_CONFIG_TS"
rg -n "OpenSSLLocal|NFCPassportReader" "$PODFILE" "$PODFILE_LOCK" 2>/dev/null || true
rg -n "jmrtd|scuba-sc-android" "$PACKAGE_ANDROID_GRADLE"
rg -n "bcprov-jdk15to18|bcutil-jdk15to18" "$ANDROID_APP_GRADLE"
rg -n "flatDir|rapidsnark-wrp|noir|witnesscalculator" "$ANDROID_PROJECT_GRADLE"

log "Recovery completed successfully"
