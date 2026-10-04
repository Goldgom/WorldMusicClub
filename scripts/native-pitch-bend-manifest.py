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
PITCH_BEND_REPORTS = ['native-pitch-bend.json', *[f'renderer-{phase}.json' for phase in PITCH_BEND_PHASES],
                      *[f'profile-{phase}.json' for phase in PITCH_BEND_PHASES]]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_evidence(path, limit=1024 * 1024):
    path = Path(path)
    require(path.is_file() and not path.is_symlink() and 0 < path.stat().st_size <= limit,
            'Expected a bounded ordinary evidence file')
    data = path.read_bytes()
    require(0 < len(data) <= limit, 'Expected a bounded ordinary evidence file')
    return data


def read_json(path):
    return json.loads(read_evidence(path).decode('utf-8-sig'))


def verify_profile_evidence(native, phases, read):
    """Validate host-created profiles identically before and after packaging."""
    def absolute_directory(value):
        require(isinstance(value, str) and 0 < len(value) <= 32768
                and not any(char in value for char in '\r\n\0'), 'Native profile directory is invalid')
        path = value.replace('\\', '/')
        require((path.startswith('/') and not path.startswith('//') or re.match(r'^[A-Za-z]:/', path))
                and all(part and part not in ['.', '..'] for part in path.split('/')[1:]),
                'Native profile directory must be absolute without aliases')
        return path

    rows = native.get('phases')
    require(isinstance(rows, list) and all(isinstance(row, dict) for row in rows)
            and [row.get('phase') for row in rows] == phases, 'Native profile phases must be exact and ordered')
    library = absolute_directory(native.get('directory'))
    require(library.endswith('/Scores'), 'Native profile library must identify the absolute Scores root')
    processes, profiles = set(), set()
    for row in rows:
        phase, process = row['phase'], row.get('process_id')
        require(type(process) is int and 0 < process <= 9007199254740991 and process not in processes,
                'Native profile phases must use distinct valid processes')
        processes.add(process)
        profile = absolute_directory(row.get('profile_directory'))
        require(profile == library[:-len('/Scores')] + '/webview-profiles/' + phase and profile not in profiles,
                'Native profile directory must use its exact phase under the evidence root')
        profiles.add(profile)
        require(row.get('profile_fresh') is True and row.get('profile_reused') is False
                and row.get('profile_absent_before_launch') is True,
                'Native profile requires an absent fresh profile before launch')
        data = read(f'profile-{phase}.json')
        require(0 < len(data) <= 16 * 1024, 'Native profile host evidence must be bounded')
        host = json.loads(data.decode('utf-8-sig'))
        require(isinstance(host, dict) and type(host.get('version')) is int and host['version'] == 1
                and host.get('phase') == phase and type(host.get('process_id')) is int
                and host['process_id'] == process and host.get('profile_directory') == row['profile_directory']
                and host.get('library_directory') == native['directory']
                and host.get('fresh_required') is True and host.get('created_new') is True,
                'Native profile host must match the phase, process and directories and prove fresh atomic creation')


def verify_report_binding(proof, name, data, label='original report'):
    files = proof.get('files')
    require(isinstance(files, list) and all(isinstance(row, dict) for row in files),
            'Proof requires its original file inventory')
    matching = [row for row in files if row.get('path') == name]
    require(len(matching) == 1 and matching[0].get('sha256') == sha(data)
            and type(matching[0].get('bytes')) is int and matching[0]['bytes'] == len(data),
            'Proof must bind every exact ' + label + ': ' + name)


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
    verify_profile_evidence(native, PITCH_BEND_PHASES,
                            lambda name: read_evidence(directory / name, 16 * 1024))
    checked = subprocess.run(['node', str(ROOT / 'scripts/verify-native-pitch-bend-evidence.mjs'),
                              '--check', str(directory)], cwd=ROOT, capture_output=True,
                             text=True, encoding='utf-8', timeout=30, check=False)
    require(checked.returncode == 0,
            'Independent pitch-bend verification failed: ' + checked.stderr.strip())
    report_hashes = {}
    for name in PITCH_BEND_REPORTS:
        data = read_evidence(directory / name)
        verify_report_binding(proof, name, data, 'original pitch-bend report')
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
