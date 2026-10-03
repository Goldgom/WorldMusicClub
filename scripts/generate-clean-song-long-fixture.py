#!/usr/bin/env python3
"""Generate an original 32-second exercise using the production Rust converter.

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
    ppq, end = 480, 64 * 480
    conductor = [(0, text(3, "Clean Practice Fixture")),
                 (0, bytes([255, 81, 3, 7, 161, 32])),
                 (0, bytes([255, 88, 4, 4, 2, 24, 8])),
                 (end, bytes([255, 47, 0]))]
    upper = [(0, 120, 60), (240, 120, 64), (480, 120, 67),
             (720, 120, 64), (960, 240, 60), (1440, 240, 67)]
    lower = [(0, 480, 48), (960, 480, 55)]
    for index, beat in enumerate([4, 8, 12, 16, 24, 32, 40, 48, 56, 60, 62]):
        upper.append((beat * ppq, (2 if beat == 62 else 1) * ppq, [60, 64, 67, 72][index % 4]))
        lower.append((beat * ppq, 2 * ppq, [48, 55, 52, 55][index % 4]))
    tracks = [track(conductor)]
    for channel, program, name, pan, notes in [(0, 0, "Keys", 32, upper), (1, 24, "Plucks", 96, lower)]:
        events = [(0, text(3, name)), (0, bytes([192 + channel, program])),
                  (0, bytes([176 + channel, 7, 96])), (0, bytes([176 + channel, 10, pan]))]
        for index, (tick, length, key) in enumerate(notes):
            events.extend([(tick, bytes([144 + channel, key, 76 + index % 4 * 4])),
                           (tick + length, bytes([128 + channel, key, 0]))])
        events.append((end, bytes([255, 47, 0])))
        tracks.append(track(events))
    return b"MThd\0\0\0\x06" + struct.pack(">HHH", 1, len(tracks), ppq) + b"".join(tracks)


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
    assert json.loads(runtime)["duration_ms"] == 32000
    root = Path(__file__).resolve().parent.parent / "tests" / "fixtures"
    folder = root / "clean-song-v2-long"
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
    (root / "clean-song-v2-long-runtime.json").write_bytes(runtime)
    print(json.dumps({"tracks": parsed["coverage"]["source_tracks"], "notes": parsed["coverage"]["pitched_notes"], "events": parsed["coverage"]["source_events"], "duration_ms": 32000, "source_sha256": parsed["source"]["sha256"]}))


if __name__ == "__main__":
    main()
