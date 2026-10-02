#!/usr/bin/env python3
"""Inventory an accepted, source-bound Windows native preview; never a browser ZIP."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import subprocess
import tomllib
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FOLDER = 'WorldMusicHub-Native'
EXE = 'WorldMusicHub-Native.exe'
INFO, SUMS = 'BUILD-INFO.json', 'SHA256.txt'
PHASES = ['seed', 'restart', 'close-active', 'reopen']


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def windows_executable(data):
    require(len(data) >= 64 and data[:2] == b'MZ', 'Expected a Windows PE executable')
    offset = int.from_bytes(data[60:64], 'little')
    require(data[offset:offset + 6] == b'PE\x00\x00\x64\x86', 'Expected native x64 PE executable')


def accepted_evidence(startup, acceptance, executable, commit, tree):
    """Reject partial, stale or differently built evidence before packaging any bytes."""
    startup, acceptance = Path(startup), Path(acceptance)
    digest = sha(Path(executable).read_bytes())
    native = read_json(acceptance / 'native-acceptance.json')
    require(native.get('ok') is True and native.get('source_sha') == commit
            and native.get('source_tree') == tree and native.get('executable_sha256') == digest,
            'Native acceptance must pass for this exact source/tree/executable')
    phases = native.get('phases', [])
    require([row.get('phase') for row in phases] == PHASES, 'All four native phases are required')
    for row in phases:
        require(row.get('renderer_ok') is True and row.get('normal_close') is True
                and row.get('renderer_origin') == 'https://wmh.localhost'
                and row.get('executable_tcp_listeners') == 0,
                'Every native phase must render, close normally and have no EXE listener')
    smoke = read_json(startup / 'native-report.json')
    renderer = read_json(startup / 'renderer-report.json')
    require(smoke.get('source_sha') == commit and smoke.get('executable_sha256') == digest
            and smoke.get('renderer_ok') is True and smoke.get('normal_close') is True
            and smoke.get('executable_tcp_listeners') == 0 and renderer.get('ok') is True,
            'Startup must pass for this exact executable/source')
    reports = {}
    for phase in PHASES:
        report = read_json(acceptance / f'renderer-{phase}.json')
        require(report.get('ok') is True and report.get('phase') == phase
                and report.get('origin') == 'https://wmh.localhost', 'Incomplete renderer phase')
        reports[phase] = report
    midi = reports['seed'].get('midi', {})
    require(midi.get('outcome') in ['ready', 'denied-or-unavailable', 'not-requested'], 'Missing actual MIDI outcome')
    require(midi.get('outcome') != 'not-requested' or midi.get('apiAvailable') is False, 'Available MIDI API was not attempted')
    files = read_json(acceptance / 'downloaded-files.json')
    require(files.get('ok') is True and len(files.get('artifacts', [])) == 4, 'Actual downloaded files were not verified')
    for item in files['artifacts']:
        require(re.fullmatch(r'seed-(?:[1-9]|1[0-6])\.json', item.get('file', '')), 'Invalid download evidence path')
        data = (acceptance / 'downloads' / item['file']).read_bytes()
        require(sha(data) == item['sha256'] and len(data) == item['bytes'], 'Accepted downloaded file changed')
    return {'native_permission_callback': 'deny-all', 'ordinary_midi_api': midi,
            'observed_webview_user_agent': renderer.get('userAgent'),
            'physical_midi_validated': False, 'audio_output_or_latency_validated': False,
            'clean_machine_installation_validated': False}


def create_manifest(directory, metadata):
    directory = Path(directory)
    required = [EXE, 'README.md', 'LICENSE', 'START-HERE.md',
                'schema/worldmusichub-score-v1.schema.json', 'catalog/index.json',
                'licenses/engraving/engraving-manifest.json',
                'licenses/engraving/opensheetmusicdisplay.min.js.LICENSE.txt',
                'licenses/rust/manifest.json', 'licenses/rust/CARGO-THIRD-PARTY-NOTICES.txt',
                'licenses/rust/RUST-STANDARD-LIBRARY-COPYRIGHT.html',
                'evidence/native-acceptance.json', 'evidence/downloaded-files.json',
                'evidence/native-report.json', 'evidence/renderer-report.json',
                *[f'evidence/renderer-{phase}.json' for phase in PHASES]]
    for name in required:
        require((directory / name).is_file(), f'Native package is missing {name}')
    windows_executable((directory / EXE).read_bytes())
    require(not (directory / 'WorldMusicHub.exe').exists(), 'Browser EXE must not be in the native package')
    notices = read_json(directory / 'licenses/rust/manifest.json')
    require(notices.get('format_version') == 2 and notices.get('target') == 'x86_64-pc-windows-msvc'
            and notices.get('cargo_lock_sha256') == metadata.get('cargo_lock_sha256'), 'Native notices must match the locked Windows graph')
    for component in notices['components']:
        source = component.get('source_archive')
        if source:
            name = source['name']
            require(PurePosixPath(name).name == name and '\\' not in name, 'Invalid source archive name')
            data = (directory / 'licenses/rust/sources' / name).read_bytes()
            require(len(data) == source['bytes'] and sha(data) == source['sha256'], 'MPL source archive differs from its notice inventory')
    standard = notices['standard_library']
    require(sha((directory / 'licenses/rust/RUST-STANDARD-LIBRARY-COPYRIGHT.html').read_bytes()) == standard['copyright_sha256'], 'Rust copyright collection differs')
    for item in standard['license_texts']:
        require(PurePosixPath(item['name']).name == item['name'] and '\\' not in item['name'], 'Invalid standard library notice name')
        require(sha((directory / 'licenses/rust/licenses' / item['name']).read_bytes()) == item['sha256'], 'Rust standard library license differs')
    catalog = read_json(directory / 'catalog/index.json')
    require(catalog.get('version') == 1 and isinstance(catalog.get('editions'), list), 'Invalid catalog index')
    editions = []
    for edition in catalog['editions']:
        relative = PurePosixPath(edition['directory'])
        require(not relative.is_absolute() and '..' not in relative.parts, 'Invalid catalog directory')
        base = directory / 'catalog' / relative
        score = read_json(base / 'score.json')
        provenance = read_json(base / 'provenance.json')
        license_data = (base / 'LICENSE-CC0.txt').read_bytes()
        retained = json.loads(score['source']['content'])
        require(score['id'] == provenance['edition_id'] == edition['id']
                and score['provenance']['license'] == provenance['edition_license'] == edition['license']
                and retained['provenance'] == provenance
                and retained['license_text'].encode() == license_data
                and sha(license_data) == provenance['license_text_sha256'], 'Catalog source/license mismatch')
        editions.append({'id': edition['id'], 'license': edition['license'],
                         'retained_source_sha256': sha(score['source']['content'].encode()),
                         'expressive_performance_equivalent': False})
    files = {}
    for path in sorted(directory.rglob('*')):
        require(not path.is_symlink(), 'Native ZIP cannot contain symbolic links')
        if not path.is_file():
            continue
        name = path.relative_to(directory).as_posix()
        if name not in [INFO, SUMS]:
            data = path.read_bytes()
            files[name] = {'sha256': sha(data), 'bytes': len(data)}
    info = {'format_version': 1, **metadata, 'curated_editions': editions, 'file_count': len(files), 'files': files}
    (directory / INFO).write_text(json.dumps(info, indent=2, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')
    checksums = {name: item['sha256'] for name, item in files.items()}
    checksums[INFO] = sha((directory / INFO).read_bytes())
    (directory / SUMS).write_text(''.join(f'{checksums[name]}  {name}\n' for name in sorted(checksums)), encoding='utf-8', newline='\n')
    return info


def verify_archive(archive):
    archive = Path(archive)
    with zipfile.ZipFile(archive) as package:
        names = [row.filename for row in package.infolist() if not row.is_dir()]
        require(len(names) == len(set(names)), 'Duplicate ZIP paths')
        prefix = FOLDER + '/'
        info = json.loads(package.read(prefix + INFO))
        require(info.get('name') == FOLDER and info.get('executable') == EXE, 'Wrong native product identity')
        require(set(names) == {prefix + name for name in set(info['files']) | {INFO, SUMS}}, 'Native ZIP inventory differs')
        sums = {}
        for name, item in info['files'].items():
            require(not PurePosixPath(name).is_absolute() and '..' not in PurePosixPath(name).parts and '\\' not in name, 'Invalid native ZIP path')
            data = package.read(prefix + name)
            require(len(data) == item['bytes'] and sha(data) == item['sha256'], f'Native ZIP checksum differs: {name}')
            sums[name] = item['sha256']
        windows_executable(package.read(prefix + EXE))
        sums[INFO] = sha(package.read(prefix + INFO))
        require(package.read(prefix + SUMS).decode() == ''.join(f'{sums[name]}  {name}\n' for name in sorted(sums)), 'Native checksum file differs')
    archive.with_suffix(archive.suffix + '.sha256').write_text(f'{sha(archive.read_bytes())}  {archive.name}\n', encoding='utf-8', newline='\n')
    return info


def create_archive(directory, archive):
    directory = Path(directory)
    require(directory.name == FOLDER, f'Native folder must be named {FOLDER}')
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as package:
        for path in sorted(directory.rglob('*')):
            require(not path.is_symlink(), 'Native ZIP cannot contain symbolic links')
            if path.is_file():
                package.write(path, FOLDER + '/' + path.relative_to(directory).as_posix())
    return verify_archive(archive)


def source_metadata(commit, count):
    def command(*args):
        return subprocess.check_output(args, cwd=ROOT, text=True, encoding='utf-8').rstrip('\r\n')
    require(command('git', 'rev-parse', '--is-shallow-repository') == 'false', 'Complete history is required')
    require(re.fullmatch('[0-9a-f]{40}', commit) and command('git', 'rev-parse', 'HEAD') == commit
            and int(command('git', 'rev-list', '--count', 'HEAD')) == count, 'Exact source/count mismatch')
    status = command('git', 'status', '--porcelain', '--untracked-files=all')
    require(not status, f'Native packaging requires clean source; git status --porcelain --untracked-files=all:\n{status}')
    require(platform.system() == 'Windows', 'Native packaging requires actual Windows acceptance')
    rust = command('rustc', '-vV')
    require('host: x86_64-pc-windows-msvc' in rust.splitlines(), 'Native x64 MSVC toolchain is required')
    return {'name': FOLDER, 'executable': EXE, 'git_commit': commit,
            'git_tree': command('git', 'rev-parse', 'HEAD^{tree}'), 'commit_count': count,
            'release_label': f'commit-{count}', 'target': 'x86_64-pc-windows-msvc',
            'app_version': tomllib.loads((ROOT / 'Cargo.toml').read_text(encoding='utf-8'))['workspace']['package']['version'],
            'score_schema_revision': int(re.search(r'pub const SCORE_SCHEMA_REVISION: u32 = (\d+);', (ROOT / 'crates/score-core/src/lib.rs').read_text(encoding='utf-8')).group(1)),
            'rustc_verbose': rust, 'cargo': command('cargo', '--version'), 'node': command('node', '--version'),
            'build_platform': platform.platform(), 'rustflags': os.environ.get('RUSTFLAGS', ''),
            'cargo_lock_sha256': sha((ROOT / 'Cargo.lock').read_bytes()),
            'npm_lock_sha256': sha((ROOT / 'package-lock.json').read_bytes()),
            'distribution': 'unsigned native portable preview; installed Microsoft WebView2 Runtime required',
            'runtime_bundled': False, 'installer': False, 'http_server_process': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('create')
    create.add_argument('directory', type=Path)
    create.add_argument('--commit', required=True)
    create.add_argument('--count', required=True, type=int)
    create.add_argument('--startup', required=True, type=Path)
    create.add_argument('--acceptance', required=True, type=Path)
    archive = commands.add_parser('archive')
    archive.add_argument('directory', type=Path)
    archive.add_argument('archive', type=Path)
    verify = commands.add_parser('verify')
    verify.add_argument('archive', type=Path)
    args = parser.parse_args()
    if args.command == 'create':
        metadata = source_metadata(args.commit, args.count)
        metadata['acceptance'] = accepted_evidence(args.startup, args.acceptance, args.directory / EXE, args.commit, metadata['git_tree'])
        info = create_manifest(args.directory, metadata)
    elif args.command == 'archive':
        info = create_archive(args.directory, args.archive)
    else:
        info = verify_archive(args.archive)
    print(f'Native inventory verified for source {info["git_commit"]}, count {info["commit_count"]}')


if __name__ == '__main__':
    main()
