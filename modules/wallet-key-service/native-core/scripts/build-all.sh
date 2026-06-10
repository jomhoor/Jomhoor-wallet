#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

node "$SCRIPT_DIR/generate-poseidon-constants.cjs"
"$SCRIPT_DIR/build-ios.sh"
"$SCRIPT_DIR/build-android.sh"
