#!/usr/bin/env python3
"""Maintainer-only preparation of fixed CC0 candidates; no app/runtime engine execution.

Sources and converter are pinned by the committed manifest. Outputs remain review artifacts,
not automatically added to the playable catalog. Run under an ordinary display/Xvfb on Linux.
"""
import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'catalog/sources/openscore-lieder-candidates.json'
MAX_SOURCE = 4 * 1024 * 1024
VENDOR_HEADER = re.compile(r'<!DOCTYPE score-partwise\s+PUBLIC "-//Recordare//DTD MusicXML 3\.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise\.dtd">')


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def download(url, path, limit, expected=None):
    if not path.exists():
        temporary = path.with_suffix(path.suffix + '.download')
        total = 0
        with urllib.request.urlopen(url, timeout=90) as response, temporary.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > limit:
                    raise ValueError('Download exceeds its fixed size limit')
                output.write(chunk)
        temporary.replace(path)
    if path.stat().st_size > limit or expected and digest(path) != expected:
        raise ValueError(f'Pinned digest/size mismatch for {path.name}')


def validate_manifest(manifest):
    if manifest['version'] != 1 or manifest['upstream_repository'] != 'OpenScore/Lieder':
        raise ValueError('Only the fixed OpenScore/Lieder preparation contract is supported')
    if not re.fullmatch('[0-9a-f]{40}', manifest['upstream_commit']):
        raise ValueError('Pin a complete upstream Git commit')
    if not 1 <= len(manifest['scores']) <= 16:
        raise ValueError('Review at most sixteen fixed candidates per batch')
    ids = set()
    for score in manifest['scores']:
        if not re.fullmatch('[a-z0-9-]{1,100}', score['id']) or score['id'] in ids:
            raise ValueError('Candidate IDs must be unique portable labels')
        ids.add(score['id'])
        if score['edition_license'] != 'CC0-1.0' or not re.fullmatch('[0-9a-f]{64}', score['source_sha256']):
            raise ValueError('An explicit CC0 edition and pinned source digest are required')
        path = Path(score['source_path'])
        if path.is_absolute() or '..' in path.parts or not score['source_path'].startswith('scores/') or path.suffix != '.mscx':
            raise ValueError('Candidate must refer to a score inside the pinned corpus')


def normalize_converted_xml(raw):
    text = raw.decode('utf-8')
    normalized, count = VENDOR_HEADER.subn('', text)
    if count > 1 or '<!DOCTYPE' in normalized or '<!ENTITY' in normalized:
        raise ValueError('Unsupported converter DTD/entity declaration; review explicitly')
    return normalized, ([] if not count else ['Removed only the fixed MuseScore3.6.2 MusicXML3.1 external DOCTYPE for strict application import. Raw converter output is retained separately; no entity/DTD resolution.'])


def source_pitch_inventory(data):
    root = ET.fromstring(data)
    copyright = [node.text or '' for node in root.findall('./Score/metaTag') if node.get('name') == 'copyright']
    if not any('CC0' in text for text in copyright):
        raise ValueError('Individual source does not carry the expected CC0 statement')
    return Counter(int(note.findtext('pitch')) for staff in root.findall('./Score/Staff') for note in staff.findall('.//Note'))


def xml_pitch_inventory(text):
    root = ET.fromstring(text)
    values = []
    offsets = dict(C=0, D=2, E=4, F=5, G=7, A=9, B=11)
    for note in root.findall('./part/measure/note'):
        p = note.find('pitch')
        if p is not None:
            values.append(12 * (int(p.findtext('octave')) + 1) + offsets[p.findtext('step')] + int(p.findtext('alter', '0')))
    return Counter(values)


def run_bounded(arguments, cwd, env, log, timeout=120, output_root=None):
    with log.open('wb') as out:
        process = subprocess.Popen(arguments, cwd=cwd, env=env, stdout=out, stderr=subprocess.STDOUT, start_new_session=True)
        started = time.monotonic()
        try:
            while process.poll() is None:
                files = [p for p in output_root.rglob('*') if p.is_file()] if output_root else []
                excessive_output = len(files) > 128 or sum(p.stat().st_size for p in files) > 64 * 1024 * 1024
                if time.monotonic() - started > timeout or log.stat().st_size > 1024 * 1024 or excessive_output:
                    raise RuntimeError('Converter runtime/log/output limit reached')
                time.sleep(.1)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
    if process.returncode != 0:
        raise RuntimeError(f'Converter exited {process.returncode}; inspect the retained log')


def post(base, route, body, content_type):
    try:
        with urllib.request.urlopen(urllib.request.Request(base + route, data=body, headers={'Content-Type': content_type}), timeout=20) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--server-binary', type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8')); validate_manifest(manifest)
    work = args.workspace.resolve(); work.mkdir(parents=True, exist_ok=True)
    inputs, output = work / 'inputs', work / 'review-artifacts'
    inputs.mkdir(exist_ok=True); output.mkdir(exist_ok=True)
    converter = manifest['converter']; appimage = work / 'MuseScore.AppImage'
    download(converter['url'], appimage, converter['bytes'], converter['sha256'])
    appimage.chmod(0o755)
    env = os.environ.copy()
    for key in ['HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_RUNTIME_DIR']:
        directory = work / ('private-' + key.lower()); directory.mkdir(exist_ok=True); env[key] = str(directory)
    if not (work / 'squashfs-root/AppRun').exists():
        run_bounded([str(appimage), '--appimage-extract'], work, env, work / 'extract.log')
    binary = work / 'squashfs-root/AppRun'
    config = work / 'converter-config'; config.mkdir(exist_ok=True)
    engine_args = [str(binary), '-w', '-m', '-s', '-c', str(config)]
    run_bounded(engine_args + ['--version'], work, env, output / 'converter-version.log')
    upstream = 'https://raw.githubusercontent.com/OpenScore/Lieder/' + manifest['upstream_commit'] + '/'
    license_path = output / 'OPENSCORE-CC0.txt'
    download(upstream + 'LICENSE.txt', license_path, 64 * 1024)
    results = []
    server = subprocess.Popen([str(args.server_binary.resolve()), '--no-open', '--port', '17880'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = 'http://127.0.0.1:17880'
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(base + '/api/health', timeout=1).close(); break
            except (urllib.error.URLError, ConnectionError): time.sleep(.05)
        else: raise RuntimeError('Rust server startup failed')
        for score in manifest['scores']:
            slug = score['id']; source = inputs / (slug + '.mscx'); folder = output / slug; folder.mkdir(exist_ok=True)
            download(upstream + urllib.parse.quote(score['source_path']), source, score['source_bytes'], score['source_sha256'])
            expected = source_pitch_inventory(source.read_bytes())
            (folder / 'original.mscx').write_bytes(source.read_bytes())
            raw = folder / 'converter.musicxml'
            run_bounded(engine_args + ['-o', str(raw), str(source)], work, env, folder / 'conversion.log', output_root=folder)
            if raw.stat().st_size > MAX_SOURCE: raise ValueError('Converted score exceeds4MiB review bound')
            normalized, changes = normalize_converted_xml(raw.read_bytes()); actual = xml_pitch_inventory(normalized)
            (folder / 'import.musicxml').write_text(normalized, encoding='utf-8')
            status, imported = post(base, '/api/import/musicxml', normalized.encode(), 'application/xml')
            result = {'id': slug, 'source_sha256': digest(source), 'raw_converter_sha256': digest(raw), 'import_xml_sha256': digest(folder / 'import.musicxml'), 'normalizations': changes, 'written_source_pitch_count': sum(expected.values()), 'converted_pitch_count': sum(actual.values()), 'pitch_inventory_matches': expected == actual, 'rust_import_status': status, 'status': 'pending_musical_review'}
            if status == 200:
                (folder / 'compiled.json').write_text(json.dumps(imported, ensure_ascii=False, indent=2), encoding='utf-8')
                result['import_diagnostics'] = imported['diagnostics']
                result['canonical_written_events'] = sum(len(p['notes']) for p in imported['score']['parts'])
                result['sounding_notes'] = len(imported['timeline']['notes'])
            else: result['import_error'] = imported
            # A readable source rendering supports human review; no copied commercial scan.
            run_bounded(engine_args + ['-r', '120', '-o', str(folder / 'source.png'), str(source)], work, env, folder / 'render.log', output_root=folder)
            results.append(result)
        report = {'manifest': manifest, 'license_sha256': digest(license_path), 'results': results, 'automatically_bundled': False, 'acceptance': 'Candidate conversion/import evidence only. Pitch inventories do not prove rhythm, voice, expression or instrument compatibility; review source images and every diagnostic before catalog admission.'}
        (output / 'conversion-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({'candidates': len(results), 'importable': sum(r['rust_import_status'] == 200 for r in results), 'all_pitch_inventories_match': all(r['pitch_inventory_matches'] for r in results)}))
        return 0 if all(r['rust_import_status'] == 200 and r['pitch_inventory_matches'] for r in results) else 1
    finally:
        server.terminate(); server.wait(timeout=5)


if __name__ == '__main__':
    raise SystemExit(main())
