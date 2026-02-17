#!/usr/bin/env bash
# Quick restart script for Voice Mirror Electron
# Kills all related processes before starting fresh

echo "Stopping Voice Mirror..."

# Kill Electron
pkill -9 -f "electron.*Voice Mirror" 2>/dev/null
pkill -9 -f "electron \\." 2>/dev/null

# Kill Wayland orb helper
pkill -9 -f "wayland-orb" 2>/dev/null

# Kill voice-core binary
pkill -9 -f "voice-core" 2>/dev/null

# Kill Claude processes spawned by Voice Mirror (but not main Claude Code sessions)
# Match on the Voice Mirror prompt text to avoid killing unrelated claude instances
pkill -9 -f "claude.*Voice Mirror" 2>/dev/null
pkill -9 -f "claude.*voice-claude" 2>/dev/null

# Also kill any node MCP servers that might be dangling
pkill -9 -f "voice-mirror-electron.*mcp" 2>/dev/null

sleep 1

echo "Starting Voice Mirror Electron..."
cd "$(dirname "$0")"
npm start &

echo "Done!"
