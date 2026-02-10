"""Global hotkey listener for push-to-talk and dictation.

Captures keyboard and mouse events system-wide (even when another
window has focus). Supports multiple key bindings with a single set
of OS-level hooks for reliable event suppression on Windows.

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
    """Listens for configurable hotkeys globally across all applications.

    Supports multiple key bindings (e.g. PTT + dictation), each writing
    to a separate trigger file. Uses a SINGLE set of OS-level hooks so
    event suppression works reliably on Windows.
    """

    def __init__(self, data_dir: str | None = None, trigger_filename: str = "ptt_trigger.json"):
        from shared.paths import get_data_dir
        self._data_dir = Path(data_dir) if data_dir else get_data_dir()
        self._default_trigger = trigger_filename
        self._data_dir.mkdir(parents=True, exist_ok=True)

        self._running = False
        self._lock = threading.Lock()
        self._backend = None     # 'evdev' or 'pynput'

        # Bindings: list of dicts with keys:
        #   key_name, trigger_path, key_type, target_key, active,
        #   evdev_code, evdev_is_mouse
        self._bindings = []

        # pynput state (shared across all bindings)
        self._kb_listener = None
        self._mouse_listener = None

        # evdev state
        self._evdev_thread = None

    # ── Public API ──────────────────────────────────────────────

    def add_binding(self, key_name: str, trigger_filename: str):
        """Register a key binding. Call before start()."""
        self._bindings.append({
            "key_name": key_name,
            "trigger_path": self._data_dir / trigger_filename,
            "key_type": None,
            "target_key": None,
            "active": False,
            "evdev_code": None,
            "evdev_is_mouse": False,
        })

    def start(self, key_name: str | None = None) -> bool:
        """Start listening for hotkeys globally.

        Args:
            key_name: If provided, adds a single binding using the default
                     trigger filename (backward compat). If None, uses
                     bindings added via add_binding().

        Returns:
            True if started successfully
        """
        if key_name is not None and not self._bindings:
            self.add_binding(key_name, self._default_trigger)

        if not self._bindings:
            print("[GlobalHotkey] No bindings registered")
            return False

        self._running = True
        for b in self._bindings:
            b["active"] = False

        # On Linux with Wayland, prefer evdev for true global capture
        if _is_linux() and _is_wayland():
            ok = self._start_evdev()
            if ok:
                return True
            print("[GlobalHotkey] evdev failed, falling back to pynput (may not work on Wayland)")

        # Fallback: pynput (works on X11, macOS, Windows)
        return self._start_pynput()

    def stop(self):
        """Stop all listeners."""
        self._running = False
        # Stop evdev
        if self._evdev_thread and self._evdev_thread.is_alive():
            self._evdev_thread = None
        # Stop pynput
        if self._kb_listener:
            self._kb_listener.stop()
            self._kb_listener = None
        if self._mouse_listener:
            self._mouse_listener.stop()
            self._mouse_listener = None
        for b in self._bindings:
            b["active"] = False
        print("[GlobalHotkey] Stopped")

    def update_key(self, key_name: str, trigger_filename: str | None = None):
        """Change a key binding at runtime. Restarts all listeners.

        Args:
            key_name: New key string
            trigger_filename: Which binding to update (by filename).
                            If None, updates the first binding.
        """
        if trigger_filename:
            for b in self._bindings:
                if b["trigger_path"].name == trigger_filename:
                    b["key_name"] = key_name
                    break
        elif self._bindings:
            self._bindings[0]["key_name"] = key_name
        self.stop()
        self.start()

    # ── evdev backend (Linux/Wayland) ─────────────────────────

    def _start_evdev(self) -> bool:
        """Start listening via evdev (reads /dev/input directly)."""
        try:
            import evdev
        except ImportError:
            print("[GlobalHotkey] evdev not available")
            return False

        # Parse all bindings for evdev codes
        any_parsed = False
        all_codes = set()
        for b in self._bindings:
            name = b["key_name"].lower().strip()
            if name in _EVDEV_MOUSE_MAP:
                b["evdev_code"] = _EVDEV_MOUSE_MAP[name]
                b["evdev_is_mouse"] = True
                all_codes.add(b["evdev_code"])
                any_parsed = True
            elif name in _EVDEV_KEY_MAP:
                b["evdev_code"] = _EVDEV_KEY_MAP[name]
                b["evdev_is_mouse"] = False
                all_codes.add(b["evdev_code"])
                any_parsed = True
            else:
                print(f"[GlobalHotkey] Unknown evdev key: {b['key_name']}")

        if not any_parsed:
            return False

        # Find input devices
        devices = [evdev.InputDevice(p) for p in evdev.list_devices()]
        if not devices:
            print("[GlobalHotkey] No /dev/input devices accessible. "
                  "Add user to 'input' group: sudo usermod -aG input $USER")
            return False

        # Filter to devices that have any of our target codes
        target_devices = []
        for dev in devices:
            caps = dev.capabilities(verbose=False)
            key_caps = set(caps.get(1, []))
            if key_caps & all_codes:
                target_devices.append(dev)
            else:
                dev.close()

        if not target_devices:
            print(f"[GlobalHotkey] No device has any of the target codes")
            for dev in devices:
                dev.close()
            return False

        self._backend = "evdev"
        names = [b["key_name"] for b in self._bindings if b.get("evdev_code") is not None]
        print(f"[GlobalHotkey] evdev: Listening for {', '.join(names)} on "
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

        # Build code->bindings lookup
        code_to_bindings = {}
        for b in self._bindings:
            code = b.get("evdev_code")
            if code is not None:
                code_to_bindings.setdefault(code, []).append(b)

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
                            bindings = code_to_bindings.get(event.code)
                            if not bindings:
                                continue
                            for b in bindings:
                                with self._lock:
                                    if event.value == 1 and not b["active"]:
                                        b["active"] = True
                                        self._write_trigger(b["trigger_path"], "start")
                                    elif event.value == 0 and b["active"]:
                                        b["active"] = False
                                        self._write_trigger(b["trigger_path"], "stop")
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

    def _start_pynput(self) -> bool:
        """Start listening via pynput."""
        # Parse all bindings
        for b in self._bindings:
            parsed = self._parse_key_pynput(b["key_name"])
            if parsed is None:
                print(f"[GlobalHotkey] Unknown key: {b['key_name']}")
                continue
            b["key_type"], b["target_key"] = parsed

        valid = [b for b in self._bindings if b["target_key"] is not None]
        if not valid:
            print("[GlobalHotkey] No valid key bindings")
            return False

        self._backend = "pynput"

        try:
            from pynput.keyboard import Listener as KeyboardListener
            from pynput.mouse import Listener as MouseListener

            kb_kwargs = dict(
                on_press=self._on_press,
                on_release=self._on_release,
            )
            mouse_kwargs = dict(
                on_click=self._on_click,
            )

            # On Windows, suppress hotkey events to prevent the system
            # "ding" beep and unwanted side-effects (e.g. browser back
            # on Mouse4). Uses a SINGLE hook for all bindings.
            if platform.system() == "Windows":
                kb_kwargs["win32_event_filter"] = self._win32_kb_filter
                mouse_kwargs["win32_event_filter"] = self._win32_mouse_filter

            self._kb_listener = KeyboardListener(**kb_kwargs)
            self._kb_listener.start()

            self._mouse_listener = MouseListener(**mouse_kwargs)
            self._mouse_listener.start()

            names = [b["key_name"] for b in valid]
            print(f"[GlobalHotkey] Listening for keys: {', '.join(names)}")
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
            # Arrow keys (DOM sends ArrowUp/ArrowDown/ArrowLeft/ArrowRight)
            "arrowup": Key.up, "arrowdown": Key.down,
            "arrowleft": Key.left, "arrowright": Key.right,
            "up": Key.up, "down": Key.down,
            "left": Key.left, "right": Key.right,
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
        """Mouse click handler — checks all mouse bindings."""
        if not self._running:
            return
        for b in self._bindings:
            if b["key_type"] != "mouse" or b["target_key"] != button:
                continue
            with self._lock:
                if pressed and not b["active"]:
                    b["active"] = True
                    self._write_trigger(b["trigger_path"], "start")
                elif not pressed and b["active"]:
                    b["active"] = False
                    self._write_trigger(b["trigger_path"], "stop")

    def _on_press(self, key):
        """Key press handler — checks all keyboard bindings."""
        if not self._running:
            return
        for b in self._bindings:
            if b["key_type"] != "keyboard":
                continue
            if not self._matches_key(key, b["target_key"]):
                continue
            with self._lock:
                if not b["active"]:
                    b["active"] = True
                    self._write_trigger(b["trigger_path"], "start")

    def _on_release(self, key):
        """Key release handler — checks all keyboard bindings."""
        if not self._running:
            return
        for b in self._bindings:
            if b["key_type"] != "keyboard":
                continue
            if not self._matches_key(key, b["target_key"]):
                continue
            with self._lock:
                if b["active"]:
                    b["active"] = False
                    self._write_trigger(b["trigger_path"], "stop")

    @staticmethod
    def _matches_key(key, target) -> bool:
        """Check if a pynput key event matches a target key."""
        from pynput.keyboard import Key, KeyCode

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

    # ── Windows event suppression ──────────────────────────────

    @staticmethod
    def _get_target_vk(target) -> int | None:
        """Get the Windows virtual-key code for a pynput key."""
        from pynput.keyboard import Key, KeyCode

        if isinstance(target, Key):
            return target.value.vk
        if isinstance(target, KeyCode):
            if target.vk is not None:
                return target.vk
            # KeyCode.from_char() leaves vk=None. Derive it from the char:
            # Windows VK codes for 0-9 (0x30-0x39) and A-Z (0x41-0x5A)
            # match ASCII, so ord(char.upper()) gives the correct VK.
            if target.char and len(target.char) == 1 and target.char.isalnum():
                return ord(target.char.upper())
        return None

    def _win32_kb_filter(self, msg, data):
        """Suppress registered keyboard hotkeys on Windows.

        When suppress_event() is called, pynput skips its own _on_press/
        _on_release callbacks. So we must handle trigger writing here.
        """
        has_kb = any(b["key_type"] == "keyboard" for b in self._bindings)
        if not has_kb:
            return True

        # WM_KEYDOWN/WM_SYSKEYDOWN = press, WM_KEYUP/WM_SYSKEYUP = release
        is_down = msg in (0x0100, 0x0104)
        is_up = msg in (0x0101, 0x0105)

        for b in self._bindings:
            if b["key_type"] != "keyboard":
                continue
            target_vk = self._get_target_vk(b["target_key"])
            if target_vk is not None and data.vkCode == target_vk:
                # Handle press/release directly (suppress_event skips callbacks)
                with self._lock:
                    if is_down and not b["active"]:
                        b["active"] = True
                        self._write_trigger(b["trigger_path"], "start")
                    elif is_up and b["active"]:
                        b["active"] = False
                        self._write_trigger(b["trigger_path"], "stop")
                self._kb_listener.suppress_event()
                return

    def _win32_mouse_filter(self, msg, data):
        """Suppress registered mouse buttons on Windows.

        When suppress_event() is called, pynput skips its own _on_click
        callback. So we must handle trigger writing here.
        """
        has_mouse = any(b["key_type"] == "mouse" for b in self._bindings)
        if not has_mouse:
            return True

        from pynput.mouse import Button

        btn4 = getattr(Button, "x1", None) or getattr(Button, "button8", None)
        btn5 = getattr(Button, "x2", None) or getattr(Button, "button9", None)

        for b in self._bindings:
            if b["key_type"] != "mouse":
                continue
            target = b["target_key"]
            matched = False
            pressed = False

            # Middle button: WM_MBUTTONDOWN=0x207, WM_MBUTTONUP=0x208
            if target == Button.middle:
                if msg == 0x0207:
                    matched, pressed = True, True
                elif msg == 0x0208:
                    matched, pressed = True, False
            # X buttons: WM_XBUTTONDOWN=0x20B, WM_XBUTTONUP=0x20C
            elif msg in (0x020B, 0x020C):
                x_button = (data.mouseData >> 16) & 0xFFFF
                if (target == btn4 and x_button == 1) or (target == btn5 and x_button == 2):
                    matched = True
                    pressed = (msg == 0x020B)

            if matched:
                self._mouse_listener.suppress_event()
                # Handle press/release directly (callbacks won't fire)
                with self._lock:
                    if pressed and not b["active"]:
                        b["active"] = True
                        self._write_trigger(b["trigger_path"], "start")
                    elif not pressed and b["active"]:
                        b["active"] = False
                        self._write_trigger(b["trigger_path"], "stop")
                return

    # ── Trigger file ────────────────────────────────────────────

    def _write_trigger(self, trigger_path: Path, action: str):
        """Write trigger JSON for voice_agent to pick up.

        Uses atomic write (write to temp, then os.replace) to prevent
        voice_agent from reading a partially-written JSON file.
        """
        try:
            temp_path = str(trigger_path) + '.tmp'
            with open(temp_path, 'w', encoding='utf-8') as f:
                json.dump({
                    "action": action,
                    "timestamp": datetime.now().isoformat()
                }, f)
            os.replace(temp_path, trigger_path)  # Atomic on all platforms
        except Exception as e:
            print(f"[GlobalHotkey] Failed to write trigger: {e}")
