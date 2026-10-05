import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("json_evidence", Path(__file__).resolve().parents[1] / "scripts/collect-json-evidence.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class JsonEvidenceTest(unittest.TestCase):
    def test_exact_json_only_with_inventory_and_no_profile_or_executable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); evidence = root / "browser"; evidence.mkdir()
            original = b'{"ok":false,"pcm":[0,0]}\n'
            (evidence / "report.json").write_bytes(original)
            (evidence / "image.png").write_bytes(b"png")
            (evidence / "driver").write_bytes(b"exe")
            private = evidence / "webview-profiles"; private.mkdir()
            (private / "Preferences.json").write_text('{"private":true}')
            result = module.collect(root, root / "out", ["browser", "not-created"], "a" * 40)
            self.assertEqual([f["path"] for f in result["files"]], ["browser/report.json"])
            self.assertEqual((root / "out/browser/report.json").read_bytes(), original)
            self.assertEqual((evidence / "report.json").read_bytes(), original)
            self.assertTrue(result["subset_only"])
            self.assertTrue(result["full_artifact_required_for_acceptance"])

    def test_invalid_or_oversized_inputs_leave_no_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); evidence = root / "browser"; evidence.mkdir()
            (evidence / "report.json").write_bytes(b"x" * 1024)
            for roots, budget in [(["../browser"], 4096), (["browser"], 128), (["browser", "browser"], 4096)]:
                with self.assertRaises(ValueError):
                    module.collect(root, root / "out", roots, "a" * 40, budget)
                self.assertFalse((root / "out").exists())


if __name__ == "__main__":
    unittest.main()
