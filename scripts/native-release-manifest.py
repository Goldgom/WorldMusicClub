#!/usr/bin/env python3
"""Inventory a source-bound Windows native candidate; not full checkpoint acceptance."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import subprocess
import stat
import tomllib
import zipfile

ROOT = Path(__file__).resolve().parents[1]
_pitch_spec = importlib.util.spec_from_file_location('native_pitch_bend_manifest', ROOT / 'scripts/native-pitch-bend-manifest.py')
_pitch = importlib.util.module_from_spec(_pitch_spec)
_pitch_spec.loader.exec_module(_pitch)
PITCH_BEND_CLAIMS = _pitch.PITCH_BEND_CLAIMS
PITCH_BEND_REPORTS = _pitch.PITCH_BEND_REPORTS
PITCH_BEND_EVIDENCE = [*PITCH_BEND_REPORTS, 'native-pitch-bend-files.json', 'pitch-bend-manifest.json']
_authoring_spec = importlib.util.spec_from_file_location('native_song_authoring_manifest', ROOT / 'scripts/native-song-authoring-manifest.py')
_authoring = importlib.util.module_from_spec(_authoring_spec)
_authoring_spec.loader.exec_module(_authoring)
SONG_AUTHORING_CLAIMS = _authoring.SONG_AUTHORING_CLAIMS
SONG_AUTHORING_REPORTS = _authoring.SONG_AUTHORING_REPORTS
SONG_AUTHORING_EVIDENCE = [*SONG_AUTHORING_REPORTS, 'native-song-authoring-files.json', 'song-authoring-manifest.json']
_new_music_spec = importlib.util.spec_from_file_location('native_new_music_evidence', ROOT / 'scripts/native-new-music-evidence.py')
_new_music = importlib.util.module_from_spec(_new_music_spec)
_new_music_spec.loader.exec_module(_new_music)
NEW_MUSIC_EVIDENCE = _new_music.EVIDENCE
_catalog_spec = importlib.util.spec_from_file_location('native_library_catalog_evidence', ROOT / 'scripts/native-library-catalog-evidence.py')
_catalog = importlib.util.module_from_spec(_catalog_spec)
_catalog_spec.loader.exec_module(_catalog)
_canonical_spec = importlib.util.spec_from_file_location('native_canonical_practice_evidence', ROOT / 'scripts/native-canonical-practice-evidence.py')
_canonical = importlib.util.module_from_spec(_canonical_spec)
_canonical_spec.loader.exec_module(_canonical)
FOLDER = 'WorldMusicClub-Native'
EXE = 'WorldMusicClub-Native.exe'
INFO, SUMS = 'BUILD-INFO.json', 'SHA256.txt'
SCORE_SCHEMAS = ('schema/worldmusichub-score-v1.schema.json', 'schemas/vsq-complete-score-v1.schema.json')
PHASES = ['seed', 'restart', 'close-active', 'reopen']
SONG_FOLDER_PHASES = ['folder-seed', 'folder-restart', 'folder-failure']
SONG_FOLDER_EVIDENCE = ['native-song-folder.json', 'native-song-folder-files.json',
                        *[f'renderer-{phase}.json' for phase in SONG_FOLDER_PHASES],
                        *[f'profile-{phase}.json' for phase in SONG_FOLDER_PHASES]]
PERFORMANCE_SONG_PHASES = ['performance-seed', 'performance-controls', 'performance-restart']
PERFORMANCE_SONG_EVIDENCE = ['native-performance-song.json', 'native-performance-song-files.json',
                             *[f'renderer-{phase}.json' for phase in PERFORMANCE_SONG_PHASES],
                             *[f'profile-{phase}.json' for phase in PERFORMANCE_SONG_PHASES]]
PERFORMANCE_SONG_CLAIMS = {
    'native_file_picker': True, 'fresh_process_restart': True, 'explicit_reference_policy': True,
    'audio_source_schedule_and_track_mute': True, 'sustain_gate_preserves_source_release': True,
    'named_route_disclosure_both_locales': True, 'centered_rpn12_exact_events': True,
    'unsupported_bank_blocked_before_audio': True,
    'validated_notation': False, 'practice_targets': False, 'actual_audibility': False, 'original_timbre': False}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def windows_executable(data):
    require(len(data) >= 64 and data[:2] == b'MZ', 'Expected a Windows PE executable')
    offset = int.from_bytes(data[60:64], 'little')
    require(data[offset:offset + 6] == b'PE\x00\x00\x64\x86', 'Expected native x64 PE executable')


def accepted_reference_evidence(acceptance, report):
    """Keep reference proof separate from the established four-file backup gate."""
    acceptance = Path(acceptance)
    path = acceptance / 'native-reference-files.json'
    proof = read_json(path)
    fixture = ROOT / 'tests/fixtures/original-reference-overlap.mid'
    expected_hash = sha(fixture.read_bytes())
    require(proof.get('version') == 1 and proof.get('ok') is True
            and proof.get('renderer_seed_sha256') == sha((acceptance / 'renderer-seed.json').read_bytes()),
            'Native reference proof must match the exact seed renderer report')
    reference = report.get('referenceListening', {})
    require(reference.get('ok') is True and reference.get('sourceSha256') == expected_hash
            and proof.get('source_sha256') == expected_hash
            and proof.get('fixture') == 'original-reference-overlap.mid',
            'Native reference complete source identity differs')
    for proof_key, renderer_key, value in [('track_count', 'trackCount', 3), ('event_count', 'eventCount', 26), ('onset_count', 'onsetCount', 8)]:
        require(proof.get(proof_key) == value and reference.get(renderer_key) == value,
                'Native reference complete source counts differ')
    require(type(proof.get('typing_note_on_count')) is int and proof['typing_note_on_count'] > 0
            and type(proof.get('scored_input_count')) is int and proof['scored_input_count'] > 0,
            'Native reference proof needs a retained scored keyboard take')
    required_checks = {'native-filechooser', 'complete-original-source', 'explicit-rendition-policy',
                       'play-pause-resume-stop', 'all-tracks-complete', 'independent-track-mute', 'shared-sound-mute',
                       'close-cleanup', 'live-locale-preserved', 'reference-input-isolated',
                       'canonical-score-unchanged', 'scored-take-unchanged'}
    require(required_checks.issubset(reference.get('checks', [])), 'Native reference UI checks are incomplete')
    audio = reference.get('audio', {})
    require(type(audio.get('sourceStarts')) is int and audio['sourceStarts'] > 0
            and type(audio.get('cleanupChecks')) is int and audio['cleanupChecks'] >= 4
            and audio.get('activeSources') == 0 and audio.get('pendingSources') == 0,
            'Native reference audio start/cleanup evidence is incomplete')
    kinds = {'original', 'beforeScore', 'afterScore', 'beforeTake', 'afterTake'}
    artifacts = proof.get('artifacts', [])
    require(len(artifacts) == 5 and {item.get('kind') for item in artifacts} == kinds
            and len({item.get('file') for item in artifacts}) == 5,
            'Five distinct native reference files are required')
    original_files = set(report.get('files', {}).values())
    values = {}
    for item in artifacts:
        name = item.get('file', '')
        require(re.fullmatch(r'seed-(?:[1-9]|1[0-6])\.json', name) and name not in original_files,
                'Invalid or reused native reference evidence path')
        require(reference.get('files', {}).get(item['kind']) == name,
                'Native reference proof file roles differ from renderer')
        matching = [row for row in report.get('downloads', []) if row.get('file') == name]
        require(len(matching) == 1 and matching[0].get('complete') is True and matching[0].get('success') is True,
                'Native reference download did not complete')
        data = (acceptance / 'downloads' / name).read_bytes()
        require(sha(data) == item.get('sha256') and len(data) == item.get('bytes'),
                'Accepted native reference download changed')
        if item['kind'] == 'original':
            require(data == fixture.read_bytes(), 'Native reference MIDI original bytes differ')
        else:
            values[item['kind']] = json.loads(data)
    require(values['beforeScore'] == values['afterScore'] and values['beforeTake'] == values['afterTake'],
            'Native reference changed the existing score or scored take')
    # Re-derive the independent Node proof in read-only mode, including actual
    # typed-onset -> capture -> scored-input routing, rather than trust counts.
    checked = subprocess.run(['node', str(ROOT / 'scripts/verify-reference-native-evidence.mjs'), str(acceptance), '--check'],
                             cwd=ROOT, capture_output=True, text=True, encoding='utf-8', timeout=15, check=False)
    require(checked.returncode == 0, 'Native reference proof failed independent routed-input verification: ' + checked.stderr.strip())
    return {'complete_midi_reference_validated': True, 'native_reference_proof_sha256': sha(path.read_bytes())}


def accepted_evidence(startup, acceptance, executable, commit, tree):
    """Reject partial, stale or differently built evidence before packaging any bytes."""
    startup, acceptance = Path(startup), Path(acceptance)
    digest = sha(Path(executable).read_bytes())
    native = read_json(acceptance / 'native-acceptance.json')
    require(native.get('ok') is True and native.get('source_sha') == commit
            and native.get('source_tree') == tree and native.get('executable_sha256') == digest,
            'Native acceptance must pass for this exact source/tree/executable')
    phases = native.get('phases', [])
    require([row.get('phase') for row in phases] == PHASES, 'All four native phases are required')
    for row in phases:
        require(row.get('renderer_ok') is True and row.get('normal_close') is True
                and row.get('renderer_origin') == 'https://wmh.localhost'
                and row.get('executable_tcp_listeners') == 0,
                'Every native phase must render, close normally and have no EXE listener')
    smoke = read_json(startup / 'native-report.json')
    renderer = read_json(startup / 'renderer-report.json')
    require(smoke.get('source_sha') == commit and smoke.get('executable_sha256') == digest
            and smoke.get('renderer_ok') is True and smoke.get('normal_close') is True
            and smoke.get('executable_tcp_listeners') == 0 and renderer.get('ok') is True,
            'Startup must pass for this exact executable/source')
    reports = {}
    for phase in PHASES:
        report = read_json(acceptance / f'renderer-{phase}.json')
        require(report.get('ok') is True and report.get('phase') == phase
                and report.get('origin') == 'https://wmh.localhost', 'Incomplete renderer phase')
        reports[phase] = report
    midi = reports['seed'].get('midi', {})
    require(midi.get('outcome') in ['ready', 'denied-or-unavailable', 'not-requested'], 'Missing actual MIDI outcome')
    require(midi.get('outcome') != 'not-requested' or midi.get('apiAvailable') is False, 'Available MIDI API was not attempted')
    files = read_json(acceptance / 'downloaded-files.json')
    require(files.get('ok') is True and len(files.get('artifacts', [])) == 4, 'Actual downloaded files were not verified')
    for item in files['artifacts']:
        require(re.fullmatch(r'seed-(?:[1-9]|1[0-6])\.json', item.get('file', '')), 'Invalid download evidence path')
        data = (acceptance / 'downloads' / item['file']).read_bytes()
        require(sha(data) == item['sha256'] and len(data) == item['bytes'], 'Accepted downloaded file changed')
    return {**accepted_reference_evidence(acceptance, reports['seed']),
            'native_permission_callback': 'deny-all', 'ordinary_midi_api': midi,
            'observed_webview_user_agent': renderer.get('userAgent'),
            'physical_midi_validated': False, 'audio_output_or_latency_validated': False,
            'clean_machine_installation_validated': False}


def accepted_song_folder_evidence(directory, executable, commit, tree):
    """Require the separate disk/fresh-profile gate for the exact packaged build."""
    directory = Path(directory)
    report_path = directory / 'native-song-folder.json'
    native = read_json(report_path)
    require(type(native.get('version')) is int and native['version'] == 1
            and native.get('ok') is True and native.get('source_sha') == commit
            and native.get('source_tree') == tree
            and native.get('executable_sha256') == sha(Path(executable).read_bytes()),
            'Native song-folder acceptance must pass for this exact source/tree/executable')
    phases = native.get('phases', [])
    require(isinstance(phases, list) and all(isinstance(row, dict) for row in phases)
            and [row.get('phase') for row in phases] == SONG_FOLDER_PHASES,
            'All three ordered native song-folder phases are required')
    for row in phases:
        require(row.get('renderer_ok') is True and row.get('normal_close') is True
                and row.get('renderer_origin') == 'https://wmh.localhost'
                and type(row.get('executable_tcp_listeners')) is int
                and row['executable_tcp_listeners'] == 0
                and type(row.get('actions')) is int and 1 <= row['actions'] <= 75,
                'Every native song-folder phase must render, close normally, have no EXE listener and bounded actions')
        require(row.get('launched_new_process') is True
                and type(row.get('process_id')) is int and row['process_id'] > 0,
                'Every native song-folder phase must launch a new process')
    _pitch.verify_profile_evidence(native, SONG_FOLDER_PHASES,
                                   lambda name: _pitch.read_evidence(directory / name, 16 * 1024))
    proof_path = directory / 'native-song-folder-files.json'
    proof = read_json(proof_path)
    require(type(proof.get('version')) is int and proof['version'] == 1 and proof.get('ok') is True
            and proof.get('native_report_sha256') == sha(report_path.read_bytes()),
            'Native song-folder proof must match the exact native report')
    renderer_hashes = proof.get('renderer_sha256', {})
    require(isinstance(renderer_hashes, dict) and set(renderer_hashes) == set(SONG_FOLDER_PHASES),
            'Native song-folder proof must bind all renderer reports')
    for phase in SONG_FOLDER_PHASES:
        path = directory / f'renderer-{phase}.json'
        report = read_json(path)
        require(report.get('ok') is True and report.get('phase') == phase
                and report.get('origin') == 'https://wmh.localhost'
                and renderer_hashes[phase] == sha(path.read_bytes()),
                'Native song-folder proof must match each exact renderer report')
    report_hashes = {report_path.name: sha(report_path.read_bytes()), **{
        f'renderer-{phase}.json': renderer_hashes[phase] for phase in SONG_FOLDER_PHASES}}
    for phase in SONG_FOLDER_PHASES:
        name = f'profile-{phase}.json'
        data = _pitch.read_evidence(directory / name, 16 * 1024)
        _pitch.verify_report_binding(proof, name, data)
        report_hashes[name] = sha(data)
    # Re-derive folder identity, exact retained bytes, unchanged restart files,
    # and non-destructive failure evidence from disk before trusting the proof.
    checked = subprocess.run(['node', str(ROOT / 'scripts/verify-native-song-folder-evidence.mjs'), str(directory), '--check'],
                             cwd=ROOT, capture_output=True, text=True, encoding='utf-8', timeout=15, check=False)
    require(checked.returncode == 0,
            'Native song-folder proof failed independent disk verification: ' + checked.stderr.strip())
    return {'native_song_folder_validated': True, 'native_song_folder_proof_sha256': sha(proof_path.read_bytes()),
            'native_song_folder_reports_sha256': report_hashes}


def accepted_performance_song_evidence(directory, executable, commit, tree):
    """Require complete performance proof for the actual source and packaged EXE."""
    directory = Path(directory)
    executable_bytes = Path(executable).read_bytes()
    proof_path = directory / 'native-performance-song-files.json'
    proof = read_json(proof_path)
    native = read_json(directory / 'native-performance-song.json')
    for evidence in [native, proof]:
        require(type(evidence.get('version')) is int and evidence['version'] == 1
                and evidence.get('ok') is True and evidence.get('source_sha') == commit
                and evidence.get('source_tree') == tree
                and evidence.get('executable_sha256') == sha(executable_bytes)
                and type(evidence.get('executable_bytes')) is int
                and evidence['executable_bytes'] == len(executable_bytes),
                'Native performance evidence must match the exact source/tree/executable bytes')
    claims = proof.get('claims', {})
    require(set(claims) == set(PERFORMANCE_SONG_CLAIMS)
            and all(claims[key] is value for key, value in PERFORMANCE_SONG_CLAIMS.items()),
            'Native performance acceptance scope cannot imply notation, targets, audibility or original timbre')
    _pitch.verify_profile_evidence(native, PERFORMANCE_SONG_PHASES,
                                   lambda name: _pitch.read_evidence(directory / name, 16 * 1024))
    # Re-derive all original fixture bytes, three processes, owned picker actions,
    # audio/control observations, screenshots, exports and unchanged snapshots.
    checked = subprocess.run(['node', str(ROOT / 'scripts/verify-native-performance-song-evidence.mjs'),
                              '--check', str(directory)], cwd=ROOT, capture_output=True,
                             text=True, encoding='utf-8', timeout=30, check=False)
    require(checked.returncode == 0,
            'Native performance proof failed independent verification: ' + checked.stderr.strip())
    report_hashes = {}
    for name in PERFORMANCE_SONG_EVIDENCE:
        if name == proof_path.name:
            continue
        data = _pitch.read_evidence(directory / name)
        matching = [row for row in proof.get('files', []) if row.get('path') == name]
        require(len(matching) == 1 and matching[0].get('sha256') == sha(data)
                and type(matching[0].get('bytes')) is int and matching[0]['bytes'] == len(data),
                'Native performance proof must bind every exact packaged report')
        report_hashes[name] = sha(data)
    return {'native_performance_song_validated': True,
            'native_performance_song_proof_sha256': sha(proof_path.read_bytes()),
            'native_performance_song_reports_sha256': report_hashes,
            'native_performance_song_claims': claims}


def exact_json(left, right):
    """JSON equality must distinguish booleans from numeric lookalikes."""
    return json.dumps(left, sort_keys=True) == json.dumps(right, sort_keys=True)


def pitch_bend_acceptance_fields(manifest, manifest_bytes):
    # A focused proof cannot set the enclosing checkpoint/release scope. Keep
    # every focused scope field explicitly named for this feature.
    return {key: manifest[key] for key in [
                'native_pitch_bend_validated', 'native_pitch_bend_proof_sha256',
                'native_pitch_bend_reports_sha256', 'native_pitch_bend_claims']} | {
        'native_pitch_bend_manifest_sha256': sha(manifest_bytes),
        'native_pitch_bend_scope': manifest['scope'],
        'native_pitch_bend_full_checkpoint_acceptance': manifest['full_checkpoint_acceptance'],
        'native_pitch_bend_release_ready': manifest['release_ready']}


def accepted_pitch_bend_evidence(directory, executable, commit, tree):
    """Re-derive original inventory and require the existing focused manifest."""
    manifest = _pitch.accepted_pitch_bend_evidence(directory, executable, commit, tree)
    manifest_path = Path(directory) / 'pitch-bend-manifest.json'
    require(exact_json(_pitch.read_json(manifest_path), manifest),
            'Native pitch-bend focused manifest differs from independently verified evidence')
    return pitch_bend_acceptance_fields(manifest, manifest_path.read_bytes())


def verify_pitch_bend_inventory(names):
    expected = {'evidence/' + name for name in PITCH_BEND_EVIDENCE}
    actual = {name for name in names if any(part.startswith(
        ('native-pitch-bend', 'renderer-pitch-bend', 'profile-pitch-bend', 'pitch-bend-manifest')) for part in PurePosixPath(name).parts)}
    require(actual == expected, 'Native pitch-bend package must contain exactly the required evidence files')


def verify_packaged_pitch_bend_evidence(read, metadata):
    """Bind the shipped pitch files to BUILD-INFO, beyond ZIP checksums.

    Original disk/audio/GUI evidence is independently re-derived before copy.
    The portable package carries its exact report/proof/manifest bindings, so
    rewriting the generic ZIP inventory cannot replace that accepted evidence.
    """
    evidence_bytes = {name: read('evidence/' + name) for name in PITCH_BEND_EVIDENCE}
    require(all(0 < len(data) <= 1024 * 1024 for data in evidence_bytes.values()),
            'Native pitch-bend package evidence must be bounded')
    evidence = {name: json.loads(data.decode('utf-8-sig')) for name, data in evidence_bytes.items()}
    commit, tree = metadata.get('git_commit'), metadata.get('git_tree')
    require(isinstance(commit, str) and re.fullmatch(r'[a-f0-9]{40}', commit)
            and isinstance(tree, str) and re.fullmatch(r'[a-f0-9]{40}', tree),
            'Native pitch-bend package requires exact source and tree identifiers')
    executable_bytes = read(EXE)
    proof = evidence['native-pitch-bend-files.json']
    for value in [proof, evidence['native-pitch-bend.json']]:
        require(isinstance(value, dict) and type(value.get('version')) is int and value['version'] == 1
                and value.get('ok') is True and value.get('source_sha') == commit
                and value.get('source_tree') == tree and value.get('executable_sha256') == sha(executable_bytes)
                and type(value.get('executable_bytes')) is int and value['executable_bytes'] == len(executable_bytes),
                'Packaged pitch evidence must match the exact source/tree/executable bytes')
    claims = proof.get('claims')
    require(isinstance(claims, dict) and exact_json(claims, PITCH_BEND_CLAIMS),
            'Packaged pitch evidence claim set or exact boolean scope changed')
    _pitch.verify_profile_evidence(evidence['native-pitch-bend.json'], _pitch.PITCH_BEND_PHASES,
                                   lambda name: evidence_bytes[name])
    files = proof.get('files')
    require(isinstance(files, list) and all(isinstance(row, dict) for row in files),
            'Packaged pitch evidence requires its original file inventory')
    reports = {}
    for name in PITCH_BEND_REPORTS:
        data = evidence_bytes[name]
        matching = [row for row in files if row.get('path') == name]
        require(len(matching) == 1 and matching[0].get('sha256') == sha(data)
                and type(matching[0].get('bytes')) is int and matching[0]['bytes'] == len(data),
                'Packaged pitch proof must bind every exact report')
        reports[name] = sha(data)
    manifest = {'version': 1, 'scope': 'original-pitch-bend-focused-evidence-only',
                'source_sha': commit, 'source_tree': tree,
                'executable_sha256': sha(executable_bytes), 'executable_bytes': len(executable_bytes),
                'full_checkpoint_acceptance': False, 'release_ready': False,
                'native_pitch_bend_validated': True,
                'native_pitch_bend_proof_sha256': sha(evidence_bytes['native-pitch-bend-files.json']),
                'native_pitch_bend_reports_sha256': reports, 'native_pitch_bend_claims': claims}
    require(exact_json(evidence['pitch-bend-manifest.json'], manifest),
            'Packaged pitch-bend focused manifest differs from exact evidence')
    acceptance = metadata.get('acceptance')
    expected = pitch_bend_acceptance_fields(manifest, evidence_bytes['pitch-bend-manifest.json'])
    require(isinstance(acceptance, dict)
            and {key for key in acceptance if key.startswith('native_pitch_bend_')} == set(expected)
            and all(key in acceptance and exact_json(acceptance[key], value) for key, value in expected.items()),
            'BUILD-INFO acceptance must bind the exact pitch-bend proof, reports, manifest and scope')


def song_authoring_acceptance_fields(manifest, manifest_bytes):
    # Keep focused authoring scope separate from overall checkpoint acceptance.
    return {key: manifest[key] for key in [
                'native_song_authoring_validated', 'native_song_authoring_proof_sha256',
                'native_song_authoring_reports_sha256', 'native_song_authoring_claims']} | {
        'native_song_authoring_manifest_sha256': sha(manifest_bytes),
        'native_song_authoring_scope': manifest['scope'],
        'native_song_authoring_full_checkpoint_acceptance': manifest['full_checkpoint_acceptance'],
        'native_song_authoring_release_ready': manifest['release_ready']}


def accepted_song_authoring_evidence(directory, executable, commit, tree):
    """Re-derive authoring proof before accepting its existing focused manifest."""
    manifest = _authoring.accepted_song_authoring_evidence(directory, executable, commit, tree)
    manifest_path = Path(directory) / 'song-authoring-manifest.json'
    require(exact_json(_authoring.read_json(manifest_path), manifest),
            'Native song-authoring focused manifest differs from independently verified evidence')
    return song_authoring_acceptance_fields(manifest, manifest_path.read_bytes())


def verify_song_authoring_inventory(names):
    expected = {'evidence/' + name for name in SONG_AUTHORING_EVIDENCE}
    actual = {name for name in names if any(part.startswith(
        ('native-song-authoring', 'renderer-authoring', 'profile-authoring', 'song-authoring-manifest')) for part in PurePosixPath(name).parts)}
    require(actual == expected, 'Native song-authoring package must contain exactly the seven required evidence files')


def verify_packaged_song_authoring_evidence(read, metadata):
    """Keep the accepted authoring report/proof/manifest bindings in the ZIP.

    Native observations and original disk bytes are independently checked
    before copy. Recomputing ordinary package checksums cannot replace the
    focused proof or the exact evidence accepted into BUILD-INFO.
    """
    evidence_bytes = {name: read('evidence/' + name) for name in SONG_AUTHORING_EVIDENCE}
    require(all(0 < len(data) <= 1024 * 1024 for data in evidence_bytes.values()),
            'Native song-authoring package evidence must be bounded')
    evidence = {name: json.loads(data.decode('utf-8-sig')) for name, data in evidence_bytes.items()}
    commit, tree = metadata.get('git_commit'), metadata.get('git_tree')
    require(isinstance(commit, str) and re.fullmatch(r'[a-f0-9]{40}', commit)
            and isinstance(tree, str) and re.fullmatch(r'[a-f0-9]{40}', tree),
            'Native song-authoring package requires exact source and tree identifiers')
    executable_bytes = read(EXE)
    proof = evidence['native-song-authoring-files.json']
    for value in [proof, evidence['native-song-authoring.json']]:
        require(isinstance(value, dict) and type(value.get('version')) is int and value['version'] == 1
                and value.get('ok') is True and value.get('source_sha') == commit
                and value.get('source_tree') == tree and value.get('executable_sha256') == sha(executable_bytes)
                and type(value.get('executable_bytes')) is int and value['executable_bytes'] == len(executable_bytes),
                'Packaged song-authoring evidence must match the exact source/tree/executable bytes')
    claims = proof.get('claims')
    require(isinstance(claims, dict) and exact_json(claims, SONG_AUTHORING_CLAIMS),
            'Packaged song-authoring evidence claim set or exact boolean scope changed')
    _pitch.verify_profile_evidence(evidence['native-song-authoring.json'], _authoring.SONG_AUTHORING_PHASES,
                                   lambda name: evidence_bytes[name])
    files = proof.get('files')
    require(isinstance(files, list) and all(isinstance(row, dict) for row in files),
            'Packaged song-authoring evidence requires its original file inventory')
    reports = {}
    for name in SONG_AUTHORING_REPORTS:
        data = evidence_bytes[name]
        matching = [row for row in files if row.get('path') == name]
        require(len(matching) == 1 and matching[0].get('sha256') == sha(data)
                and type(matching[0].get('bytes')) is int and matching[0]['bytes'] == len(data),
                'Packaged song-authoring proof must bind every exact report')
        reports[name] = sha(data)
    manifest = {'version': 1, 'scope': 'original-song-authoring-focused-evidence-only',
                'source_sha': commit, 'source_tree': tree,
                'executable_sha256': sha(executable_bytes), 'executable_bytes': len(executable_bytes),
                'full_checkpoint_acceptance': False, 'release_ready': False,
                'native_song_authoring_validated': True,
                'native_song_authoring_proof_sha256': sha(evidence_bytes['native-song-authoring-files.json']),
                'native_song_authoring_reports_sha256': reports, 'native_song_authoring_claims': claims}
    require(exact_json(evidence['song-authoring-manifest.json'], manifest),
            'Packaged song-authoring focused manifest differs from exact evidence')
    acceptance = metadata.get('acceptance')
    expected = song_authoring_acceptance_fields(manifest, evidence_bytes['song-authoring-manifest.json'])
    require(isinstance(acceptance, dict)
            and {key for key in acceptance if key.startswith('native_song_authoring_')} == set(expected)
            and all(key in acceptance and exact_json(acceptance[key], value) for key, value in expected.items()),
            'BUILD-INFO acceptance must bind the exact song-authoring proof, reports, manifest and scope')


def verify_packaged_profiles(read, metadata):
    """Retain the accepted host/profile/proof bindings after generic ZIP rehashing."""
    acceptance = metadata.get('acceptance', {})
    executable_bytes = read(EXE)
    for scenario, phases, names in [('song-folder', SONG_FOLDER_PHASES, SONG_FOLDER_EVIDENCE),
                                    ('performance-song', PERFORMANCE_SONG_PHASES, PERFORMANCE_SONG_EVIDENCE)]:
        evidence_bytes = {name: read('evidence/' + name) for name in names}
        require(all(0 < len(data) <= 2 * 1024 * 1024 for data in evidence_bytes.values()),
                'Packaged native profile evidence must be bounded')
        native_name, proof_name = f'native-{scenario}.json', f'native-{scenario}-files.json'
        native, proof = [json.loads(evidence_bytes[name].decode('utf-8-sig')) for name in [native_name, proof_name]]
        require(isinstance(native, dict) and native.get('ok') is True
                and native.get('source_sha') == metadata.get('git_commit')
                and native.get('source_tree') == metadata.get('git_tree')
                and native.get('executable_sha256') == sha(executable_bytes),
                'Packaged native profiles must match the exact source/tree/executable')
        _pitch.verify_profile_evidence(native, phases, lambda name: evidence_bytes[name])
        require(isinstance(proof, dict) and proof.get('ok') is True,
                'Packaged native profile proof must pass')
        for phase in phases:
            name = f'profile-{phase}.json'
            _pitch.verify_report_binding(proof, name, evidence_bytes[name])
        hashes = {name: sha(data) for name, data in evidence_bytes.items() if name != proof_name}
        prefix = 'native_' + scenario.replace('-', '_')
        require(acceptance.get(prefix + '_validated') is True
                and acceptance.get(prefix + '_proof_sha256') == sha(evidence_bytes[proof_name])
                and exact_json(acceptance.get(prefix + '_reports_sha256'), hashes),
                'BUILD-INFO acceptance must bind the exact native profile reports and proof')


def create_manifest(directory, metadata):
    directory = Path(directory)
    verify_build_provenance(lambda name: (directory / name).read_bytes(), metadata)
    required = [EXE, 'README.md', 'LICENSE', 'START-HERE.md',
                *SCORE_SCHEMAS, 'catalog/index.json',
                'licenses/engraving/engraving-manifest.json',
                'licenses/engraving/opensheetmusicdisplay.min.js.LICENSE.txt',
                'licenses/rust/manifest.json', 'licenses/rust/CARGO-THIRD-PARTY-NOTICES.txt',
                'licenses/rust/RUST-STANDARD-LIBRARY-COPYRIGHT.html',
                'evidence/native-acceptance.json', 'evidence/downloaded-files.json', 'evidence/native-reference-files.json',
                'evidence/native-report.json', 'evidence/renderer-report.json',
                *[f'evidence/{name}' for name in SONG_FOLDER_EVIDENCE],
                *[f'evidence/{name}' for name in PERFORMANCE_SONG_EVIDENCE],
                *[f'evidence/{name}' for name in PITCH_BEND_EVIDENCE],
                *[f'evidence/{name}' for name in SONG_AUTHORING_EVIDENCE],
                *[f'evidence/{name}' for name in NEW_MUSIC_EVIDENCE],
                *[_catalog.PREFIX + name for name in _catalog.REQUIRED],
                *[_canonical.PREFIX + name for name in _canonical.REQUIRED],
                *[f'evidence/renderer-{phase}.json' for phase in PHASES]]
    for name in required:
        require((directory / name).is_file(), f'Native package is missing {name}')
    verify_pitch_bend_inventory(path.relative_to(directory).as_posix() for path in directory.rglob('*') if path.is_file())
    verify_song_authoring_inventory(path.relative_to(directory).as_posix() for path in directory.rglob('*') if path.is_file())
    _new_music.verify_inventory(path.relative_to(directory).as_posix() for path in directory.rglob('*') if path.is_file())
    windows_executable((directory / EXE).read_bytes())
    verify_packaged_pitch_bend_evidence(lambda name: (directory / name).read_bytes(), metadata)
    verify_packaged_song_authoring_evidence(lambda name: (directory / name).read_bytes(), metadata)
    _new_music.verify_packaged(lambda name: (directory / name).read_bytes(), metadata)
    _catalog.verify_packaged(lambda name: (directory / name).read_bytes() if name == EXE else _catalog.read_file(directory, name), metadata,
                             (path.relative_to(directory).as_posix() for path in directory.rglob('*') if path.is_file()))
    _canonical.verify_packaged(lambda name: (directory / name).read_bytes() if name == EXE else _canonical.read_file(directory, name), metadata,
                               (path.relative_to(directory).as_posix() + ('/' if path.is_dir() else '')
                                for path in directory.rglob('*')))
    verify_packaged_profiles(lambda name: _pitch.read_evidence(directory / name, 2 * 1024 * 1024)
                             if name != EXE else (directory / name).read_bytes(), metadata)
    require(not any((directory / name).exists() for name in ['WorldMusicClub.exe', 'WorldMusicHub.exe']),
            'Browser EXE must not be in the native package')
    notices = read_json(directory / 'licenses/rust/manifest.json')
    require(notices.get('format_version') == 2 and notices.get('target') == 'x86_64-pc-windows-msvc'
            and notices.get('cargo_lock_sha256') == metadata.get('cargo_lock_sha256'), 'Native notices must match the locked Windows graph')
    for component in notices['components']:
        source = component.get('source_archive')
        if source:
            name = source['name']
            require(PurePosixPath(name).name == name and '\\' not in name, 'Invalid source archive name')
            data = (directory / 'licenses/rust/sources' / name).read_bytes()
            require(len(data) == source['bytes'] and sha(data) == source['sha256'], 'MPL source archive differs from its notice inventory')
    standard = notices['standard_library']
    require(sha((directory / 'licenses/rust/RUST-STANDARD-LIBRARY-COPYRIGHT.html').read_bytes()) == standard['copyright_sha256'], 'Rust copyright collection differs')
    for item in standard['license_texts']:
        require(PurePosixPath(item['name']).name == item['name'] and '\\' not in item['name'], 'Invalid standard library notice name')
        require(sha((directory / 'licenses/rust/licenses' / item['name']).read_bytes()) == item['sha256'], 'Rust standard library license differs')
    catalog = read_json(directory / 'catalog/index.json')
    require(catalog.get('version') == 1 and isinstance(catalog.get('editions'), list), 'Invalid catalog index')
    editions = []
    for edition in catalog['editions']:
        relative = PurePosixPath(edition['directory'])
        require(not relative.is_absolute() and '..' not in relative.parts, 'Invalid catalog directory')
        base = directory / 'catalog' / relative
        score = read_json(base / 'score.json')
        provenance = read_json(base / 'provenance.json')
        license_data = (base / 'LICENSE-CC0.txt').read_bytes()
        retained = json.loads(score['source']['content'])
        require(score['id'] == provenance['edition_id'] == edition['id']
                and score['provenance']['license'] == provenance['edition_license'] == edition['license']
                and retained['provenance'] == provenance
                and retained['license_text'].encode() == license_data
                and sha(license_data) == provenance['license_text_sha256'], 'Catalog source/license mismatch')
        editions.append({'id': edition['id'], 'license': edition['license'],
                         'retained_source_sha256': sha(score['source']['content'].encode()),
                         'expressive_performance_equivalent': False})
    files = {}
    for path in sorted(directory.rglob('*')):
        require(not path.is_symlink(), 'Native ZIP cannot contain symbolic links')
        if not path.is_file():
            continue
        name = path.relative_to(directory).as_posix()
        if name not in [INFO, SUMS]:
            data = path.read_bytes()
            files[name] = {'sha256': sha(data), 'bytes': len(data)}
    info = {'format_version': 1, **metadata, 'curated_editions': editions, 'file_count': len(files), 'files': files}
    (directory / INFO).write_text(json.dumps(info, indent=2, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')
    checksums = {name: item['sha256'] for name, item in files.items()}
    checksums[INFO] = sha((directory / INFO).read_bytes())
    (directory / SUMS).write_text(''.join(f'{checksums[name]}  {name}\n' for name in sorted(checksums)), encoding='utf-8', newline='\n')
    return info


def verify_archive(archive):
    archive = Path(archive)
    with zipfile.ZipFile(archive) as package:
        require(not any(stat.S_ISLNK(row.external_attr >> 16) for row in package.infolist()),
                'Native ZIP cannot contain symbolic links')
        names = [row.filename for row in package.infolist() if not row.is_dir()]
        require(len(names) == len(set(names)), 'Duplicate ZIP paths')
        prefix = FOLDER + '/'
        info = json.loads(package.read(prefix + INFO))
        require(info.get('name') == FOLDER and info.get('executable') == EXE, 'Wrong native product identity')
        for name in SCORE_SCHEMAS:
            require(name in info['files'], f'Native package is missing {name}')
        for name in [*SONG_FOLDER_EVIDENCE, *PERFORMANCE_SONG_EVIDENCE, *PITCH_BEND_EVIDENCE, *SONG_AUTHORING_EVIDENCE, *NEW_MUSIC_EVIDENCE]:
            require(f'evidence/{name}' in info['files'], f'Native package is missing evidence/{name}')
        for name in _catalog.REQUIRED:
            require(_catalog.PREFIX + name in info['files'], f'Native package is missing {_catalog.PREFIX}{name}')
        for name in _canonical.REQUIRED:
            require(_canonical.PREFIX + name in info['files'], f'Native package is missing {_canonical.PREFIX}{name}')
        verify_pitch_bend_inventory(info['files'])
        verify_song_authoring_inventory(info['files'])
        _new_music.verify_inventory(info['files'])
        require(set(names) == {prefix + name for name in set(info['files']) | {INFO, SUMS}}, 'Native ZIP inventory differs')
        sums = {}
        for name, item in info['files'].items():
            require(not PurePosixPath(name).is_absolute() and '..' not in PurePosixPath(name).parts and '\\' not in name, 'Invalid native ZIP path')
            data = package.read(prefix + name)
            require(len(data) == item['bytes'] and sha(data) == item['sha256'], f'Native ZIP checksum differs: {name}')
            sums[name] = item['sha256']
        windows_executable(package.read(prefix + EXE))
        verify_build_provenance(lambda name: package.read(prefix + name), info)
        verify_packaged_pitch_bend_evidence(lambda name: package.read(prefix + name), info)
        verify_packaged_song_authoring_evidence(lambda name: package.read(prefix + name), info)
        _new_music.verify_packaged(lambda name: package.read(prefix + name), info)
        _catalog.verify_packaged(lambda name: package.read(prefix + name), info, info['files'])
        _canonical.verify_packaged(lambda name: package.read(prefix + name), info,
                                   [*info['files'], *[row.filename[len(prefix):] for row in package.infolist()
                                                     if row.is_dir() and row.filename.startswith(prefix)]])
        verify_packaged_profiles(lambda name: package.read(prefix + name), info)
        sums[INFO] = sha(package.read(prefix + INFO))
        require(package.read(prefix + SUMS).decode() == ''.join(f'{sums[name]}  {name}\n' for name in sorted(sums)), 'Native checksum file differs')
    archive.with_suffix(archive.suffix + '.sha256').write_text(f'{sha(archive.read_bytes())}  {archive.name}\n', encoding='utf-8', newline='\n')
    return info


def create_archive(directory, archive):
    directory = Path(directory)
    require(directory.name == FOLDER, f'Native folder must be named {FOLDER}')
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as package:
        for path in sorted(directory.rglob('*')):
            require(not path.is_symlink(), 'Native ZIP cannot contain symbolic links')
            if path.is_file():
                package.write(path, FOLDER + '/' + path.relative_to(directory).as_posix())
    return verify_archive(archive)


def source_metadata(commit, count):
    def command(*args):
        return subprocess.check_output(args, cwd=ROOT, text=True, encoding='utf-8').rstrip('\r\n')
    require(command('git', 'rev-parse', '--is-shallow-repository') == 'false', 'Complete history is required')
    require(re.fullmatch('[0-9a-f]{40}', commit) and command('git', 'rev-parse', 'HEAD') == commit
            and int(command('git', 'rev-list', '--count', 'HEAD')) == count, 'Exact source/count mismatch')
    status = command('git', 'status', '--porcelain', '--untracked-files=all')
    require(not status, f'Native packaging requires clean source; git status --porcelain --untracked-files=all:\n{status}')
    require(platform.system() == 'Windows', 'Native packaging requires actual Windows acceptance')
    rust = command('rustc', '-vV')
    require('host: x86_64-pc-windows-msvc' in rust.splitlines(), 'Native x64 MSVC toolchain is required')
    return {'name': FOLDER, 'executable': EXE, 'git_commit': commit,
            'git_tree': command('git', 'rev-parse', 'HEAD^{tree}'), 'commit_count': count,
            'release_label': f'commit-{count}', 'target': 'x86_64-pc-windows-msvc',
            'app_version': tomllib.loads((ROOT / 'Cargo.toml').read_text(encoding='utf-8'))['workspace']['package']['version'],
            'score_schema_revision': int(re.search(r'pub const SCORE_SCHEMA_REVISION: u32 = (\d+);', (ROOT / 'crates/score-core/src/lib.rs').read_text(encoding='utf-8')).group(1)),
            'rustc_verbose': rust, 'cargo': command('cargo', '--version'), 'node': command('node', '--version'),
            'build_platform': platform.platform(), 'rustflags': os.environ.get('RUSTFLAGS', ''),
            'cargo_lock_sha256': sha((ROOT / 'Cargo.lock').read_bytes()),
            'npm_lock_sha256': sha((ROOT / 'package-lock.json').read_bytes()),
            'distribution': 'unsigned native portable candidate; installed Microsoft WebView2 Runtime required',
            'acceptance_scope': 'native-windows-only',
            'acceptance_workflow_run_id': os.environ.get('GITHUB_RUN_ID'),
            'checkpoint_requirements': [
                'Native Windows feature acceptance / acceptance-summary for this source and workflow run',
                'Verify WorldMusicClub for this source'],
            'runtime_bundled': False, 'installer': False, 'http_server_process': False}


BUILD_PROVENANCE = 'evidence/native-build-provenance.json'
SOURCE_METADATA_FIELDS = frozenset(('name', 'executable', 'git_commit', 'git_tree', 'commit_count',
    'release_label', 'target', 'app_version', 'score_schema_revision', 'rustc_verbose', 'cargo', 'node',
    'build_platform', 'rustflags', 'cargo_lock_sha256', 'npm_lock_sha256', 'distribution',
    'acceptance_scope', 'acceptance_workflow_run_id', 'checkpoint_requirements',
    'runtime_bundled', 'installer', 'http_server_process'))


def build_provenance(metadata, executable):
    """Capture only on the original build/UI runner, after the exact EXE exists."""
    data = _pitch.read_evidence(executable, 256 * 1024 * 1024)
    windows_executable(data)
    require(os.environ.get('GITHUB_JOB') == 'native-feature-acceptance', 'Original native producer job required')
    attempt = os.environ.get('GITHUB_RUN_ATTEMPT', '')
    require(re.fullmatch('[1-9][0-9]*', attempt), 'Original native run attempt required')
    return {'format_version': 1, 'producer_job': os.environ['GITHUB_JOB'],
            'run_attempt': attempt, 'source': metadata,
            'executable_sha256': sha(data), 'executable_bytes': len(data)}


def validate_build_provenance(data, metadata, executable):
    require(0 < len(data) <= 64 * 1024, 'Native build provenance is missing or unbounded')
    value = json.loads(data)
    require(isinstance(value, dict) and set(value) == {'format_version', 'producer_job', 'run_attempt',
            'source', 'executable_sha256', 'executable_bytes'} and type(value['format_version']) is int
            and value['format_version'] == 1 and value['producer_job'] == 'native-feature-acceptance',
            'Original native producer provenance differs')
    require(isinstance(value['run_attempt'], str) and re.fullmatch('[1-9][0-9]*', value['run_attempt']),
            'Original native run attempt is missing')
    source = value['source']
    require(isinstance(source, dict) and set(source) == SOURCE_METADATA_FIELDS,
            'Native build source metadata is incomplete')
    for key in SOURCE_METADATA_FIELDS - {'build_platform'}:
        require(source[key] == metadata.get(key), f'Native build provenance differs: {key}')
    require(isinstance(source['build_platform'], str) and 0 < len(source['build_platform']) <= 512,
            'Original native build platform is missing')
    require(type(value['executable_bytes']) is int and value['executable_bytes'] == len(executable)
            and value['executable_sha256'] == sha(executable), 'Original native build executable differs')
    return value


def bind_build_provenance(path, metadata, executable, directory):
    data = _pitch.read_evidence(path, 64 * 1024)
    value = validate_build_provenance(data, metadata, _pitch.read_evidence(executable, 256 * 1024 * 1024))
    require(os.environ.get('GITHUB_JOB') == 'native-package'
            and value['run_attempt'] == os.environ.get('GITHUB_RUN_ATTEMPT'),
            'Packaging job/run attempt differs from original native producer')
    result = dict(value['source'])  # Preserve the actual builder's platform verbatim.
    result['build_provenance'] = {'path': BUILD_PROVENANCE, 'sha256': sha(data),
                                'producer_job': value['producer_job'], 'run_attempt': value['run_attempt']}
    result['packaging_environment'] = {'job': os.environ['GITHUB_JOB'], 'run_attempt': value['run_attempt'],
                                      'workflow_run_id': metadata['acceptance_workflow_run_id'],
                                      'platform': metadata['build_platform']}
    with (Path(directory) / BUILD_PROVENANCE).open('xb') as stream:
        stream.write(data)
    return result


def verify_build_provenance(read, metadata):
    binding = metadata.get('build_provenance')
    if binding is None:
        require('packaging_environment' not in metadata, 'Packaging environment lacks original build provenance')
        return  # Existing same-runner packages remain compatible.
    require(isinstance(binding, dict) and set(binding) == {'path', 'sha256', 'producer_job', 'run_attempt'}
            and binding['path'] == BUILD_PROVENANCE, 'Native build provenance binding differs')
    data = read(BUILD_PROVENANCE)
    require(sha(data) == binding['sha256'], 'Native build provenance bytes changed')
    value = validate_build_provenance(data, metadata, read(EXE))
    require(value['source']['build_platform'] == metadata.get('build_platform')
            and value['producer_job'] == binding['producer_job'] and value['run_attempt'] == binding['run_attempt'],
            'Original build platform/job/attempt was replaced')
    package = metadata.get('packaging_environment')
    require(isinstance(package, dict) and set(package) == {'job', 'run_attempt', 'workflow_run_id', 'platform'}
            and package['job'] == 'native-package' and package['run_attempt'] == value['run_attempt']
            and package['workflow_run_id'] == metadata['acceptance_workflow_run_id']
            and isinstance(package['platform'], str) and 0 < len(package['platform']) <= 512,
            'Separate packaging environment identity is missing')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('create')
    create.add_argument('directory', type=Path)
    create.add_argument('--commit', required=True)
    create.add_argument('--count', required=True, type=int)
    create.add_argument('--startup', required=True, type=Path)
    create.add_argument('--acceptance', required=True, type=Path)
    create.add_argument('--song-folder', required=True, type=Path)
    create.add_argument('--performance-song', required=True, type=Path)
    create.add_argument('--pitch-bend', required=True, type=Path)
    create.add_argument('--song-authoring', required=True, type=Path)
    create.add_argument('--vsq-authoring', required=True, type=Path)
    create.add_argument('--basic-key', required=True, type=Path)
    create.add_argument('--catalog-evidence', required=True, type=Path)
    create.add_argument('--canonical-practice', required=True, type=Path)
    create.add_argument('--build-provenance', type=Path)
    provenance = commands.add_parser('provenance')
    provenance.add_argument('--commit', required=True)
    provenance.add_argument('--count', required=True, type=int)
    provenance.add_argument('--executable', required=True, type=Path)
    provenance.add_argument('--output', required=True, type=Path)
    archive = commands.add_parser('archive')
    archive.add_argument('directory', type=Path)
    archive.add_argument('archive', type=Path)
    verify = commands.add_parser('verify')
    verify.add_argument('archive', type=Path)
    args = parser.parse_args()
    if args.command == 'provenance':
        value = build_provenance(source_metadata(args.commit, args.count), args.executable)
        with args.output.open('x', encoding='utf-8', newline='\n') as stream:
            json.dump(value, stream, ensure_ascii=False, sort_keys=True, indent=2)
            stream.write('\n')
        print('Original native build provenance retained')
        return
    if args.command == 'create':
        metadata = source_metadata(args.commit, args.count)
        if args.build_provenance:
            metadata = bind_build_provenance(args.build_provenance, metadata, args.directory / EXE, args.directory)
        metadata['acceptance'] = accepted_evidence(args.startup, args.acceptance, args.directory / EXE, args.commit, metadata['git_tree'])
        metadata['acceptance'].update(accepted_song_folder_evidence(args.song_folder, args.directory / EXE, args.commit, metadata['git_tree']))
        metadata['acceptance'].update(accepted_performance_song_evidence(args.performance_song, args.directory / EXE, args.commit, metadata['git_tree']))
        metadata['acceptance'].update(accepted_pitch_bend_evidence(args.pitch_bend, args.directory / EXE, args.commit, metadata['git_tree']))
        metadata['acceptance'].update(accepted_song_authoring_evidence(args.song_authoring, args.directory / EXE, args.commit, metadata['git_tree']))
        for scope, directory in [('vsq-authoring', args.vsq_authoring), ('basic-key', args.basic_key)]:
            metadata['acceptance'].update(_new_music.accepted(scope, directory, args.directory / EXE, args.commit, metadata['git_tree']))
        metadata['acceptance'].update(_catalog.accepted(args.catalog_evidence, args.directory / EXE, args.commit, metadata['git_tree']))
        metadata['acceptance'].update(_canonical.accepted(args.canonical_practice, args.directory / EXE, args.commit, metadata['git_tree']))
        # The source-bound gate above verified this separate proof. Keep it in
        # the package inventory without changing the dependency-cache workflow.
        (args.directory / 'evidence/native-reference-files.json').write_bytes((args.acceptance / 'native-reference-files.json').read_bytes())
        for name in SONG_FOLDER_EVIDENCE:
            (args.directory / 'evidence' / name).write_bytes((args.song_folder / name).read_bytes())
        for name in PERFORMANCE_SONG_EVIDENCE:
            (args.directory / 'evidence' / name).write_bytes((args.performance_song / name).read_bytes())
        for name in PITCH_BEND_EVIDENCE:
            (args.directory / 'evidence' / name).write_bytes((args.pitch_bend / name).read_bytes())
        for name in SONG_AUTHORING_EVIDENCE:
            (args.directory / 'evidence' / name).write_bytes((args.song_authoring / name).read_bytes())
        for scope, directory in [('vsq-authoring', args.vsq_authoring), ('basic-key', args.basic_key)]:
            for name in _new_music.names(scope):
                (args.directory / 'evidence' / name).write_bytes((directory / name).read_bytes())
        _catalog.copy_evidence(args.catalog_evidence, args.directory, args.directory / EXE, metadata)
        _canonical.copy_evidence(args.canonical_practice, args.directory, args.directory / EXE, metadata)
        info = create_manifest(args.directory, metadata)
    elif args.command == 'archive':
        info = create_archive(args.directory, args.archive)
    else:
        info = verify_archive(args.archive)
    print(f'Native inventory verified for source {info["git_commit"]}, count {info["commit_count"]}')


if __name__ == '__main__':
    main()
