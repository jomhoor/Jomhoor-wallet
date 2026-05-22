#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/change-version.sh <version> [--build-number <number>] [--android-version-code <number>]

Examples:
  scripts/change-version.sh 0.0.10
  scripts/change-version.sh 0.0.10 --build-number 2 --android-version-code 2

What it updates:
  - package.json -> version
  - android/app/build.gradle -> versionName (and versionCode if provided)
  - ios/Jomhoor/Info.plist -> CFBundleShortVersionString (and CFBundleVersion if build number provided)
  - ios/Jomhoor.xcodeproj/project.pbxproj -> MARKETING_VERSION (and CURRENT_PROJECT_VERSION if build number provided)
USAGE
}

if [[ $# -lt 1 ]]; then
  usage >&2
  exit 2
fi

VERSION="$1"
shift

BUILD_NUMBER=""
ANDROID_VERSION_CODE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-number)
      BUILD_NUMBER="${2:-}"
      shift 2
      ;;
    --android-version-code)
      ANDROID_VERSION_CODE="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.+][0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid version format: '$VERSION' (expected semantic version, e.g. 0.0.10)" >&2
  exit 1
fi

if [[ -n "$BUILD_NUMBER" && ! "$BUILD_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "--build-number must be a non-negative integer, got: '$BUILD_NUMBER'" >&2
  exit 1
fi

if [[ -n "$ANDROID_VERSION_CODE" && ! "$ANDROID_VERSION_CODE" =~ ^[0-9]+$ ]]; then
  echo "--android-version-code must be a non-negative integer, got: '$ANDROID_VERSION_CODE'" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_JSON="$ROOT_DIR/package.json"
ANDROID_GRADLE="$ROOT_DIR/android/app/build.gradle"
IOS_PLIST="$ROOT_DIR/ios/Jomhoor/Info.plist"
IOS_PBXPROJ="$ROOT_DIR/ios/Jomhoor.xcodeproj/project.pbxproj"

for required in "$PACKAGE_JSON" "$ANDROID_GRADLE" "$IOS_PLIST" "$IOS_PBXPROJ"; do
  if [[ ! -f "$required" ]]; then
    echo "Required file not found: $required" >&2
    exit 1
  fi
done

echo "Setting app version to: $VERSION"
[[ -n "$BUILD_NUMBER" ]] && echo "Setting iOS build number to: $BUILD_NUMBER"
[[ -n "$ANDROID_VERSION_CODE" ]] && echo "Setting Android versionCode to: $ANDROID_VERSION_CODE"

node -e '
const fs = require("fs")
const pkgPath = process.argv[1]
const version = process.argv[2]
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
pkg.version = version
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
' "$PACKAGE_JSON" "$VERSION"

NEW_VERSION="$VERSION" perl -i -pe 's/(versionName\s+")[^"]+(")/$1 . $ENV{NEW_VERSION} . $2/ge' "$ANDROID_GRADLE"

NEW_VERSION="$VERSION" perl -0777 -i -pe 's{(<key>CFBundleShortVersionString</key>\s*<string>)[^<]*(</string>)}{$1 . $ENV{NEW_VERSION} . $2}ge' "$IOS_PLIST"
NEW_VERSION="$VERSION" perl -i -pe 's/(MARKETING_VERSION = )[^;]+;/$1 . $ENV{NEW_VERSION} . q(;)/ge' "$IOS_PBXPROJ"

if [[ -n "$BUILD_NUMBER" ]]; then
  NEW_BUILD_NUMBER="$BUILD_NUMBER" perl -0777 -i -pe 's{(<key>CFBundleVersion</key>\s*<string>)[^<]*(</string>)}{$1 . $ENV{NEW_BUILD_NUMBER} . $2}ge' "$IOS_PLIST"
  NEW_BUILD_NUMBER="$BUILD_NUMBER" perl -i -pe 's/(CURRENT_PROJECT_VERSION = )[^;]+;/$1 . $ENV{NEW_BUILD_NUMBER} . q(;)/ge' "$IOS_PBXPROJ"
fi

if [[ -n "$ANDROID_VERSION_CODE" ]]; then
  NEW_ANDROID_VERSION_CODE="$ANDROID_VERSION_CODE" perl -i -pe 's/(versionCode\s+)[0-9]+/$1 . $ENV{NEW_ANDROID_VERSION_CODE}/ge' "$ANDROID_GRADLE"
fi

echo
echo "Updated values:"
node -e 'const pkg=require(process.argv[1]); console.log(`package.json version: ${pkg.version}`)' "$PACKAGE_JSON"
rg -n "versionName|versionCode" "$ANDROID_GRADLE" | sed -n '1,4p'
rg -n "CFBundleShortVersionString|CFBundleVersion" "$IOS_PLIST" | sed -n '1,6p'
rg -n "MARKETING_VERSION|CURRENT_PROJECT_VERSION" "$IOS_PBXPROJ" | sed -n '1,8p'

echo
echo "Done."
