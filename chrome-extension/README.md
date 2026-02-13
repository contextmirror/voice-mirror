# chrome-extension/

Chrome Manifest V3 extension that bridges Voice Mirror to the user's existing browser tabs via the Chrome DevTools Protocol (CDP).

## How It Works

1. Voice Mirror runs a local WebSocket relay server on port 19202 (configurable).
2. The extension connects to this relay as a service worker.
3. Clicking the extension icon on a tab attaches Chrome's `chrome.debugger` API to that tab.
4. CDP commands from Voice Mirror are forwarded through the relay to the attached tab, and CDP events flow back.

This allows Voice Mirror to control browser tabs without launching a separate Chromium instance.

## Architecture

- **Service worker** (`background.js`) -- manages WebSocket connection to the relay, attaches/detaches the Chrome debugger to tabs, and forwards CDP messages bidirectionally.
- **Options page** (`options.html`) -- lets the user configure the relay server port.
- **Manifest** (`manifest.json`) -- MV3 manifest requesting `debugger`, `tabs`, `activeTab`, and `storage` permissions.

## Badge States

| Badge | Meaning |
|-------|---------|
| **ON** (purple) | Tab attached and relaying CDP |
| **...** (amber) | Connecting to relay |
| **!** (red) | Connection error |
| (none) | Tab not attached |

## Supported CDP Overrides

The extension handles several CDP methods specially:

- `Target.createTarget` -- opens a new Chrome tab instead of a CDP target
- `Target.closeTarget` -- closes the Chrome tab
- `Target.activateTarget` -- focuses the tab and its window
- `Runtime.enable` -- resets runtime state to avoid stale contexts

All other CDP methods are forwarded directly to `chrome.debugger.sendCommand`.

## Installation

1. Open `chrome://extensions` and enable Developer mode.
2. Click "Load unpacked" and select this directory.
3. Start Voice Mirror and click the extension icon on any tab to attach.
