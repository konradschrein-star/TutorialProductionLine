#!/usr/bin/env python3

"""
faster-whisper CLI wrapper with openai-whisper compatible output

Usage:
  python faster_whisper_cli.py <audio_file> --model base --output_dir <dir>

Output: JSON file with same structure as openai-whisper
"""

import sys
import json
from pathlib import Path
from faster_whisper import WhisperModel

def main():
    if len(sys.argv) < 2:
        print("Usage: faster_whisper_cli.py <audio_file> --model <model> --output_dir <dir>")
        sys.exit(1)

    # Parse args (simple positional parsing)
    audio_file = sys.argv[1]
    model_size = "base"
    output_dir = "."

    for i, arg in enumerate(sys.argv):
        if arg == "--model" and i + 1 < len(sys.argv):
            model_size = sys.argv[i + 1]
        if arg == "--output_dir" and i + 1 < len(sys.argv):
            output_dir = sys.argv[i + 1]

    print(f"Loading faster-whisper model: {model_size}", file=sys.stderr)

    # CPU-only, int8 quantization for speed
    model = WhisperModel(model_size, device="cpu", compute_type="int8")

    print(f"Transcribing: {audio_file}", file=sys.stderr)
    segments, info = model.transcribe(audio_file, word_timestamps=True)

    # Collect all words
    words = []
    full_text = []

    for segment in segments:
        full_text.append(segment.text.strip())
        if segment.words:
            for word in segment.words:
                words.append({
                    "word": word.word,
                    "start": word.start,
                    "end": word.end
                })

    # Construct output matching openai-whisper format
    output = {
        "text": " ".join(full_text),
        "words": words,
        "language": info.language
    }

    # Write JSON to output_dir
    audio_path = Path(audio_file)
    output_file = Path(output_dir) / f"{audio_path.stem}.json"
    output_file.parent.mkdir(parents=True, exist_ok=True)

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"Transcription complete: {output_file}", file=sys.stderr)

if __name__ == "__main__":
    main()
