"""Original byte fixtures for the bounded diagnostic collector; no GUI proof."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shlex
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zlib

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('vsq_capture_diagnostics', ROOT / 'scripts/collect-vsq-capture-diagnostics.py')
COLLECTOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COLLECTOR)
SHA, TREE, EXE = 'a' * 40, 'b' * 40, 'c' * 64


def original_png():
    def chunk(name, data):
        return struct.pack('>I', len(data)) + name + data + struct.pack('>I', zlib.crc32(name + data))
    pixels = b''.join(b'\0' + bytes((x * 13 + y * 7) % 256 for x in range(12)) for y in range(4))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 4, 4, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b''))


class CaptureDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.evidence = self.root / 'desktop-vsq-song'
        self.output = self.root / 'captures'
        self.evidence.mkdir()
        self.native = {'version': 1, 'scenario': 'vsq-song', 'source_sha': SHA,
                       'source_tree': TREE, 'executable_sha256': EXE, 'ok': False, 'phases': []}
        self.put('native-vsq-song.json', b'\xef\xbb\xbf' + json.dumps(self.native).encode() + b'\r\n')

    def put(self, name, value):
        data = value if isinstance(value, bytes) else (json.dumps(value) + '\r\n').encode()
        (self.evidence / name).write_bytes(data)
        return data

    def phase(self, phase='vsq-seed', sequence=17):
        png_name = f'native-action-{phase}-{sequence}.png'
        png = original_png()
        report = {'version': 1, 'phase': phase, 'ok': False, 'error': 'Later original failure',
                  'screenshots': {'following': sequence}}
        result = {'ok': True, 'native_capture': {'version': 1, 'kind': 'foreground-client-pixels',
                  'phase': phase, 'sequence': sequence, 'file': png_name, 'source_sha': SHA,
                  'source_tree': TREE, 'executable_sha256': EXE, 'bytes': len(png),
                  'sha256': hashlib.sha256(png).hexdigest()}}
        self.put(f'renderer-{phase}.json', report)
        self.put(f'action-{phase}-{sequence}.json', {'version': 1, 'sequence': sequence, 'kind': 'capture'})
        self.put(f'result-{phase}-{sequence}.json', result)
        self.put(f'profile-{phase}.json', {'phase': phase, 'process_id': 101})
        self.put(png_name, png)
        return report, result

    def collect(self, **kwargs):
        return COLLECTOR.collect(self.evidence, self.output, SHA, **kwargs)

    def test_retains_only_exact_original_following_in_separate_bounded_phase_directories(self):
        self.phase()
        self.phase('vsq-restart', 19)
        for name in ['native-failure-vsq-seed.png', 'native-action-vsq-seed-18.png', 'unrelated.json']:
            self.put(name, b'not selected')
        nested = self.evidence / 'webview-profiles'
        nested.mkdir()
        (nested / 'private.json').write_bytes(b'original excluded fixture')
        original = {p.name: p.read_bytes() for p in self.evidence.iterdir() if p.is_file()}
        results = self.collect()
        self.assertEqual(set(p.name for p in self.output.iterdir()), set(COLLECTOR.PHASES))
        for phase, sequence in [('vsq-seed', 17), ('vsq-restart', 19)]:
            row = results[phase]
            self.assertEqual(row['state'], 'capture-retained')
            self.assertTrue(row['capture_binding_checked'])
            self.assertFalse(row['renderer_ok'])  # Later failure does not erase the original image.
            self.assertTrue(row['diagnostic_only'])
            self.assertTrue(row['full_artifact_required_for_acceptance'])
            expected = {'native-vsq-song.json', f'renderer-{phase}.json', f'profile-{phase}.json',
                        f'action-{phase}-{sequence}.json', f'result-{phase}-{sequence}.json',
                        f'native-action-{phase}-{sequence}.png'}
            self.assertEqual({file['path'] for file in row['files']}, expected)
            for file in row['files']:
                data = original[file['path']]
                self.assertEqual((self.output / phase / file['path']).read_bytes(), data)
                self.assertEqual(file['bytes'], len(data))
                self.assertEqual(file['sha256'], hashlib.sha256(data).hexdigest())
            self.assertEqual(json.loads((self.output / phase / COLLECTOR.INVENTORY).read_bytes()), row)
            self.assertLessEqual(sum(p.stat().st_size for p in (self.output / phase).iterdir()), COLLECTOR.MAX_BYTES)
        self.assertEqual({p.name: p.read_bytes() for p in self.evidence.iterdir() if p.is_file()}, original)

    def test_missing_report_or_earlier_failed_capture_is_explicit_without_an_alternate_png(self):
        self.put('renderer-vsq-seed.json', {'version': 1, 'phase': 'vsq-seed', 'ok': False,
                                           'error': 'VSQ report delivery failed'})
        self.put('native-failure-vsq-seed.png', original_png())
        self.put('native-action-vsq-seed-17.png', original_png())
        result = self.collect()
        for phase, row in result.items():
            self.assertEqual(row['state'], 'capture-unavailable')
            self.assertIsNone(row['following_sequence'])
            self.assertFalse(row['capture_binding_checked'])
            self.assertIn('following_sequence_not_recorded', row['missing'])
            self.assertFalse(any(file['path'].endswith('.png') for file in row['files']))
        self.assertIn('renderer-vsq-restart.json', result['vsq-restart']['missing'])

    def test_missing_entire_native_root_is_still_an_honest_diagnostic(self):
        missing = self.root / 'missing'
        result = COLLECTOR.collect(missing, self.output, SHA)
        self.assertTrue(all(not row['evidence_root_present'] and row['files'] == [] for row in result.values()))

    def test_missing_named_png_is_not_replaced_by_a_neighbor(self):
        self.phase()
        (self.evidence / 'native-action-vsq-seed-17.png').unlink()
        self.put('native-action-vsq-seed-18.png', original_png())
        row = self.collect()['vsq-seed']
        self.assertEqual(row['state'], 'capture-unavailable')
        self.assertIn('native-action-vsq-seed-17.png', row['missing'])
        self.assertFalse(any(file['path'].endswith('.png') for file in row['files']))

    def test_rejects_sequence_aliases_duplicates_source_swaps_and_capture_byte_tampering(self):
        report, result = self.phase()
        changes = [
            ('renderer-vsq-seed.json', {**report, 'phase': 'vsq-restart'}),
            *[('renderer-vsq-seed.json', {**report, 'screenshots': {'following': value}})
              for value in [True, 0, 81, 17.0, '../17', '17']],
            ('renderer-vsq-seed.json', b'{"version":1,"phase":"vsq-seed","screenshots":{"following":17,"following":18}}'),
            ('action-vsq-seed-17.json', {'version': 1, 'sequence': 18, 'kind': 'capture'}),
            ('action-vsq-seed-17.json', {'version': 1, 'sequence': 17, 'kind': 'click'}),
            ('native-vsq-song.json', {**self.native, 'source_sha': 'd' * 40}),
        ]
        for key, value in [('phase', 'vsq-restart'), ('sequence', 18), ('file', '../other.png'),
                           ('source_sha', 'd' * 40), ('source_tree', 'd' * 40),
                           ('executable_sha256', 'd' * 64), ('bytes', 1), ('sha256', 'd' * 64)]:
            changed = copy.deepcopy(result)
            changed['native_capture'][key] = value
            changes.append(('result-vsq-seed-17.json', changed))
        for name, value in changes:
            with self.subTest(name=name, value=value):
                original = (self.evidence / name).read_bytes()
                self.put(name, value)
                with self.assertRaises((ValueError, TypeError)):
                    self.collect()
                self.assertFalse(self.output.exists())
                self.put(name, original)

    def test_file_and_inventory_inclusive_total_caps_never_drop_the_image(self):
        self.phase()
        for budget in [1, 100, COLLECTOR.MAX_BYTES + 1]:
            with self.subTest(budget=budget), self.assertRaisesRegex(ValueError, 'bound'):
                self.collect(budget=budget)
            self.assertFalse(self.output.exists())
        with patch.object(COLLECTOR, 'MAX_PNG', 10), self.assertRaisesRegex(ValueError, 'file bound'):
            self.collect()
        self.assertFalse(self.output.exists())

    def test_rejects_output_reuse_nesting_and_lexical_root_aliases(self):
        for output in [self.evidence, self.evidence / 'out', self.root]:
            with self.assertRaises(ValueError):
                COLLECTOR.collect(self.evidence, output, SHA)
        with self.assertRaisesRegex(ValueError, 'aliases'):
            COLLECTOR.collect(str(self.evidence) + '/../desktop-vsq-song', self.output, SHA)
        for output in [str(self.root) + '//out', str(self.root / 'out.'),
                       str(self.root / 'out '), str(self.root / 'NUL'),
                       str(self.root / 'COM1.txt'), str(self.root).upper() + '/out']:
            with self.subTest(output=output), self.assertRaises(ValueError):
                COLLECTOR.collect(self.evidence, output, SHA)
        self.collect()
        before = {str(p.relative_to(self.output)): p.read_bytes() for p in self.output.rglob('*') if p.is_file()}
        with self.assertRaisesRegex(ValueError, 'fresh'):
            self.collect()
        self.assertEqual(before, {str(p.relative_to(self.output)): p.read_bytes() for p in self.output.rglob('*') if p.is_file()})

    def test_rejects_hardlinks_and_case_aliases(self):
        self.phase()
        selected = self.evidence / 'native-action-vsq-seed-17.png'
        linked = self.root / 'alias.png'
        os.link(selected, linked)
        with self.assertRaisesRegex(ValueError, 'Hard-linked'):
            self.collect()
        linked.unlink()
        selected.rename(selected.with_name(selected.name.upper()))
        with self.assertRaisesRegex(ValueError, 'Case-aliased'):
            self.collect()
        self.assertFalse(self.output.exists())

    def test_existing_windows_short_name_cannot_bypass_root_separation(self):
        alias = self.root / 'DESKTO~1'
        original_exists = Path.exists
        # Model Windows resolving an 8.3 alias while directory enumeration
        # returns only the real long name. No link or external file is created.
        with patch.object(Path, 'exists', lambda path: path == alias or original_exists(path)):
            with self.assertRaisesRegex(ValueError, 'short-name-aliased'):
                COLLECTOR.exact_root(alias, missing=True)

    def test_rejects_selected_symlinks_and_linked_ancestors(self):
        self.phase()
        alias = self.root / 'alias'
        try:
            alias.symlink_to(self.evidence, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest('Symlink creation unavailable on this runner')
        with self.assertRaisesRegex(ValueError, 'links|reparse'):
            COLLECTOR.collect(alias, self.output, SHA)
        selected = self.evidence / 'native-action-vsq-seed-17.png'
        outside = self.root / 'outside.png'
        selected.rename(outside)
        selected.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'links|reparse'):
            self.collect()
        self.assertFalse(self.output.exists())

    def test_workflow_retains_both_small_artifacts_and_requires_their_steps(self):
        spec = importlib.util.spec_from_file_location('capture_workflow_parser', ROOT / 'scripts/check-authoring-workflow.py')
        parser = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(parser)
        workflow, _ = parser.parse_workflow((ROOT / '.github/workflows/windows-desktop-acceptance.yml').read_text())
        steps = workflow['jobs']['native-feature-acceptance']['steps']
        required = steps[-1]['env']['ACCEPTANCE_REQUIRED_STEPS'].split(',')
        collect = next(step for step in steps if step.get('id') == 'vsq_capture_collect')
        command = shlex.split(collect['run'].replace('${{ github.workspace }}', self.root.as_posix())
                             .replace('${{ runner.temp }}', self.root.as_posix()).replace('${{ github.sha }}', SHA))
        result = subprocess.run([sys.executable, str(ROOT / command[1]), *command[2:]],
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        for label, phase in [('seed', 'vsq-seed'), ('restart', 'vsq-restart')]:
            upload = next(step for step in steps if step.get('id') == f'vsq_capture_{label}_upload')
            self.assertEqual(upload['with']['name'], 'vsq-following-' + label + '-${{ github.sha }}')
            self.assertEqual(upload['with']['path'], '${{ runner.temp }}/vsq-following-captures/' + phase + '/')
            self.assertEqual(upload['with']['if-no-files-found'], 'error')
            self.assertRegex(upload['uses'], r'^actions/upload-artifact@[0-9a-f]{40}$')
            self.assertIn(upload['id'], required)
            self.assertEqual(upload['if'], 'always()')
        self.assertIn(collect['id'], required)
        self.assertEqual(collect['if'], 'always()')
        self.assertTrue((self.root / 'vsq-following-captures/vsq-seed' / COLLECTOR.INVENTORY).is_file())


if __name__ == '__main__':
    unittest.main()
