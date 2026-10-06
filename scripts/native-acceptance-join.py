#!/usr/bin/env python3
"""Fail-closed identities and producer gates for parallel native acceptance.

GitHub job outputs are the trust root here, not downloaded artifact metadata.
Nothing in this module runs the application or treats cached build outputs as
acceptance. The final workflow summary also independently checks these outputs.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys


PRODUCERS = ('bulk-import-browser', 'windows-pure-checks', 'native-feature-acceptance')
STATIC_CRT = '-C target-feature=+crt-static'
SHARED_FIELDS = ('source_sha', 'source_tree', 'run_id', 'run_attempt', 'repository',
                 'cargo_lock_sha256', 'npm_lock_sha256', 'rust', 'node')
PLATFORM_PINS = {
    'Windows': {'rust': '1.99.0', 'node': 'v22.23.3', 'python': '3.12.10', 'rustflags': STATIC_CRT},
    'Linux': {'rust': '1.99.0', 'node': 'v22.23.3', 'python': '3.12.14', 'rustflags': ''},
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def output(key, value):
    with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as stream:
        stream.write(f'{key}={value}\n')


def command(*args):
    return subprocess.check_output(args, text=True, encoding='utf-8').strip()


def validate_identity(value, runner_os):
    require(isinstance(value, dict) and set(value) == {*SHARED_FIELDS, 'python', 'runner_os', 'rustflags'},
            'Missing or unexpected acceptance identity fields')
    for field, length in [('source_sha', 40), ('source_tree', 40),
                          ('cargo_lock_sha256', 64), ('npm_lock_sha256', 64)]:
        require(isinstance(value[field], str) and re.fullmatch(f'[0-9a-f]{{{length}}}', value[field]),
                f'Invalid acceptance {field}')
    for field in ('run_id', 'run_attempt'):
        require(isinstance(value[field], str) and re.fullmatch('[1-9][0-9]{0,19}', value[field]),
                f'Invalid acceptance {field}')
    require(isinstance(value['repository'], str) and re.fullmatch(
        r'[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}', value['repository']),
        'Invalid acceptance repository')
    require(runner_os in PLATFORM_PINS and value['runner_os'] == runner_os,
            'Acceptance runner OS differs from its declared platform')
    for field, pin in PLATFORM_PINS[runner_os].items():
        require(value[field] == pin, f'Acceptance {runner_os} {field} requires exact pin {pin!r}')
    return value


def identity():
    require(command('git', 'rev-parse', 'HEAD') == os.environ['GITHUB_SHA'],
            'Checkout differs from exact workflow source')
    require(not command('git', 'status', '--porcelain', '--untracked-files=normal'),
            'Acceptance requires clean source')
    value = {
        'source_sha': os.environ['GITHUB_SHA'],
        'source_tree': command('git', 'rev-parse', 'HEAD^{tree}'),
        'run_id': os.environ['GITHUB_RUN_ID'],
        'run_attempt': os.environ['GITHUB_RUN_ATTEMPT'],
        'repository': os.environ['GITHUB_REPOSITORY'],
        'cargo_lock_sha256': hashlib.sha256(Path('Cargo.lock').read_bytes()).hexdigest(),
        'npm_lock_sha256': hashlib.sha256(Path('package-lock.json').read_bytes()).hexdigest(),
        'rust': command('rustc', '--version').split()[1],
        'node': command('node', '--version'),
        'python': platform.python_version(),
        'runner_os': platform.system(),
        'rustflags': os.environ.get('RUSTFLAGS', ''),
    }
    validate_identity(value, os.environ['RUNNER_OS'])
    return value


def require_steps(steps, required):
    require(isinstance(steps, dict) and required and len(set(required)) == len(required),
            'Missing or repeated mandatory step names')
    for name in required:
        require(re.fullmatch('[a-z][a-z0-9_]*', name), 'Invalid mandatory step name')
        row = steps.get(name, {})
        require(isinstance(row, dict) and row.get('outcome') == 'success'
                and row.get('conclusion') == 'success',
                f'{name}: missing, failed, cancelled or skipped mandatory producer step')


def join(needs, expected):
    validate_identity(expected, 'Windows')
    require(isinstance(needs, dict) and set(needs) == set(PRODUCERS),
            'Packaging needs exactly every required acceptance producer')
    for job in PRODUCERS:
        row = needs[job]
        require(isinstance(row, dict) and row.get('result') == 'success',
                f'{job}: successful producer required')
        fields = row.get('outputs', {})
        require(isinstance(fields, dict) and fields.get('producer_gate') == 'success',
                f'{job}: all mandatory producer steps must succeed')
        actual = validate_identity(json.loads(fields.get('identity', 'null')),
                                   'Linux' if job == 'bulk-import-browser' else 'Windows')
        for key in SHARED_FIELDS:
            require(actual[key] == expected[key], f'{job}: {key} differs from packaging source/run/tools')
        if actual['runner_os'] == 'Windows':
            require(actual['python'] == expected['python'], f'{job}: Windows Python differs from packaging')
        for key in ('source_sha', 'source_tree', 'run_id'):
            require(fields.get(key) == expected[key], f'{job}: independent {key} output differs')
    native = needs['native-feature-acceptance']['outputs']
    require(re.fullmatch('[1-9][0-9]{0,19}', native.get('transfer_artifact_id', '')),
            'Missing immutable native transfer artifact ID')
    require(re.fullmatch('[0-9a-f]{64}', native.get('transfer_sha256', '')),
            'Missing native transfer SHA256 from producer')
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('identity', 'steps', 'join'))
    args = parser.parse_args()
    try:
        if args.command == 'identity':
            output('identity', json.dumps(identity(), sort_keys=True, separators=(',', ':')))
        elif args.command == 'steps':
            require_steps(json.loads(os.environ['ACCEPTANCE_STEPS']),
                          os.environ['ACCEPTANCE_REQUIRED_STEPS'].split(','))
            output('gate', 'success')
        else:
            join(json.loads(os.environ['ACCEPTANCE_NEEDS']),
                 json.loads(os.environ['ACCEPTANCE_IDENTITY']))
        print(f'Native acceptance {args.command}: verified')
    except (KeyError, TypeError, ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f'Native acceptance {args.command}: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
