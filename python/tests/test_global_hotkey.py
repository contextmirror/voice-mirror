"""Tests for GlobalHotkeyListener win32 event suppression."""

import sys
import types
from pathlib import Path
from unittest.mock import MagicMock, patch

# Ensure the python package root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest


@pytest.fixture
def listener():
    """Create a GlobalHotkeyListener with a temp data dir."""
    import tempfile
    from global_hotkey import GlobalHotkeyListener

    with tempfile.TemporaryDirectory() as tmp:
        yield GlobalHotkeyListener(data_dir=tmp)


def _add_mouse_binding(listener, target_key, trigger="test_trigger.json"):
    """Helper: add a parsed mouse binding to the listener."""
    listener._bindings.append({
        "key_name": "test",
        "trigger_path": listener._data_dir / trigger,
        "key_type": "mouse",
        "target_key": target_key,
        "active": False,
        "evdev_code": None,
        "evdev_is_mouse": False,
    })


def _add_kb_binding(listener, target_key, trigger="test_trigger.json"):
    """Helper: add a parsed keyboard binding to the listener."""
    listener._bindings.append({
        "key_name": "test",
        "trigger_path": listener._data_dir / trigger,
        "key_type": "keyboard",
        "target_key": target_key,
        "active": False,
        "evdev_code": None,
        "evdev_is_mouse": False,
    })


class TestGetTargetVk:
    """Test _get_target_vk returns correct virtual-key codes."""

    def test_special_key(self, listener):
        from pynput.keyboard import Key
        vk = listener._get_target_vk(Key.space)
        assert vk is not None
        assert isinstance(vk, int)

    def test_keycode_with_vk(self, listener):
        from pynput.keyboard import KeyCode
        vk = listener._get_target_vk(KeyCode.from_vk(0x70))  # F1
        assert vk == 0x70

    def test_keycode_from_char_derives_vk(self, listener):
        from pynput.keyboard import KeyCode
        # KeyCode.from_char() has vk=None, but we should derive it
        target = KeyCode.from_char("5")
        assert target.vk is None  # Confirm from_char leaves vk=None
        vk = listener._get_target_vk(target)
        assert vk == ord("5")  # 0x35 = VK_5

    def test_keycode_from_char_letter(self, listener):
        from pynput.keyboard import KeyCode
        target = KeyCode.from_char("a")
        vk = listener._get_target_vk(target)
        assert vk == ord("A")  # 0x41 = VK_A

    def test_mouse_button_returns_none(self, listener):
        from pynput.mouse import Button
        vk = listener._get_target_vk(Button.middle)
        assert vk is None


class TestWin32KbFilter:
    """Test _win32_kb_filter suppresses only registered keyboard keys."""

    def test_suppresses_matching_key(self, listener):
        from pynput.keyboard import Key
        _add_kb_binding(listener, Key.space)
        target_vk = listener._get_target_vk(Key.space)

        listener._kb_listener = MagicMock()

        data = types.SimpleNamespace(vkCode=target_vk)
        listener._win32_kb_filter(0x0100, data)  # WM_KEYDOWN

        listener._kb_listener.suppress_event.assert_called_once()

    def test_ignores_non_matching_key(self, listener):
        from pynput.keyboard import Key
        _add_kb_binding(listener, Key.space)
        target_vk = listener._get_target_vk(Key.space)

        listener._kb_listener = MagicMock()

        data = types.SimpleNamespace(vkCode=target_vk + 1)
        listener._win32_kb_filter(0x0100, data)

        listener._kb_listener.suppress_event.assert_not_called()

    def test_suppresses_char_key(self, listener):
        """Keys like '4' or '5' (from mouse drivers remapping to keyboard)."""
        from pynput.keyboard import KeyCode
        _add_kb_binding(listener, KeyCode.from_char("5"))

        listener._kb_listener = MagicMock()

        # VK_5 = 0x35 = 53
        data = types.SimpleNamespace(vkCode=ord("5"))
        listener._win32_kb_filter(0x0100, data)  # WM_KEYDOWN

        listener._kb_listener.suppress_event.assert_called_once()

    def test_writes_trigger_on_suppress(self, listener):
        """Suppressed events must write triggers (callbacks won't fire)."""
        from pynput.keyboard import KeyCode
        _add_kb_binding(listener, KeyCode.from_char("5"))

        listener._kb_listener = MagicMock()
        listener._running = True

        # Key down → trigger "start"
        data = types.SimpleNamespace(vkCode=ord("5"))
        listener._win32_kb_filter(0x0100, data)  # WM_KEYDOWN
        assert listener._bindings[0]["active"] is True

        trigger_path = listener._bindings[0]["trigger_path"]
        import json
        with open(trigger_path) as f:
            trigger = json.load(f)
        assert trigger["action"] == "start"

        # Key up → trigger "stop"
        listener._win32_kb_filter(0x0101, data)  # WM_KEYUP
        assert listener._bindings[0]["active"] is False
        with open(trigger_path) as f:
            trigger = json.load(f)
        assert trigger["action"] == "stop"

    def test_ignores_when_no_keyboard_bindings(self, listener):
        from pynput.mouse import Button
        _add_mouse_binding(listener, Button.middle)

        listener._kb_listener = MagicMock()

        data = types.SimpleNamespace(vkCode=0x20)  # VK_SPACE
        result = listener._win32_kb_filter(0x0100, data)

        assert result is True
        listener._kb_listener.suppress_event.assert_not_called()


class TestWin32MouseFilter:
    """Test _win32_mouse_filter suppresses only registered mouse buttons."""

    def test_suppresses_middle_click(self, listener):
        from pynput.mouse import Button
        _add_mouse_binding(listener, Button.middle)

        listener._mouse_listener = MagicMock()

        data = types.SimpleNamespace(mouseData=0)
        listener._win32_mouse_filter(0x0207, data)  # WM_MBUTTONDOWN

        listener._mouse_listener.suppress_event.assert_called_once()

    def test_suppresses_xbutton1(self, listener):
        from pynput.mouse import Button
        btn4 = getattr(Button, "x1", None) or getattr(Button, "button8", None)
        if btn4 is None:
            pytest.skip("pynput version has no x1/button8")

        _add_mouse_binding(listener, btn4)
        listener._mouse_listener = MagicMock()

        # XBUTTON1 = hiword 1
        data = types.SimpleNamespace(mouseData=(1 << 16))
        listener._win32_mouse_filter(0x020B, data)  # WM_XBUTTONDOWN

        listener._mouse_listener.suppress_event.assert_called_once()

    def test_ignores_wrong_xbutton(self, listener):
        from pynput.mouse import Button
        btn4 = getattr(Button, "x1", None) or getattr(Button, "button8", None)
        if btn4 is None:
            pytest.skip("pynput version has no x1/button8")

        _add_mouse_binding(listener, btn4)
        listener._mouse_listener = MagicMock()

        # XBUTTON2 = hiword 2 (wrong button)
        data = types.SimpleNamespace(mouseData=(2 << 16))
        listener._win32_mouse_filter(0x020B, data)

        listener._mouse_listener.suppress_event.assert_not_called()

    def test_ignores_when_no_mouse_bindings(self, listener):
        from pynput.keyboard import Key
        _add_kb_binding(listener, Key.space)

        listener._mouse_listener = MagicMock()

        data = types.SimpleNamespace(mouseData=0)
        result = listener._win32_mouse_filter(0x0207, data)

        assert result is True
        listener._mouse_listener.suppress_event.assert_not_called()

    def test_suppresses_multiple_mouse_bindings(self, listener):
        """Both PTT (Mouse4) and Dictation (Mouse5) should be suppressed."""
        from pynput.mouse import Button
        btn4 = getattr(Button, "x1", None) or getattr(Button, "button8", None)
        btn5 = getattr(Button, "x2", None) or getattr(Button, "button9", None)
        if btn4 is None or btn5 is None:
            pytest.skip("pynput version has no x1/x2 buttons")

        _add_mouse_binding(listener, btn4, "ptt_trigger.json")
        _add_mouse_binding(listener, btn5, "dictation_trigger.json")
        listener._mouse_listener = MagicMock()

        # Mouse4 press (XBUTTON1)
        data4 = types.SimpleNamespace(mouseData=(1 << 16))
        listener._win32_mouse_filter(0x020B, data4)
        assert listener._mouse_listener.suppress_event.call_count == 1

        # Mouse5 press (XBUTTON2)
        data5 = types.SimpleNamespace(mouseData=(2 << 16))
        listener._win32_mouse_filter(0x020B, data5)
        assert listener._mouse_listener.suppress_event.call_count == 2


class TestStartPynputWindows:
    """Test that win32_event_filter is passed on Windows."""

    @patch("platform.system", return_value="Windows")
    def test_passes_win32_filters_on_windows(self, mock_sys, listener):
        """On Windows, pynput listeners should receive win32_event_filter."""
        with patch("pynput.keyboard.Listener") as MockKbListener, \
             patch("pynput.mouse.Listener") as MockMouseListener:
            mock_kb = MagicMock()
            mock_mouse = MagicMock()
            MockKbListener.return_value = mock_kb
            MockMouseListener.return_value = mock_mouse

            listener.add_binding("Space", "ptt_trigger.json")
            result = listener.start()

            assert result is True
            kb_call_kwargs = MockKbListener.call_args[1]
            mouse_call_kwargs = MockMouseListener.call_args[1]
            assert "win32_event_filter" in kb_call_kwargs
            assert "win32_event_filter" in mouse_call_kwargs

    @patch("platform.system", return_value="Linux")
    def test_no_win32_filters_on_linux(self, mock_sys, listener):
        """On Linux, pynput listeners should NOT receive win32_event_filter."""
        with patch("pynput.keyboard.Listener") as MockKbListener, \
             patch("pynput.mouse.Listener") as MockMouseListener:
            mock_kb = MagicMock()
            mock_mouse = MagicMock()
            MockKbListener.return_value = mock_kb
            MockMouseListener.return_value = mock_mouse

            listener.add_binding("Space", "ptt_trigger.json")
            result = listener.start()

            assert result is True
            kb_call_kwargs = MockKbListener.call_args[1]
            mouse_call_kwargs = MockMouseListener.call_args[1]
            assert "win32_event_filter" not in kb_call_kwargs
            assert "win32_event_filter" not in mouse_call_kwargs


class TestMultiBinding:
    """Test multiple bindings with a single listener."""

    def test_add_binding(self, listener):
        listener.add_binding("MouseButton4", "ptt_trigger.json")
        listener.add_binding("MouseButton5", "dictation_trigger.json")
        assert len(listener._bindings) == 2
        assert listener._bindings[0]["trigger_path"].name == "ptt_trigger.json"
        assert listener._bindings[1]["trigger_path"].name == "dictation_trigger.json"

    def test_backward_compat_start_with_key(self, listener):
        """start(key_name) should auto-create a binding with default trigger."""
        with patch("pynput.keyboard.Listener") as MockKb, \
             patch("pynput.mouse.Listener") as MockMouse:
            MockKb.return_value = MagicMock()
            MockMouse.return_value = MagicMock()

            result = listener.start("Space")
            assert result is True
            assert len(listener._bindings) == 1
            assert listener._bindings[0]["trigger_path"].name == "ptt_trigger.json"

    def test_update_key_by_trigger_filename(self, listener):
        listener.add_binding("MouseButton4", "ptt_trigger.json")
        listener.add_binding("MouseButton5", "dictation_trigger.json")

        with patch.object(listener, 'stop'), \
             patch.object(listener, 'start'):
            listener.update_key("F13", trigger_filename="ptt_trigger.json")

        assert listener._bindings[0]["key_name"] == "F13"
        assert listener._bindings[1]["key_name"] == "MouseButton5"
