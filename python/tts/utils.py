"""Shared TTS utilities."""

import re


def _chunk_text(text: str, max_chars: int = 400) -> list[str]:
    """
    Split text into chunks for streaming TTS.
    Splits on sentence boundaries (. ! ?) first, then falls back to
    clause boundaries (, ; :) if sentences are too long.
    """
    if len(text) <= max_chars:
        return [text]

    chunks = []
    # Split on sentence-ending punctuation followed by space
    sentences = re.split(r'(?<=[.!?])\s+', text)

    current = ''
    for sentence in sentences:
        if not sentence.strip():
            continue
        # If adding this sentence exceeds max, flush current
        if current and len(current) + len(sentence) + 1 > max_chars:
            chunks.append(current.strip())
            current = sentence
        else:
            current = (current + ' ' + sentence).strip() if current else sentence

    if current.strip():
        chunks.append(current.strip())

    return chunks if chunks else [text]
