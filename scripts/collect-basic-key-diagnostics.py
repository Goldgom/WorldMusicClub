#!/usr/bin/env python3
"""Copy unchanged Basic or explicitly scoped build JSON/PNG diagnostics, at most 23 MiB."""
import argparse
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import stat

MAX_BYTES = 23 * 1024 * 1024
MAX_FILES = 512
INVENTORY = "diagnostic-inventory.json"
SOURCE_REPORTS = {"native-basic-key.json", "basic-key-proof.json"}
BUILD_SOURCE_REPORTS = {"native-build-diagnostics.json", "build-diagnostics-proof.json"}
BUILD_FILES = frozenset({
    *BUILD_SOURCE_REPORTS, "renderer-build-diagnostics.json", "profile-build-diagnostics.json",
    "trace-build-diagnostics.json", "diagnostic-build-diagnostics.json",
    "snapshot-build-diagnostics.json", "snapshot-build-diagnostics-before.json",
    "snapshot-build-diagnostics-after.json", "native-build-diagnostics.png",
    "native-failure-build-diagnostics.png",
    *(f"{kind}-build-diagnostics-{number}.json" for kind in ("action", "result") for number in range(1, 33)),
    *(f"native-action-build-diagnostics-{number}.png" for number in range(1, 33)),
})
BUILD_DIRECTORIES = ("Scores", *("Scores/" + area for area in (
    "songs", "backups", ".staging", "clean-songs", "clean-backups", ".clean-staging",
    "imports", "import-backups", ".import-staging", "catalog", "catalog-backups", ".catalog-staging")))


def build_reader():
    # Reuse the verified transfer path/link checks and bounded partition reads.
    modules = []
    for name in ("native-acceptance-transfer", "partition-browser-evidence"):
        spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        modules.append(module)
    return modules


def collect(evidence, output, source_sha, budget=MAX_BYTES, *, scenario="basic-key"):
    if scenario not in {"basic-key", "build-diagnostics"}:
        raise ValueError("Unknown bounded diagnostic scenario")
    build = scenario == "build-diagnostics"
    if not re.fullmatch(r"[0-9a-f]{40}", source_sha):
        raise ValueError("An exact source SHA is required")
    if not 0 < budget <= MAX_BYTES or output.exists() or output.is_symlink():
        raise ValueError("Use a new bounded diagnostic directory")
    if evidence.is_symlink() or (evidence.exists() and not evidence.is_dir()):
        raise ValueError("Basic evidence must be an ordinary directory")
    if evidence.resolve() in [output.resolve(), *output.resolve().parents]:
        raise ValueError("Keep diagnostics separate from original evidence")
    if build:
        transfer, partition = build_reader()
        evidence = transfer.checked_path(evidence, directory=True, missing=True)
        output = transfer.checked_path(output, directory=True, missing=True)
    source_names = BUILD_SOURCE_REPORTS if build else SOURCE_REPORTS
    entries = []
    source_reports = []
    payload_bytes = 0
    # No recursion: profiles, Scores, source archives and downloads stay out.
    # Build diagnostics inspect only a fixed list, without enumerating unrelated
    # files. A failed build can have no native directory yet; report it explicitly.
    candidates = (sorted(evidence / name for name in BUILD_FILES) if build else
                  sorted(evidence.iterdir()) if evidence.exists() else [])
    for path in candidates:
        if build and not path.exists() and not path.is_symlink():
            continue
        mode = path.lstat().st_mode
        if stat.S_ISLNK(mode):
            raise ValueError("Basic evidence cannot contain symlinks")
        if path.suffix.lower() not in {".json", ".png"}:
            continue
        if not stat.S_ISREG(mode) or path.name == INVENTORY:
            raise ValueError("Basic diagnostics must be original ordinary files")
        size = path.stat().st_size
        if len(entries) >= MAX_FILES or size > budget - payload_bytes:
            raise ValueError("Basic JSON/PNG diagnostics exceed the fixed bound")
        if build:
            transfer.checked_path(path, directory=False)
            buffer = io.BytesIO()
            partition.read_file(path, size, buffer)
            data = buffer.getvalue()
        else:
            data = path.read_bytes()
        if len(data) != size:
            raise ValueError("Basic evidence changed while collecting")
        if path.name in source_names:
            report = json.loads(data.decode("utf-8-sig"))
            if not isinstance(report, dict) or report.get("source_sha") != source_sha:
                raise ValueError("Basic report differs from the requested source SHA")
            source_reports.append(path.name)
        entries.append((path.name, data))
        payload_bytes += len(data)
    manifest = {
        "schema": "worldmusicclub.ci-basic-key-diagnostics.v1",
        "source_sha": source_sha,
        "subset_only": True,
        "full_artifact_required_for_acceptance": True,
        "evidence_root_present": evidence.exists(),
        "source_reports_checked": source_reports,
        "budget_bytes": budget,
        "payload_bytes": payload_bytes,
        "files": [{"path": name, "bytes": len(data),
                   "sha256": hashlib.sha256(data).hexdigest()} for name, data in entries],
    }
    if build:
        directories = []
        for name in BUILD_DIRECTORIES:
            directory = transfer.checked_path(evidence / name, directory=True, missing=True)
            present = directory.exists()
            # Record absence/nonempty failure states faithfully. No library file
            # bytes or arbitrary descendant paths belong in this small export.
            directories.append({"path": name, "present": present,
                                "empty": next(directory.iterdir(), None) is None if present else None})
        manifest.update(schema="worldmusicclub.ci-build-diagnostics.v1", diagnostic_only=True,
                        full_acceptance=False, directories=directories)
    encoded = (json.dumps(manifest, indent=2) + "\n").encode()
    if payload_bytes + len(encoded) > budget:
        raise ValueError("Basic diagnostics and inventory exceed the fixed bound")
    # Finish validation before writing. Never modify or delete original files.
    output.mkdir()
    for name, data in entries:
        destination = output / name
        destination.write_bytes(data)
        if destination.read_bytes() != data:
            raise OSError("Basic diagnostic copy differs from original bytes")
    (output / INVENTORY).write_bytes(encoded)
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence_root", type=Path)
    parser.add_argument("output_root", type=Path)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--scenario", choices=("basic-key", "build-diagnostics"), default="basic-key")
    args = parser.parse_args()
    result = collect(args.evidence_root, args.output_root, args.source_sha, scenario=args.scenario)
    label = 'Basic' if args.scenario == 'basic-key' else 'build-diagnostics'
    print(f"Retained {len(result['files'])} unchanged {label} JSON/PNG diagnostics; "
          "full Verify + Native acceptance remains separate")
