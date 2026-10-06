"""Exercise the full acceptance workflow's additive JSON diagnostic commands."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "workflow_parser", ROOT / "scripts/check-authoring-workflow.py")
PARSER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PARSER)
WORKFLOW, _ = PARSER.parse_workflow(
    (ROOT / ".github/workflows/windows-desktop-acceptance.yml").read_text())
SOURCE_SHA = "a" * 40
MAX_BYTES = 23 * 1024 * 1024
GROUPS = {
    "bulk-import": "desktop-bulk-import",
    "vsq-song": "desktop-vsq-song",
    "performance-song": "desktop-performance-song",
    "pitch-bend": "desktop-pitch-bend",
    "song-authoring": "desktop-authoring",
    "vsq-authoring": "desktop-vsq-authoring",
    "canonical-practice": "desktop-canonical-practice",
}
JOBS = {"browser": "bulk-import-browser", "windows": "native-feature-acceptance"}
NEW_DIAGNOSTICS = {'build_diagnostics_collect', 'build_diagnostics_upload'}
# Frozen two-parent integration a4cfcda474ff398fab69d7c7eddd83333511b9d2.
# Hash complete job bodies after normalizing only step order and required-list
# order. This protects every original command, condition, output, source/run/EXE
# binding and full artifact from an accidental whole-workflow replacement.
BASELINE_JOBS = {
    'bulk-import-browser': 'd5c664e1d424e5e01972e9482e7b3e3a9fce2d5eb0f4819505673abaf9bbdb0b',
    'windows-pure-checks': '93d0ac4e7c25dd3f09c38e5924ec1e532892770231f1d922ebef44d0c154c93d',
    'native-feature-acceptance': 'cdc250580e074d4477d9f911beb9cae7613a20967c65d3e52a1f42bafb0116de',
    'native-package': 'ae0f0c8e05913dc82d7382c3f9b56b552a62bd575e278050a1301d818e91adb5',
    'acceptance-summary': 'b5d722181b2071357fffa57d7fc99656990558ad9454351e8bb6f17514e9b151',
}
BASELINE_OTHER_ORDER = {
    'bulk-import-browser': 'c3635a351fbc785708d50d7360aae49c535527f247308eba6129967d7edca3a4',
    'windows-pure-checks': '3a6c73ef957fe75c9e4a91bf751a6f759e9e5b15f967230a22123e32b39d94ea',
    'native-feature-acceptance': 'd234a133c0d66c5c678666f8f754c00b756fa2145468e3282a80092252350f88',
    'native-package': '6e59abbbbc79be047794016903dbc03c4a93952632a09b93be28c2731689565c',
    'acceptance-summary': '1d8fc6ceb1f94c6326d6d5483d258fcb2e179e9869325b245d105c2219bf69fd',
}
# Ordered writers/rechecks of each complete collected root, not merely its
# first successful report. The final ID is the earliest safe collection point.
ROOT_OWNERS = {
    'browser': {
        'bulk-import': (['required_031'], ['required_054', 'required_055'], 'npm run test:bulk-import-hosted'),
        'vsq-song': (['required_032'], ['required_056', 'required_057'], 'node scripts/hosted-vsq-song-check.mjs'),
        'performance-song': (['required_033'], ['required_058', 'required_059'], 'node scripts/hosted-performance-song-check.mjs'),
        'pitch-bend': (['required_034'], ['required_060', 'required_061'], 'node scripts/hosted-pitch-bend-check.mjs'),
        'song-authoring': (['required_027', 'required_035'], ['required_062', 'required_063'], 'node scripts/hosted-song-authoring-check.mjs'),
        'vsq-authoring': (['required_029', 'required_042'], ['required_064', 'required_065'], 'node scripts/hosted-vsq-authoring-check.mjs'),
        'canonical-practice': (['canonical_practice_protocol', 'canonical_practice_browser_720',
            'canonical_practice_browser_720_verify', 'canonical_practice_browser_640', 'canonical_practice_browser_640_verify'],
            ['required_066', 'required_067'], 'node scripts/verify-canonical-practice-evidence.mjs --check'),
        'pack-management': (['management_pack_browser'], ['required_068', 'required_069'], 'npm run test:pack-management-hosted'),
    },
    'windows': {
        'desktop-acceptance': (['required_019'], ['required_054', 'required_055'], '-OutputDirectory desktop-acceptance'),
        'bulk-import': (['required_021'], ['required_040', 'required_041'], '-OutputDirectory desktop-bulk-import -Scenario bulk-import'),
        'vsq-song': (['required_023'], ['required_042', 'required_043'], '-OutputDirectory desktop-vsq-song -Scenario vsq-song'),
        'performance-song': (['required_024'], ['required_044', 'required_045'], '-OutputDirectory desktop-performance-song -Scenario performance-song'),
        'pitch-bend': (['required_025'], ['required_046', 'required_047'], '-OutputDirectory desktop-pitch-bend -Scenario pitch-bend'),
        'song-authoring': (['required_026'], ['required_048', 'required_049'], '-OutputDirectory desktop-authoring -Scenario authoring'),
        'vsq-authoring': (['required_032'], ['required_050', 'required_051'], '-OutputDirectory desktop-vsq-authoring -Scenario vsq-authoring'),
        'canonical-practice': (['canonical_practice_windows', 'canonical_practice_windows_verify'],
            ['required_052', 'required_053'], 'node scripts/verify-canonical-practice-evidence.mjs --check desktop-canonical-practice'),
    },
}


def groups_for(platform):
    return ({**GROUPS, "desktop-acceptance": "desktop-acceptance"} if platform == "windows"
            else {**GROUPS, "pack-management": "packs"})


def diagnostic_pairs(platform):
    steps = WORKFLOW["jobs"][JOBS[platform]]["steps"]
    for group, native_root in groups_for(platform).items():
        output = f"{group}-{platform}-json"
        upload = next(step for step in steps
                      if step.get("with", {}).get("name") == output + "-${{ github.sha }}")
        collect = steps[steps.index(upload) - 1]
        yield group, native_root if platform == "windows" or group == "pack-management" else group, output, collect, upload


class WindowsJsonDiagnosticsTests(unittest.TestCase):
    def assert_original_job_bodies(self, workflow):
        self.assertEqual(set(workflow['jobs']), set(BASELINE_JOBS))
        for name, expected in BASELINE_JOBS.items():
            job = copy.deepcopy(workflow['jobs'][name])
            relocated = {'bulk-import-browser': range(54, 70), 'native-feature-acceptance': range(38, 56)}.get(name, [])
            movable = NEW_DIAGNOSTICS | {f'required_{number:03}' for number in relocated}
            order = [step.get('id') for step in job['steps'] if step.get('id') not in movable]
            self.assertEqual(hashlib.sha256(json.dumps(order, separators=(',', ':')).encode()).hexdigest(),
                             BASELINE_OTHER_ORDER[name], name + ': original producer/recheck order changed')
            job['steps'] = sorted((step for step in job['steps']
                                   if step.get('id') not in NEW_DIAGNOSTICS), key=lambda step: step.get('id', ''))
            for step in job['steps']:
                if step.get('id') == 'producer_gate':
                    step['env']['ACCEPTANCE_REQUIRED_STEPS'] = ','.join(sorted(
                        value for value in step['env']['ACCEPTANCE_REQUIRED_STEPS'].split(',')
                        if value not in NEW_DIAGNOSTICS))
            actual = hashlib.sha256(json.dumps(job, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            self.assertEqual(actual, expected, name + ': original job body/output/gate changed')

    def test_every_original_job_body_output_gate_and_full_artifact_is_unchanged(self):
        self.assert_original_job_bodies(WORKFLOW)

    def test_original_contract_rejects_changed_commands_outputs_gates_and_artifact_paths(self):
        for mutation in ['command', 'output', 'gate', 'full_artifact']:
            with self.subTest(mutation=mutation):
                document = copy.deepcopy(WORKFLOW)
                job = document['jobs']['native-feature-acceptance']
                if mutation == 'command':
                    next(step for step in job['steps'] if step.get('id') == 'build_diagnostics_windows')['run'] += '\necho changed'
                elif mutation == 'output':
                    job['outputs']['build_diagnostics_windows'] = '${{ steps.build_diagnostics_upload.outcome }}'
                elif mutation == 'gate':
                    job['steps'][-1]['env']['ACCEPTANCE_REQUIRED_STEPS'] = job['steps'][-1]['env']['ACCEPTANCE_REQUIRED_STEPS'].replace('build_diagnostics_windows_verify,', '')
                else:
                    next(step for step in job['steps'] if step.get('id') == 'required_037')['with']['path'] += '\nprivate-profile/**'
                with self.assertRaises(AssertionError):
                    self.assert_original_job_bodies(document)

    def assert_complete_root_ownership(self, workflow):
        for platform, job_id in JOBS.items():
            steps = workflow['jobs'][job_id]['steps']
            ids = [step.get('id') for step in steps]
            self.assertEqual(set(ROOT_OWNERS[platform]), set(groups_for(platform)))
            required = steps[-1]['env']['ACCEPTANCE_REQUIRED_STEPS'].split(',')
            for group, (producers, pair, final_command) in ROOT_OWNERS[platform].items():
                for name in [*producers, *pair]:
                    self.assertEqual(ids.count(name), 1, f'{platform}/{group}: missing/duplicate {name}')
                    self.assertEqual(required.count(name), 1)
                producer_indices = [ids.index(name) for name in producers]
                self.assertEqual(producer_indices, sorted(producer_indices))
                boundary = producer_indices[-1]
                self.assertIn(final_command, steps[boundary]['run'])
                self.assertEqual(ids[boundary + 1:boundary + 3], pair,
                                 f'{platform}/{group}: wait for the entire root before collecting')
                for index in [boundary + 1, boundary + 2]:
                    self.assertEqual(steps[index]['if'], 'always()')
                    self.assertNotIn('continue-on-error', steps[index])
            if platform == 'browser':
                for group, producer, variable in [('song-authoring', 'required_027', 'WMH_AUTHORING_REPORT'),
                                                   ('vsq-authoring', 'required_029', 'WMH_VSQ_AUTHORING_REPORT'),
                                                   ('canonical-practice', 'canonical_practice_protocol', 'WMH_CANONICAL_PRACTICE_REPORT')]:
                    self.assertEqual(steps[ids.index(producer)]['env'][variable],
                                     '${{ github.workspace }}/test-results/' + group + '/native-protocol/report.json')
                for size in ['720', '640']:
                    for suffix in ['', '_verify']:
                        producer = steps[ids.index('canonical_practice_browser_' + size + suffix)]
                        self.assertEqual(producer['env']['WMH_ARTIFACT_DIR'],
                                         '${{ github.workspace }}/test-results/canonical-practice/' + size)
                for name, leaf in [('management_pack_browser', 'packs'), ('management_catalog_browser', 'catalog')]:
                    self.assertEqual(steps[ids.index(name)]['env']['WMH_ARTIFACT_DIR'],
                                     '${{ runner.temp }}/library-management-browser/' + leaf)
            else:
                # Existing Basic JSON/PNG diagnostics also have one complete
                # native owner. Its full artifact stays with the final bundle.
                boundary = ids.index('required_027')
                self.assertIn('-OutputDirectory desktop-basic-key -Scenario basic-key', steps[boundary]['run'])
                self.assertEqual(ids[boundary + 1:boundary + 3], ['required_038', 'required_039'])
                self.assertIn('collect-basic-key-diagnostics.py desktop-basic-key', steps[boundary + 1]['run'])
                for name in ['required_038', 'required_039']:
                    self.assertEqual(ids.count(name), 1)
                    self.assertEqual(required.count(name), 1)
                    self.assertEqual(steps[ids.index(name)]['if'], 'always()')

    def test_all_json_pairs_wait_for_every_writer_and_recheck_of_their_root(self):
        self.assert_complete_root_ownership(WORKFLOW)

    def test_missing_early_duplicate_or_late_root_producer_breaks_ownership(self):
        for platform, groups in ROOT_OWNERS.items():
            for group, (producers, pair, _) in groups.items():
                for mutation in ['missing', 'missing_producer', 'before_final_producer', 'duplicate', 'producer_after_collection']:
                    with self.subTest(platform=platform, group=group, mutation=mutation):
                        workflow = copy.deepcopy(WORKFLOW)
                        steps = workflow['jobs'][JOBS[platform]]['steps']
                        collect = next(step for step in steps if step.get('id') == pair[0])
                        producer = next(step for step in steps if step.get('id') == producers[-1])
                        if mutation == 'missing':
                            steps.remove(collect)
                        elif mutation == 'missing_producer':
                            steps.remove(producer)
                        elif mutation == 'before_final_producer':
                            steps.remove(collect)
                            steps.insert(steps.index(producer), collect)
                        elif mutation == 'duplicate':
                            steps.insert(steps.index(collect), copy.deepcopy(collect))
                        else:
                            # Include earlier protocol writers and first-size
                            # rechecks, not only the final viewport.
                            moved = next(step for step in steps if step.get('id') == producers[0])
                            steps.remove(moved)
                            steps.insert(steps.index(collect) + 1, moved)
                        with self.assertRaises(AssertionError):
                            self.assert_complete_root_ownership(workflow)

    def assert_early_vsq_ownership(self, workflow):
        for platform, job_id in JOBS.items():
            steps = workflow['jobs'][job_id]['steps']
            browser = platform == 'browser'
            command = 'node scripts/hosted-vsq-song-check.mjs' if browser else '-Scenario vsq-song'
            owners = [step for step in steps if command in step.get('run', '')]
            self.assertEqual(len(owners), 1)
            owner = owners[0]
            self.assertEqual(owner['id'], 'required_032' if browser else 'required_023')
            early_ids = ['required_056', 'required_057'] if browser else [
                'required_042', 'required_043', 'vsq_capture_collect',
                'vsq_capture_seed_upload', 'vsq_capture_restart_upload']
            ids = [step.get('id') for step in steps]
            for name in early_ids:
                self.assertEqual(ids.count(name), 1, 'No missing or duplicate diagnostic upload')
            first = steps.index(owner) + 1
            self.assertEqual(ids[first:first + len(early_ids)], early_ids,
                             'Collect only after the exact owning scenario has returned')
            for step in steps[first:first + len(early_ids)]:
                self.assertEqual(step['if'], 'always()')
                self.assertNotIn('continue-on-error', step)
            following = steps[first + len(early_ids)]
            self.assertIn('node scripts/hosted-performance-song-check.mjs' if browser else '-Scenario performance-song',
                          following['run'])
            self.assertEqual(following['if'],
                "${{ !cancelled() && steps.notation_server.outcome == 'success' && steps.dense_native_driver.outcome == 'success' && steps.dense_browser_setup.outcome == 'success' }}"
                if browser else "${{ !cancelled() && steps.native_build.outcome == 'success' }}")
            gate = steps[-1]
            self.assertEqual(gate['id'], 'producer_gate')
            self.assertEqual(gate['if'], 'always()')
            self.assertEqual(gate['run'], 'python scripts/native-acceptance-join.py steps')
            required = gate['env']['ACCEPTANCE_REQUIRED_STEPS'].split(',')
            self.assertTrue(all(required.count(name) == 1 for name in [owner['id'], *early_ids, following['id']]))

    def test_vsq_subsets_immediately_follow_only_their_completed_owner(self):
        self.assert_early_vsq_ownership(WORKFLOW)

    def test_early_collection_wrong_owner_duplicates_or_suppressed_later_scenarios_fail_contract(self):
        for platform, job_id in JOBS.items():
            owner_id, collect_id = ('required_032', 'required_056') if platform == 'browser' else ('required_023', 'required_042')
            for mutation in ['before_owner', 'wrong_later_owner', 'duplicate', 'conditional', 'missing_gate', 'suppress_later']:
                with self.subTest(platform=platform, mutation=mutation):
                    workflow = copy.deepcopy(WORKFLOW)
                    steps = workflow['jobs'][job_id]['steps']
                    owner = next(step for step in steps if step.get('id') == owner_id)
                    collect = next(step for step in steps if step.get('id') == collect_id)
                    if mutation in ['before_owner', 'wrong_later_owner']:
                        steps.remove(collect)
                        steps.insert(steps.index(owner) + (0 if mutation == 'before_owner' else 3), collect)
                    elif mutation == 'duplicate':
                        steps.append(copy.deepcopy(collect))
                    elif mutation == 'conditional':
                        collect['if'] = 'success()'
                    elif mutation == 'missing_gate':
                        required = steps[-1]['env']['ACCEPTANCE_REQUIRED_STEPS'].split(',')
                        required.remove(collect_id)
                        steps[-1]['env']['ACCEPTANCE_REQUIRED_STEPS'] = ','.join(required)
                    else:
                        following = next(step for step in steps if ('hosted-performance-song-check.mjs'
                            if platform == 'browser' else '-Scenario performance-song') in step.get('run', ''))
                        following['if'] = 'success()'
                    with self.assertRaises(AssertionError):
                        self.assert_early_vsq_ownership(workflow)

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.workspace = Path(temporary.name) / "workspace with spaces"
        self.temp = Path(temporary.name) / "runner temp with spaces"
        self.workspace.mkdir()
        self.temp.mkdir()

    def command(self, step, source_sha=SOURCE_SHA):
        # Execute the real folded YAML command with runner expressions resolved.
        command = step["run"].replace("${{ github.workspace }}", self.workspace.as_posix())
        command = command.replace("${{ runner.temp }}", self.temp.as_posix())
        command = command.replace("${{ github.sha }}", source_sha)
        arguments = shlex.split(command)
        self.assertEqual(arguments[:2], ["python", "scripts/collect-json-evidence.py"])
        return [sys.executable, str(ROOT / arguments[1]), *arguments[2:]]

    def execute(self, step, source_sha=SOURCE_SHA):
        return subprocess.run(self.command(step, source_sha), cwd=ROOT,
                              capture_output=True, text=True, timeout=15, check=False)

    def evidence_root(self, platform, name):
        if platform == "browser" and name == "packs":
            return self.temp / "library-management-browser" / name
        return self.workspace / "test-results" / name if platform == "browser" else self.workspace / name

    def put(self, directory, relative, data):
        path = directory / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def test_independent_always_run_subsets_preserve_full_artifacts_and_acceptance(self):
        self.assertEqual(WORKFLOW["permissions"], {"contents": "read"})
        for platform, job_id in JOBS.items():
            steps = WORKFLOW["jobs"][job_id]["steps"]
            for group, root, output, collect, upload in diagnostic_pairs(platform):
                with self.subTest(platform=platform, group=group):
                    base = self.evidence_root(platform, root).parent
                    self.assertEqual(self.command(collect)[2:], [
                        base.as_posix(), (self.temp / output).as_posix(),
                        "--root", root, "--source-sha", SOURCE_SHA,
                    ])
                    for step in (collect, upload):
                        self.assertEqual(step["if"], "always()")
                        self.assertNotIn("continue-on-error", step)
                        self.assertIn(step["id"], steps[-1]["env"]["ACCEPTANCE_REQUIRED_STEPS"].split(","))
                    self.assertRegex(upload["uses"], r"^actions/upload-artifact@[0-9a-f]{40}$")
                    self.assertEqual(upload["with"]["path"], "${{ runner.temp }}/" + output + "/")
                    self.assertEqual(upload["with"]["if-no-files-found"], "error")
                    self.assertIs(upload["with"]["include-hidden-files"], True)
                    full_name = ("library-management-browser" if group == "pack-management"
                                 else f"canonical-practice-{platform}" if group == "canonical-practice"
                                 else "bulk-import-browser" if platform == "browser" else "native-feature-evidence")
                    full = next(step for step in steps if step.get("with", {}).get("name")
                                == full_name + "-${{ github.sha }}")
                    self.assertEqual(full["if"], "always()")
                    if group == "pack-management":
                        self.assertIn("${{ runner.temp }}/library-management-browser/**", full["with"]["path"])
                        self.assertIn("target/debug/examples/native_import_driver", full["with"]["path"])
                        self.assertIn("target/debug/practice-server", full["with"]["path"])
                    else:
                        self.assertIn(("test-results/" if platform == "browser" else "") + root + "/",
                                      full["with"]["path"])
                        self.assertIn(".png", full["with"]["path"])
                    self.assertLess(steps.index(collect), steps.index(full))
                if platform == "windows" and group == "vsq-song":
                    # Exact selected PNG diagnostics are additive to the original
                    # adjacent JSON pair and remain mandatory producer receipts.
                    extra_ids = ["vsq_capture_collect", "vsq_capture_seed_upload", "vsq_capture_restart_upload"]
                    extras = steps[steps.index(upload) + 1:steps.index(upload) + 4]
                    self.assertEqual([step["id"] for step in extras], extra_ids)
                    for step in extras:
                        self.assertEqual(step["if"], "always()")
                        self.assertNotIn("continue-on-error", step)
                        self.assertIn(step["id"], steps[-1]["env"]["ACCEPTANCE_REQUIRED_STEPS"].split(","))
            # Complete cross-feature artifacts remain last, after catalog's
            # final verifier. Moving a small subset cannot move the full proof.
            final_verify = next(step for step in steps if step.get('id') ==
                                ('management_catalog_browser_verify' if platform == 'browser' else 'management_catalog_windows_verify'))
            full = next(step for step in steps if step.get('id') ==
                        ('required_053' if platform == 'browser' else 'required_037'))
            self.assertLess(steps.index(final_verify), steps.index(full))
            suffix = [step["id"] for step in steps[steps.index(full) + 1:]]
            self.assertEqual(suffix, ["native_transfer", "native_transfer_upload", "native_transfer_identity", "producer_gate"]
                             if platform == "windows" else ["producer_gate"])
            self.assertEqual(sum("scripts/collect-json-evidence.py" in step.get("run", "")
                                 for step in steps), len(groups_for(platform)))

    def test_every_group_retains_exact_failure_json_and_bound_inventory(self):
        for platform in JOBS:
            for group, root, output, collect, _ in diagnostic_pairs(platform):
                with self.subTest(platform=platform, group=group):
                    evidence = self.evidence_root(platform, root)
                    reports = {"report.json": b'{"ok":false,"stage":"audio-admission"}\n',
                               "nested/geometry.json": b'{"width":720,"pcm":[0,0]}\n'}
                    if group == "pack-management":
                        reports = {"latest-run.json": b'{"ok":false,"report":"original-run/report.json"}\n',
                                   "original-run/report.json": b'{"ok":false,"error":"Actual pointer practice input required","practice_input":{"clock_before_wait":{"positionMs":0}}}\n',
                                   "original-run/downloads/practice-take-before.json": b'{"passes":[{"inputs":[]}]}\n'}
                    for path, data in reports.items():
                        self.put(evidence, path, data)
                    for path in ["failure.png", "driver.exe", "server.log",
                                 "webview-profile/Preferences.json",
                                 "nested/webview-profiles/Preferences.json",
                                 "webview-catalog-profile/Preferences.json"]:
                        self.put(evidence, path, b"excluded")
                    completed = self.execute(collect)
                    self.assertEqual(completed.returncode, 0, completed.stderr)
                    directory = self.temp / output
                    manifest = json.loads((directory / "diagnostic-inventory.json").read_bytes())
                    self.assertEqual(manifest["source_sha"], SOURCE_SHA)
                    self.assertEqual(manifest["roots"], [root])
                    self.assertIs(manifest["subset_only"], True)
                    self.assertIs(manifest["full_artifact_required_for_acceptance"], True)
                    expected = {root + "/" + name: data for name, data in reports.items()}
                    self.assertEqual({row["path"] for row in manifest["files"]}, set(expected))
                    for row in manifest["files"]:
                        data = expected[row["path"]]
                        self.assertEqual(row["bytes"], len(data))
                        self.assertEqual(row["sha256"], hashlib.sha256(data).hexdigest())
                        self.assertEqual((directory / row["path"]).read_bytes(), data)
                        self.assertEqual((evidence / Path(row["path"]).relative_to(root)).read_bytes(), data)
                    files = [path for path in directory.rglob("*") if path.is_file()]
                    self.assertEqual(len(files), len(expected) + 1)
                    self.assertLessEqual(sum(path.stat().st_size for path in files), MAX_BYTES)

    def test_generic_windows_seed_and_action_failure_stays_exact_without_a_browser_group(self):
        self.assertNotIn("desktop-acceptance", {pair[0] for pair in diagnostic_pairs("browser")})
        _, root, output, collect, _ = next(pair for pair in diagnostic_pairs("windows")
                                         if pair[0] == "desktop-acceptance")
        self.assertEqual(root, "desktop-acceptance")
        evidence = self.evidence_root("windows", root)
        reports = {
            "renderer-seed.json": b'{"phase":"seed","ok":false,"error":"Invalid acceptance action"}\n',
            "action-seed-1.json": b'{"sequence":1,"type":"click","target":"start"}\n',
            "result-seed-1.json": b'{"ok":false,"error":"Invalid acceptance action"}\n',
            "native-acceptance.json": b'{"ok":false,"failure_details":{"phase":"seed"}}\n',
        }
        for path, data in reports.items():
            self.put(evidence, path, data)
        self.put(evidence, "webview-profile/Default/Preferences.json", b'{"not_evidence":true}')
        completed = self.execute(collect)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        directory = self.temp / output
        manifest = json.loads((directory / "diagnostic-inventory.json").read_bytes())
        self.assertEqual({row["path"] for row in manifest["files"]},
                         {root + "/" + path for path in reports})
        for path, data in reports.items():
            self.assertEqual((directory / root / path).read_bytes(), data)
        self.assertFalse((directory / root / "webview-profile").exists())

    def test_absent_evidence_is_explicitly_an_empty_subset_not_acceptance(self):
        for platform in JOBS:
            _, root, output, collect, _ = next(diagnostic_pairs(platform))
            completed = self.execute(collect)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            manifest = json.loads((self.temp / output / "diagnostic-inventory.json").read_bytes())
            self.assertEqual(manifest["files"], [])
            self.assertEqual(manifest["roots"], [root])
            self.assertEqual(manifest["source_sha"], SOURCE_SHA)
            self.assertIs(manifest["full_artifact_required_for_acceptance"], True)

    def test_one_oversized_group_fails_visibly_without_suppressing_another(self):
        pairs = list(diagnostic_pairs("browser"))
        _, root, output, collect, _ = pairs[0]
        evidence = self.evidence_root("browser", root)
        # No individual file exceeds the bound; the total exceeds it by two bytes.
        for name in ("first.json", "second.json"):
            self.put(evidence, name, b" " * (MAX_BYTES // 2) + b"0")
        completed = self.execute(collect)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("Diagnostic subset exceeds its fixed bound", completed.stderr)
        self.assertFalse((self.temp / output).exists())
        _, next_root, next_output, next_collect, _ = pairs[1]
        self.put(self.evidence_root("browser", next_root), "report.json", b'{"ok":false}')
        completed = self.execute(next_collect)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertTrue((self.temp / next_output / "diagnostic-inventory.json").is_file())

    def test_workflow_command_rejects_non_exact_source_identity(self):
        _, _, output, collect, _ = next(diagnostic_pairs("windows"))
        completed = self.execute(collect, source_sha="main")
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("An exact source SHA is required", completed.stderr)
        self.assertFalse((self.temp / output).exists())


if __name__ == "__main__":
    unittest.main()
