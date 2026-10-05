#!/usr/bin/env python3
"""Reproduce an original Basic MIDI fixture through the socket-free native API.

The native driver must be built from the stated source revision. This program
records its hash; its build/source binding remains a separate verification step.
No production response field, including saved_at_unix_ms, is rewritten.
"""
import argparse
import base64
import hashlib
import json
import pathlib
import re
import struct
import subprocess
import tempfile

SOURCE_NAME = "original-active-and-empty.mid"
FIXTURE_NAME = "original-active-and-empty-native-open.json"
TRACE_NAME = "original-active-and-empty-native-trace.json"
SOURCE_HEX = "4d546864000000060001000200604d54726b0000000c00903c5a60803c0000ff2f004d54726b0000000b00c10000b1076460ff2f00"
SOURCE_SHA256 = "d371ac6a790dc160c8ec99deb6a267197fc8f0233d6049c5038e3ea6d0bbb386"
SOURCE_GIT_BLOB = "834788d1d39216bb5f779065ac654febc546c8ec"
CALL_PATHS = ["/api/clean-song/draft", "/api/clean-song/draft/pack", "/api/library/import/commit", "/api/library/load"]


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def git_blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, indent=2) + "\n").encode("utf-8")


def original_source():
    # PPQ96, two format-1 tracks. First: C4 on/off. Second: a channel-2
    # program and volume setting with no attack. Both end at tick96.
    tracks = [
        bytes([0, 0x90, 60, 90, 96, 0x80, 60, 0, 0, 255, 47, 0]),
        bytes([0, 0xC1, 0, 0, 0xB1, 7, 100, 96, 255, 47, 0]),
    ]
    source = b"MThd" + struct.pack(">IHHH", 6, 1, 2, 96)
    source += b"".join(b"MTrk" + struct.pack(">I", len(track)) + track for track in tracks)
    assert len(source) == 53 and source.hex() == SOURCE_HEX
    assert sha256(source) == SOURCE_SHA256 and git_blob(source) == SOURCE_GIT_BLOB
    return source


def verify_trace(trace, fixture_bytes):
    assert [row["request"]["path"] for row in trace] == CALL_PATHS
    decoded = []
    for row in trace:
        assert row["request"]["method"] == "POST"
        response = row["native_response"]
        assert response["status"] == 200
        body = json.loads(base64.b64decode(response["body_base64"], validate=True))
        assert body == row["decoded_response"]
        decoded.append(body)
    draft_input = json.loads(trace[0]["request"]["body_utf8"])
    assert base64.b64decode(draft_input["source_base64"], validate=True) == original_source()
    assert draft_input["source_name"] == SOURCE_NAME and draft_input["intent"] == "basic_keys"
    pack_input = json.loads(trace[1]["request"]["body_utf8"])
    assert pack_input == draft_input | {"expected_draft_sha256": decoded[0]["draft_sha256"]}
    assert base64.b64decode(trace[2]["request"]["body_base64"], validate=True) == base64.b64decode(decoded[1]["zip_base64"], validate=True)
    imported = decoded[2]["items"][0]["entry"]
    assert json.loads(trace[3]["request"]["body_utf8"]) == {"key": imported["key"]}
    assert fixture_bytes == json_bytes(decoded[3]), "Every output field and exact fixture byte must match the native response"
    runtime = decoded[3]["clean_package"]["runtime"]
    assert runtime["profile"] == "wmh-basic-key-practice-v2"
    assert [p["id"] for p in runtime["parts"]] == ["midi-t1-c1-r0", "midi-t2-c2-r0"]
    assert [p["attacks"] for p in runtime["parts"]] == [1, 0]
    assert runtime["compilation"]["timeline"]["notes"] == [["midi-t1-e1", "midi-t1-c1-r0", 60, 90, 0.0, 500.0]]
    return {
        "verified": True,
        "native_call_paths": CALL_PATHS,
        "source_bytes": 53,
        "source_sha256": SOURCE_SHA256,
        "source_git_blob": SOURCE_GIT_BLOB,
        "fixture_bytes": len(fixture_bytes),
        "fixture_sha256": sha256(fixture_bytes),
        "fixture_git_blob": git_blob(fixture_bytes),
        "all_native_fields_retained": True,
    }


def generate(args):
    output = pathlib.Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ValueError("Choose an empty output directory; existing files are never replaced")
    driver = pathlib.Path(args.driver).resolve(strict=True)
    assert re.fullmatch(r"[a-f0-9]{40}", args.source_commit)
    source = original_source()
    trace = []
    with tempfile.TemporaryDirectory(prefix="original-empty-part-", dir=output) as isolated:
        process = subprocess.Popen([str(driver), str(pathlib.Path(isolated) / "Scores")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        try:
            def request(path, body=None, raw=None):
                headers = {"content-type": "application/json"} if raw is None else {"content-type": "application/zip", "x-wmh-filename": "original-active-and-empty.zip"}
                envelope = {"path": path, "method": "POST", "headers": headers}
                envelope["body_utf8" if raw is None else "body_base64"] = json.dumps(body) if raw is None else base64.b64encode(raw).decode()
                process.stdin.write(json.dumps(envelope) + "\n")
                process.stdin.flush()
                response = json.loads(process.stdout.readline())
                if response["status"] != 200:
                    raise ValueError(f"Native request {path} failed with status {response['status']}")
                decoded = json.loads(base64.b64decode(response["body_base64"], validate=True))
                trace.append({"request": envelope, "native_response": response, "decoded_response": decoded})
                return decoded

            original = {"source_base64": base64.b64encode(source).decode(), "source_name": SOURCE_NAME, "title": "Original active C4 and retained empty part", "intent": "basic_keys"}
            draft = request(CALL_PATHS[0], original)
            pack = request(CALL_PATHS[1], original | {"expected_draft_sha256": draft["draft_sha256"]})
            saved = request(CALL_PATHS[2], raw=base64.b64decode(pack["zip_base64"]))
            assert saved["summary"]["saved"] == 1
            opened = request(CALL_PATHS[3], {"key": saved["items"][0]["entry"]["key"]})
            process.stdin.close()
            assert process.wait(timeout=30) == 0
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=30)
    fixture = json_bytes(opened)
    proof = verify_trace(trace, fixture)
    (output / SOURCE_NAME).write_bytes(source)
    (output / FIXTURE_NAME).write_bytes(fixture)
    (output / TRACE_NAME).write_bytes(json_bytes(trace))
    provenance = proof | {
        "version": 1,
        "original_authored": True,
        "license": "CC0-1.0",
        "description": "Newly authored C4 attack/release and an empty program/volume-only part. No private song or third-party musical material is used.",
        "source_file": SOURCE_NAME,
        "source_hex": SOURCE_HEX,
        "fixture_file": FIXTURE_NAME,
        "generator_file": pathlib.Path(__file__).name,
        "generator_sha256": sha256(pathlib.Path(__file__).read_bytes()),
        "native_source_commit": args.source_commit,
        "native_driver_sha256": sha256(driver.read_bytes()),
        "native_protocol_trace": TRACE_NAME,
        "native_protocol_trace_sha256": sha256((output / TRACE_NAME).read_bytes()),
        "reconstruction": "Decode the final native response body_base64, parse its JSON, then serialize with json.dumps(indent=2) plus one newline. This reconstructs every fixture byte without replacing any production field.",
        "first_save_time": "entry.saved_at_unix_ms is the real first import time in the isolated library. A new generation changes that timestamp; this program does not rewrite it.",
        "rights_note": "The converter's generic user_supplied_unverified provenance is retained. Authorship and CC0 permission for these newly authored test bytes are documented here independently of production labels.",
        "build_note": "The source commit is provided by the caller. Verify the driver's build binding separately; a command-line commit value alone does not attest executable provenance.",
    }
    (output / "provenance.json").write_bytes(json_bytes(provenance))
    print(json.dumps(proof))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    build = commands.add_parser("generate")
    build.add_argument("--driver", required=True)
    build.add_argument("--output", required=True)
    build.add_argument("--source-commit", required=True)
    check = commands.add_parser("verify")
    check.add_argument("--trace", required=True)
    check.add_argument("--fixture", required=True)
    args = parser.parse_args()
    if args.command == "generate":
        generate(args)
    else:
        print(json.dumps(verify_trace(json.loads(pathlib.Path(args.trace).read_bytes()), pathlib.Path(args.fixture).read_bytes()), indent=2))


if __name__ == "__main__":
    main()
