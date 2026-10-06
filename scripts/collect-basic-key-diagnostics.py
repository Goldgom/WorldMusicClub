#!/usr/bin/env python3
"""Copy unchanged root Basic JSON/PNG diagnostics, bounded to 23 MiB total."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import stat

MAX_BYTES = 23 * 1024 * 1024
MAX_FILES = 512
INVENTORY = "diagnostic-inventory.json"
SOURCE_REPORTS = {"native-basic-key.json", "basic-key-proof.json"}


def collect(evidence, output, source_sha, budget=MAX_BYTES):
    if not re.fullmatch(r"[0-9a-f]{40}", source_sha):
        raise ValueError("An exact source SHA is required")
    if not 0 < budget <= MAX_BYTES or output.exists() or output.is_symlink():
        raise ValueError("Use a new bounded diagnostic directory")
    if evidence.is_symlink() or (evidence.exists() and not evidence.is_dir()):
        raise ValueError("Basic evidence must be an ordinary directory")
    if evidence.resolve() in [output.resolve(), *output.resolve().parents]:
        raise ValueError("Keep diagnostics separate from original evidence")
    entries = []
    source_reports = []
    payload_bytes = 0
    # No recursion: profiles, Scores, source archives and downloads stay out.
    # A failed build can have no native directory yet; report that explicitly.
    for path in sorted(evidence.iterdir()) if evidence.exists() else []:
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
        data = path.read_bytes()
        if len(data) != size:
            raise ValueError("Basic evidence changed while collecting")
        if path.name in SOURCE_REPORTS:
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
    args = parser.parse_args()
    result = collect(args.evidence_root, args.output_root, args.source_sha)
    print(f"Retained {len(result['files'])} unchanged Basic JSON/PNG diagnostics; "
          "full Verify + Native acceptance remains separate")
