#!/usr/bin/env python3
"""Capture an original composite source through the socket-free native driver.

Usage: python3 scripts/generate-native-tie-browser-fixture.py /absolute/native_driver

The seven authored MIDI events are the entire source. No existing score, user
library or network service is read. Native import uses a disposable library.
"""
import base64
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile


DRIVER_SHA256 = "3222b0e1d72558d9fca5fbf0e5012cc8acb681c895cd03e042b7d289e73febc7"
EVENTS = [
    (0, [0x90, 60, 90]),
    (96, [0x90, 60, 82]),
    (888, [0x80, 60, 0]),
    (972, [0x80, 60, 0]),
    (1008, [0x90, 67, 86]),
    (1056, [0x80, 67, 0]),
    (1152, [0xFF, 0x2F, 0]),
]


def vlq(value):
    result = [value & 127]
    while value >> 7:
        value >>= 7
        result.append((value & 127) | 128)
    return bytes(reversed(result))


def main():
    driver = Path(sys.argv[1]).resolve()
    assert hashlib.sha256(driver.read_bytes()).hexdigest() == DRIVER_SHA256
    track, previous = bytearray(), 0
    for tick, event in EVENTS:
        track.extend(vlq(tick - previous))
        track.extend(event)
        previous = tick
    midi = (b"MThd" + (6).to_bytes(4, "big") + bytes([0, 0, 0, 1, 0, 96])
            + b"MTrk" + len(track).to_bytes(4, "big") + track)
    with tempfile.TemporaryDirectory(prefix="wmh-original-native-tie-graph-") as directory:
        process = subprocess.Popen(
            [str(driver), str(Path(directory) / "Scores")],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
        )
        try:
            def call(path, body):
                envelope = {
                    "path": path,
                    "headers": {"content-type": "application/json",
                                "x-wmh-filename": "original-native-tie-graph.zip"},
                    "body_base64": base64.b64encode(body).decode(),
                }
                process.stdin.write(json.dumps(envelope) + "\n")
                process.stdin.flush()
                response = json.loads(process.stdout.readline())
                assert response["status"] == 200, response
                return json.loads(base64.b64decode(response["body_base64"]))

            draft = call("/api/clean-song/draft", json.dumps({
                "source_base64": base64.b64encode(midi).decode(),
                "source_name": "original-native-tie-graph.mid",
                "title": "Original overlapping C4 chains and isolated G4",
                "intent": "basic_keys",
            }).encode())
            package = draft["package"]
            metadata = json.loads(package["metadata_json"])
            metadata["rights"] = {
                "status": "original_authored",
                "attribution": "Original overlapping C4 attacks and isolated G4 authored by this generator for complete native source-tie browser validation",
                "license": "CC0-1.0",
            }
            archive = io.BytesIO()
            with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
                output.writestr("manifest.json", json.dumps({
                    "format": "worldmusichub-song-pack", "version": 2,
                    "songs": [{"folder": "songs/original"}],
                }))
                output.writestr("songs/original/metadata.json", json.dumps(metadata, separators=(",", ":"), sort_keys=True))
                output.writestr("songs/original/score.json", package["score_json"])
            imported = call("/api/library/import/commit", archive.getvalue())
            entry = imported["items"][0]["entry"]
            loaded = call("/api/library/load", json.dumps({"key": entry["key"]}).encode())
            request = {
                "source": {"key": entry["key"], "content_sha256": entry["content_sha256"],
                           "profile": "wmh-basic-keys-midi1-v1"},
                "settings": {"part_id": "midi-t1-c1-r0",
                             "rendition_policy_id": "wmh-basic-key-rendition-fifo-v1",
                             "first_measure": 0, "measure_count": 3,
                             "display_meter": {"numerator": 4, "denominator": 4}},
            }
            response = call("/api/library/basic-keys/notation", json.dumps(request).encode())
            page = response["page"]
            assert page["status"] == "ready" and page["view_version"] == 2
            assert page["measure_count"] == 3
            segments = page["musicxml"]["note_id_map"]["segments"]
            assert len(segments) == 7
            notes = page["score"]["parts"][0]["notes"]
            assert [note["id"] for note in notes] == ["midi-t1-e1", "midi-t1-e2", "midi-t1-e5"]
            assert [sum(segment["source_note_id"] == note["id"] for segment in segments) for note in notes] == [3, 3, 1]
            assert [item["receiver_end_tick"] for item in page["interpreted_notes"]] == [888, 972, 1056]
            fixture = {
                "provenance": {
                    "generator": "scripts/generate-native-tie-browser-fixture.py",
                    "native_driver_sha256": DRIVER_SHA256,
                    "source_sha256": hashlib.sha256(midi).hexdigest(),
                    "source_base64": base64.b64encode(midi).decode(),
                    "source_ppq": 96,
                    "source_events": [{"tick": tick, "bytes": event} for tick, event in EVENTS],
                    "rights": metadata["rights"],
                },
                "open": {"score_json": loaded["score_json"], "clean_package": loaded["clean_package"]},
                "request": request,
                "response": response,
            }
        finally:
            process.stdin.close()
            try:
                returncode = process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
                raise
        assert returncode == 0
    destination = Path(__file__).resolve().parent.parent / "tests/fixtures/basic-key-native-tie-graph-browser.json"
    destination.write_text(json.dumps(fixture, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    print(destination)


if __name__ == "__main__":
    main()
