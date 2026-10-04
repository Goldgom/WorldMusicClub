#!/usr/bin/env python3
"""Author one sustained C4 and capture the socket-free native source-bound page.

Usage: python3 scripts/generate-open-tie-fixture.py /absolute/native_import_driver
Add --accidental-collision to generate the independent C4/C-sharp4 reader case.
No imported/private music is read. The driver owns a disposable temporary library.
"""
import base64
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile


def vlq(value):
    values = [value & 127]
    while value >> 7:
        value >>= 7
        values.append((value & 127) | 128)
    return bytes(reversed(values))


# Original isolated C4: ten quarter beats, followed by two silent quarter beats.
collision = "--accidental-collision" in sys.argv[2:]
track = bytes([0, 0x90, 60, 90]) + vlq(10240) + bytes([0x80, 60, 0]) + vlq(2048) + bytes([255, 47, 0])
if collision:
    # Simultaneous isolated C/C-sharp lasting10/6 quarters; no authored melody.
    track = bytes([0, 0x90, 60, 90, 0, 0x90, 61, 90]) + vlq(576) + bytes([0x80, 61, 0]) + vlq(384) + bytes([0x80, 60, 0]) + vlq(192) + bytes([255, 47, 0])
ppq = 96 if collision else 1024
midi = b'MThd' + (6).to_bytes(4, 'big') + bytes([0, 0, 0, 1]) + ppq.to_bytes(2, 'big') + b'MTrk' + len(track).to_bytes(4, 'big') + track
with tempfile.TemporaryDirectory(prefix='wmh-original-open-tie-') as temporary:
    process = subprocess.Popen([sys.argv[1], temporary + '/Scores'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)

    def call(path, body):
        envelope = {'path': path, 'headers': {'content-type': 'application/json', 'x-wmh-filename': 'original-open-tie.zip'}, 'body_base64': base64.b64encode(body).decode()}
        process.stdin.write(json.dumps(envelope) + '\n')
        process.stdin.flush()
        response = json.loads(process.stdout.readline())
        assert response['status'] == 200, response
        return json.loads(base64.b64decode(response['body_base64']))

    draft = call('/api/clean-song/draft', json.dumps({'source_base64': base64.b64encode(midi).decode(), 'source_name': 'original-single-c.mid', 'title': 'Original simultaneous isolated C4 and C-sharp4' if collision else 'Original isolated open-boundary C4', 'intent': 'basic_keys'}).encode())
    package = draft['package']
    metadata = json.loads(package['metadata_json'])
    metadata['rights'] = {'status': 'original_authored', 'attribution': 'Original isolated C4 and C-sharp4 authored by this generator for source-bound tie validation' if collision else 'Original isolated C4 authored by this generator for source-bound tie validation', 'license': 'CC0-1.0'}
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as output:
        output.writestr('manifest.json', json.dumps({'format': 'worldmusichub-song-pack', 'version': 2, 'songs': [{'folder': 'songs/original'}]}))
        output.writestr('songs/original/metadata.json', json.dumps(metadata, separators=(',', ':'), sort_keys=True))
        output.writestr('songs/original/score.json', package['score_json'])
    imported = call('/api/library/import/commit', archive.getvalue())
    entry = imported['items'][0]['entry']
    loaded = call('/api/library/load', json.dumps({'key': entry['key']}).encode())
    request = {'source': {'key': entry['key'], 'content_sha256': entry['content_sha256'], 'profile': 'wmh-basic-keys-midi1-v1'}, 'settings': {'part_id': 'midi-t1-c1-r0', 'rendition_policy_id': 'wmh-basic-key-rendition-fifo-v1', 'first_measure': 0 if collision else 1, 'measure_count': 3 if collision else 2, 'display_meter': {'numerator': 4, 'denominator': 4}}}
    response = call('/api/library/basic-keys/notation', json.dumps(request).encode())
    assert response['page']['status'] == 'ready'
    assert len(response['page']['musicxml']['note_id_map']['segments']) == (5 if collision else 2)
    fixture = {'open': {'score_json': loaded['score_json'], 'clean_package': loaded['clean_package']}, 'request': request, 'response': response}
    destination = Path(__file__).resolve().parent.parent / ('tests/fixtures/basic-key-accidental-tie-page.json' if collision else 'tests/fixtures/basic-key-open-tie-page.json')
    destination.write_text(json.dumps(fixture, ensure_ascii=False, indent=2, sort_keys=True) + '\n')
    process.stdin.close()
    assert process.wait() == 0
    print(destination)
