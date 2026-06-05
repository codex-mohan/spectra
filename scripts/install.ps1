# Spectra Code Windows Installer
# Usage: powershell -ExecutionPolicy Bypass -File install.ps1
# Or:    iwr -useb https://raw.githubusercontent.com/codex-mohan/spectra/main/scripts/install.ps1 | iex

$ErrorActionPreference = "Stop"
$Package = "@mohanscodex/spectra-code"

Write-Host ""
Write-Host "Spectra Code " -NoNewline -ForegroundColor Cyan
Write-Host "Installer" -ForegroundColor White
Write-Host ""

$hasBun = $false
$hasNode = $false

if (Get-Command bun -ErrorAction SilentlyContinue) {
    $hasBun = $true
    $bunVer = bun -v 2>$null
    Write-Host "Bun             : $bunVer" -ForegroundColor Green
}

if (Get-Command node -ErrorAction SilentlyContinue) {
    $hasNode = $true
    Write-Host "Node.js         : $(node -v)" -ForegroundColor Green
}

Write-Host "Platform        : Windows" -ForegroundColor Green
Write-Host ""

if ($hasBun) {
    Write-Host "Installing $Package via bun ..."
    Write-Host ""
    bun add -g $Package
} elseif ($hasNode) {
    $nodeVersion = (node -v) -replace "^v", ""
    $nodeMajor = [int]($nodeVersion -split "\.")[0]

    if ($nodeMajor -lt 18) {
        Write-Host "Error: Node.js >= 18 is required. Current: $(node -v)" -ForegroundColor Red
        Write-Host "Upgrade Node.js (https://nodejs.org) then run this script again."
        exit 1
    }

    Write-Host "Bun not found. Installing via npm — CLIs work but the TUI requires Bun." -ForegroundColor Yellow
    Write-Host "Install Bun: https://bun.sh" -ForegroundColor Yellow
    Write-Host ""

    if (Get-Command pnpm -ErrorAction SilentlyContinue) {
        pnpm add -g $Package
    } elseif (Get-Command yarn -ErrorAction SilentlyContinue) {
        yarn global add $Package
    } else {
        npm install -g $Package
    }
} else {
    Write-Host "Error: Neither Bun nor Node.js found." -ForegroundColor Red
    Write-Host ""
    Write-Host "Spectra Code requires Bun for the TUI experience."
    Write-Host "Install Bun:  https://bun.sh"
    Write-Host "Or Node.js:   https://nodejs.org"
    Write-Host ""
    Write-Host "Then run this script again."
    exit 1
}

Write-Host ""
Write-Host "Spectra Code installed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "  Run:  spectra" -ForegroundColor White
Write-Host "  Help: spectra --help" -ForegroundColor White
Write-Host ""
