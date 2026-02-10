"""Cross-platform text injection via clipboard + simulated paste."""

import platform
import subprocess
import time


def inject_text(text: str) -> bool:
    """Write text to clipboard and simulate Ctrl/Cmd+V paste.

    Returns True on success, False on failure or empty text.
    """
    if not text or not text.strip():
        return False

    system = platform.system()

    try:
        _write_clipboard(text, system)
        time.sleep(0.05)  # 50ms for clipboard to settle
        _simulate_paste(system)
        return True
    except Exception as e:
        print(f"Text injection failed: {e}")
        return False


def _write_clipboard(text: str, system: str):
    """Write text to the system clipboard."""
    if system == "Windows":
        # Pipe text via stdin to PowerShell Set-Clipboard (safe, Unicode-aware)
        p = subprocess.Popen(
            ["powershell", "-NoProfile", "-Command", "$input | Set-Clipboard"],
            stdin=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        p.communicate(input=text.encode("utf-8"))
    elif system == "Darwin":
        p = subprocess.Popen(["pbcopy"], stdin=subprocess.PIPE)
        p.communicate(input=text.encode("utf-8"))
    else:
        # Linux: prefer wl-copy (Wayland), fall back to xclip (X11)
        import shutil

        if shutil.which("wl-copy"):
            p = subprocess.Popen(["wl-copy"], stdin=subprocess.PIPE)
            p.communicate(input=text.encode("utf-8"))
        elif shutil.which("xclip"):
            p = subprocess.Popen(
                ["xclip", "-selection", "clipboard"],
                stdin=subprocess.PIPE,
            )
            p.communicate(input=text.encode("utf-8"))
        else:
            raise RuntimeError("No clipboard utility found (need wl-copy or xclip)")


def _simulate_paste(system: str):
    """Simulate Ctrl+V (or Cmd+V on macOS) using pynput."""
    from pynput.keyboard import Controller, Key

    kb = Controller()

    if system == "Darwin":
        with kb.pressed(Key.cmd):
            kb.tap("v")
    else:
        with kb.pressed(Key.ctrl):
            kb.tap("v")
