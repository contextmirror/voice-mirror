# Voice Mirror — Windows PowerShell Installer
# Usage: iwr -useb https://raw.githubusercontent.com/contextmirror/voice-mirror-electron/main/install.ps1 | iex
#
# Options (via environment variables):
#   $env:VM_INSTALL_METHOD = "git" or "npm"  (default: git)
#   $env:VM_BRANCH = "main"
#   $env:VM_DIR = "C:\voice-mirror-electron"
#   $env:VM_REPO = "https://github.com/contextmirror/voice-mirror-electron.git"
#   $env:VM_SKIP_SETUP = "1"
#   $env:VM_NON_INTERACTIVE = "1"

$ErrorActionPreference = "Continue"

# Allow npm.ps1 and other package-manager scripts to run in this session.
# Without this, a default Windows "Restricted" execution policy blocks npm.ps1
# and the installer silently fails to install dependencies.
# -Scope Process only affects this process, not the system policy.
try { Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force } catch {}

# ─── Config ──────────────────────────────────────────────────────────
$InstallMethod = if ($env:VM_INSTALL_METHOD) { $env:VM_INSTALL_METHOD } else { "git" }
$Branch = if ($env:VM_BRANCH) { $env:VM_BRANCH } else { "main" }
$InstallDir = if ($env:VM_DIR) { $env:VM_DIR } else { Join-Path $HOME "voice-mirror-electron" }
$SkipSetup = $env:VM_SKIP_SETUP -eq "1"
$NonInteractive = $env:VM_NON_INTERACTIVE -eq "1"
$RepoUrl = if ($env:VM_REPO) { $env:VM_REPO } else { "https://github.com/contextmirror/voice-mirror-electron.git" }

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

# ─── Find Winget ─────────────────────────────────────────────────────
# winget lives in WindowsApps which may not be on PATH in iex sessions
function Find-Winget {
    if (Test-Command "winget") { return "winget" }
    $wingetPath = "$env:LOCALAPPDATA\Microsoft\WindowsApps\winget.exe"
    if (Test-Path $wingetPath) { return $wingetPath }
    return $null
}

# ─── Refresh PATH ───────────────────────────────────────────────────
function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}

# ─── Download Helper ─────────────────────────────────────────────────
function Download-File($url, $dest) {
    Write-Info "Downloading from $url..."
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        # WebClient is much faster than Invoke-WebRequest for large files
        (New-Object System.Net.WebClient).DownloadFile($url, $dest)
        return $true
    } catch {
        Write-Fail "Download failed: $_"
        return $false
    }
}

# ─── Run Installer with Elevation ────────────────────────────────────
function Run-Installer($path, $args, $description) {
    Write-Info "Running $description installer..."
    try {
        $proc = Start-Process -FilePath $path -ArgumentList $args -Wait -PassThru
        if ($proc.ExitCode -eq 0 -or $proc.ExitCode -eq 3010) {
            Refresh-Path
            return $true
        }
        Write-Warn "$description installer exited with code $($proc.ExitCode)"
        return $false
    } catch {
        Write-Fail "$description installer failed: $_"
        return $false
    }
}

# ─── Ensure Git ──────────────────────────────────────────────────────
function Ensure-Git {
    if (Test-Command "git") {
        $v = (git --version 2>&1) -replace '[^0-9.]', ''
        Write-Ok "git $v"
        return
    }

    Write-Step "Installing git..."

    $winget = Find-Winget
    if ($winget) {
        Write-Info "Using winget..."
        $out = & $winget install --id Git.Git --accept-source-agreements --accept-package-agreements 2>&1
        Refresh-Path
        if (Test-Command "git") { Write-Ok "git installed"; return }
    }

    if (Test-Command "choco") {
        $out = choco install git -y 2>&1
        Refresh-Path
        if (Test-Command "git") { Write-Ok "git installed via Chocolatey"; return }
    }

    if (Test-Command "scoop") {
        $out = scoop install git 2>&1
        Refresh-Path
        if (Test-Command "git") { Write-Ok "git installed via Scoop"; return }
    }

    # Direct download fallback
    Write-Info "No package manager found, downloading Git installer..."
    $gitInstaller = Join-Path $env:TEMP "Git-installer.exe"
    $gitUrl = "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.2/Git-2.47.1.2-64-bit.exe"
    if (Download-File $gitUrl $gitInstaller) {
        if (Run-Installer $gitInstaller "/VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /COMPONENTS=`"icons,ext\reg\shellhere,assoc,assoc_sh`"" "Git") {
            Remove-Item $gitInstaller -ErrorAction SilentlyContinue
            if (Test-Command "git") { Write-Ok "git installed"; return }
        }
        Remove-Item $gitInstaller -ErrorAction SilentlyContinue
    }

    Write-Fail "Could not install Git. Install manually from https://git-scm.com/download/win"
    exit 1
}

# ─── Ensure Node.js ─────────────────────────────────────────────────
function Ensure-Node {
    Write-Step "Checking Node.js..."

    if (Test-Command "node") {
        $v = (node -v 2>&1) -replace 'v', ''
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

    $winget = Find-Winget
    if ($winget) {
        Write-Info "Using winget..."
        $out = & $winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements 2>&1
        Refresh-Path
        if (Test-Command "node") {
            $v = (node -v 2>&1) -replace 'v', ''
            Write-Ok "Node.js $v installed"
            return
        }
    }

    if (Test-Command "choco") {
        Write-Info "Using Chocolatey..."
        $out = choco install nodejs-lts -y 2>&1
        Refresh-Path
        if (Test-Command "node") {
            $v = (node -v 2>&1) -replace 'v', ''
            Write-Ok "Node.js $v installed via Chocolatey"
            return
        }
    }

    if (Test-Command "scoop") {
        Write-Info "Using Scoop..."
        $out = scoop install nodejs-lts 2>&1
        Refresh-Path
        if (Test-Command "node") {
            $v = (node -v 2>&1) -replace 'v', ''
            Write-Ok "Node.js $v installed via Scoop"
            return
        }
    }

    # Direct download fallback — Node.js LTS MSI
    Write-Info "No package manager worked, downloading Node.js installer..."
    $nodeInstaller = Join-Path $env:TEMP "node-lts-installer.msi"
    $nodeUrl = "https://nodejs.org/dist/v22.13.1/node-v22.13.1-x64.msi"
    if (Download-File $nodeUrl $nodeInstaller) {
        if (Run-Installer "msiexec.exe" "/i `"$nodeInstaller`" /quiet /norestart" "Node.js") {
            Remove-Item $nodeInstaller -ErrorAction SilentlyContinue
            Refresh-Path
            if (Test-Command "node") {
                $v = (node -v 2>&1) -replace 'v', ''
                Write-Ok "Node.js $v installed"
                return
            }
        }
        Remove-Item $nodeInstaller -ErrorAction SilentlyContinue
    }

    Write-Fail "Could not install Node.js. Install manually from https://nodejs.org"
    exit 1
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

    $winget = Find-Winget
    if ($winget) {
        Write-Info "Using winget..."
        $out = & $winget install --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements 2>&1
        Refresh-Path
        if (Test-Command "python") {
            $v = (python --version 2>&1) -replace '[^0-9.]', ''
            Write-Ok "Python $v installed"
            return
        }
    }

    if (Test-Command "choco") {
        Write-Info "Using Chocolatey..."
        $out = choco install python3 -y 2>&1
        Refresh-Path
        if (Test-Command "python") {
            $v = (python --version 2>&1) -replace '[^0-9.]', ''
            Write-Ok "Python $v installed via Chocolatey"
            return
        }
    }

    if (Test-Command "scoop") {
        Write-Info "Using Scoop..."
        $out = scoop install python 2>&1
        Refresh-Path
        if (Test-Command "python") {
            $v = (python --version 2>&1) -replace '[^0-9.]', ''
            Write-Ok "Python $v installed via Scoop"
            return
        }
    }

    # Direct download fallback
    Write-Info "No package manager worked, downloading Python installer..."
    $pyInstaller = Join-Path $env:TEMP "python-installer.exe"
    $pyUrl = "https://www.python.org/ftp/python/3.12.8/python-3.12.8-amd64.exe"
    if (Download-File $pyUrl $pyInstaller) {
        if (Run-Installer $pyInstaller "/quiet InstallAllUsers=0 PrependPath=1 Include_test=0" "Python") {
            Remove-Item $pyInstaller -ErrorAction SilentlyContinue
            Refresh-Path
            if (Test-Command "python") {
                $v = (python --version 2>&1) -replace '[^0-9.]', ''
                Write-Ok "Python $v installed"
                return
            }
        }
        Remove-Item $pyInstaller -ErrorAction SilentlyContinue
    }

    Write-Fail "Could not install Python. Install manually from https://python.org"
    exit 1
}

# ─── Ensure Build Tools ─────────────────────────────────────────────
function Ensure-BuildTools {
    Write-Step "Checking C++ Build Tools..."

    # Check via vswhere
    $vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vsWhere) {
        $vsPath = & $vsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>&1
        if ($vsPath) {
            Write-Ok "Visual Studio Build Tools found"
            return
        }
    }

    Write-Warn "C++ Build Tools not found (needed for native modules like better-sqlite3)"
    if ($NonInteractive) {
        Write-Info "Skipping in non-interactive mode"
        return
    }

    $reply = Read-Host "  Install Visual Studio Build Tools? (Highly recommended) (Y/n)"
    if ($reply -match '^(N|n)') {
        Write-Warn "Skipping - MCP server memory features may not work"
        return
    }

    Write-Info "Installing Visual Studio Build Tools..."

    # Try winget first
    $winget = Find-Winget
    if ($winget) {
        Write-Info "Using winget..."
        $btOut = & $winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" --accept-source-agreements --accept-package-agreements 2>&1
        Refresh-Path
        # Check if it worked
        if (Test-Path $vsWhere) {
            $vsPath = & $vsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>&1
            if ($vsPath) {
                Write-Ok "Visual Studio Build Tools installed"
                return
            }
        }
        Write-Warn "winget install may need admin privileges or a reboot"
    }

    # Direct download fallback with UAC elevation
    Write-Info "Downloading Build Tools installer (this is ~1.5GB, please be patient)..."
    $installerUrl = "https://aka.ms/vs/17/release/vs_BuildTools.exe"
    $installerPath = Join-Path $env:TEMP "vs_BuildTools.exe"
    if (Download-File $installerUrl $installerPath) {
        Write-Info "Running installer with admin privileges (UAC prompt may appear)..."
        try {
            $proc = Start-Process -FilePath $installerPath -ArgumentList "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --wait" -Verb RunAs -Wait -PassThru
            if ($proc.ExitCode -eq 0 -or $proc.ExitCode -eq 3010) {
                Write-Ok "Visual Studio Build Tools installed (may need reboot for full effect)"
                Refresh-Path
            } else {
                Write-Warn "Installer exited with code $($proc.ExitCode)"
            }
        } catch {
            Write-Warn "Installation cancelled or failed (admin privileges may be required)"
        }
        Remove-Item $installerPath -ErrorAction SilentlyContinue
    } else {
        Write-Warn "Could not download Build Tools. Install manually from:"
        Write-Info "https://visualstudio.microsoft.com/visual-cpp-build-tools/"
        Write-Info "Select 'Desktop development with C++' workload"
    }
}

function Ensure-FFmpeg {
    Write-Step "Checking FFmpeg..."

    # Check PATH
    if (Get-Command ffplay -ErrorAction SilentlyContinue) {
        Write-Ok "FFmpeg/ffplay found"
        return
    }

    # Check if we already installed it to the standard location
    $ffmpegBin = Join-Path $env:LOCALAPPDATA "Programs\ffmpeg\bin"
    if (Test-Path (Join-Path $ffmpegBin "ffplay.exe")) {
        $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
        if ($userPath -notlike "*$ffmpegBin*") {
            [System.Environment]::SetEnvironmentVariable("Path", "$userPath;$ffmpegBin", "User")
        }
        $env:Path += ";$ffmpegBin"
        Write-Ok "FFmpeg found at $ffmpegBin"
        return
    }

    Write-Warn "FFmpeg not found (needed for TTS audio playback and voice cloning)"

    # Try winget first
    $winget = Find-Winget
    if ($winget) {
        Write-Info "Installing FFmpeg via winget..."
        & $winget install Gyan.FFmpeg --accept-source-agreements --accept-package-agreements 2>&1 | Out-Null
        Refresh-Path
        if (Get-Command ffplay -ErrorAction SilentlyContinue) {
            Write-Ok "FFmpeg installed via winget"
            return
        }
    }

    # Direct download fallback (GitHub CDN — fast)
    Write-Info "Downloading FFmpeg (~80 MB)..."
    $zipUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
    $zipPath = Join-Path $env:TEMP "ffmpeg.zip"
    $extractDir = Join-Path $env:TEMP "ffmpeg-extract"

    if (Download-File $zipUrl $zipPath) {
        try {
            if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
            Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

            # Find the bin folder inside the extracted archive
            $binDir = Get-ChildItem -Path $extractDir -Recurse -Directory -Filter "bin" | Select-Object -First 1
            if ($binDir -and (Test-Path (Join-Path $binDir.FullName "ffplay.exe"))) {
                New-Item -ItemType Directory -Path $ffmpegBin -Force | Out-Null
                Copy-Item (Join-Path $binDir.FullName "*") $ffmpegBin -Force

                # Add to user PATH persistently
                $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
                if ($userPath -notlike "*$ffmpegBin*") {
                    [System.Environment]::SetEnvironmentVariable("Path", "$userPath;$ffmpegBin", "User")
                }
                $env:Path += ";$ffmpegBin"
                Write-Ok "FFmpeg installed to $ffmpegBin"
            } else {
                Write-Warn "FFmpeg extraction failed"
            }
        } catch {
            Write-Warn "FFmpeg extraction failed: $_"
        }
        Remove-Item $zipPath -ErrorAction SilentlyContinue
        Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
    } else {
        Write-Warn "Could not download FFmpeg. Install manually:"
        Write-Info "  winget install Gyan.FFmpeg"
        Write-Info "  or download from https://ffmpeg.org/download.html"
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
        $out = git fetch origin 2>&1
        $out = git checkout $Branch 2>&1
        $out = git pull origin $Branch 2>&1
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
        $cloneOut = git clone --branch $Branch --depth 1 $RepoUrl $InstallDir 2>&1
        if ($LASTEXITCODE -ne 0) { Write-Fail "Clone failed: $cloneOut"; exit 1 }
        Write-Ok "Cloned to $InstallDir"
    } else {
        Write-Info "Cloning repository..."
        $cloneOut = git clone --branch $Branch --depth 1 $RepoUrl $InstallDir 2>&1
        if ($LASTEXITCODE -ne 0) { Write-Fail "Clone failed: $cloneOut"; exit 1 }
        Write-Ok "Cloned to $InstallDir"
    }
}

# ─── Install Dependencies ───────────────────────────────────────────
function Install-Deps {
    Write-Step "Installing dependencies..."

    Push-Location $InstallDir
    try {
        $npmOut = npm install 2>&1
        if ($LASTEXITCODE -ne 0) { throw "npm exited with code $LASTEXITCODE" }
    } catch {
        Write-Fail "npm install failed: $_"
        Write-Warn "If scripts are disabled, run:  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned"
        Pop-Location; exit 1
    }
    # Verify node_modules actually exists (catches silent failures)
    if (-not (Test-Path (Join-Path $InstallDir "node_modules"))) {
        Write-Fail "npm install produced no node_modules — dependencies are missing"
        Write-Warn "If scripts are disabled, run:  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned"
        Pop-Location; exit 1
    }
    Write-Ok "npm dependencies installed"

    $mcpDir = Join-Path $InstallDir "mcp-server"
    if (Test-Path $mcpDir) {
        Push-Location $mcpDir
        try {
            $npmOut = npm install 2>&1
            if ($LASTEXITCODE -ne 0) { throw "npm exited with code $LASTEXITCODE" }
            Write-Ok "MCP server dependencies installed"
        } catch {
            Write-Warn "MCP server native modules failed: $_"
            Write-Info "Try: cd `"$mcpDir`" && npm install"
            Write-Info "If it persists, check Node.js and build tools compatibility"
        }
        Pop-Location
    }
    Pop-Location
}

# ─── Link CLI ────────────────────────────────────────────────────────
function Link-CLI {
    Write-Step "Setting up CLI..."

    Push-Location $InstallDir
    try { $linkOut = npm link 2>&1 } catch { $linkOut = $_ }
    Pop-Location

    if (Test-Command "voice-mirror") {
        Write-Ok "voice-mirror command available globally"
        return
    }

    # npm link may need admin — try setting user-level npm prefix instead
    Write-Info "Setting up user-level npm prefix..."
    $npmPrefix = Join-Path $env:APPDATA "npm"
    try { $npmOut = npm config set prefix $npmPrefix 2>&1 } catch {}

    Push-Location $InstallDir
    try { $linkOut = npm link 2>&1 } catch { $linkOut = $_ }
    Pop-Location

    # Add npm prefix to user PATH if not already there
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$npmPrefix*") {
        [System.Environment]::SetEnvironmentVariable("Path", "$userPath;$npmPrefix", "User")
        $env:Path = "$env:Path;$npmPrefix"
    }

    if (Test-Command "voice-mirror") {
        Write-Ok "voice-mirror command available globally"
    } else {
        Write-Warn "voice-mirror not on PATH in this session"
        Write-Info "Restart your terminal, then run: voice-mirror"
        Write-Info "Or run directly: node $InstallDir\cli\index.mjs"
    }
}

# ─── Run Setup ───────────────────────────────────────────────────────
function Run-Setup {
    if ($SkipSetup) {
        Write-Info "Skipping setup wizard"
        return
    }

    $setupFile = Join-Path $InstallDir "cli\index.mjs"
    if (-not (Test-Path $setupFile)) {
        Write-Warn "Setup wizard not found at $setupFile"
        return
    }

    Write-Step "Launching setup wizard..."
    Write-Host ""

    Push-Location $InstallDir
    if ($NonInteractive) {
        $setupCmd = @("cli/index.mjs", "setup", "--non-interactive")
        if ($env:VM_OLLAMA_DIR) { $setupCmd += "--ollama-dir"; $setupCmd += $env:VM_OLLAMA_DIR }
        & node $setupCmd
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
try { $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture } catch { $arch = $env:PROCESSOR_ARCHITECTURE }
Write-Info "Platform: Windows/$arch"

Ensure-Git
Ensure-Node
Ensure-Python
Ensure-BuildTools
Ensure-FFmpeg
Ask-InstallDir
Install-Repo
Install-Deps
Link-CLI
Run-Setup
Write-Done
