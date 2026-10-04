"""Synthetic provenance failures are not claims of Windows acceptance."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = ('schema/worldmusichub-score-v1.schema.json', 'schemas/vsq-complete-score-v1.schema.json')
spec = importlib.util.spec_from_file_location('native_release', ROOT / 'scripts/native-release-manifest.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding='utf-8')


def executable():
    data = bytearray(100)
    data[:2] = b'MZ'
    data[60:64] = (64).to_bytes(4, 'little')
    data[64:70] = b'PE\x00\x00\x64\x86'
    return bytes(data)


class NativeReleaseTests(unittest.TestCase):
    def package(self, directory):
        files = {native.EXE: executable(), 'README.md': b'Native preview', 'START-HERE.md': b'Requires installed WebView2',
                 'LICENSE': b'MIT',
                 'licenses/engraving/engraving-manifest.json': b'{}',
                 'licenses/engraving/opensheetmusicdisplay.min.js.LICENSE.txt': b'Notice',
                 'licenses/rust/CARGO-THIRD-PARTY-NOTICES.txt': b'Notices',
                 'licenses/rust/RUST-STANDARD-LIBRARY-COPYRIGHT.html': b'Rust copyright',
                 'licenses/rust/sources/example.crate': b'MPL source'}
        files.update({name: (ROOT / name).read_bytes() for name in SCHEMAS})
        for name, data in files.items():
            path = directory / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        notices = {'format_version': 2, 'target': 'x86_64-pc-windows-msvc', 'cargo_lock_sha256': 'a' * 64,
                   'components': [{'source_archive': {'name': 'example.crate', 'sha256': native.sha(b'MPL source'), 'bytes': 10}}],
                   'standard_library': {'copyright_sha256': native.sha(b'Rust copyright'), 'license_texts': []}}
        write_json(directory / 'licenses/rust/manifest.json', notices)
        write_json(directory / 'catalog/index.json', {'version': 1, 'editions': []})
        for name in ['native-acceptance.json', 'downloaded-files.json', 'native-reference-files.json',
                     'native-report.json', 'renderer-report.json', *native.SONG_FOLDER_EVIDENCE,
                     *native.PERFORMANCE_SONG_EVIDENCE,
                     *[f'renderer-{phase}.json' for phase in native.PHASES]]:
            write_json(directory / 'evidence' / name, {})
        pitch_bend = self.pitch_bend_evidence(directory, directory / native.EXE, directory / 'evidence')
        song_folder = self.song_folder_evidence(directory, directory / native.EXE, directory / 'evidence')
        performance_song = self.performance_song_evidence(directory, directory / native.EXE, directory / 'evidence')
        song_authoring = self.song_authoring_evidence(directory, directory / native.EXE, directory / 'evidence')
        # The portable-package unit fixture has synthetic GUI observations.
        # Only Node's GUI/disk re-derivation is mocked; source/EXE/claims, exact
        # focused manifest and all packaged hash bindings remain enforced.
        with patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')):
            acceptance = native.accepted_pitch_bend_evidence(pitch_bend, directory / native.EXE, 'b' * 40, 'c' * 40)
            acceptance.update(native.accepted_song_folder_evidence(song_folder, directory / native.EXE, 'b' * 40, 'c' * 40))
            acceptance.update(native.accepted_performance_song_evidence(performance_song, directory / native.EXE, 'b' * 40, 'c' * 40))
            acceptance.update(native.accepted_song_authoring_evidence(song_authoring, directory / native.EXE, 'b' * 40, 'c' * 40))
        return {'name': native.FOLDER, 'executable': native.EXE, 'cargo_lock_sha256': 'a' * 64,
                'git_commit': 'b' * 40, 'git_tree': 'c' * 40, 'commit_count': 164, 'acceptance': acceptance}

    def evidence(self, root):
        startup, acceptance, exe = root / 'startup', root / 'acceptance', root / native.EXE
        exe.write_bytes(executable())
        report = {'ok': True, 'source_sha': 'b' * 40, 'source_tree': 'c' * 40, 'executable_sha256': native.sha(exe.read_bytes()),
                  'phases': [{'phase': phase, 'renderer_ok': True, 'normal_close': True, 'renderer_origin': 'https://wmh.localhost', 'executable_tcp_listeners': 0} for phase in native.PHASES]}
        write_json(acceptance / 'native-acceptance.json', report)
        write_json(startup / 'native-report.json', {**report, 'renderer_ok': True, 'normal_close': True, 'executable_tcp_listeners': 0})
        write_json(startup / 'renderer-report.json', {'ok': True})
        for phase in native.PHASES:
            write_json(acceptance / f'renderer-{phase}.json', {'ok': True, 'phase': phase, 'origin': 'https://wmh.localhost', 'midi': {'apiAvailable': True, 'outcome': 'denied-or-unavailable'}})
        artifacts = []
        for number in range(1, 5):
            path = acceptance / f'downloads/seed-{number}.json'
            write_json(path, {'synthetic': number})
            artifacts.append({'file': path.name, 'sha256': native.sha(path.read_bytes()), 'bytes': path.stat().st_size})
        write_json(acceptance / 'downloaded-files.json', {'ok': True, 'artifacts': artifacts})
        seed = native.read_json(acceptance / 'renderer-seed.json')
        roles = ['original', 'beforeScore', 'afterScore', 'beforeTake', 'afterTake']
        source = (ROOT / 'tests/fixtures/original-reference-overlap.mid').read_bytes()
        score = {'version': 1, 'id': 'original-native-source', 'parts': [{'notes': []}]}
        input_note = {'midi': 60, 'at_ms': 100, 'velocity': 90}
        take = {'version': 1, 'passes': [{'id': 1, 'capture_enabled': True, 'inputs': [input_note],
                'captures': [{'event_id': 1, 'event_wall_ms': 1100, 'received_wall_ms': 1101, 'input': input_note}]}],
                'input_evidence': {'version': 1, 'truncated': False, 'omitted_observations': 0, 'events': [
                    {'event_id': 1, 'source_id': 'native-key', 'kind': 'note_on', 'input_kind': 'typing_keyboard',
                     'encoding': 'key_down', 'midi': 60, 'velocity': 90, 'event_wall_ms': 1100, 'received_wall_ms': 1101,
                     'onset_capture': {'pass_id': 1, 'event_id': 1}}]}}
        payloads = [source, json.dumps(score).encode(), json.dumps(score).encode(), json.dumps(take).encode(), json.dumps(take).encode()]
        proof_artifacts = []
        for number, (kind, data) in enumerate(zip(roles, payloads), 5):
            path = acceptance / f'downloads/seed-{number}.json'
            path.write_bytes(data)
            proof_artifacts.append({'kind': kind, 'file': path.name, 'bytes': len(data), 'sha256': native.sha(data)})
        seed['files'] = {str(index): f'seed-{index}.json' for index in range(1, 5)}
        seed['downloads'] = [{'file': f'seed-{index}.json', 'complete': True, 'success': True} for index in range(1, 10)]
        seed['referenceListening'] = {'ok': True, 'fixture': 'original-reference-overlap.mid', 'sourceSha256': native.sha(source), 'trackCount': 3, 'eventCount': 26, 'onsetCount': 8,
                                      'files': {item['kind']: item['file'] for item in proof_artifacts},
                                      'checks': ['native-filechooser', 'complete-original-source', 'explicit-rendition-policy', 'play-pause-resume-stop', 'all-tracks-complete', 'independent-track-mute', 'shared-sound-mute', 'close-cleanup', 'live-locale-preserved', 'reference-input-isolated', 'canonical-score-unchanged', 'scored-take-unchanged'],
                                      'audio': {'sourceStarts': 1, 'cleanupChecks': 4, 'activeSources': 0, 'pendingSources': 0}}
        write_json(acceptance / 'renderer-seed.json', seed)
        proof = {'version': 1, 'ok': True, 'fixture': 'original-reference-overlap.mid', 'source_sha256': native.sha(source),
                 'renderer_seed_sha256': native.sha((acceptance / 'renderer-seed.json').read_bytes()),
                 'track_count': 3, 'event_count': 26, 'onset_count': 8, 'typing_note_on_count': 1, 'scored_input_count': 1,
                 'artifacts': proof_artifacts}
        write_json(acceptance / 'native-reference-files.json', proof)
        native.subprocess.run(['node', str(ROOT / 'scripts/verify-reference-native-evidence.mjs'), str(acceptance)],
                              cwd=ROOT, capture_output=True, check=True)
        return startup, acceptance, exe

    def profile_evidence(self, directory, report, phases):
        report['directory'] = str(directory / 'Scores')
        report.setdefault('phases', [{'phase': phase, 'process_id': 100 + index}
                                      for index, phase in enumerate(phases)])
        for row in report['phases']:
            row.update({'profile_directory': str(directory / 'webview-profiles' / row['phase']),
                        'profile_fresh': True, 'profile_reused': False, 'profile_absent_before_launch': True})
            write_json(directory / f"profile-{row['phase']}.json", {
                'version': 1, 'phase': row['phase'], 'process_id': row['process_id'],
                'profile_directory': row['profile_directory'], 'library_directory': report['directory'],
                'fresh_required': True, 'created_new': True})

    def song_folder_evidence(self, root, exe, directory=None):
        # Synthetic envelope for the Python packaging boundary. The independent
        # verifier's own fixtures test folder contents and derived file proofs.
        directory = directory or root / 'song folder 拼谱'
        report = {'version': 1, 'ok': True, 'source_sha': 'b' * 40, 'source_tree': 'c' * 40,
                  'executable_sha256': native.sha(exe.read_bytes()), 'phases': [
                      {'phase': phase, 'renderer_ok': True, 'normal_close': True,
                       'renderer_origin': 'https://wmh.localhost', 'executable_tcp_listeners': 0,
                       'actions': 5, 'launched_new_process': True, 'process_id': 100 + index,
                       'profile_fresh': True, 'profile_reused': False}
                      for index, phase in enumerate(native.SONG_FOLDER_PHASES)]}
        report_path = directory / 'native-song-folder.json'
        self.profile_evidence(directory, report, native.SONG_FOLDER_PHASES)
        write_json(report_path, report)
        renderer_hashes = {}
        for phase in native.SONG_FOLDER_PHASES:
            path = directory / f'renderer-{phase}.json'
            write_json(path, {'ok': True, 'phase': phase, 'origin': 'https://wmh.localhost'})
            renderer_hashes[phase] = native.sha(path.read_bytes())
        write_json(directory / 'native-song-folder-files.json', {
            'version': 1, 'ok': True, 'native_report_sha256': native.sha(report_path.read_bytes()),
            'renderer_sha256': renderer_hashes, 'files': [
                {'path': f'profile-{phase}.json', 'sha256': native.sha((directory / f'profile-{phase}.json').read_bytes()),
                 'bytes': (directory / f'profile-{phase}.json').stat().st_size}
                for phase in native.SONG_FOLDER_PHASES]})
        return directory

    def test_song_folder_proof_is_source_bound_and_independently_rederived(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            exe = root / native.EXE
            exe.write_bytes(executable())
            directory = self.song_folder_evidence(root, exe)
            proof_path = directory / 'native-song-folder-files.json'
            with patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')) as verifier:
                outcome = native.accepted_song_folder_evidence(directory, exe, 'b' * 40, 'c' * 40)
                self.assertEqual(outcome, {'native_song_folder_validated': True,
                                          'native_song_folder_proof_sha256': native.sha(proof_path.read_bytes()),
                                          'native_song_folder_reports_sha256': {
                                              name: native.sha((directory / name).read_bytes())
                                              for name in native.SONG_FOLDER_EVIDENCE if name != proof_path.name}})
                verifier.assert_called_once_with(
                    ['node', str(ROOT / 'scripts/verify-native-song-folder-evidence.mjs'), str(directory), '--check'],
                    cwd=ROOT, capture_output=True, text=True, encoding='utf-8', timeout=15, check=False)
            for commit, tree in [('d' * 40, 'c' * 40), ('b' * 40, 'd' * 40)]:
                with self.subTest(commit=commit, tree=tree), self.assertRaisesRegex(ValueError, 'exact source/tree/executable'):
                    native.accepted_song_folder_evidence(directory, exe, commit, tree)
            exe.write_bytes(executable() + b'different build')
            with self.assertRaisesRegex(ValueError, 'exact source/tree/executable'):
                native.accepted_song_folder_evidence(directory, exe, 'b' * 40, 'c' * 40)

    def test_song_folder_incomplete_unsafe_or_reused_process_phases_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            exe = root / native.EXE
            exe.write_bytes(executable())
            directory = self.song_folder_evidence(root, exe)
            path = directory / 'native-song-folder.json'
            original = native.read_json(path)
            mutations = [
                ('failed report', lambda value: value.update(ok=False)),
                ('wrong version', lambda value: value.update(version=2)),
                ('boolean version', lambda value: value.update(version=True)),
                ('partial phases', lambda value: value['phases'].pop()),
                ('reordered phases', lambda value: value['phases'].reverse()),
                ('duplicate phases', lambda value: value['phases'].__setitem__(1, value['phases'][0])),
                ('non-object phase', lambda value: value['phases'].__setitem__(0, None)),
                ('non-list phases', lambda value: value.update(phases=None)),
            ]
            for index, phase in enumerate(native.SONG_FOLDER_PHASES):
                for key, bad in [('renderer_ok', False), ('normal_close', False), ('renderer_origin', 'http://localhost'),
                                 ('executable_tcp_listeners', 1), ('executable_tcp_listeners', False),
                                 ('actions', 0), ('actions', 65), ('actions', True), ('actions', '1'),
                                 ('launched_new_process', False), ('process_id', 0), ('process_id', True)]:
                    mutations.append((f'{phase} {key}={bad!r}',
                                      lambda value, index=index, key=key, bad=bad: value['phases'][index].update({key: bad})))
                if index:
                    for key, bad in [('profile_fresh', False), ('profile_reused', True)]:
                        mutations.append((f'{phase} {key}',
                                          lambda value, index=index, key=key, bad=bad: value['phases'][index].update({key: bad})))
            for label, mutate in mutations:
                value = json.loads(json.dumps(original))
                mutate(value)
                write_json(path, value)
                with self.subTest(label=label), patch.object(native.subprocess, 'run') as verifier, self.assertRaises(ValueError):
                    native.accepted_song_folder_evidence(directory, exe, 'b' * 40, 'c' * 40)
                verifier.assert_not_called()

    def test_song_folder_stale_proof_renderer_or_independent_disk_failure_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            exe = root / native.EXE
            exe.write_bytes(executable())
            directory = self.song_folder_evidence(root, exe)
            proof_path = directory / 'native-song-folder-files.json'
            original = native.read_json(proof_path)
            for replacement in [{'version': True}, {'ok': False}, {'native_report_sha256': '0' * 64},
                                {'renderer_sha256': {}}, {'renderer_sha256': []},
                                {'renderer_sha256': {**original['renderer_sha256'], 'unknown': '0' * 64}},
                                {'renderer_sha256': {**original['renderer_sha256'], 'folder-restart': '0' * 64}}]:
                write_json(proof_path, {**original, **replacement})
                with self.subTest(replacement=replacement), patch.object(native.subprocess, 'run') as verifier, self.assertRaises(ValueError):
                    native.accepted_song_folder_evidence(directory, exe, 'b' * 40, 'c' * 40)
                verifier.assert_not_called()
            write_json(proof_path, original)
            for phase in native.SONG_FOLDER_PHASES:
                path = directory / f'renderer-{phase}.json'
                renderer = native.read_json(path)
                for replacement in [{'ok': False}, {'phase': 'seed'}, {'origin': 'https://example.invalid'}, {'changed': True}]:
                    write_json(path, {**renderer, **replacement})
                    with self.subTest(phase=phase, replacement=replacement), self.assertRaisesRegex(ValueError, 'exact renderer report'):
                        native.accepted_song_folder_evidence(directory, exe, 'b' * 40, 'c' * 40)
                write_json(path, renderer)
            # A self-consistent envelope cannot replace actual disk validation.
            with patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'retained original changed')):
                with self.assertRaisesRegex(ValueError, 'independent disk verification: retained original changed'):
                    native.accepted_song_folder_evidence(directory, exe, 'b' * 40, 'c' * 40)
            for name in native.SONG_FOLDER_EVIDENCE:
                path = directory / name
                data = path.read_bytes()
                path.unlink()
                with self.subTest(missing=name), self.assertRaises((FileNotFoundError, ValueError)):
                    native.accepted_song_folder_evidence(directory, exe, 'b' * 40, 'c' * 40)
                path.write_bytes(data)

    def performance_song_evidence(self, root, exe, directory=None):
        # Only the packaging envelope is synthetic here. The real Node verifier
        # has its own full fixture/ownership/audio/bytes regression suite.
        directory = directory or root / 'performance-song'
        report = {'version': 1, 'ok': True, 'scenario': 'performance-song',
                  'source_sha': 'b' * 40, 'source_tree': 'c' * 40,
                  'executable_sha256': native.sha(exe.read_bytes()), 'executable_bytes': exe.stat().st_size}
        self.profile_evidence(directory, report, native.PERFORMANCE_SONG_PHASES)
        write_json(directory / 'native-performance-song.json', report)
        for phase in native.PERFORMANCE_SONG_PHASES:
            write_json(directory / f'renderer-{phase}.json', {'ok': True, 'phase': phase})
        files = []
        for name in native.PERFORMANCE_SONG_EVIDENCE:
            if name != 'native-performance-song-files.json':
                data = (directory / name).read_bytes()
                files.append({'path': name, 'sha256': native.sha(data), 'bytes': len(data)})
        write_json(directory / 'native-performance-song-files.json', {
            **report, 'claims': dict(native.PERFORMANCE_SONG_CLAIMS), 'files': files})
        return directory

    def pitch_bend_evidence(self, root, exe, directory=None):
        # Synthetic Python packaging envelope only. Real original inventory,
        # GUI and receiver proof are exercised by the Node verifier's fixtures.
        directory = directory or root / 'pitch-bend 拼谱'
        report = {'version': 1, 'ok': True, 'scenario': 'pitch-bend',
                  'source_sha': 'b' * 40, 'source_tree': 'c' * 40,
                  'executable_sha256': native.sha(exe.read_bytes()), 'executable_bytes': exe.stat().st_size}
        self.profile_evidence(directory, report, native._pitch.PITCH_BEND_PHASES)
        write_json(directory / 'native-pitch-bend.json', report)
        for phase in native._pitch.PITCH_BEND_PHASES:
            write_json(directory / f'renderer-{phase}.json', {'ok': True, 'phase': phase})
        files = []
        for name in native.PITCH_BEND_REPORTS:
            data = (directory / name).read_bytes()
            files.append({'path': name, 'sha256': native.sha(data), 'bytes': len(data)})
        write_json(directory / 'native-pitch-bend-files.json', {
            **report, 'claims': dict(native.PITCH_BEND_CLAIMS), 'files': files})
        with patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')):
            manifest = native._pitch.accepted_pitch_bend_evidence(directory, exe, 'b' * 40, 'c' * 40)
        write_json(directory / 'pitch-bend-manifest.json', manifest)
        return directory

    def song_authoring_evidence(self, root, exe, directory=None):
        # Synthetic Python packaging envelope only. Real original inventory,
        # GUI, save and restart proof are exercised by the Node verifier's fixtures.
        directory = directory or root / 'song-authoring 拼谱'
        report = {'version': 1, 'ok': True, 'scenario': 'authoring',
                  'source_sha': 'b' * 40, 'source_tree': 'c' * 40,
                  'executable_sha256': native.sha(exe.read_bytes()), 'executable_bytes': exe.stat().st_size}
        self.profile_evidence(directory, report, native._authoring.SONG_AUTHORING_PHASES)
        write_json(directory / 'native-song-authoring.json', report)
        for phase in native._authoring.SONG_AUTHORING_PHASES:
            write_json(directory / f'renderer-{phase}.json', {'ok': True, 'phase': phase})
        files = []
        for name in native.SONG_AUTHORING_REPORTS:
            data = (directory / name).read_bytes()
            files.append({'path': name, 'sha256': native.sha(data), 'bytes': len(data)})
        write_json(directory / 'native-song-authoring-files.json', {
            **report, 'claims': dict(native.SONG_AUTHORING_CLAIMS), 'files': files})
        with patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')):
            manifest = native._authoring.accepted_song_authoring_evidence(directory, exe, 'b' * 40, 'c' * 40)
        write_json(directory / 'song-authoring-manifest.json', manifest)
        return directory

    def rewrite_package_inventory(self, directory, info):
        """Simulate regenerated generic ZIP checksums, never feature acceptance."""
        files = {}
        for path in directory.rglob('*'):
            if path.is_file() and path.name not in [native.INFO, native.SUMS]:
                data = path.read_bytes()
                files[path.relative_to(directory).as_posix()] = {'sha256': native.sha(data), 'bytes': len(data)}
        write_json(directory / native.INFO, {**info, 'file_count': len(files), 'files': files})
        sums = {name: item['sha256'] for name, item in files.items()}
        sums[native.INFO] = native.sha((directory / native.INFO).read_bytes())
        (directory / native.SUMS).write_text(''.join(f'{sums[name]}  {name}\n' for name in sorted(sums)),
                                             encoding='utf-8', newline='\n')

    def test_all_profile_phases_require_matching_host_creation_and_freshness(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            exe = root / native.EXE
            exe.write_bytes(executable())
            for scenario, factory, accept in [
                    ('song-folder', self.song_folder_evidence, native.accepted_song_folder_evidence),
                    ('performance-song', self.performance_song_evidence, native.accepted_performance_song_evidence),
                    ('pitch-bend', self.pitch_bend_evidence, native.accepted_pitch_bend_evidence),
                    ('song-authoring', self.song_authoring_evidence, native.accepted_song_authoring_evidence)]:
                directory = factory(root, exe)
                native_path = directory / f'native-{scenario}.json'
                original = native.read_json(native_path)
                for phases in [None, original['phases'][:1], list(reversed(original['phases'])),
                               [original['phases'][0], original['phases'][0]], [None, None]]:
                    write_json(native_path, {**original, 'phases': phases})
                    with self.subTest(scenario=scenario, phases=phases), \
                            patch.object(native.subprocess, 'run') as verifier, self.assertRaises(ValueError):
                        accept(directory, exe, 'b' * 40, 'c' * 40)
                    verifier.assert_not_called()
                write_json(native_path, original)
                for index, row in enumerate(original['phases']):
                    for field, bad in [('profile_fresh', False), ('profile_fresh', 1),
                                       ('profile_reused', True), ('profile_reused', 0),
                                       ('profile_absent_before_launch', False), ('profile_absent_before_launch', 1),
                                       ('profile_directory', row['profile_directory'] + '/child'),
                                       ('profile_directory', '../shared-profile'), ('process_id', True),
                                       ('process_id', 0), ('process_id', 9007199254740992)]:
                        changed = json.loads(json.dumps(original))
                        changed['phases'][index][field] = bad
                        write_json(native_path, changed)
                        with self.subTest(scenario=scenario, phase=row['phase'], field=field, bad=bad), \
                                patch.object(native.subprocess, 'run') as verifier, self.assertRaises(ValueError):
                            accept(directory, exe, 'b' * 40, 'c' * 40)
                        verifier.assert_not_called()
                    for field in ['profile_directory', 'profile_fresh', 'profile_reused', 'profile_absent_before_launch']:
                        changed = json.loads(json.dumps(original))
                        del changed['phases'][index][field]
                        write_json(native_path, changed)
                        with self.subTest(scenario=scenario, phase=row['phase'], missing=field), self.assertRaises(ValueError):
                            accept(directory, exe, 'b' * 40, 'c' * 40)
                    write_json(native_path, original)
                    host_path = directory / f"profile-{row['phase']}.json"
                    host_bytes = host_path.read_bytes()
                    host = native.read_json(host_path)
                    for field, bad in [('version', True), ('phase', 'other'), ('process_id', True),
                                       ('process_id', row['process_id'] + 1),
                                       ('profile_directory', row['profile_directory'] + '/other'),
                                       ('library_directory', original['directory'] + '/other'),
                                       ('fresh_required', False), ('fresh_required', 1),
                                       ('created_new', False), ('created_new', 1)]:
                        write_json(host_path, {**host, field: bad})
                        with self.subTest(scenario=scenario, host=row['phase'], field=field, bad=bad), \
                                patch.object(native.subprocess, 'run') as verifier, self.assertRaisesRegex(ValueError, 'profile host'):
                            accept(directory, exe, 'b' * 40, 'c' * 40)
                        verifier.assert_not_called()
                    for payload in [None, b' ' * (16 * 1024 + 1)]:
                        host_path.unlink()
                        if payload is not None:
                            host_path.write_bytes(payload)
                        with self.subTest(scenario=scenario, host=row['phase'], payload=payload is not None), self.assertRaises(ValueError):
                            accept(directory, exe, 'b' * 40, 'c' * 40)
                        host_path.write_bytes(host_bytes)

    def test_profile_paths_accept_windows_spelling_and_reject_aliases_or_symlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            phases = native._pitch.PITCH_BEND_PHASES
            report = {}
            self.profile_evidence(root, report, phases)
            report['directory'] = r'C:\acceptance\Scores'
            for row in report['phases']:
                row['profile_directory'] = rf'C:\acceptance\webview-profiles\{row["phase"]}'
                path = root / f"profile-{row['phase']}.json"
                write_json(path, {**native.read_json(path), 'profile_directory': row['profile_directory'],
                                  'library_directory': report['directory']})
            read = lambda name: native._pitch.read_evidence(root / name, 16 * 1024)
            native._pitch.verify_profile_evidence(report, phases, read)
            for bad in [r'C:\acceptance\..\acceptance\Scores', '//server/share/Scores',
                        '/acceptance//Scores', 'relative/Scores', '/acceptance/Scores/']:
                with self.subTest(directory=bad), self.assertRaises(ValueError):
                    native._pitch.verify_profile_evidence({**report, 'directory': bad}, phases, read)
            reused = json.loads(json.dumps(report))
            reused['phases'][1]['process_id'] = reused['phases'][0]['process_id']
            with self.assertRaisesRegex(ValueError, 'distinct valid processes'):
                native._pitch.verify_profile_evidence(reused, phases, read)
            path = root / f'profile-{phases[0]}.json'
            host = native.read_json(path)
            write_json(path, {**host, 'profile_directory': host['profile_directory'].replace('\\', '/')})
            with self.assertRaisesRegex(ValueError, 'profile host'):
                native._pitch.verify_profile_evidence(report, phases, read)
            path.rename(root / 'profile-real.json')
            try:
                path.symlink_to(root / 'profile-real.json')
            except OSError:
                return  # Windows may require additional rights to create a test symlink.
            with self.assertRaisesRegex(ValueError, 'bounded ordinary'):
                native._pitch.verify_profile_evidence(report, phases, read)

    def test_profile_files_must_be_bound_once_by_the_independent_proof(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            exe = root / native.EXE
            exe.write_bytes(executable())
            for scenario, factory, accept in [
                    ('song-folder', self.song_folder_evidence, native.accepted_song_folder_evidence),
                    ('performance-song', self.performance_song_evidence, native.accepted_performance_song_evidence),
                    ('pitch-bend', self.pitch_bend_evidence, native.accepted_pitch_bend_evidence),
                    ('song-authoring', self.song_authoring_evidence, native.accepted_song_authoring_evidence)]:
                directory = factory(root, exe)
                path = directory / f'native-{scenario}-files.json'
                original = native.read_json(path)
                for profile in [row for row in original['files'] if row['path'].startswith('profile-')]:
                    remaining = [row for row in original['files'] if row != profile]
                    for files in [remaining, [*original['files'], profile],
                                  [*remaining, {**profile, 'sha256': '0' * 64}],
                                  [*remaining, {**profile, 'bytes': True}],
                                  [*remaining, {**profile, 'bytes': profile['bytes'] + 1}]]:
                        write_json(path, {**original, 'files': files})
                        with self.subTest(scenario=scenario, files=files), \
                                patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')), \
                                self.assertRaises(ValueError):
                            accept(directory, exe, 'b' * 40, 'c' * 40)

    def test_packaged_profiles_cannot_be_replaced_by_rehashing(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / native.FOLDER
            metadata = self.package(directory)
            original = native.create_manifest(directory, metadata)
            names = [name for name in [*native.SONG_FOLDER_EVIDENCE, *native.PERFORMANCE_SONG_EVIDENCE,
                                      *native.PITCH_BEND_EVIDENCE, *native.SONG_AUTHORING_EVIDENCE]
                     if name.startswith('profile-')]
            for name in names:
                path = directory / 'evidence' / name
                before = path.read_bytes()
                path.write_bytes(before + b' ')
                self.rewrite_package_inventory(directory, original)
                with self.subTest(name=name), self.assertRaises(ValueError):
                    native.create_archive(directory, root / 'mutated-profile.zip')
                with self.subTest(create_name=name), self.assertRaises(ValueError):
                    native.create_manifest(directory, metadata)
                path.write_bytes(before)
            # Even updating the profile's proof hash and acceptance metadata
            # cannot make a host report claiming profile reuse acceptable.
            path = directory / 'evidence/profile-folder-seed.json'
            write_json(path, {**native.read_json(path), 'created_new': False})
            proof_path = directory / 'evidence/native-song-folder-files.json'
            proof = native.read_json(proof_path)
            for row in proof['files']:
                if row['path'] == path.name:
                    row.update(sha256=native.sha(path.read_bytes()), bytes=path.stat().st_size)
            write_json(proof_path, proof)
            acceptance = json.loads(json.dumps(original['acceptance']))
            acceptance['native_song_folder_reports_sha256'][path.name] = native.sha(path.read_bytes())
            acceptance['native_song_folder_proof_sha256'] = native.sha(proof_path.read_bytes())
            self.rewrite_package_inventory(directory, {**original, 'acceptance': acceptance})
            with self.assertRaisesRegex(ValueError, 'profile host'):
                native.create_archive(directory, root / 'rehashed-reused-profile.zip')

    def test_pitch_gate_rederives_original_inventory_and_isolates_focused_scope(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            exe = root / native.EXE
            exe.write_bytes(executable())
            directory = self.pitch_bend_evidence(root, exe)
            with patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')) as verify:
                result = native.accepted_pitch_bend_evidence(directory, exe, 'b' * 40, 'c' * 40)
            verify.assert_called_once_with(
                ['node', str(ROOT / 'scripts/verify-native-pitch-bend-evidence.mjs'), '--check', str(directory)],
                cwd=ROOT, capture_output=True, text=True, encoding='utf-8', timeout=30, check=False)
            self.assertTrue(result['native_pitch_bend_validated'])
            self.assertEqual(result['native_pitch_bend_claims'], native.PITCH_BEND_CLAIMS)
            self.assertEqual(result['native_pitch_bend_scope'], 'original-pitch-bend-focused-evidence-only')
            self.assertFalse(result['native_pitch_bend_full_checkpoint_acceptance'])
            self.assertFalse(result['native_pitch_bend_release_ready'])
            self.assertTrue(all(key.startswith('native_pitch_bend_') for key in result))
            self.assertEqual(result['native_pitch_bend_manifest_sha256'],
                             native.sha((directory / 'pitch-bend-manifest.json').read_bytes()))
            checkpoint = {'full_checkpoint_acceptance': True, 'release_ready': True}
            checkpoint.update(result)
            self.assertTrue(checkpoint['full_checkpoint_acceptance'])
            self.assertTrue(checkpoint['release_ready'])
            # A synthetic Python envelope never substitutes for original disk,
            # picker, human-take or receiver observations at the real gate.
            with self.assertRaisesRegex(ValueError, 'Independent pitch-bend verification failed'):
                native.accepted_pitch_bend_evidence(directory, exe, 'b' * 40, 'c' * 40)
            with patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'original inventory changed')):
                with self.assertRaisesRegex(ValueError, 'original inventory changed'):
                    native.accepted_pitch_bend_evidence(directory, exe, 'b' * 40, 'c' * 40)

    def test_pitch_gate_binds_exact_source_tree_executable_and_boolean_claim_set(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            exe = root / native.EXE
            exe.write_bytes(executable())
            directory = self.pitch_bend_evidence(root, exe)
            for name in ['native-pitch-bend.json', 'native-pitch-bend-files.json']:
                path = directory / name
                original = native.read_json(path)
                for key, bad in [('source_sha', 'd' * 40), ('source_tree', 'e' * 40),
                                 ('executable_sha256', 'f' * 64), ('executable_bytes', 101),
                                 ('executable_bytes', True), ('version', True), ('ok', False)]:
                    write_json(path, {**original, key: bad})
                    with self.subTest(name=name, field=key, value=bad), self.assertRaisesRegex(ValueError, 'exact source, tree and executable'):
                        native.accepted_pitch_bend_evidence(directory, exe, 'b' * 40, 'c' * 40)
                write_json(path, original)
            proof_path = directory / 'native-pitch-bend-files.json'
            proof = native.read_json(proof_path)
            claims = proof['claims']
            mutations = [{**claims, 'extra_claim': True}, {**claims, 'extra_claim': False}]
            for key, value in claims.items():
                mutations.extend([{name: item for name, item in claims.items() if name != key},
                                  {**claims, key: not value}, {**claims, key: int(value)}])
            for changed in mutations:
                write_json(proof_path, {**proof, 'claims': changed})
                with self.subTest(claims=changed), patch.object(native.subprocess, 'run') as verify, \
                        self.assertRaisesRegex(ValueError, 'claim set or exact boolean scope'):
                    native.accepted_pitch_bend_evidence(directory, exe, 'b' * 40, 'c' * 40)
                verify.assert_not_called()
            write_json(proof_path, proof)
            exe.write_bytes(executable() + b'changed')
            with self.assertRaisesRegex(ValueError, 'exact source, tree and executable'):
                native.accepted_pitch_bend_evidence(directory, exe, 'b' * 40, 'c' * 40)

    def test_pitch_gate_rejects_missing_stale_or_expanded_focused_manifest_and_reports(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            exe = root / native.EXE
            exe.write_bytes(executable())
            directory = self.pitch_bend_evidence(root, exe)
            manifest_path = directory / 'pitch-bend-manifest.json'
            manifest = native.read_json(manifest_path)
            mutations = [{**manifest, 'extra': False}, {**manifest, 'release_ready': True},
                         {**manifest, 'full_checkpoint_acceptance': 0}, {**manifest, 'version': True},
                         {**manifest, 'native_pitch_bend_manifest_sha256': '0' * 64},
                         {**manifest, 'native_pitch_bend_reports_sha256': {}},
                         {**manifest, 'native_pitch_bend_claims': {}}]
            with patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')):
                for changed in mutations:
                    write_json(manifest_path, changed)
                    before = manifest_path.read_bytes()
                    with self.subTest(manifest=changed), self.assertRaisesRegex(ValueError, 'focused manifest differs'):
                        native.accepted_pitch_bend_evidence(directory, exe, 'b' * 40, 'c' * 40)
                    self.assertEqual(manifest_path.read_bytes(), before)
                manifest_path.unlink()
                with self.assertRaisesRegex(ValueError, 'bounded ordinary evidence file'):
                    native.accepted_pitch_bend_evidence(directory, exe, 'b' * 40, 'c' * 40)
                write_json(manifest_path, manifest)
                for name in native.PITCH_BEND_REPORTS:
                    path = directory / name
                    before = path.read_bytes()
                    path.write_bytes(before + b' ')
                    with self.subTest(report=name), self.assertRaisesRegex(ValueError, 'bind every exact original pitch-bend report'):
                        native.accepted_pitch_bend_evidence(directory, exe, 'b' * 40, 'c' * 40)
                    path.write_bytes(before)

    def test_create_does_not_copy_any_evidence_or_write_inventory_after_pitch_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / native.FOLDER
            metadata = self.package(directory)
            pitch = self.pitch_bend_evidence(root, directory / native.EXE)
            manifest_path = pitch / 'pitch-bend-manifest.json'
            original = native.read_json(manifest_path)
            before = {path.name: path.read_bytes() for path in (directory / 'evidence').iterdir()}
            arguments = ['native-release-manifest', 'create', str(directory), '--commit', 'b' * 40,
                         '--count', '164', '--startup', 'unused-startup', '--acceptance', 'unused-acceptance',
                         '--song-folder', 'unused-folder', '--performance-song', 'unused-performance', '--pitch-bend', str(pitch), '--song-authoring', 'unused-authoring']
            for failure in ['independent original inventory failure', 'focused manifest differs']:
                write_json(manifest_path, {**original, 'release_ready': True} if failure == 'focused manifest differs' else original)
                result = subprocess.CompletedProcess([], 0 if failure == 'focused manifest differs' else 1, '', failure)
                with self.subTest(failure=failure), patch('sys.argv', arguments), \
                        patch.object(native, 'source_metadata', return_value=dict(metadata)), \
                        patch.object(native, 'accepted_evidence', return_value={}), \
                        patch.object(native, 'accepted_song_folder_evidence', return_value={}), \
                        patch.object(native, 'accepted_performance_song_evidence', return_value={}), \
                        patch.object(native.subprocess, 'run', return_value=result), self.assertRaisesRegex(ValueError, failure):
                    native.main()
                self.assertFalse((directory / native.INFO).exists())
                self.assertFalse((directory / native.SUMS).exists())
                self.assertEqual(before, {path.name: path.read_bytes() for path in (directory / 'evidence').iterdir()})

    def test_pitch_package_rejects_mutated_evidence_despite_regenerated_zip_checksums(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / native.FOLDER
            metadata = self.package(directory)
            original = native.create_manifest(directory, metadata)
            for name in native.PITCH_BEND_EVIDENCE:
                path = directory / 'evidence' / name
                before = path.read_bytes()
                path.write_bytes(before + b' ')
                self.rewrite_package_inventory(directory, original)
                with self.subTest(name=name), self.assertRaises(ValueError):
                    native.create_archive(directory, root / 'mutated-pitch.zip')
                with self.subTest(create_name=name), self.assertRaises(ValueError):
                    native.create_manifest(directory, metadata)
                path.write_bytes(before)
            for key, bad in [('git_commit', 'd' * 40), ('git_tree', 'e' * 40)]:
                self.rewrite_package_inventory(directory, {**original, key: bad})
                with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'exact source/tree/executable'):
                    native.create_archive(directory, root / 'wrong-source.zip')
            exe = directory / native.EXE
            exe.write_bytes(executable() + b'other build')
            self.rewrite_package_inventory(directory, original)
            with self.assertRaisesRegex(ValueError, 'exact source/tree/executable'):
                native.create_archive(directory, root / 'wrong-executable.zip')

    def test_pitch_package_rejects_extra_names_and_missing_acceptance_bindings(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / native.FOLDER
            metadata = self.package(directory)
            original = native.create_manifest(directory, metadata)
            for name in ['native-pitch-bend-extra.json', 'renderer-pitch-bend-third.json', 'pitch-bend-manifest-old.json']:
                path = directory / 'evidence' / name
                write_json(path, {})
                with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'exactly the required'):
                    native.create_manifest(directory, metadata)
                self.rewrite_package_inventory(directory, original)
                with self.subTest(archive_name=name), self.assertRaisesRegex(ValueError, 'exactly the required'):
                    native.create_archive(directory, root / 'extra-pitch.zip')
                path.unlink()
            for name in ['evidence/renderer-pitch-bend-seed.json/extra.txt', 'native-pitch-bend-copy/ordinary.json']:
                with self.subTest(nested=name), self.assertRaisesRegex(ValueError, 'exactly the required'):
                    native.verify_pitch_bend_inventory([*original['files'], name])
            for key in [name for name in metadata['acceptance'] if name.startswith('native_pitch_bend_')]:
                changed = {name: value for name, value in metadata['acceptance'].items() if name != key}
                self.rewrite_package_inventory(directory, {**original, 'acceptance': changed})
                with self.subTest(acceptance=key), self.assertRaisesRegex(ValueError, 'BUILD-INFO acceptance must bind'):
                    native.create_archive(directory, root / 'missing-acceptance.zip')
            expanded = {**metadata['acceptance'], 'native_pitch_bend_actual_audibility': True}
            self.rewrite_package_inventory(directory, {**original, 'acceptance': expanded})
            with self.assertRaisesRegex(ValueError, 'BUILD-INFO acceptance must bind'):
                native.create_archive(directory, root / 'expanded-acceptance.zip')

    def test_pitch_archive_rechecks_exact_boolean_claims_after_inventory_regeneration(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / native.FOLDER
            metadata = self.package(directory)
            original = native.create_manifest(directory, metadata)
            path = directory / 'evidence/native-pitch-bend-files.json'
            proof = native.read_json(path)
            claims = proof['claims']
            mutations = [{**claims, 'extra_claim': True}, {**claims, 'extra_claim': False}]
            for key, value in claims.items():
                mutations.extend([{name: item for name, item in claims.items() if name != key},
                                  {**claims, key: not value}, {**claims, key: int(value)}])
            for changed in mutations:
                write_json(path, {**proof, 'claims': changed})
                self.rewrite_package_inventory(directory, original)
                with self.subTest(claims=changed), self.assertRaisesRegex(ValueError, 'claim set or exact boolean scope'):
                    native.create_archive(directory, root / 'changed-claims.zip')

    def test_authoring_gate_rederives_original_inventory_and_isolates_focused_scope(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            exe = root / native.EXE
            exe.write_bytes(executable())
            directory = self.song_authoring_evidence(root, exe)
            with patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')) as verify:
                result = native.accepted_song_authoring_evidence(directory, exe, 'b' * 40, 'c' * 40)
            verify.assert_called_once_with(
                ['node', str(ROOT / 'scripts/verify-native-song-authoring-evidence.mjs'), '--check', str(directory)],
                cwd=ROOT, capture_output=True, text=True, encoding='utf-8', timeout=30, check=False)
            self.assertTrue(result['native_song_authoring_validated'])
            self.assertEqual(result['native_song_authoring_claims'], native.SONG_AUTHORING_CLAIMS)
            self.assertEqual(result['native_song_authoring_scope'], 'original-song-authoring-focused-evidence-only')
            self.assertFalse(result['native_song_authoring_full_checkpoint_acceptance'])
            self.assertFalse(result['native_song_authoring_release_ready'])
            self.assertTrue(all(key.startswith('native_song_authoring_') for key in result))
            self.assertEqual(result['native_song_authoring_manifest_sha256'],
                             native.sha((directory / 'song-authoring-manifest.json').read_bytes()))
            reports = ['native-song-authoring.json', 'renderer-authoring-seed.json',
                       'renderer-authoring-restart.json', 'profile-authoring-seed.json',
                       'profile-authoring-restart.json']
            self.assertEqual(native.SONG_AUTHORING_REPORTS, reports)
            self.assertEqual(native.SONG_AUTHORING_EVIDENCE,
                             [*reports, 'native-song-authoring-files.json', 'song-authoring-manifest.json'])
            self.assertEqual(result['native_song_authoring_reports_sha256'],
                             {name: native.sha((directory / name).read_bytes()) for name in reports})
            self.assertEqual(result['native_song_authoring_proof_sha256'],
                             native.sha((directory / 'native-song-authoring-files.json').read_bytes()))
            manifest = native.read_json(directory / 'song-authoring-manifest.json')
            for key, value in [('source_sha', 'b' * 40), ('source_tree', 'c' * 40),
                               ('executable_sha256', native.sha(exe.read_bytes())),
                               ('executable_bytes', exe.stat().st_size)]:
                self.assertEqual(manifest[key], value)
            checkpoint = {'full_checkpoint_acceptance': True, 'release_ready': True}
            checkpoint.update(result)
            self.assertTrue(checkpoint['full_checkpoint_acceptance'])
            self.assertTrue(checkpoint['release_ready'])
            # A synthetic Python envelope never substitutes for original disk,
            # picker, save, restart or human-take observations at the real gate.
            with self.assertRaisesRegex(ValueError, 'Independent song-authoring verification failed'):
                native.accepted_song_authoring_evidence(directory, exe, 'b' * 40, 'c' * 40)
            with patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'original inventory changed')):
                with self.assertRaisesRegex(ValueError, 'original inventory changed'):
                    native.accepted_song_authoring_evidence(directory, exe, 'b' * 40, 'c' * 40)

    def test_authoring_gate_binds_exact_source_tree_executable_and_boolean_claim_set(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            exe = root / native.EXE
            exe.write_bytes(executable())
            directory = self.song_authoring_evidence(root, exe)
            for name in ['native-song-authoring.json', 'native-song-authoring-files.json']:
                path = directory / name
                original = native.read_json(path)
                for key, bad in [('source_sha', 'd' * 40), ('source_tree', 'e' * 40),
                                 ('executable_sha256', 'f' * 64), ('executable_bytes', 101),
                                 ('executable_bytes', True), ('version', True), ('ok', False)]:
                    write_json(path, {**original, key: bad})
                    with self.subTest(name=name, field=key, value=bad), self.assertRaisesRegex(ValueError, 'exact source, tree and executable'):
                        native.accepted_song_authoring_evidence(directory, exe, 'b' * 40, 'c' * 40)
                write_json(path, original)
            proof_path = directory / 'native-song-authoring-files.json'
            proof = native.read_json(proof_path)
            claims = proof['claims']
            mutations = [{**claims, 'extra_claim': True}, {**claims, 'extra_claim': False}]
            for key, value in claims.items():
                mutations.extend([{name: item for name, item in claims.items() if name != key},
                                  {**claims, key: not value}, {**claims, key: int(value)}])
            for changed in mutations:
                write_json(proof_path, {**proof, 'claims': changed})
                with self.subTest(claims=changed), patch.object(native.subprocess, 'run') as verify, \
                        self.assertRaisesRegex(ValueError, 'claim set or exact boolean scope'):
                    native.accepted_song_authoring_evidence(directory, exe, 'b' * 40, 'c' * 40)
                verify.assert_not_called()
            write_json(proof_path, proof)
            exe.write_bytes(executable() + b'changed')
            with self.assertRaisesRegex(ValueError, 'exact source, tree and executable'):
                native.accepted_song_authoring_evidence(directory, exe, 'b' * 40, 'c' * 40)

    def test_authoring_gate_rejects_missing_stale_or_expanded_focused_manifest_and_reports(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            exe = root / native.EXE
            exe.write_bytes(executable())
            directory = self.song_authoring_evidence(root, exe)
            manifest_path = directory / 'song-authoring-manifest.json'
            manifest = native.read_json(manifest_path)
            mutations = [{**manifest, 'extra': False}, {**manifest, 'release_ready': True},
                         {**manifest, 'full_checkpoint_acceptance': 0}, {**manifest, 'version': True},
                         {**manifest, 'native_song_authoring_manifest_sha256': '0' * 64},
                         {**manifest, 'native_song_authoring_reports_sha256': {}},
                         {**manifest, 'native_song_authoring_claims': {}}]
            with patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')):
                for changed in mutations:
                    write_json(manifest_path, changed)
                    before = manifest_path.read_bytes()
                    with self.subTest(manifest=changed), self.assertRaisesRegex(ValueError, 'focused manifest differs'):
                        native.accepted_song_authoring_evidence(directory, exe, 'b' * 40, 'c' * 40)
                    self.assertEqual(manifest_path.read_bytes(), before)
                manifest_path.unlink()
                with self.assertRaisesRegex(ValueError, 'bounded ordinary evidence file'):
                    native.accepted_song_authoring_evidence(directory, exe, 'b' * 40, 'c' * 40)
                write_json(manifest_path, manifest)
                for name in native.SONG_AUTHORING_REPORTS:
                    path = directory / name
                    before = path.read_bytes()
                    path.write_bytes(before + b' ')
                    with self.subTest(report=name), self.assertRaisesRegex(ValueError, 'bind every exact original song-authoring report'):
                        native.accepted_song_authoring_evidence(directory, exe, 'b' * 40, 'c' * 40)
                    path.write_bytes(before)

    def test_create_does_not_copy_any_evidence_or_write_inventory_after_authoring_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / native.FOLDER
            metadata = self.package(directory)
            authoring = self.song_authoring_evidence(root, directory / native.EXE)
            manifest_path = authoring / 'song-authoring-manifest.json'
            original = native.read_json(manifest_path)
            profile_path = authoring / 'profile-authoring-seed.json'
            profile = native.read_json(profile_path)
            before = {path.name: path.read_bytes() for path in (directory / 'evidence').iterdir()}
            arguments = ['native-release-manifest', 'create', str(directory), '--commit', 'b' * 40,
                         '--count', '164', '--startup', 'unused-startup', '--acceptance', 'unused-acceptance',
                         '--song-folder', 'unused-folder', '--performance-song', 'unused-performance', '--pitch-bend', 'unused-pitch', '--song-authoring', str(authoring)]
            for failure in ['independent original inventory failure', 'focused manifest differs', 'profile host']:
                write_json(manifest_path, {**original, 'release_ready': True} if failure == 'focused manifest differs' else original)
                write_json(profile_path, {**profile, 'created_new': False} if failure == 'profile host' else profile)
                result = subprocess.CompletedProcess([], 1 if failure == 'independent original inventory failure' else 0, '', failure)
                with self.subTest(failure=failure), patch('sys.argv', arguments), \
                        patch.object(native, 'source_metadata', return_value=dict(metadata)), \
                        patch.object(native, 'accepted_evidence', return_value={}), \
                        patch.object(native, 'accepted_song_folder_evidence', return_value={}), \
                        patch.object(native, 'accepted_performance_song_evidence', return_value={}), \
                        patch.object(native, 'accepted_pitch_bend_evidence', return_value={}), \
                        patch.object(native.subprocess, 'run', return_value=result) as verifier, self.assertRaisesRegex(ValueError, failure):
                    native.main()
                if failure == 'profile host':
                    verifier.assert_not_called()
                self.assertFalse((directory / native.INFO).exists())
                self.assertFalse((directory / native.SUMS).exists())
                self.assertEqual(before, {path.name: path.read_bytes() for path in (directory / 'evidence').iterdir()})

    def test_authoring_package_rejects_mutated_evidence_despite_regenerated_zip_checksums(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / native.FOLDER
            metadata = self.package(directory)
            original = native.create_manifest(directory, metadata)
            for name in native.SONG_AUTHORING_EVIDENCE:
                path = directory / 'evidence' / name
                before = path.read_bytes()
                path.write_bytes(before + b' ')
                self.rewrite_package_inventory(directory, original)
                with self.subTest(name=name), self.assertRaises(ValueError):
                    native.create_archive(directory, root / 'mutated-authoring.zip')
                with self.subTest(create_name=name), self.assertRaises(ValueError):
                    native.create_manifest(directory, metadata)
                path.write_bytes(before)
            for key, bad in [('git_commit', 'd' * 40), ('git_tree', 'e' * 40)]:
                self.rewrite_package_inventory(directory, {**original, key: bad})
                with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'exact source/tree/executable'):
                    native.create_archive(directory, root / 'wrong-source.zip')
            exe = directory / native.EXE
            exe.write_bytes(executable() + b'other build')
            self.rewrite_package_inventory(directory, original)
            with self.assertRaisesRegex(ValueError, 'exact source/tree/executable'):
                native.create_archive(directory, root / 'wrong-executable.zip')

    def test_authoring_package_rejects_extra_names_and_missing_acceptance_bindings(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / native.FOLDER
            metadata = self.package(directory)
            original = native.create_manifest(directory, metadata)
            for name in ['native-song-authoring-extra.json', 'renderer-authoring-third.json',
                         'profile-authoring-third.json', 'profile-authoring-seed-copy.json',
                         'song-authoring-manifest-old.json']:
                path = directory / 'evidence' / name
                write_json(path, {})
                with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'exactly the seven required'):
                    native.create_manifest(directory, metadata)
                self.rewrite_package_inventory(directory, original)
                with self.subTest(archive_name=name), self.assertRaisesRegex(ValueError, 'exactly the seven required'):
                    native.create_archive(directory, root / 'extra-authoring.zip')
                path.unlink()
            for name in ['evidence/renderer-authoring-seed.json/extra.txt', 'native-song-authoring-copy/ordinary.json',
                         'evidence/profile-authoring-seed.json/extra.txt', 'profile-authoring-copy/ordinary.json']:
                with self.subTest(nested=name), self.assertRaisesRegex(ValueError, 'exactly the seven required'):
                    native.verify_song_authoring_inventory([*original['files'], name])
            for name in native.SONG_AUTHORING_EVIDENCE:
                with self.subTest(missing=name), self.assertRaisesRegex(ValueError, 'exactly the seven required'):
                    native.verify_song_authoring_inventory(
                        path for path in original['files'] if path != 'evidence/' + name)
            for key in [name for name in metadata['acceptance'] if name.startswith('native_song_authoring_')]:
                changed = {name: value for name, value in metadata['acceptance'].items() if name != key}
                self.rewrite_package_inventory(directory, {**original, 'acceptance': changed})
                with self.subTest(acceptance=key), self.assertRaisesRegex(ValueError, 'BUILD-INFO acceptance must bind'):
                    native.create_archive(directory, root / 'missing-acceptance.zip')
            expanded = {**metadata['acceptance'], 'native_song_authoring_actual_audibility': True}
            self.rewrite_package_inventory(directory, {**original, 'acceptance': expanded})
            with self.assertRaisesRegex(ValueError, 'BUILD-INFO acceptance must bind'):
                native.create_archive(directory, root / 'expanded-acceptance.zip')

    def test_authoring_archive_rechecks_exact_boolean_claims_after_inventory_regeneration(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / native.FOLDER
            metadata = self.package(directory)
            original = native.create_manifest(directory, metadata)
            path = directory / 'evidence/native-song-authoring-files.json'
            proof = native.read_json(path)
            claims = proof['claims']
            mutations = [{**claims, 'extra_claim': True}, {**claims, 'extra_claim': False}]
            for key, value in claims.items():
                mutations.extend([{name: item for name, item in claims.items() if name != key},
                                  {**claims, key: not value}, {**claims, key: int(value)}])
            for changed in mutations:
                write_json(path, {**proof, 'claims': changed})
                self.rewrite_package_inventory(directory, original)
                with self.subTest(claims=changed), self.assertRaisesRegex(ValueError, 'claim set or exact boolean scope'):
                    native.create_archive(directory, root / 'changed-claims.zip')

    def test_authoring_archive_rechecks_its_own_source_and_executable_envelopes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / native.FOLDER
            metadata = self.package(directory)
            original = native.create_manifest(directory, metadata)
            for name in ['native-song-authoring.json', 'native-song-authoring-files.json']:
                path = directory / 'evidence' / name
                evidence = native.read_json(path)
                for key, bad in [('source_sha', 'd' * 40), ('source_tree', 'e' * 40),
                                 ('executable_sha256', 'f' * 64), ('executable_bytes', 101),
                                 ('executable_bytes', True), ('version', True), ('ok', 1)]:
                    write_json(path, {**evidence, key: bad})
                    self.rewrite_package_inventory(directory, original)
                    with self.subTest(name=name, field=key), self.assertRaisesRegex(
                            ValueError, 'Packaged song-authoring evidence must match the exact source/tree/executable'):
                        native.create_archive(directory, root / 'wrong-authoring-envelope.zip')
                write_json(path, evidence)
            # Exercise this feature's EXE check directly so a preceding pitch
            # gate cannot make the wrong-binary regression pass accidentally.
            def read_wrong_executable(name):
                return executable() + b'other build' if name == native.EXE else (directory / name).read_bytes()
            with self.assertRaisesRegex(ValueError, 'Packaged song-authoring evidence must match the exact source/tree/executable'):
                native.verify_packaged_song_authoring_evidence(read_wrong_executable, metadata)

    def test_authoring_rebound_reports_and_proof_still_require_original_build_info_acceptance(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / native.FOLDER
            metadata = self.package(directory)
            original = native.create_manifest(directory, metadata)
            evidence = directory / 'evidence'
            originals = {name: (evidence / name).read_bytes() for name in native.SONG_AUTHORING_EVIDENCE}
            for name in native.SONG_AUTHORING_REPORTS:
                for filename, data in originals.items():
                    (evidence / filename).write_bytes(data)
                report_path = evidence / name
                report_path.write_bytes(report_path.read_bytes() + b' ')
                proof_path = evidence / 'native-song-authoring-files.json'
                proof = native.read_json(proof_path)
                for row in proof['files']:
                    if row['path'] == name:
                        row.update(sha256=native.sha(report_path.read_bytes()), bytes=report_path.stat().st_size)
                write_json(proof_path, proof)
                # Even a self-consistent replacement of the focused evidence and
                # generic inventory is not the evidence accepted into BUILD-INFO.
                with patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')):
                    manifest = native._authoring.accepted_song_authoring_evidence(evidence, directory / native.EXE, 'b' * 40, 'c' * 40)
                write_json(evidence / 'song-authoring-manifest.json', manifest)
                self.rewrite_package_inventory(directory, original)
                with self.subTest(archive=name), self.assertRaisesRegex(ValueError, 'BUILD-INFO acceptance must bind the exact song-authoring'):
                    native.create_archive(directory, root / 'rebound-authoring.zip')
                with self.subTest(create=name), self.assertRaisesRegex(ValueError, 'BUILD-INFO acceptance must bind the exact song-authoring'):
                    native.create_manifest(directory, metadata)

    def test_authoring_package_rechecks_profiles_after_all_hash_bindings_are_regenerated(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / native.FOLDER
            metadata = self.package(directory)
            original = native.create_manifest(directory, metadata)
            evidence = directory / 'evidence'
            originals = {name: (evidence / name).read_bytes() for name in native.SONG_AUTHORING_EVIDENCE}
            native_name = 'native-song-authoring.json'
            report = json.loads(originals[native_name])
            mutations = [(native_name, 'missing phases', lambda value: value.pop('phases')),
                         (native_name, 'reordered phases', lambda value: value['phases'].reverse()),
                         (native_name, 'reused process', lambda value: value['phases'][1].update(
                             process_id=value['phases'][0]['process_id']))]
            for index, row in enumerate(report['phases']):
                for field, bad in [('profile_fresh', False), ('profile_reused', True),
                                   ('profile_absent_before_launch', False),
                                   ('profile_directory', row['profile_directory'] + '/child'),
                                   ('process_id', True)]:
                    mutations.append((native_name, f"{row['phase']} {field}",
                                      lambda value, index=index, field=field, bad=bad:
                                      value['phases'][index].update({field: bad})))
                for field, bad in [('version', True), ('phase', 'other'), ('process_id', True),
                                   ('process_id', row['process_id'] + 1),
                                   ('profile_directory', row['profile_directory'] + '/other'),
                                   ('library_directory', report['directory'] + '/other'),
                                   ('fresh_required', False), ('fresh_required', 1),
                                   ('created_new', False), ('created_new', 1), ('padding', 'x' * (16 * 1024))]:
                    mutations.append((f"profile-{row['phase']}.json", field,
                                      lambda value, field=field, bad=bad: value.update({field: bad})))
            for name, label, mutate in mutations:
                for filename, data in originals.items():
                    (evidence / filename).write_bytes(data)
                changed = json.loads(originals[name])
                mutate(changed)
                write_json(evidence / name, changed)
                proof_path = evidence / 'native-song-authoring-files.json'
                proof = native.read_json(proof_path)
                reports = {}
                for filename in native.SONG_AUTHORING_REPORTS:
                    data = (evidence / filename).read_bytes()
                    reports[filename] = native.sha(data)
                    for row in proof['files']:
                        if row['path'] == filename:
                            row.update(sha256=native.sha(data), bytes=len(data))
                write_json(proof_path, proof)
                manifest_path = evidence / 'song-authoring-manifest.json'
                manifest = {**native.read_json(manifest_path),
                            'native_song_authoring_reports_sha256': reports,
                            'native_song_authoring_proof_sha256': native.sha(proof_path.read_bytes())}
                write_json(manifest_path, manifest)
                acceptance = {**metadata['acceptance'],
                              **native.song_authoring_acceptance_fields(manifest, manifest_path.read_bytes())}
                rebound = {**metadata, 'acceptance': acceptance}
                # Rehash reports, proof, focused manifest and BUILD-INFO together:
                # semantic host/profile validation must still reject the package.
                self.rewrite_package_inventory(directory, {**original, 'acceptance': acceptance})
                with self.subTest(archive=name, mutation=label), self.assertRaisesRegex(ValueError, 'Native profile'):
                    native.create_archive(directory, root / 'rehashed-invalid-authoring-profile.zip')
                with self.subTest(create=name, mutation=label), self.assertRaisesRegex(ValueError, 'Native profile'):
                    native.create_manifest(directory, rebound)

    def test_performance_proof_binds_source_tree_executable_size_and_all_packaged_reports(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            exe = root / native.EXE
            exe.write_bytes(executable())
            directory = self.performance_song_evidence(root, exe)
            result = subprocess.CompletedProcess([], 0, '', '')
            with patch.object(native.subprocess, 'run', return_value=result) as verify:
                outcome = native.accepted_performance_song_evidence(directory, exe, 'b' * 40, 'c' * 40)
                self.assertEqual(verify.call_args.args[0], [
                    'node', str(ROOT / 'scripts/verify-native-performance-song-evidence.mjs'), '--check', str(directory)])
                self.assertEqual(verify.call_args.kwargs['encoding'], 'utf-8')
                self.assertTrue(outcome['native_performance_song_validated'])
                self.assertEqual(outcome['native_performance_song_proof_sha256'],
                                 native.sha((directory / 'native-performance-song-files.json').read_bytes()))
                self.assertFalse(outcome['native_performance_song_claims']['actual_audibility'])
                self.assertFalse(outcome['native_performance_song_claims']['practice_targets'])
                for name, digest in outcome['native_performance_song_reports_sha256'].items():
                    self.assertEqual(digest, native.sha((directory / name).read_bytes()))
            for name in ['native-performance-song.json', 'native-performance-song-files.json']:
                path = directory / name
                original = native.read_json(path)
                for field, value in [('source_sha', 'd' * 40), ('source_tree', 'e' * 40),
                                     ('executable_sha256', 'f' * 64), ('executable_bytes', 101),
                                     ('executable_bytes', True), ('ok', False)]:
                    write_json(path, {**original, field: value})
                    with self.subTest(file=name, field=field, value=value), \
                            self.assertRaisesRegex(ValueError, 'exact source/tree/executable bytes'):
                        native.accepted_performance_song_evidence(directory, exe, 'b' * 40, 'c' * 40)
                write_json(path, original)
            exe.write_bytes(executable() + b'changed')
            with self.assertRaisesRegex(ValueError, 'exact source/tree/executable bytes'):
                native.accepted_performance_song_evidence(directory, exe, 'b' * 40, 'c' * 40)

    def test_performance_gate_rejects_fabricated_proof_scope_and_changed_renderer_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            exe = root / native.EXE
            exe.write_bytes(executable())
            directory = self.performance_song_evidence(root, exe)
            with self.assertRaisesRegex(ValueError, 'failed independent verification'):
                native.accepted_performance_song_evidence(directory, exe, 'b' * 40, 'c' * 40)
            proof_path = directory / 'native-performance-song-files.json'
            original = native.read_json(proof_path)
            for key in native.PERFORMANCE_SONG_CLAIMS:
                write_json(proof_path, {**original, 'claims': {**original['claims'], key: not original['claims'][key]}})
                with self.subTest(claim=key), self.assertRaisesRegex(ValueError, 'acceptance scope'):
                    native.accepted_performance_song_evidence(directory, exe, 'b' * 40, 'c' * 40)
                missing = {name: value for name, value in original['claims'].items() if name != key}
                write_json(proof_path, {**original, 'claims': missing})
                with self.subTest(missing_claim=key), self.assertRaisesRegex(ValueError, 'acceptance scope'):
                    native.accepted_performance_song_evidence(directory, exe, 'b' * 40, 'c' * 40)
            for value in [True, False]:
                write_json(proof_path, {**original, 'claims': {**original['claims'], 'unknown_claim': value}})
                with self.subTest(unknown_claim=value), self.assertRaisesRegex(ValueError, 'acceptance scope'):
                    native.accepted_performance_song_evidence(directory, exe, 'b' * 40, 'c' * 40)
            for key in ['named_route_disclosure_both_locales', 'centered_rpn12_exact_events',
                        'unsupported_bank_blocked_before_audio']:
                for value in [1, 'true', None]:
                    write_json(proof_path, {**original, 'claims': {**original['claims'], key: value}})
                    with self.subTest(claim=key, malformed=value), self.assertRaisesRegex(ValueError, 'acceptance scope'):
                        native.accepted_performance_song_evidence(directory, exe, 'b' * 40, 'c' * 40)
            write_json(proof_path, original)
            for phase in native.PERFORMANCE_SONG_PHASES:
                path = directory / f'renderer-{phase}.json'
                data = path.read_bytes()
                path.write_bytes(data + b' ')
                with patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')), \
                        self.subTest(phase=phase), self.assertRaisesRegex(ValueError, 'bind every exact packaged report'):
                    native.accepted_performance_song_evidence(directory, exe, 'b' * 40, 'c' * 40)
                path.write_bytes(data)

    def test_native_manifest_requires_every_song_folder_performance_pitch_and_authoring_evidence_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / native.FOLDER
            metadata = self.package(directory)
            for name in [*native.SONG_FOLDER_EVIDENCE, *native.PERFORMANCE_SONG_EVIDENCE, *native.PITCH_BEND_EVIDENCE, *native.SONG_AUTHORING_EVIDENCE]:
                path = directory / 'evidence' / name
                data = path.read_bytes()
                path.unlink()
                with self.subTest(missing=name), self.assertRaisesRegex(ValueError, 'Native package is missing evidence/' + name):
                    native.create_manifest(directory, metadata)
                path.write_bytes(data)

    def test_create_cli_requires_separate_song_folder_acceptance(self):
        arguments = ['native-release-manifest', 'create', 'unused', '--commit', 'b' * 40,
                     '--count', '169', '--startup', 'startup', '--acceptance', 'acceptance']
        with patch('sys.argv', arguments), contextlib.redirect_stderr(io.StringIO()) as error, self.assertRaises(SystemExit) as failure:
            native.main()
        self.assertEqual(failure.exception.code, 2)
        self.assertIn('--song-folder', error.getvalue())

    def test_create_cli_requires_separate_performance_acceptance(self):
        arguments = ['native-release-manifest', 'create', 'unused', '--commit', 'b' * 40,
                     '--count', '169', '--startup', 'startup', '--acceptance', 'acceptance', '--song-folder', 'folder']
        with patch('sys.argv', arguments), contextlib.redirect_stderr(io.StringIO()) as error, self.assertRaises(SystemExit) as failure:
            native.main()
        self.assertEqual(failure.exception.code, 2)
        self.assertIn('--performance-song', error.getvalue())

    def test_create_cli_requires_separate_pitch_bend_acceptance(self):
        arguments = ['native-release-manifest', 'create', 'unused', '--commit', 'b' * 40,
                     '--count', '169', '--startup', 'startup', '--acceptance', 'acceptance',
                     '--song-folder', 'folder', '--performance-song', 'performance']
        with patch('sys.argv', arguments), contextlib.redirect_stderr(io.StringIO()) as error, self.assertRaises(SystemExit) as failure:
            native.main()
        self.assertEqual(failure.exception.code, 2)
        self.assertIn('--pitch-bend', error.getvalue())

    def test_create_cli_requires_separate_song_authoring_acceptance(self):
        arguments = ['native-release-manifest', 'create', 'unused', '--commit', 'b' * 40,
                     '--count', '169', '--startup', 'startup', '--acceptance', 'acceptance',
                     '--song-folder', 'folder', '--performance-song', 'performance', '--pitch-bend', 'pitch']
        with patch('sys.argv', arguments), contextlib.redirect_stderr(io.StringIO()) as error, self.assertRaises(SystemExit) as failure:
            native.main()
        self.assertEqual(failure.exception.code, 2)
        self.assertIn('--song-authoring', error.getvalue())

    def test_create_does_not_copy_folder_evidence_or_write_inventory_after_gate_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / native.FOLDER
            metadata = {**self.package(directory), 'git_tree': 'c' * 40}
            startup, acceptance, _ = self.evidence(root)
            song_folder = self.song_folder_evidence(root, directory / native.EXE)
            before = {name: (directory / 'evidence' / name).read_bytes() for name in native.SONG_FOLDER_EVIDENCE}
            real_run = native.subprocess.run
            def verify_evidence(args, **kwargs):
                if len(args) > 1 and Path(args[1]).name == 'verify-native-song-folder-evidence.mjs':
                    return subprocess.CompletedProcess(args, 1, '', 'folder file was altered')
                return real_run(args, **kwargs)
            arguments = ['native-release-manifest', 'create', str(directory), '--commit', 'b' * 40,
                         '--count', '164', '--startup', str(startup), '--acceptance', str(acceptance),
                         '--song-folder', str(song_folder), '--performance-song', str(root / 'unused-performance'),
                         '--pitch-bend', str(root / 'unused-pitch'), '--song-authoring', 'unused-authoring']
            with patch('sys.argv', arguments), patch.object(native, 'source_metadata', return_value=metadata), \
                    patch.object(native.subprocess, 'run', side_effect=verify_evidence), \
                    self.assertRaisesRegex(ValueError, 'folder file was altered'):
                native.main()
            self.assertFalse((directory / native.INFO).exists())
            self.assertFalse((directory / native.SUMS).exists())
            self.assertEqual(before, {name: (directory / 'evidence' / name).read_bytes() for name in native.SONG_FOLDER_EVIDENCE})

    def test_create_does_not_copy_any_evidence_or_write_inventory_after_performance_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / native.FOLDER
            metadata = {**self.package(directory), 'git_tree': 'c' * 40}
            performance_song = self.performance_song_evidence(root, directory / native.EXE)
            before = {path.name: path.read_bytes() for path in (directory / 'evidence').iterdir()}
            arguments = ['native-release-manifest', 'create', str(directory), '--commit', 'b' * 40,
                         '--count', '164', '--startup', 'unused-startup', '--acceptance', 'unused-acceptance',
                         '--song-folder', 'unused-folder', '--performance-song', str(performance_song),
                         '--pitch-bend', str(root / 'unused-pitch'), '--song-authoring', 'unused-authoring']
            with patch('sys.argv', arguments), patch.object(native, 'source_metadata', return_value=metadata), \
                    patch.object(native, 'accepted_evidence', return_value={}), \
                    patch.object(native, 'accepted_song_folder_evidence', return_value={}), \
                    patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'actual proof failed')), \
                    self.assertRaisesRegex(ValueError, 'actual proof failed'):
                native.main()
            self.assertFalse((directory / native.INFO).exists())
            self.assertFalse((directory / native.SUMS).exists())
            self.assertEqual(before, {path.name: path.read_bytes() for path in (directory / 'evidence').iterdir()})

    def test_distinct_native_zip_preserves_inventory_and_detects_altered_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / native.FOLDER
            metadata = self.package(directory)
            info = native.create_manifest(directory, metadata)
            archive = root / 'native.zip'
            native.create_archive(directory, archive)
            self.assertEqual(native.verify_archive(archive)['commit_count'], 164)
            self.assertTrue(archive.with_suffix('.zip.sha256').is_file())
            with zipfile.ZipFile(archive) as package:
                sums = package.read(f'{native.FOLDER}/{native.SUMS}').decode('utf-8').splitlines()
                for name in SCHEMAS:
                    data = (ROOT / name).read_bytes()
                    digest = native.sha(data)
                    self.assertEqual(info['files'][name], {'sha256': digest, 'bytes': len(data)})
                    self.assertEqual(package.read(f'{native.FOLDER}/{name}'), data)
                    self.assertIn(f'{digest}  {name}', sums)
            (directory / native.EXE).write_bytes(executable() + b'changed')
            with self.assertRaisesRegex(ValueError, 'checksum differs'):
                native.create_archive(directory, archive)

    def test_native_package_requires_both_score_schemas_before_writing_inventory(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / native.FOLDER
            metadata = self.package(directory)
            for name in SCHEMAS:
                path = directory / name
                data = path.read_bytes()
                path.unlink()
                with self.subTest(missing=name), self.assertRaisesRegex(ValueError, 'Native package is missing ' + name):
                    native.create_manifest(directory, metadata)
                self.assertFalse((directory / native.INFO).exists())
                self.assertFalse((directory / native.SUMS).exists())
                path.write_bytes(data)

    def test_archived_native_vsq_schema_tampering_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / native.FOLDER
            metadata = self.package(directory)
            native.create_manifest(directory, metadata)
            name = 'schemas/vsq-complete-score-v1.schema.json'
            path = directory / name
            path.write_bytes(path.read_bytes() + b'\n')
            with self.assertRaisesRegex(ValueError, 'Native ZIP checksum differs: ' + name):
                native.create_archive(directory, root / 'changed-schema.zip')

    def test_native_archive_cannot_omit_required_schema_performance_pitch_or_authoring_evidence_with_rewritten_checksums(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / native.FOLDER
            metadata = self.package(directory)
            original = native.create_manifest(directory, metadata)
            for name in [*SCHEMAS, *[f'evidence/{item}' for item in [
                    *native.SONG_FOLDER_EVIDENCE, *native.PERFORMANCE_SONG_EVIDENCE,
                    *native.PITCH_BEND_EVIDENCE, *native.SONG_AUTHORING_EVIDENCE]]]:
                path = directory / name
                data = path.read_bytes()
                path.unlink()
                files = {key: value for key, value in original['files'].items() if key != name}
                info = {**original, 'file_count': len(files), 'files': files}
                write_json(directory / native.INFO, info)
                sums = {key: value['sha256'] for key, value in files.items()}
                sums[native.INFO] = native.sha((directory / native.INFO).read_bytes())
                (directory / native.SUMS).write_text(''.join(f'{sums[key]}  {key}\n' for key in sorted(sums)),
                                                     encoding='utf-8', newline='\n')
                with self.subTest(missing=name), self.assertRaisesRegex(ValueError, 'Native package is missing ' + name):
                    native.create_archive(directory, root / 'omitted-schema.zip')
                path.write_bytes(data)

    def test_browser_executable_or_missing_mpl_source_cannot_be_packaged(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / native.FOLDER
            metadata = self.package(directory)
            (directory / 'WorldMusicHub.exe').write_bytes(executable())
            with self.assertRaisesRegex(ValueError, 'Browser EXE'):
                native.create_manifest(directory, metadata)
            (directory / 'WorldMusicHub.exe').unlink()
            (directory / 'licenses/rust/sources/example.crate').write_bytes(b'wrong')
            with self.assertRaisesRegex(ValueError, 'MPL source archive differs'):
                native.create_manifest(directory, metadata)

    def test_catalog_originals_and_rights_must_still_match(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / native.FOLDER
            metadata = self.package(directory)
            shutil.copytree(ROOT / 'catalog', directory / 'catalog', dirs_exist_ok=True)
            self.assertTrue(native.create_manifest(directory, metadata)['curated_editions'])
            edition = native.read_json(directory / 'catalog/index.json')['editions'][0]
            (directory / 'catalog' / edition['directory'] / 'LICENSE-CC0.txt').write_text('changed')
            with self.assertRaisesRegex(ValueError, 'Catalog source/license mismatch'):
                native.create_manifest(directory, metadata)

    def test_native_acceptance_is_bound_to_source_tree_binary_and_all_phases(self):
        with tempfile.TemporaryDirectory() as temporary:
            args = self.evidence(Path(temporary))
            outcome = native.accepted_evidence(*args, 'b' * 40, 'c' * 40)
            self.assertFalse(outcome['physical_midi_validated'])
            self.assertEqual(outcome['ordinary_midi_api']['outcome'], 'denied-or-unavailable')
            for commit, tree in [('d' * 40, 'c' * 40), ('b' * 40, 'd' * 40)]:
                with self.assertRaisesRegex(ValueError, 'exact source/tree/executable'):
                    native.accepted_evidence(*args, commit, tree)
            path = args[1] / 'native-acceptance.json'
            value = native.read_json(path)
            value['phases'].pop()
            write_json(path, value)
            with self.assertRaisesRegex(ValueError, 'four native phases'):
                native.accepted_evidence(*args, 'b' * 40, 'c' * 40)

    def test_incomplete_close_or_changed_actual_download_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            args = self.evidence(Path(temporary))
            path = args[1] / 'native-acceptance.json'
            value = native.read_json(path)
            value['phases'][0]['normal_close'] = False
            write_json(path, value)
            with self.assertRaisesRegex(ValueError, 'Every native phase'):
                native.accepted_evidence(*args, 'b' * 40, 'c' * 40)
            value['phases'][0]['normal_close'] = True
            write_json(path, value)
            (args[1] / 'downloads/seed-1.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'downloaded file changed'):
                native.accepted_evidence(*args, 'b' * 40, 'c' * 40)

    def test_reference_proof_is_required_and_bound_to_actual_renderer_and_downloads(self):
        with tempfile.TemporaryDirectory() as temporary:
            args = self.evidence(Path(temporary))
            proof_path = args[1] / 'native-reference-files.json'
            proof = native.read_json(proof_path)
            outcome = native.accepted_evidence(*args, 'b' * 40, 'c' * 40)
            self.assertTrue(outcome['complete_midi_reference_validated'])
            self.assertEqual(outcome['native_reference_proof_sha256'], native.sha(proof_path.read_bytes()))
            changed = {**proof, 'renderer_seed_sha256': '0' * 64}
            write_json(proof_path, changed)
            with self.assertRaisesRegex(ValueError, 'exact seed renderer'):
                native.accepted_evidence(*args, 'b' * 40, 'c' * 40)
            write_json(proof_path, {**proof, 'onset_count': 7})
            with self.assertRaisesRegex(ValueError, 'source counts differ'):
                native.accepted_evidence(*args, 'b' * 40, 'c' * 40)
            write_json(proof_path, proof)
            (args[1] / 'downloads/seed-5.json').write_bytes(b'changed original')
            with self.assertRaisesRegex(ValueError, 'reference download changed'):
                native.accepted_evidence(*args, 'b' * 40, 'c' * 40)
            proof_path.unlink()
            with self.assertRaises(FileNotFoundError):
                native.accepted_evidence(*args, 'b' * 40, 'c' * 40)

    def test_source_metadata_rejects_shallow_dirty_wrong_count_and_wrong_host(self):
        outputs = {('git', 'rev-parse', '--is-shallow-repository'): 'false', ('git', 'rev-parse', 'HEAD'): 'b' * 40,
                   ('git', 'rev-list', '--count', 'HEAD'): '164', ('git', 'status', '--porcelain', '--untracked-files=all'): '',
                   ('rustc', '-vV'): 'host: x86_64-pc-windows-msvc'}
        for command, replacement, message in [
            (('git', 'rev-parse', '--is-shallow-repository'), 'true', 'Complete history'),
            (('git', 'rev-list', '--count', 'HEAD'), '163', 'source/count mismatch'),
            (('git', 'status', '--porcelain', '--untracked-files=all'), ' M file', 'clean source'),
            (('rustc', '-vV'), 'host: x86_64-unknown-linux-gnu', 'MSVC toolchain')]:
            answers = {**outputs, command: replacement}
            with self.subTest(command=command), patch.object(native.platform, 'system', return_value='Windows'), patch.object(native.subprocess, 'check_output', side_effect=lambda args, **kw: answers[args]), self.assertRaisesRegex(ValueError, message):
                native.source_metadata('b' * 40, 164)

    def test_complete_native_package_uses_utf8_with_a_cp1252_host_default(self):
        # Host/tool observations and folder/performance/pitch/authoring verifiers are synthetic.
        # Source/catalog/license reads, reference verification, folder envelope
        # checks, hashing, JSON, ZIP and checksum operations remain real.
        commands = {('git', 'rev-parse', '--is-shallow-repository'): 'false',
                    ('git', 'rev-parse', 'HEAD'): 'b' * 40,
                    ('git', 'rev-list', '--count', 'HEAD'): '169',
                    ('git', 'status', '--porcelain', '--untracked-files=all'): '',
                    ('git', 'rev-parse', 'HEAD^{tree}'): 'c' * 40,
                    ('rustc', '-vV'): 'rustc fixture\nhost: x86_64-pc-windows-msvc',
                    ('cargo', '--version'): 'cargo fixture', ('node', '--version'): 'node fixture'}
        def command_output(args, **kwargs):
            self.assertEqual(kwargs.get('encoding'), 'utf-8')
            return commands[args]
        real_run = native.subprocess.run
        def verify_evidence(args, **kwargs):
            if len(args) > 1 and Path(args[1]).name == 'verify-native-song-folder-evidence.mjs':
                self.assertEqual(args[-1], '--check')
                self.assertEqual(kwargs.get('encoding'), 'utf-8')
                return subprocess.CompletedProcess(args, 0, '', '')
            if len(args) > 1 and Path(args[1]).name == 'verify-native-performance-song-evidence.mjs':
                self.assertEqual(args[-2], '--check')
                self.assertEqual(kwargs.get('encoding'), 'utf-8')
                return subprocess.CompletedProcess(args, 0, '', '')
            if len(args) > 1 and Path(args[1]).name == 'verify-native-pitch-bend-evidence.mjs':
                self.assertEqual(args[-2], '--check')
                self.assertEqual(kwargs.get('encoding'), 'utf-8')
                return subprocess.CompletedProcess(args, 0, '', '')
            if len(args) > 1 and Path(args[1]).name == 'verify-native-song-authoring-evidence.mjs':
                self.assertEqual(args[-2], '--check')
                self.assertEqual(kwargs.get('encoding'), 'utf-8')
                return subprocess.CompletedProcess(args, 0, '', '')
            return real_run(args, **kwargs)
        real_open = io.open
        def cp1252_open(file, mode='r', buffering=-1, encoding=None, errors=None,
                        newline=None, closefd=True, opener=None):
            if 'b' not in mode and encoding in [None, 'locale']:
                encoding = 'cp1252'
            return real_open(file, mode, buffering, encoding, errors, newline, closefd, opener)

        with tempfile.TemporaryDirectory(prefix='native package 拼谱 ') as temporary:
            root = Path(temporary)
            source = root / 'source 初学者'
            source.mkdir()
            # The combined package also rederives its native reference proof.
            # Keep that real verifier and its original fixture in the source
            # copy instead of mocking away the added package gate.
            for relative in ['Cargo.toml', 'Cargo.lock', 'package-lock.json', 'crates/score-core/src/lib.rs',
                             'package.json', 'scripts/verify-reference-native-evidence.mjs',
                             'tests/reference-listening-fixture.js', 'tests/fixtures/original-reference-overlap.mid']:
                destination = source / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / relative, destination)
            # Guarantee that both metadata inputs expose a cp1252 fallback, even
            # if future repository comments happen to become entirely ASCII.
            for relative, marker in [('Cargo.toml', '# 初学者\n'), ('crates/score-core/src/lib.rs', '// 初学者\n')]:
                path = source / relative
                path.write_bytes(marker.encode('utf-8') + path.read_bytes())
            cargo_hash = native.sha((source / 'Cargo.lock').read_bytes())
            npm_hash = native.sha((source / 'package-lock.json').read_bytes())
            expected_version = native.tomllib.loads((source / 'Cargo.toml').read_text(encoding='utf-8'))['workspace']['package']['version']
            expected_revision = int(native.re.search(r'pub const SCORE_SCHEMA_REVISION: u32 = (\d+);',
                                                    (source / 'crates/score-core/src/lib.rs').read_text(encoding='utf-8')).group(1))
            directory = root / 'portable output' / native.FOLDER
            self.package(directory)
            shutil.copytree(ROOT / 'catalog', directory / 'catalog', dirs_exist_ok=True)
            notices_path = directory / 'licenses/rust/manifest.json'
            notices = native.read_json(notices_path)
            notices['cargo_lock_sha256'] = cargo_hash
            write_json(notices_path, notices)
            startup, acceptance, _ = self.evidence(root)
            song_folder = self.song_folder_evidence(root, directory / native.EXE)
            performance_song = self.performance_song_evidence(root, directory / native.EXE)
            pitch_bend = self.pitch_bend_evidence(root, directory / native.EXE)
            song_authoring = self.song_authoring_evidence(root, directory / native.EXE)
            for path in startup.glob('*.json'):
                shutil.copyfile(path, directory / 'evidence' / path.name)
            for path in acceptance.glob('*.json'):
                shutil.copyfile(path, directory / 'evidence' / path.name)
            unicode_name = 'docs/初学者说明.txt'
            unicode_bytes = '原始乐谱说明\r\n'.encode('utf-8')
            (directory / 'docs').mkdir()
            (directory / unicode_name).write_bytes(unicode_bytes)
            archive = root / '原生预览.zip'
            with patch.object(native, 'ROOT', source), \
                    patch.object(native.platform, 'system', return_value='Windows'), \
                    patch.object(native.platform, 'platform', return_value='Windows-test-fixture'), \
                    patch.object(native.subprocess, 'check_output', side_effect=command_output), \
                    patch.object(native.subprocess, 'run', side_effect=verify_evidence), \
                    patch.dict(native.os.environ, {'RUSTFLAGS': '-C target-feature=+crt-static', 'GITHUB_RUN_ID': '123456'}), \
                    patch.object(io, 'open', side_effect=cp1252_open):
                for relative in ['Cargo.toml', 'crates/score-core/src/lib.rs']:
                    with self.subTest(relative=relative), self.assertRaises(UnicodeDecodeError):
                        (source / relative).read_text()
                metadata = native.source_metadata('b' * 40, 169)
                self.assertEqual(metadata, {
                    'name': native.FOLDER, 'executable': native.EXE, 'git_commit': 'b' * 40,
                    'git_tree': 'c' * 40, 'commit_count': 169, 'release_label': 'commit-169',
                    'target': 'x86_64-pc-windows-msvc', 'app_version': expected_version,
                    'score_schema_revision': expected_revision, 'rustc_verbose': commands[('rustc', '-vV')],
                    'cargo': 'cargo fixture', 'node': 'node fixture', 'build_platform': 'Windows-test-fixture',
                    'rustflags': '-C target-feature=+crt-static', 'cargo_lock_sha256': cargo_hash,
                    'npm_lock_sha256': npm_hash,
                    'distribution': 'unsigned native portable candidate; installed Microsoft WebView2 Runtime required',
                    'acceptance_scope': 'native-windows-only', 'acceptance_workflow_run_id': '123456',
                    'checkpoint_requirements': [
                        'Native Windows feature acceptance / acceptance-summary for this source and workflow run',
                        'Verify WorldMusicHub for this source'],
                    'runtime_bundled': False, 'installer': False, 'http_server_process': False})
                for arguments in [
                    ['create', str(directory), '--commit', 'b' * 40, '--count', '169',
                     '--startup', str(startup), '--acceptance', str(acceptance), '--song-folder', str(song_folder),
                     '--performance-song', str(performance_song), '--pitch-bend', str(pitch_bend),
                     '--song-authoring', str(song_authoring)],
                    ['archive', str(directory), str(archive)], ['verify', str(archive)]]:
                    with patch('sys.argv', ['native-release-manifest', *arguments]), contextlib.redirect_stdout(io.StringIO()):
                        native.main()
                info = native.verify_archive(archive)
                self.assertTrue(info['curated_editions'])
                self.assertEqual(info['app_version'], expected_version)
                self.assertEqual(info['score_schema_revision'], expected_revision)
                self.assertEqual(info['cargo_lock_sha256'], cargo_hash)
                self.assertEqual(info['npm_lock_sha256'], npm_hash)
                self.assertEqual(info['acceptance_scope'], 'native-windows-only')
                self.assertEqual(info['acceptance_workflow_run_id'], '123456')
                self.assertEqual(info['checkpoint_requirements'], metadata['checkpoint_requirements'])
                self.assertFalse(info['acceptance']['physical_midi_validated'])
                self.assertTrue(info['acceptance']['complete_midi_reference_validated'])
                self.assertTrue(info['acceptance']['native_song_folder_validated'])
                self.assertTrue(info['acceptance']['native_performance_song_validated'])
                self.assertTrue(info['acceptance']['native_pitch_bend_validated'])
                self.assertFalse(info['acceptance']['native_pitch_bend_full_checkpoint_acceptance'])
                self.assertFalse(info['acceptance']['native_pitch_bend_release_ready'])
                self.assertNotIn('full_checkpoint_acceptance', info['acceptance'])
                self.assertNotIn('release_ready', info['acceptance'])
                self.assertEqual(info['acceptance']['native_pitch_bend_claims'], native.PITCH_BEND_CLAIMS)
                self.assertEqual(info['acceptance']['native_pitch_bend_manifest_sha256'],
                                 native.sha((pitch_bend / 'pitch-bend-manifest.json').read_bytes()))
                self.assertTrue(info['acceptance']['native_song_authoring_validated'])
                self.assertFalse(info['acceptance']['native_song_authoring_full_checkpoint_acceptance'])
                self.assertFalse(info['acceptance']['native_song_authoring_release_ready'])
                self.assertEqual(info['acceptance']['native_song_authoring_claims'], native.SONG_AUTHORING_CLAIMS)
                self.assertEqual(info['acceptance']['native_song_authoring_manifest_sha256'],
                                 native.sha((song_authoring / 'song-authoring-manifest.json').read_bytes()))
                self.assertFalse(info['acceptance']['native_performance_song_claims']['actual_audibility'])
                self.assertFalse(info['acceptance']['native_performance_song_claims']['validated_notation'])
                self.assertEqual(info['acceptance']['native_performance_song_proof_sha256'],
                                 native.sha((performance_song / 'native-performance-song-files.json').read_bytes()))
                self.assertEqual(info['acceptance']['native_song_folder_proof_sha256'],
                                 native.sha((song_folder / 'native-song-folder-files.json').read_bytes()))
                for name in native.SONG_FOLDER_EVIDENCE:
                    data = (song_folder / name).read_bytes()
                    self.assertEqual((directory / 'evidence' / name).read_bytes(), data)
                    self.assertEqual(info['files']['evidence/' + name], {'sha256': native.sha(data), 'bytes': len(data)})
                for name in native.PERFORMANCE_SONG_EVIDENCE:
                    data = (performance_song / name).read_bytes()
                    self.assertEqual((directory / 'evidence' / name).read_bytes(), data)
                    self.assertEqual(info['files']['evidence/' + name], {'sha256': native.sha(data), 'bytes': len(data)})
                for name in native.PITCH_BEND_EVIDENCE:
                    data = (pitch_bend / name).read_bytes()
                    self.assertEqual((directory / 'evidence' / name).read_bytes(), data)
                    self.assertEqual(info['files']['evidence/' + name], {'sha256': native.sha(data), 'bytes': len(data)})
                for name in native.SONG_AUTHORING_EVIDENCE:
                    data = (song_authoring / name).read_bytes()
                    self.assertEqual((directory / 'evidence' / name).read_bytes(), data)
                    self.assertEqual(info['files']['evidence/' + name], {'sha256': native.sha(data), 'bytes': len(data)})
                self.assertEqual(info['files'][unicode_name], {'sha256': native.sha(unicode_bytes), 'bytes': len(unicode_bytes)})
                with zipfile.ZipFile(archive) as package:
                    self.assertEqual(package.read(f'{native.FOLDER}/{unicode_name}'), unicode_bytes)
                    self.assertTrue(all('\\' not in name for name in package.namelist()))
                self.assertEqual(archive.with_suffix('.zip.sha256').read_text(encoding='utf-8'),
                                 f'{native.sha(archive.read_bytes())}  {archive.name}\n')

    @unittest.skipUnless(native.platform.system() == 'Windows', 'Requires actual Windows Git and MSVC toolchain')
    def test_windows_source_metadata_uses_real_git_and_installed_tools(self):
        # This verifies the Windows metadata path, not application acceptance.
        with tempfile.TemporaryDirectory(prefix='native source 拼谱 ') as temporary:
            source = Path(temporary)
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=source, text=True, encoding='utf-8').rstrip('\r\n')
            git('init', '--quiet')
            excludes = source / '.git' / 'empty-global-excludes'
            excludes.write_text('', encoding='utf-8')
            git('config', 'core.excludesFile', str(excludes))
            git('config', 'core.autocrlf', 'false')
            git('config', 'core.hooksPath', str(source / 'unused-hooks'))
            for relative in ['Cargo.toml', 'Cargo.lock', 'package-lock.json', 'crates/score-core/src/lib.rs']:
                path = source / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / relative, path)
            for relative, marker in [('Cargo.toml', '# 初学者\n'), ('crates/score-core/src/lib.rs', '// 初学者\n')]:
                path = source / relative
                path.write_bytes(marker.encode('utf-8') + path.read_bytes())
            git('add', '.')
            git('-c', 'user.name=Native packaging test', '-c', 'user.email=native-test@example.invalid',
                '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--no-verify', '-m', 'Synthetic source fixture')
            commit, tree = git('rev-parse', 'HEAD'), git('rev-parse', 'HEAD^{tree}')
            with patch.object(native, 'ROOT', source):
                metadata = native.source_metadata(commit, 1)
            self.assertEqual(metadata['git_commit'], commit)
            self.assertEqual(metadata['git_tree'], tree)
            self.assertEqual(metadata['commit_count'], 1)
            self.assertIn('host: x86_64-pc-windows-msvc', metadata['rustc_verbose'].splitlines())
            self.assertEqual(metadata['cargo_lock_sha256'], native.sha((source / 'Cargo.lock').read_bytes()))
            self.assertEqual(metadata['npm_lock_sha256'], native.sha((source / 'package-lock.json').read_bytes()))
            self.assertEqual(git('status', '--porcelain', '--untracked-files=all'), '')

    def test_generated_windows_build_inventory_keeps_real_source_gate_strict(self):
        # Real Git semantics, isolated from the checkout and any global excludes.
        # These are the files emitted by the locked tauri-build/tauri-utils pair.
        generated = ['acl-manifests.json', 'capabilities.json', 'desktop-schema.json', 'windows-schema.json']
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def git(*args):
                return subprocess.check_output(
                    ['git', *args],
                    cwd=root, text=True).rstrip('\r\n')
            git('init', '--quiet')
            # Git for Windows rejects the NUL device as an excludes file.
            # A real empty file keeps the same isolation on every host.
            excludes = root / '.git' / 'empty-global-excludes'
            excludes.write_text('', encoding='utf-8')
            git('config', 'core.excludesFile', str(excludes))
            git('config', 'core.autocrlf', 'false')
            git('config', 'core.hooksPath', str(root / 'unused-hooks'))
            shutil.copyfile(ROOT / '.gitignore', root / '.gitignore')
            config = root / 'crates/desktop-shell/tauri.conf.json'
            write_json(config, {'app': {'security': {'capabilities': []}}})
            git('add', '.gitignore', 'crates/desktop-shell/tauri.conf.json')
            git('-c', 'user.name=Native packaging test', '-c', 'user.email=native-test@example.invalid',
                '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--no-verify', '-m', 'Synthetic source fixture')
            commit = git('rev-parse', 'HEAD')
            for name in generated:
                write_json(root / 'crates/desktop-shell/gen/schemas' / name, {})
            self.assertEqual(git('status', '--porcelain', '--untracked-files=all'), '')
            with patch.object(native, 'ROOT', root), patch.object(native.platform, 'system', return_value='Linux'):
                # Reaching the host guard proves real Git passed the source guard;
                # this synthetic test must never claim actual Windows acceptance.
                with self.assertRaisesRegex(ValueError, 'actual Windows acceptance'):
                    native.source_metadata(commit, 1)
                for relative in ['crates/desktop-shell/gen/schemas/unexpected.json',
                                 'crates/desktop-shell/capabilities/new.json']:
                    path = root / relative
                    write_json(path, {})
                    with self.subTest(path=relative), self.assertRaises(ValueError) as failure:
                        native.source_metadata(commit, 1)
                    self.assertIn('clean source', str(failure.exception))
                    self.assertIn(f'?? {relative}', str(failure.exception))
                    path.unlink()
                write_json(config, {'changed': True})
                with self.assertRaises(ValueError) as failure:
                    native.source_metadata(commit, 1)
                self.assertIn('\n M crates/desktop-shell/tauri.conf.json', str(failure.exception))
                git('add', 'crates/desktop-shell/tauri.conf.json')
                with self.assertRaises(ValueError) as failure:
                    native.source_metadata(commit, 1)
                self.assertIn('\nM  crates/desktop-shell/tauri.conf.json', str(failure.exception))


if __name__ == '__main__':
    unittest.main()
