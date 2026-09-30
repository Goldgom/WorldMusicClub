"""Ordinary build-notice collector tests using small in-memory Cargo manifests."""
import importlib.util
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('notices', ROOT / 'scripts/prepare-rust-notices.py')
notices = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notices)

class NoticeTests(unittest.TestCase):
    def test_reviewed_license_expressions(self):
        for expression in ('MIT OR Apache-2.0', '(MIT OR Apache-2.0) AND Unicode-3.0', 'Zlib', 'Unlicense'):
            notices.check_license(expression)
        for expression in ('', None, 'Custom-Unknown', 'GPL-3.0-only'):
            with self.assertRaises(ValueError):
                notices.check_license(expression)

    def test_exact_notices_and_deterministic_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / 'third_party/rust').mkdir(parents=True)
            (root / 'third_party/rust/manifest.json').write_text('[]')
            (root / 'LICENSE').write_text('Application license\n')
            crate = root / 'registry/example'
            crate.mkdir(parents=True)
            (crate / 'LICENSE-MIT').write_bytes(b'Copyright example\r\nMIT text\r\n')
            (crate / 'Cargo.toml').write_text('')
            package = {'id': 'example1', 'name': 'example', 'version': '1.0.0', 'license': 'MIT', 'source': 'registry+https://github.com/rust-lang/crates.io-index', 'manifest_path': str(crate / 'Cargo.toml')}
            metadata = {'workspace_members': [], 'packages': [package]}
            first = notices.collect(metadata, root)
            self.assertEqual(first, notices.collect(metadata, root))
            self.assertIn('Copyright example\r\nMIT text\r\n', first[0])
            self.assertNotIn(directory, first[0])
            self.assertNotIn(directory, str(first[1]))
            self.assertEqual(first[1][0]['notices'][0]['bytes'], 29)

    def test_missing_notice_is_not_silently_omitted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / 'third_party/rust').mkdir(parents=True)
            (root / 'third_party/rust/manifest.json').write_text('[]')
            (root / 'Cargo.toml').write_text('')
            metadata = {'workspace_members': [], 'packages': [{'id': 'x', 'name': 'unknown', 'version': '1.0.0', 'license': 'MIT', 'source': 'registry+https://github.com/rust-lang/crates.io-index', 'manifest_path': str(root / 'Cargo.toml')}]}
            with self.assertRaisesRegex(ValueError, 'No distribution notice'):
                notices.collect(metadata, root)

if __name__ == '__main__':
    unittest.main()
