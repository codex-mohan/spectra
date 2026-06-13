#!/usr/bin/env bash
# Copy native libraries for a specific platform into the binaries directory.
# Usage: ./scripts/copy-native-libs.sh <platform>
# Platforms: darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64

set -euo pipefail

cd "$(dirname "$0")/.."

PLATFORM="$1"
BINARIES_DIR="packages/code/binaries/$PLATFORM"

# Map platform to OpenTUI package name
case "$PLATFORM" in
    darwin-arm64)  PKG_ARCH="darwin-arm64";  NATIVE="libopentui.dylib" ;;
    darwin-x64)    PKG_ARCH="darwin-x64";    NATIVE="libopentui.dylib" ;;
    linux-x64)     PKG_ARCH="linux-x64";     NATIVE="libopentui.so" ;;
    linux-arm64)   PKG_ARCH="linux-arm64";   NATIVE="libopentui.so" ;;
    windows-x64)   PKG_ARCH="win32-x64";     NATIVE="opentui.dll" ;;
    *) echo "Unknown platform: $PLATFORM"; exit 1 ;;
esac

echo "==> Copying native libraries for $PLATFORM..."

# Copy OpenTUI native library
SRC="node_modules/@opentui/core-${PKG_ARCH}/${NATIVE}"
if [[ -f "$SRC" ]]; then
    cp "$SRC" "$BINARIES_DIR/"
    echo "  Copied $NATIVE"
else
    echo "  WARNING: $SRC not found"
fi

# Copy tree-sitter WASM grammars
if [[ -d "node_modules/@opentui/core/assets" ]]; then
    mkdir -p "$BINARIES_DIR/assets"
    for grammar_dir in node_modules/@opentui/core/assets/*/; do
        dir_name=$(basename "$grammar_dir")
        mkdir -p "$BINARIES_DIR/assets/$dir_name"
        cp "$grammar_dir"*.wasm "$BINARIES_DIR/assets/$dir_name/" 2>/dev/null || true
        cp "$grammar_dir"*.scm "$BINARIES_DIR/assets/$dir_name/" 2>/dev/null || true
    done
    echo "  Copied tree-sitter grammars"
fi

# Copy web-tree-sitter WASM
if [[ -f "node_modules/web-tree-sitter/tree-sitter.wasm" ]]; then
    cp node_modules/web-tree-sitter/tree-sitter.wasm "$BINARIES_DIR/"
    echo "  Copied tree-sitter.wasm"
fi

echo "==> Done."
