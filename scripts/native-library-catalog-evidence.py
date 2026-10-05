"""Carry the existing original catalog proof and retained bytes into a native ZIP.

The Node verifier owns acceptance assertions. This adapter re-runs it before
packaging and preserves its exact file/snapshot bindings during archive checks.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PREFIX = 'evidence/library-catalog/'
PROOF = 'library-catalog-proof.json'
HOST = 'native-library-catalog.json'
PHASES = ['catalog-seed', 'catalog-restart', 'catalog-final']
REQUIRED = [PROOF, HOST, 'catalog-config.json', 'fixtures/catalog-fixtures.json',
            'snapshot-catalog-before.json',
            *[f'{kind}-{phase}.json' for phase in PHASES for kind in ['renderer', 'profile', 'trace', 'snapshot']]]
CLAIMS = {'browser': True, 'native_filesystem': True, 'native_window': True,
          'physical_audio': False, 'user_library': False, 'private_music': False, 'full_acceptance': False}
LIMIT = 16 * 1024 * 1024
TOTAL = 128 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def exact(left, right):
    return json.dumps(left, sort_keys=True) == json.dumps(right, sort_keys=True)


def ordinary(name):
    return (isinstance(name, str) and 0 < len(name) < 1024 and not re.search(r'[\\:\x00\r\n]', name)
            and all(part not in ['', '.', '..'] for part in name.split('/')))


def read_file(directory, name):
    require(ordinary(name), 'Unsafe catalog evidence path')
    path = Path(directory)
    require(path.is_dir() and not path.is_symlink(), 'Catalog evidence root must be an ordinary directory')
    for part in name.split('/'):
        path = path / part
        require(not path.is_symlink(), 'Linked catalog evidence is forbidden')
    require(path.is_file() and 0 < path.stat().st_size <= LIMIT, 'Catalog evidence file is missing or unbounded')
    data = path.read_bytes()
    require(0 < len(data) <= LIMIT, 'Catalog evidence file is unbounded')
    return data


def validate(read, executable_bytes, commit, tree):
    """Rebind native proof, shared profile and all retained original/journal bytes."""
    require(all(isinstance(value, str) and re.fullmatch('[a-f0-9]{40}', value) for value in [commit, tree]),
            'Catalog evidence needs exact source/tree')
    raw = {}

    def load(name):
        require(ordinary(name) and not any(part.lower().startswith('webview-catalog-profile') for part in name.split('/')),
                'Unsafe catalog evidence inventory')
        if name not in raw:
            data = read(name)
            require(0 < len(data) <= LIMIT, 'Catalog evidence file is missing or unbounded')
            raw[name] = data
            require(len(raw) <= 2048 and sum(map(len, raw.values())) <= TOTAL, 'Catalog evidence inventory exceeds bounds')
        return raw[name]

    def document(name):
        value = json.loads(load(name).decode('utf-8-sig'))
        require(isinstance(value, dict), 'Catalog evidence must be an object')
        return value

    proof, host = document(PROOF), document(HOST)
    for value in [proof, host]:
        require(type(value.get('version')) is int and value['version'] == 1 and value.get('ok') is True
                and value.get('scenario') == 'library-catalog' and value.get('source_sha') == commit
                and value.get('source_tree') == tree and value.get('executable_sha256') == sha(executable_bytes),
                'Catalog evidence must match exact source/tree/executable')
    require(type(host.get('executable_bytes')) is int and host['executable_bytes'] == len(executable_bytes),
            'Catalog executable size differs')
    require(exact(proof.get('claims'), CLAIMS), 'Catalog proof claims differ')
    require(proof.get('phases') == PHASES and isinstance(host.get('phases'), list)
            and all(isinstance(row, dict) for row in host['phases'])
            and [row.get('phase') for row in host['phases']] == PHASES, 'All three ordered catalog phases are required')
    require(isinstance(proof.get('run_id'), str) and 16 <= len(proof['run_id']) <= 128
            and proof['run_id'] == host.get('run_id'), 'Catalog run identity differs')
    require(host.get('profile_reused') is True, 'Catalog requires a shared persisted profile')
    processes, profiles = set(), set()
    for index, row in enumerate(host['phases']):
        phase = PHASES[index]
        require(type(row.get('process_id')) is int and row['process_id'] > 0
                and row.get('launched_new_process') is True and row.get('renderer_ok') is True
                and row.get('normal_close') is True and row.get('renderer_origin') == 'https://wmh.localhost'
                and type(row.get('executable_tcp_listeners')) is int and row['executable_tcp_listeners'] == 0,
                'Each catalog phase must use a new closed native process without a listener')
        processes.add(row['process_id'])
        require(isinstance(row.get('profile_directory'), str), 'Catalog profile directory is missing')
        profiles.add(row['profile_directory'].replace('\\', '/'))
        require(row.get('profile_fresh') is (index == 0) and row.get('profile_reused') is (index != 0)
                and row.get('profile_absent_before_launch') is (index == 0), 'Catalog profile reuse differs')
        require(exact(document(f'profile-{phase}.json'), {
            'version': 1, 'phase': phase, 'process_id': row['process_id'], 'profile_directory': row['profile_directory'],
            'library_directory': host.get('directory'), 'fresh_required': index == 0, 'created_new': index == 0}),
            'Catalog profile observation differs')
    require(len(processes) == 3 and len(profiles) == 1, 'Catalog needs three processes sharing one profile')
    library = host.get('directory')
    require(isinstance(library, str) and library.replace('\\', '/').endswith('/Scores')
            and profiles == {library.replace('\\', '/')[:-7] + '/webview-catalog-profile'},
            'Catalog profile is not owned by the original library')

    def bind(rows, prefix=''):
        require(isinstance(rows, list) and 0 < len(rows) <= 2048, 'Catalog file inventory is missing or unbounded')
        names = set()
        for row in rows:
            require(isinstance(row, dict) and ordinary(row.get('path'))
                    and type(row.get('bytes')) is int and 0 < row['bytes'] <= LIMIT
                    and isinstance(row.get('sha256'), str) and re.fullmatch('[a-f0-9]{64}', row['sha256']),
                    'Catalog file binding is invalid')
            name = prefix + row['path']
            require(name != PROOF, 'Catalog proof cannot bind itself')
            data = load(name)
            require(len(data) == row['bytes'] and sha(data) == row['sha256'], f'Catalog retained evidence changed: {name}')
            names.add(name)
        return names

    bound = bind(proof.get('files'))
    require(set(REQUIRED) - {PROOF} <= bound, 'Catalog proof omits required reports, profiles or snapshots')
    # The Node proof inventories files it reads directly. Its final snapshot is
    # the authoritative complete Scores inventory, including backups and media.
    retained = bind(document('snapshot-catalog-final.json').get('files'), 'Scores/')
    require(any(name.startswith('Scores/catalog/') for name in retained)
            and any(name.startswith('Scores/catalog-backups/') for name in retained), 'Catalog journal bytes are missing')
    require(not any(name.startswith('Scores/.catalog-staging/') for name in retained), 'Catalog journal staging is unfinished')
    require(set(raw) == bound | retained | {PROOF}, 'Catalog package has unbound evidence')
    fields = {'native_library_catalog_validated': True, 'native_library_catalog_proof_sha256': sha(raw[PROOF]),
              'native_library_catalog_files_sha256': {name: sha(data) for name, data in sorted(raw.items())},
              'native_library_catalog_claims': CLAIMS}
    return fields, raw


def accepted(directory, executable, commit, tree):
    executable = Path(executable)
    require(executable.is_file() and not executable.is_symlink(), 'Catalog executable must be an ordinary file')
    fields, _ = validate(lambda name: read_file(directory, name), executable.read_bytes(), commit, tree)
    env = dict(os.environ)
    env.update(WMH_SOURCE_SHA=commit, WMH_SOURCE_TREE=tree, WMH_LIBRARY_CATALOG_EXECUTABLE=str(executable.resolve()))
    checked = subprocess.run(['node', str(ROOT / 'scripts/verify-library-catalog-acceptance.mjs'), '--check', str(directory)],
                             cwd=ROOT, env=env, capture_output=True, text=True, encoding='utf-8', timeout=60, check=False)
    require(checked.returncode == 0, 'Independent catalog evidence failed: ' + checked.stderr.strip())
    return fields


def copy_evidence(directory, destination, executable, metadata):
    fields, raw = validate(lambda name: read_file(directory, name), Path(executable).read_bytes(),
                          metadata['git_commit'], metadata['git_tree'])
    require_fields(metadata, fields)
    for name, data in raw.items():
        path = Path(destination) / PREFIX / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


def require_fields(metadata, fields):
    acceptance = metadata.get('acceptance')
    require(isinstance(acceptance, dict)
            and {key for key in acceptance if key.startswith('native_library_catalog_')} == set(fields)
            and all(exact(acceptance.get(key), value) for key, value in fields.items()),
            'BUILD-INFO must bind exact catalog proof, retained bytes and claims')


def verify_packaged(read, metadata, paths, executable='WorldMusicClub-Native.exe'):
    fields, raw = validate(lambda name: read(PREFIX + name), read(executable), metadata.get('git_commit'), metadata.get('git_tree'))
    # Recognize misplaced and case-aliased copies too; Windows extraction must
    # not overlay an accepted report with an unbound alternative or profile.
    reserved = ('library-catalog', 'native-library-catalog', 'renderer-catalog-', 'profile-catalog-',
                'snapshot-catalog-', 'trace-catalog-', 'action-catalog-', 'result-catalog-', 'webview-catalog-profile',
                'native-action-catalog-', 'native-catalog-', 'browser-action-catalog-', 'browser-catalog-',
                'host-api-catalog-', 'catalog-config', 'catalog-fixtures', 'catalog-original-')
    actual = {name for name in paths if any(part.lower().startswith(reserved) for part in name.split('/'))}
    require(actual == {PREFIX + name for name in raw}, 'Exact catalog package evidence inventory is required')
    require_fields(metadata, fields)
