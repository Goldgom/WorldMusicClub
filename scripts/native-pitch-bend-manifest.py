#!/usr/bin/env python3
"""Independently bind original pitch-bend evidence to source and executable.

This narrow evidence check creates no release and makes no full-checkpoint or
actual-audibility claim. Node re-derives the observations, bytes and GUI contract.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PITCH_BEND_PHASES = ['pitch-bend-seed', 'pitch-bend-restart']
PITCH_BEND_CLAIMS = json.loads((ROOT / 'scripts/native-pitch-bend-claims.json').read_text())
PITCH_BEND_REPORTS = ['native-pitch-bend.json', *[f'renderer-{phase}.json' for phase in PITCH_BEND_PHASES]]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    require(path.is_file() and not path.is_symlink() and 0 < path.stat().st_size <= 1024 * 1024,
            'Expected a bounded ordinary evidence file')
    return json.loads(path.read_text(encoding='utf-8-sig'))


def accepted_pitch_bend_evidence(directory, executable, commit, tree):
    """Verify the exact source tree, supplied executable and isolated proof."""
    require(re.fullmatch(r'[a-f0-9]{40}', commit) and re.fullmatch(r'[a-f0-9]{40}', tree),
            'Expected exact source commit and tree identifiers')
    directory = Path(directory)
    executable = Path(executable)
    require(executable.is_file() and not executable.is_symlink(), 'Executable must be an ordinary file')
    executable_bytes = executable.read_bytes()
    require(len(executable_bytes) > 0, 'Executable cannot be empty')
    proof_path = directory / 'native-pitch-bend-files.json'
    proof, native = read_json(proof_path), read_json(directory / 'native-pitch-bend.json')
    for evidence in [proof, native]:
        require(type(evidence.get('version')) is int and evidence['version'] == 1
                and evidence.get('ok') is True and evidence.get('source_sha') == commit
                and evidence.get('source_tree') == tree
                and evidence.get('executable_sha256') == sha(executable_bytes)
                and type(evidence.get('executable_bytes')) is int
                and evidence['executable_bytes'] == len(executable_bytes),
                'Pitch evidence must match the exact source, tree and executable bytes')
    claims = proof.get('claims', {})
    require(set(claims) == set(PITCH_BEND_CLAIMS)
            and all(claims[key] is value for key, value in PITCH_BEND_CLAIMS.items()),
            'Pitch evidence claim set or exact boolean scope changed')
    checked = subprocess.run(['node', str(ROOT / 'scripts/verify-native-pitch-bend-evidence.mjs'),
                              '--check', str(directory)], cwd=ROOT, capture_output=True,
                             text=True, encoding='utf-8', timeout=30, check=False)
    require(checked.returncode == 0,
            'Independent pitch-bend verification failed: ' + checked.stderr.strip())
    report_hashes = {}
    for name in PITCH_BEND_REPORTS:
        data = (directory / name).read_bytes()
        matching = [row for row in proof.get('files', []) if row.get('path') == name]
        require(len(matching) == 1 and matching[0].get('sha256') == sha(data)
                and type(matching[0].get('bytes')) is int and matching[0]['bytes'] == len(data),
                'Proof must bind every exact original pitch-bend report')
        report_hashes[name] = sha(data)
    return {'version': 1, 'scope': 'original-pitch-bend-focused-evidence-only',
            'source_sha': commit, 'source_tree': tree,
            'executable_sha256': sha(executable_bytes), 'executable_bytes': len(executable_bytes),
            'full_checkpoint_acceptance': False, 'release_ready': False,
            'native_pitch_bend_validated': True,
            'native_pitch_bend_proof_sha256': sha(proof_path.read_bytes()),
            'native_pitch_bend_reports_sha256': report_hashes,
            'native_pitch_bend_claims': claims}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--executable', type=Path, required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--tree', required=True)
    args = parser.parse_args()
    result = accepted_pitch_bend_evidence(args.directory, args.executable, args.commit, args.tree)
    destination = args.directory / 'pitch-bend-manifest.json'
    require(not destination.is_symlink(), 'Manifest destination must not be a symlink')
    destination.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
