#!/usr/bin/env python3
"""Copy CI browser evidence into at most six bounded, independently verifiable parts.

Usage: partition-browser-evidence.py TEMP_ROOT RHYTHM_ROOT OUTPUT_ROOT
The optional rhythm directory may be absent. OUTPUT_ROOT must not exist. Each
part contains raw files and an identical complete manifest; no archives or
original evidence are modified. The 23 MiB limit leaves upload packaging room
under the 24 MiB delivery limit.
"""

import argparse
import fnmatch
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
from urllib.parse import urlsplit


PART_BUDGET_BYTES = 23 * 1024 * 1024
MAX_PARTS = 6
MAX_FILES = 4096
SCHEMA = "worldmusichub.browser-evidence-parts.v1"
PATTERNS = (
    "worldmusichub-*.png",
    "worldmusichub-omr-*.json",
    "worldmusichub-live-*.json",
    "worldmusichub-binding-*.json",
)


def safe_path(path):
    """Reject symlink components, including a dangling final component."""
    path = Path(os.path.abspath(path))
    for component in reversed((path, *path.parents)):
        try:
            mode = component.lstat().st_mode
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(mode):
            raise ValueError(f"Symbolic links are not allowed: {component}")
    return path


def safe_relative(path):
    parts = path.parts
    if (path.is_absolute() or not parts or any(
        part in ("", ".", "..") or "\\" in part
        or any(ord(char) < 32 or ord(char) == 127 for char in part)
        for part in parts
    )):
        raise ValueError(f"Unsafe evidence path: {path!s}")
    return path.as_posix()


def provenance(source_sha, run_url):
    if source_sha is not None and not re.fullmatch(r"[0-9a-fA-F]{40}", source_sha):
        raise ValueError("Source SHA must contain exactly 40 hexadecimal characters")
    if run_url is not None:
        url = urlsplit(run_url)
        if (url.scheme != "https" or url.netloc != "github.com"
                or url.query or url.fragment
                or not re.fullmatch(r"/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/actions/runs/[1-9][0-9]*", url.path)):
            raise ValueError("Run URL must be an HTTPS github.com owner/repo/actions/runs/ID URL")
    return source_sha.lower() if source_sha is not None else None, run_url


def collect_files(temp_root, rhythm_root):
    files = []

    def add(path, relative):
        relative = safe_relative(relative)
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode):
            raise ValueError(f"Evidence must be a regular file, not a link or special file: {path}")
        files.append((relative, path, info.st_size))
        if len(files) > MAX_FILES:
            raise ValueError(f"Evidence exceeds the {MAX_FILES}-file limit")

    for path in sorted(temp_root.iterdir()):
        if any(fnmatch.fnmatchcase(path.name, pattern) for pattern in PATTERNS):
            add(path, Path("tmp") / path.name)

    def visit(directory):
        for path in sorted(directory.iterdir()):
            relative = Path("worldmusichub-rhythm") / path.relative_to(rhythm_root)
            safe_relative(relative)
            info = path.lstat()
            if stat.S_ISDIR(info.st_mode):
                visit(path)
            else:
                add(path, relative)

    if rhythm_root.exists():
        if not rhythm_root.is_dir():
            raise ValueError("Rhythm root must be a directory or be absent")
        visit(rhythm_root)
    return sorted(files)


def read_file(path, expected_size, destination=None):
    """Hash bounded reads; detect changed inputs and never open a final symlink."""
    safe_path(path)
    flags = (os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
             | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_BINARY", 0))
    descriptor = os.open(path, flags)
    digest = hashlib.sha256()
    size = 0
    with os.fdopen(descriptor, "rb") as source:
        before = os.fstat(source.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size != expected_size:
            raise ValueError(f"Evidence changed or is not a regular file: {path}")
        while chunk := source.read(1024 * 1024):
            size += len(chunk)
            if size > expected_size:
                raise ValueError(f"Evidence grew while reading: {path}")
            digest.update(chunk)
            if destination is not None:
                destination.write(chunk)
        after = os.fstat(source.fileno())
        if (size != expected_size or before.st_mtime_ns != after.st_mtime_ns
                or before.st_ctime_ns != after.st_ctime_ns):
            raise ValueError(f"Evidence changed while reading: {path}")
    return digest.hexdigest()


def manifest_bytes(manifest):
    return (json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=True) + "\n").encode("utf-8")


def partition_evidence(temp_root, rhythm_root, output_root, *, source_sha=None,
                       run_url=None, part_budget_bytes=PART_BUDGET_BYTES):
    """Create new output directories and return the complete manifest.

    A smaller budget is supported for focused tests; callers cannot raise the
    production cap. Invalid/oversized inputs fail before creating any output.
    """
    if not isinstance(part_budget_bytes, int) or not 0 < part_budget_bytes <= PART_BUDGET_BYTES:
        raise ValueError(f"Part budget must be between 1 and {PART_BUDGET_BYTES} bytes")
    source_sha, run_url = provenance(source_sha, run_url)
    temp_root, rhythm_root, output_root = map(safe_path, (temp_root, rhythm_root, output_root))
    if not temp_root.is_dir():
        raise ValueError("Temp root must be an existing directory")
    if rhythm_root == temp_root or temp_root.is_relative_to(rhythm_root):
        raise ValueError("Rhythm root must not contain the temp root")
    if output_root == rhythm_root or output_root.is_relative_to(rhythm_root):
        raise ValueError("Output root must not be within the rhythm evidence tree")
    if output_root.exists():
        raise ValueError("Output root must be newly created, not an existing path")
    if not output_root.parent.is_dir():
        raise ValueError("Output root's parent directory must already exist")

    sources = collect_files(temp_root, rhythm_root)
    payload_bytes = sum(size for _, _, size in sources)
    if payload_bytes > MAX_PARTS * part_budget_bytes:
        raise ValueError(f"Total evidence exceeds {MAX_PARTS} part budgets")
    if any(size >= part_budget_bytes for _, _, size in sources):
        raise ValueError("An individual evidence file leaves no room for its manifest within the part budget")
    files = [
        {"original_relative_path": relative, "bytes": size,
         "sha256": read_file(path, size), "part_index": 1}
        for relative, path, size in sources
    ]
    manifest = {
        "schema": SCHEMA, "source_sha": source_sha, "run_url": run_url,
        "part_budget_bytes": part_budget_bytes, "max_parts": MAX_PARTS,
        "part_count": 1, "file_count": len(files), "payload_bytes": payload_bytes,
        "files": files,
    }
    # All possible part indexes/counts are one digit, so these assignments do
    # not change the serialized manifest size. Every part carries the union.
    metadata_size = len(manifest_bytes(manifest))
    capacity = part_budget_bytes - metadata_size
    if capacity < 0 or any(entry["bytes"] > capacity for entry in files):
        raise ValueError("An individual evidence file plus complete manifest exceeds the part budget")
    if payload_bytes > MAX_PARTS * capacity:
        raise ValueError("Total evidence plus complete manifests exceeds six part budgets")
    sizes = [0]
    # First-fit decreasing gives stable, compact packing independent of the
    # filesystem enumeration order, while filenames break equal-size ties.
    for entry in sorted(files, key=lambda item: (-item["bytes"], item["original_relative_path"])):
        index = next((index for index, size in enumerate(sizes)
                      if size + entry["bytes"] <= capacity), None)
        if index is None:
            if len(sizes) == MAX_PARTS:
                raise ValueError("Evidence cannot fit in six bounded parts; reduce evidence size")
            index = len(sizes)
            sizes.append(0)
        sizes[index] += entry["bytes"]
        entry["part_index"] = index + 1
    manifest["part_count"] = len(sizes)
    encoded = manifest_bytes(manifest)
    if len(encoded) != metadata_size:
        raise ValueError("Unexpected manifest growth during partitioning")

    output_root.mkdir()
    for index in range(1, len(sizes) + 1):
        (output_root / f"part-{index:02d}").mkdir()
    for entry, (_, source, size) in zip(files, sources):
        destination = output_root / f"part-{entry['part_index']:02d}" / entry["original_relative_path"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("xb") as target:
            digest = read_file(source, size, target)
        if digest != entry["sha256"]:
            raise ValueError(f"Evidence changed between inventory and copy: {source}")
    # Manifests are written only after every copy is verified. A failed copy
    # leaves no completion manifest and does not delete or overwrite anything.
    for index in range(1, len(sizes) + 1):
        (output_root / f"part-{index:02d}" / "manifest.json").write_bytes(encoded)
    (output_root / "manifest.json").write_bytes(encoded)
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("temp_root", type=Path)
    parser.add_argument("rhythm_root", type=Path)
    parser.add_argument("output_root", type=Path)
    parser.add_argument("--source-sha")
    parser.add_argument("--run-url")
    args = parser.parse_args(argv)
    try:
        result = partition_evidence(args.temp_root, args.rhythm_root, args.output_root,
                                    source_sha=args.source_sha, run_url=args.run_url)
    except (OSError, ValueError) as error:
        print(f"Cannot partition browser evidence: {error}", file=sys.stderr)
        return 1
    print(f"Partitioned {result['file_count']} files ({result['payload_bytes']} bytes) "
          f"into {result['part_count']} part(s) at {args.output_root}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
