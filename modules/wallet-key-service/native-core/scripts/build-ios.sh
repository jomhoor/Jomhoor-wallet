#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MODULE_DIR="$(cd "$CORE_DIR/.." && pwd)"
OUTPUT_DIR="$MODULE_DIR/ios/libs/WalletKeyCrypto.xcframework"
SIMULATOR_DIR="$CORE_DIR/target/ios-simulator"

rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios

cargo build --manifest-path "$CORE_DIR/Cargo.toml" --release --target aarch64-apple-ios
cargo build --manifest-path "$CORE_DIR/Cargo.toml" --release --target aarch64-apple-ios-sim
cargo build --manifest-path "$CORE_DIR/Cargo.toml" --release --target x86_64-apple-ios

rm -rf "$SIMULATOR_DIR" "$OUTPUT_DIR"
mkdir -p "$SIMULATOR_DIR" "$(dirname "$OUTPUT_DIR")" "$CORE_DIR/include/WalletKeyCrypto"

cp "$CORE_DIR/include/wallet_key_crypto.h" \
  "$CORE_DIR/include/WalletKeyCrypto/wallet_key_crypto.h"
cp "$CORE_DIR/include/module.modulemap" \
  "$CORE_DIR/include/WalletKeyCrypto/module.modulemap"

lipo -create \
  "$CORE_DIR/target/aarch64-apple-ios-sim/release/libwallet_key_crypto.a" \
  "$CORE_DIR/target/x86_64-apple-ios/release/libwallet_key_crypto.a" \
  -output "$SIMULATOR_DIR/libwallet_key_crypto.a"

xcodebuild -create-xcframework \
  -library "$CORE_DIR/target/aarch64-apple-ios/release/libwallet_key_crypto.a" \
  -headers "$CORE_DIR/include/WalletKeyCrypto" \
  -library "$SIMULATOR_DIR/libwallet_key_crypto.a" \
  -headers "$CORE_DIR/include/WalletKeyCrypto" \
  -output "$OUTPUT_DIR"
