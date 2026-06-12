#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MODULE_DIR="$(cd "$CORE_DIR/.." && pwd)"
JNI_LIBS_DIR="$MODULE_DIR/android/src/main/jniLibs"

rustup target add \
  aarch64-linux-android \
  armv7-linux-androideabi \
  i686-linux-android \
  x86_64-linux-android

if ! command -v cargo-ndk >/dev/null 2>&1; then
  cargo install cargo-ndk --locked
fi

rm -rf "$JNI_LIBS_DIR"
mkdir -p "$JNI_LIBS_DIR"

(
  cd "$CORE_DIR"
  cargo ndk \
    --target arm64-v8a \
    --target armeabi-v7a \
    --target x86 \
    --target x86_64 \
    --platform 26 \
    --output-dir "$JNI_LIBS_DIR" \
    build --release
)
