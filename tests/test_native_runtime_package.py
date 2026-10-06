"""Tiny ORIGINAL format fixtures only; no Windows or checkpoint acceptance claim."""
import importlib.util
import json
from pathlib import Path
import stat
import struct
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location('native_runtime', ROOT / 'scripts/native-runtime-package.py')
runtime = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(runtime)
COMMIT = 'b' * 40
TREE = 'c' * 40
REFERENCE = 'https://github.com/example/original-fixture/actions/runs/17/artifacts/23'


def original_executable():
    # Original 100-byte header, not an executable build or a Windows observation.
    data = bytearray(100)
    data[:2] = b'MZ'
    data[60:64] = (64).to_bytes(4, 'little')
    data[64:70] = b'PE\0\0\x64\x86'
    return bytes(data)


class RuntimePackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.full = self.root / 'original-full.zip'
        self.output = self.root / 'original-runtime.zip'
        self.payload = {
            runtime.EXE: original_executable(), 'README.md': b'Original instructions\n',
            'START-HERE.md': b'Original startup instructions\n', 'LICENSE': b'Original MIT notice\n',
            'catalog/index.json': b'{"version":1,"editions":[]}',
            'docs/original.md': b'Original fixture documentation\n',
            'licenses/engraving/engraving-manifest.json': b'{}',
            'licenses/engraving/opensheetmusicdisplay.min.js.LICENSE.txt': b'Original notice\n',
            'licenses/rust/manifest.json': b'{}',
            'licenses/rust/CARGO-THIRD-PARTY-NOTICES.txt': b'Original notice\n',
            'licenses/rust/RUST-STANDARD-LIBRARY-COPYRIGHT.html': b'Original notice\n',
            'licenses/rust/sources/original.crate': b'Original license source archive fixture\n',
            # An unfamiliar future runtime asset must be retained without an allowlist change.
            'assets/future-runtime.dat': b'Original future runtime bytes\n',
            'evidence/original.json': b'{"synthetic":true,"acceptance":false}',
            'evidence/nested/original.txt': b'Original synthetic evidence\n',
        }
        self.payload.update({name: b'{"synthetic":true}' for name in runtime._full.SCORE_SCHEMAS})
        self.info = {'format_version': 1, 'name': runtime.FOLDER, 'executable': runtime.EXE,
                     'git_commit': COMMIT, 'git_tree': TREE, 'commit_count': 999,
                     'acceptance_scope': 'native-windows-only', 'acceptance_workflow_run_id': '17',
                     'acceptance': {'synthetic_fixture': True, 'checkpoint_accepted': False},
                     'files': {name: runtime.record(data) for name, data in self.payload.items()},
                     'file_count': len(self.payload)}
        info_data = runtime.json_bytes(self.info)
        self.full_files = {**self.payload, runtime.INFO: info_data,
                           runtime.SUMS: runtime.checksum_bytes({**self.info['files'], runtime.INFO: runtime.record(info_data)})}
        self.write_zip(self.full, self.full_files)

    def write_zip(self, path, files):
        with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as package:
            for name, data in files.items():
                package.writestr(runtime.FOLDER + '/' + name, data)

    def read_zip(self, path):
        with zipfile.ZipFile(path) as package:
            return {row.filename[len(runtime.FOLDER) + 1:]: package.read(row) for row in package.infolist()}

    def create(self):
        # Only the external semantic acceptance boundary is substituted. These
        # tests prove packaging behavior, not real native evidence acceptance.
        with patch.object(runtime, 'verify_full_archive', return_value=self.info) as verify:
            result = runtime.create_runtime(self.full, self.output, COMMIT, TREE, REFERENCE)
        verify.assert_called_once_with(self.full, result['source'], runtime.file_sha(self.full),
                                       self.full_files[runtime.INFO], self.full_files[runtime.SUMS])
        return result

    def verify(self, full=None):
        return runtime.verify_runtime(self.output, runtime.file_sha(self.output), full)

    def rewrite(self, edit):
        files = self.read_zip(self.output)
        edit(files)
        self.write_zip(self.output, files)

    def edit_manifest(self, edit):
        def change(files):
            manifest = json.loads(files[runtime.MANIFEST])
            edit(manifest)
            files[runtime.MANIFEST] = runtime.json_bytes(manifest)
            files[runtime.SUMS] = runtime.checksum_bytes({**manifest['files'], runtime.MANIFEST: runtime.record(files[runtime.MANIFEST])})
        self.rewrite(change)

    def test_retains_every_non_evidence_byte_and_complete_original_inventory(self):
        result = self.create()
        files = self.read_zip(self.output)
        for name, data in self.payload.items():
            if name.startswith('evidence/'):
                self.assertNotIn(name, files)
            else:
                self.assertEqual(files[name], data)
        self.assertEqual(files[runtime.INFO], self.full_files[runtime.INFO])
        self.assertEqual(files[runtime.FULL_SUMS], self.full_files[runtime.SUMS])
        self.assertEqual(result['partition']['evidence_file_count'], 2)
        self.assertEqual(result['full_evidence']['sha256'], runtime.file_sha(self.full))
        self.assertEqual(result['full_evidence']['reference'], runtime.evidence_reference(REFERENCE, COMMIT))
        self.assertEqual(self.full_files, self.read_zip(self.full))

    def test_standalone_verification_never_claims_or_calls_evidence_validation(self):
        self.create()
        with patch.object(runtime, 'verify_full_archive') as verify:
            result = self.verify()
        verify.assert_not_called()
        self.assertEqual(result['runtime_integrity'], 'verified')
        self.assertEqual(result['full_native_evidence'], 'not-revalidated')
        self.assertEqual(result['checkpoint_acceptance'], 'not-asserted')

    def test_exact_offline_full_audit_invokes_full_verifier(self):
        manifest = self.create()
        with patch.object(runtime, 'verify_full_archive', return_value=self.info) as verify:
            result = self.verify(self.full)
        verify.assert_called_once_with(self.full, manifest['source'], runtime.file_sha(self.full),
                                       self.full_files[runtime.INFO], self.full_files[runtime.SUMS])
        self.assertEqual(result['full_native_evidence'], 'revalidated')
        self.assertEqual(result['checkpoint_acceptance'], 'not-asserted')

    def test_default_adapter_calls_unchanged_full_verifier(self):
        # No complete fake acceptance dataset is built. The real full verifier
        # must reject this tiny fixture even with checkout checking substituted.
        with patch.object(runtime, 'require_verifier_source'):
            with self.assertRaises((ValueError, KeyError)):
                runtime.verify_full_archive(self.full, {'git_commit': COMMIT, 'git_tree': TREE, 'commit_count': 999},
                                            runtime.file_sha(self.full), self.full_files[runtime.INFO], self.full_files[runtime.SUMS])

    def test_full_verifier_failure_prevents_creation(self):
        with patch.object(runtime, 'verify_full_archive', side_effect=ValueError('native proof rejected')) as verify:
            with self.assertRaisesRegex(ValueError, 'native proof rejected'):
                runtime.create_runtime(self.full, self.output, COMMIT, TREE, REFERENCE)
        verify.assert_called_once()
        self.assertFalse(self.output.exists())
        self.assertFalse(self.output.with_suffix('.zip.sha256').exists())

    def test_source_and_tree_must_match_explicit_request(self):
        for commit, tree in [('d' * 40, TREE), (COMMIT, 'd' * 40)]:
            with self.subTest(commit=commit, tree=tree), patch.object(runtime, 'verify_full_archive') as verify:
                with self.assertRaisesRegex(ValueError, 'Requested source/tree differs'):
                    runtime.create_runtime(self.full, self.output, commit, tree, REFERENCE)
                verify.assert_not_called()

    def test_wrong_trusted_archive_hash_fails_before_opening_zip(self):
        self.create()
        with self.assertRaisesRegex(ValueError, 'Runtime ZIP digest differs'):
            runtime.verify_runtime(self.output, '0' * 64)

    def test_missing_and_extra_runtime_files_rejected(self):
        self.create()
        original = self.output.read_bytes()
        for edit in [lambda f: f.pop('assets/future-runtime.dat'),
                     lambda f: f.update({'extra.dll': b'Unlisted original bytes'}),
                     lambda f: f.update({'evidence/reintroduced.json': b'{}'})]:
            with self.subTest(edit=edit):
                self.output.write_bytes(original)
                self.rewrite(edit)
                with self.assertRaisesRegex(ValueError, 'inventory differs'):
                    self.verify()

    def test_altered_executable_asset_notice_and_instruction_rejected(self):
        self.create()
        original = self.output.read_bytes()
        for name in [runtime.EXE, 'assets/future-runtime.dat', 'LICENSE', 'START-HERE.md',
                     'licenses/rust/sources/original.crate', runtime.GUIDE]:
            with self.subTest(name=name):
                self.output.write_bytes(original)
                self.rewrite(lambda files: files.update({name: b'Altered original fixture'}))
                with self.assertRaisesRegex(ValueError, 'checksum differs'):
                    self.verify()

    def test_rehashed_runtime_cannot_silently_omit_full_inventory_member(self):
        self.create()
        self.edit_manifest(lambda m: (m['files'].pop('assets/future-runtime.dat'), m.update(file_count=m['file_count'] - 1)))
        self.rewrite(lambda files: files.pop('assets/future-runtime.dat'))
        with self.assertRaisesRegex(ValueError, 'manifest differs from complete inventory'):
            self.verify()

    def test_source_executable_partition_or_claim_rewrite_rejected(self):
        self.create()
        original = self.output.read_bytes()
        changes = [lambda m: m['source'].update(git_commit='d' * 40),
                   lambda m: m['source'].update(git_tree='d' * 40),
                   lambda m: m['executable'].update(sha256='d' * 64),
                   lambda m: m['partition'].update(evidence_file_count=0),
                   lambda m: m.update(checkpoint_acceptance='accepted')]
        for change in changes:
            with self.subTest(change=change):
                self.output.write_bytes(original)
                self.edit_manifest(change)
                with self.assertRaisesRegex(ValueError, 'manifest differs'):
                    self.verify()

    def test_missing_or_different_offline_evidence_cannot_pass(self):
        self.create()
        with self.assertRaises(FileNotFoundError):
            self.verify(self.root / 'absent.zip')
        self.full.write_bytes(b'Original wrong archive')
        with patch.object(runtime, 'verify_full_archive') as verify:
            with self.assertRaisesRegex(ValueError, 'Full archive size differs'):
                self.verify(self.full)
            verify.assert_not_called()

    def test_full_digest_checked_before_source_or_semantic_verifier(self):
        with patch.object(runtime, 'require_verifier_source') as source, patch.object(runtime._full, 'verify_archive') as full:
            with self.assertRaisesRegex(ValueError, 'Full archive digest differs'):
                runtime.verify_full_archive(self.full, {}, '0' * 64, self.full_files[runtime.INFO], self.full_files[runtime.SUMS])
            source.assert_not_called()
            full.assert_not_called()

    def test_failed_offline_audit_is_not_runtime_only_success(self):
        self.create()
        with patch.object(runtime, 'verify_full_archive', side_effect=ValueError('proof mismatch')):
            with self.assertRaisesRegex(ValueError, 'proof mismatch'):
                self.verify(self.full)

    def test_unknown_format_version_or_boolean_version_rejected(self):
        self.create()
        original = self.output.read_bytes()
        for version in [2, True, '1']:
            with self.subTest(version=version):
                self.output.write_bytes(original)
                self.edit_manifest(lambda m: m.update(format_version=version))
                with self.assertRaisesRegex(ValueError, 'Unsupported runtime format/version'):
                    self.verify()

    def test_duplicate_json_keys_rejected(self):
        self.create()
        self.rewrite(lambda files: files.update({runtime.MANIFEST: b'{"format_version":1,"format_version":1}'}))
        with self.assertRaisesRegex(ValueError, 'Duplicate JSON key'):
            self.verify()

    def test_unsafe_zip_paths_rejected_before_payload_read(self):
        self.create()
        original = self.output.read_bytes()
        for name in ['../escape', 'dir\\file', '/absolute', 'C:drive', 'NUL.txt', 'file.', 'file ', 'a//b', 'a/../b', 'a\x00b']:
            with self.subTest(name=name):
                self.output.write_bytes(original)
                # zipfile truncates NUL names; test that case directly.
                if '\x00' in name:
                    with self.assertRaises(ValueError):
                        runtime.safe_path(name)
                    continue
                self.rewrite(lambda files: files.update({name: b'Original unsafe-path fixture'}))
                with self.assertRaises(ValueError):
                    self.verify()

    def add_raw_nul_filename_alias(self, path):
        # Write a longer ordinary name, then patch BOTH equal-length ZIP headers.
        # Using writestr with a NUL directly would truncate it before serialization
        # and would not exercise the raw archive-name boundary.
        name = 'assets/future-runtime.dat'
        files = self.read_zip(path)
        original_data = files.pop(name)
        files[name + 'Zxxx'] = original_data
        self.write_zip(path, files)
        encoded = (runtime.FOLDER + '/' + name + 'Zxxx').encode()
        replacement = (runtime.FOLDER + '/' + name).encode() + b'\0xxx'
        archive = path.read_bytes()
        self.assertEqual(archive.count(encoded), 2)  # Local and central headers.
        path.write_bytes(archive.replace(encoded, replacement))
        with zipfile.ZipFile(path) as package:
            member = package.getinfo(runtime.FOLDER + '/' + name)
            self.assertEqual(member.orig_filename, member.filename + '\0xxx')
            self.assertEqual(package.read(member), original_data)

    def test_raw_nul_runtime_filename_alias_is_rejected(self):
        self.create()
        self.add_raw_nul_filename_alias(self.output)
        # Supply the mutated archive's outer digest so a path check, not the
        # transport hash, must reject the hidden raw-name suffix.
        with self.assertRaisesRegex(ValueError, 'ZIP filename was normalized or truncated'):
            self.verify()

    def test_raw_nul_full_filename_alias_is_rejected_before_semantic_verifier(self):
        self.add_raw_nul_filename_alias(self.full)
        with patch.object(runtime, 'verify_full_archive', return_value=self.info) as verify:
            with self.assertRaisesRegex(ValueError, 'ZIP filename was normalized or truncated'):
                runtime.create_runtime(self.full, self.output, COMMIT, TREE, REFERENCE)
            verify.assert_not_called()
        self.assertFalse(self.output.exists())

    def test_windows_device_name_variants_rejected(self):
        self.create()
        original = self.output.read_bytes()
        for name in ['CONIN$', 'conout$.txt', 'COM¹.txt', 'LPT²', 'nested/coM³.log',
                     'CON .txt', 'NUL .dat', 'LPT1 .txt', 'COM¹ .txt']:
            with self.subTest(name=name):
                self.output.write_bytes(original)
                self.rewrite(lambda files: files.update({name: b'Original reserved-name fixture'}))
                with self.assertRaisesRegex(ValueError, 'Unsafe Windows package path'):
                    self.verify()

    def patch_declared_member_size(self, path, name, size):
        encoded = (runtime.FOLDER + '/' + name).encode()
        with zipfile.ZipFile(path) as package:
            local_offset = package.getinfo(encoded.decode()).header_offset
            central_offset = package.start_dir
        data = bytearray(path.read_bytes())
        while data[central_offset:central_offset + 4] == b'PK\x01\x02':
            name_length, extra_length, comment_length = struct.unpack_from('<HHH', data, central_offset + 28)
            if data[central_offset + 46:central_offset + 46 + name_length] == encoded:
                struct.pack_into('<I', data, central_offset + 24, size)
                struct.pack_into('<I', data, local_offset + 22, size)
                path.write_bytes(data)
                return
            central_offset += 46 + name_length + extra_length + comment_length
        self.fail('Original synthetic ZIP member was not found')

    def bind_modified_full_archive(self):
        self.edit_manifest(lambda m: m['full_evidence'].update(
            sha256=runtime.file_sha(self.full), bytes=self.full.stat().st_size))

    def test_offline_audit_bounds_precede_legacy_verifier(self):
        self.create()
        self.patch_declared_member_size(self.full, 'assets/future-runtime.dat', runtime.MAX_MEMBER_BYTES + 1)
        self.bind_modified_full_archive()
        with patch.object(runtime, 'require_verifier_source') as source, patch.object(runtime._full, 'verify_archive') as legacy:
            with self.assertRaisesRegex(ValueError, 'ZIP member exceeds size bound'):
                self.verify(self.full)
            source.assert_not_called()
            legacy.assert_not_called()

    def test_offline_original_metadata_comparison_precedes_legacy_verifier(self):
        self.create()
        files = self.read_zip(self.full)
        # Semantically identical JSON is still different ORIGINAL metadata.
        files[runtime.INFO] += b'\n'
        self.write_zip(self.full, files)
        self.bind_modified_full_archive()
        with patch.object(runtime, 'require_verifier_source') as source, patch.object(runtime._full, 'verify_archive') as legacy:
            with self.assertRaisesRegex(ValueError, 'Original full metadata bytes differ'):
                self.verify(self.full)
            source.assert_not_called()
            legacy.assert_not_called()

    def test_offline_member_length_comparison_precedes_legacy_verifier(self):
        self.create()
        self.patch_declared_member_size(self.full, 'assets/future-runtime.dat', 1024)
        self.bind_modified_full_archive()
        with patch.object(runtime, 'require_verifier_source') as source, patch.object(runtime._full, 'verify_archive') as legacy:
            with self.assertRaisesRegex(ValueError, 'Full ZIP member length differs'):
                self.verify(self.full)
            source.assert_not_called()
            legacy.assert_not_called()

    def test_case_collision_symlink_and_directory_members_rejected(self):
        self.create()
        original = self.output.read_bytes()
        for kind in ['case', 'symlink', 'directory', 'parent-file']:
            with self.subTest(kind=kind):
                self.output.write_bytes(original)
                with zipfile.ZipFile(self.output, 'a') as package:
                    name = {'case': 'license', 'symlink': 'link', 'directory': 'empty/', 'parent-file': 'assets'}[kind]
                    member = zipfile.ZipInfo(runtime.FOLDER + '/' + name)
                    if kind == 'symlink':
                        member.external_attr = (stat.S_IFLNK | 0o777) << 16
                    package.writestr(member, b'Original invalid member')
                with self.assertRaises(ValueError):
                    self.verify()

    def test_unicode_path_extra_alias_is_rejected_across_decoder_versions(self):
        self.create()
        files = self.read_zip(self.output)
        with zipfile.ZipFile(self.output, 'w') as package:
            for name, data in files.items():
                member = zipfile.ZipInfo(runtime.FOLDER + '/' + name)
                if name == 'assets/future-runtime.dat':
                    alias = b'../../outside.txt'
                    payload = struct.pack('<BL', 1, zlib.crc32(member.filename.encode())) + alias
                    member.extra = struct.pack('<HH', 0x7075, len(payload)) + payload
                package.writestr(member, data)
        with self.assertRaisesRegex(ValueError, 'ZIP filename was normalized or truncated|Unicode ZIP path aliases'):
            self.verify()

    def test_dos_directory_attribute_without_slash_is_rejected(self):
        self.create()
        files = self.read_zip(self.output)
        with zipfile.ZipFile(self.output, 'w') as package:
            for name, data in files.items():
                member = zipfile.ZipInfo(runtime.FOLDER + '/' + name)
                if name == 'assets/future-runtime.dat':
                    member.create_system = 0
                    member.external_attr = 0x10
                package.writestr(member, data)
        with self.assertRaisesRegex(ValueError, 'Explicit ZIP directories'):
            self.verify()

    def test_bounded_read_rejects_member_and_file_count_limits(self):
        self.create()
        with patch.object(runtime, 'MAX_MEMBER_BYTES', 10):
            with self.assertRaisesRegex(ValueError, 'member exceeds size bound'):
                self.verify()
        with patch.object(runtime, 'MAX_FILES', 2):
            with self.assertRaisesRegex(ValueError, 'too many entries'):
                self.verify()

    def test_reference_must_be_immutable_and_never_fetched(self):
        for reference in ['http://github.com/example/repo/actions/runs/1/artifacts/2',
                          'https://example.com/latest.zip',
                          REFERENCE + '?secret=value', REFERENCE + '#fragment']:
            with self.subTest(reference=reference), patch.object(runtime, 'verify_full_archive') as verify:
                with self.assertRaisesRegex(ValueError, 'immutable GitHub'):
                    runtime.create_runtime(self.full, self.output, COMMIT, TREE, reference)
                verify.assert_not_called()

    def test_typed_locator_binds_source_run_and_identity_without_requiring_url(self):
        self.create()
        original = self.output.read_bytes()
        changes = [lambda r: r.update(source_commit='d' * 40),
                   lambda r: r.update(workflow_run_id='18'),
                   lambda r: r.update(repository='another/repository'),
                   lambda r: r.update(artifact_id='24'),
                   lambda r: r.update(url='file:///tmp/evidence.zip')]
        for change in changes:
            with self.subTest(change=change):
                self.output.write_bytes(original)
                self.edit_manifest(lambda m: change(m['full_evidence']['reference']))
                with self.assertRaises(ValueError):
                    self.verify()
        self.output.write_bytes(original)
        self.edit_manifest(lambda m: m['full_evidence']['reference'].pop('url'))
        self.assertEqual(self.verify()['full_native_evidence'], 'not-revalidated')

    def test_existing_output_never_overwritten_and_sidecar_matches(self):
        self.output = self.root / 'original-单人模式.zip'
        self.create()
        original = self.output.read_bytes()
        sidecar = self.output.with_suffix('.zip.sha256').read_text(encoding='utf-8')
        self.assertEqual(sidecar, runtime.file_sha(self.output) + '  ' + self.output.name + '\n')
        with self.assertRaisesRegex(ValueError, 'must be new'):
            runtime.create_runtime(self.full, self.output, COMMIT, TREE, REFERENCE)
        self.assertEqual(self.output.read_bytes(), original)

    def test_publication_io_failure_rolls_back_new_output(self):
        link = runtime.os.link
        calls = []

        def fail_second(staged, destination):
            calls.append(destination)
            if len(calls) == 2:
                raise OSError('Original simulated checksum publication failure')
            return link(staged, destination)

        with patch.object(runtime.os, 'link', side_effect=fail_second):
            with self.assertRaisesRegex(OSError, 'simulated checksum publication failure'):
                self.create()
        self.assertFalse(self.output.exists())
        self.assertFalse(self.output.with_suffix('.zip.sha256').exists())
        self.assertEqual(list(self.root.iterdir()), [self.full])

    def test_publication_race_preserves_existing_user_file(self):
        link = runtime.os.link
        calls = []
        sidecar = self.output.with_suffix('.zip.sha256')
        user_data = b'Original user file created concurrently'

        def concurrent_sidecar(staged, destination):
            calls.append(destination)
            if len(calls) == 2:
                destination.write_bytes(user_data)
            return link(staged, destination)

        with patch.object(runtime.os, 'link', side_effect=concurrent_sidecar):
            with self.assertRaises(FileExistsError):
                self.create()
        self.assertFalse(self.output.exists())
        self.assertEqual(sidecar.read_bytes(), user_data)

    def test_required_licenses_and_metadata_collision_fail_closed(self):
        for name in ['LICENSE', 'START-HERE.md', 'licenses/rust/CARGO-THIRD-PARTY-NOTICES.txt']:
            with self.subTest(name=name):
                changed = json.loads(json.dumps(self.info))
                changed['files'].pop(name)
                changed['file_count'] -= 1
                with self.assertRaisesRegex(ValueError, 'Missing required runtime'):
                    runtime.full_inventory(changed)
        self.info['files'][runtime.MANIFEST] = runtime.record(b'Original collision')
        self.info['file_count'] += 1
        with self.assertRaisesRegex(ValueError, 'Reserved metadata name'):
            runtime.full_inventory(self.info)


if __name__ == '__main__':
    unittest.main()
