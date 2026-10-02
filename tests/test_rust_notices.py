"""Ordinary build-notice collector tests using small in-memory Cargo manifests."""
import importlib.util
import json
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('notices', ROOT / 'scripts/prepare-rust-notices.py')
notices = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notices)

class NoticeTests(unittest.TestCase):
    def fixture(self, directory, name='example', version='1.0.0', license='MIT'):
        root = pathlib.Path(directory)
        (root / 'third_party/rust').mkdir(parents=True)
        (root / 'third_party/rust/manifest.json').write_text('[]')
        crate = root / 'registry/src/crates-io' / f'{name}-{version}'
        crate.mkdir(parents=True)
        (crate / 'Cargo.toml').write_text('')
        package = {'id': name + version, 'name': name, 'version': version,
                   'license': license, 'source': notices.REGISTRY,
                   'manifest_path': str(crate / 'Cargo.toml')}
        return root, crate, package, {'workspace_members': [], 'packages': [package]}

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

    def test_british_spelling_nested_and_declared_notices(self):
        with tempfile.TemporaryDirectory() as directory:
            root, crate, package, metadata = self.fixture(directory)
            (crate / 'LICENCE').write_text('Main license\n')
            (crate / 'src/spin').mkdir(parents=True)
            (crate / 'src/spin/LICENSE').write_text('Nested attribution\n')
            (crate / 'terms.txt').write_text('Declared license\n')
            (crate / 'src/copying.rs').write_text('Not a license document')
            package['license_file'] = 'terms.txt'
            text, components, _ = notices.collect(metadata, root)
            self.assertEqual([n['name'] for n in components[0]['notices']],
                             ['LICENCE', 'src/spin/LICENSE', 'terms.txt'])
            self.assertIn('Nested attribution', text)
            self.assertNotIn('Not a license document', text)

    def test_fallback_is_version_pinned_and_hash_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            root, crate, package, metadata = self.fixture(directory)
            fallback = root / 'third_party/rust/example-LICENSE'
            data = b'Exact upstream notice\n'
            fallback.write_bytes(data)
            manifest = [{'file': fallback.name, 'sha256': notices.digest(data),
                         'packages': [{'name': 'example', 'version': '1.0.0', 'selected_license': 'MIT'}]}]
            (fallback.parent / 'manifest.json').write_text(json.dumps(manifest))
            first = notices.collect(metadata, root)
            self.assertEqual(first, notices.collect(metadata, root))
            self.assertEqual(first[1][0]['selected_license'], 'MIT')
            fallback.write_text('Altered notice')
            with self.assertRaisesRegex(ValueError, 'Changed reviewed fallback'):
                notices.collect(metadata, root)
            package['version'] = '1.0.1'
            with self.assertRaisesRegex(ValueError, 'No distribution notice'):
                notices.collect(metadata, root)

    def test_mpl_includes_exact_offline_source_and_rejects_changed_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            root, crate, package, metadata = self.fixture(directory, license='MPL-2.0')
            (crate / 'LICENSE').write_text('MPL-2.0 text\n')
            source = b'Original registry archive bytes\x00\xff'
            cache = root / 'registry/cache/crates-io'
            cache.mkdir(parents=True)
            archive = cache / 'example-1.0.0.crate'
            archive.write_bytes(source)
            (root / 'Cargo.lock').write_text(
                'version = 4\n[[package]]\nname = "example"\nversion = "1.0.0"\n'
                f'source = "{notices.REGISTRY}"\nchecksum = "{notices.digest(source)}"\n')
            text, components, sources = notices.collect(metadata, root, target='x86_64-pc-windows-msvc')
            self.assertEqual(sources, [('example-1.0.0.crate', source)])
            self.assertEqual(components[0]['source_archive']['sha256'], notices.digest(source))
            self.assertIn('sources/example-1.0.0.crate', text)
            self.assertIn('x86_64-pc-windows-msvc', text)
            self.assertNotIn(directory, str(components))
            archive.write_bytes(b'Changed source')
            with self.assertRaisesRegex(ValueError, 'does not match Cargo.lock'):
                notices.collect(metadata, root)

    def test_unreviewed_option_requires_exact_package_selection(self):
        with tempfile.TemporaryDirectory() as directory:
            root, crate, package, metadata = self.fixture(directory, name='dunce', version='1.0.5', license='CC0-1.0 OR MIT-0 OR Apache-2.0')
            (crate / 'LICENSE').write_text('CC0 text\n')
            self.assertEqual(notices.collect(metadata, root)[1][0]['selected_license'], 'CC0-1.0')
            package['version'] = '1.0.6'
            with self.assertRaisesRegex(ValueError, 'Unreviewed Cargo license'):
                notices.collect(metadata, root)

    def test_absent_declared_notice_fails_even_with_another_license(self):
        with tempfile.TemporaryDirectory() as directory:
            root, crate, package, metadata = self.fixture(directory)
            (crate / 'LICENSE').write_text('Main license\n')
            package['license_file'] = 'missing.txt'
            with self.assertRaisesRegex(ValueError, 'Expected regular notice'):
                notices.collect(metadata, root)

    def test_bundled_vendor_notices_require_matching_library_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root, crate, package, metadata = self.fixture(directory)
            (crate / 'LICENSE').write_text('Rust wrapper MIT notice\n')
            (crate / 'loader.lib').write_bytes(b'Exact vendor library')
            vendor = root / 'third_party/rust/vendor-LICENSE'
            vendor.write_text('Vendor BSD notice\n')
            component = {'name': 'Vendor loader', 'version': '2.0', 'license': 'BSD-3-Clause'}
            manifest = [{'file': vendor.name, 'sha256': notices.digest(vendor.read_bytes()),
                         'component': component, 'supplement_for': [{'name': 'example', 'version': '1.0.0'}],
                         'bundled_files': [{'path': 'loader.lib', 'sha256': notices.digest(b'Exact vendor library')}]}]
            (vendor.parent / 'manifest.json').write_text(json.dumps(manifest))
            text, components, _ = notices.collect(metadata, root)
            self.assertIn('Rust wrapper MIT notice', text)
            self.assertIn('Vendor BSD notice', text)
            self.assertEqual(components[0]['bundled_components'], [component])
            (crate / 'loader.lib').write_bytes(b'Different vendor library')
            with self.assertRaisesRegex(ValueError, 'Changed reviewed bundled file'):
                notices.collect(metadata, root)

if __name__ == '__main__':
    unittest.main()
