#!/usr/bin/env bash
set -euo pipefail

PACKAGE="@mohanscodex/spectra-code"
BOLD="$(tput bold 2>/dev/null || printf '')"
RESET="$(tput sgr0 2>/dev/null || printf '')"
GREEN="$(tput setaf 2 2>/dev/null || printf '')"
YELLOW="$(tput setaf 3 2>/dev/null || printf '')"
RED="$(tput setaf 1 2>/dev/null || printf '')"
CYAN="$(tput setaf 6 2>/dev/null || printf '')"

header()  { printf '%s\n' "${BOLD}${CYAN}Spectra Code${RESET} ${BOLD}Installer${RESET}"; echo; }
success() { printf '%s\n' "${GREEN}${1}${RESET}"; }
warn()    { printf '%s\n' "${YELLOW}${1}${RESET}"; }
err()     { printf '%s\n' "${RED}${1}${RESET}"; }

header

has_bun=false
has_node=false

if command -v bun &>/dev/null; then
    has_bun=true
    BUN_VERSION=$(bun -v 2>/dev/null)
    echo "Bun             : ${GREEN}${BUN_VERSION}${RESET}"
fi

if command -v node &>/dev/null; then
    has_node=true
    echo "Node.js         : ${GREEN}$(node -v)${RESET}"
fi

echo "Platform        : ${GREEN}$(uname -s) $(uname -m)${RESET}"
echo ""

if [ "$has_bun" = true ]; then
    echo "Installing ${BOLD}${PACKAGE}${RESET} via bun ..."
    echo ""
    bun add -g "$PACKAGE"
elif [ "$has_node" = true ]; then
    NODE_VERSION=$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1 || echo "0")
    if [ "$NODE_VERSION" -lt 18 ]; then
        err "Node.js >= 18 is required. Current: $(node -v)"
        echo "Upgrade Node.js (https://nodejs.org) then run this script again."
        exit 1
    fi

    warn "Bun not found. Installing via npm — CLIs work but the TUI requires Bun."
    warn "Install Bun: https://bun.sh"
    echo ""

    if command -v pnpm &>/dev/null; then
        pnpm add -g "$PACKAGE"
    elif command -v yarn &>/dev/null; then
        yarn global add "$PACKAGE"
    else
        npm install -g "$PACKAGE"
    fi
else
    err "Neither Bun nor Node.js found."
    echo ""
    echo "Spectra Code requires Bun for the TUI experience."
    echo "Install Bun:  ${BOLD}https://bun.sh${RESET}"
    echo "Or Node.js:   ${BOLD}https://nodejs.org${RESET}"
    echo ""
    echo "Then run this script again."
    exit 1
fi

echo ""
success "Spectra Code installed successfully!"
echo ""
echo "  Run:  ${BOLD}spectra${RESET}"
echo "  Help: ${BOLD}spectra --help${RESET}"
echo ""
