#!/usr/bin/env python3
"""Check the required file properties of a Baque Fácil animated WebP export."""

import argparse
import hashlib
import json
from pathlib import Path


MAX_BYTES = 500_000


def verify(path: Path) -> dict:
    from PIL import Image

    report = {"file": str(path), "valid": False, "errors": []}
    errors = report["errors"]
    report["bytes"] = path.stat().st_size
    if report["bytes"] >= MAX_BYTES:
        errors.append(f"File must be smaller than {MAX_BYTES} bytes.")

    if path.suffix.lower() != ".webp":
        errors.append("Output filename must end in .webp.")

    with Image.open(path) as image:
        report["format"] = image.format
        if image.format != "WEBP":
            errors.append("File must contain WebP data.")
            return report

        report["width"], report["height"] = image.size
        if image.width != image.height:
            errors.append("Animation canvas must be square.")

        report["frames"] = image.n_frames
        report["loop"] = image.info.get("loop")
        if not image.is_animated or image.n_frames < 2:
            errors.append("WebP must be animated and contain at least two frames.")
        if report["loop"] != 0:
            errors.append("Animation must loop infinitely (loop=0).")

        hashes = set()
        durations = []
        for index in range(image.n_frames):
            image.seek(index)
            image.load()
            hashes.add(hashlib.sha256(image.convert("RGBA").tobytes()).digest())
            durations.append(image.info.get("duration", 0))

        report["distinct_frames"] = len(hashes)
        if len(hashes) < 2:
            errors.append("At least two decoded frames must look different.")
        if any(duration <= 0 for duration in durations):
            errors.append("Every frame must have a positive duration.")

        report["duration_ms"] = sum(durations)
        report["average_fps"] = (
            round(image.n_frames * 1000 / report["duration_ms"], 2)
            if report["duration_ms"] > 0
            else None
        )

    report["valid"] = not errors
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path, help="Animated WebP export to verify")
    args = parser.parse_args()
    try:
        report = verify(args.file)
    except ImportError:
        report = {
            "file": str(args.file),
            "valid": False,
            "errors": ["Pillow with WebP support is required to run this verifier."],
        }
    except (OSError, ValueError, EOFError) as error:
        report = {"file": str(args.file), "valid": False, "errors": [str(error)]}
    print(json.dumps(report, indent=2))
    return 0 if report["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
