"""Smart home tool handlers - device wake, status, discovery, TV control."""

from .base import SmartHomeToolHandler


class WakeDeviceHandler(SmartHomeToolHandler):
    """Wake a device using Wake-on-LAN."""

    async def execute(self, device_name: str = "", **kwargs) -> str:
        if err := self._require_smart_home():
            return err
        if not device_name:
            return "No device name specified"

        success = await self.smart_home.wake_device(device_name)
        if success:
            return f"Sent wake signal to {device_name}"
        return f"Couldn't find device: {device_name}"


class CheckDeviceStatusHandler(SmartHomeToolHandler):
    """Check if a device is online."""

    async def execute(self, device_name: str = "", **kwargs) -> str:
        if err := self._require_smart_home():
            return err
        if not device_name:
            return "No device name specified"

        status = await self.smart_home.get_status(device_name)
        if "error" in status:
            return status["error"]

        if status.get("online"):
            return f"{status['name']} is online"
        return f"{status['name']} appears to be offline"


class ListDevicesHandler(SmartHomeToolHandler):
    """List all known smart home devices."""

    async def execute(self, **kwargs) -> str:
        if err := self._require_smart_home():
            return err

        devices = self.smart_home.list_devices()
        if not devices:
            return "No devices saved. Try 'discover devices' first."

        names = [f"{d['name']} ({d['type']})" for d in devices]
        return f"Known devices: {', '.join(names)}"


class DiscoverDevicesHandler(SmartHomeToolHandler):
    """Scan the network for new devices."""

    async def execute(self, **kwargs) -> str:
        if err := self._require_smart_home():
            return err

        devices = await self.smart_home.discover_devices()
        if devices:
            names = [d.name for d in devices]
            return f"Found {len(devices)} devices: {', '.join(names)}"
        return "No devices found on the network"


class TVControlHandler(SmartHomeToolHandler):
    """Control the TV - power, volume, apps, inputs."""

    async def execute(
        self,
        action: str = None,
        app: str = None,
        input: str = None,
        **kwargs
    ) -> str:
        if err := self._require_smart_home():
            return err

        # Import here to avoid circular dependency
        from lg_tv import LGTVController
        from smart_home import send_wol_packet

        tv_device = self.smart_home.get_device("tv")
        if not tv_device:
            return "No TV found in devices"

        # Power on uses WoL (doesn't need connection)
        if action == "power_on":
            if tv_device.mac:
                send_wol_packet(tv_device.mac)
                return "Sent wake signal to TV. It may take a few seconds to turn on."
            return "Can't turn on TV - no MAC address saved"

        # Other actions need TV connection
        tv = LGTVController(tv_device.ip, tv_device.mac)
        try:
            if not await tv.connect():
                return "Couldn't connect to the TV. Is it on?"

            if action == "power_off":
                await tv.power_off()
                return "TV powered off"
            elif action == "mute":
                await tv.mute(True)
                return "TV muted"
            elif action == "unmute":
                await tv.mute(False)
                return "TV unmuted"
            elif action == "volume_up":
                await tv.volume_up()
                return "Volume up"
            elif action == "volume_down":
                await tv.volume_down()
                return "Volume down"
            elif action == "pause":
                await tv.pause()
                return "Paused"
            elif action == "play":
                await tv.play()
                return "Playing"
            elif app:
                await tv.launch_app(app)
                return f"Opening {app}"
            elif input:
                await tv.set_input(input)
                return f"Switched to {input}"
            else:
                return "No action specified"
        except Exception as e:
            return f"TV error: {e}"
        finally:
            await tv.disconnect()


def register_smart_home_tools(smart_home) -> dict:
    """Create and return all smart home tool handlers."""
    return {
        "wake_device": WakeDeviceHandler(smart_home),
        "check_device_status": CheckDeviceStatusHandler(smart_home),
        "list_devices": ListDevicesHandler(smart_home),
        "discover_devices": DiscoverDevicesHandler(smart_home),
        "tv_control": TVControlHandler(smart_home),
    }
