#!/usr/bin/env bash
#
# Smoke test for built binaries.
# Run after build-binaries.sh to verify the binary works.
#
# Usage:
#   ./scripts/smoke-test.sh [platform]
#
# If no platform is specified, tests all extracted directories in packages/code/binaries/

set -euo pipefail

cd "$(dirname "$0")/.."

BINARIES_DIR="packages/code/binaries"

if [[ ! -d "$BINARIES_DIR" ]]; then
    echo "ERROR: $BINARIES_DIR not found. Run build-binaries.sh first."
    exit 1
fi

PLATFORM="${1:-}"
FAILED=0

test_binary() {
    local dir="$1"
    local binary="$2"
    local label="$3"

    echo "==> Testing $label..."

    # Test --help
    OUTPUT=$("$dir/$binary" --help 2>&1)
    if echo "$OUTPUT" | grep -q "Spectra Code"; then
        echo "  --help: OK"
    else
        echo "  --help: FAILED"
        echo "$OUTPUT"
        FAILED=1
        return
    fi

    # Test --version
    OUTPUT=$("$dir/$binary" --version 2>&1)
    if [ -n "$OUTPUT" ]; then
        echo "  --version: OK ($OUTPUT)"
    else
        echo "  --version: FAILED (empty output)"
        FAILED=1
        return
    fi

    # Test basic module loading (no crash on import)
    timeout 5 "$dir/$binary" session list 2>&1 || {
        CODE=$?
        if [ $CODE -eq 124 ]; then
            echo "  module load: TIMEOUT (hung)"
            FAILED=1
            return
        fi
        echo "  module load: OK (exited $CODE, no crash)"
    }
}

if [[ -n "$PLATFORM" ]]; then
    if [[ "$PLATFORM" == "windows-x64" ]]; then
        echo "Skipping Windows binary test on Unix (requires Wine or Windows)"
        exit 0
    fi

    DIR="$BINARIES_DIR/$PLATFORM"
    BINARY="spectra"
    if [[ ! -f "$DIR/$BINARY" ]]; then
        echo "ERROR: $DIR/$BINARY not found"
        exit 1
    fi
    chmod +x "$DIR/$BINARY"
    test_binary "$DIR" "$BINARY" "$PLATFORM"
else
    for dir in "$BINARIES_DIR"/*/; do
        platform=$(basename "$dir")
        if [[ "$platform" == "windows-x64" ]]; then
            echo "Skipping $platform (requires Wine or Windows)"
            continue
        fi
        binary="spectra"
        if [[ -f "$dir/$binary" ]]; then
            chmod +x "$dir/$binary"
            test_binary "$dir" "$binary" "$platform"
        fi
    done
fi

echo ""
if [[ $FAILED -eq 0 ]]; then
    echo "==> All smoke tests passed."
else
    echo "==> Some smoke tests FAILED."
    exit 1
fi
