#!/usr/bin/env python3
"""
LG webOS TV Control for Voice Mirror

Controls LG TVs via the webOS API.
First connection requires accepting the pairing prompt on the TV.

Usage:
    from lg_tv import LGTVController

    tv = LGTVController("192.168.1.xxx")
    await tv.connect()
    await tv.power_on()
    await tv.set_input("HDMI_2")
    await tv.launch_app("netflix")
"""

import asyncio
import json
from pathlib import Path
from typing import Optional, Dict, List

try:
    from aiowebostv import WebOsClient
    WEBOS_AVAILABLE = True
except ImportError:
    WEBOS_AVAILABLE = False
    print("⚠️ aiowebostv not installed: pip install aiowebostv")

# Store pairing keys here
KEYS_PATH = Path(__file__).parent / "lg_tv_keys.json"


class LGTVController:
    """Control LG webOS TVs."""

    def __init__(self, ip: str, mac: str = None):
        self.ip = ip
        self.mac = mac
        self.client: Optional[WebOsClient] = None
        self.client_key: Optional[str] = None
        self._load_key()

    def _load_key(self):
        """Load saved client key for this TV."""
        if KEYS_PATH.exists():
            try:
                with open(KEYS_PATH, 'r') as f:
                    keys = json.load(f)
                    self.client_key = keys.get(self.ip)
            except:
                pass

    def _save_key(self):
        """Save client key after pairing."""
        keys = {}
        if KEYS_PATH.exists():
            try:
                with open(KEYS_PATH, 'r') as f:
                    keys = json.load(f)
            except:
                pass

        keys[self.ip] = self.client_key
        with open(KEYS_PATH, 'w') as f:
            json.dump(keys, f, indent=2)

    async def connect(self, timeout: float = 20.0) -> bool:
        """
        Connect to the TV.
        First time will show a pairing prompt on the TV - user must accept.
        """
        if not WEBOS_AVAILABLE:
            print("❌ aiowebostv not available")
            return False

        try:
            self.client = WebOsClient(self.ip, client_key=self.client_key)
            # Don't use wait_for - the library handles its own timeouts
            await self.client.connect()

            # Save the key after successful connection
            if self.client.client_key and self.client.client_key != self.client_key:
                self.client_key = self.client.client_key
                self._save_key()
                print(f"🔑 Saved pairing key for {self.ip}")

            print(f"✅ Connected to LG TV at {self.ip}")
            return True

        except asyncio.TimeoutError:
            print(f"⏰ Connection timeout - is the TV on?")
            return False
        except Exception as e:
            print(f"❌ Failed to connect: {e}")
            return False

    async def disconnect(self):
        """Disconnect from TV."""
        if self.client:
            await self.client.disconnect()
            self.client = None

    async def power_off(self) -> bool:
        """Turn off the TV."""
        if not self.client:
            if not await self.connect():
                return False

        try:
            await self.client.power_off()
            print("📺 TV powered off")
            return True
        except Exception as e:
            print(f"❌ Power off failed: {e}")
            return False

    async def set_volume(self, level: int) -> bool:
        """Set volume (0-100)."""
        if not self.client:
            if not await self.connect():
                return False

        try:
            await self.client.set_volume(level)
            print(f"🔊 Volume set to {level}")
            return True
        except Exception as e:
            print(f"❌ Set volume failed: {e}")
            return False

    async def volume_up(self) -> bool:
        """Increase volume."""
        if not self.client:
            if not await self.connect():
                return False

        try:
            await self.client.volume_up()
            print("🔊 Volume up")
            return True
        except Exception as e:
            print(f"❌ Volume up failed: {e}")
            return False

    async def volume_down(self) -> bool:
        """Decrease volume."""
        if not self.client:
            if not await self.connect():
                return False

        try:
            await self.client.volume_down()
            print("🔉 Volume down")
            return True
        except Exception as e:
            print(f"❌ Volume down failed: {e}")
            return False

    async def mute(self, muted: bool = True) -> bool:
        """Mute or unmute."""
        if not self.client:
            if not await self.connect():
                return False

        try:
            await self.client.set_mute(muted)
            print(f"🔇 {'Muted' if muted else 'Unmuted'}")
            return True
        except Exception as e:
            print(f"❌ Mute failed: {e}")
            return False

    async def get_inputs(self) -> List[Dict]:
        """Get available inputs."""
        if not self.client:
            if not await self.connect():
                return []

        try:
            inputs = await self.client.get_inputs()
            return inputs
        except Exception as e:
            print(f"❌ Get inputs failed: {e}")
            return []

    async def set_input(self, input_id: str) -> bool:
        """
        Switch input.
        Common input IDs: HDMI_1, HDMI_2, HDMI_3, HDMI_4, COMP_1, AV_1
        """
        if not self.client:
            if not await self.connect():
                return False

        try:
            await self.client.set_input(input_id)
            print(f"📺 Switched to {input_id}")
            return True
        except Exception as e:
            print(f"❌ Set input failed: {e}")
            return False

    async def get_apps(self) -> List[Dict]:
        """Get installed apps."""
        if not self.client:
            if not await self.connect():
                return []

        try:
            apps = await self.client.get_apps()
            return apps
        except Exception as e:
            print(f"❌ Get apps failed: {e}")
            return []

    async def launch_app(self, app_id: str) -> bool:
        """
        Launch an app.
        Common app IDs:
        - netflix: com.webos.app.netflix
        - youtube: youtube.leanback.v4
        - amazon: amazon
        - disney: com.disney.disneyplus-prod
        - plex: cdp-30
        """
        if not self.client:
            if not await self.connect():
                return False

        # Map common names to app IDs
        app_map = {
            "netflix": "netflix",
            "youtube": "youtube.leanback.v4",
            "amazon": "amazon",
            "prime": "amazon",
            "disney": "com.disney.disneyplus-prod",
            "disney+": "com.disney.disneyplus-prod",
            "plex": "cdp-30",
            "spotify": "spotify-beehive",
            "browser": "com.webos.app.browser",
        }

        resolved_id = app_map.get(app_id.lower(), app_id)

        try:
            await self.client.launch_app(resolved_id)
            print(f"🚀 Launched {app_id}")
            return True
        except Exception as e:
            print(f"❌ Launch app failed: {e}")
            return False

    async def send_button(self, button: str) -> bool:
        """
        Send remote button press.
        Buttons: UP, DOWN, LEFT, RIGHT, ENTER, BACK, HOME, EXIT,
                 PLAY, PAUSE, STOP, REWIND, FASTFORWARD,
                 VOLUMEUP, VOLUMEDOWN, MUTE, CHANNELUP, CHANNELDOWN
        """
        if not self.client:
            if not await self.connect():
                return False

        try:
            await self.client.button(button)
            print(f"🎮 Button: {button}")
            return True
        except Exception as e:
            print(f"❌ Button press failed: {e}")
            return False

    async def play(self) -> bool:
        """Play media."""
        return await self.send_button("PLAY")

    async def pause(self) -> bool:
        """Pause media."""
        return await self.send_button("PAUSE")

    async def get_current_app(self) -> Optional[str]:
        """Get currently running app."""
        if not self.client:
            if not await self.connect():
                return None

        try:
            info = await self.client.get_current_app()
            return info
        except Exception as e:
            print(f"❌ Get current app failed: {e}")
            return None


# Voice command patterns for TV control
TV_COMMANDS = {
    "power_off": ["turn off tv", "tv off", "switch off tv", "power off tv"],
    "mute": ["mute tv", "mute the tv", "silence tv"],
    "unmute": ["unmute tv", "unmute the tv", "unsilence tv"],
    "volume_up": ["volume up", "turn up volume", "louder", "turn it up"],
    "volume_down": ["volume down", "turn down volume", "quieter", "turn it down"],
    "input_hdmi1": ["hdmi 1", "hdmi one", "switch to hdmi 1", "playstation input"],
    "input_hdmi2": ["hdmi 2", "hdmi two", "switch to hdmi 2", "xbox input"],
    "input_hdmi3": ["hdmi 3", "hdmi three", "switch to hdmi 3"],
    "netflix": ["open netflix", "launch netflix", "netflix", "play netflix"],
    "youtube": ["open youtube", "launch youtube", "youtube"],
    "disney": ["open disney", "launch disney", "disney plus", "disney+"],
    "amazon": ["open amazon", "launch amazon", "prime video", "amazon prime"],
    "plex": ["open plex", "launch plex", "plex"],
    "pause": ["pause", "pause tv", "pause it"],
    "play": ["play", "resume", "continue"],
    "home": ["tv home", "go home", "home screen"],
    "back": ["go back", "back", "previous"],
}


async def handle_tv_command(text: str, tv_ip: str, tv_mac: str = None) -> Optional[str]:
    """
    Parse and handle TV voice commands.
    Returns response text or None if not a TV command.
    """
    if not WEBOS_AVAILABLE:
        return None

    text_lower = text.lower()

    # Check if this is a TV command
    command = None
    for cmd, patterns in TV_COMMANDS.items():
        for pattern in patterns:
            if pattern in text_lower:
                command = cmd
                break
        if command:
            break

    if not command:
        return None

    # Connect to TV
    tv = LGTVController(tv_ip, tv_mac)

    try:
        if command == "power_off":
            if await tv.power_off():
                return "TV powered off"
            return "Couldn't turn off the TV"

        elif command == "mute":
            if await tv.mute(True):
                return "TV muted"
            return "Couldn't mute the TV"

        elif command == "unmute":
            if await tv.mute(False):
                return "TV unmuted"
            return "Couldn't unmute the TV"

        elif command == "volume_up":
            if await tv.volume_up():
                return "Volume up"
            return "Couldn't change volume"

        elif command == "volume_down":
            if await tv.volume_down():
                return "Volume down"
            return "Couldn't change volume"

        elif command.startswith("input_"):
            input_name = command.replace("input_", "").upper()
            if await tv.set_input(input_name):
                return f"Switched to {input_name}"
            return f"Couldn't switch to {input_name}"

        elif command in ["netflix", "youtube", "disney", "amazon", "plex"]:
            if await tv.launch_app(command):
                return f"Opening {command}"
            return f"Couldn't open {command}"

        elif command == "pause":
            if await tv.pause():
                return "Paused"
            return "Couldn't pause"

        elif command == "play":
            if await tv.play():
                return "Playing"
            return "Couldn't play"

        elif command == "home":
            if await tv.send_button("HOME"):
                return "Going to home screen"
            return "Couldn't go home"

        elif command == "back":
            if await tv.send_button("BACK"):
                return "Going back"
            return "Couldn't go back"

    finally:
        await tv.disconnect()

    return None


# CLI for testing
async def main():
    """Test LG TV control."""
    import sys

    # Get TV IP from devices.json
    devices_path = Path(__file__).parent / "devices.json"
    if not devices_path.exists():
        print("❌ No devices.json found")
        return

    with open(devices_path, 'r') as f:
        devices = json.load(f)

    tv_data = devices.get("devices", {}).get("tv")
    if not tv_data:
        print("❌ No TV in devices.json")
        return

    tv_ip = tv_data.get("ip")
    if not tv_ip:
        print("❌ TV has no IP address - run network scan first")
        print("   Or manually add the IP to devices.json")
        return

    print(f"\n=== LG TV Control Test ===")
    print(f"TV IP: {tv_ip}")
    print(f"Model: {tv_data.get('model', 'Unknown')}")
    print()

    tv = LGTVController(tv_ip, tv_data.get("mac"))

    print("Connecting... (check TV for pairing prompt)")
    if not await tv.connect():
        print("Failed to connect")
        return

    print("\nGetting apps...")
    apps = await tv.get_apps()
    print(f"Found {len(apps)} apps")
    for app in apps[:10]:  # Show first 10
        print(f"  - {app.get('title', 'Unknown')}: {app.get('id', 'Unknown')}")

    print("\nGetting inputs...")
    inputs = await tv.get_inputs()
    for inp in inputs:
        print(f"  - {inp.get('label', 'Unknown')}: {inp.get('id', 'Unknown')}")

    await tv.disconnect()
    print("\n✅ Done!")


if __name__ == "__main__":
    asyncio.run(main())
