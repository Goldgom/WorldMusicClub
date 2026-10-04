"""Synthetic provenance tests; these never establish native VSQ acceptance."""
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('native_vsq_authoring', ROOT / 'scripts/native-vsq-authoring-manifest.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
COMMIT, TREE = 'b' * 40, 'c' * 40
PROOF = 'native-vsq-authoring-files.json'
REPORT = 'native-vsq-authoring.json'


def write_json(path, value):
    path.write_text(json.dumps(value), encoding='utf-8')


class NativeVsqAuthoringManifestTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.directory = self.root / 'VSQ authoring 拼谱'
        self.directory.mkdir()
        self.exe = self.root / 'WorldMusicHubNative.exe'
        self.exe.write_bytes(b'MZ synthetic executable bytes, never a native process')
        self.envelope = {'version': 1, 'ok': True, 'source_sha': COMMIT, 'source_tree': TREE,
                         'executable_sha256': native.sha(self.exe.read_bytes()),
                         'executable_bytes': self.exe.stat().st_size}
        self.report = {**self.envelope, 'scenario': 'vsq-authoring',
                       'directory': str(self.directory / 'Scores'), 'phases': []}
        for index, phase in enumerate(native.VSQ_AUTHORING_PHASES):
            row = {'phase': phase, 'process_id': 100 + index,
                   'profile_directory': str(self.directory / 'webview-profiles' / phase),
                   'profile_fresh': True, 'profile_reused': False, 'profile_absent_before_launch': True}
            self.report['phases'].append(row)
            write_json(self.directory / f'profile-{phase}.json', {
                'version': 1, 'phase': phase, 'process_id': row['process_id'],
                'profile_directory': row['profile_directory'], 'library_directory': self.report['directory'],
                'fresh_required': True, 'created_new': True})
            write_json(self.directory / f'renderer-{phase}.json', {'ok': True, 'phase': phase})
        write_json(self.directory / REPORT, self.report)
        self.proof = {**self.envelope, 'claims': dict(native.VSQ_AUTHORING_CLAIMS), 'files': []}
        for name in native.VSQ_AUTHORING_REPORTS:
            data = (self.directory / name).read_bytes()
            self.proof['files'].append({'path': name, 'sha256': native.sha(data), 'bytes': len(data)})
        write_json(self.directory / PROOF, self.proof)
        # The independent Node fixtures own picker/save/score semantics. This
        # fixture isolates only Python's source, profile and report bindings.
        child = patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', ''))
        self.verifier = child.start()
        self.addCleanup(child.stop)

    def accept(self, commit=COMMIT, tree=TREE, executable=None):
        return native.accepted_vsq_authoring_evidence(self.directory, executable or self.exe, commit, tree)

    def reject_json(self, name, value, message, rebind=False):
        path = self.directory / name
        original, original_proof = path.read_bytes(), (self.directory / PROOF).read_bytes()
        try:
            write_json(path, value)
            if rebind:
                proof = json.loads(original_proof)
                data = path.read_bytes()
                for row in proof['files']:
                    if row['path'] == name:
                        row.update(sha256=native.sha(data), bytes=len(data))
                write_json(self.directory / PROOF, proof)
            with self.assertRaisesRegex(ValueError, message):
                self.accept()
        finally:
            path.write_bytes(original)
            (self.directory / PROOF).write_bytes(original_proof)

    def test_manifest_binds_exact_original_evidence_with_focused_scope(self):
        manifest = self.accept()
        self.verifier.assert_called_once_with(
            ['node', str(ROOT / 'scripts/verify-native-vsq-authoring-evidence.mjs'), '--check', str(self.directory)],
            cwd=ROOT, capture_output=True, text=True, encoding='utf-8', timeout=30, check=False)
        self.assertEqual(native.VSQ_AUTHORING_PHASES, ['vsq-authoring-seed', 'vsq-authoring-restart'])
        self.assertEqual(native.VSQ_AUTHORING_REPORTS, [REPORT, 'renderer-vsq-authoring-seed.json',
                         'renderer-vsq-authoring-restart.json', 'profile-vsq-authoring-seed.json',
                         'profile-vsq-authoring-restart.json'])
        self.assertEqual(manifest, {
            'version': 1, 'scope': 'original-vsq-authoring-focused-evidence-only',
            'source_sha': COMMIT, 'source_tree': TREE,
            'executable_sha256': native.sha(self.exe.read_bytes()), 'executable_bytes': self.exe.stat().st_size,
            'full_checkpoint_acceptance': False, 'release_ready': False,
            'native_vsq_authoring_validated': True,
            'native_vsq_authoring_claims': native.VSQ_AUTHORING_CLAIMS,
            'native_vsq_authoring_proof_sha256': native.sha((self.directory / PROOF).read_bytes()),
            'native_vsq_authoring_reports_sha256': {
                name: native.sha((self.directory / name).read_bytes()) for name in native.VSQ_AUTHORING_REPORTS}})
        self.assertTrue(all(type(value) is bool for value in native.VSQ_AUTHORING_CLAIMS.values()))
        for key in ['actual_audibility', 'full_checkpoint_acceptance', 'release_ready']:
            self.assertIs(manifest['native_vsq_authoring_claims'][key], False)

    def test_cli_writes_only_the_focused_manifest(self):
        output = io.StringIO()
        args = ['native-vsq-authoring-manifest.py', str(self.directory), '--executable', str(self.exe),
                '--commit', COMMIT, '--tree', TREE]
        before = {path.name for path in self.directory.iterdir()}
        with patch('sys.argv', args), contextlib.redirect_stdout(output):
            native.main()
        destination = self.directory / 'vsq-authoring-manifest.json'
        self.assertEqual(json.loads(destination.read_text()), json.loads(output.getvalue()))
        self.assertEqual({path.name for path in self.directory.iterdir()} - before, {destination.name})
        self.assertIs(json.loads(destination.read_text())['release_ready'], False)

    def test_invalid_source_identifiers_are_rejected_before_node(self):
        for bad in [None, True, 1, '', 'b' * 39, 'b' * 41, 'B' * 40, 'g' * 40, COMMIT + '\n']:
            for commit, tree in [(bad, TREE), (COMMIT, bad)]:
                with self.subTest(commit=commit, tree=tree), self.assertRaisesRegex(ValueError, 'exact source commit'):
                    self.accept(commit, tree)
        self.verifier.assert_not_called()

    def test_envelopes_reject_malformed_objects_source_executable_and_numeric_booleans(self):
        mutations = [('source_sha', 'd' * 40), ('source_tree', 'e' * 40), ('executable_sha256', 'f' * 64),
                     ('executable_bytes', self.exe.stat().st_size + 1), ('executable_bytes', True),
                     ('executable_bytes', float(self.exe.stat().st_size)), ('executable_bytes', '52'),
                     ('version', 2), ('version', True), ('version', 1.0), ('version', '1'),
                     ('ok', False), ('ok', 1), ('ok', 'true')]
        for name in [PROOF, REPORT]:
            original = native.read_json(self.directory / name)
            for value in [None, [], [original], True, 'report']:
                with self.subTest(name=name, malformed=value):
                    self.reject_json(name, value, 'exact source, tree and executable')
            for key, value in mutations:
                with self.subTest(name=name, field=key, value=value):
                    self.reject_json(name, {**original, key: value}, 'exact source, tree and executable')
            for key in self.envelope:
                with self.subTest(name=name, missing=key):
                    self.reject_json(name, {k: v for k, v in original.items() if k != key},
                                     'exact source, tree and executable')
        self.verifier.assert_not_called()

    def test_every_claim_requires_its_exact_boolean_and_no_extra_or_missing_names(self):
        claims = self.proof['claims']
        mutations = [None, [], list(claims), True, 'claims', {}, {**claims, 'extra_claim': True},
                     {**claims, 'extra_claim': False}]
        for key, value in claims.items():
            mutations.append({name: item for name, item in claims.items() if name != key})
            mutations.extend({**claims, key: bad} for bad in [not value, int(value), str(value), None])
        for claims in mutations:
            with self.subTest(claims=claims):
                self.reject_json(PROOF, {**self.proof, 'claims': claims}, 'claim set or exact boolean scope')
        self.reject_json(PROOF, {k: v for k, v in self.proof.items() if k != 'claims'},
                         'claim set or exact boolean scope')
        self.verifier.assert_not_called()

    def test_executable_must_be_nonempty_ordinary_and_match_both_envelopes(self):
        for path in [self.root / 'missing.exe', self.directory]:
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, 'ordinary file'):
                self.accept(executable=path)
        self.exe.write_bytes(b'')
        with self.assertRaisesRegex(ValueError, 'cannot be empty'):
            self.accept()
        self.exe.write_bytes(b'MZ changed executable')
        with self.assertRaisesRegex(ValueError, 'exact source, tree and executable'):
            self.accept()
        self.verifier.assert_not_called()

    def test_all_reports_are_bound_once_with_exact_hashes_and_integer_lengths(self):
        files = self.proof['files']
        for name in native.VSQ_AUTHORING_REPORTS:
            original = next(row for row in files if row['path'] == name)
            remaining = [row for row in files if row['path'] != name]
            mutations = [remaining, [*files, original]]
            for field, value in [('sha256', '0' * 64), ('sha256', None), ('bytes', original['bytes'] + 1),
                                 ('bytes', True), ('bytes', float(original['bytes'])), ('bytes', str(original['bytes']))]:
                mutations.append([*remaining, {**original, field: value}])
            for changed in mutations:
                with self.subTest(report=name, files=changed):
                    self.reject_json(PROOF, {**self.proof, 'files': changed}, 'bind every exact original VSQ-authoring report')
        for files in [None, {}, 'files', [True], [None], [['native-vsq-authoring.json']]]:
            with self.subTest(files=files):
                self.reject_json(PROOF, {**self.proof, 'files': files}, 'original file inventory')
        self.reject_json(PROOF, {k: v for k, v in self.proof.items() if k != 'files'}, 'original file inventory')

    def test_changed_report_bytes_are_rejected_without_rebinding(self):
        for name in native.VSQ_AUTHORING_REPORTS:
            path = self.directory / name
            original = path.read_bytes()
            try:
                path.write_bytes(original + b'\n')
                with self.subTest(report=name), self.assertRaisesRegex(ValueError, 'bind every exact original VSQ-authoring report'):
                    self.accept()
            finally:
                path.write_bytes(original)

    def test_profiles_require_both_exact_ordered_phases(self):
        rows = self.report['phases']
        for phases in [None, {}, [], rows[:1], rows[::-1], [*rows, rows[0]], [rows[0], rows[0]],
                       [None, rows[1]], [rows[0], {**rows[1], 'phase': 'authoring-restart'}]]:
            with self.subTest(phases=phases):
                self.reject_json(REPORT, {**self.report, 'phases': phases}, 'exact and ordered', rebind=True)
        self.verifier.assert_not_called()

    def test_profiles_reject_reuse_process_aliases_and_non_boolean_freshness_after_rehashing(self):
        for index, row in enumerate(self.report['phases']):
            other = self.report['phases'][1 - index]
            mutations = [('profile_fresh', False), ('profile_fresh', 1), ('profile_reused', True),
                         ('profile_reused', 0), ('profile_absent_before_launch', False),
                         ('profile_absent_before_launch', 1), ('process_id', other['process_id']),
                         ('process_id', True), ('process_id', 0), ('process_id', -1),
                         ('process_id', 9007199254740992), ('process_id', float(row['process_id'])),
                         ('profile_directory', other['profile_directory']), ('profile_directory', '../shared-profile'),
                         ('profile_directory', row['profile_directory'] + '/child'),
                         ('profile_directory', row['profile_directory'] + '/'),
                         ('profile_directory', row['profile_directory'] + '/../' + row['phase']),
                         ('profile_directory', row['profile_directory'] + '/./' + row['phase'])]
            for field, value in mutations:
                changed = copy.deepcopy(self.report)
                changed['phases'][index][field] = value
                with self.subTest(phase=row['phase'], field=field, value=value):
                    self.reject_json(REPORT, changed, 'Native profile', rebind=True)
            for field in row:
                changed = copy.deepcopy(self.report)
                del changed['phases'][index][field]
                with self.subTest(phase=row['phase'], missing=field):
                    self.reject_json(REPORT, changed, 'Native profile', rebind=True)
        for directory in [None, 'Scores', '/tmp/other/Scores', '/tmp/Other', '/tmp/../Scores',
                          '/tmp/./Scores', '/tmp//Scores', '//server/Scores', '/tmp/Scores/', '/tmp/\nScores']:
            with self.subTest(directory=directory):
                self.reject_json(REPORT, {**self.report, 'directory': directory}, 'Native profile', rebind=True)
        self.verifier.assert_not_called()

    def test_each_host_record_must_prove_matching_fresh_atomic_creation_after_rehashing(self):
        for row in self.report['phases']:
            name = f"profile-{row['phase']}.json"
            original = native.read_json(self.directory / name)
            mutations = [('version', True), ('version', 2), ('phase', 'authoring-seed'),
                         ('process_id', True), ('process_id', row['process_id'] + 100),
                         ('process_id', float(row['process_id'])),
                         ('profile_directory', row['profile_directory'] + '/other'),
                         ('library_directory', '/other/Scores'), ('fresh_required', False),
                         ('fresh_required', 1), ('created_new', False), ('created_new', 1)]
            for field, value in mutations:
                with self.subTest(phase=row['phase'], field=field, value=value):
                    self.reject_json(name, {**original, field: value}, 'Native profile host', rebind=True)
            for field in original:
                with self.subTest(phase=row['phase'], missing=field):
                    self.reject_json(name, {k: v for k, v in original.items() if k != field},
                                     'Native profile host', rebind=True)
            for value in [None, [], True, 'host']:
                with self.subTest(phase=row['phase'], malformed=value):
                    self.reject_json(name, value, 'Native profile host', rebind=True)
        self.verifier.assert_not_called()

    def test_missing_empty_oversized_and_invalid_json_evidence_cannot_pass(self):
        for name in [PROOF, *native.VSQ_AUTHORING_REPORTS]:
            path = self.directory / name
            original = path.read_bytes()
            try:
                path.unlink()
                with self.subTest(name=name, missing=True), self.assertRaisesRegex(ValueError, 'bounded ordinary evidence'):
                    self.accept()
                limit = 16 * 1024 if name.startswith('profile-') else 1024 * 1024
                for data in [b'', b' ' * (limit + 1)]:
                    path.write_bytes(data)
                    with self.subTest(name=name, size=len(data)), self.assertRaisesRegex(ValueError, 'bounded ordinary evidence'):
                        self.accept()
                if not name.startswith('renderer-'):
                    path.write_bytes(b'{broken JSON')
                    with self.subTest(name=name, malformed=True), self.assertRaises(ValueError):
                        self.accept()
            finally:
                path.write_bytes(original)

    def test_symlinked_evidence_executable_or_manifest_cannot_pass(self):
        probe = self.root / 'symlink-probe'
        try:
            probe.symlink_to(self.exe)
        except (OSError, NotImplementedError):
            self.skipTest('Symlink creation is unavailable on this host')
        with self.assertRaisesRegex(ValueError, 'ordinary file'):
            self.accept(executable=probe)
        for name in [PROOF, *native.VSQ_AUTHORING_REPORTS]:
            path, target = self.directory / name, self.root / 'original-evidence.json'
            path.rename(target)
            try:
                path.symlink_to(target)
                with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'bounded ordinary evidence'):
                    self.accept()
            finally:
                path.unlink()
                target.rename(path)
        target = self.root / 'do-not-overwrite.json'
        target.write_text('unchanged', encoding='utf-8')
        (self.directory / 'vsq-authoring-manifest.json').symlink_to(target)
        args = ['native-vsq-authoring-manifest.py', str(self.directory), '--executable', str(self.exe),
                '--commit', COMMIT, '--tree', TREE]
        with patch('sys.argv', args), self.assertRaisesRegex(ValueError, 'destination must not be a symlink'):
            native.main()
        self.assertEqual(target.read_text(), 'unchanged')

    def test_independent_node_failure_or_timeout_cannot_create_acceptance(self):
        self.verifier.return_value = subprocess.CompletedProcess([], 1, '', 'original VSQ source inventory changed\n')
        with self.assertRaisesRegex(ValueError, 'Independent VSQ-authoring verification failed: original VSQ source inventory changed'):
            self.accept()
        self.verifier.side_effect = subprocess.TimeoutExpired('node', 30)
        with self.assertRaises(subprocess.TimeoutExpired):
            self.accept()
        self.assertFalse((self.directory / 'vsq-authoring-manifest.json').exists())


if __name__ == '__main__':
    unittest.main()
