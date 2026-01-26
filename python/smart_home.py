#!/usr/bin/env python3
"""
Smart Home Module for Voice Mirror

Discovers and controls devices on the local network.
Currently supports:
- PlayStation (via ps4-waker protocol)
- Xbox (via Xbox SmartGlass protocol)
- Wake-on-LAN for any device
- Network device discovery

Usage:
    from smart_home import SmartHome

    home = SmartHome()
    await home.discover_devices()
    await home.wake_device("playstation")
"""

import asyncio
import json
import subprocess
import socket
import struct
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Optional, Dict, List

# Device database location
DEVICES_PATH = Path(__file__).parent / "devices.json"


@dataclass
class NetworkDevice:
    """Represents a discovered network device."""
    name: str
    ip: str
    mac: str
    vendor: str
    device_type: str  # playstation, xbox, tv, router, computer, unknown
    wake_on_lan: bool = True
    model: Optional[str] = None  # For TVs and other devices with model info
    webos_version: Optional[str] = None  # For LG webOS TVs

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict):
        # Filter to only known fields to handle future additions gracefully
        known_fields = {f.name for f in cls.__dataclass_fields__.values()}
        filtered = {k: v for k, v in data.items() if k in known_fields}
        return cls(**filtered)


class SmartHome:
    """Discover and control smart home devices."""

    def __init__(self):
        self.devices: Dict[str, NetworkDevice] = {}
        self.load_devices()

    def load_devices(self):
        """Load known devices from file."""
        if DEVICES_PATH.exists():
            try:
                with open(DEVICES_PATH, 'r') as f:
                    data = json.load(f)
                    for name, device_data in data.get("devices", {}).items():
                        self.devices[name] = NetworkDevice.from_dict(device_data)
                print(f"📱 Loaded {len(self.devices)} known devices")
            except Exception as e:
                print(f"⚠️ Error loading devices: {e}")

    def save_devices(self):
        """Save devices to file."""
        data = {
            "devices": {name: device.to_dict() for name, device in self.devices.items()}
        }
        with open(DEVICES_PATH, 'w') as f:
            json.dump(data, f, indent=2)
        print(f"💾 Saved {len(self.devices)} devices")

    async def discover_devices(self) -> List[NetworkDevice]:
        """Scan network for devices using nmap."""
        print("🔍 Scanning network for devices...")

        try:
            # Run nmap scan
            result = await asyncio.create_subprocess_exec(
                "sudo", "nmap", "-sn", "192.168.1.0/24",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await result.communicate()
            output = stdout.decode()

            # Parse nmap output
            discovered = []
            current_ip = None
            current_mac = None
            current_vendor = None

            for line in output.split('\n'):
                if "Nmap scan report for" in line:
                    # Save previous device if we have one
                    if current_ip and current_mac:
                        device = self._create_device(current_ip, current_mac, current_vendor or "Unknown")
                        discovered.append(device)

                    # Extract IP from line
                    parts = line.split()
                    if len(parts) >= 5:
                        current_ip = parts[-1].strip('()')
                    elif len(parts) >= 4:
                        current_ip = parts[-1]
                    current_mac = None
                    current_vendor = None

                elif "MAC Address:" in line:
                    parts = line.split("MAC Address: ")[1]
                    mac_parts = parts.split(" ", 1)
                    current_mac = mac_parts[0]
                    if len(mac_parts) > 1:
                        current_vendor = mac_parts[1].strip("()")

            # Don't forget the last device
            if current_ip and current_mac:
                device = self._create_device(current_ip, current_mac, current_vendor or "Unknown")
                discovered.append(device)

            # Update our device list
            for device in discovered:
                self.devices[device.name.lower()] = device

            self.save_devices()
            print(f"✅ Found {len(discovered)} devices")
            return discovered

        except Exception as e:
            print(f"❌ Network scan failed: {e}")
            return []

    def _create_device(self, ip: str, mac: str, vendor: str) -> NetworkDevice:
        """Create a NetworkDevice with detected type."""
        vendor_lower = vendor.lower()

        # Detect device type from vendor
        if "sony" in vendor_lower or "playstation" in vendor_lower:
            device_type = "playstation"
            name = "PlayStation"
        elif "microsoft" in vendor_lower:
            device_type = "xbox"
            name = "Xbox"
        elif "samsung" in vendor_lower:
            device_type = "tv"
            name = "Samsung TV"
        elif "lg" in vendor_lower:
            device_type = "tv"
            name = "LG TV"
        elif "arcadyan" in vendor_lower or "router" in vendor_lower:
            device_type = "router"
            name = "Router"
        else:
            device_type = "unknown"
            name = f"Device ({ip})"

        return NetworkDevice(
            name=name,
            ip=ip,
            mac=mac,
            vendor=vendor,
            device_type=device_type
        )

    def get_device(self, name: str) -> Optional[NetworkDevice]:
        """Get device by name (case insensitive, partial match)."""
        name_lower = name.lower()

        # Exact match first
        if name_lower in self.devices:
            return self.devices[name_lower]

        # Partial match
        for key, device in self.devices.items():
            if name_lower in key or name_lower in device.name.lower():
                return device
            # Match by type
            if name_lower in device.device_type:
                return device

        return None

    async def wake_device(self, name: str) -> bool:
        """Wake a device using Wake-on-LAN."""
        device = self.get_device(name)

        if not device:
            print(f"❌ Unknown device: {name}")
            print(f"   Known devices: {', '.join(self.devices.keys())}")
            return False

        print(f"⚡ Sending Wake-on-LAN to {device.name} ({device.mac})...")

        try:
            self._send_wol(device.mac)
            print(f"✅ Wake packet sent to {device.name}")
            return True
        except Exception as e:
            print(f"❌ Failed to wake {device.name}: {e}")
            return False

    def _send_wol(self, mac: str):
        """Send Wake-on-LAN magic packet."""
        send_wol_packet(mac)


def send_wol_packet(mac: str):
    """Send Wake-on-LAN magic packet (module-level function)."""
    # Clean MAC address
    mac_clean = mac.replace(":", "").replace("-", "")
    if len(mac_clean) != 12:
        raise ValueError(f"Invalid MAC address: {mac}")

    # Create magic packet: 6 bytes of FF + 16 repetitions of MAC
    mac_bytes = bytes.fromhex(mac_clean)
    magic = b'\xff' * 6 + mac_bytes * 16

    # Send via UDP broadcast
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sock.sendto(magic, ('255.255.255.255', 9))
    sock.close()

    async def turn_on(self, device_name: str) -> bool:
        """Turn on a device (alias for wake)."""
        return await self.wake_device(device_name)

    async def get_status(self, name: str) -> dict:
        """Check if a device is online by pinging it."""
        device = self.get_device(name)

        if not device:
            return {"error": f"Unknown device: {name}"}

        # Ping the device
        try:
            result = await asyncio.create_subprocess_exec(
                "ping", "-c", "1", "-W", "1", device.ip,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            await result.communicate()
            online = result.returncode == 0

            return {
                "name": device.name,
                "ip": device.ip,
                "online": online,
                "type": device.device_type
            }
        except Exception as e:
            return {"error": str(e)}

    def list_devices(self) -> List[dict]:
        """List all known devices."""
        return [
            {
                "name": d.name,
                "ip": d.ip,
                "type": d.device_type,
                "vendor": d.vendor
            }
            for d in self.devices.values()
        ]


# Voice command handlers for integration with Voice Mirror
SMART_HOME_COMMANDS = {
    "turn on": ["turn on", "switch on", "wake up", "power on", "start"],
    "turn off": ["turn off", "switch off", "power off", "shut down"],
    "status": ["is the playstation", "is the xbox", "is the tv", "is playstation", "is xbox", "is tv", "check if", "status of", "is it online"],
    "discover": ["discover devices", "scan network", "find devices", "search for devices"],
    "list": ["list devices", "what devices", "show devices"]
}

# TV-specific commands (order matters - check longer patterns first!)
TV_VOICE_COMMANDS = {
    "tv_on": ["turn on the tv", "switch on the tv", "tv on", "turn on tv"],
    "unmute": ["unmute tv", "unmute the tv"],  # Must be before mute!
    "mute": ["mute tv", "mute the tv", "silence the tv"],
    "volume_up": ["volume up", "turn up the volume", "louder"],
    "volume_down": ["volume down", "turn down the volume", "quieter"],
    "netflix": ["open netflix", "launch netflix", "play netflix", "put on netflix"],
    "youtube": ["open youtube", "launch youtube", "play youtube", "put on youtube"],
    "disney": ["open disney", "launch disney", "disney plus"],
    "amazon": ["open amazon", "launch amazon", "prime video", "open prime"],
    "spotify": ["open spotify", "launch spotify", "play spotify"],
    "twitch": ["open twitch", "launch twitch"],
    "hdmi1": ["switch to hdmi 1", "hdmi 1", "xbox input", "switch to xbox"],
    "hdmi2": ["switch to hdmi 2", "hdmi 2", "amazon input", "fire stick"],
    "hdmi3": ["switch to hdmi 3", "hdmi 3"],
    "pause": ["pause the tv", "pause tv", "pause it"],
    "play": ["play tv", "resume tv", "continue playing"],
    "tv_off": ["turn off the tv", "switch off the tv", "tv off"],
}


async def handle_tv_command(text: str, smart_home: SmartHome) -> Optional[str]:
    """Handle TV-specific voice commands."""
    from lg_tv import LGTVController

    text_lower = text.lower()

    # Get TV from devices
    tv_device = smart_home.get_device("tv")
    if not tv_device or not tv_device.ip:
        return None

    # Check which TV command matches
    matched_cmd = None
    for cmd, patterns in TV_VOICE_COMMANDS.items():
        for pattern in patterns:
            if pattern in text_lower:
                matched_cmd = cmd
                break
        if matched_cmd:
            break

    if not matched_cmd:
        return None

    # Handle TV power on separately (doesn't require connection - uses WoL)
    if matched_cmd == "tv_on":
        if tv_device.mac:
            send_wol_packet(tv_device.mac)
            print(f"⚡ Sent Wake-on-LAN to {tv_device.name} ({tv_device.mac})")
            return "Sent wake signal to TV. It may take a few seconds to turn on."
        else:
            return "Can't turn on TV - no MAC address saved"

    # Connect to TV for other commands
    tv = LGTVController(tv_device.ip, tv_device.mac)

    try:
        if not await tv.connect():
            return "Couldn't connect to the TV. Is it on?"

        if matched_cmd == "tv_off":
            await tv.power_off()
            return "TV powered off"
        elif matched_cmd == "mute":
            await tv.mute(True)
            return "TV muted"
        elif matched_cmd == "unmute":
            await tv.mute(False)
            return "TV unmuted"
        elif matched_cmd == "volume_up":
            await tv.volume_up()
            return "Volume up"
        elif matched_cmd == "volume_down":
            await tv.volume_down()
            return "Volume down"
        elif matched_cmd == "pause":
            await tv.pause()
            return "Paused"
        elif matched_cmd == "play":
            await tv.play()
            return "Playing"
        elif matched_cmd == "hdmi1":
            await tv.set_input("HDMI_1")
            return "Switched to HDMI 1"
        elif matched_cmd == "hdmi2":
            await tv.set_input("HDMI_2")
            return "Switched to HDMI 2"
        elif matched_cmd == "hdmi3":
            await tv.set_input("HDMI_3")
            return "Switched to HDMI 3"
        elif matched_cmd in ["netflix", "youtube", "disney", "amazon", "spotify", "twitch"]:
            await tv.launch_app(matched_cmd)
            return f"Opening {matched_cmd}"

    except Exception as e:
        return f"TV error: {e}"
    finally:
        await tv.disconnect()

    return None


async def handle_smart_home_command(text: str, smart_home: SmartHome) -> Optional[str]:
    """
    Parse and handle smart home voice commands.
    Returns response text or None if not a smart home command.
    """
    text_lower = text.lower()

    # Check for TV commands first
    tv_response = await handle_tv_command(text, smart_home)
    if tv_response:
        return tv_response

    # Check for discover/scan command
    for keyword in SMART_HOME_COMMANDS["discover"]:
        if keyword in text_lower:
            devices = await smart_home.discover_devices()
            if devices:
                names = [d.name for d in devices]
                return f"Found {len(devices)} devices: {', '.join(names)}"
            return "No devices found on the network"

    # Check for list command
    for keyword in SMART_HOME_COMMANDS["list"]:
        if keyword in text_lower:
            devices = smart_home.list_devices()
            if devices:
                names = [f"{d['name']} ({d['type']})" for d in devices]
                return f"Known devices: {', '.join(names)}"
            return "No devices saved. Say 'discover devices' to scan the network."

    # Check for turn on command
    for keyword in SMART_HOME_COMMANDS["turn on"]:
        if keyword in text_lower:
            # Extract device name (everything after the keyword)
            idx = text_lower.find(keyword)
            device_name = text_lower[idx + len(keyword):].strip()
            device_name = device_name.replace("the", "").replace("my", "").strip()

            if device_name:
                success = await smart_home.wake_device(device_name)
                if success:
                    return f"Sent wake signal to {device_name}"
                return f"Couldn't find device called {device_name}"
            return "Which device should I turn on?"

    # Check for status command
    for keyword in SMART_HOME_COMMANDS["status"]:
        if keyword in text_lower:
            # Try to extract device name
            for device in smart_home.devices.values():
                if device.name.lower() in text_lower or device.device_type in text_lower:
                    status = await smart_home.get_status(device.name)
                    if status.get("online"):
                        return f"{device.name} is online"
                    return f"{device.name} appears to be offline"
            return "Which device do you want to check?"

    return None  # Not a smart home command


# CLI for testing
async def main():
    """Test the smart home module."""
    home = SmartHome()

    print("\n=== Smart Home Module ===\n")

    # Discover devices
    print("1. Discovering devices...")
    devices = await home.discover_devices()

    print("\n2. Listing devices:")
    for d in home.list_devices():
        print(f"   - {d['name']}: {d['ip']} ({d['type']})")

    print("\n3. Checking PlayStation status...")
    status = await home.get_status("playstation")
    print(f"   {status}")

    print("\n4. Testing voice commands...")
    test_commands = [
        "turn on the playstation",
        "is the xbox online",
        "list devices",
    ]
    for cmd in test_commands:
        print(f"\n   Command: '{cmd}'")
        response = await handle_smart_home_command(cmd, home)
        print(f"   Response: {response}")


if __name__ == "__main__":
    asyncio.run(main())
