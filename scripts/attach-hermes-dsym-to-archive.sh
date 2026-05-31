#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/attach-hermes-dsym-to-archive.sh [--archive <path-to.xcarchive>] [--rn-version <react-native-version>]

Behavior:
  - Finds Hermes binary inside the archive app bundle.
  - Downloads the matching React Native Hermes release dSYM artifact from Maven Central.
  - Verifies UUID match between archive Hermes binary and downloaded iPhoneOS Hermes dSYM.
  - Copies hermes.framework.dSYM into <archive>/dSYMs only when UUIDs match.

Defaults:
  --archive    latest archive from ~/Library/Developer/Xcode/Archives
  --rn-version read from ./node_modules/react-native/package.json
USAGE
}

ARCHIVE_PATH="/Users/shooresh/Library/Developer/Xcode/Archives/2026-05-31/Jomhoor 2026-05-31, 17.19.xcarchive"
RN_VERSION="0.76.9"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --archive)
      ARCHIVE_PATH="${2:-}"
      shift 2
      ;;
    --rn-version)
      RN_VERSION="${2:-}"
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

if [[ -z "$ARCHIVE_PATH" ]]; then
  ARCHIVE_PATH="$(ls -td "$HOME"/Library/Developer/Xcode/Archives/*/*.xcarchive 2>/dev/null | head -n1 || true)"
fi

if [[ -z "$ARCHIVE_PATH" || ! -d "$ARCHIVE_PATH" ]]; then
  echo "Could not find archive. Pass --archive <path-to.xcarchive>." >&2
  exit 1
fi

if [[ -z "$RN_VERSION" ]]; then
  if [[ -f node_modules/react-native/package.json ]]; then
    RN_VERSION="$(node -p "require('./node_modules/react-native/package.json').version")"
  else
    echo "node_modules/react-native/package.json not found. Pass --rn-version <version>." >&2
    exit 1
  fi
fi

APP_PATH="$(find "$ARCHIVE_PATH/Products/Applications" -maxdepth 1 -name '*.app' | head -n1)"
if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
  echo "Could not locate .app inside archive: $ARCHIVE_PATH" >&2
  exit 1
fi

HERMES_BIN="$APP_PATH/Frameworks/hermes.framework/hermes"
if [[ ! -f "$HERMES_BIN" ]]; then
  echo "Hermes binary not found in app: $HERMES_BIN" >&2
  exit 1
fi

APP_UUID="$(dwarfdump --uuid "$HERMES_BIN" | awk '{print toupper($2); exit}')"
if [[ -z "$APP_UUID" ]]; then
  echo "Failed to read Hermes binary UUID from: $HERMES_BIN" >&2
  exit 1
fi

URL="https://repo1.maven.org/maven2/com/facebook/react/react-native-artifacts/${RN_VERSION}/react-native-artifacts-${RN_VERSION}-hermes-framework-dSYM-release.tar.gz"

TMP_DIR="$(mktemp -d /tmp/hermes-dsym-attach.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

ARTIFACT="$TMP_DIR/hermes-framework-dSYM-release.tar.gz"

echo "Archive: $ARCHIVE_PATH"
echo "App: $APP_PATH"
echo "React Native version: $RN_VERSION"
echo "Expected Hermes UUID: $APP_UUID"
echo "Downloading: $URL"

curl -fL "$URL" -o "$ARTIFACT"
tar -xzf "$ARTIFACT" -C "$TMP_DIR"

DSYM_SRC="$TMP_DIR/iphoneos/hermes.framework.dSYM"
DSYM_DWARF="$DSYM_SRC/Contents/Resources/DWARF/hermes"

if [[ ! -f "$DSYM_DWARF" ]]; then
  echo "Downloaded artifact does not contain iPhoneOS hermes.framework.dSYM" >&2
  find "$TMP_DIR" -type d -name '*.dSYM' -print >&2 || true
  exit 1
fi

DSYM_UUID="$(dwarfdump --uuid "$DSYM_DWARF" | awk '{print toupper($2); exit}')"
if [[ -z "$DSYM_UUID" ]]; then
  echo "Failed to read UUID from downloaded dSYM: $DSYM_DWARF" >&2
  exit 1
fi

echo "Downloaded iPhoneOS Hermes dSYM UUID: $DSYM_UUID"

if [[ "$APP_UUID" != "$DSYM_UUID" ]]; then
  echo "UUID mismatch. Refusing to copy dSYM." >&2
  exit 1
fi

mkdir -p "$ARCHIVE_PATH/dSYMs"
DST_DSYM="$ARCHIVE_PATH/dSYMs/hermes.framework.dSYM"
rm -rf "$DST_DSYM"
rsync -a "$DSYM_SRC" "$ARCHIVE_PATH/dSYMs/"

COPIED_UUID="$(dwarfdump --uuid "$DST_DSYM/Contents/Resources/DWARF/hermes" | awk '{print toupper($2); exit}')"
if [[ "$COPIED_UUID" != "$APP_UUID" ]]; then
  echo "Post-copy UUID verification failed. Expected $APP_UUID, got $COPIED_UUID" >&2
  exit 1
fi

echo "Attached dSYM: $DST_DSYM"
echo "Verified UUID: $COPIED_UUID"

# CHECK BEFORE UPLOADING AN ARCHIVE:
# ARCHIVE="/Users/shooresh/Library/Developer/Xcode/Archives/2026-05-20/IraniansVote 2026-05-20, 23.49.xcarchive"
# APP="$(find "$ARCHIVE/Products/Applications" -maxdepth 1 -name '*.app' | head -n1)"

# dwarfdump --uuid "$APP/Frameworks/hermes.framework/hermes"
# dwarfdump --uuid "$ARCHIVE/dSYMs/hermes.framework.dSYM/Contents/Resources/DWARF/hermes"
