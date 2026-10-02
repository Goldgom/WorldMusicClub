"""Synthetic provenance failures are not claims of Windows acceptance."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
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
                 'LICENSE': b'MIT', 'schema/worldmusichub-score-v1.schema.json': b'{}',
                 'licenses/engraving/engraving-manifest.json': b'{}',
                 'licenses/engraving/opensheetmusicdisplay.min.js.LICENSE.txt': b'Notice',
                 'licenses/rust/CARGO-THIRD-PARTY-NOTICES.txt': b'Notices',
                 'licenses/rust/RUST-STANDARD-LIBRARY-COPYRIGHT.html': b'Rust copyright',
                 'licenses/rust/sources/example.crate': b'MPL source'}
        for name, data in files.items():
            path = directory / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        notices = {'format_version': 2, 'target': 'x86_64-pc-windows-msvc', 'cargo_lock_sha256': 'a' * 64,
                   'components': [{'source_archive': {'name': 'example.crate', 'sha256': native.sha(b'MPL source'), 'bytes': 10}}],
                   'standard_library': {'copyright_sha256': native.sha(b'Rust copyright'), 'license_texts': []}}
        write_json(directory / 'licenses/rust/manifest.json', notices)
        write_json(directory / 'catalog/index.json', {'version': 1, 'editions': []})
        for name in ['native-acceptance', 'downloaded-files', 'native-report', 'renderer-report', *[f'renderer-{phase}' for phase in native.PHASES]]:
            write_json(directory / f'evidence/{name}.json', {})
        return {'name': native.FOLDER, 'executable': native.EXE, 'cargo_lock_sha256': 'a' * 64, 'git_commit': 'b' * 40, 'commit_count': 164}

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
        return startup, acceptance, exe

    def test_distinct_native_zip_preserves_inventory_and_detects_altered_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / native.FOLDER
            metadata = self.package(directory)
            native.create_manifest(directory, metadata)
            archive = root / 'native.zip'
            native.create_archive(directory, archive)
            self.assertEqual(native.verify_archive(archive)['commit_count'], 164)
            self.assertTrue(archive.with_suffix('.zip.sha256').is_file())
            (directory / native.EXE).write_bytes(executable() + b'changed')
            with self.assertRaisesRegex(ValueError, 'checksum differs'):
                native.create_archive(directory, archive)

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
            git('config', 'core.excludesFile', os.devnull)
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
