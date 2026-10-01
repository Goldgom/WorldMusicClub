"""CLI provenance guards only; mocked host/toolchain calls are not a Windows build."""
import contextlib
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('release_cli', ROOT / 'scripts/release-manifest.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseCliTests(unittest.TestCase):
    def invoke(self, *, requested_sha='a' * 40, requested_count=100, dirty='', system='Windows', host='x86_64-pc-windows-msvc'):
        commands = {
            ('git', 'rev-parse', 'HEAD'): 'a' * 40,
            ('git', 'rev-list', '--count', 'HEAD'): '100',
            ('git', 'status', '--porcelain'): dirty,
            ('git', 'rev-parse', 'HEAD^{tree}'): 'c' * 40,
            ('rustc', '-vV'): 'rustc test-fixture\nhost: ' + host,
            ('rustc', '--version'): 'rustc test-fixture',
            ('cargo', '--version'): 'cargo test-fixture',
            ('node', '--version'): 'node test-fixture',
        }
        def output(command, **kwargs):
            self.assertIn(tuple(command), commands)
            self.assertTrue(kwargs.get('text'))
            return commands[tuple(command)]
        args = ['release-manifest', 'create', 'fixture-package', '--commit', requested_sha, '--count', str(requested_count)]
        with patch('sys.argv', args), patch.object(release.subprocess, 'check_output', side_effect=output), patch.object(release.platform, 'system', return_value=system), patch.object(release.platform, 'platform', return_value='Windows-test-fixture'), patch.object(release, 'create_manifest') as create, contextlib.redirect_stdout(io.StringIO()):
            try:
                release.main()
            except ValueError:
                create.assert_not_called()
                raise
            create.assert_called_once()
            return create.call_args.args

    def test_wrong_commit_count_and_dirty_sources_never_create_a_release_inventory(self):
        for options, message in [({'requested_sha': 'b' * 40}, 'does not match'), ({'requested_count': 99}, 'does not match'), ({'dirty': ' M README.md'}, 'must be clean')]:
            with self.subTest(options=options), self.assertRaisesRegex(ValueError, message):
                self.invoke(**options)

    def test_non_windows_or_non_native_host_cannot_claim_native_acceptance(self):
        for options, message in [({'system': 'Linux'}, 'created on Windows'), ({'host': 'x86_64-unknown-linux-gnu'}, 'native Windows x64 MSVC')]:
            with self.subTest(options=options), self.assertRaisesRegex(ValueError, message):
                self.invoke(**options)

    def test_matching_guard_inputs_pass_exact_provenance_to_the_package_writer(self):
        directory, metadata = self.invoke()
        self.assertEqual(directory, Path('fixture-package'))
        self.assertEqual(metadata['git_commit'], 'a' * 40)
        self.assertEqual(metadata['git_tree'], 'c' * 40)
        self.assertEqual(metadata['commit_count'], 100)
        self.assertEqual(metadata['release_label'], 'commit-100')
        self.assertIsNone(metadata['recovery_for'])
        self.assertEqual(metadata['target'], 'x86_64-pc-windows-msvc')
        self.assertEqual(metadata['score_schema_revision'], 2)
        self.assertEqual(len(metadata['cargo_lock_sha256']), 64)
        self.assertEqual(len(metadata['npm_lock_sha256']), 64)
        self.assertEqual(metadata['rustc'], 'rustc test-fixture')
        self.assertIn('not verified', metadata['distribution'])


if __name__ == '__main__':
    unittest.main()
