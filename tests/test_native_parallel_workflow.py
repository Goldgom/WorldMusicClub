"""Guard the actual dependency graph and mandatory entry points, without GUI."""
import copy
import importlib.util
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('parallel_workflow_parser', ROOT / 'scripts/check-authoring-workflow.py')
PARSER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PARSER)
PRODUCERS = ['bulk-import-browser', 'windows-pure-checks', 'native-feature-acceptance']
JOBS = [*PRODUCERS, 'native-package']


def document():
    return PARSER.parse_workflow((ROOT / '.github/workflows/windows-desktop-acceptance.yml').read_text(encoding='utf-8'))[0]


class ParallelWorkflowTests(unittest.TestCase):
    def contract(self, workflow):
        jobs = workflow['jobs']
        self.assertEqual(workflow['permissions'], {'contents': 'read'})
        for name in PRODUCERS:
            job = jobs[name]
            self.assertNotIn('needs', job)
            self.assertNotIn('if', job)
            self.assertEqual(job['runs-on'], 'ubuntu-latest' if name == 'bulk-import-browser' else 'windows-latest')
        package = jobs['native-package']
        self.assertEqual(package['needs'], PRODUCERS)
        self.assertNotIn('if', package)
        self.assertEqual(package['runs-on'], 'windows-latest')
        summary = jobs['acceptance-summary']
        self.assertEqual(summary['needs'], JOBS)
        self.assertEqual(summary['if'], '${{ always() }}')
        self.assertEqual(len(summary['steps']), 1)
        self.assertNotIn('if', summary['steps'][0])
        for name in JOBS:
            job = jobs[name]
            self.assertNotIn('continue-on-error', job)
            steps = job['steps']
            self.assertTrue(all(not step.get('uses') or re.fullmatch(r'[^@]+@[0-9a-f]{40}', step['uses']) for step in steps))
            checkout = next(step for step in steps if step.get('uses', '').startswith('actions/checkout@'))
            self.assertEqual(checkout['with']['ref'], '${{ github.sha }}')
            capture = next(step for step in steps if step.get('id') == 'acceptance_identity')
            self.assertEqual(capture['run'], 'python scripts/native-acceptance-join.py identity')
            for action in ['dtolnay/rust-toolchain@', 'actions/setup-python@', 'actions/setup-node@']:
                setup = next(step for step in steps if step.get('uses', '').startswith(action))
                self.assertLess(steps.index(setup), steps.index(capture))
                option, pin = {'dtolnay/rust-toolchain@': ('toolchain', '1.99.0'),
                               'actions/setup-node@': ('node-version', '22.23.3'),
                               'actions/setup-python@': ('python-version', '3.12.14' if name == 'bulk-import-browser' else '3.12.10')}[action]
                self.assertEqual(setup['with'][option], pin)
            gate = steps[-1]
            self.assertEqual(gate['id'], 'producer_gate')
            self.assertEqual(gate['if'], 'always()')
            self.assertEqual(gate['run'], 'python scripts/native-acceptance-join.py steps')
            self.assertEqual(gate['env']['ACCEPTANCE_STEPS'], '${{ toJSON(steps) }}')
            required = [step for step in steps[:-1] if not step.get('uses', '').startswith('actions/cache/')]
            self.assertEqual(gate['env']['ACCEPTANCE_REQUIRED_STEPS'].split(','), [step['id'] for step in required])
            self.assertEqual(len({step['id'] for step in required}), len(required))
            self.assertTrue(all('continue-on-error' not in step for step in [*required, gate]))
            self.assertEqual(job['outputs']['producer_gate'], '${{ steps.producer_gate.outcome }}')
            self.assertEqual(job['outputs']['identity'], '${{ steps.acceptance_identity.outputs.identity }}')
            if name != 'bulk-import-browser':
                self.assertEqual(job['env']['RUSTFLAGS'], '-C target-feature=+crt-static')
                self.assertEqual(job['env']['CARGO_INCREMENTAL'], '0')
        pure = jobs['windows-pure-checks']['steps']
        pure_runs = [step.get('run') for step in pure]
        for command in ['npm test', 'npm run test:canonical-practice-acceptance',
                        'node --test tests/complete-practice-acceptance.test.js',
                        'cargo fmt --all --check', 'cargo test --workspace --all-targets --locked',
                        'cargo clippy --workspace --all-targets --locked -- -D warnings',
                        "python -m unittest discover -s tests -p 'test_*.py'"]:
            self.assertEqual(pure_runs.count(command), 1)
            stage = next(step for step in pure if step.get('run') == command)
            self.assertNotIn('if', stage)
        for filename in ['desktop-evidence', 'desktop-acceptance-wait', 'native-song-folder-evidence',
                         'native-bulk-import-evidence', 'native-clean-song-evidence', 'native-vsq-song-evidence',
                         'vsq-fingering-evidence', 'performance-song-fixtures', 'native-performance-song-evidence',
                         'pitch-bend-import-baseline', 'native-pitch-bend-evidence', 'pitch-bend-acceptance-workflow',
                         'song-authoring-model', 'frontend-song-authoring', 'song-authoring-acceptance-fixtures',
                         'native-song-authoring-evidence', 'authoring-acceptance-workflow', 'authoring-final-gate']:
            self.assertEqual(sum('tests/' + filename + '.test.js' in step.get('run', '').split()
                                 for step in pure if step.get('run', '').startswith('node --test ')), 1, filename)
        native = jobs['native-feature-acceptance']['steps']
        self.assertFalse(any(step.get('run') in pure_runs and re.match(r'(?:npm test|cargo (?:test|fmt|clippy)|node --test)', step.get('run', '')) for step in native))
        self.assertEqual(sum(step.get('run') == 'cargo build -p worldmusichub-desktop --release --locked' for step in native), 1)
        for scope in [native, pure]:
            self.assertTrue(any(step.get('run') == './tests/windows-desktop-contract.ps1' for step in scope))
            self.assertTrue(any('Language.Parser]::ParseFile' in step.get('run', '') for step in scope))
        self.assertFalse(any(step.get('id') == 'native_package' for step in native))
        self.assertFalse(any('cargo build ' in step.get('run', '') for step in package['steps']))
        by_id = {step['id']: step for step in package['steps']}
        join, download, restore, build = [by_id[name] for name in ['package_join', 'native_transfer_download', 'native_transfer_restore', 'native_package']]
        self.assertEqual([package['steps'].index(step) for step in [join, download, restore, build]], sorted(package['steps'].index(step) for step in [join, download, restore, build]))
        self.assertEqual(join['run'], 'python scripts/native-acceptance-join.py join')
        self.assertEqual(join['env']['ACCEPTANCE_NEEDS'], '${{ toJSON(needs) }}')
        self.assertEqual(download['with'], {'artifact-ids': '${{ needs.native-feature-acceptance.outputs.transfer_artifact_id }}',
            'path': '${{ runner.temp }}/native-acceptance-transfer', 'merge-multiple': True})
        self.assertEqual(restore['env']['ACCEPTANCE_TRANSFER_SHA256'], '${{ needs.native-feature-acceptance.outputs.transfer_sha256 }}')
        self.assertIn('--expected-sha256 "$env:ACCEPTANCE_TRANSFER_SHA256"', restore['run'])
        self.assertIn('--build-provenance target/release/native-build-provenance.json', build['run'])
        self.assertIn('node scripts/verify-native-build-diagnostics.mjs --check desktop-build-diagnostics', build['run'])
        self.assertIn("$env:WMH_BUILD_DIAGNOSTICS_EXECUTABLE=(Resolve-Path 'target/release/worldmusichub-desktop.exe').Path", build['run'])
        self.assertIn('diagnosticProof.source_commit_count -ne [long](git rev-list --count HEAD)', build['run'])
        for expression in ['source_sha', 'source_tree', 'executable_sha256']:
            self.assertIn('$diagnosticProof.' + expression + ' -cne ', build['run'])
        self.assertLess(build['run'].index('verify-native-build-diagnostics.mjs --check'),
                        build['run'].index('native-release-manifest.py create'))
        native_by_id = {step.get('id'): step for step in native}
        for required_id in ['build_diagnostics_windows', 'build_diagnostics_windows_verify']:
            self.assertIn(required_id, native_by_id)
            self.assertEqual(jobs['native-feature-acceptance']['outputs'][required_id],
                             '${{ steps.' + required_id + '.outcome }}')
        self.assertIn('-Scenario build-diagnostics', native_by_id['build_diagnostics_windows']['run'])
        self.assertIn('verify-native-build-diagnostics.mjs --check desktop-build-diagnostics',
                      native_by_id['build_diagnostics_windows_verify']['run'])
        for step in [join, download, restore, build]:
            self.assertNotIn('if', step)
        seal = next(step for step in native if step.get('id') == 'native_transfer')
        self.assertIn('native-release-manifest.py provenance --commit', seal['run'])
        self.assertIn('native-acceptance-transfer.py create', seal['run'])
        self.assertLess(seal['run'].index('native-release-manifest.py provenance'), seal['run'].index('native-acceptance-transfer.py create'))
        upload = next(step for step in native if step.get('id') == 'native_transfer_upload')
        self.assertEqual(upload['with']['path'], '${{ runner.temp }}/native-acceptance-transfer/native-inputs.zip')
        self.assertEqual(upload['with']['if-no-files-found'], 'error')
        self.assertNotIn('if', upload)

    def test_real_graph_keeps_all_checks_and_exact_transfer_before_candidate_creation(self):
        self.contract(document())

    def test_missing_dependency_checks_source_or_transport_binding_breaks_graph_contract(self):
        for label, mutate in [
            ('pure suppressed', lambda jobs: jobs['windows-pure-checks'].update(needs=['native-feature-acceptance'])),
            ('package before pure', lambda jobs: jobs['native-package']['needs'].remove('windows-pure-checks')),
            ('package before browser', lambda jobs: jobs['native-package']['needs'].remove('bulk-import-browser')),
            ('ignored failures', lambda jobs: jobs['native-package'].update({'continue-on-error': True})),
            ('always package', lambda jobs: jobs['native-package'].update({'if': '${{ always() }}'})),
            ('wrong checkout', lambda jobs: jobs['native-package']['steps'][0]['with'].update(ref='main')),
            ('missing npm test', lambda jobs: jobs['windows-pure-checks'].update(steps=[s for s in jobs['windows-pure-checks']['steps'] if s.get('run') != 'npm test'])),
            ('weakened required list', lambda jobs: jobs['windows-pure-checks']['steps'][-1]['env'].update(ACCEPTANCE_REQUIRED_STEPS='acceptance_source')),
            ('conditional test', lambda jobs: next(s for s in jobs['windows-pure-checks']['steps'] if s.get('run') == 'npm test').update({'if': 'false'})),
            ('download by name', lambda jobs: next(s for s in jobs['native-package']['steps'] if s.get('id') == 'native_transfer_download')['with'].update(name='latest')),
            ('untrusted SHA', lambda jobs: next(s for s in jobs['native-package']['steps'] if s.get('id') == 'native_transfer_restore')['env'].update(ACCEPTANCE_TRANSFER_SHA256='${{ steps.native_transfer_download.outputs.digest }}')),
            ('summary omission', lambda jobs: jobs['acceptance-summary']['needs'].remove('windows-pure-checks')),
            ('diagnostic recheck omitted', lambda jobs: next(s for s in jobs['native-package']['steps'] if s.get('id') == 'native_package').update(run='echo omitted')),
            ('Linux Python downgrade', lambda jobs: next(s for s in jobs['bulk-import-browser']['steps'] if s.get('uses', '').startswith('actions/setup-python@'))['with'].update({'python-version': '3.12.10'})),
            ('Windows Python matrix swap', lambda jobs: next(s for s in jobs['windows-pure-checks']['steps'] if s.get('uses', '').startswith('actions/setup-python@'))['with'].update({'python-version': '3.12.14'})),
            ('Node patch drift', lambda jobs: next(s for s in jobs['native-package']['steps'] if s.get('uses', '').startswith('actions/setup-node@'))['with'].update({'node-version': '22.23.4'})),
        ]:
            with self.subTest(label=label):
                changed = copy.deepcopy(document())
                mutate(changed['jobs'])
                with self.assertRaises(AssertionError):
                    self.contract(changed)


if __name__ == '__main__':
    unittest.main()
