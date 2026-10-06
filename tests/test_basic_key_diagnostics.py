import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("basic_key_diagnostics", ROOT / "scripts/collect-basic-key-diagnostics.py")
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)
SHA = "a" * 40


class BasicKeyDiagnosticsTest(unittest.TestCase):
    def test_copies_original_failure_json_and_png_and_verifies_inventory_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); evidence = root / "desktop-basic-key"; evidence.mkdir()
            files = {
                "native-basic-key.json": b'\xef\xbb\xbf' + json.dumps({"source_sha": SHA, "ok": False}).encode(),
                "renderer-basic-key-restart.json": b'{"ok":false,"error":"toolbar height"}\r\n',
                "native-failure-basic-key-restart.png": b"\x89PNG\r\n\x1a\noriginal pixels",
                "native-action-basic-key-restart-9.png": b"original action pixels",
            }
            for name, data in files.items():
                (evidence / name).write_bytes(data)
            for name in ["webview-profiles", "Scores", "fixtures", "downloads"]:
                nested = evidence / name; nested.mkdir()
                (nested / "excluded.json").write_bytes(b"private or large nested content")
            for name in ["worldmusichub-desktop.exe", "source.zip", "native.log"]:
                (evidence / name).write_bytes(b"not diagnostic JSON or PNG")
            output = root / "diagnostics"
            result = collector.collect(evidence, output, SHA)
            self.assertEqual(result, json.loads((output / collector.INVENTORY).read_bytes()))
            self.assertEqual({row["path"] for row in result["files"]}, set(files))
            self.assertEqual(result["source_reports_checked"], ["native-basic-key.json"])
            self.assertTrue(result["subset_only"])
            self.assertTrue(result["full_artifact_required_for_acceptance"])
            self.assertLessEqual(sum(p.stat().st_size for p in output.iterdir()), 23 * 1024 * 1024)
            for row in result["files"]:
                original = files[row["path"]]
                self.assertEqual((output / row["path"]).read_bytes(), original)
                self.assertEqual((evidence / row["path"]).read_bytes(), original)
                self.assertEqual(row["bytes"], len(original))
                self.assertEqual(row["sha256"], hashlib.sha256(original).hexdigest())

    def test_missing_native_root_is_explicit_and_never_claims_acceptance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = collector.collect(root / "missing", root / "out", SHA)
            self.assertFalse(report["evidence_root_present"])
            self.assertEqual(report["files"], [])
            self.assertEqual(report["source_reports_checked"], [])
            self.assertTrue(report["full_artifact_required_for_acceptance"])

    def test_rejects_wrong_source_in_native_or_independent_proof_before_writing(self):
        for name in collector.SOURCE_REPORTS:
            for source in ["b" * 40, "main", None]:
                with self.subTest(name=name, source=source), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory); evidence = root / "native"; evidence.mkdir()
                    original = json.dumps({"source_sha": source}).encode()
                    (evidence / name).write_bytes(original)
                    with self.assertRaisesRegex(ValueError, "source SHA"):
                        collector.collect(evidence, root / "out", SHA)
                    self.assertFalse((root / "out").exists())
                    self.assertEqual((evidence / name).read_bytes(), original)

    def test_total_includes_inventory_and_does_not_drop_pngs_to_fit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); evidence = root / "native"; evidence.mkdir()
            (evidence / "failure.png").write_bytes(b"p" * 512)
            (evidence / "report.json").write_bytes(b"{}")
            for budget in [1, 513, 600, collector.MAX_BYTES + 1]:
                with self.subTest(budget=budget), self.assertRaises(ValueError):
                    collector.collect(evidence, root / "out", SHA, budget=budget)
                self.assertFalse((root / "out").exists())
            self.assertEqual((evidence / "failure.png").read_bytes(), b"p" * 512)
            (evidence / "failure.png").write_bytes(b"p" * collector.MAX_BYTES)
            with self.assertRaisesRegex(ValueError, "bound"):
                collector.collect(evidence, root / "out", SHA)
            self.assertFalse((root / "out").exists())

    def test_rejects_output_reuse_nested_output_and_non_sha_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); evidence = root / "native"; evidence.mkdir()
            for output, source in [(evidence, SHA), (evidence / "copy", SHA), (root / "out", "main")]:
                with self.assertRaises(ValueError):
                    collector.collect(evidence, output, source)

    def test_rejects_symlink_roots_files_and_directories(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); evidence = root / "native"; evidence.mkdir()
            outside = root / "outside"; outside.mkdir()
            (outside / "secret.json").write_bytes(b"secret")
            try:
                (root / "link").symlink_to(outside, target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest("Symlink creation unavailable on this runner")
            with self.assertRaisesRegex(ValueError, "ordinary directory"):
                collector.collect(root / "link", root / "out", SHA)
            for target, directory_link in [(outside / "secret.json", False), (outside, True)]:
                linked = evidence / "linked.json"
                linked.symlink_to(target, target_is_directory=directory_link)
                with self.assertRaisesRegex(ValueError, "symlinks"):
                    collector.collect(evidence, root / "out", SHA)
                self.assertFalse((root / "out").exists())
                linked.unlink()


if __name__ == "__main__":
    unittest.main()
