"""Exercise the full acceptance workflow's additive JSON diagnostic commands."""
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

    def test_independent_always_run_subsets_follow_full_artifacts_and_acceptance(self):
        self.assertEqual(WORKFLOW["permissions"], {"contents": "read"})
        for platform, job_id in JOBS.items():
            steps = WORKFLOW["jobs"][job_id]["steps"]
            diagnostics = []
            for group, root, output, collect, upload in diagnostic_pairs(platform):
                with self.subTest(platform=platform, group=group):
                    diagnostics.extend([collect, upload])
                    base = self.evidence_root(platform, root).parent
                    self.assertEqual(self.command(collect)[2:], [
                        base.as_posix(), (self.temp / output).as_posix(),
                        "--root", root, "--source-sha", SOURCE_SHA,
                    ])
                    for step in (collect, upload):
                        self.assertEqual(step["if"], "always()")
                        self.assertNotIn("continue-on-error", step)
                        self.assertNotIn("id", step)
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
                    self.assertLess(steps.index(full), steps.index(collect))
            # Added collectors cannot suppress any existing validation/package step
            # via the runner's implicit success() guard. Failure still fails the job.
            self.assertEqual(steps[-len(diagnostics):], diagnostics)
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
