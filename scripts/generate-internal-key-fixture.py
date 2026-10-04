#!/usr/bin/env python3
"""Capture original internal-key notation pages through a socket-free native driver.

Usage: python3 scripts/generate-internal-key-fixture.py /absolute/native_import_driver SOURCE_SHA
No imported/private music is read. Each case owns a disposable temporary library.
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


def vlq(value):
    values = [value & 127]
    while value >> 7:
        value >>= 7
        values.append((value & 127) | 128)
    return bytes(reversed(values))


def midi(crossing):
    events = [(0, b'\xff\x59\x02\x01\x00'), (0, b'\xff\x58\x04\x04\x02\x18\x08')]
    if crossing:
        events += [(0, bytes([0x90, 48, 90])), (480, b'\xff\x59\x02\x02\x00'),
                   (960, bytes([0x80, 48, 0])), (960, bytes([0x90, 66, 90])), (1440, bytes([0x80, 66, 0]))]
    else:
        events += [(0, bytes([0x90, 65, 90])), (240, bytes([0x80, 65, 0])), (480, b'\xff\x59\x02\x02\x00'),
                   (480, bytes([0x90, 66, 90])), (960, bytes([0x80, 66, 0])), (1920, bytes([0x90, 66, 90])),
                   (2400, bytes([0x80, 66, 0])), (2760, b'\xff\x59\x02\xfe\x00'),
                   (2760, bytes([0x90, 70, 90])), (3240, bytes([0x80, 70, 0]))]
    events.append((3840, b'\xff\x2f\x00'))
    track, previous = b'', 0
    for tick, event in sorted(events, key=lambda item: item[0]):
        track += vlq(tick - previous) + event
        previous = tick
    return b'MThd' + (6).to_bytes(4, 'big') + bytes([0, 0, 0, 1]) + (480).to_bytes(2, 'big') + b'MTrk' + len(track).to_bytes(4, 'big') + track


def capture(crossing):
    name = 'crossing' if crossing else 'noncrossing'
    with tempfile.TemporaryDirectory(prefix='wmc-original-internal-key-') as temporary:
        process = subprocess.Popen([sys.argv[1], temporary + '/Scores'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)

        def call(path, body):
            request = {'path': path, 'headers': {'content-type': 'application/json', 'x-wmh-filename': 'original-internal-key.zip'}, 'body_base64': base64.b64encode(body).decode()}
            process.stdin.write(json.dumps(request) + '\n')
            process.stdin.flush()
            response = json.loads(process.stdout.readline())
            assert response['status'] == 200, response
            return json.loads(base64.b64decode(response['body_base64']))

        draft = call('/api/clean-song/draft', json.dumps({'source_base64': base64.b64encode(midi(crossing)).decode(), 'source_name': f'original-internal-key-{name}.mid', 'title': f'Original internal key timing {name}', 'intent': 'basic_keys'}).encode())
        package = draft['package']
        metadata = json.loads(package['metadata_json'])
        metadata['rights'] = {'status': 'original_authored', 'attribution': 'Original isolated key-change diagnostic tones authored by this generator', 'license': 'CC0-1.0'}
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as output:
            output.writestr('manifest.json', json.dumps({'format': 'worldmusichub-song-pack', 'version': 2, 'songs': [{'folder': 'songs/original'}]}))
            output.writestr('songs/original/metadata.json', json.dumps(metadata, separators=(',', ':'), sort_keys=True))
            output.writestr('songs/original/score.json', package['score_json'])
        imported = call('/api/library/import/commit', archive.getvalue())
        entry = imported['items'][0]['entry']
        loaded = call('/api/library/load', json.dumps({'key': entry['key']}).encode())
        request = {'source': {'key': entry['key'], 'content_sha256': entry['content_sha256'], 'profile': 'wmh-basic-keys-midi1-v1'}, 'settings': {'part_id': 'midi-t1-c1-r0', 'rendition_policy_id': 'wmh-basic-key-rendition-fifo-v1', 'first_measure': 0, 'measure_count': 2, 'display_meter': {'numerator': 4, 'denominator': 4}}}
        response = call('/api/library/basic-keys/notation', json.dumps(request).encode())
        assert response['page']['status'] == 'ready'
        process.stdin.close()
        assert process.wait() == 0
        return {'open': {'score_json': loaded['score_json'], 'clean_package': loaded['clean_package']}, 'request': request, 'response': response}


fixture = {'provenance': {'kind': 'original_authored', 'license': 'CC0-1.0', 'driver_source': sys.argv[2], 'driver_sha256': hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest()}, 'noncrossing': capture(False), 'crossing': capture(True)}
destination = Path(__file__).resolve().parent.parent / 'tests/fixtures/basic-key-internal-key-pages.json'
destination.write_text(json.dumps(fixture, ensure_ascii=False, indent=2, sort_keys=True) + '\n')
print(destination)
