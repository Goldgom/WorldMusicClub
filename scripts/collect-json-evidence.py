#!/usr/bin/env python3
"""Retain a small, hashed JSON diagnostic subset alongside the full CI artifact."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import stat

MAX_BYTES = 23 * 1024 * 1024
MAX_FILES = 4096
EXCLUDED = {"webview-profile", "webview-profiles", "webview-catalog-profile"}


def collect(temp, output, roots, source_sha, budget=MAX_BYTES):
    if not re.fullmatch(r"[0-9a-f]{40}", source_sha):
        raise ValueError("An exact source SHA is required")
    if not 0 < budget <= MAX_BYTES or output.exists():
        raise ValueError("Use a new bounded output directory")
    if len(set(roots)) != len(roots) or not roots:
        raise ValueError("Distinct evidence roots are required")
    entries = []
    for name in roots:
        if not re.fullmatch(r"[A-Za-z0-9_-]+", name):
            raise ValueError("Only direct named evidence directories are allowed")
        root = temp / name
        if root.is_symlink():
            raise ValueError("Evidence root cannot be a symlink")
        if not root.exists():
            continue  # A failed build may have no renderer evidence yet.
        def visit(directory):
            for path in sorted(directory.iterdir()):
                if path.name in EXCLUDED:
                    continue
                mode = path.lstat().st_mode
                if stat.S_ISLNK(mode):
                    raise ValueError("Evidence cannot contain symlinks")
                if stat.S_ISDIR(mode):
                    visit(path)
                elif path.suffix == ".json":
                    if not stat.S_ISREG(mode):
                        raise ValueError("JSON evidence must be an ordinary file")
                    size = path.stat().st_size
                    if size > budget:
                        raise ValueError("An individual JSON report exceeds the bound")
                    data = path.read_bytes()
                    if len(data) != size:
                        raise ValueError("Evidence changed while collecting")
                    entries.append((path.relative_to(temp).as_posix(), data))
                    if len(entries) > MAX_FILES or sum(len(b) for _, b in entries) > budget:
                        raise ValueError("Diagnostic subset exceeds its fixed bound")
        visit(root)
    manifest = {"schema": "worldmusicclub.ci-json-evidence.v1", "source_sha": source_sha,
                "subset_only": True, "full_artifact_required_for_acceptance": True,
                "roots": roots, "files": [{"path": name, "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest()} for name, data in entries]}
    encoded = (json.dumps(manifest, indent=2) + "\n").encode()
    if sum(len(data) for _, data in entries) + len(encoded) > budget:
        raise ValueError("Reports and complete inventory exceed the fixed bound")
    output.mkdir()
    for name, data in entries:
        destination = output / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    (output / "diagnostic-inventory.json").write_bytes(encoded)
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("temp_root", type=Path)
    parser.add_argument("output_root", type=Path)
    parser.add_argument("--root", action="append", required=True)
    parser.add_argument("--source-sha", required=True)
    args = parser.parse_args()
    result = collect(args.temp_root, args.output_root, args.root, args.source_sha)
    print(f"Retained {len(result['files'])} unchanged JSON reports; full evidence stays separate")
