#!/usr/bin/env bash
#
# Build spectra binaries for all platforms.
# Mirrors .github/workflows/build-binaries.yml
#
# Usage:
#   ./scripts/build-binaries.sh [--skip-deps] [--platform <platform>]
#
# Options:
#   --skip-deps         Skip installing cross-platform dependencies
#   --platform <name>   Build only for specified platform (darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64)
#
# Output:
#   packages/code/binaries/
#     spectra-darwin-arm64.tar.gz
#     spectra-darwin-x64.tar.gz
#     spectra-linux-x64.tar.gz
#     spectra-linux-arm64.tar.gz
#     spectra-windows-x64.zip

set -euo pipefail

cd "$(dirname "$0")/.."

SKIP_DEPS=false
PLATFORM=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-deps)
            SKIP_DEPS=true
            shift
            ;;
        --platform)
            PLATFORM="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Validate platform if specified
if [[ -n "$PLATFORM" ]]; then
    case "$PLATFORM" in
        darwin-arm64|darwin-x64|linux-x64|linux-arm64|windows-x64)
            ;;
        *)
            echo "Invalid platform: $PLATFORM"
            echo "Valid platforms: darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64"
            exit 1
            ;;
    esac
fi

echo "==> Installing dependencies..."
rm -rf node_modules
bun install --force

if [[ "$SKIP_DEPS" == "false" ]]; then
    echo "==> Installing cross-platform native bindings..."
    # bun install only installs optional deps for the current platform
    # We need all platform bindings for bun cross-compilation
    # Use --force to bypass platform checks (os/cpu restrictions in package.json)
    # Install all in one command to avoid removing packages from previous installs
    bun install --force \
        @opentui/core-darwin-arm64@0.3.4 \
        @opentui/core-darwin-x64@0.3.4 \
        @opentui/core-linux-x64@0.3.4 \
        @opentui/core-linux-arm64@0.3.4 \
        @opentui/core-win32-x64@0.3.4
else
    echo "==> Skipping cross-platform native bindings (--skip-deps)"
fi

echo "==> Building all packages (no cache)..."
npx turbo run build --force

echo "==> Building binaries..."
cd packages/code

# Clean previous builds
rm -rf binaries
mkdir -p binaries/{darwin-arm64,darwin-x64,linux-x64,linux-arm64,windows-x64}

# Determine which platforms to build
if [[ -n "$PLATFORM" ]]; then
    PLATFORMS=("$PLATFORM")
else
    PLATFORMS=(darwin-arm64 darwin-x64 linux-x64 linux-arm64 windows-x64)
fi

# Entry point for the CLI
ENTRY="dist/src/cli.js"

for platform in "${PLATFORMS[@]}"; do
    echo "Building for $platform..."
    if [[ "$platform" == "windows-x64" ]]; then
        bun build --compile --target=bun-$platform "$ENTRY" --outfile binaries/$platform/spectra.exe
    else
        bun build --compile --target=bun-$platform "$ENTRY" --outfile binaries/$platform/spectra
    fi
done

echo "==> Copying native libraries and assets..."

# Copy OpenTUI native library per platform
NATIVE_MAP=(
    "darwin-arm64:darwin-arm64:libopentui.dylib"
    "darwin-x64:darwin-x64:libopentui.dylib"
    "linux-x64:linux-x64:libopentui.so"
    "linux-arm64:linux-arm64:libopentui.so"
    "windows-x64:win32-x64:opentui.dll"
)

for entry in "${NATIVE_MAP[@]}"; do
    IFS=':' read -r platform pkg_arch native_file <<< "$entry"
    src="../../node_modules/@opentui/core-${pkg_arch}/${native_file}"
    if [[ -f "$src" ]]; then
        cp "$src" "binaries/$platform/"
        echo "  Copied $native_file -> binaries/$platform/"
    else
        echo "  WARNING: $src not found"
    fi
done

# Copy tree-sitter WASM grammars (all platforms)
echo "  Copying tree-sitter WASM grammars..."
mkdir -p binaries/{darwin-arm64,darwin-x64,linux-x64,linux-arm64,windows-x64}/assets
for grammar_dir in ../../node_modules/@opentui/core/assets/*/; do
    dir_name=$(basename "$grammar_dir")
    for platform in "${PLATFORMS[@]}"; do
        mkdir -p "binaries/$platform/assets/$dir_name"
        cp "$grammar_dir"*.wasm "binaries/$platform/assets/$dir_name/" 2>/dev/null || true
        cp "$grammar_dir"*.scm "binaries/$platform/assets/$dir_name/" 2>/dev/null || true
    done
done

# Copy web-tree-sitter WASM (all platforms)
if [[ -f "../../node_modules/web-tree-sitter/tree-sitter.wasm" ]]; then
    for platform in "${PLATFORMS[@]}"; do
        cp ../../node_modules/web-tree-sitter/tree-sitter.wasm "binaries/$platform/"
    done
    echo "  Copied tree-sitter.wasm"
fi

echo "==> Creating release archives..."

cd binaries

for platform in "${PLATFORMS[@]}"; do
    if [[ "$platform" == "windows-x64" ]]; then
        # Windows (zip)
        echo "Creating spectra-$platform.zip..."
        (cd $platform && zip -r ../spectra-$platform.zip .)
    else
        # Unix platforms (tar.gz) - use wrapper directory for mise compatibility
        echo "Creating spectra-$platform.tar.gz..."
        mv $platform spectra && tar -czf spectra-$platform.tar.gz spectra && mv spectra $platform
    fi
done

# Extract archives for easy local testing
echo "==> Extracting archives for testing..."
for platform in "${PLATFORMS[@]}"; do
    rm -rf $platform
    if [[ "$platform" == "windows-x64" ]]; then
        mkdir -p $platform && (cd $platform && unzip -q ../spectra-$platform.zip)
    else
        tar -xzf spectra-$platform.tar.gz && mv spectra $platform
    fi
done

echo ""
echo "==> Build complete!"
echo "Archives available in packages/code/binaries/"
ls -lh *.tar.gz *.zip 2>/dev/null || true
echo ""
echo "Extracted directories for testing:"
for platform in "${PLATFORMS[@]}"; do
    echo "  binaries/$platform/spectra"
done
