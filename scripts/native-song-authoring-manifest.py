#!/usr/bin/env python3
"""Independently bind original song-authoring evidence to source and executable.

This narrow evidence check creates no release and makes no full-checkpoint or
actual-audibility claim. Node re-derives the observations, bytes and GUI contract.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
_profile_spec = importlib.util.spec_from_file_location('native_pitch_bend_manifest', ROOT / 'scripts/native-pitch-bend-manifest.py')
_profile = importlib.util.module_from_spec(_profile_spec)
_profile_spec.loader.exec_module(_profile)
read_evidence = _profile.read_evidence
verify_profile_evidence = _profile.verify_profile_evidence
verify_report_binding = _profile.verify_report_binding
SONG_AUTHORING_PHASES = ['authoring-seed', 'authoring-restart']
SONG_AUTHORING_CLAIMS = json.loads((ROOT / 'scripts/native-song-authoring-claims.json').read_text())
SONG_AUTHORING_REPORTS = ['native-song-authoring.json', *[f'renderer-{phase}.json' for phase in SONG_AUTHORING_PHASES],
                        *[f'profile-{phase}.json' for phase in SONG_AUTHORING_PHASES]]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(read_evidence(path).decode('utf-8-sig'))


def accepted_song_authoring_evidence(directory, executable, commit, tree):
    """Verify the exact source tree, supplied executable and isolated proof."""
    require(re.fullmatch(r'[a-f0-9]{40}', commit) and re.fullmatch(r'[a-f0-9]{40}', tree),
            'Expected exact source commit and tree identifiers')
    directory = Path(directory)
    executable = Path(executable)
    require(executable.is_file() and not executable.is_symlink(), 'Executable must be an ordinary file')
    executable_bytes = executable.read_bytes()
    require(len(executable_bytes) > 0, 'Executable cannot be empty')
    proof_path = directory / 'native-song-authoring-files.json'
    proof, native = read_json(proof_path), read_json(directory / 'native-song-authoring.json')
    for evidence in [proof, native]:
        require(type(evidence.get('version')) is int and evidence['version'] == 1
                and evidence.get('ok') is True and evidence.get('source_sha') == commit
                and evidence.get('source_tree') == tree
                and evidence.get('executable_sha256') == sha(executable_bytes)
                and type(evidence.get('executable_bytes')) is int
                and evidence['executable_bytes'] == len(executable_bytes),
                'Authoring evidence must match the exact source, tree and executable bytes')
    claims = proof.get('claims', {})
    require(set(claims) == set(SONG_AUTHORING_CLAIMS)
            and all(claims[key] is value for key, value in SONG_AUTHORING_CLAIMS.items()),
            'Authoring evidence claim set or exact boolean scope changed')
    verify_profile_evidence(native, SONG_AUTHORING_PHASES,
                            lambda name: read_evidence(directory / name, 16 * 1024))
    checked = subprocess.run(['node', str(ROOT / 'scripts/verify-native-song-authoring-evidence.mjs'),
                              '--check', str(directory)], cwd=ROOT, capture_output=True,
                             text=True, encoding='utf-8', timeout=30, check=False)
    require(checked.returncode == 0,
            'Independent song-authoring verification failed: ' + checked.stderr.strip())
    report_hashes = {}
    for name in SONG_AUTHORING_REPORTS:
        data = read_evidence(directory / name)
        verify_report_binding(proof, name, data, 'original song-authoring report')
        report_hashes[name] = sha(data)
    return {'version': 1, 'scope': 'original-song-authoring-focused-evidence-only',
            'source_sha': commit, 'source_tree': tree,
            'executable_sha256': sha(executable_bytes), 'executable_bytes': len(executable_bytes),
            'full_checkpoint_acceptance': False, 'release_ready': False,
            'native_song_authoring_validated': True,
            'native_song_authoring_proof_sha256': sha(proof_path.read_bytes()),
            'native_song_authoring_reports_sha256': report_hashes,
            'native_song_authoring_claims': claims}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--executable', type=Path, required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--tree', required=True)
    args = parser.parse_args()
    result = accepted_song_authoring_evidence(args.directory, args.executable, args.commit, args.tree)
    destination = args.directory / 'song-authoring-manifest.json'
    require(not destination.is_symlink(), 'Manifest destination must not be a symlink')
    destination.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
