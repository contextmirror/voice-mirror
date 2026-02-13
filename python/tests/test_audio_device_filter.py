"""Test audio device filtering logic for cross-platform host API preference."""

import unittest


def filter_audio_devices(devices, hostapis):
    """Replicate the audio device filtering logic from electron_bridge.py."""
    # Find preferred host API index:
    # - Windows: WASAPI (full device names, no duplicates)
    # - Linux: PulseAudio (avoids ALSA/JACK duplicates)
    preferred_idx = None
    for idx, api in enumerate(hostapis):
        api_name = api.get('name', '')
        if 'WASAPI' in api_name or 'pulse' in api_name.lower():
            preferred_idx = idx
            break

    input_devs = []
    output_devs = []
    seen_input = set()
    seen_output = set()
    for i, d in enumerate(devices):
        if preferred_idx is not None and d.get('hostapi') != preferred_idx:
            continue
        name = d['name']
        if d['max_input_channels'] > 0 and name not in seen_input:
            input_devs.append({"id": i, "name": name})
            seen_input.add(name)
        if d['max_output_channels'] > 0 and name not in seen_output:
            output_devs.append({"id": i, "name": name})
            seen_output.add(name)
    return input_devs, output_devs


class TestAudioDeviceFilter(unittest.TestCase):

    def test_linux_pulseaudio_preferred(self):
        """On Linux, only PulseAudio devices should appear (not ALSA duplicates)."""
        hostapis = [
            {'name': 'ALSA'},
            {'name': 'pulse'},
        ]
        devices = [
            # ALSA devices (hostapi=0) - should be filtered out
            {'name': 'HDA Intel PCH: ALC897 Analog', 'hostapi': 0, 'max_input_channels': 2, 'max_output_channels': 2},
            {'name': 'HDA Intel PCH: HDMI 0', 'hostapi': 0, 'max_input_channels': 0, 'max_output_channels': 8},
            {'name': 'USB Microphone', 'hostapi': 0, 'max_input_channels': 1, 'max_output_channels': 0},
            # PulseAudio devices (hostapi=1) - should appear
            {'name': 'Built-in Audio Analog Stereo', 'hostapi': 1, 'max_input_channels': 2, 'max_output_channels': 2},
            {'name': 'HDMI Audio', 'hostapi': 1, 'max_input_channels': 0, 'max_output_channels': 8},
            {'name': 'USB Microphone', 'hostapi': 1, 'max_input_channels': 1, 'max_output_channels': 0},
        ]
        inputs, outputs = filter_audio_devices(devices, hostapis)
        input_names = [d['name'] for d in inputs]
        output_names = [d['name'] for d in outputs]

        self.assertEqual(len(inputs), 2)  # Built-in + USB Mic
        self.assertIn('Built-in Audio Analog Stereo', input_names)
        self.assertIn('USB Microphone', input_names)

        self.assertEqual(len(outputs), 2)  # Built-in + HDMI
        self.assertIn('Built-in Audio Analog Stereo', output_names)
        self.assertIn('HDMI Audio', output_names)

    def test_windows_wasapi_preferred(self):
        """On Windows, only WASAPI devices should appear."""
        hostapis = [
            {'name': 'MME'},
            {'name': 'Windows DirectSound'},
            {'name': 'Windows WASAPI'},
        ]
        devices = [
            {'name': 'Speakers', 'hostapi': 0, 'max_input_channels': 0, 'max_output_channels': 2},
            {'name': 'Speakers', 'hostapi': 1, 'max_input_channels': 0, 'max_output_channels': 2},
            {'name': 'Speakers (Realtek)', 'hostapi': 2, 'max_input_channels': 0, 'max_output_channels': 2},
            {'name': 'Microphone', 'hostapi': 2, 'max_input_channels': 1, 'max_output_channels': 0},
        ]
        inputs, outputs = filter_audio_devices(devices, hostapis)
        self.assertEqual(len(inputs), 1)
        self.assertEqual(inputs[0]['name'], 'Microphone')
        self.assertEqual(len(outputs), 1)
        self.assertEqual(outputs[0]['name'], 'Speakers (Realtek)')

    def test_no_preferred_api_shows_all(self):
        """When no preferred API is found, all devices should appear."""
        hostapis = [{'name': 'CoreAudio'}]
        devices = [
            {'name': 'MacBook Pro Speakers', 'hostapi': 0, 'max_input_channels': 0, 'max_output_channels': 2},
            {'name': 'MacBook Pro Microphone', 'hostapi': 0, 'max_input_channels': 1, 'max_output_channels': 0},
        ]
        inputs, outputs = filter_audio_devices(devices, hostapis)
        self.assertEqual(len(inputs), 1)
        self.assertEqual(len(outputs), 1)

    def test_dedup_by_name(self):
        """Devices with duplicate names within the same API should be deduped."""
        hostapis = [{'name': 'pulse'}]
        devices = [
            {'name': 'Default', 'hostapi': 0, 'max_input_channels': 2, 'max_output_channels': 0},
            {'name': 'Default', 'hostapi': 0, 'max_input_channels': 2, 'max_output_channels': 0},
        ]
        inputs, outputs = filter_audio_devices(devices, hostapis)
        self.assertEqual(len(inputs), 1)


if __name__ == '__main__':
    unittest.main()
