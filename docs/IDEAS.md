# Voice Mirror - Future Ideas

Ideas and features for future development.

---

## Voice Cloning via Conversation

**Status:** Concept
**Priority:** High (differentiating feature)
**Dependencies:** Qwen3-TTS adapter (implemented), MCP tool (needed)

### The Vision

User says: *"Hey Claude, I want you to sound like Morgan Freeman"*

Claude autonomously:
1. Searches the web for a clean audio sample
2. Downloads and processes it (ffmpeg: trim to 3s, normalize)
3. Transcribes the sample using Parakeet STT
4. Calls `clone_voice` MCP tool
5. Qwen3-TTS creates voice clone prompt
6. Claude responds in the cloned voice: *"Alright, how does this sound?"*

All in one conversational turn. No menus, no file uploads, no restart.

### Implementation Plan

**1. Add `clone_voice` MCP tool** (`mcp-server/`)
```python
@tool
async def clone_voice(
    audio_url: str = None,      # URL to download
    audio_path: str = None,     # Local file path
    voice_name: str = "custom"  # Name for this voice
) -> dict:
    """
    Clone a voice from audio sample for TTS.

    Handles: download, trim to 3s, normalize, transcribe, setup clone.
    Returns: {"success": true, "voice_name": "custom", "message": "..."}
    """
```

**2. Audio processing pipeline**
- Download audio (requests/urllib)
- Convert to WAV 16kHz mono (ffmpeg)
- Trim to best 3-second segment (ffmpeg + silence detection)
- Transcribe with STT adapter
- Call Qwen adapter's `set_voice_clone()`

**3. Voice persistence** (optional)
- Save cloned voices to `~/.config/voice-mirror-electron/voices/`
- Allow switching between saved clones
- `list_voices` and `delete_voice` MCP tools

### Use Cases

| Request | Action |
|---------|--------|
| "Sound like David Attenborough" | Web search → clone |
| "Use my voice" | Record 3s via PTT → clone |
| "Clone this file" | Local path → clone |
| "Go back to normal" | `clear_voice_clone()` |

### Technical Notes

- Qwen3-TTS 1.7B needs ~4GB VRAM
- Voice clone prompt is cached for efficiency
- Clone quality depends on sample clarity
- Works best with clear speech, minimal background noise

---

## Dynamic Emotion/Style Control

**Status:** Concept
**Dependencies:** Qwen3-TTS `instruct` parameter

Claude could analyze response sentiment and add emotion instructions:

```python
# In speak(), analyze text and add instruction
if "excited" in response_analysis:
    instruct = "speak excitedly"
elif "sad" in response_analysis:
    instruct = "speak softly and sympathetically"
```

Or user-driven: *"Say that sarcastically"*

---

## Per-Context Voice Profiles

**Status:** Concept

Different voices for different contexts:
- Work mode: Professional voice
- Gaming: Energetic voice
- Night mode: Soft/whisper voice
- Custom persona: Cloned voice

Could tie into Electron's settings or be voice-commanded.

---

## Multi-Language Support

**Status:** Concept
**Dependencies:** Qwen3-TTS (supports 10 languages)

Qwen3-TTS supports: Chinese, English, Japanese, Korean, German, French, Russian, Portuguese, Spanish, Italian.

Could auto-detect language from user speech and respond in same language.

---

## Voice Recording for Clone

**Status:** Concept

Add UI button or voice command to record user's own voice:
- "Clone my voice" → starts 3-second recording
- PTT-style: hold button, speak sample
- Auto-transcribe and setup clone

---

*Last updated: January 2026*
