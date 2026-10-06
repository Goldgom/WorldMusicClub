#!/usr/bin/env python3
"""Retain each exact VSQ following capture as a small diagnostic-only artifact."""
import argparse
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import re

SPEC = importlib.util.spec_from_file_location(
    'native_capture_transfer', Path(__file__).with_name('native-acceptance-transfer.py'))
TRANSFER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TRANSFER)
require = TRANSFER.require
PHASES = ('vsq-seed', 'vsq-restart')
INVENTORY = 'capture-diagnostic-inventory.json'
MAX_BYTES = 20 * 1024 * 1024  # Per phase, including its inventory, below download limits.
MAX_PNG = 16 * 1024 * 1024
MAX_REPORT = 1024 * 1024
MAX_ACTION = 16 * 1024
MAX_RESULT = 256 * 1024
MAX_PROFILE = 16 * 1024
MAX_INVENTORY = 64 * 1024


def exact_root(value, *, missing=False):
    # Reject lexical aliases before checked_path normalizes them. Mixed slash
    # separators from Windows runner expressions are otherwise supported.
    text = os.fspath(value)
    normalized = text.replace('\\', '/')
    require(not normalized.startswith('//'), 'Use a local owned root, not a UNC alias')
    parts = normalized.split('/')
    if re.fullmatch('[A-Za-z]:', parts[0]):
        require(parts[0] == parts[0].upper(), 'Drive case aliases are forbidden')
        parts = parts[1:]
    elif parts[0] == '':
        parts = parts[1:]
    require(parts and all(part and part not in ('.', '..') for part in parts),
            'Root path aliases are forbidden')
    for part in parts:
        TRANSFER.safe_name(part)
    require(Path(text).is_absolute(), 'Use an absolute owned evidence/output root')
    path = TRANSFER.checked_path(text, directory=True, missing=missing)
    for current in reversed((path, *path.parents)):
        if current == current.parent or not current.parent.exists():
            continue
        names = [entry.name for entry in current.parent.iterdir()
                 if entry.name.casefold() == current.name.casefold()]
        require(names == [current.name] if current.exists() else not names,
                'Case/short-name-aliased root component')
    return path


def read_optional(root, name, limit):
    require('/' not in name and '\\' not in name and TRANSFER.safe_name(name) == [name],
            'Only exact root evidence names are admitted')
    if not root.exists():
        return None
    # Do not follow a case alias on a case-insensitive runner. No recursion,
    # score packages, downloads, profiles, alternate screenshots or executables.
    names = [entry.name for entry in root.iterdir() if entry.name.casefold() == name.casefold()]
    require(not names or names == [name], 'Case-aliased evidence filename')
    if not names:
        return None
    path = TRANSFER.checked_path(root / name, directory=False)
    size = path.lstat().st_size
    require(0 < size <= limit, 'Original evidence exceeds its fixed file bound: ' + name)
    output = io.BytesIO()
    TRANSFER.read_ordinary(path, size, output=output)
    TRANSFER.checked_path(path, directory=False)
    return output.getvalue()


def object_json(data, label):
    if data is None:
        return None
    value = TRANSFER.parse_json(data)
    require(type(value) is dict, 'Original ' + label + ' must be a JSON object')
    return value


def collect_phase(root, phase, source_sha, budget):
    entries, missing = {}, []

    def retain(name, limit, *, required=True):
        data = read_optional(root, name, limit)
        if data is None:
            if required:
                missing.append(name)
        else:
            entries[name] = data
        return data

    native_name = 'native-vsq-song.json'
    renderer_name = f'renderer-{phase}.json'
    native = object_json(retain(native_name, MAX_REPORT), native_name)
    renderer = object_json(retain(renderer_name, MAX_REPORT), renderer_name)
    retain(f'profile-{phase}.json', MAX_PROFILE, required=False)
    if native is not None:
        require(native.get('source_sha') == source_sha, 'Native source SHA differs')
        require(re.fullmatch('[0-9a-f]{40}', native.get('source_tree', '')) is not None
                and re.fullmatch('[0-9a-f]{64}', native.get('executable_sha256', '')) is not None,
                'Native tree/executable identity missing')
        require(native.get('version') == 1 and native.get('scenario') == 'vsq-song',
                'Native metadata belongs to another scenario')
    sequence, binding_checked = None, False
    if renderer is not None:
        require(renderer.get('version') == 1 and renderer.get('phase') == phase,
                'Renderer metadata belongs to another phase')
        screenshots = renderer.get('screenshots', {})
        require(type(screenshots) is dict, 'Renderer screenshots must be an object')
        sequence = screenshots.get('following')
        if sequence is not None:
            require(type(sequence) is int and 1 <= sequence <= 80,
                    'Following sequence must be an exact bounded integer')
    if sequence is None:
        missing.append('following_sequence_not_recorded')
    else:
        action_name = f'action-{phase}-{sequence}.json'
        result_name = f'result-{phase}-{sequence}.json'
        png_name = f'native-action-{phase}-{sequence}.png'
        action = object_json(retain(action_name, MAX_ACTION), action_name)
        result = object_json(retain(result_name, MAX_RESULT), result_name)
        pixels = retain(png_name, MAX_PNG)
        if action is not None:
            require(action.get('version') == 1 and type(action.get('sequence')) is int
                    and action['sequence'] == sequence and action.get('kind') == 'capture',
                    'Following action must be the matching passive capture')
        if pixels is not None:
            require(pixels.startswith(b'\x89PNG\r\n\x1a\n'), 'Following image is not original PNG bytes')
        capture = result.get('native_capture') if result is not None else None
        if capture is None:
            missing.append('native_capture_receipt_not_recorded')
        else:
            require(type(capture) is dict and result.get('ok') is True
                    and capture.get('version') == 1 and capture.get('kind') == 'foreground-client-pixels'
                    and capture.get('phase') == phase and type(capture.get('sequence')) is int
                    and capture['sequence'] == sequence and capture.get('file') == png_name,
                    'Following receipt does not bind the exact phase/action/PNG')
            require(capture.get('source_sha') == source_sha, 'Capture source SHA differs')
            if native is not None:
                for key in ('source_sha', 'source_tree', 'executable_sha256'):
                    require(capture.get(key) == native[key], 'Capture source/tree/executable differs')
            if pixels is not None:
                require(type(capture.get('bytes')) is int and capture['bytes'] == len(pixels)
                        and capture.get('sha256') == hashlib.sha256(pixels).hexdigest(),
                        'Following PNG bytes differ from its original receipt')
            binding_checked = all(value is not None for value in (native, action, pixels))
    manifest = {
        'schema': 'worldmusicclub.ci-vsq-following-capture.v1', 'source_sha': source_sha,
        'phase': phase, 'following_sequence': sequence, 'diagnostic_only': True,
        'subset_only': True, 'full_artifact_required_for_acceptance': True,
        'evidence_root_present': root.exists(),
        'renderer_ok': renderer.get('ok') if renderer is not None else None,
        'native_ok': native.get('ok') if native is not None else None,
        'capture_binding_checked': binding_checked,
        'state': 'capture-retained' if binding_checked and not missing else 'capture-unavailable',
        'missing': missing, 'budget_bytes': budget,
        'payload_bytes': sum(len(data) for data in entries.values()),
        'files': [{'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
                  for name, data in sorted(entries.items())],
    }
    encoded = TRANSFER.json_bytes(manifest)
    require(len(encoded) <= MAX_INVENTORY and manifest['payload_bytes'] + len(encoded) <= budget,
            'Phase capture and inventory exceed the fixed total bound')
    return manifest, {**entries, INVENTORY: encoded}


def collect(evidence, output, source_sha, budget=MAX_BYTES):
    require(type(source_sha) is str and re.fullmatch('[0-9a-f]{40}', source_sha),
            'An exact source SHA is required')
    require(type(budget) is int and 0 < budget <= MAX_BYTES, 'Invalid per-phase byte bound')
    evidence = exact_root(evidence, missing=True)
    output = exact_root(output, missing=True)
    require(not output.exists(), 'Use a fresh output root without overwrite')
    require(not evidence.is_relative_to(output) and not output.is_relative_to(evidence),
            'Keep phase diagnostics separate from original evidence')
    TRANSFER.checked_path(output.parent, directory=True)
    # Validate both phases completely before creating either output. A failure
    # never drops a PNG or chooses another action merely to fit the bound.
    phases = {phase: collect_phase(evidence, phase, source_sha, budget) for phase in PHASES}
    output.mkdir()
    for phase, (_, files) in phases.items():
        directory = output / phase
        directory.mkdir()
        for name, data in files.items():
            TRANSFER.checked_path(directory, directory=True)
            destination = directory / name
            with destination.open('xb') as stream:
                stream.write(data)
            require(read_optional(directory, name, max(len(data), 1)) == data,
                    'Diagnostic copy differs from original bytes')
    return {phase: value[0] for phase, value in phases.items()}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('evidence_root')
    parser.add_argument('output_root')
    parser.add_argument('--source-sha', required=True)
    args = parser.parse_args()
    result = collect(args.evidence_root, args.output_root, args.source_sha)
    for phase, manifest in result.items():
        print(f"{phase}: {manifest['state']}; {len(manifest['files'])} unchanged files; "
              'full acceptance remains separate')
