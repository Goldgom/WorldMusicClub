import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/partition-browser-evidence.py"
SPEC = importlib.util.spec_from_file_location("browser_evidence_partitions", SCRIPT)
PARTITIONS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PARTITIONS)


class BrowserEvidencePartitionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "temp"
        self.source.mkdir()
        self.rhythm = self.root / "rhythm"
        self.output = self.root / "output"

    def put(self, root, name, data):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def partition(self, **kwargs):
        return PARTITIONS.partition_evidence(self.source, self.rhythm, self.output, **kwargs)

    def symlink_fixture(self, link, target, *, directory=False):
        try:
            link.symlink_to(target, target_is_directory=directory)
        except OSError as error:
            if os.name == "nt" and getattr(error, "winerror", None) == 1314:
                self.skipTest("Windows runner lacks the privilege required to construct a symlink fixture")
            raise

    def assert_partition_contents(self, manifest, expected):
        encoded = (self.output / "manifest.json").read_bytes()
        self.assertEqual(json.loads(encoded), manifest)
        self.assertEqual(manifest["schema"], PARTITIONS.SCHEMA)
        self.assertEqual(manifest["file_count"], len(expected))
        self.assertEqual(manifest["payload_bytes"], sum(map(len, expected.values())))
        self.assertEqual({entry["original_relative_path"] for entry in manifest["files"]}, set(expected))
        observed = set()
        for index in range(1, manifest["part_count"] + 1):
            directory = self.output / f"part-{index:02d}"
            self.assertEqual((directory / "manifest.json").read_bytes(), encoded)
            files = [path for path in directory.rglob("*") if path.is_file()]
            self.assertLessEqual(sum(path.stat().st_size for path in files), manifest["part_budget_bytes"])
            for path in files:
                relative = path.relative_to(directory).as_posix()
                if relative == "manifest.json":
                    continue
                self.assertNotIn(relative, observed)
                observed.add(relative)
                self.assertEqual(path.read_bytes(), expected[relative])
                entry = next(entry for entry in manifest["files"] if entry["original_relative_path"] == relative)
                self.assertEqual(entry["bytes"], len(expected[relative]))
                self.assertEqual(entry["sha256"], hashlib.sha256(expected[relative]).hexdigest())
                self.assertEqual(entry["part_index"], index)
        self.assertEqual(observed, set(expected))
        self.assertEqual(len(list(self.output.glob("part-*"))), manifest["part_count"])

    def test_exact_coverage_hashes_namespaces_and_provenance(self):
        expected = {}
        for name, data in {
            "worldmusichub-screen.png": b"image-data",
            "worldmusichub-omr-scale.json": b'{"scale":1}',
            "worldmusichub-live-input.json": b'{"input":1}',
            "worldmusichub-binding-report.json": b'{"binding":1}',
        }.items():
            self.put(self.source, name, data)
            expected[f"tmp/{name}"] = data
        for name, data in {"server.log": b"server output", "nested/score.png": b"rhythm image", "results.json": b"{}"}.items():
            self.put(self.rhythm, name, data)
            expected[f"worldmusichub-rhythm/{name}"] = data
        self.put(self.source, "credentials.json", b"must not publish")
        self.put(self.source, "worldmusichub-other.json", b"must not publish")
        self.put(self.source, "nested/worldmusichub-screen.png", b"must not publish")
        manifest = self.partition(source_sha="A" * 40, run_url="https://github.com/example/repository/actions/runs/123")
        self.assertEqual(manifest["source_sha"], "a" * 40)
        self.assertEqual(manifest["run_url"], "https://github.com/example/repository/actions/runs/123")
        self.assertNotIn(str(self.root), (self.output / "manifest.json").read_text())
        self.assert_partition_contents(manifest, expected)

    def test_exact_boundary_and_one_byte_over_include_complete_manifest(self):
        expected = {f"tmp/worldmusichub-{name}.png": b"x" * 1024 for name in ("a", "b")}
        for name, data in expected.items():
            self.put(self.source, Path(name).name, data)
        self.partition(part_budget_bytes=4096)
        metadata_size = (self.output / "manifest.json").stat().st_size
        self.output = self.root / "exact"
        budget = 2048 + metadata_size
        manifest = self.partition(part_budget_bytes=budget)
        self.assertEqual(manifest["part_count"], 1)
        self.assertEqual(sum(path.stat().st_size for path in (self.output / "part-01").rglob("*") if path.is_file()), budget)
        self.assert_partition_contents(manifest, expected)
        self.output = self.root / "one-byte-over"
        manifest = self.partition(part_budget_bytes=budget - 1)
        self.assertEqual(manifest["part_count"], 2)
        self.assert_partition_contents(manifest, expected)

    def test_partitions_are_reproducible_for_different_creation_orders(self):
        expected = {f"tmp/worldmusichub-{index}.png": bytes([index]) * 1200 for index in range(5)}
        for name, data in reversed(list(expected.items())):
            self.put(self.source, Path(name).name, data)
        manifest = self.partition(part_budget_bytes=4096)
        self.assertGreater(manifest["part_count"], 1)
        self.assert_partition_contents(manifest, expected)
        first = {path.relative_to(self.output): path.read_bytes() for path in self.output.rglob("*") if path.is_file()}
        second_source = self.root / "second-source"
        second_source.mkdir()
        for name, data in expected.items():
            self.put(second_source, Path(name).name, data)
        self.source = second_source
        self.output = self.root / "second-output"
        self.assertEqual(self.partition(part_budget_bytes=4096), manifest)
        second = {path.relative_to(self.output): path.read_bytes() for path in self.output.rglob("*") if path.is_file()}
        self.assertEqual(first, second)

    def test_empty_evidence_has_a_complete_single_part_manifest(self):
        manifest = self.partition()
        self.assertEqual(manifest["part_count"], 1)
        self.assertIsNone(manifest["source_sha"])
        self.assert_partition_contents(manifest, {})

    def test_individual_and_total_size_limits_fail_before_output_creation(self):
        path = self.put(self.source, "worldmusichub-large.png", b"x" * 4096)
        with self.assertRaisesRegex(ValueError, "individual"):
            self.partition(part_budget_bytes=4096)
        self.assertFalse(self.output.exists())
        path.write_bytes(b"x" * 3900)
        with self.assertRaisesRegex(ValueError, "manifest exceeds"):
            self.partition(part_budget_bytes=4096)
        self.assertFalse(self.output.exists())
        for index in range(6):
            self.put(self.source, f"worldmusichub-{index}.png", b"x" * 4095)
        with self.assertRaisesRegex(ValueError, "Total evidence"):
            self.partition(part_budget_bytes=4096)
        self.assertFalse(self.output.exists())

    def test_six_part_cap_rejects_unfit_seventh_file(self):
        for index in range(7):
            self.put(self.source, f"worldmusichub-{index}.png", b"x" * 1600)
        with self.assertRaisesRegex(ValueError, "cannot fit in six"):
            self.partition(part_budget_bytes=4096)
        self.assertFalse(self.output.exists())

    def test_exactly_six_parts_are_supported(self):
        expected = {f"tmp/worldmusichub-{index}.png": bytes([index]) * 1600 for index in range(6)}
        for name, data in expected.items():
            self.put(self.source, Path(name).name, data)
        manifest = self.partition(part_budget_bytes=4096)
        self.assertEqual(manifest["part_count"], 6)
        self.assert_partition_contents(manifest, expected)

    def test_does_not_follow_eligible_symlinks_or_rhythm_directory_links(self):
        external = self.put(self.root, "external.txt", b"not evidence")
        link = self.source / "worldmusichub-link.png"
        self.symlink_fixture(link, external)
        with self.assertRaisesRegex(ValueError, "regular file"):
            self.partition()
        self.assertFalse(self.output.exists())
        link.unlink()
        self.rhythm.mkdir()
        self.symlink_fixture(self.rhythm / "nested", self.source, directory=True)
        with self.assertRaisesRegex(ValueError, "regular file"):
            self.partition()
        self.assertFalse(self.output.exists())

    def test_symlink_roots_including_missing_targets_are_rejected(self):
        self.symlink_fixture(self.rhythm, self.root / "absent", directory=True)
        with self.assertRaisesRegex(ValueError, "Symbolic links"):
            self.partition()
        self.assertFalse(self.output.exists())

    def test_existing_output_and_output_in_evidence_tree_are_rejected(self):
        sentinel = self.put(self.output, "keep.txt", b"keep")
        with self.assertRaisesRegex(ValueError, "newly created"):
            self.partition()
        self.assertEqual(sentinel.read_bytes(), b"keep")
        self.rhythm.mkdir()
        self.output = self.rhythm / "output"
        with self.assertRaisesRegex(ValueError, "within the rhythm"):
            self.partition()
        self.assertFalse(self.output.exists())

    def test_unsafe_names_and_invalid_root_are_rejected(self):
        for path in ("unsafe\\name.png", "../escape.png", "/absolute.png", "control\ncharacter.png"):
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, "Unsafe evidence path"):
                PARTITIONS.safe_relative(PurePosixPath(path))
        self.assertFalse(self.output.exists())
        self.source = self.root / "missing-source"
        with self.assertRaisesRegex(ValueError, "existing directory"):
            self.partition()

    def test_invalid_provenance_and_raised_budget_are_rejected(self):
        for kwargs in (
            {"source_sha": "short"},
            {"run_url": "http://github.com/o/r/actions/runs/1"},
            {"run_url": "https://github.com.evil.example/o/r/actions/runs/1"},
            {"run_url": "https://github.com/o/r/actions/runs/1?token=secret"},
            {"run_url": "https://github.com/o/r/issues/1"},
            {"part_budget_bytes": PARTITIONS.PART_BUDGET_BYTES + 1},
        ):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                self.partition(**kwargs)
        self.assertFalse(self.output.exists())

    def test_cli_reports_empty_success_and_existing_output_failure(self):
        command = [sys.executable, str(SCRIPT), str(self.source), str(self.rhythm), str(self.output)]
        success = subprocess.run(command, capture_output=True, text=True, check=False)
        self.assertEqual(success.returncode, 0, success.stderr)
        self.assertIn("Partitioned 0 files", success.stdout)
        failure = subprocess.run(command, capture_output=True, text=True, check=False)
        self.assertEqual(failure.returncode, 1)
        self.assertIn("newly created", failure.stderr)


if __name__ == "__main__":
    unittest.main()
