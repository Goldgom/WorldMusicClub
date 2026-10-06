"""Exercise the real bounded diagnostic CLI and its original native ownership."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


COLLECTOR = load('build_export_collector', 'scripts/collect-basic-key-diagnostics.py')
PARSER = load('build_export_parser', 'scripts/check-authoring-workflow.py')
WORKFLOW = PARSER.parse_workflow((ROOT / '.github/workflows/windows-desktop-acceptance.yml').read_text())[0]
SHA = 'a' * 40


class BuildDiagnosticsExportTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.evidence = self.root / 'desktop-build-diagnostics'
        self.output = self.root / 'build-diagnostics-windows-diagnostics'

    def put(self, name, data):
        path = self.evidence / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def collect(self, **kwargs):
        return COLLECTOR.collect(self.evidence, self.output, SHA, scenario='build-diagnostics', **kwargs)

    def ownership(self, document):
        job = document['jobs']['native-feature-acceptance']
        steps = job['steps']
        ids = [step.get('id') for step in steps]
        sequence = ['build_diagnostics_windows', 'build_diagnostics_windows_verify',
                    'build_diagnostics_collect', 'build_diagnostics_upload']
        self.assertEqual(steps[-1]['id'], 'producer_gate')
        for name in sequence:
            self.assertEqual(ids.count(name), 1)
            self.assertEqual(steps[-1]['env']['ACCEPTANCE_REQUIRED_STEPS'].split(',').count(name), 1)
        first = ids.index(sequence[0])
        self.assertEqual(ids[first:first + len(sequence)], sequence)
        producer, verifier, collect, upload = steps[first:first + len(sequence)]
        self.assertIn('-Scenario build-diagnostics', producer['run'])
        self.assertIn('verify-native-build-diagnostics.mjs --check desktop-build-diagnostics', verifier['run'])
        self.assertEqual(verifier['if'], "${{ !cancelled() && steps.build_diagnostics_windows.outcome == 'success' }}")
        for step in [collect, upload]:
            self.assertEqual(step['if'], 'always()')
            self.assertNotIn('continue-on-error', step)
        self.assertEqual(upload['with'], {
            'name': 'build-diagnostics-windows-diagnostics-${{ github.sha }}',
            'path': '${{ runner.temp }}/build-diagnostics-windows-diagnostics/',
            'retention-days': 90, 'if-no-files-found': 'error', 'include-hidden-files': True,
        })
        self.assertRegex(upload['uses'], r'^actions/upload-artifact@[a-f0-9]{40}$')
        self.assertLess(ids.index('build_diagnostics_upload'), ids.index('required_037'))
        self.assertEqual(job['outputs']['build_diagnostics_windows'], '${{ steps.build_diagnostics_windows.outcome }}')
        self.assertEqual(job['outputs']['build_diagnostics_windows_verify'], '${{ steps.build_diagnostics_windows_verify.outcome }}')
        return collect

    def test_actual_workflow_waits_for_phase_and_recheck_then_runs_scoped_collector(self):
        step = self.ownership(WORKFLOW)
        command = shlex.split(step['run'].replace('${{ runner.temp }}', self.root.as_posix()).replace('${{ github.sha }}', SHA))
        self.assertEqual(command[:2], ['python', 'scripts/collect-basic-key-diagnostics.py'])
        self.assertEqual(command[2:], ['desktop-build-diagnostics', str(self.output), '--source-sha', SHA, '--scenario', 'build-diagnostics'])
        self.put('native-build-diagnostics.json', json.dumps({'source_sha': SHA, 'ok': False}).encode())
        result = subprocess.run([sys.executable, str(ROOT / command[1]), *command[2:]], cwd=self.root,
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads((self.output / COLLECTOR.INVENTORY).read_bytes())
        self.assertTrue(manifest['diagnostic_only'])
        self.assertFalse(manifest['full_acceptance'])

    def test_missing_duplicate_partial_or_skipped_ownership_never_confers_acceptance(self):
        for mutation in ['missing_producer', 'missing_recheck', 'too_early', 'duplicate', 'conditional', 'omit_gate', 'wrong_output']:
            with self.subTest(mutation=mutation):
                doc = copy.deepcopy(WORKFLOW)
                job = doc['jobs']['native-feature-acceptance']; steps = job['steps']
                collect = next(s for s in steps if s.get('id') == 'build_diagnostics_collect')
                if mutation.startswith('missing_'):
                    target = 'build_diagnostics_windows' + ('_verify' if mutation == 'missing_recheck' else '')
                    steps.remove(next(s for s in steps if s.get('id') == target))
                elif mutation == 'too_early':
                    index = steps.index(collect); steps[index - 1], steps[index] = steps[index], steps[index - 1]
                elif mutation == 'duplicate':
                    steps.append(copy.deepcopy(collect))
                elif mutation == 'conditional':
                    collect['if'] = 'success()'
                elif mutation == 'omit_gate':
                    steps[-1]['env']['ACCEPTANCE_REQUIRED_STEPS'] = steps[-1]['env']['ACCEPTANCE_REQUIRED_STEPS'].replace('build_diagnostics_windows_verify,', '')
                else:
                    job['outputs']['build_diagnostics_windows'] = '${{ steps.build_diagnostics_upload.outcome }}'
                with self.assertRaises(AssertionError):
                    self.ownership(doc)

    def test_original_13_clicks_all_pngs_profile_proof_and_empty_directory_facts_survive(self):
        files = {
            'native-build-diagnostics.json': b'\xef\xbb\xbf' + json.dumps({'source_sha': SHA, 'ok': True}).encode(),
            'build-diagnostics-proof.json': json.dumps({'source_sha': SHA, 'claims': {'full_acceptance': False}}).encode(),
            'renderer-build-diagnostics.json': b'{"actions":13}\r\n',
            'profile-build-diagnostics.json': b'{"fresh_required":true,"created_new":true}\n',
            'trace-build-diagnostics.json': b'{"events":[]}',
            'snapshot-build-diagnostics-before.json': b'{"files":[]}',
            'snapshot-build-diagnostics-after.json': b'{"files":[]}',
        }
        for number in range(1, 14):
            for kind in ['action', 'result']:
                files[f'{kind}-build-diagnostics-{number}.json'] = json.dumps({'sequence': number}).encode()
            files[f'native-action-build-diagnostics-{number}.png'] = b'\x89PNG\r\n\x1a\n' + bytes([number])
        for name, data in files.items():
            self.put(name, data)
        for name in ['Scores/songs', 'Scores/backups', 'Scores/.staging']:
            (self.evidence / name).mkdir(parents=True)
        for name in ['webview-profiles/build-diagnostics/Preferences.json', 'WebView-private/secret.json',
                     'Scores/catalog/private.json', 'downloads/private.json', 'fixtures/private.png',
                     'credentials.json', 'private.png', 'native.log', 'worldmusichub-desktop.exe',
                     'action-build-diagnostics-33.json']:
            self.put(name, b'excluded private or unrelated bytes')
        result = self.collect()
        self.assertEqual({row['path'] for row in result['files']}, set(files))
        for row in result['files']:
            self.assertEqual(row['sha256'], hashlib.sha256(files[row['path']]).hexdigest())
            self.assertEqual(row['bytes'], len(files[row['path']]))
            self.assertEqual((self.output / row['path']).read_bytes(), files[row['path']])
            self.assertEqual((self.evidence / row['path']).read_bytes(), files[row['path']])
        directories = {row['path']: row for row in result['directories']}
        for name in ['Scores/songs', 'Scores/backups', 'Scores/.staging']:
            self.assertEqual(directories[name], {'path': name, 'present': True, 'empty': True})
        self.assertEqual(directories['Scores/catalog'], {'path': 'Scores/catalog', 'present': True, 'empty': False})
        self.assertEqual(directories['Scores/clean-songs'], {'path': 'Scores/clean-songs', 'present': False, 'empty': None})
        self.assertTrue(result['subset_only'] and result['full_artifact_required_for_acceptance'] and result['diagnostic_only'])
        self.assertEqual(result['source_sha'], SHA)
        self.assertEqual(result['source_reports_checked'], sorted(COLLECTOR.BUILD_SOURCE_REPORTS))
        self.assertEqual(len(list(self.output.iterdir())), len(files) + 1)
        self.assertLessEqual(sum(p.stat().st_size for p in self.output.iterdir()), COLLECTOR.MAX_BYTES)

    def test_missing_and_partial_failure_evidence_is_explicit_diagnostic_only(self):
        for partial in [False, True]:
            with self.subTest(partial=partial):
                if partial:
                    self.output = self.root / 'partial'
                    self.put('action-build-diagnostics-1.json', b'{"sequence":1}')
                    self.put('native-failure-build-diagnostics.png', b'original failure pixels')
                result = self.collect()
                self.assertEqual(result['evidence_root_present'], partial)
                self.assertEqual(len(result['files']), 2 if partial else 0)
                self.assertEqual(result['source_reports_checked'], [])
                self.assertFalse(result['full_acceptance'])
                self.assertTrue(result['diagnostic_only'])
                self.assertTrue(all(not row['present'] and row['empty'] is None for row in result['directories']))

    def test_wrong_source_total_overflow_and_inventory_growth_fail_before_output(self):
        for name in COLLECTOR.BUILD_SOURCE_REPORTS:
            self.put(name, json.dumps({'source_sha': 'b' * 40}).encode())
            with self.assertRaisesRegex(ValueError, 'source SHA'):
                self.collect()
            self.assertFalse(self.output.exists())
            (self.evidence / name).unlink()
        self.put('native-action-build-diagnostics-1.png', b'p' * 500)
        self.put('native-action-build-diagnostics-2.png', b'p' * 500)
        for budget in [999, 1200, COLLECTOR.MAX_BYTES + 1]:
            with self.subTest(budget=budget), self.assertRaises(ValueError):
                self.collect(budget=budget)
            self.assertFalse(self.output.exists())
        self.assertEqual((self.evidence / 'native-action-build-diagnostics-1.png').read_bytes(), b'p' * 500)

    def test_linked_known_files_directories_or_ancestor_paths_fail_before_output(self):
        self.evidence.mkdir()
        outside = self.root / 'outside'; outside.mkdir()
        secret = outside / 'secret.json'; secret.write_bytes(b'private')
        for name, target in [('profile-build-diagnostics.json', secret), ('Scores', outside)]:
            linked = self.evidence / name
            try:
                linked.symlink_to(target, target_is_directory=target.is_dir())
            except (OSError, NotImplementedError):
                self.skipTest('Symlink creation unavailable')
            with self.assertRaises(ValueError):
                self.collect()
            self.assertFalse(self.output.exists())
            linked.unlink()
        ancestor = self.root / 'linked-ancestor'; ancestor.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            COLLECTOR.collect(ancestor / 'missing', self.output, SHA, scenario='build-diagnostics')
        with self.assertRaises(ValueError):
            COLLECTOR.collect(self.evidence, ancestor / 'output', SHA, scenario='build-diagnostics')
        self.assertFalse(self.output.exists())

    def test_known_hardlinks_and_occupied_or_nested_outputs_fail_without_copying(self):
        self.put('renderer-build-diagnostics.json', b'{"original":true}')
        linked = self.evidence / 'trace-build-diagnostics.json'
        os.link(self.evidence / 'renderer-build-diagnostics.json', linked)
        with self.assertRaisesRegex(ValueError, 'Hard-linked'):
            self.collect()
        self.assertFalse(self.output.exists())
        linked.unlink()
        for output in [self.evidence, self.evidence / 'nested']:
            with self.assertRaises(ValueError):
                COLLECTOR.collect(self.evidence, output, SHA, scenario='build-diagnostics')
        self.output.mkdir()
        marker = self.output / 'original.json'; marker.write_bytes(b'original')
        with self.assertRaises(ValueError):
            self.collect()
        self.assertEqual(marker.read_bytes(), b'original')


if __name__ == '__main__':
    unittest.main()
