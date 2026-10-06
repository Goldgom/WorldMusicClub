"""The additive runtime must never bypass complete native/checkpoint gates."""
from pathlib import Path
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / '.github/workflows/windows-desktop-acceptance.yml'
GATES = ['native_full_portable', 'native_full_upload', 'native_runtime_package', 'native_runtime_verify',
         'native_runtime_startup', 'native_runtime_delivery', 'native_runtime_delivery_verify',
         'native_runtime_upload', 'native_runtime_evidence']


class RuntimeWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.workflow = yaml.safe_load(WORKFLOW.read_text())
        self.native = self.workflow['jobs']['native-feature-acceptance']
        self.steps = self.native['steps']
        self.by_id = {step['id']: step for step in self.steps if 'id' in step}

    def test_runtime_has_mandatory_ordered_gates_after_unchanged_full_package(self):
        previous = self.steps.index(self.by_id['native_package'])
        for name in GATES:
            step = self.by_id[name]
            current = self.steps.index(step)
            self.assertGreater(current, previous)
            previous = current
            self.assertNotIn('continue-on-error', step)
            self.assertEqual(step.get('if'), 'always()' if name == 'native_runtime_evidence' else None)
            self.assertEqual(self.native['outputs'][name], '${{ steps.' + name + '.outcome }}')
        package = self.by_id['native_package']['run']
        self.assertIn('native-release-manifest.py create', package)
        self.assertIn('native-release-manifest.py archive', package)
        for scope in ['startup', 'acceptance', 'song-folder', 'performance-song', 'pitch-bend',
                      'song-authoring', 'vsq-authoring', 'basic-key', 'canonical-practice', 'catalog-evidence']:
            self.assertIn('--' + scope + ' ', package)
        self.assertIn('Expand-Archive', self.by_id['native_full_portable']['run'])
        self.assertIn('windows-native-portable-smoke.ps1', self.by_id['native_full_portable']['run'])
        self.assertIn('-OutputDirectory desktop-portable', self.by_id['native_full_portable']['run'])

    def test_full_identity_is_uploaded_first_and_both_uploads_use_disjoint_exact_bytes(self):
        full = self.by_id['native_full_upload']['with']
        self.assertEqual(full['name'], 'WorldMusicClub-Native-Candidate-Windows-x64-commit-${{ steps.native_package.outputs.count }}-${{ github.sha }}')
        self.assertEqual(full['path'].splitlines(), ['dist/WorldMusicClub-Native-Windows-x64-*.zip',
                                                   'dist/WorldMusicClub-Native-Windows-x64-*.zip.sha256'])
        create = self.by_id['native_runtime_package']['run']
        self.assertIn("create '${{ steps.native_package.outputs.archive }}' $zip", create)
        self.assertIn("--commit '${{ github.sha }}' --tree '${{ steps.acceptance_source.outputs.source_tree }}'", create)
        self.assertIn('https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }}/artifacts/${{ steps.native_full_upload.outputs.artifact-id }}', create)
        self.assertIn("steps.native_full_upload.outputs.artifact-url }}' -cne $reference", create)
        self.assertIn('Get-FileHash $zip -Algorithm SHA256', create)
        self.assertIn('Full ZIP changed after its verified pre-upload digest', create)
        self.assertIn('Get-FileHash $zip -Algorithm SHA256', self.by_id['native_package']['run'])
        candidate = self.by_id['native_runtime_upload']['with']
        self.assertEqual(candidate['name'], 'WorldMusicClub-Native-Runtime-Candidate-Windows-x64-commit-${{ steps.native_package.outputs.count }}-${{ github.sha }}')
        self.assertEqual(candidate['path'].splitlines(), ['${{ steps.native_runtime_package.outputs.archive }}',
                                                         '${{ steps.native_runtime_package.outputs.archive }}.sha256'])
        for step in (full, candidate):
            self.assertEqual(step['if-no-files-found'], 'error')

    def test_runtime_independent_verification_and_normal_startup_use_trusted_producer_identity(self):
        verify = self.by_id['native_runtime_verify']['run']
        self.assertIn("native-runtime-package.py verify '${{ steps.native_runtime_package.outputs.archive }}' --expected-sha256 '${{ steps.native_runtime_package.outputs.sha256 }}'", verify)
        startup = self.by_id['native_runtime_startup']['run']
        self.assertIn('windows-native-runtime-smoke.ps1', startup)
        for name in ['Archive', 'ExpectedSha256', 'ExpectedFullSha256', 'Destination', 'OutputDirectory', 'Commit', 'Tree', 'RunId', 'Repository', 'FullArtifactId']:
            self.assertIn('-' + name + ' ', startup)
        self.assertIn('wmh-native-runtime-extracted', startup)
        self.assertIn('native-runtime-evidence', startup)
        wrapper = (ROOT / 'scripts/windows-native-runtime-smoke.ps1').read_text()
        self.assertLess(wrapper.index('native-runtime-delivery.py'), wrapper.index('windows-native-portable-smoke.ps1'))
        self.assertIn("if ($LASTEXITCODE -ne 0) { throw", wrapper)
        self.assertNotIn('Expand-Archive', wrapper)
        smoke = (ROOT / 'scripts/windows-native-portable-smoke.ps1').read_text()
        for check in ["$env:WMH_DESKTOP_SMOKE_DIR=$null", "$env:WMH_DESKTOP_ACCEPTANCE_PHASE=$null",
                      '$app.CloseMainWindow()', '$app.WaitForExit(10000)', 'Get-NetTCPConnection -State Listen -ErrorAction Stop',
                      'home-single-player', 'PrintWindow', 'package_directory=$Directory', 'workflow_run_id=$env:GITHUB_RUN_ID']:
            self.assertIn(check, smoke)
        self.assertNotIn('native-runtime-package.py', smoke, 'Keep the full consumer independent of runtime inventory')

    def test_post_package_record_is_independently_reverified_before_runtime_upload(self):
        for name, command in [('native_runtime_delivery', 'create'), ('native_runtime_delivery_verify', 'verify')]:
            step = self.by_id[name]['run']
            self.assertIn('native-runtime-delivery.py ' + command, step)
            for flag in ['archive', 'expected-sha256', 'expected-full-sha256', 'full-archive', 'extracted', 'full-startup',
                         'runtime-startup', 'record', 'commit', 'tree', 'run-id', 'repository', 'full-artifact-id']:
                self.assertIn('--' + flag + ' ', step)
            self.assertIn("if ($LASTEXITCODE -ne 0) { throw", step)
        self.assertIn('Get-FileHash', self.by_id['native_runtime_delivery_verify']['run'])

    def test_raw_proof_and_runtime_have_equal_retention_and_failure_evidence_stays_enabled(self):
        for job in ['bulk-import-browser', 'native-feature-acceptance']:
            uploads = [step for step in self.workflow['jobs'][job]['steps'] if step.get('uses', '').startswith('actions/upload-artifact@')]
            self.assertTrue(uploads)
            for upload in uploads:
                self.assertEqual(upload['with']['retention-days'], 90, upload['name'] if 'name' in upload else upload['with']['name'])
        original = next(step for step in self.steps if step.get('with', {}).get('name') == 'native-feature-evidence-${{ github.sha }}')
        self.assertEqual(original['if'], 'always()')
        for root in ['desktop-startup', 'desktop-acceptance', 'desktop-song-folder', 'desktop-bulk-import', 'desktop-clean-song',
                     'desktop-vsq-song', 'desktop-performance-song', 'desktop-pitch-bend', 'desktop-vsq-authoring',
                     'desktop-complete-practice', 'desktop-basic-key', 'desktop-authoring', 'desktop-portable']:
            self.assertIn(root + '/*.json', original['with']['path'])
            self.assertIn(root + '/*.png', original['with']['path'])
        runtime_proof = self.by_id['native_runtime_evidence']['with']['path']
        self.assertIn('native-runtime-evidence/delivery.json', runtime_proof)
        for suffix in ['*.json', '*.png', '*.log']:
            self.assertIn('native-runtime-evidence/startup/' + suffix, runtime_proof)
        self.assertNotIn('profile', runtime_proof)
        self.assertNotIn('**', runtime_proof)

    def test_summary_requires_all_runtime_outcomes_and_keeps_separate_full_checkpoint(self):
        summary = self.workflow['jobs']['acceptance-summary']
        self.assertEqual(summary['needs'], ['bulk-import-browser', 'native-feature-acceptance'])
        self.assertEqual(summary['if'], '${{ always() }}')
        program = summary['steps'][0]['run']
        for name in GATES:
            self.assertIn("'" + name + "'", program)
        self.assertIn('The separate full Verify WorldMusicClub workflow must also succeed for this exact source', program)
        for key in ['full_artifact_id', 'runtime_artifact_id', 'runtime_evidence_id', 'full_sha256', 'runtime_sha256', 'delivery_sha256']:
            self.assertIn(key, self.native['outputs'])
            self.assertIn(key, program)
        check = yaml.safe_load((ROOT / '.github/workflows/check.yml').read_text())
        self.assertTrue(any("python -m unittest discover -s tests -p 'test_*.py'" in step.get('run', '')
                            for job in check['jobs'].values() for step in job['steps']))


if __name__ == '__main__':
    unittest.main()
