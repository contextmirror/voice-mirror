#!/usr/bin/env python3
"""Persistent STT worker for voice-core.

Loads the Parakeet model once at startup, then accepts transcription
requests via JSON-line stdin/stdout protocol:

  -> {"wav": "/path/to/audio.wav"}
  <- {"text": "transcription result"}
  <- {"error": "something went wrong"}

Prints {"ready": true} once the model is loaded and ready.
"""
import sys
import json
import os

def main():
    # Suppress noisy onnxruntime warnings
    os.environ.setdefault("ORT_LOG_LEVEL", "3")

    import onnx_asr

    # Optional: model cache directory passed as first arg
    model_path = sys.argv[1] if len(sys.argv) > 1 else None

    try:
        kwargs = {}
        if model_path and os.path.isdir(model_path):
            kwargs["path"] = model_path
        model = onnx_asr.load_model("nemo-parakeet-tdt-0.6b-v2", **kwargs)
        print(json.dumps({"ready": True}), flush=True)
    except Exception as e:
        print(json.dumps({"error": f"Model load failed: {e}"}), flush=True)
        sys.exit(1)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
            wav_path = request.get("wav")
            if not wav_path:
                print(json.dumps({"error": "Missing 'wav' field"}), flush=True)
                continue

            text = model.recognize(wav_path)
            # recognize() may return a list for batch input
            if isinstance(text, list):
                text = " ".join(text)
            print(json.dumps({"text": text.strip()}), flush=True)
        except json.JSONDecodeError:
            print(json.dumps({"error": "Invalid JSON"}), flush=True)
        except Exception as e:
            print(json.dumps({"error": str(e)}), flush=True)

if __name__ == "__main__":
    main()
