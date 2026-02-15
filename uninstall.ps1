# Voice Mirror — Uninstaller (Windows PowerShell)
# Usage: .\uninstall.ps1 [-Dir <path>] [-Purge] [-NonInteractive]

param(
    [string]$Dir = "",
    [switch]$Purge,
    [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"

# ── Defaults ──────────────────────────────────────────────────────────
if (-not $Dir) {
    $Dir = Join-Path $env:USERPROFILE "voice-mirror-electron"
}

# ── Banner ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Voice Mirror Uninstaller" -ForegroundColor Red -NoNewline
Write-Host ""
Write-Host ""

# ── Helper: find Desktop folder ───────────────────────────────────────
function Find-DesktopFolder {
    # 1. Try Windows registry (canonical source, handles OneDrive)
    try {
        $regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders"
        $desktop = (Get-ItemProperty -Path $regPath -Name "Desktop" -ErrorAction Stop).Desktop
        if (Test-Path $desktop) { return $desktop }
    } catch { }

    # 2. Fallback: check common locations
    $candidates = @(
        (Join-Path $env:USERPROFILE "Desktop"),
        (Join-Path $env:USERPROFILE "OneDrive\Desktop"),
        (Join-Path $env:USERPROFILE "OneDrive - Personal\Desktop")
    )
    foreach ($dir in $candidates) {
        if (Test-Path $dir) { return $dir }
    }
    return $null
}

# ── Detect what's installed ───────────────────────────────────────────
$configDir = Join-Path ($env:APPDATA) "voice-mirror-electron"
$desktopDir = Find-DesktopFolder
$shortcut = if ($desktopDir) { Join-Path $desktopDir "Voice Mirror.lnk" } else { $null }
$ffmpegDir = Join-Path ($env:LOCALAPPDATA) "Programs\ffmpeg"

Write-Host "The following items were found:" -ForegroundColor Cyan
Write-Host ""

$foundItems = 0

# Desktop shortcut
if ($shortcut -and (Test-Path $shortcut)) {
    Write-Host "  Shortcut: $shortcut" -ForegroundColor DarkGray
    $foundItems++
} else {
    $shortcut = $null
}

# npm global link
$hasNpmLink = $false
try {
    $npmWhich = & where.exe voice-mirror 2>$null
    if ($npmWhich) {
        Write-Host "  npm link: voice-mirror" -ForegroundColor DarkGray
        $hasNpmLink = $true
        $foundItems++
    }
} catch { }

# Config
$hasConfig = Test-Path $configDir
if ($hasConfig) {
    Write-Host "  Config:   $configDir" -ForegroundColor DarkGray
    $foundItems++
}

# FFmpeg (installed by us)
$hasFFmpeg = Test-Path $ffmpegDir
if ($hasFFmpeg) {
    Write-Host "  FFmpeg:   $ffmpegDir" -ForegroundColor DarkGray
    $foundItems++
}

# Install directory
$hasInstall = Test-Path $Dir
if ($hasInstall) {
    Write-Host "  Install:  $Dir" -ForegroundColor DarkGray
    $foundItems++
}

Write-Host ""

if ($foundItems -eq 0) {
    Write-Host "Nothing to uninstall." -ForegroundColor Cyan
    exit 0
}

# ── Config preservation prompt ────────────────────────────────────────
$removeConfig = $false
if ($Purge) {
    $removeConfig = $true
} elseif ($hasConfig -and -not $NonInteractive) {
    $answer = Read-Host "Keep configuration files for future reinstall? [Y/n]"
    if ($answer -eq "n" -or $answer -eq "N") {
        $removeConfig = $true
    }
}

# ── Final confirmation ────────────────────────────────────────────────
if (-not $NonInteractive) {
    Write-Host ""
    $confirm = Read-Host "This will remove Voice Mirror. Continue? [y/N]"
    if ($confirm -ne "y" -and $confirm -ne "Y") {
        Write-Host "Uninstall cancelled." -ForegroundColor Yellow
        exit 0
    }
    Write-Host ""
}

# ── Execute removal ───────────────────────────────────────────────────

# 1. Desktop shortcut
if ($shortcut) {
    Remove-Item -Force $shortcut -ErrorAction SilentlyContinue
    Write-Host "  Removed shortcut" -ForegroundColor Green
}

# 2. npm global link
if ($hasNpmLink) {
    try {
        & npm unlink -g voice-mirror 2>$null
        Write-Host "  Removed npm global link" -ForegroundColor Green
    } catch {
        Write-Host "  Could not remove npm link" -ForegroundColor Yellow
    }
}

# 3. Config
if ($removeConfig -and $hasConfig) {
    Remove-Item -Recurse -Force $configDir -ErrorAction SilentlyContinue
    Write-Host "  Removed config: $configDir" -ForegroundColor Green
} elseif ($hasConfig) {
    Write-Host "  Config preserved: $configDir" -ForegroundColor Cyan
}

# 4. FFmpeg
if ($hasFFmpeg) {
    Remove-Item -Recurse -Force $ffmpegDir -ErrorAction SilentlyContinue
    Write-Host "  Removed FFmpeg: $ffmpegDir" -ForegroundColor Green
}

# 5. Install directory
if ($hasInstall) {
    Remove-Item -Recurse -Force $Dir -ErrorAction SilentlyContinue
    Write-Host "  Removed install directory: $Dir" -ForegroundColor Green
}

Write-Host ""
Write-Host "Voice Mirror has been uninstalled. Thanks for trying it out!" -ForegroundColor Green
Write-Host ""
