"""Original tiny packaging fixtures; never Windows or checkpoint acceptance."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


delivery = load('native_runtime_delivery', 'scripts/native-runtime-delivery.py')
fixtures = load('runtime_original_fixtures', 'tests/test_native_runtime_package.py')
runtime = delivery.runtime


class RuntimeDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.RuntimePackageTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root
        self.full = self.fixture.full
        self.archive = self.fixture.output
        self.destination = self.root / 'fresh-runtime'
        self.extracted = self.destination / runtime.FOLDER
        self.full_startup = self.root / 'full-startup'
        self.runtime_startup = self.root / 'runtime-startup'
        self.fixture.payload.update({
            'evidence/native-report.json': runtime.json_bytes({'source_sha': fixtures.COMMIT,
                'executable_sha256': runtime.sha(fixtures.original_executable()),
                'renderer_origin': 'https://wmh.localhost'}),
            'evidence/renderer-report.json': runtime.json_bytes({'origin': 'https://wmh.localhost', 'ok': True}),
        })
        self.build()
        self.identity = {'expected_sha256': runtime.file_sha(self.archive),
                         'expected_full_sha256': runtime.file_sha(self.full),
                         'commit': fixtures.COMMIT, 'tree': fixtures.TREE, 'run_id': '17',
                         'repository': 'example/original-fixture', 'full_artifact_id': '23'}
        delivery.extract_runtime(self.archive, self.destination, **self.identity)
        self.report = {'version': 1, 'source_sha': fixtures.COMMIT, 'source_tree': fixtures.TREE,
                       'commit_count': 999, 'executable_sha256': runtime.sha(fixtures.original_executable()),
                       'workflow_run_id': '17', 'native_process_id': 42,
                       'normal_startup': True, 'ok': True, 'normal_close': True,
                       'test_hooks_enabled': False, 'clean_machine_installation': False,
                       'window_title': 'WorldMusicClub', 'window_width': 960, 'window_height': 640,
                       'sampled_client_colors': 40, 'executable_tcp_listeners': 0,
                       'startup_control': {'automation_id': 'home-single-player', 'name': 'Original fixture control',
                                           'enabled': True, 'offscreen': False}}
        for directory, package in [(self.full_startup, self.root / 'full-extracted' / runtime.FOLDER),
                                   (self.runtime_startup, self.extracted)]:
            directory.mkdir()
            (directory / delivery.REPORT).write_bytes(runtime.json_bytes({**self.report,
                'package_directory': str(package), 'executable_path': str(package / runtime.EXE)}))
            # A literal original byte fixture, deliberately not a GUI screenshot.
            (directory / delivery.SCREENSHOT).write_bytes(b'\x89PNG\r\n\x1a\nORIGINAL-SYNTHETIC-NOT-A-WINDOW')
            (directory / delivery.LOG).write_bytes(b'Original synthetic startup log\n')

    def build(self):
        fixture = self.fixture
        fixture.info['files'] = {name: runtime.record(data) for name, data in fixture.payload.items()}
        fixture.info['file_count'] = len(fixture.payload)
        data = runtime.json_bytes(fixture.info)
        fixture.full_files = {**fixture.payload, runtime.INFO: data,
                              runtime.SUMS: runtime.checksum_bytes({**fixture.info['files'], runtime.INFO: runtime.record(data)})}
        fixture.write_zip(fixture.full, fixture.full_files)
        self.manifest = fixture.create()

    def record(self, **changes):
        args = {'archive': self.archive, 'full_archive': self.full, 'extracted': self.extracted,
                'full_startup': self.full_startup, 'runtime_startup': self.runtime_startup, **self.identity, **changes}
        # Substitute only the full semantic acceptance boundary. Real Windows
        # startup never ran; these tests exercise byte/identity/report contracts.
        with patch.object(runtime, 'verify_full_archive', return_value=self.fixture.info) as full_check:
            result = delivery.delivery_record(**args)
        full_check.assert_called_once()
        return result

    def test_binds_both_archives_original_inventory_and_both_final_startups(self):
        result = self.record()
        self.assertEqual(result['source'], self.manifest['source'])
        self.assertEqual(result['runtime_archive']['sha256'], runtime.file_sha(self.archive))
        self.assertEqual(result['full_evidence'], self.manifest['full_evidence'])
        self.assertEqual(result['runtime_verification']['full_native_evidence'], 'revalidated')
        self.assertEqual(result['checkpoint_acceptance'], 'not-asserted')
        self.assertFalse(result['origin']['ordinary_startup_origin_observed'])
        self.assertEqual(result['origin']['basis'], 'same-executable-full-startup-evidence')
        for key, path in [('full_normal_startup', self.full_startup), ('runtime_normal_startup', self.runtime_startup)]:
            self.assertEqual(set(result[key]), {delivery.REPORT, delivery.SCREENSHOT, delivery.LOG})
            for name, bound in result[key].items():
                self.assertEqual(bound, runtime.record((path / name).read_bytes()))
        self.assertNotEqual(result['full_normal_startup'][delivery.REPORT], result['runtime_normal_startup'][delivery.REPORT])
        self.assertEqual((self.extracted / 'assets/future-runtime.dat').read_bytes(), self.fixture.payload['assets/future-runtime.dat'])
        self.assertFalse((self.extracted / 'evidence').exists())
        self.assertEqual(self.fixture.read_zip(self.full), self.fixture.full_files)

    def test_trusted_identity_rejects_source_repository_run_artifact_and_digest_changes(self):
        for key, bad in [('commit', 'd' * 40), ('tree', 'd' * 40), ('repository', 'example/wrong'),
                         ('run_id', '18'), ('full_artifact_id', '24'), ('expected_sha256', 'd' * 64),
                         ('expected_full_sha256', 'd' * 64)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                delivery.checked_runtime(self.archive, **{**self.identity, key: bad})

    def test_sidecar_and_archive_are_required_as_a_complete_pair(self):
        sidecar = self.archive.with_suffix('.zip.sha256')
        good = sidecar.read_bytes()
        for bad in [b'', b'forged', good.replace(self.archive.name.encode(), b'other.zip')]:
            sidecar.write_bytes(bad)
            with self.assertRaisesRegex(ValueError, 'sidecar'):
                delivery.checked_runtime(self.archive, **self.identity)
        sidecar.unlink()
        with self.assertRaises(FileNotFoundError):
            delivery.checked_runtime(self.archive, **self.identity)

    def test_fresh_extraction_fails_closed_before_any_files_for_bad_identity(self):
        destination = self.root / 'must-not-exist'
        with self.assertRaises(ValueError):
            delivery.extract_runtime(self.archive, destination, **{**self.identity, 'run_id': '18'})
        self.assertFalse(destination.exists())
        with self.assertRaisesRegex(ValueError, 'must be new'):
            delivery.extract_runtime(self.archive, self.destination, **self.identity)

    def test_every_extracted_member_and_metadata_is_checked(self):
        for name in ['assets/future-runtime.dat', 'catalog/index.json', runtime.EXE, runtime.INFO,
                     runtime.MANIFEST, runtime.SUMS, runtime.FULL_SUMS, 'licenses/rust/sources/original.crate']:
            path = self.extracted / name
            original = path.read_bytes()
            with self.subTest(name=name):
                path.write_bytes(original + b'corruption')
                with self.assertRaisesRegex(ValueError, 'bytes differ'):
                    delivery.checked_extracted(self.archive, self.extracted)
                path.unlink()
                with self.assertRaisesRegex(ValueError, 'inventory differs'):
                    delivery.checked_extracted(self.archive, self.extracted)
                path.write_bytes(original)
        extra = self.extracted / 'evidence'
        extra.mkdir()
        with self.assertRaisesRegex(ValueError, 'inventory differs'):
            delivery.checked_extracted(self.archive, self.extracted)
        extra.rmdir()
        extra.write_bytes(b'Unknown added file')
        with self.assertRaisesRegex(ValueError, 'Unexpected extracted member'):
            delivery.checked_extracted(self.archive, self.extracted)

    def test_symlink_extracted_and_startup_members_are_rejected(self):
        target = self.root / 'outside'
        target.write_bytes(b'Original linked data')
        link = self.extracted / 'linked'
        try:
            link.symlink_to(target)
        except OSError as error:
            self.skipTest(f'Host cannot create symlinks: {error}')
        with self.assertRaisesRegex(ValueError, 'Linked extracted'):
            delivery.checked_extracted(self.archive, self.extracted)
        link.unlink()
        report = self.runtime_startup / delivery.REPORT
        report.unlink()
        report.symlink_to(target)
        with self.assertRaisesRegex(ValueError, 'Not a regular file'):
            delivery.startup_evidence(self.runtime_startup, self.manifest)

    def test_stale_failed_skipped_or_overclaimed_startup_cannot_bind(self):
        path = self.runtime_startup / delivery.REPORT
        original = runtime.parse_json(path.read_bytes())
        cases = [('version', 2), ('source_sha', 'd' * 40), ('source_tree', 'd' * 40),
                 ('executable_sha256', 'd' * 64), ('commit_count', 998), ('workflow_run_id', '18'),
                 ('native_process_id', False), ('normal_startup', False), ('ok', False), ('normal_close', False),
                 ('test_hooks_enabled', True), ('clean_machine_installation', True), ('window_title', 'Wrong'),
                 ('window_width', 400), ('window_height', 200), ('sampled_client_colors', 0),
                 ('executable_tcp_listeners', 1), ('executable_tcp_listeners', False),
                 ('startup_control', {}), ('package_directory', 'relative'), ('executable_path', '/wrong.exe')]
        for key, value in cases:
            with self.subTest(key=key):
                path.write_bytes(runtime.json_bytes({**original, key: value}))
                with self.assertRaises(ValueError):
                    delivery.startup_evidence(self.runtime_startup, self.manifest, self.extracted)
                changed = dict(original)
                del changed[key]
                path.write_bytes(runtime.json_bytes(changed))
                with self.assertRaises(ValueError):
                    delivery.startup_evidence(self.runtime_startup, self.manifest, self.extracted)
        for extra in ['error', 'release_ready', 'audibility', 'checkpoint_accepted']:
            with self.subTest(extra=extra):
                path.write_bytes(runtime.json_bytes({**original, extra: True}))
                with self.assertRaisesRegex(ValueError, 'report fields'):
                    delivery.startup_evidence(self.runtime_startup, self.manifest, self.extracted)
        path.write_bytes(runtime.json_bytes(original))

    def test_copied_full_startup_cannot_substitute_for_runtime_startup(self):
        (self.runtime_startup / delivery.REPORT).write_bytes((self.full_startup / delivery.REPORT).read_bytes())
        with self.assertRaisesRegex(ValueError, 'different extracted directory'):
            self.record()
        with self.assertRaisesRegex(ValueError, 'roots must differ'):
            self.record(runtime_startup=self.full_startup)

    def test_startup_evidence_rejects_missing_screenshot_and_extra_profile(self):
        screenshot = self.runtime_startup / delivery.SCREENSHOT
        screenshot.write_bytes(b'Not a PNG')
        with self.assertRaisesRegex(ValueError, 'not PNG'):
            self.record()
        screenshot.unlink()
        with self.assertRaisesRegex(ValueError, 'inventory differs'):
            self.record()
        screenshot.write_bytes(b'\x89PNG\r\n\x1a\nOriginal')
        (self.runtime_startup / 'webview-profile').mkdir()
        with self.assertRaisesRegex(ValueError, 'inventory differs'):
            self.record()

    def test_real_full_verifier_does_not_accept_synthetic_fixture(self):
        with self.assertRaisesRegex(ValueError, 'exact source checkout'):
            delivery.delivery_record(self.archive, self.full, self.extracted, self.full_startup,
                                     self.runtime_startup, **self.identity)

    def test_origin_must_come_from_same_executable_full_evidence(self):
        self.archive.unlink()
        self.archive.with_suffix('.zip.sha256').unlink()
        self.fixture.payload['evidence/renderer-report.json'] = runtime.json_bytes({'origin': 'https://wrong.invalid', 'ok': True})
        self.build()
        self.identity['expected_sha256'] = runtime.file_sha(self.archive)
        self.identity['expected_full_sha256'] = runtime.file_sha(self.full)
        self.destination = self.root / 'second-runtime'
        self.extracted = self.destination / runtime.FOLDER
        delivery.extract_runtime(self.archive, self.destination, **self.identity)
        path = self.runtime_startup / delivery.REPORT
        report = runtime.parse_json(path.read_bytes())
        report.update(package_directory=str(self.extracted), executable_path=str(self.extracted / runtime.EXE))
        path.write_bytes(runtime.json_bytes(report))
        with self.assertRaisesRegex(ValueError, 'full startup origin differs'):
            self.record()


if __name__ == '__main__':
    unittest.main()
