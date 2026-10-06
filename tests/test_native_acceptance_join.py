"""Exercise the real producer/package join with independent hostile inputs."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('native_acceptance_join', ROOT / 'scripts/native-acceptance-join.py')
JOIN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(JOIN)


def identity(windows=True):
    return {'source_sha': 'a' * 40, 'source_tree': 'b' * 40, 'run_id': '12345',
            'run_attempt': '1', 'repository': 'example/original-fixture',
            'cargo_lock_sha256': 'c' * 64, 'npm_lock_sha256': 'd' * 64,
            'rust': '1.99.0', 'node': 'v22.23.3', 'python': '3.12.10' if windows else '3.12.14',
            'runner_os': 'Windows' if windows else 'Linux',
            'rustflags': '-C target-feature=+crt-static' if windows else ''}


def producers():
    rows = {}
    for job in ['bulk-import-browser', 'windows-pure-checks', 'native-feature-acceptance']:
        value = identity(job != 'bulk-import-browser')
        rows[job] = {'result': 'success', 'outputs': {
            'source_sha': value['source_sha'], 'source_tree': value['source_tree'], 'run_id': value['run_id'],
            'producer_gate': 'success', 'identity': json.dumps(value)}}
    rows['native-feature-acceptance']['outputs'].update(transfer_artifact_id='200', transfer_sha256='e' * 64)
    return rows


class JoinTests(unittest.TestCase):
    def test_same_source_and_successful_producers_are_accepted(self):
        self.assertTrue(JOIN.join(producers(), identity()))

    def test_observed_platform_pins_accept_linux_without_downgrade_and_reject_wrong_matrix(self):
        rows = producers()
        self.assertEqual(json.loads(rows['bulk-import-browser']['outputs']['identity'])['python'], '3.12.14')
        self.assertEqual(identity()['python'], '3.12.10')
        self.assertTrue(JOIN.join(rows, identity()))
        for job in rows:
            for field, replacement in [('runner_os', 'Darwin'),
                    ('runner_os', 'Windows' if job == 'bulk-import-browser' else 'Linux'),
                    ('python', '3.12.10' if job == 'bulk-import-browser' else '3.12.14'),
                    ('python', '3.12.15'), ('node', 'v22.23.2'), ('node', 'v22.23.4')]:
                with self.subTest(job=job, field=field, replacement=replacement):
                    changed = producers()
                    actual = json.loads(changed[job]['outputs']['identity'])
                    actual[field] = replacement
                    changed[job]['outputs']['identity'] = json.dumps(actual)
                    with self.assertRaises(ValueError):
                        JOIN.join(changed, identity())
        expected = identity()
        expected['python'] = '3.12.11'
        for job in ['windows-pure-checks', 'native-feature-acceptance']:
            rows[job]['outputs']['identity'] = json.dumps(expected)
        with self.assertRaises(ValueError):
            JOIN.join(rows, expected)  # Consistent Windows drift is still outside the source pin.

    def test_capture_records_actual_os_and_refuses_a_spoofed_runner_platform(self):
        commands = {('git', 'rev-parse', 'HEAD'): 'a' * 40,
                    ('git', 'rev-parse', 'HEAD^{tree}'): 'b' * 40,
                    ('git', 'status', '--porcelain', '--untracked-files=normal'): '',
                    ('rustc', '--version'): 'rustc 1.99.0 (fixture)', ('node', '--version'): 'v22.23.3'}
        environment = {'GITHUB_SHA': 'a' * 40, 'GITHUB_RUN_ID': '12345', 'GITHUB_RUN_ATTEMPT': '1',
                       'GITHUB_REPOSITORY': 'example/original-fixture', 'RUNNER_OS': 'Linux', 'RUSTFLAGS': ''}
        with patch.dict(JOIN.os.environ, environment), patch.object(JOIN, 'command', side_effect=lambda *args: commands[args]), \
                patch.object(JOIN.Path, 'read_bytes', return_value=b'locked original fixture'), \
                patch.object(JOIN.platform, 'system', return_value='Linux'), \
                patch.object(JOIN.platform, 'python_version', return_value='3.12.14'):
            actual = JOIN.identity()
            self.assertEqual((actual['runner_os'], actual['python']), ('Linux', '3.12.14'))
            with patch.dict(JOIN.os.environ, {'RUNNER_OS': 'Windows'}), self.assertRaises(ValueError):
                JOIN.identity()

    def test_every_failed_skipped_cancelled_missing_or_false_success_producer_blocks_packaging(self):
        for job in producers():
            for result in ['failure', 'skipped', 'cancelled', '', None]:
                with self.subTest(job=job, result=result):
                    rows = producers()
                    rows[job]['result'] = result
                    with self.assertRaises(ValueError):
                        JOIN.join(rows, identity())
            rows = producers()
            del rows[job]
            with self.assertRaises(ValueError):
                JOIN.join(rows, identity())
            for outcome in ['failure', 'skipped', 'cancelled', '', None]:
                rows = producers()
                rows[job]['outputs']['producer_gate'] = outcome
                with self.assertRaises(ValueError):
                    JOIN.join(rows, identity())
        rows = producers()
        rows['unrequested'] = copy.deepcopy(rows['windows-pure-checks'])
        with self.assertRaises(ValueError):
            JOIN.join(rows, identity())

    def test_identity_mismatches_and_forged_independent_outputs_are_rejected(self):
        different = {'source_sha': 'e' * 40, 'source_tree': 'f' * 40, 'run_id': '54321',
                     'run_attempt': '2', 'repository': 'example/other-repo',
                     'cargo_lock_sha256': '1' * 64, 'npm_lock_sha256': '2' * 64,
                     'rust': '1.98.0', 'node': 'v22.19.0', 'python': '3.12.11', 'rustflags': '-C target-feature=-crt-static'}
        for job in producers():
            for field, value in different.items():
                with self.subTest(job=job, field=field):
                    rows = producers()
                    changed = json.loads(rows[job]['outputs']['identity'])
                    changed[field] = value
                    rows[job]['outputs']['identity'] = json.dumps(changed)
                    with self.assertRaises(ValueError):
                        JOIN.join(rows, identity())
            for field in ['source_sha', 'source_tree', 'run_id']:
                rows = producers()
                rows[job]['outputs'][field] = 'mismatched'
                with self.assertRaises(ValueError):
                    JOIN.join(rows, identity())
            for invalid in ['', 'null', '[]', '{}', '{bad']:
                rows = producers()
                rows[job]['outputs']['identity'] = invalid
                with self.assertRaises(ValueError):
                    JOIN.join(rows, identity())

    def test_consistent_but_unsupported_toolchain_or_weakened_crt_still_fails(self):
        for field, value in [('rust', '1.98.0'), ('node', 'v24.0.0'), ('python', '3.13.0'),
                             ('rustflags', ''), ('cargo_lock_sha256', ''), ('run_attempt', '0')]:
            expected = identity()
            expected[field] = value
            rows = producers()
            for row in rows.values():
                changed = json.loads(row['outputs']['identity'])
                changed[field] = value
                row['outputs']['identity'] = json.dumps(changed)
            with self.subTest(field=field), self.assertRaises(ValueError):
                JOIN.join(rows, expected)

    def test_missing_or_unsafe_transfer_identity_is_never_a_name_based_fallback(self):
        for field, values in [('transfer_artifact_id', ['', '0', '../other', '200,201']),
                              ('transfer_sha256', ['', 'bad', 'F' * 64, 'a' * 63])]:
            for value in values:
                rows = producers()
                rows['native-feature-acceptance']['outputs'][field] = value
                with self.assertRaises(ValueError):
                    JOIN.join(rows, identity())

    def test_step_gate_requires_actual_success_even_if_conclusion_masks_failure(self):
        success = {'outcome': 'success', 'conclusion': 'success'}
        JOIN.require_steps({'build': success, 'gui': success}, ['build', 'gui'])
        for field in ['outcome', 'conclusion']:
            for outcome in ['failure', 'skipped', 'cancelled', '', None]:
                rows = {'build': dict(success), 'gui': dict(success)}
                rows['gui'][field] = outcome
                with self.assertRaises(ValueError):
                    JOIN.require_steps(rows, ['build', 'gui'])
        for required in [[], ['build', 'gui'], ['build', 'build']]:
            with self.assertRaises(ValueError):
                JOIN.require_steps({'build': success}, required)


if __name__ == '__main__':
    unittest.main()
