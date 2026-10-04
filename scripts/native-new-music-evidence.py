"""Required new music feature proofs inside a native candidate.

This composes existing focused verifiers. It does not upgrade their scope into
physical audio, original timbre, or whole-checkpoint acceptance claims.
"""
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

_profile = load('new_music_profiles', 'native-pitch-bend-manifest.py')
_vsq = load('new_music_vsq_authoring', 'native-vsq-authoring-manifest.py')
SCOPES = {
    'basic-key': {
        'prefix': 'native_basic_key_', 'native': 'native-basic-key.json',
        'proof': 'basic-key-proof.json', 'phases': ['basic-key-seed', 'basic-key-restart'],
        'verifier': 'verify-basic-key-evidence.mjs',
        'claims': {'native_window': True, 'physical_audio': False, 'private_music': False, 'full_acceptance': False},
        'names': ('native-basic-key', 'renderer-basic-key', 'profile-basic-key', 'basic-key-proof'),
    },
    'vsq-authoring': {
        'prefix': 'native_vsq_authoring_', 'native': 'native-vsq-authoring.json',
        'proof': 'native-vsq-authoring-files.json', 'phases': _vsq.VSQ_AUTHORING_PHASES,
        'verifier': 'verify-native-vsq-authoring-evidence.mjs', 'claims': _vsq.VSQ_AUTHORING_CLAIMS,
        'manifest': 'vsq-authoring-manifest.json',
        'names': ('native-vsq-authoring', 'renderer-vsq-authoring', 'profile-vsq-authoring', 'vsq-authoring-manifest'),
    },
}
sha = _vsq.sha
require = _vsq.require

def exact(a, b):
    return json.dumps(a, sort_keys=True, separators=(',', ':')) == json.dumps(b, sort_keys=True, separators=(',', ':'))

def reports(scope):
    spec = SCOPES[scope]
    return [spec['native'], *[f'renderer-{p}.json' for p in spec['phases']], *[f'profile-{p}.json' for p in spec['phases']]]

def names(scope):
    spec = SCOPES[scope]
    return [*reports(scope), spec['proof'], *([spec['manifest']] if 'manifest' in spec else [])]

EVIDENCE = [name for scope in SCOPES for name in names(scope)]

def validate(scope, read, executable_bytes, commit, tree):
    """Rebind every retained report to the proof, source, executable and claim set."""
    spec = SCOPES[scope]
    require(isinstance(commit, str) and re.fullmatch('[a-f0-9]{40}', commit)
            and isinstance(tree, str) and re.fullmatch('[a-f0-9]{40}', tree), 'New music evidence needs exact source/tree')
    raw = {name: read(name) for name in names(scope)}
    require(all(0 < len(data) <= 1024 * 1024 for data in raw.values()), 'New music evidence must be bounded')
    values = {name: json.loads(data.decode('utf-8-sig')) for name, data in raw.items()}
    proof, native = values[spec['proof']], values[spec['native']]
    for value in [native, proof]:
        require(isinstance(value, dict) and type(value.get('version')) is int and value['version'] == 1
                and value.get('ok') is True and value.get('source_sha') == commit and value.get('source_tree') == tree
                and value.get('executable_sha256') == sha(executable_bytes)
                and type(value.get('executable_bytes')) is int and value['executable_bytes'] == len(executable_bytes),
                'New music evidence must match exact source/tree/executable bytes')
    require(exact(proof.get('claims'), spec['claims']), 'New music evidence claims changed')
    _profile.verify_profile_evidence(native, spec['phases'], lambda name: raw[name])
    hashes = {}
    for name in reports(scope):
        _profile.verify_report_binding(proof, name, raw[name], f'{scope} report')
        hashes[name] = sha(raw[name])
    prefix = spec['prefix']
    result = {prefix + 'validated': True, prefix + 'proof_sha256': sha(raw[spec['proof']]),
              prefix + 'reports_sha256': hashes, prefix + 'claims': spec['claims']}
    if scope == 'vsq-authoring':
        manifest = {'version': 1, 'scope': 'original-vsq-authoring-focused-evidence-only',
                    'source_sha': commit, 'source_tree': tree,
                    'executable_sha256': sha(executable_bytes), 'executable_bytes': len(executable_bytes),
                    'full_checkpoint_acceptance': False, 'release_ready': False, **result}
        require(exact(values[spec['manifest']], manifest), 'VSQ authoring focused manifest changed')
        result.update({prefix + 'manifest_sha256': sha(raw[spec['manifest']]),
                       prefix + 'scope': manifest['scope'], prefix + 'full_checkpoint_acceptance': False,
                       prefix + 'release_ready': False})
    return result

def accepted(scope, directory, executable, commit, tree):
    directory, executable = Path(directory), Path(executable)
    require(executable.is_file() and not executable.is_symlink(), 'New music executable must be an ordinary file')
    fields = validate(scope, lambda name: _profile.read_evidence(directory / name), executable.read_bytes(), commit, tree)
    env = dict(os.environ)
    env.update(WMH_SOURCE_SHA=commit, WMH_SOURCE_TREE=tree, WMH_BASIC_KEY_EXECUTABLE=str(executable.resolve()))
    checked = subprocess.run(['node', str(ROOT / 'scripts' / SCOPES[scope]['verifier']), '--check', str(directory)],
                             cwd=ROOT, env=env, capture_output=True, text=True, encoding='utf-8', timeout=60, check=False)
    require(checked.returncode == 0, f'Independent {scope} evidence failed: ' + checked.stderr.strip())
    return fields

def verify_inventory(paths):
    paths = list(paths)
    for scope, spec in SCOPES.items():
        expected = {'evidence/' + name for name in names(scope)}
        actual = {name for name in paths if any(part.startswith(spec['names']) for part in PurePosixPath(name).parts)}
        require(actual == expected, f'Exact {scope} package evidence inventory is required')

def verify_packaged(read, metadata, executable='WorldMusicClub-Native.exe'):
    for scope, spec in SCOPES.items():
        fields = validate(scope, lambda name: read('evidence/' + name), read(executable), metadata.get('git_commit'), metadata.get('git_tree'))
        acceptance = metadata.get('acceptance')
        require(isinstance(acceptance, dict)
                and {key for key in acceptance if key.startswith(spec['prefix'])} == set(fields)
                and all(key in acceptance and exact(acceptance[key], value) for key, value in fields.items()),
                'BUILD-INFO must bind every exact new music feature proof and scope')
