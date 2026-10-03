#!/usr/bin/env python3
"""Generate an original initial-sensitivity exercise using the production Rust converter.

No user-provided melody or MIDI file is read. The authored SMF exists only in
memory; the fixture folder contains only metadata.json and score.json. Runtime
JSON is separate test evidence. Pass the built clean-song-convert executable.
"""
import argparse
import hashlib
import json
import struct
import subprocess
from pathlib import Path


def vlq(value):
    result = [value & 127]
    value >>= 7
    while value:
        result.append((value & 127) | 128)
        value >>= 7
    return bytes(reversed(result))


def text(kind, value):
    encoded = value.encode("utf-8")
    return bytes([255, kind]) + vlq(len(encoded)) + encoded


def track(absolute_events):
    payload = bytearray()
    previous = 0
    for tick, message in sorted(absolute_events, key=lambda event: event[0]):
        payload.extend(vlq(tick - previous))
        payload.extend(message)
        previous = tick
    return b"MTrk" + len(payload).to_bytes(4, "big") + payload


def authored_source():
    tracks = [track([(0, text(3, "Initial Sensitivity Exercise")),
                     (0, bytes([255, 81, 3, 7, 161, 32])), (1920, bytes([255, 47, 0]))])]
    for channel in range(3):
        events = [(0, text(3, ["Upper", "Lower", "Silent setup"][channel])),
                  (0, bytes([192 + channel, [0, 24, 48][channel]]))]
        events.extend((0, bytes([176 + channel, controller, value])) for controller, value in
                      [(101, 0), (100, 0), (6, 24), (38, 0), (101, 127), (100, 127)])
        events.extend([(0, bytes([176 + channel, 7, 96])), (0, bytes([176 + channel, 10, [32, 96, 64][channel]]))])
        if channel < 2:
            events.extend([(1, bytes([144 + channel, 60 - channel * 12, 80])),
                           (481, bytes([128 + channel, 60 - channel * 12, 12])),
                           (960, bytes([144 + channel, 64 - channel * 12, 88])),
                           (1440, bytes([128 + channel, 64 - channel * 12, 0]))])
        events.append((1920, bytes([255, 47, 0])))
        tracks.append(track(events))
    return b"MThd\0\0\0\x06" + struct.pack(">HHH", 1, len(tracks), 480) + b"".join(tracks)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("converter", type=Path)
    args = parser.parse_args()
    source = authored_source()
    executable = str(args.converter.resolve())
    score = subprocess.run([executable], input=source, stdout=subprocess.PIPE, check=True).stdout
    runtime = subprocess.run([executable, "--runtime"], input=source, stdout=subprocess.PIPE, check=True).stdout
    reloaded = subprocess.run([executable, "--validate-runtime"], input=score, stdout=subprocess.PIPE, check=True).stdout
    assert runtime == reloaded, "Clean JSON changed the exact runtime"
    parsed = json.loads(score)
    assert parsed["source"]["sha256"] == hashlib.sha256(source).hexdigest()
    assert json.loads(runtime)["duration_ms"] == 2000
    root = Path(__file__).resolve().parent.parent / "tests" / "fixtures"
    folder = root / "clean-song-v2-rpn"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "score.json").write_bytes(score)
    metadata = {
        "format": "worldmusichub-song", "version": 2,
        "id": parsed["notation"]["id"], "title": parsed["notation"]["title"],
        "score": {"path": "score.json", "bytes": len(score), "sha256": hashlib.sha256(score).hexdigest()},
        "sources": [parsed["source"]],
        "rights": {"status": "original_authored", "attribution": "WorldMusicHub original authored test exercise", "license": "CC0-1.0"},
        "media": [],
    }
    (folder / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")
    (root / "clean-song-v2-rpn-runtime.json").write_bytes(runtime)
    print(json.dumps({"tracks": parsed["coverage"]["source_tracks"], "notes": parsed["coverage"]["pitched_notes"], "events": parsed["coverage"]["source_events"], "duration_ms": 2000, "source_sha256": parsed["source"]["sha256"]}))


if __name__ == "__main__":
    main()
