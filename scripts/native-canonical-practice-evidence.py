"""Retain the independently verified canonical actual-app gate in native ZIPs.

The Node verifier owns behavioral acceptance. This adapter checks the native
process envelope and copies only its exact, bounded proof inventory. Archive
verification rebinds that inventory to BUILD-INFO and the actual packaged EXE.
"""
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PREFIX = 'evidence/canonical-practice/'
PROOF = 'canonical-practice-proof.json'
HOST = 'native-canonical-practice.json'
PHASES = ['canonical-practice-seed', 'canonical-practice-controls', 'canonical-practice-restart']
REQUIRED = [PROOF, HOST, 'fixtures/canonical-practice-fixtures.json',
            'fixtures/canonical-practice-original.json', 'fixtures/canonical-practice-original.musicxml',
            *[f'{kind}-{phase}.json' for phase in PHASES for kind in ['renderer', 'profile', 'snapshot', 'trace']],
            *[f'{kind}-{phase}.{extension}' for phase in PHASES
              for kind, extension in [('native', 'png'), ('geometry-native', 'json')]]]
CLAIMS = {'actual_app': True, 'native_window': True, 'physical_audio': False,
          'private_music': False, 'full_acceptance': False}
LIMIT = 16 * 1024 * 1024
TOTAL = 128 * 1024 * 1024
COUNT = 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def exact(left, right):
    return json.dumps(left, sort_keys=True) == json.dumps(right, sort_keys=True)


def ordinary(name):
    return (isinstance(name, str) and 0 < len(name) < 1024
            and not re.search(r'[\\:<>"|?*\x00-\x1f]', name)
            and all(part not in ['', '.', '..'] and part == part.rstrip(' .')
                    and not re.fullmatch(r'(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?', part)
                    for part in name.split('/')))


def evidence_name(name):
    return ordinary(name) and not any(part.casefold().startswith('webview-') for part in name.split('/'))


@lru_cache(maxsize=1)
def source_files():
    """Use the verifier's single finite source contract, never a second list."""
    module = (ROOT / 'scripts/canonical-practice-source-evidence.mjs').as_uri()
    program = f'import {{CANONICAL_PRACTICE_SOURCE_FILES as files}} from {json.dumps(module)}; console.log(JSON.stringify(files));'
    output = subprocess.check_output(['node', '--input-type=module', '-e', program], cwd=ROOT,
                                     text=True, encoding='utf-8', timeout=30)
    names = json.loads(output)
    require(isinstance(names, list) and 0 < len(names) <= 128
            and all(ordinary(name) for name in names) and len(set(names)) == len(names),
            'Canonical source allowlist is invalid')
    return tuple(names)


def read_file(directory, name):
    require(ordinary(name), 'Unsafe canonical evidence path')
    path = Path(directory)
    require(path.is_dir() and not path.is_symlink(), 'Canonical evidence root must be an ordinary directory')
    for part in name.split('/'):
        path = path / part
        require(not path.is_symlink(), 'Linked canonical evidence is forbidden')
    require(path.is_file() and 0 < path.stat().st_size <= LIMIT, 'Canonical evidence file is missing or unbounded')
    data = path.read_bytes()
    require(0 < len(data) <= LIMIT, 'Canonical evidence file is unbounded')
    return data


def validate(read, executable_bytes, commit, tree):
    """Bind three closed native processes and every retained original gate file."""
    require(all(isinstance(value, str) and re.fullmatch('[a-f0-9]{40}', value) for value in [commit, tree]),
            'Canonical evidence needs exact source/tree')
    raw = {}

    def load(name):
        require(evidence_name(name), 'Unsafe canonical evidence inventory')
        if name not in raw:
            data = read(name)
            require(0 < len(data) <= LIMIT, 'Canonical evidence file is missing or unbounded')
            raw[name] = data
            require(len(raw) <= COUNT and sum(map(len, raw.values())) <= TOTAL,
                    'Canonical evidence inventory exceeds bounds')
        return raw[name]

    def document(name):
        value = json.loads(load(name).decode('utf-8-sig'))
        require(isinstance(value, dict), 'Canonical evidence must be an object')
        return value

    proof, host = document(PROOF), document(HOST)
    for value in [proof, host]:
        require(type(value.get('version')) is int and value['version'] == 1 and value.get('ok') is True
                and value.get('scenario') == 'canonical-practice' and value.get('source_sha') == commit
                and value.get('source_tree') == tree and value.get('executable_sha256') == sha(executable_bytes)
                and type(value.get('executable_bytes')) is int and value['executable_bytes'] == len(executable_bytes),
                'Canonical evidence must match exact source/tree/executable bytes')
        hashes = value.get('source_hashes')
        require(isinstance(hashes, dict) and set(hashes) == set(source_files())
                and all(isinstance(digest, str) and re.fullmatch('[a-f0-9]{64}', digest) for digest in hashes.values()),
                'Canonical source hashes must match the finite source allowlist')
    require(exact(proof['source_hashes'], host['source_hashes']), 'Canonical source hashes differ')
    require(exact(proof.get('claims'), CLAIMS), 'Canonical proof claims differ')
    require(proof.get('phases') == PHASES and isinstance(host.get('phases'), list)
            and all(isinstance(row, dict) for row in host['phases'])
            and [row.get('phase') for row in host['phases']] == PHASES,
            'All three ordered canonical phases are required')
    require(host.get('profile_reused') is True, 'Canonical requires a shared persisted profile')
    processes, profiles = set(), set()
    required = set(REQUIRED) - {PROOF}
    library = host.get('directory')
    require(isinstance(library, str) and library.replace('\\', '/').endswith('/Scores'),
            'Canonical library directory must end in Scores')
    score_keys = set()
    xml_keys = set()
    renderers = []
    for index, row in enumerate(host['phases']):
        phase = PHASES[index]
        require(type(row.get('process_id')) is int and row['process_id'] > 0
                and row.get('launched_new_process') is True and row.get('renderer_ok') is True
                and row.get('normal_close') is True and row.get('renderer_origin') == 'https://wmh.localhost'
                and type(row.get('executable_tcp_listeners')) is int and row['executable_tcp_listeners'] == 0
                and type(row.get('actions')) is int and 1 <= row['actions'] <= (80 if phase == 'canonical-practice-seed' else 64),
                'Each canonical phase must use a new closed native process without a listener')
        processes.add(row['process_id'])
        require(isinstance(row.get('profile_directory'), str), 'Canonical profile directory is missing')
        profiles.add(row['profile_directory'].replace('\\', '/'))
        require(row.get('profile_fresh') is (index == 0) and row.get('profile_reused') is (index != 0)
                and row.get('profile_absent_before_launch') is (index == 0), 'Canonical profile reuse differs')
        require(exact(document(f'profile-{phase}.json'), {
            'version': 1, 'phase': phase, 'process_id': row['process_id'], 'profile_directory': row['profile_directory'],
            'library_directory': library, 'fresh_required': index == 0, 'created_new': index == 0}),
            'Canonical profile observation differs')
        renderer = document(f'renderer-{phase}.json')
        renderers.append(renderer)
        require(renderer.get('ok') is True and renderer.get('phase') == phase
                and renderer.get('origin') == row['renderer_origin'] and type(renderer.get('actions')) is int
                and renderer['actions'] == row['actions'], 'Canonical renderer envelope differs')
        required.update(f'{kind}-{phase}-{n}.json' for n in range(1, row['actions'] + 1) for kind in ['action', 'result'])
        screens, exports = renderer.get('screenshots'), renderer.get('files')
        require(isinstance(screens, dict) and 0 < len(screens) <= 64
                and all(type(n) is int and 1 <= n <= row['actions'] for n in screens.values()),
                'Canonical renderer screenshots are missing or unbounded')
        required.update(f'native-action-{phase}-{n}.png' for n in range(1, row['actions'] + 1))
        required.update(f'geometry-native-action-{phase}-{n}.json' for n in range(1, row['actions'] + 1))
        require(isinstance(exports, dict) and 0 < len(exports) <= 16
                and all(isinstance(name, str) and re.fullmatch(rf'{phase}-[1-9][0-9]*\.json', name)
                        for name in exports.values()), 'Canonical retained take/score exports are missing or unsafe')
        required.update('downloads/' + name for name in exports.values())
        key = renderer.get('key')
        require(ordinary(key) and '/' not in key, 'Canonical persisted score key is unsafe')
        score_keys.add(key)
        if index == 2:
            key = renderer.get('xmlKey')
            require(ordinary(key) and '/' not in key, 'Canonical MusicXML score key is missing or unsafe')
            xml_keys.add(key)
    require(len(processes) == 3 and profiles == {library.replace('\\', '/')[:-7] + '/webview-profiles/canonical-practice-seed'},
            'Canonical needs three processes sharing the exact owned profile')
    require(len(score_keys) == 1 and len(xml_keys) == 1 and score_keys.isdisjoint(xml_keys),
            'Canonical requires unchanged JSON and distinct MusicXML score identities')
    for key in score_keys | xml_keys:
        for area in ['songs', 'backups']:
            required.update(f'Scores/{area}/{key}/{name}' for name in ['score.json', 'metadata.json'])
            if key in xml_keys:
                required.add(f'Scores/{area}/{key}/source.payload')

    rows = proof.get('files')
    require(isinstance(rows, list) and 0 < len(rows) <= COUNT, 'Canonical file inventory is missing or unbounded')
    bindings, aliases = {}, {}
    for row in rows:
        require(isinstance(row, dict) and set(row) == {'path', 'bytes', 'sha256'} and evidence_name(row.get('path'))
                and row['path'] != PROOF and type(row.get('bytes')) is int and 0 < row['bytes'] <= LIMIT
                and isinstance(row.get('sha256'), str) and re.fullmatch('[a-f0-9]{64}', row['sha256']),
                'Canonical file binding is invalid')
        name = row['path']
        require(name not in bindings or exact(bindings[name], row), 'Conflicting canonical file bindings')
        require(name.casefold() not in aliases or aliases[name.casefold()] == name, 'Case-aliased canonical file bindings')
        bindings[name] = row
        aliases[name.casefold()] = name
        data = load(name)
        require(len(data) == row['bytes'] and sha(data) == row['sha256'], f'Canonical retained evidence changed: {name}')
    require(required <= set(bindings), 'Canonical proof omits required reports, actions, exports or original Scores bytes')
    # A rehashed ZIP must still contain every original song and backup byte,
    # and each host snapshot must describe exactly its phase's complete library.
    retained = {name for name in bindings if name.startswith('Scores/')}
    for index, renderer in enumerate(renderers):
        snapshot = document(f'snapshot-{PHASES[index]}.json')
        inventory = snapshot.get('files')
        require(type(snapshot.get('version')) is int and snapshot['version'] == 1
                and isinstance(inventory, list) and 0 < len(inventory) <= COUNT,
                'Canonical snapshot inventory is missing or unbounded')
        expected = {name for name in required if name.startswith('Scores/')
                    and (index == 2 or name.split('/')[2] in score_keys)}
        seen = set()
        for item in inventory:
            require(isinstance(item, dict) and evidence_name(item.get('path'))
                    and type(item.get('bytes')) is int and isinstance(item.get('sha256'), str),
                    'Canonical snapshot binding is invalid')
            name = 'Scores/' + item['path']
            require(name in expected and name not in seen and name in bindings,
                    'Canonical snapshot inventory differs')
            seen.add(name)
            require(exact({key: item[key] for key in ['bytes', 'sha256']},
                          {key: bindings[name][key] for key in ['bytes', 'sha256']}),
                    'Canonical snapshot bytes differ')
        require(seen == expected, 'Canonical snapshot inventory differs')
        for key, opened in [(renderer['key'], renderer.get('opened')),
                            *([(renderer['xmlKey'], renderer.get('xmlOpened'))] if index == 2 else [])]:
            require(isinstance(opened, dict) and isinstance(opened.get('entry'), dict)
                    and isinstance(opened.get('score_json'), str), 'Canonical opened score evidence is missing')
            for area in ['songs', 'backups']:
                require(load(f'Scores/{area}/{key}/score.json').decode('utf-8') == opened['score_json']
                        and exact(document(f'Scores/{area}/{key}/metadata.json'), opened['entry']),
                        'Canonical retained score or metadata differs from the opened library')
    require(retained == {name for name in required if name.startswith('Scores/')},
            'Canonical retained Scores inventory differs')
    for key in score_keys:
        for area in ['songs', 'backups']:
            require(load(f'Scores/{area}/{key}/score.json') == load('fixtures/canonical-practice-original.json'),
                    'Canonical original JSON bytes differ')
    for key in xml_keys:
        for area in ['songs', 'backups']:
            require(load(f'Scores/{area}/{key}/source.payload') == load('fixtures/canonical-practice-original.musicxml'),
                    'Canonical original MusicXML bytes differ')
    require(set(raw) == set(bindings) | {PROOF}, 'Canonical package has unbound evidence')
    fields = {'native_canonical_practice_validated': True, 'native_canonical_practice_proof_sha256': sha(raw[PROOF]),
              'native_canonical_practice_files_sha256': {name: sha(data) for name, data in sorted(raw.items())},
              'native_canonical_practice_source_hashes': proof['source_hashes'],
              'native_canonical_practice_claims': CLAIMS}
    return fields, raw


def accepted(directory, executable, commit, tree):
    executable = Path(executable)
    require(executable.is_file() and not executable.is_symlink(), 'Canonical executable must be an ordinary file')
    fields, _ = validate(lambda name: read_file(directory, name), executable.read_bytes(), commit, tree)
    env = dict(os.environ)
    env.update(WMH_SOURCE_SHA=commit, WMH_SOURCE_TREE=tree, WMH_CANONICAL_PRACTICE_EXECUTABLE=str(executable.resolve()))
    checked = subprocess.run(['node', str(ROOT / 'scripts/verify-canonical-practice-evidence.mjs'), '--check', str(directory)],
                             cwd=ROOT, env=env, capture_output=True, text=True, encoding='utf-8', timeout=60, check=False)
    require(checked.returncode == 0, 'Independent canonical evidence failed: ' + checked.stderr.strip())
    return fields


def require_fields(metadata, fields):
    acceptance = metadata.get('acceptance')
    require(isinstance(acceptance, dict)
            and {key for key in acceptance if key.startswith('native_canonical_practice_')} == set(fields)
            and all(exact(acceptance.get(key), value) for key, value in fields.items()),
            'BUILD-INFO must bind exact canonical proof, retained bytes, source hashes and claims')


def copy_evidence(directory, destination, executable, metadata):
    fields, raw = validate(lambda name: read_file(directory, name), Path(executable).read_bytes(),
                          metadata['git_commit'], metadata['git_tree'])
    require_fields(metadata, fields)
    for name, data in raw.items():
        path = Path(destination) / PREFIX / name
        require(not any(part.is_symlink() for part in [path, *path.parents]), 'Linked canonical evidence destination is forbidden')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


def verify_packaged(read, metadata, paths, executable='WorldMusicClub-Native.exe'):
    fields, raw = validate(lambda name: read(PREFIX + name), read(executable), metadata.get('git_commit'), metadata.get('git_tree'))
    # Reserve report families and directory aliases without classifying ordinary
    # product docs (for example canonical-practice-acceptance.md) as evidence.
    directories = ('canonical-practice', 'webview-profiles')
    reports = ('webview-profiles', 'canonical-practice-proof', 'canonical-practice-fixtures', 'canonical-practice-original',
               'native-canonical-practice', 'renderer-canonical-practice-', 'profile-canonical-practice-',
               'snapshot-canonical-practice-', 'trace-canonical-practice-', 'action-canonical-practice-',
               'result-canonical-practice-', 'native-action-canonical-practice-', 'browser-action-canonical-practice-',
               'geometry-native-action-canonical-practice-', 'geometry-native-canonical-practice-',
               'owned-picker-before-open-canonical-practice-',
               'owned-picker-failure-canonical-practice-', 'owned-popup-failure-canonical-practice-',
               'diagnostic-canonical-practice-', 'native-failure-canonical-practice-', *PHASES)
    expected = {PREFIX + name for name in raw}
    parents = {name[:index + 1] for name in expected for index, part in enumerate(name) if part == '/'}
    actual = set()
    for name in paths:
        relevant = (any(part.casefold().startswith(directories) for part in name.split('/')[:-1])
                    or any(part.casefold().startswith(reports) for part in name.split('/')))
        if not relevant:
            continue
        if name.endswith('/'):
            require(name in parents, 'Exact canonical package evidence inventory is required')
        else:
            actual.add(name)
    require(actual == expected, 'Exact canonical package evidence inventory is required')
    require_fields(metadata, fields)
