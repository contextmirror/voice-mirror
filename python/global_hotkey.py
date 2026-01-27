"""Global push-to-talk hotkey listener.

Captures keyboard and mouse events system-wide (even when another
window has focus), matching Discord's PTT behavior. Writes to
ptt_trigger.json so voice_agent.py can pick it up.

Platform support:
  - Linux (Wayland): evdev (needs input group)
  - Linux (X11): pynput/python-xlib
  - macOS: pynput/Quartz (needs Accessibility permission)
  - Windows: pynput/Win32 hooks
"""

import json
import os
import platform
import threading
from datetime import datetime
from pathlib import Path


def _is_wayland() -> bool:
    """Check if running under Wayland."""
    return os.environ.get("XDG_SESSION_TYPE") == "wayland"


def _is_linux() -> bool:
    return platform.system() == "Linux"


# ── evdev key/button code mappings (Linux kernel input codes) ──────

# From linux/input-event-codes.h
_EVDEV_KEY_MAP = {
    "space": 57,
    "f1": 59, "f2": 60, "f3": 61, "f4": 62,
    "f5": 63, "f6": 64, "f7": 65, "f8": 66,
    "f9": 67, "f10": 68, "f11": 87, "f12": 88,
    "f13": 183, "f14": 184, "f15": 185,
    "scrolllock": 70,
    "pause": 119,
    "insert": 110,
    "home": 102,
    "pageup": 104,
    "delete": 111,
    "end": 107,
    "pagedown": 109,
    "capslock": 58,
    "numlock": 69,
    "tab": 15,
    "escape": 1,
    # Number row
    "1": 2, "2": 3, "3": 4, "4": 5, "5": 6,
    "6": 7, "7": 8, "8": 9, "9": 10, "0": 11,
    # Letters (QWERTY layout)
    "a": 30, "b": 48, "c": 46, "d": 32, "e": 18,
    "f": 33, "g": 34, "h": 35, "i": 23, "j": 36,
    "k": 37, "l": 38, "m": 50, "n": 49, "o": 24,
    "p": 25, "q": 16, "r": 19, "s": 31, "t": 20,
    "u": 22, "v": 47, "w": 17, "x": 45, "y": 21,
    "z": 44,
    # Numpad
    "numpad0": 82, "numpad1": 79, "numpad2": 80, "numpad3": 81,
    "numpad4": 75, "numpad5": 76, "numpad6": 77,
    "numpad7": 71, "numpad8": 72, "numpad9": 73,
    "kp0": 82, "kp1": 79, "kp2": 80, "kp3": 81,
    "kp4": 75, "kp5": 76, "kp6": 77,
    "kp7": 71, "kp8": 72, "kp9": 73,
    "num0": 82, "num1": 79, "num2": 80, "num3": 81,
    "num4": 75, "num5": 76, "num6": 77,
    "num7": 71, "num8": 72, "num9": 73,
}

# Mouse buttons in evdev (BTN_* codes from input-event-codes.h)
_EVDEV_MOUSE_MAP = {
    "mousebutton3": 0x112,   # BTN_MIDDLE (274)
    "mouse3": 0x112,
    "middleclick": 0x112,
    "mousebutton4": 0x113,   # BTN_SIDE (275)
    "mouse4": 0x113,
    "xbutton1": 0x113,
    "mousebutton5": 0x114,   # BTN_EXTRA (276)
    "mouse5": 0x114,
    "xbutton2": 0x114,
}


class GlobalHotkeyListener:
    """Listens for a configurable PTT key globally across all applications."""

    def __init__(self, data_dir: str | None = None):
        self._data_dir = Path(data_dir) if data_dir else (
            Path.home() / ".config" / "voice-mirror-electron" / "data"
        )
        self._ptt_path = self._data_dir / "ptt_trigger.json"
        self._data_dir.mkdir(parents=True, exist_ok=True)

        self._active = False     # Currently held down
        self._running = False
        self._lock = threading.Lock()
        self._backend = None     # 'evdev' or 'pynput'

        # evdev state
        self._evdev_thread = None
        self._evdev_target_code = None
        self._evdev_is_mouse = False

        # pynput state
        self._target_key = None
        self._key_type = None
        self._kb_listener = None
        self._mouse_listener = None

    # ── Public API ──────────────────────────────────────────────

    def start(self, key_name: str) -> bool:
        """Start listening for the given PTT key globally.

        Args:
            key_name: Key string from config, e.g. 'MouseButton4', 'Space', 'F13'

        Returns:
            True if started successfully
        """
        self._running = True
        self._active = False

        # On Linux with Wayland, prefer evdev for true global capture
        if _is_linux() and _is_wayland():
            ok = self._start_evdev(key_name)
            if ok:
                return True
            print("[GlobalHotkey] evdev failed, falling back to pynput (may not work on Wayland)")

        # Fallback: pynput (works on X11, macOS, Windows)
        return self._start_pynput(key_name)

    def stop(self):
        """Stop all listeners."""
        self._running = False
        # Stop evdev
        if self._evdev_thread and self._evdev_thread.is_alive():
            # Thread checks _running flag and will exit
            self._evdev_thread = None
        # Stop pynput
        if self._kb_listener:
            self._kb_listener.stop()
            self._kb_listener = None
        if self._mouse_listener:
            self._mouse_listener.stop()
            self._mouse_listener = None
        self._active = False
        print("[GlobalHotkey] Stopped")

    def update_key(self, key_name: str):
        """Change the PTT key at runtime."""
        self.stop()
        self.start(key_name)

    # ── evdev backend (Linux/Wayland) ─────────────────────────

    def _start_evdev(self, key_name: str) -> bool:
        """Start listening via evdev (reads /dev/input directly)."""
        try:
            import evdev
        except ImportError:
            print("[GlobalHotkey] evdev not available")
            return False

        name = key_name.lower().strip()

        # Parse key to evdev code
        if name in _EVDEV_MOUSE_MAP:
            self._evdev_target_code = _EVDEV_MOUSE_MAP[name]
            self._evdev_is_mouse = True
        elif name in _EVDEV_KEY_MAP:
            self._evdev_target_code = _EVDEV_KEY_MAP[name]
            self._evdev_is_mouse = False
        else:
            print(f"[GlobalHotkey] Unknown evdev key: {key_name}")
            return False

        # Find input devices
        devices = [evdev.InputDevice(p) for p in evdev.list_devices()]
        if not devices:
            print("[GlobalHotkey] No /dev/input devices accessible. "
                  "Add user to 'input' group: sudo usermod -aG input $USER")
            return False

        # Filter to keyboards and mice that have our target key/button
        target_devices = []
        for dev in devices:
            caps = dev.capabilities(verbose=False)
            # EV_KEY = 1
            key_caps = caps.get(1, [])
            if self._evdev_target_code in key_caps:
                target_devices.append(dev)
            else:
                dev.close()

        if not target_devices:
            print(f"[GlobalHotkey] No device has code {self._evdev_target_code} for '{key_name}'")
            for dev in devices:
                dev.close()
            return False

        self._backend = "evdev"
        print(f"[GlobalHotkey] evdev: Listening for code {self._evdev_target_code} "
              f"({'mouse' if self._evdev_is_mouse else 'keyboard'}) on "
              f"{len(target_devices)} device(s): {[d.name for d in target_devices]}")

        # Start reader thread
        self._evdev_thread = threading.Thread(
            target=self._evdev_reader,
            args=(target_devices,),
            daemon=True,
        )
        self._evdev_thread.start()
        return True

    def _evdev_reader(self, devices):
        """Read events from evdev devices in a background thread."""
        import selectors
        import evdev

        sel = selectors.DefaultSelector()
        for dev in devices:
            sel.register(dev, selectors.EVENT_READ)

        try:
            while self._running:
                events = sel.select(timeout=0.1)
                for key, _ in events:
                    dev = key.fileobj
                    try:
                        for event in dev.read():
                            if not self._running:
                                return
                            # EV_KEY = 1, value: 0=up, 1=down, 2=repeat
                            if event.type != 1:
                                continue
                            if event.code != self._evdev_target_code:
                                continue
                            with self._lock:
                                if event.value == 1 and not self._active:
                                    self._active = True
                                    self._write_trigger("start")
                                elif event.value == 0 and self._active:
                                    self._active = False
                                    self._write_trigger("stop")
                    except OSError:
                        # Device disconnected
                        pass
        finally:
            sel.close()
            for dev in devices:
                try:
                    dev.close()
                except Exception:
                    pass

    # ── pynput backend (X11, macOS, Windows) ──────────────────

    def _start_pynput(self, key_name: str) -> bool:
        """Start listening via pynput."""
        parsed = self._parse_key_pynput(key_name)
        if parsed is None:
            print(f"[GlobalHotkey] Unknown PTT key: {key_name}")
            return False

        self._key_type, self._target_key = parsed
        self._backend = "pynput"

        try:
            from pynput.keyboard import Listener as KeyboardListener
            from pynput.mouse import Listener as MouseListener

            self._kb_listener = KeyboardListener(
                on_press=self._on_press,
                on_release=self._on_release
            )
            self._kb_listener.start()

            self._mouse_listener = MouseListener(
                on_click=self._on_click
            )
            self._mouse_listener.start()

            print(f"[GlobalHotkey] pynput: Listening for {self._key_type} key: {key_name} -> {self._target_key!r}")
            return True
        except Exception as e:
            print(f"[GlobalHotkey] Failed to start pynput: {e}")
            self._running = False
            return False

    @staticmethod
    def _parse_key_pynput(key_name: str) -> tuple[str, object] | None:
        """Parse a key name string into (type, pynput_key_object)."""
        from pynput.keyboard import Key, KeyCode
        from pynput.mouse import Button

        name = key_name.lower().strip()

        # Mouse buttons
        btn4 = getattr(Button, "x1", None) or getattr(Button, "button8", None)
        btn5 = getattr(Button, "x2", None) or getattr(Button, "button9", None)

        mouse_map = {
            "mousebutton3": Button.middle,
            "mouse3": Button.middle,
            "middleclick": Button.middle,
        }
        if btn4:
            mouse_map.update({"mousebutton4": btn4, "mouse4": btn4, "xbutton1": btn4})
        if btn5:
            mouse_map.update({"mousebutton5": btn5, "mouse5": btn5, "xbutton2": btn5})
        if name in mouse_map:
            return ("mouse", mouse_map[name])

        # Special keyboard keys
        kb_map = {
            "space": Key.space,
            "f1": Key.f1, "f2": Key.f2, "f3": Key.f3, "f4": Key.f4,
            "f5": Key.f5, "f6": Key.f6, "f7": Key.f7, "f8": Key.f8,
            "f9": Key.f9, "f10": Key.f10, "f11": Key.f11, "f12": Key.f12,
            "f13": Key.f13, "f14": Key.f14, "f15": Key.f15,
            "scrolllock": Key.scroll_lock,
            "pause": Key.pause,
            "insert": Key.insert,
            "home": Key.home,
            "pageup": Key.page_up,
            "delete": Key.delete,
            "end": Key.end,
            "pagedown": Key.page_down,
            "capslock": Key.caps_lock,
            "numlock": Key.num_lock,
            "tab": Key.tab,
            "escape": Key.esc,
        }
        if name in kb_map:
            return ("keyboard", kb_map[name])

        # Numpad keys
        import re as _re
        numpad_match = _re.match(r"^(?:numpad|kp|num)(\d)$", name)
        if numpad_match:
            digit = int(numpad_match.group(1))
            return ("keyboard", KeyCode.from_vk(65456 + digit))

        # Single character (a-z, 0-9)
        if len(name) == 1 and name.isalnum():
            return ("keyboard", KeyCode.from_char(name))

        return None

    # ── pynput event handlers ─────────────────────────────────

    def _on_click(self, _x, _y, button, pressed):
        """Mouse click handler."""
        if not self._running:
            return
        if self._target_key != button:
            return
        with self._lock:
            if pressed and not self._active:
                self._active = True
                self._write_trigger("start")
            elif not pressed and self._active:
                self._active = False
                self._write_trigger("stop")

    def _on_press(self, key):
        """Key press handler."""
        if not self._running:
            return
        if not self._matches_key(key):
            return
        with self._lock:
            if not self._active:
                self._active = True
                self._write_trigger("start")

    def _on_release(self, key):
        """Key release handler."""
        if not self._running:
            return
        if not self._matches_key(key):
            return
        with self._lock:
            if self._active:
                self._active = False
                self._write_trigger("stop")

    def _matches_key(self, key) -> bool:
        """Check if a pynput key event matches our target."""
        from pynput.keyboard import Key, KeyCode

        target = self._target_key

        if isinstance(target, Key) and isinstance(key, Key):
            return key == target

        if isinstance(target, KeyCode) and isinstance(key, KeyCode):
            if target.vk is not None and key.vk is not None:
                if target.vk == key.vk:
                    return True
            if target.char and key.char:
                if target.char.lower() == key.char.lower():
                    return True

        return False

    # ── Trigger file ────────────────────────────────────────────

    def _write_trigger(self, action: str):
        """Write PTT trigger JSON for voice_agent to pick up."""
        try:
            with open(self._ptt_path, "w") as f:
                json.dump({
                    "action": action,
                    "timestamp": datetime.now().isoformat()
                }, f)
            print(f"[GlobalHotkey] PTT {action}")
        except Exception as e:
            print(f"[GlobalHotkey] Failed to write trigger: {e}")
