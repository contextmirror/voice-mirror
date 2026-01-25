#!/bin/bash
# Voice Mirror Electron - Linux/macOS Launch Script
#
# Launches the Electron app with appropriate flags.
# For Windows, use launch.bat instead.

cd "$(dirname "$0")"

# Temporarily rename node_modules/electron so it doesn't shadow the built-in
mv node_modules/electron node_modules/_electron_launcher 2>/dev/null

# Platform-specific flags
ELECTRON_FLAGS=""

if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux: disable GPU acceleration and sandbox (helps with some systems)
    ELECTRON_FLAGS="--disable-gpu --no-sandbox"
fi

# Run Electron
./node_modules/_electron_launcher/dist/electron . $ELECTRON_FLAGS

# Restore
mv node_modules/_electron_launcher node_modules/electron 2>/dev/null
