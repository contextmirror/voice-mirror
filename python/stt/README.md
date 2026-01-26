# STT (Speech-to-Text) Adapters

Flexible transcription system for Voice Mirror. Easily swap between different STT models to find what works best for your voice/accent.

## Available Adapters

### 1. Parakeet (Default)
- **Model**: NVIDIA NeMo Parakeet (nemo-parakeet-tdt-0.6b-v2)
- **Speed**: Fast
- **Accuracy**: Good
- **GPU Support**: Yes
- **Install**: `pip install onnx-asr[gpu,hub]`

### 2. Whisper
- **Model**: OpenAI Whisper (tiny, base, small, medium, large)
- **Speed**: Slower
- **Accuracy**: Excellent
- **GPU Support**: Yes (with PyTorch CUDA)
- **Install**: `pip install openai-whisper`

### 3. Faster-Whisper
- **Model**: Optimized Whisper via CTranslate2
- **Speed**: Much faster than Whisper
- **Accuracy**: Same as Whisper
- **GPU Support**: Yes
- **Install**: `pip install faster-whisper`

## Configuration

Edit `~/.context-mirror/voice_settings.json`:

```json
{
  "location": "United Kingdom",
  "timezone": "Europe/London",
  "units": "metric",
  "stt_adapter": "parakeet",
  "stt_model": null
}
```

### Options

**stt_adapter**: Choose the adapter
- `"parakeet"` - Fast local model (default)
- `"whisper"` - OpenAI Whisper
- `"faster-whisper"` - Optimized Whisper

**stt_model**: Specific model to use (optional)
- Parakeet: `"nemo-parakeet-tdt-0.6b-v2"` (default)
- Whisper: `"tiny"`, `"base"`, `"small"`, `"medium"`, `"large"`
- Faster-Whisper: `"tiny"`, `"base"`, `"small"`, `"medium"`, `"large-v2"`, `"large-v3"`

Set to `null` to use the adapter's default model.

## Testing Different Models

### Quick Test: Whisper Base
```json
{
  "stt_adapter": "whisper",
  "stt_model": "base"
}
```

Restart Voice Mirror:
```bash
./run.sh
```

### Quick Test: Faster-Whisper (Recommended for Testing)
```json
{
  "stt_adapter": "faster-whisper",
  "stt_model": "base"
}
```

Faster-Whisper is a great middle ground - same accuracy as Whisper but much faster.

## Recommendations

| Use Case | Recommended | Why |
|----------|-------------|-----|
| **General use** | `parakeet` | Fast, good accuracy, works well |
| **Accent issues** | `faster-whisper` (base) | Better at accents, still fast |
| **Best accuracy** | `faster-whisper` (large-v3) | Most accurate, but slower |
| **Low latency** | `parakeet` | Fastest option |

## Model Sizes

### Parakeet
- ~600MB download on first run

### Whisper / Faster-Whisper
| Model | Size | Speed | Use Case |
|-------|------|-------|----------|
| tiny | 75MB | Very fast | Testing only |
| base | 145MB | Fast | Good balance |
| small | 466MB | Medium | Better accuracy |
| medium | 1.5GB | Slow | High accuracy |
| large-v3 | 3GB | Very slow | Best accuracy |

## Troubleshooting

### "Failed to load STT adapter"
Install the required package:
```bash
# For parakeet
pip install onnx-asr[gpu,hub]

# For whisper
pip install openai-whisper

# For faster-whisper
pip install faster-whisper
```

### GPU not detected
Make sure you have CUDA installed. Check with:
```bash
nvidia-smi
```

Adapters will automatically fall back to CPU if GPU isn't available.

### Transcription is slow
Try a smaller model or switch to Parakeet:
```json
{
  "stt_adapter": "faster-whisper",
  "stt_model": "tiny"
}
```

Or go back to default:
```json
{
  "stt_adapter": "parakeet",
  "stt_model": null
}
```

## Architecture

```
stt/
├── __init__.py        # Public API exports
├── base.py            # STTAdapter base class
├── factory.py         # create_stt_adapter()
├── parakeet.py        # ParakeetAdapter
├── whisper.py         # WhisperAdapter, FasterWhisperAdapter
└── README.md          # This file
```

All adapters implement the same interface:
```python
class STTAdapter(ABC):
    async def load(self) -> bool
    async def transcribe(self, audio_data: np.ndarray, sample_rate: int) -> str
    @property
    def name(self) -> str
```

## Adding New Adapters

To add a new STT backend:

1. Create `stt/your_adapter.py`
2. Inherit from `STTAdapter`
3. Implement `load()` and `transcribe()`
4. Register in `stt/factory.py` ADAPTERS dict

Example:
```python
from .base import STTAdapter

class YourAdapter(STTAdapter):
    async def load(self) -> bool:
        # Load your model
        return True

    async def transcribe(self, audio_data, sample_rate):
        # Return transcribed text
        return "..."

    @property
    def name(self) -> str:
        return "YourAdapter"
```

Then register:
```python
# factory.py
ADAPTERS = {
    "parakeet": ParakeetAdapter,
    "whisper": WhisperAdapter,
    "faster-whisper": FasterWhisperAdapter,
    "your-adapter": YourAdapter,  # Add here
}
```
