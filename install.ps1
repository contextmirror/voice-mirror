# Voice Mirror — Windows PowerShell Installer
# Usage: iwr -useb https://raw.githubusercontent.com/nayballs/voice-mirror-electron/main/install.ps1 | iex
#
# Options (via environment variables):
#   $env:VM_INSTALL_METHOD = "git" or "npm"  (default: git)
#   $env:VM_BRANCH = "main"
#   $env:VM_DIR = "C:\voice-mirror-electron"
#   $env:VM_SKIP_SETUP = "1"
#   $env:VM_NON_INTERACTIVE = "1"

$ErrorActionPreference = "Stop"

# ─── Config ──────────────────────────────────────────────────────────
$InstallMethod = if ($env:VM_INSTALL_METHOD) { $env:VM_INSTALL_METHOD } else { "git" }
$Branch = if ($env:VM_BRANCH) { $env:VM_BRANCH } else { "main" }
$InstallDir = if ($env:VM_DIR) { $env:VM_DIR } else { Join-Path $HOME "voice-mirror-electron" }
$SkipSetup = $env:VM_SKIP_SETUP -eq "1"
$NonInteractive = $env:VM_NON_INTERACTIVE -eq "1"
$RepoUrl = "https://github.com/nayballs/voice-mirror-electron.git"

# ─── Colors ──────────────────────────────────────────────────────────
function Write-Banner {
    Write-Host ""
    Write-Host "    " -NoNewline
    Write-Host ([char]0x25C9) -ForegroundColor Magenta -NoNewline
    Write-Host " Voice Mirror" -ForegroundColor Magenta
    Write-Host "    Voice-controlled AI agent overlay for your entire computer." -ForegroundColor DarkGray
    Write-Host ""
}

function Write-Info($msg)  { Write-Host "  " -NoNewline; Write-Host ([char]0x25B8) -ForegroundColor Blue -NoNewline; Write-Host " $msg" }
function Write-Ok($msg)    { Write-Host "  " -NoNewline; Write-Host ([char]0x2713) -ForegroundColor Green -NoNewline; Write-Host " $msg" }
function Write-Warn($msg)  { Write-Host "  " -NoNewline; Write-Host "!" -ForegroundColor Yellow -NoNewline; Write-Host " $msg" }
function Write-Fail($msg)  { Write-Host "  " -NoNewline; Write-Host ([char]0x2717) -ForegroundColor Red -NoNewline; Write-Host " $msg" }
function Write-Step($msg)  { Write-Host ""; Write-Host "  $msg" -ForegroundColor Magenta }

function Test-Command($cmd) {
    try { Get-Command $cmd -ErrorAction Stop | Out-Null; return $true }
    catch { return $false }
}

# ─── Ensure Git ──────────────────────────────────────────────────────
function Ensure-Git {
    if (Test-Command "git") {
        $v = (git --version) -replace '[^0-9.]', ''
        Write-Ok "git $v"
        return
    }

    Write-Step "Installing git..."
    if (Test-Command "winget") {
        winget install --id Git.Git --accept-source-agreements --accept-package-agreements
    } elseif (Test-Command "choco") {
        choco install git -y
    } elseif (Test-Command "scoop") {
        scoop install git
    } else {
        Write-Fail "Git not found. Install from https://git-scm.com/download/win"
        exit 1
    }

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    if (Test-Command "git") {
        Write-Ok "git installed"
    } else {
        Write-Fail "Git install failed. Restart your terminal and try again."
        exit 1
    }
}

# ─── Ensure Node.js ─────────────────────────────────────────────────
function Ensure-Node {
    Write-Step "Checking Node.js..."

    if (Test-Command "node") {
        $v = (node -v) -replace 'v', ''
        $major = [int]($v.Split('.')[0])
        if ($major -ge 18) {
            Write-Ok "Node.js $v"
            return
        }
        Write-Warn "Node.js $v found (need 18+)"
    } else {
        Write-Info "Node.js not found"
    }

    Write-Info "Installing Node.js..."
    if (Test-Command "winget") {
        Write-Info "Using winget..."
        winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    } elseif (Test-Command "choco") {
        Write-Info "Using Chocolatey..."
        choco install nodejs-lts -y
    } elseif (Test-Command "scoop") {
        Write-Info "Using Scoop..."
        scoop install nodejs-lts
    } else {
        Write-Fail "No package manager found. Install Node.js from https://nodejs.org"
        Write-Fail "Or install winget (built-in on Windows 11) / Chocolatey / Scoop first."
        exit 1
    }

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    if (Test-Command "node") {
        $v = (node -v) -replace 'v', ''
        Write-Ok "Node.js $v installed"
    } else {
        Write-Fail "Could not install Node.js. Restart your terminal and try again."
        exit 1
    }
}

# ─── Ensure Python ──────────────────────────────────────────────────
function Ensure-Python {
    Write-Step "Checking Python..."

    foreach ($cmd in @("python3", "python")) {
        if (Test-Command $cmd) {
            $v = & $cmd --version 2>&1 | Select-String -Pattern '\d+\.\d+\.\d+' | ForEach-Object { $_.Matches.Value }
            if ($v) {
                $parts = $v.Split('.')
                if ([int]$parts[0] -ge 3 -and [int]$parts[1] -ge 9) {
                    Write-Ok "Python $v ($cmd)"
                    return
                }
            }
        }
    }

    Write-Info "Python 3.9+ not found, installing..."
    if (Test-Command "winget") {
        Write-Info "Using winget..."
        winget install --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
    } elseif (Test-Command "choco") {
        Write-Info "Using Chocolatey..."
        choco install python3 -y
    } elseif (Test-Command "scoop") {
        Write-Info "Using Scoop..."
        scoop install python
    } else {
        Write-Fail "Install Python from https://python.org"
        exit 1
    }

    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    if (Test-Command "python") {
        $v = (python --version 2>&1) -replace '[^0-9.]', ''
        Write-Ok "Python $v installed"
    } else {
        Write-Fail "Could not install Python. Restart your terminal and try again."
        exit 1
    }
}

# ─── Ask Install Location ───────────────────────────────────────────
function Ask-InstallDir {
    if ($NonInteractive -or $env:VM_DIR) { return }

    Write-Host ""
    Write-Host "  Install location: " -NoNewline -ForegroundColor Cyan
    Write-Host $InstallDir -ForegroundColor DarkGray
    $reply = Read-Host "  Press Enter to accept, or type a new path"
    if ($reply.Trim()) {
        $script:InstallDir = $reply.Trim()
    }
}

# ─── Clone / Update Repo ────────────────────────────────────────────
function Install-Repo {
    Write-Step "Installing Voice Mirror..."

    if (Test-Path (Join-Path $InstallDir ".git")) {
        Write-Info "Existing installation found at $InstallDir"
        Write-Info "Updating..."
        Push-Location $InstallDir
        git fetch origin
        git checkout $Branch
        git pull origin $Branch
        Pop-Location
        Write-Ok "Updated to latest"
    } elseif (Test-Path $InstallDir) {
        # Existing directory — clone inside it as a subfolder
        $script:InstallDir = Join-Path $InstallDir "voice-mirror-electron"
        if (Test-Path $InstallDir) {
            Write-Fail "Directory already exists: $InstallDir"
            exit 1
        }
        Write-Info "Installing into $InstallDir"
        $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
        $cloneOut = git clone --branch $Branch --depth 1 $RepoUrl $InstallDir 2>&1
        $ErrorActionPreference = $prevEAP
        if ($LASTEXITCODE -ne 0) { Write-Fail "Clone failed: $cloneOut"; exit 1 }
        Write-Ok "Cloned to $InstallDir"
    } else {
        Write-Info "Cloning repository..."
        $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
        $cloneOut = git clone --branch $Branch --depth 1 $RepoUrl $InstallDir 2>&1
        $ErrorActionPreference = $prevEAP
        if ($LASTEXITCODE -ne 0) { Write-Fail "Clone failed: $cloneOut"; exit 1 }
        Write-Ok "Cloned to $InstallDir"
    }
}

# ─── Install Dependencies ───────────────────────────────────────────
function Install-Deps {
    Write-Step "Installing dependencies..."

    Push-Location $InstallDir
    $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    $npmOut = npm install 2>&1
    $ErrorActionPreference = $prevEAP
    if ($LASTEXITCODE -ne 0) { Write-Fail "npm install failed"; Pop-Location; exit 1 }
    Write-Ok "npm dependencies installed"

    $mcpDir = Join-Path $InstallDir "mcp-server"
    if (Test-Path $mcpDir) {
        Push-Location $mcpDir
        $ErrorActionPreference = "Continue"
        $npmOut = npm install 2>&1
        $ErrorActionPreference = $prevEAP
        if ($LASTEXITCODE -ne 0) { Write-Fail "MCP npm install failed"; Pop-Location; Pop-Location; exit 1 }
        Pop-Location
        Write-Ok "MCP server dependencies installed"
    }
    Pop-Location
}

# ─── Link CLI ────────────────────────────────────────────────────────
function Link-CLI {
    Write-Step "Setting up CLI..."

    Push-Location $InstallDir
    try {
        npm link 2>&1 | Select-Object -Last 1
        Write-Ok "voice-mirror command linked globally"
    } catch {
        Write-Warn "npm link failed. You may need to run as Administrator."
        Write-Info "Or run directly: node $InstallDir\cli\index.mjs"
    }
    Pop-Location

    if (Test-Command "voice-mirror") {
        Write-Ok "Run 'voice-mirror' from anywhere"
    } else {
        Write-Warn "voice-mirror not on PATH. Add npm global bin to PATH:"
        $npmBin = (npm config get prefix) + "\node_modules\.bin"
        Write-Info "  $npmBin"
        Write-Info "Or run directly: node $InstallDir\cli\index.mjs"
    }
}

# ─── Run Setup ───────────────────────────────────────────────────────
function Run-Setup {
    if ($SkipSetup) {
        Write-Info "Skipping setup wizard"
        return
    }

    Write-Step "Launching setup wizard..."
    Write-Host ""

    Push-Location $InstallDir
    if ($NonInteractive) {
        node cli/index.mjs setup --non-interactive
    } else {
        node cli/index.mjs setup
    }
    Pop-Location
}

# ─── Done ────────────────────────────────────────────────────────────
function Write-Done {
    Write-Host ""
    Write-Host "  Installation complete!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Commands:" -ForegroundColor DarkGray
    Write-Host "    voice-mirror setup " -ForegroundColor Cyan -NoNewline; Write-Host "   Re-run setup wizard"
    Write-Host "    voice-mirror start " -ForegroundColor Cyan -NoNewline; Write-Host "   Launch Voice Mirror"
    Write-Host "    voice-mirror doctor" -ForegroundColor Cyan -NoNewline; Write-Host "   Check system health"
    Write-Host ""
    Write-Host "  Installed to: $InstallDir" -ForegroundColor DarkGray
    Write-Host ""
}

# ─── Main ────────────────────────────────────────────────────────────
Write-Banner
Write-Info "Platform: Windows/$([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture)"

Ensure-Git
Ensure-Node
Ensure-Python
Ask-InstallDir
Install-Repo
Install-Deps
Link-CLI
Run-Setup
Write-Done
