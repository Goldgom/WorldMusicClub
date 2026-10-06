"""Original synthetic provenance, never a claim of native build or GUI success."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


native = module('provenance_native_manifest', 'native-release-manifest.py')
delivery = module('provenance_runtime_delivery', 'native-runtime-delivery.py')


def executable():
    data = bytearray(100)
    data[:2] = b'MZ'
    data[60:64] = (64).to_bytes(4, 'little')
    data[64:70] = b'PE\x00\x00\x64\x86'
    return bytes(data)


def metadata():
    return {'name': native.FOLDER, 'executable': native.EXE, 'git_commit': 'a' * 40, 'git_tree': 'b' * 40,
            'commit_count': 557, 'release_label': 'commit-557', 'target': 'x86_64-pc-windows-msvc',
            'app_version': '0.2.0-alpha.1', 'score_schema_revision': 1,
            'rustc_verbose': 'rustc 1.99.0\nhost: x86_64-pc-windows-msvc', 'cargo': 'cargo 1.99.0',
            'node': 'v22.18.0', 'build_platform': 'Windows-original-build',
            'rustflags': '-C target-feature=+crt-static', 'cargo_lock_sha256': 'c' * 64,
            'npm_lock_sha256': 'd' * 64, 'distribution': 'synthetic fixture',
            'acceptance_scope': 'native-windows-only', 'acceptance_workflow_run_id': '12345',
            'checkpoint_requirements': ['Verify WorldMusicClub'], 'runtime_bundled': False,
            'installer': False, 'http_server_process': False}


class BuildProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.exe = self.root / native.EXE
        self.exe.write_bytes(executable())
        (self.root / 'evidence').mkdir()
        with patch.dict(native.os.environ, {'GITHUB_JOB': 'native-feature-acceptance', 'GITHUB_RUN_ATTEMPT': '2'}):
            self.record = native.build_provenance(metadata(), self.exe)
        self.raw = (json.dumps(self.record, ensure_ascii=False, indent=2) + '\n').encode()
        self.provenance = self.root / 'original.json'
        self.provenance.write_bytes(self.raw)
        self.consumer = {**metadata(), 'build_platform': 'Windows-packaging-machine'}

    def bind(self):
        with patch.dict(native.os.environ, {'GITHUB_JOB': 'native-package', 'GITHUB_RUN_ATTEMPT': '2'}):
            return native.bind_build_provenance(self.provenance, self.consumer, self.exe, self.root)

    def test_preserves_original_bytes_and_build_facts_while_labeling_consumer(self):
        value = self.bind()
        self.assertEqual(value['build_platform'], 'Windows-original-build')
        self.assertEqual(value['packaging_environment'], {'job': 'native-package', 'run_attempt': '2',
            'workflow_run_id': '12345', 'platform': 'Windows-packaging-machine'})
        self.assertEqual((self.root / native.BUILD_PROVENANCE).read_bytes(), self.raw)
        native.verify_build_provenance(lambda name: (self.root / name).read_bytes(), value)
        with self.assertRaises(FileExistsError):
            self.bind()

    def test_every_source_lock_and_toolchain_mismatch_blocks_cross_runner_packaging(self):
        for field in metadata().keys() - {'build_platform'}:
            with self.subTest(field=field):
                other = copy.deepcopy(self.record)
                other['source'][field] = 'mismatched'
                with self.assertRaises(ValueError):
                    native.validate_build_provenance(json.dumps(other).encode(), self.consumer, executable())
        for mutation in [lambda r: r.pop('source'), lambda r: r['source'].pop('git_tree'),
                         lambda r: r.update(producer_job='other-job'), lambda r: r.update(run_attempt=''),
                         lambda r: r.update(executable_sha256='e' * 64),
                         lambda r: r.update(executable_bytes=101), lambda r: r.update(format_version=True)]:
            other = copy.deepcopy(self.record)
            mutation(other)
            with self.assertRaises(ValueError):
                native.validate_build_provenance(json.dumps(other).encode(), self.consumer, executable())
        with self.assertRaises(ValueError):
            native.validate_build_provenance(self.raw, self.consumer, executable() + b'changed')

    def test_missing_malformed_or_wrong_job_attempt_provenance_is_rejected(self):
        for raw in [b'', b'{}', b'[]', b'not-json', b' ' * 65537]:
            self.provenance.write_bytes(raw)
            with self.assertRaises(ValueError):
                self.bind()
        self.provenance.write_bytes(self.raw)
        for job, attempt in [('native-feature-acceptance', '2'), ('native-package', '3')]:
            with patch.dict(native.os.environ, {'GITHUB_JOB': job, 'GITHUB_RUN_ATTEMPT': attempt}), self.assertRaises(ValueError):
                native.bind_build_provenance(self.provenance, self.consumer, self.exe, self.root)
        self.provenance.unlink()
        with self.assertRaises(ValueError):
            self.bind()

    def test_archive_reverification_rejects_replaced_builder_or_original_bytes(self):
        value = self.bind()
        for field in ['build_platform', 'git_commit', 'git_tree', 'cargo_lock_sha256', 'node', 'rustflags']:
            changed = copy.deepcopy(value)
            changed[field] = 'replacement'
            with self.assertRaises(ValueError):
                native.verify_build_provenance(lambda name: (self.root / name).read_bytes(), changed)
        (self.root / native.BUILD_PROVENANCE).write_bytes(self.raw + b' ')
        with self.assertRaises(ValueError):
            native.verify_build_provenance(lambda name: (self.root / name).read_bytes(), value)

    def test_original_same_runner_metadata_remains_compatible(self):
        native.verify_build_provenance(lambda _: self.fail('Legacy path must not read a new file'), metadata())
        with self.assertRaises(ValueError):
            native.verify_build_provenance(lambda _: b'', {**metadata(), 'packaging_environment': {}})

    def test_delivery_distinguishes_build_from_actual_packaging_startup_machine(self):
        value = self.bind()
        with patch.dict(delivery.os.environ, {'GITHUB_JOB': 'native-package', 'GITHUB_RUN_ATTEMPT': '2'}), \
                patch.object(delivery.platform, 'platform', return_value='Windows-packaging-machine'):
            environments = delivery.delivery_environments(value, '12345', require_current_environment=True)
            self.assertEqual(environments['original_build']['platform'], 'Windows-original-build')
            self.assertEqual(environments['packaging_and_normal_startup']['platform'], 'Windows-packaging-machine')
            for field, replacement in [('job', 'different-job'), ('run_attempt', '3'),
                                       ('workflow_run_id', '23456'), ('platform', 'Windows-original-build')]:
                changed = copy.deepcopy(value)
                changed['packaging_environment'][field] = replacement
                with self.assertRaises(ValueError):
                    delivery.delivery_environments(changed, '12345', require_current_environment=True)
        with patch.dict(delivery.os.environ, {'GITHUB_JOB': 'offline-auditor', 'GITHUB_RUN_ATTEMPT': '7'}), \
                patch.object(delivery.platform, 'platform', return_value='Linux-auditor'):
            self.assertEqual(delivery.delivery_environments(value, '12345'), environments)
        self.assertIsNone(delivery.delivery_environments(metadata(), '12345'))


if __name__ == '__main__':
    unittest.main()
