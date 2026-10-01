#!/usr/bin/env python3
"""Maintainer-only preparation of fixed CC0 candidates; no app/runtime engine execution.

Sources and converter are pinned by the committed manifest. Outputs remain review artifacts,
not automatically added to the playable catalog. Run under an ordinary display/Xvfb on Linux.
"""
import argparse
from bisect import bisect_right
from collections import Counter
from fractions import Fraction
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
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
        if score.get('status') not in ['held', 'conversion_and_review_pending']:
            raise ValueError('Every candidate needs an explicit held or pending review state')
        if score['status'] == 'held' and not all(
            isinstance(score.get(field), str) and score[field].strip()
            for field in ['hold_reason', 'expected_import_error', 'next_step']
        ):
            raise ValueError('Held candidates require a reason, exact expected refusal and next review step')
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


def canonical_pitch_inventory(compilation):
    offsets = dict(C=0,D=2,E=4,F=5,G=7,A=9,B=11)
    return Counter(12*(n['pitch']['octave']+1)+offsets[n['pitch']['step']]+n['pitch']['alter']
                   for part in compilation['score']['parts'] for n in part['notes'] if n['pitch'] is not None)


def written_event_inventory(xml):
    """Independent comparison of ordinary explicit MusicXML note/backup durations.

    Grace/untimed and empty-measure inference are deliberately not invented here.
    This verifies the supported candidate subset, not every MusicXML feature.
    """
    root=ET.fromstring(xml); parts=[]
    for part in root.findall('part'):
        divisions=None; measures=[]
        for measure in part.findall('measure'):
            cursor=Fraction(0); extent=Fraction(0); anchor=None; notes=[]
            for child in measure:
                if child.tag=='attributes' and child.find('divisions') is not None:
                    divisions=Fraction(child.findtext('divisions'))
                elif child.tag in ['backup','forward']:
                    amount=Fraction(child.findtext('duration'))/divisions
                    cursor += -amount if child.tag=='backup' else amount
                    extent=max(extent,cursor)
                elif child.tag=='note':
                    if child.find('grace') is not None or child.find('duration') is None:
                        raise ValueError('Untimed/grace notes require a separate reviewed interpretation')
                    duration=Fraction(child.findtext('duration'))/divisions
                    at=anchor if child.find('chord') is not None else cursor
                    if at is None:raise ValueError('Chord without a source onset')
                    if child.find('chord') is None:anchor=cursor;cursor+=duration
                    extent=max(extent,at+duration)
                    pitch=child.find('pitch'); value=None if pitch is None else (pitch.findtext('step'),int(pitch.findtext('alter','0')),int(pitch.findtext('octave')))
                    ties={node.get('type') for node in child.findall('tie')}
                    notes.append((at,duration,value,child.findtext('voice','1'),int(child.findtext('staff','1')),'start' in ties,'stop' in ties))
            if extent<=0:raise ValueError('An empty measure needs separately checked meter inference')
            measures.append((extent,notes))
        parts.append((part.get('id'),measures))
    if len({len(measures) for _,measures in parts})!=1:raise ValueError('Unequal source measure counts require review')
    starts=[];cursor=Fraction(0)
    for ordinal in range(len(parts[0][1])):
        starts.append(cursor);cursor+=max(measures[ordinal][0] for _,measures in parts)
    return Counter((part_id,str(starts[index]+at),str(duration),pitch,voice,staff,start,stop)
                   for part_id,measures in parts for index,(_,notes) in enumerate(measures)
                   for at,duration,pitch,voice,staff,start,stop in notes)


def canonical_written_inventory(compilation):
    b=lambda value:str(Fraction(value['numerator'],value['denominator']))
    return Counter((part['id'],b(n['at']),b(n['duration']),None if n['pitch'] is None else (n['pitch']['step'],n['pitch']['alter'],n['pitch']['octave']),n['voice'],n['staff'],n['tie_start'],n['tie_stop'])
                   for part in compilation['score']['parts'] for n in part['notes'])


def observed_key_reference(observation):
    """Project raw MIDI keys through its tempo map; never apply controller behavior.

    Duration pairing is refused for overlapping same-port/channel/pitch presses.
    The returned shape supports comparison only, not canonical score compilation.
    """
    ppqn = observation['ticks_per_quarter']
    tempos = observation['tempo_events']
    ticks, micros, elapsed = [], [], []
    total = Fraction(0)
    for event in tempos:
        tick, value = event['tick'], event['microseconds_per_quarter']
        if ticks:
            total += Fraction((tick - ticks[-1]) * micros[-1], ppqn)
        ticks.append(tick)
        micros.append(value)
        elapsed.append(total)

    def millis(tick):
        index = bisect_right(ticks, tick) - 1
        return float((elapsed[index] + Fraction((tick - ticks[index]) * micros[index], ppqn)) / 1000)

    notes, active, orphan_offs = [], {}, 0
    for event in observation['note_messages']:
        lane = (event['port'], event['channel'], event['midi'])
        pending = active.setdefault(lane, [])
        if event['kind'] == 'on':
            note = {**event, 'id': f"raw-key-{len(notes)}", 'start_ms': millis(event['tick']),
                    'duration_ms': None, 'ambiguous_overlap': bool(pending)}
            for index in pending:
                notes[index]['ambiguous_overlap'] = True
            pending.append(len(notes))
            notes.append(note)
        elif not pending:
            orphan_offs += 1
        else:
            index = pending.pop(0)
            note = notes[index]
            if not note['ambiguous_overlap']:
                note['duration_ms'] = millis(event['tick']) - note['start_ms']
                note['end_tick'] = event['tick']
    return {'score': {'tempo': tempos}, 'timeline': {'notes': notes, 'duration_ms': millis(observation['final_tick'])},
            'diagnostics': [], 'raw_midi_key_observation_only': True,
            'unpaired_or_ambiguous_key_durations': sum(n['duration_ms'] is None for n in notes),
            'orphan_note_off_messages': orphan_offs, 'non_note_messages': observation['non_note_messages'],
            'interpretation': observation['interpretation']}


def reference_agreement(canonical, reference, assessment):
    expected = {note['id']: note for note in canonical['timeline']['notes']}
    observed = {}
    for note in reference['timeline']['notes']:
        observed.setdefault((note['midi'], note['start_ms']), []).append(note)
    durations = []
    ambiguous = 0
    for hit in assessment['hits']:
        candidates = observed.get((hit['midi'], hit['actual_ms']), [])
        if len(candidates) != 1 or candidates[0]['duration_ms'] is None:
            ambiguous += 1
            continue
        durations.append(candidates[0]['duration_ms'] - expected[hit['note_id']]['duration_ms'])
    return {'matcher_tolerance_ms': 10, 'canonical_sounding_notes': len(expected), 'reference_midi_note_ons': len(reference['timeline']['notes']),
            'matched_note_ons': len(assessment['hits']), 'matches_within_1ms': sum(abs(h['delta_ms']) <= 1 for h in assessment['hits']),
            'missed_canonical_attacks': len(assessment['misses']), 'extra_reference_attacks': len(assessment['extras']),
            'unambiguous_noteoff_duration_comparisons': len(durations), 'ambiguous_unison_durations_not_guessed': ambiguous,
            'duration_differences_over_1ms': sum(abs(d) > 1 for d in durations), 'largest_duration_difference_ms': max(map(abs, durations), default=0),
            'canonical_duration_ms': canonical['timeline']['duration_ms'], 'reference_duration_ms': reference['timeline']['duration_ms'],
            'canonical_tempo_map': canonical['score'].get('tempo', []),
            'reference_tempo_map': reference['score']['tempo'], 'reference_diagnostics': reference['diagnostics'],
            'interpretation': 'Reference software note-ons/key-noteoffs, not acoustic sustain or musical truth. Generated ornaments, fermatas, articulation, dynamics, channels and repeat policies may differ. Every mismatch remains visible; this is not an automatic acceptance score.'}


def written_beat_attack_agreement(canonical, keys, ppqn):
    # Without repeats, the first segment of each tied sounding note identifies
    # its exact written onset. Repeated material needs an occurrence-aware map.
    if canonical['score']['repeats']:
        return {'available': False, 'reason': 'Repeat-expanded written-beat comparison is not implemented'}
    source = {n['id']: n for part in canonical['score']['parts'] for n in part['notes']}
    expected = Counter((n['midi'], str(Fraction(source[n['source_note_id']]['at']['numerator'],
                                             source[n['source_note_id']]['at']['denominator'])))
                       for n in canonical['timeline']['notes'])
    observed = Counter((n['midi'], str(Fraction(n['tick'], ppqn))) for n in keys['timeline']['notes'])
    return {'available': True, 'missing': list((expected - observed).elements()),
            'extra': list((observed - expected).elements()),
            'interpretation': 'Pitch/onset inventories in written quarter beats only; ignores expression and tempo realization, does not erase the separate wall-clock mismatch report.'}


def candidate_gate(score, result):
    if not result['pitch_inventory_matches']:
        return False
    if score.get('status') == 'held':
        # A known held work is never admitted by changing the expected music. Even a new
        # successful import requires a fresh review/manifest decision rather than auto-entry.
        return result['rust_import_status'] == 400 and score['expected_import_error'] in result.get('import_error', {}).get('error', '')
    return result['rust_import_status'] == 200 and result.get('canonical_pitch_inventory_matches') is True and result.get('canonical_written_events_match') is True and not any(d['code'] in ['orphan_tie', 'broken_tie', 'unclosed_tie'] for d in result.get('import_diagnostics', []))


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
    parser.add_argument('--reference-inspector', type=Path)
    args = parser.parse_args()
    if sys.platform != "linux":
        parser.error("The pinned maintainer converter runs only on Linux/Xvfb. Use the hosted review workflow; it is not part of the portable Windows app.")
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8')); validate_manifest(manifest)
    work = args.workspace.resolve(); work.mkdir(parents=True, exist_ok=True)
    input_directory, output = work / 'inputs', work / 'review-artifacts'
    input_directory.mkdir(exist_ok=True); output.mkdir(exist_ok=True)
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
            slug = score['id']; source = input_directory / (slug + '.mscx'); folder = output / slug; folder.mkdir(exist_ok=True)
            download(upstream + urllib.parse.quote(score['source_path']), source, score['source_bytes'], score['source_sha256'])
            expected = source_pitch_inventory(source.read_bytes())
            (folder / 'original.mscx').write_bytes(source.read_bytes())
            raw = folder / 'converter.musicxml'
            run_bounded(engine_args + ['-o', str(raw), str(source)], work, env, folder / 'conversion.log', output_root=folder)
            if raw.stat().st_size > MAX_SOURCE: raise ValueError('Converted score exceeds4MiB review bound')
            normalized, changes = normalize_converted_xml(raw.read_bytes()); actual = xml_pitch_inventory(normalized)
            (folder / 'import.musicxml').write_text(normalized, encoding='utf-8')
            status, imported = post(base, '/api/import/musicxml', normalized.encode(), 'application/xml')
            result = {'id': slug, 'source_sha256': digest(source), 'raw_converter_sha256': digest(raw), 'import_xml_sha256': digest(folder / 'import.musicxml'), 'normalizations': changes, 'written_source_pitch_count': sum(expected.values()), 'converted_pitch_count': sum(actual.values()), 'pitch_inventory_matches': expected == actual, 'rust_import_status': status, 'status': 'held' if score.get('status') == 'held' else 'pending_musical_review'}
            if status == 200:
                (folder / 'compiled.json').write_text(json.dumps(imported, ensure_ascii=False, indent=2), encoding='utf-8')
                result['import_diagnostics'] = imported['diagnostics']
                result['canonical_written_events'] = sum(len(p['notes']) for p in imported['score']['parts'])
                result['sounding_notes'] = len(imported['timeline']['notes'])
                result['canonical_pitch_inventory_matches'] = canonical_pitch_inventory(imported) == actual
                try:
                    written=written_event_inventory(normalized); canonical=canonical_written_inventory(imported)
                    result['canonical_written_events_match'] = written == canonical
                    result['missing_written_events'] = sum((written-canonical).values())
                    result['extra_written_events'] = sum((canonical-written).values())
                except ValueError as error:
                    result['canonical_written_events_match'] = False
                    result['written_comparison_limit'] = str(error)
            else: result['import_error'] = imported
            if score.get('status') == 'held':
                result['hold_reason'] = score['hold_reason']
                result['expected_import_error'] = score['expected_import_error']
            midi = folder / 'reference.mid'
            run_bounded(engine_args + ['-o', str(midi), str(source)], work, env, folder / 'midi-export.log', output_root=folder)
            midi_status, reference = post(base, '/api/import/midi', midi.read_bytes(), 'audio/midi')
            result['reference_midi_sha256'] = digest(midi)
            result['reference_midi_import_status'] = midi_status
            if midi_status == 200:
                (folder / 'reference-midi-compilation.json').write_text(json.dumps(reference, ensure_ascii=False, indent=2), encoding='utf-8')
                if status == 200:
                    performance_inputs = [{'midi': n['midi'], 'at_ms': n['start_ms'], 'velocity': n['velocity']} for n in reference['timeline']['notes']]
                    grade_status, matched = post(base, '/api/assess', json.dumps({'timeline': imported['timeline'], 'inputs': performance_inputs, 'tolerance_ms': 10}).encode(), 'application/json')
                    if grade_status != 200: raise RuntimeError('Reference onset comparison failed: ' + str(matched))
                    (folder / 'reference-assessment.json').write_text(json.dumps(matched, ensure_ascii=False, indent=2), encoding='utf-8')
                    result['reference_agreement'] = reference_agreement(imported, reference, matched)
            else:
                result['reference_midi_import_error'] = reference
                result['reference_agreement'] = None
            if args.reference_inspector:
                observation_path = folder / 'reference-midi-observation.json'
                run_bounded([str(args.reference_inspector.resolve()), str(midi)], work, env, observation_path, output_root=folder)
                observation = json.loads(observation_path.read_text(encoding='utf-8'))
                keys = observed_key_reference(observation)
                (folder / 'reference-key-events.json').write_text(json.dumps(keys, ensure_ascii=False, indent=2), encoding='utf-8')
                result['raw_reference_note_on_messages'] = len(keys['timeline']['notes'])
                result['raw_reference_unpaired_durations'] = keys['unpaired_or_ambiguous_key_durations']
                if status == 200:
                    performance_inputs = [{'midi': n['midi'], 'at_ms': n['start_ms'], 'velocity': n['velocity']} for n in keys['timeline']['notes']]
                    grade_status, matched = post(base, '/api/assess', json.dumps({'timeline': imported['timeline'], 'inputs': performance_inputs, 'tolerance_ms': 10}).encode(), 'application/json')
                    if grade_status != 200: raise RuntimeError('Raw reference comparison failed: ' + str(matched))
                    (folder / 'reference-key-assessment.json').write_text(json.dumps(matched, ensure_ascii=False, indent=2), encoding='utf-8')
                    result['raw_key_message_agreement'] = reference_agreement(imported, keys, matched)
                    result['raw_key_message_agreement']['raw_midi_key_observation_only'] = True
                    result['written_beat_attack_agreement'] = written_beat_attack_agreement(imported, keys, observation['ticks_per_quarter'])
            result['gate_matches_declared_candidate_state'] = candidate_gate(score, result)
            # A readable source rendering supports human review; no copied commercial scan.
            run_bounded(engine_args + ['-r', '120', '-o', str(folder / 'source.png'), str(source)], work, env, folder / 'render.log', output_root=folder)
            results.append(result)
        report = {'manifest': manifest, 'license_sha256': digest(license_path), 'results': results, 'automatically_bundled': False, 'held_count': sum(r['status'] == 'held' for r in results), 'acceptance': 'Candidate conversion/import evidence only. Pitch inventories do not prove rhythm, voice, expression or instrument compatibility; review source images and every diagnostic before catalog admission.'}
        (output / 'conversion-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({'candidates': len(results), 'importable': sum(r['rust_import_status'] == 200 for r in results), 'all_pitch_inventories_match': all(r['pitch_inventory_matches'] for r in results), 'held':sum(r['status']=='held' for r in results)}))
        return 0 if all(r['gate_matches_declared_candidate_state'] for r in results) else 1
    finally:
        server.terminate(); server.wait(timeout=5)


if __name__ == '__main__':
    raise SystemExit(main())
