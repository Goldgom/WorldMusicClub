#!/usr/bin/env python3
"""Generate original Rust fixture candidates, never acceptance or publication."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

# Separate invocations are essential: presets/progression compile assistance JSON.
STEPS = [
    ('WMH_UPDATE_BASIC_KEYS_FIXTURE', 'practice-server', 'clean_draft_api', [
        'song-authoring/basic-key-response.json',
        'song-authoring/basic-key-rendition-runtime.json']),
    ('WMH_UPDATE_BASIC_KEYS_FIXTURE', 'worldmusichub-desktop', 'basic_keys_package', [
        'basic-key-rendition-native-open.json', 'basic-keys-notation-page.json',
        'basic-key-rendition-notation-follow.json', 'basic-key-rendition-notation-no-clock.json',
        'basic-key-rendition-notation-page.json', 'basic-key-rendition-notation-tail.json']),
    ('WMH_UPDATE_ASSISTANCE_FIXTURES', 'worldmusichub-desktop', 'native_assistance', [
        'assistance-native-basic.json', 'assistance-native-vsq.json']),
    ('WMH_UPDATE_ASSISTANCE_PRESET_FIXTURES', 'worldmusichub-desktop', 'native_assistance_presets', [
        'assistance-presets-native-basic.json']),
    ('WMH_UPDATE_PROGRESSION_FIXTURES', 'worldmusichub-desktop', 'native_progression', [
        'progression-native-basic.json', 'progression-native-vsq.json']),
    ('WMH_UPDATE_PITCH_MOD_FIXTURES', 'worldmusichub-desktop', 'native_pitch_mod', [
        'pitch-mod-handler-vectors.json']),
]
OUTPUTS = tuple('tests/fixtures/' + p for step in STEPS for p in step[3])
UNCHANGED = ('tests/fixtures/assistance-native-vsq.json',
             'tests/fixtures/progression-native-vsq.json')
MAX_OUTPUT_BYTES = 16 * 1024 * 1024


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args]).decode().strip()


def digest(path):
    if path.is_symlink() or not path.is_file():
        raise RuntimeError(f'Not a regular file: {path}')
    result = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def snapshot(root, paths):
    return {p: digest(root / p) for p in paths}


def verify_changes(before, after, allowed):
    if any(before[p] != after[p] for p in before if p not in allowed):
        raise RuntimeError('Producer modified non-allowlisted tracked input')


def original_payloads(value, path=()):
    found = {}
    if isinstance(value, dict):
        for key, child in value.items():
            if key in ('score_json', 'metadata_json'):
                found[path + (key,)] = child
            found.update(original_payloads(child, path + (key,)))
    elif isinstance(value, list):
        for i, child in enumerate(value):
            found.update(original_payloads(child, path + (i,)))
    return found


def run_identity():
    patterns = {'GITHUB_RUN_ID': r'[1-9][0-9]*', 'GITHUB_RUN_ATTEMPT': r'[1-9][0-9]*',
                'GITHUB_REPOSITORY': r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+'}
    result = {k: os.environ.get(k, '') for k in patterns}
    if any(not re.fullmatch(patterns[k], result[k]) for k in patterns):
        raise RuntimeError('Missing or invalid CI run identity')
    return result


def generate(root, destination, expected_sha, expected_tree):
    root, destination = Path(root).resolve(), Path(destination).resolve()
    if destination == root or root in destination.parents:
        raise RuntimeError('Artifact destination must be outside checkout')
    if destination.exists():
        raise RuntimeError('Artifact destination already exists')
    sha, tree = git(root, 'rev-parse', 'HEAD'), git(root, 'rev-parse', 'HEAD^{tree}')
    if not re.fullmatch(r'[0-9a-f]{40}', expected_sha) or not re.fullmatch(r'[0-9a-f]{40}', expected_tree):
        raise RuntimeError('Invalid expected source SHA/tree')
    if (sha, tree) != (expected_sha, expected_tree):
        raise RuntimeError('Expected source SHA/tree differs')
    if git(root, 'status', '--porcelain', '--untracked-files=all'):
        raise RuntimeError('Requires clean checkout')
    identity = run_identity()
    paths = subprocess.check_output(['git', '-C', str(root), 'ls-files', '-z']).decode().split('\0')[:-1]
    if len(set(OUTPUTS)) != 14 or not set(OUTPUTS).issubset(paths):
        raise RuntimeError('Requires fourteen tracked original outputs')
    initial = snapshot(root, paths)
    originals = {p: original_payloads(json.loads((root / p).read_text())) for p in OUTPUTS}
    toolchain = {name: subprocess.check_output([name, '--version'], text=True).strip()
                 for name in ('rustc', 'cargo')}
    records = []
    for flag, package, test, outputs in STEPS:
        allowed = ['tests/fixtures/' + p for p in outputs]
        before = snapshot(root, paths)
        env = {k: v for k, v in os.environ.items() if not k.startswith('WMH_UPDATE_')}
        env[flag] = '1'
        command = ['cargo', 'test', '-p', package, '--test', test, '--locked']
        subprocess.run(command, cwd=root, env=env, check=True, timeout=900)
        for p in allowed:
            path = root / p
            if path.is_symlink() or not path.is_file():
                raise RuntimeError('Output is not a regular file')
            if path.stat().st_size > MAX_OUTPUT_BYTES:
                raise RuntimeError('Output exceeds bounded size')
        after = snapshot(root, paths)
        verify_changes(before, after, allowed)
        if git(root, 'ls-files', '--others', '--exclude-standard'):
            raise RuntimeError('Unexpected untracked output')
        if git(root, 'diff', '--cached', '--name-only'):
            raise RuntimeError('Producer modified index')
        for p in allowed:
            json.loads((root / p).read_text())
        records.append({'command': command, 'update_flag': flag,
                        'output_sha256': {p: after[p] for p in allowed}})
    final = snapshot(root, paths)
    verify_changes(initial, final, OUTPUTS)
    for p in OUTPUTS:
        if original_payloads(json.loads((root / p).read_text())) != originals[p]:
            raise RuntimeError('Embedded original score/metadata bytes changed')
    if any(initial[p] != final[p] for p in UNCHANGED):
        raise RuntimeError('Original VSQ golden bytes changed')
    changed = git(root, 'diff', '--name-only', 'HEAD').splitlines()
    if set(changed) - set(OUTPUTS):
        raise RuntimeError('Unexpected tracked mode or file changes')
    if (git(root, 'rev-parse', 'HEAD'), git(root, 'rev-parse', 'HEAD^{tree}')) != (sha, tree):
        raise RuntimeError('Source identity changed')
    manifest = {'status': 'GENERATION ONLY; NOT ACCEPTANCE; REVIEW BEFORE IMPORT',
                'source_sha': sha, 'source_tree': tree, 'run': identity,
                'toolchain': toolchain, 'tracked_input_sha256': initial, 'steps': records,
                'output_sha256': {p: final[p] for p in OUTPUTS},
                'changed_outputs': [p for p in OUTPUTS if initial[p] != final[p]]}
    destination.mkdir(parents=True)
    for p in OUTPUTS:
        target = destination / p
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(root / p, target)
        if digest(target) != final[p]:
            raise RuntimeError('Artifact copy hash mismatch')
    (destination / 'provenance.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print('Generated fourteen original fixture candidates. This is not acceptance.')


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit('Usage: regenerate-original-goldens.py OUTPUT_DIR EXPECTED_SHA EXPECTED_TREE')
    generate(Path(__file__).resolve().parents[1], *sys.argv[1:])
