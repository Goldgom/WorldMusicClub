"""Original synthetic transport fixtures; these never claim native acceptance."""

import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/native-acceptance-transfer.py'
_spec = importlib.util.spec_from_file_location('native_acceptance_transfer', SCRIPT)
transfer = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(transfer)
IDENTITY = {
    'source_sha': '1' * 40, 'source_tree': '2' * 40, 'run_id': '17', 'run_attempt': '2',
    'repository': 'example/original-fixture', 'cargo_lock_sha256': '3' * 64,
    'npm_lock_sha256': '4' * 64, 'rust': 'rustc 1.99.0 (original fixture)',
    'node': 'v22.23.3', 'python': '3.12.10', 'runner_os': 'Windows', 'rustflags': '-C target-feature=+crt-static',
}


class NativeAcceptanceTransferTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.workspace = self.root / 'workspace'
        self.runner_temp = self.root / 'runner-temp'
        self.workspace.mkdir()
        self.runner_temp.mkdir()
        self.archive = self.root / 'transfer.zip'
        self.git('init', '--quiet')
        (self.workspace / 'README.md').write_bytes(b'Original tracked source\n')
        self.git('add', 'README.md')
        self.payload = {name: b'Original synthetic notice; not acceptance\n' for name in transfer.REQUIRED_FILES}
        self.payload[transfer.EXE] = b'MZ original fixture, never executed'
        self.payload[transfer.NOTICES + '/licenses/MIT.txt'] = b'Original license text\n'
        self.payload[transfer.NOTICES + '/sources/original.crate'] = b'Original source archive fixture\n'
        for scenario in transfer.SCENARIOS:
            self.payload[f'workspace/{scenario}/report.json'] = (
                b'\xef\xbb\xbf' + json.dumps({'synthetic': True, 'acceptance': False,
                    'directory': str(self.workspace / scenario / 'Scores'),
                    'native_path': r'D:\a\original\original\desktop-authoring\Scores'}).encode() + b'\r\n')
            self.payload[f'workspace/{scenario}/stderr.log'] = b''
        catalog = 'runner-temp/' + transfer.CATALOG
        self.payload[catalog + '/report.json'] = b'{"synthetic":true,"acceptance":false}\r\n'
        self.payload[catalog + '/fixtures/catalog-original.zip'] = b'Original fixture ZIP bytes'
        self.payload[catalog + '/downloads/take.json'] = b'{"original":true}'
        for area in ('catalog', 'catalog-backups'):
            self.payload[catalog + f'/Scores/{area}/commits/00000000000000000001-operation-original/state.json'] = b'{}'
        self.payload[catalog + '/Scores/clean-songs/original/package/audio/original.wav'] = b'Original synthetic PCM'
        self.payload['workspace/desktop-song-folder/Scores/songs/original/source.payload'] = b'<original/>\r\n'
        self.payload['workspace/desktop-canonical-practice/Scores/backups/original/source.payload'] = b'<original/>\r\n'
        self.payload['workspace/desktop-bulk-import/Scores/imports/original/source.bin'] = b'Original retained bytes'
        for name, data in self.payload.items():
            self.write(name, data)
        self.empty_directories = [
            'workspace/desktop-song-folder/Scores/.staging',
            'workspace/desktop-bulk-import/Scores/.staging',
            'workspace/desktop-bulk-import/Scores/.import-staging',
            'workspace/desktop-authoring/Scores/import-backups',
            'workspace/desktop-vsq-authoring/Scores/imports',
            catalog + '/Scores/.catalog-staging', catalog + '/Scores/.clean-staging',
            catalog + '/Scores/.import-staging', catalog + '/Scores/.staging',
        ]
        for name in self.empty_directories:
            self.path(name).mkdir(parents=True, exist_ok=True)

    def git(self, *args):
        subprocess.run(['git', *args], cwd=self.workspace, check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def path(self, name):
        scope, relative = name.split('/', 1)
        return (self.workspace if scope == 'workspace' else self.runner_temp) / relative

    def write(self, name, data):
        path = self.path(name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def create(self):
        return transfer.create(self.workspace, self.runner_temp, self.archive, copy.deepcopy(IDENTITY))

    def clear_destinations(self):
        for name in [*transfer.SCENARIOS, 'target', 'dist', 'web']:
            path = self.workspace / name
            if path.exists():
                shutil.rmtree(path)
        shutil.rmtree(self.runner_temp / transfer.CATALOG)

    def ready(self):
        digest = self.create()
        self.clear_destinations()
        return digest

    def restore(self, digest=None, identity=None):
        return transfer.restore(self.workspace, self.runner_temp, self.archive,
                                digest or transfer.file_sha(self.archive), identity or copy.deepcopy(IDENTITY))

    def members(self):
        with zipfile.ZipFile(self.archive) as archive:
            return {entry.filename: archive.read(entry) for entry in archive.infolist()}

    def replace_archive(self, members, extras=(), compression=zipfile.ZIP_STORED):
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(self.archive, 'w', compression=compression) as archive:
                for name, data in [*members.items(), *extras]:
                    archive.writestr(name, data)

    def edit_manifest(self, edit):
        members = self.members()
        manifest = json.loads(members[transfer.MANIFEST])
        edit(manifest)
        members[transfer.MANIFEST] = transfer.json_bytes(manifest)
        self.replace_archive(members)

    def assert_no_restore(self):
        self.assertFalse((self.workspace / 'target').exists())
        self.assertFalse((self.workspace / 'desktop-startup').exists())
        self.assertFalse((self.runner_temp / transfer.CATALOG).exists())
        self.assertEqual((self.workspace / 'README.md').read_bytes(), b'Original tracked source\n')

    def test_roundtrip_preserves_all_bytes_absolute_paths_and_empty_directories(self):
        digest = self.ready()
        manifest = self.restore(digest)
        self.assertEqual(manifest['identity'], IDENTITY)
        self.assertEqual(manifest['original_paths'], {'workspace': str(self.workspace), 'runner-temp': str(self.runner_temp)})
        self.assertEqual(set(manifest['files']), set(self.payload))
        for name, data in self.payload.items():
            self.assertEqual(self.path(name).read_bytes(), data, name)
        for name in self.empty_directories:
            self.assertTrue(self.path(name).is_dir(), name)
            self.assertEqual(list(self.path(name).iterdir()), [])
        with zipfile.ZipFile(self.archive) as archive:
            self.assertTrue(all(not entry.is_dir() and entry.compress_type == zipfile.ZIP_STORED
                                for entry in archive.infolist()))

    def test_profiles_secret_stores_dependencies_and_arbitrary_extras_are_omitted(self):
        extras = (
            'workspace/desktop-authoring/webview-profiles/authoring-seed/Cookies',
            'workspace/desktop-authoring/fixtures/webview-profile.json',
            'workspace/desktop-authoring/credentials.json',
            'workspace/desktop-authoring/.env',
            'workspace/desktop-authoring/unrelated.txt',
            'workspace/desktop-authoring/other/report.json',
            'workspace/desktop-authoring/fixtures/nested/unknown.json',
            'workspace/desktop-authoring/Scores/unrelated/source.bin',
            'runner-temp/library-management-windows/webview-catalog-profile/Local State',
            'workspace/target/release/deps/secret.dll',
            'workspace/web/vendor/opensheetmusicdisplay.min.js',
        )
        for name in extras:
            self.write(name, b'Excluded fixture bytes')
        self.create()
        self.assertEqual(set(self.members()), set(self.payload) | {transfer.MANIFEST})

    def test_missing_required_files_and_scenarios_fail_before_creating_archive(self):
        for name in [transfer.EXE, *sorted(transfer.REQUIRED_FILES - {transfer.EXE}),
                     transfer.NOTICES + '/licenses/MIT.txt']:
            with self.subTest(name=name):
                path = self.path(name)
                data = path.read_bytes()
                path.unlink()
                with self.assertRaises(ValueError):
                    self.create()
                self.assertFalse(self.archive.exists())
                path.write_bytes(data)
        for name in [*transfer.SCENARIOS, transfer.CATALOG]:
            with self.subTest(scenario=name):
                path = self.workspace / name if name in transfer.SCENARIOS else self.runner_temp / name
                saved = path.with_name(path.name + '-saved')
                path.rename(saved)
                with self.assertRaises((ValueError, FileNotFoundError)):
                    self.create()
                self.assertFalse(self.archive.exists())
                saved.rename(path)

    def test_empty_scenario_fails(self):
        root = self.workspace / 'desktop-startup'
        shutil.rmtree(root)
        root.mkdir()
        with self.assertRaisesRegex(ValueError, 'scenario has no files'):
            self.create()

    def test_staging_payload_cannot_be_silently_omitted(self):
        self.write(self.empty_directories[0] + '/unfinished.bin', b'Original interrupted staging fixture')
        with self.assertRaisesRegex(ValueError, 'Staging directory is not empty'):
            self.create()

    def test_trusted_sha_rejects_byte_tampering_before_zip_parsing(self):
        digest = self.ready()
        data = bytearray(self.archive.read_bytes())
        data[50] ^= 1
        self.archive.write_bytes(data)
        with patch.object(transfer, 'zip_inventory') as inventory:
            with self.assertRaisesRegex(ValueError, 'SHA-256 differs'):
                self.restore(digest)
            inventory.assert_not_called()
        self.assert_no_restore()

    def test_valid_zip_with_changed_payload_fails_record_hash_before_writes(self):
        self.ready()
        members = self.members()
        name = 'workspace/desktop-startup/report.json'
        members[name] = members[name].replace(b'true', b'fake', 1)
        self.replace_archive(members)
        with self.assertRaisesRegex(ValueError, 'file hash differs'):
            self.restore()
        self.assert_no_restore()

    def test_each_identity_field_is_bound_exactly(self):
        self.ready()
        for key, value in IDENTITY.items():
            with self.subTest(field=key):
                identity = dict(IDENTITY)
                identity[key] = ('a' * len(value) if key in {'source_sha', 'source_tree', 'cargo_lock_sha256', 'npm_lock_sha256'}
                                 else '19' if key in {'run_id', 'run_attempt'}
                                 else 'other/repository' if key == 'repository' else value + ' changed')
                with self.assertRaisesRegex(ValueError, 'identity differs'):
                    self.restore(identity=identity)
                self.assert_no_restore()

    def test_identity_rejects_missing_extra_wrong_type_or_malformed_values(self):
        cases = [dict(IDENTITY, unknown='x'), {key: value for key, value in IDENTITY.items() if key != 'rust'},
                 dict(IDENTITY, run_id=17), dict(IDENTITY, source_sha='abc'),
                 dict(IDENTITY, rust=''), dict(IDENTITY, cargo_lock_sha256='z' * 64)]
        for identity in cases:
            with self.subTest(identity=identity), self.assertRaises(ValueError):
                transfer.checked_identity(identity)
        with self.assertRaisesRegex(ValueError, 'Duplicate JSON key'):
            transfer.parse_json(b'{"source_sha":"one","source_sha":"two"}')

    def test_changed_manifest_identity_is_rejected(self):
        self.ready()
        self.edit_manifest(lambda manifest: manifest['identity'].update(source_tree='a' * 40))
        with self.assertRaisesRegex(ValueError, 'identity differs'):
            self.restore()
        self.assert_no_restore()

    def test_original_workspace_and_temp_layout_cannot_be_rebased(self):
        self.ready()
        original = self.members()
        for key in ('workspace', 'runner-temp'):
            with self.subTest(root=key):
                self.replace_archive(original)
                self.edit_manifest(lambda manifest: manifest['original_paths'].update({key: str(self.root / 'elsewhere')}))
                with self.assertRaisesRegex(ValueError, 'absolute workspace/runner-temp paths differ'):
                    self.restore()
                self.assert_no_restore()

    def test_missing_extra_or_omitted_manifest_members_fail_before_writes(self):
        self.ready()
        original = self.members()
        name = 'workspace/desktop-startup/report.json'
        for case in ('missing_zip_member', 'omitted_manifest_member', 'extra_zip_member', 'extra_manifest_member'):
            with self.subTest(case=case):
                members = dict(original)
                manifest = json.loads(members[transfer.MANIFEST])
                if case == 'missing_zip_member':
                    del members[name]
                elif case == 'omitted_manifest_member':
                    del manifest['files'][name]
                elif case == 'extra_zip_member':
                    members['workspace/desktop-startup/extra.json'] = b'{}'
                else:
                    manifest['files']['workspace/desktop-startup/extra.json'] = {'bytes': 2, 'sha256': 'a' * 64}
                manifest['file_count'] = len(manifest['files'])
                manifest['payload_bytes'] = sum(row['bytes'] for row in manifest['files'].values())
                members[transfer.MANIFEST] = transfer.json_bytes(manifest)
                self.replace_archive(members)
                with self.assertRaises(ValueError):
                    self.restore()
                self.assert_no_restore()

    def test_manifest_totals_schema_fields_hash_types_and_parent_inventory_are_checked(self):
        self.ready()
        original = self.members()
        edits = [lambda m: m.update(schema='other'), lambda m: m.update(extra=True),
                 lambda m: m.update(file_count=True), lambda m: m.update(payload_bytes=m['payload_bytes'] + 1),
                 lambda m: m['files'][transfer.EXE].update(bytes=True),
                 lambda m: m['files'][transfer.EXE].update(sha256='z' * 64),
                 lambda m: m['directories'].remove('workspace/target'),
                 lambda m: m['directories'].append(m['directories'][0]),
                 lambda m: m['directories'].append('workspace/scripts')]
        for index, edit in enumerate(edits):
            with self.subTest(index=index):
                self.replace_archive(original)
                self.edit_manifest(edit)
                with self.assertRaises(ValueError):
                    self.restore()
                self.assert_no_restore()

    def test_omitting_required_payload_and_its_manifest_record_still_fails(self):
        self.ready()
        original = self.members()
        for name in (transfer.EXE, transfer.PROVENANCE, 'runner-temp/library-management-windows/report.json'):
            with self.subTest(name=name):
                members = dict(original)
                manifest = json.loads(members[transfer.MANIFEST])
                removed = [name] if name != 'runner-temp/library-management-windows/report.json' else [
                    path for path in manifest['files'] if path.startswith('runner-temp/library-management-windows/')]
                for path in removed:
                    del members[path]
                    del manifest['files'][path]
                manifest['file_count'] = len(manifest['files'])
                manifest['payload_bytes'] = sum(row['bytes'] for row in manifest['files'].values())
                members[transfer.MANIFEST] = transfer.json_bytes(manifest)
                self.replace_archive(members)
                with self.assertRaises(ValueError):
                    self.restore()
                self.assert_no_restore()

    def test_unknown_source_dependency_profile_and_windows_unsafe_archive_paths(self):
        self.ready()
        original = self.members()
        bad_names = [
            '../outside.json', '/absolute.json', 'C:/outside.json', 'workspace\\desktop-startup\\test.json',
            'workspace/desktop-startup/../outside.json', 'workspace/desktop-startup//test.json',
            'workspace/desktop-startup/CON.json', 'workspace/desktop-startup/NUL.txt',
            'workspace/desktop-startup/com¹.json', 'workspace/desktop-startup/conin$.json',
            'workspace/desktop-startup/trailing .json ', 'workspace/desktop-startup/trailing.json.',
            'workspace/desktop-startup/data.json:secret', 'workspace/desktop-startup/bad\n.json',
            'workspace/desktop-startup/bad\x00.json', 'workspace/desktop-startup/a?.json',
            'workspace/scripts/acceptance.py', 'workspace/Cargo.lock', 'workspace/node_modules/secret.json',
            'workspace/target/release/deps/something.dll', 'workspace/desktop-startup/webview-profile/Cookies',
            'runner-temp/library-management-windows/webview-catalog-profile/Local State',
            'runner-temp/other/report.json', 'workspace/desktop-portable/report.json',
            'workspace/desktop-authoring/Scores/.catalog-staging/secret.json',
        ]
        for name in bad_names:
            with self.subTest(name=name):
                self.replace_archive(original, extras=[(name, b'{}')])
                with self.assertRaises(ValueError):
                    self.restore()
                self.assert_no_restore()

    def test_duplicate_case_alias_and_parent_case_alias_are_rejected(self):
        self.ready()
        original = self.members()
        for name in ('workspace/desktop-startup/report.json', 'workspace/desktop-startup/REPORT.json',
                     'workspace/desktop-canonical-practice/Scores/backups/ORIGINAL/other.json'):
            with self.subTest(name=name):
                members = dict(original)
                extras = [(name, b'{}')]
                if name.endswith('other.json'):
                    manifest = json.loads(members[transfer.MANIFEST])
                    manifest['files'][name] = {'bytes': 2, 'sha256': transfer.hashlib.sha256(b'{}').hexdigest()}
                    manifest['directories'].append(name.rsplit('/', 1)[0])
                    manifest['file_count'] += 1
                    manifest['payload_bytes'] += 2
                    members[transfer.MANIFEST] = transfer.json_bytes(manifest)
                self.replace_archive(members, extras=extras)
                with self.assertRaises(ValueError):
                    self.restore()
                self.assert_no_restore()

    def test_zip_symlink_reparse_directory_and_alias_metadata_are_rejected(self):
        self.ready()
        original = self.members()
        configurations = [
            ((stat.S_IFLNK | 0o777) << 16, b''), ((stat.S_IFIFO | 0o600) << 16, b''),
            ((stat.S_IFREG | 0o600) << 16 | 0x400, b''),
            ((stat.S_IFDIR | 0o700) << 16 | 0x10, b''),
            ((stat.S_IFREG | 0o600) << 16, struct.pack('<HHBL', 0x7075, 5, 1, 0)),
        ]
        for attributes, extra in configurations:
            with self.subTest(attributes=attributes, extra=extra):
                info = zipfile.ZipInfo('workspace/desktop-startup/extra.json')
                info.external_attr = attributes
                info.extra = extra
                self.replace_archive(original, extras=[(info, b'{}')])
                with self.assertRaises(ValueError):
                    self.restore()
                self.assert_no_restore()

    def test_compressed_bomb_is_rejected_without_inflation(self):
        self.ready()
        self.replace_archive(self.members(), extras=[('workspace/desktop-startup/bomb.json', b'0' * 1024 * 1024)],
                             compression=zipfile.ZIP_DEFLATED)
        with self.assertRaisesRegex(ValueError, 'uncompressed bounded ZIP'):
            self.restore()
        self.assert_no_restore()

    def test_zip_envelope_rejects_large_directory_before_parsing_entries(self):
        self.ready()
        original = self.archive.read_bytes()
        for field, offset, code, value in [('entry_count', 10, '<H', transfer.MAX_FILES + 2),
                                            ('central_size', 12, '<L', 16 * 1024 * 1024)]:
            with self.subTest(field=field):
                data = bytearray(original)
                if field == 'entry_count':
                    struct.pack_into('<H', data, len(data) - 22 + 8, value)
                struct.pack_into(code, data, len(data) - 22 + offset, value)
                self.archive.write_bytes(data)
                with patch.object(transfer.zipfile, 'ZipFile') as parse:
                    with self.assertRaises(ValueError):
                        self.restore()
                    parse.assert_not_called()
                self.assert_no_restore()

    def test_zip_trailing_bytes_or_local_filename_alias_fails(self):
        self.ready()
        original = self.archive.read_bytes()
        self.archive.write_bytes(original + b'Unbound trailing bytes')
        with self.assertRaises(ValueError):
            self.restore()
        self.assert_no_restore()
        data = bytearray(original)
        data[30] = ord('x')  # alter only the first local filename, not its central name
        self.archive.write_bytes(data)
        with self.assertRaisesRegex(ValueError, 'local filename differs'):
            self.restore()
        self.assert_no_restore()

    def test_count_file_total_manifest_archive_and_traversal_bounds(self):
        self.ready()
        for limit, value in [('MAX_FILES', 1), ('MAX_DIRECTORIES', 1), ('MAX_FILE_BYTES', 1),
                             ('MAX_EXE_BYTES', 1), ('MAX_TOTAL_BYTES', 1),
                             ('MAX_MANIFEST_BYTES', 1), ('MAX_ARCHIVE_BYTES', 1)]:
            with self.subTest(limit=limit), patch.object(transfer, limit, value):
                with self.assertRaises(ValueError):
                    self.restore()
                self.assert_no_restore()

    def test_create_bounds_reject_before_archive_creation(self):
        for limit in ('MAX_FILES', 'MAX_DIRECTORIES', 'MAX_NODES', 'MAX_FILE_BYTES', 'MAX_EXE_BYTES', 'MAX_TOTAL_BYTES'):
            with self.subTest(limit=limit), patch.object(transfer, limit, 1):
                with self.assertRaises(ValueError):
                    self.create()
                self.assertFalse(self.archive.exists())

    def test_existing_file_or_owned_directory_never_overwritten(self):
        self.ready()
        for name, directory in [(transfer.EXE, False), ('workspace/desktop-authoring', True)]:
            with self.subTest(name=name):
                path = self.path(name)
                if directory:
                    path.mkdir()
                else:
                    self.write(name, b'Preserve existing bytes')
                with self.assertRaisesRegex(ValueError, 'destination already exists'):
                    self.restore()
                if directory:
                    self.assertEqual(list(path.iterdir()), [])
                    path.rmdir()
                else:
                    self.assertEqual(path.read_bytes(), b'Preserve existing bytes')
                    shutil.rmtree(self.workspace / 'target')
                self.assert_no_restore()

    def test_shared_directories_may_exist_without_overwriting_their_contents(self):
        self.ready()
        self.write('workspace/web/existing-source.js', b'Original source')
        (self.workspace / 'web/vendor').mkdir()
        self.restore()
        self.assertEqual((self.workspace / 'web/existing-source.js').read_bytes(), b'Original source')

    def test_case_alias_destination_is_rejected_even_on_case_sensitive_hosts(self):
        self.ready()
        (self.workspace / 'Desktop-Startup').mkdir()
        with self.assertRaisesRegex(ValueError, 'Case-alias destination|destination already exists'):
            self.restore()
        self.assertFalse((self.workspace / 'target').exists())

    def test_tracked_input_or_deleted_tracked_destination_cannot_be_transferred(self):
        tracked = 'desktop-startup/report.json'
        self.git('add', tracked)
        with self.assertRaisesRegex(ValueError, 'Tracked source cannot be transferred'):
            self.create()
        self.git('rm', '--cached', tracked)
        self.ready()
        self.write('workspace/' + tracked, b'Original tracked fixture')
        self.git('add', tracked)
        shutil.rmtree(self.workspace / 'desktop-startup')
        with self.assertRaisesRegex(ValueError, 'Tracked source cannot be transferred'):
            self.restore()
        self.assert_no_restore()

    def test_symlink_input_and_destination_ancestor_are_rejected(self):
        original = self.path('workspace/desktop-startup/report.json')
        external = self.root / 'external.json'
        external.write_bytes(b'Private external original fixture')
        original.unlink()
        try:
            original.symlink_to(external)
        except OSError as error:
            self.skipTest('Symbolic links unavailable: ' + str(error))
        with self.assertRaisesRegex(ValueError, 'links.*reparse'):
            self.create()
        original.unlink()
        original.write_bytes(self.payload['workspace/desktop-startup/report.json'])
        self.ready()
        (self.workspace / 'target').symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'links.*reparse'):
            self.restore()
        self.assertEqual(external.read_bytes(), b'Private external original fixture')
        self.assertFalse((self.workspace / 'desktop-startup').exists())

    def test_windows_reparse_attributes_are_rejected_without_following(self):
        class ReparseStat:
            st_mode = stat.S_IFDIR | 0o700
            st_file_attributes = 0x400

        with self.assertRaisesRegex(ValueError, 'reparse'):
            transfer.ordinary_stat(ReparseStat(), directory=True)

    @unittest.skipUnless(os.name == 'nt', 'Windows junction creation requires Windows')
    def test_real_windows_junction_input_is_rejected(self):
        path = self.workspace / 'desktop-startup'
        shutil.rmtree(path)
        destination = self.root / 'junction-target'
        destination.mkdir()
        result = subprocess.run(['cmd', '/c', 'mklink', '/J', str(path), str(destination)],
                                capture_output=True, text=True)
        if result.returncode:
            self.skipTest('Windows junction unavailable: ' + result.stderr)
        try:
            with self.assertRaisesRegex(ValueError, 'reparse'):
                self.create()
        finally:
            path.rmdir()

    def test_hard_link_input_is_rejected(self):
        target = self.path('workspace/desktop-startup/report.json')
        try:
            os.link(target, self.root / 'linked.json')
        except OSError as error:
            self.skipTest('Hard links unavailable: ' + str(error))
        with self.assertRaisesRegex(ValueError, 'Hard-linked'):
            self.create()

    def test_cargo_hard_linked_exe_is_copied_as_independent_unchanged_bytes(self):
        original = self.path(transfer.EXE)
        alias = self.root / 'cargo-deps-original.exe'
        os.link(original, alias)
        self.assertGreater(original.stat().st_nlink, 1)
        digest = self.ready()
        self.restore(digest)
        self.assertEqual(original.read_bytes(), self.payload[transfer.EXE])
        self.assertEqual(original.stat().st_nlink, 1)
        alias.write_bytes(b'Changed untransferred compiler alias')
        self.assertEqual(original.read_bytes(), self.payload[transfer.EXE])

    def test_cargo_exe_change_through_alias_during_transfer_is_rejected(self):
        original = self.path(transfer.EXE)
        alias = self.root / 'cargo-deps-original.exe'
        os.link(original, alias)
        collect = transfer.collect

        def mutate_after_inventory(locations):
            result = collect(locations)
            data = bytearray(alias.read_bytes())
            data[-1] ^= 1  # Keep the declared size; the independent digest must fail.
            alias.write_bytes(data)
            return result

        with patch.object(transfer, 'collect', side_effect=mutate_after_inventory):
            with self.assertRaisesRegex(ValueError, 'changed after inventory'):
                self.create()
        self.assertFalse(self.archive.exists())

    def test_build_provenance_hard_links_do_not_get_the_exe_exception(self):
        original = self.path(transfer.PROVENANCE)
        os.link(original, self.root / 'linked-provenance.json')
        with self.assertRaisesRegex(ValueError, 'Hard-linked'):
            self.create()

    def test_cli_env_identity_and_trusted_sha_output(self):
        output = self.root / 'github-output'
        environment = dict(os.environ, ACCEPTANCE_IDENTITY=json.dumps(IDENTITY), GITHUB_OUTPUT=str(output))
        result = subprocess.run([sys.executable, str(SCRIPT), 'create', '--workspace', str(self.workspace),
                                 '--runner-temp', str(self.runner_temp), '--output', str(self.archive)],
                                env=environment, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        digest = transfer.file_sha(self.archive)
        self.assertEqual(output.read_text(encoding='utf-8'), 'sha256=' + digest + '\n')
        self.clear_destinations()
        result = subprocess.run([sys.executable, str(SCRIPT), 'restore', '--workspace', str(self.workspace),
                                 '--runner-temp', str(self.runner_temp), '--archive', str(self.archive),
                                 '--expected-sha256', digest, '--identity', json.dumps(IDENTITY)],
                                env=environment, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.path(transfer.EXE).read_bytes(), self.payload[transfer.EXE])


class NativeTransferNewlineTests(unittest.TestCase):
    def test_rejected_transfer_preserves_exact_source_with_windows_text_defaults(self):
        original_open = Path.open

        def windows_text_default(path, mode='r', buffering=-1, encoding=None, errors=None, newline=None):
            # Simulate Windows text output on every host. Keep binary writes and
            # explicit newline choices untouched; the fixture must choose bytes.
            if 'b' not in mode and any(flag in mode for flag in ('w', 'a', 'x')) and newline is None:
                newline = '\r\n'
            return original_open(path, mode, buffering, encoding, errors, newline)

        result = unittest.TestResult()
        with tempfile.TemporaryDirectory() as temporary, patch.object(Path, 'open', windows_text_default):
            probe = Path(temporary) / 'windows-text.txt'
            probe.write_text('Original tracked source\n', encoding='utf-8')
            self.assertEqual(probe.read_bytes(), b'Original tracked source\r\n')
            # Exercise the existing hostile-archive path and its byte-exact
            # no-restoration assertion, not a second implementation of it.
            case = NativeAcceptanceTransferTests('test_trusted_sha_rejects_byte_tampering_before_zip_parsing')
            case.run(result)
        self.assertEqual(result.testsRun, 1)
        self.assertEqual(result.errors, [])
        self.assertEqual(result.failures, [])
        self.assertEqual(result.skipped, [])


if __name__ == '__main__':
    unittest.main()
