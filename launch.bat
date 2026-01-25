@echo off
REM Voice Mirror Electron - Windows Launch Script
REM
REM Launches the Electron app with appropriate flags for Windows.

cd /d "%~dp0"

REM Temporarily rename node_modules\electron so it doesn't shadow the built-in
if exist "node_modules\electron" (
    move "node_modules\electron" "node_modules\_electron_launcher" >nul 2>&1
)

REM Run Electron
"node_modules\_electron_launcher\dist\electron.exe" .

REM Restore
if exist "node_modules\_electron_launcher" (
    move "node_modules\_electron_launcher" "node_modules\electron" >nul 2>&1
)
