import copy
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("basic_workflow_parser", ROOT / "scripts/check-authoring-workflow.py")
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)


def workflow(name="basic-key-preview.yml"):
    return parser.parse_workflow((ROOT / ".github/workflows" / name).read_text(encoding="utf-8"))[0]


SHA = "${{ github.sha }}"
CACHE = "55cc8345863c7cc4c66a329aec7e433d2d1c52a9"
PATHS = "\n".join(f"target/{profile}/{part}" for profile in ["debug", "release"]
                  for part in [".fingerprint", "build", "deps"])


class BasicKeyPreviewWorkflowTest(unittest.TestCase):
    def validate_native(self, document):
        self.assertEqual(document["permissions"], {"contents": "read"})
        job = document["jobs"]["basic-key-windows"]
        self.assertNotIn("needs", job)
        self.assertEqual(job["if"], "${{ github.ref != 'refs/heads/preview/basic-key-browser' }}")
        self.assertEqual(job["runs-on"], "windows-latest")
        self.assertLessEqual(job["timeout-minutes"], 40)
        self.assertEqual(job["env"], {"RUSTFLAGS": "-C target-feature=+crt-static", "CARGO_INCREMENTAL": "0"})
        steps = job["steps"]
        command = lambda text: next(row for row in steps if row.get("run") == text)
        uses = lambda action: next(row for row in steps if row.get("uses", "").startswith(action + "@"))
        index = steps.index
        self.assertEqual(uses("actions/checkout")["with"]["ref"], SHA)
        node, rust = uses("actions/setup-node"), uses("dtolnay/rust-toolchain")
        self.assertEqual(node["with"]["node-version"], "22")
        self.assertEqual(rust["with"]["toolchain"], "1.99.0")
        dependencies = command("npm ci --ignore-scripts --omit=optional")
        assets = command("npm run prepare:engraving")
        build = command("cargo build -p worldmusichub-desktop --release --locked")
        self.assertLess(index(node), index(dependencies))
        self.assertLess(index(dependencies), index(assets))
        self.assertLess(index(assets), index(build))
        source = next(row for row in steps if row.get("id") == "basic_key_source")
        self.assertIn('test "$(git rev-parse HEAD)" = "$GITHUB_SHA"', source["run"])
        self.assertIn("source_tree=$(git rev-parse 'HEAD^{tree}')", source["run"])
        self.assertLess(index(source), index(build))
        restore, save = uses("actions/cache/restore"), uses("actions/cache/save")
        for row, action in [(restore, "restore"), (save, "save")]:
            self.assertEqual(row["uses"], f"actions/cache/{action}@{CACHE}")
            self.assertEqual(row["with"]["path"].strip(), PATHS)
            self.assertFalse(row["with"]["enableCrossOsArchive"])
            self.assertNotIn("restore-keys", row["with"])
            self.assertLessEqual(row["timeout-minutes"], 3)
        self.assertTrue(restore["with"]["key"].startswith("basic-key-rust-v1-"))
        for key in ["Cargo.lock", "Cargo.toml", "package-lock.json", "scripts/prepare-engraving.mjs", ".github/workflows/basic-key-preview.yml"]:
            self.assertIn(f"'{key}'", restore["with"]["key"])
        self.assertIn("steps.basic_key_native_build.outcome == 'success'", save["if"])
        self.assertIn("steps.basic_key_rust_cache.outputs.cache-hit != 'true'", save["if"])
        self.assertEqual(save["with"]["key"], "${{ steps.basic_key_rust_cache.outputs.cache-primary-key }}")
        self.assertLess(index(restore), index(build))
        self.assertLess(index(build), index(save))
        launch = command("./scripts/windows-desktop-acceptance.ps1 -Executable target/release/worldmusichub-desktop.exe -OutputDirectory desktop-basic-key -Scenario basic-key")
        self.assertLessEqual(launch["timeout-minutes"], 10)
        recheck = next(row for row in steps if "Unexpected basic-key build source" in row.get("run", ""))
        for check in ["git rev-parse HEAD", SHA, "git rev-parse 'HEAD^{tree}'", "${{ steps.basic_key_source.outputs.source_tree }}", "git status --porcelain --untracked-files=normal"]:
            self.assertIn(check, recheck["run"])
        self.assertLess(index(build), index(recheck))
        self.assertLess(index(recheck), index(launch))
        verify = next(row for row in steps if "verify-basic-key-evidence.mjs --check desktop-basic-key" in row.get("run", ""))
        for check in ["WMH_SOURCE_SHA='" + SHA + "'", "WMH_SOURCE_TREE=(git rev-parse 'HEAD^{tree}').Trim()", "WMH_BASIC_KEY_EXECUTABLE=(Resolve-Path 'target/release/worldmusichub-desktop.exe').Path", "if ($LASTEXITCODE -ne 0)"]:
            self.assertIn(check, verify["run"])
        self.assertLess(index(launch), index(verify))
        collector = next(row for row in steps if "scripts/collect-basic-key-diagnostics.py" in row.get("run", ""))
        self.assertIn('desktop-basic-key "${{ runner.temp }}/basic-key-windows-diagnostics" --source-sha "' + SHA + '"', collector["run"])
        self.assertEqual(collector["if"], "always()")
        self.assertLess(index(verify), index(collector))
        small = next(row for row in steps if row.get("with", {}).get("name") == "basic-key-windows-diagnostics-" + SHA)
        full = next(row for row in steps if row.get("with", {}).get("name") == "basic-key-windows-" + SHA)
        self.assertEqual(small["with"]["path"], "${{ runner.temp }}/basic-key-windows-diagnostics/")
        for row in [small, full]:
            self.assertEqual(row["if"], "always()")
            self.assertTrue(row["uses"].startswith("actions/upload-artifact@"))
        self.assertLess(index(collector), index(small))
        self.assertIn("desktop-basic-key/*.png", full["with"]["path"])
        self.assertIn("desktop-basic-key/Scores/clean-backups/**", full["with"]["path"])
        for row in steps:
            if row.get("uses"):
                self.assertRegex(row["uses"], r"@[a-f0-9]{40}$")
            if row not in [restore, save]:
                self.assertNotIn("continue-on-error", row)
            if row not in [restore, save, collector, small, full]:
                self.assertNotIn("if", row)

    def test_independent_windows_build_is_locked_source_bound_and_byte_bounded(self):
        self.validate_native(workflow())

    def test_contract_rejects_missing_source_assets_cache_isolation_and_verification(self):
        changes = [
            ("checkout", lambda steps: steps[0]["with"].update(ref="main")),
            ("assets", lambda steps: steps.remove(next(s for s in steps if s.get("run") == "npm run prepare:engraving"))),
            ("source", lambda steps: next(s for s in steps if s.get("id") == "basic_key_source").update(run="echo unchecked")),
            ("unlocked dependencies", lambda steps: next(s for s in steps if s.get("run", "").startswith("npm ci")).update(run="npm install")),
            ("unlocked build", lambda steps: next(s for s in steps if s.get("id") == "basic_key_native_build").update(run="cargo build -p worldmusichub-desktop --release")),
            ("cache binary", lambda steps: next(s for s in steps if s.get("id") == "basic_key_rust_cache")["with"].update(path="target/release")),
            ("shared full cache", lambda steps: next(s for s in steps if s.get("id") == "basic_key_rust_cache")["with"].update(key="native-rust-v1-full")),
            ("skip cached build", lambda steps: next(s for s in steps if s.get("id") == "basic_key_native_build").update({"if": "false"})),
            ("soft verification", lambda steps: next(s for s in steps if "verify-basic-key-evidence.mjs" in s.get("run", "")).update({"continue-on-error": True})),
            ("wrong diagnostic source", lambda steps: next(s for s in steps if "collect-basic-key-diagnostics.py" in s.get("run", "")).update(run="python collector.py --source-sha main")),
            ("unpinned action", lambda steps: steps[0].update(uses="actions/checkout@main")),
        ]
        for label, change in changes:
            with self.subTest(label=label):
                document = copy.deepcopy(workflow())
                change(document["jobs"]["basic-key-windows"]["steps"])
                with self.assertRaises((AssertionError, StopIteration)):
                    self.validate_native(document)

    def test_preview_keeps_linux_coverage_and_full_gate_separate(self):
        focused, full = workflow(), workflow("windows-desktop-acceptance.yml")
        self.assertEqual(focused["on"]["push"]["branches"], ["preview/basic-key", "preview/basic-key-browser"])
        self.assertIn("workflow_dispatch", focused["on"])
        linux = focused["jobs"]["basic-key-browser"]
        self.assertNotIn("needs", linux)
        self.assertNotIn("if", linux)
        commands = "\n".join(row.get("run", "") for row in linux["steps"])
        for name in ["hosted-basic-key-check.mjs", "hosted-notation-scope-check.mjs", "hosted-dense-rendition-check.mjs", "check-basic-key-native.mjs"]:
            self.assertIn(name, commands)
        self.assertEqual(full["jobs"]["acceptance-summary"]["needs"], ["bulk-import-browser", "native-feature-acceptance"])
        native = full["jobs"]["native-feature-acceptance"]
        self.assertNotIn("if", native)
        self.assertNotIn("needs", native)
        commands = "\n".join(row.get("run", "") for row in native["steps"])
        for command in ["npm test", "cargo test --workspace --all-targets --locked", "cargo clippy --workspace --all-targets --locked -- -D warnings", "-Scenario basic-key"]:
            self.assertIn(command, commands)
        source = (ROOT / ".github/workflows/basic-key-preview.yml").read_text(encoding="utf-8")
        self.assertNotIn("contents: write", source)
        self.assertNotIn("gh release", source)
        self.assertNotIn("build-windows-package", source)
        self.assertIn("never replaces full Verify + Native acceptance", source)


if __name__ == "__main__":
    unittest.main()
