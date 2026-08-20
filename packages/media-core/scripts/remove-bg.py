#!/usr/bin/env python3
"""
Background removal via withoutbg open-source local model (Focus v1.0.0).

Reads a PNG/JPEG image from stdin, removes the background, and writes an
RGBA PNG with transparent background to stdout.

Models (~320MB total, 4 ONNX files) are downloaded from HuggingFace on first
call and cached automatically. No API key or license required.

Usage:
  python3 remove-bg.py < input.png > output.png
"""
import sys
import io
from PIL import Image
from withoutbg import WithoutBG

# Model loaded once per process. First call triggers download + cache.
_client = None

def _get_client():
    global _client
    if _client is None:
        _client = WithoutBG.opensource()
    return _client


def remove_background(input_bytes: bytes) -> bytes:
    result: Image.Image = _get_client().remove_background(input_bytes)
    output = io.BytesIO()
    result.save(output, format="PNG")
    return output.getvalue()


if __name__ == "__main__":
    input_bytes = sys.stdin.buffer.read()
    output_bytes = remove_background(input_bytes)
    sys.stdout.buffer.write(output_bytes)
