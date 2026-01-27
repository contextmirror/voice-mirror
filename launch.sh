#!/bin/bash
# Voice Mirror Electron - Linux/macOS Launch Script
#
# Launches the Electron app with appropriate flags.
# For Windows, use launch.bat instead.

cd "$(dirname "$0")"

# IMPORTANT: Unset ELECTRON_RUN_AS_NODE if set (VSCode sets this)
# This env var makes Electron run as plain Node.js instead of full Electron
unset ELECTRON_RUN_AS_NODE

# Temporarily rename node_modules/electron so it doesn't shadow the built-in
mv node_modules/electron node_modules/_electron_launcher 2>/dev/null

# Platform-specific flags
ELECTRON_FLAGS=""

if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux: disable GPU acceleration and sandbox (helps with some systems)
    ELECTRON_FLAGS="--disable-gpu --no-sandbox"

    # Ensure user is in 'input' group for global push-to-talk (evdev access)
    if ! id -Gn | grep -qw input; then
        if groups "$USER" 2>/dev/null | grep -qw input; then
            echo "[Voice Mirror] Note: 'input' group not active in this session."
            echo "  The app will use 'sg input' to access input devices."
        else
            echo "[Voice Mirror] Adding user to 'input' group for global push-to-talk..."
            echo "  This requires sudo (one-time setup)."
            sudo usermod -aG input "$USER"
            echo "  Done. The app will use 'sg input' for this session."
            echo "  After your next login, this won't be needed."
        fi
    fi
fi

# Run Electron
./node_modules/_electron_launcher/dist/electron . $ELECTRON_FLAGS

# Restore
mv node_modules/_electron_launcher node_modules/electron 2>/dev/null
