#!/usr/bin/env python3
"""Future additive runtime ZIP format; never substitutes for full acceptance."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import struct
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location('native_release_full', ROOT / 'scripts/native-release-manifest.py')
_full = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_full)
FOLDER = _full.FOLDER
EXE = _full.EXE
INFO = _full.INFO
SUMS = _full.SUMS
MANIFEST = 'RUNTIME-MANIFEST.json'
FULL_SUMS = 'FULL-SHA256.txt'
GUIDE = 'RUNTIME-PACKAGE.md'
FORMAT = 'worldmusicclub.native-runtime'
VERSION = 1
MAX_FILES = 20000
MAX_MEMBER_BYTES = 512 * 1024 * 1024
MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024
MAX_JSON_BYTES = 16 * 1024 * 1024
GUIDE_BYTES = b'''# Native runtime package, format 1

Extract this entire folder before starting WorldMusicClub-Native.exe.
An installed Microsoft WebView2 Runtime is still required. This is an unsigned
portable candidate, not an installer, updater, or full checkpoint acceptance.

All non-evidence files of the exact full package are retained byte-for-byte,
including runtime assets, catalog, schemas, instructions, licenses, notices,
and required license source archives. The evidence/ directory is retained in
the separate complete full package identified by RUNTIME-MANIFEST.json.
BUILD-INFO.json is that full package's ORIGINAL inventory, not this ZIP's file
list. FULL-SHA256.txt is its original checksum list. RUNTIME-MANIFEST.json and
SHA256.txt describe this runtime ZIP. Older instructions referring to evidence/
describe the full package; use the linked full package for those audit steps.

Verify the ZIP against its SHA-256 obtained from a trusted release/workflow
record. Runtime verification checks integrity only. To audit native evidence
offline, obtain the exact full ZIP named in RUNTIME-MANIFEST.json and use the
matching source checkout's native-runtime-package.py verify --full-archive.
It checks the full ZIP digest and invokes the unchanged full native verifier.
No network access or evidence download is performed by this tool. Missing or
expired evidence is not an audit pass. Check the same-source native/browser
acceptance summary AND full Verify WorldMusicClub workflow before delivery.
Hashes are not signatures, and none of these checks establishes audibility,
physical MIDI, clean-machine installation, or permission to bypass OS warnings.
'''


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_sha(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def record(data):
    return {'sha256': sha(data), 'bytes': len(data)}


def digest(value):
    require(isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value), 'Invalid SHA-256')
    return value


def safe_path(name):
    require(isinstance(name, str) and name and len(name) <= 240, 'Invalid package path')
    parts = name.split('/')
    for part in parts:
        stem = part.partition('.')[0].rstrip(' ')
        require(part and part not in {'.', '..'} and not part.endswith(('.', ' '))
                and not re.search(r'[\x00-\x1f\x7f<>:"\\|?*]', part)
                and not re.fullmatch(r'(?i:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])', stem),
                f'Unsafe Windows package path: {name}')
    return name


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode()


def parse_json(data):
    require(len(data) <= MAX_JSON_BYTES, 'Manifest exceeds size bound')

    def distinct(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f'Duplicate JSON key: {key}')
            result[key] = value
        return result

    return json.loads(data, object_pairs_hook=distinct)


def inventory(package):
    """Validate paths before reading; never extract untrusted ZIP members."""
    rows = package.infolist()
    require(len(rows) <= MAX_FILES, 'Package has too many entries')
    names, folded, total = {}, set(), 0
    prefix = FOLDER + '/'
    for row in rows:
        require(row.orig_filename == row.filename, 'ZIP filename was normalized or truncated')
        extra_offset = 0
        while extra_offset < len(row.extra):
            require(extra_offset + 4 <= len(row.extra), 'Invalid ZIP extra metadata')
            kind, length = struct.unpack_from('<HH', row.extra, extra_offset)
            extra_offset += 4 + length
            require(extra_offset <= len(row.extra), 'Invalid ZIP extra metadata')
            # Some Python/extractor versions honor these aliases; others ignore
            # them. Format 1 forbids them so both agree on the single path.
            require(kind != 0x7075, 'Unicode ZIP path aliases are not supported')
        require(not row.is_dir() and not row.external_attr & 0x10,
                'Explicit ZIP directories are not supported in runtime format 1')
        require(row.orig_filename.startswith(prefix), 'Wrong ZIP root')
        name = safe_path(row.orig_filename[len(prefix):])
        require(name.casefold() not in folded, 'Duplicate or case-colliding ZIP path')
        folded.add(name.casefold())
        require(not row.flag_bits & 1, 'Encrypted ZIP members are not supported')
        mode = row.external_attr >> 16
        require(stat.S_IFMT(mode) in {0, stat.S_IFREG}, 'ZIP member must be a regular file')
        require(0 <= row.file_size <= MAX_MEMBER_BYTES, 'ZIP member exceeds size bound')
        total += row.file_size
        require(total <= MAX_TOTAL_BYTES, 'ZIP exceeds expanded size bound')
        names[name] = row
    for name in names:
        parts = name.split('/')
        require(not any('/'.join(parts[:end]).casefold() in folded for end in range(1, len(parts))),
                'ZIP file conflicts with a parent directory')
    return names


def read_member(package, rows, name):
    require(name in rows, f'Package is missing {name}')
    if name in {INFO, MANIFEST, FULL_SUMS, SUMS}:
        require(rows[name].file_size <= MAX_JSON_BYTES, 'Metadata exceeds size bound')
    data = package.read(rows[name])
    require(len(data) == rows[name].file_size, f'ZIP length differs: {name}')
    return data


def checksum_bytes(files):
    return ''.join(f'{files[name]["sha256"]}  {name}\n' for name in sorted(files)).encode()


def full_inventory(info):
    require(isinstance(info, dict) and type(info.get('format_version')) is int and info['format_version'] == 1
            and info.get('name') == FOLDER and info.get('executable') == EXE,
            'Unsupported full native manifest')
    for field in ('git_commit', 'git_tree'):
        require(isinstance(info.get(field), str) and re.fullmatch('[0-9a-f]{40}', info[field]),
                f'Invalid full source identity: {field}')
    require(type(info.get('commit_count')) is int and info['commit_count'] > 0, 'Invalid full commit count')
    require(info.get('acceptance_scope') == 'native-windows-only', 'Unexpected full acceptance scope')
    files = info.get('files')
    require(isinstance(files, dict) and 0 < len(files) <= MAX_FILES - 5
            and type(info.get('file_count')) is int and info['file_count'] == len(files),
            'Invalid full file inventory')
    folded = set()
    for name, item in files.items():
        safe_path(name)
        require(name.casefold() not in folded, 'Case-colliding full inventory path')
        folded.add(name.casefold())
        require(isinstance(item, dict) and set(item) == {'sha256', 'bytes'}
                and type(item['bytes']) is int and 0 <= item['bytes'] <= MAX_MEMBER_BYTES,
                f'Invalid full file record: {name}')
        digest(item['sha256'])
    require(not {name.casefold() for name in (INFO, SUMS, MANIFEST, FULL_SUMS, GUIDE)} & folded,
            'Reserved metadata name in full inventory')
    require(sum(item['bytes'] for item in files.values()) <= MAX_TOTAL_BYTES, 'Full inventory exceeds size bound')
    for name in files:
        parts = name.split('/')
        require(not any('/'.join(parts[:end]).casefold() in folded for end in range(1, len(parts))),
                'Full inventory file conflicts with a parent directory')
    required = {EXE, 'README.md', 'START-HERE.md', 'LICENSE', *_full.SCORE_SCHEMAS,
                'catalog/index.json', 'licenses/engraving/engraving-manifest.json',
                'licenses/engraving/opensheetmusicdisplay.min.js.LICENSE.txt',
                'licenses/rust/manifest.json', 'licenses/rust/CARGO-THIRD-PARTY-NOTICES.txt',
                'licenses/rust/RUST-STANDARD-LIBRARY-COPYRIGHT.html'}
    require(required <= set(files), 'Missing required runtime files, instructions, or notices')
    require(any(name.startswith('evidence/') for name in files), 'Full package has no evidence')
    return files


def evidence_reference(url, commit):
    require(isinstance(url, str) and len(url) <= 400, 'Invalid evidence reference')
    match = re.fullmatch(
        r'https://github\.com/([A-Za-z0-9][A-Za-z0-9-]{0,38})/([A-Za-z0-9_][A-Za-z0-9_.-]{0,99})/actions/runs/([1-9][0-9]{0,19})/artifacts/([1-9][0-9]{0,19})', url)
    require(match is not None, 'An immutable GitHub run/artifact reference is required')
    owner, repository, run, artifact = match.groups()
    return {'kind': 'github-actions-artifact', 'repository': owner + '/' + repository,
            'source_commit': commit, 'workflow_run_id': run, 'artifact_id': artifact, 'url': url}


def evidence_binding(binding, info):
    require(isinstance(binding, dict) and set(binding) == {'filename', 'sha256', 'bytes', 'reference'},
            'Invalid full archive binding')
    safe_path(binding['filename'])
    require('/' not in binding['filename'] and binding['filename'].endswith('.zip'), 'Invalid full archive filename')
    digest(binding['sha256'])
    require(type(binding['bytes']) is int and 0 < binding['bytes'] <= MAX_TOTAL_BYTES, 'Invalid full archive size')
    reference = binding['reference']
    keys = {'kind', 'repository', 'source_commit', 'workflow_run_id', 'artifact_id'}
    require(isinstance(reference, dict) and set(reference) in (keys, keys | {'url'}),
            'Invalid typed evidence reference')
    require(all(isinstance(value, str) for value in reference.values()), 'Invalid evidence reference fields')
    url = ('https://github.com/' + reference['repository'] + '/actions/runs/'
           + reference['workflow_run_id'] + '/artifacts/' + reference['artifact_id'])
    canonical = evidence_reference(url, info['git_commit'])
    if 'url' not in reference:
        canonical.pop('url')
    require(reference == canonical, 'Evidence locator source/repository/artifact identity differs')
    require(reference['workflow_run_id'] == info.get('acceptance_workflow_run_id'),
            'Evidence locator must name the full native acceptance workflow run')
    return binding


def make_manifest(info_data, full_sums, binding):
    info = parse_json(info_data)
    all_files = full_inventory(info)
    require(full_sums == checksum_bytes({**all_files, INFO: record(info_data)}), 'Original full checksums differ')
    runtime = {name: item for name, item in all_files.items() if not name.startswith('evidence/')}
    evidence = {name: item for name, item in all_files.items() if name.startswith('evidence/')}
    files = {**runtime, INFO: record(info_data), FULL_SUMS: record(full_sums), GUIDE: record(GUIDE_BYTES)}
    return {'format': FORMAT, 'format_version': VERSION,
            'source': {key: info[key] for key in ('git_commit', 'git_tree', 'commit_count')},
            'executable': {'path': EXE, **files[EXE]}, 'acceptance_scope': 'native-windows-only',
            'checkpoint_acceptance': 'not-asserted',
            'partition': {'rule': 'retain-every-non-evidence-file', 'separate_prefix': 'evidence/',
                          'evidence_file_count': len(evidence),
                          'evidence_bytes': sum(item['bytes'] for item in evidence.values()),
                          'complete_inventory': INFO},
            'full_evidence': evidence_binding(binding, info), 'file_count': len(files), 'files': files}


def require_verifier_source(source):
    """Full revalidation uses the unchanged verifier and fixtures at this source."""
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()

    require(git('rev-parse', 'HEAD') == source['git_commit']
            and git('rev-parse', 'HEAD^{tree}') == source['git_tree'],
            'Full audit requires the exact source checkout')
    require(not git('status', '--porcelain', '--untracked-files=all'), 'Full audit requires a clean source checkout')


def verify_full_archive(path, source, expected_digest, info_data, full_sums):
    require(Path(path).stat().st_size <= MAX_TOTAL_BYTES, 'Full ZIP exceeds size bound')
    require(file_sha(path) == expected_digest, 'Full archive digest differs')
    # The legacy verifier remains unchanged, but must not read any payload until
    # this new format's bounds, original metadata, and identity checks pass.
    with zipfile.ZipFile(path) as package:
        rows = inventory(package)
        require(read_member(package, rows, INFO) == info_data
                and read_member(package, rows, SUMS) == full_sums,
                'Original full metadata bytes differ')
        info = parse_json(info_data)
        files = full_inventory(info)
        require(full_sums == checksum_bytes({**files, INFO: record(info_data)}), 'Original full checksums differ')
        require(set(rows) == set(files) | {INFO, SUMS}, 'Full ZIP inventory differs')
        require(all(info.get(key) == value for key, value in source.items()), 'Full source identity differs')
        for name, item in files.items():
            require(rows[name].file_size == item['bytes'], f'Full ZIP member length differs: {name}')
    require_verifier_source(source)
    # No --skip, weaker validator, or alternate acceptance path is exposed.
    result = _full.verify_archive(path)
    require(file_sha(path) == expected_digest, 'Full archive changed during verification')
    require(all(result.get(key) == value for key, value in source.items()), 'Full verifier source differs')
    return result


def verify_runtime(archive, expected_sha256, full_archive=None):
    archive = Path(archive)
    digest(expected_sha256)
    require(archive.stat().st_size <= MAX_TOTAL_BYTES, 'Runtime ZIP exceeds size bound')
    require(file_sha(archive) == expected_sha256, 'Runtime ZIP digest differs')
    with zipfile.ZipFile(archive) as package:
        rows = inventory(package)
        read = lambda name: read_member(package, rows, name)
        manifest_data = read(MANIFEST)
        manifest = parse_json(manifest_data)
        require(isinstance(manifest, dict) and manifest.get('format') == FORMAT
                and type(manifest.get('format_version')) is int and manifest['format_version'] == VERSION,
                'Unsupported runtime format/version')
        full_info_data, full_sums_data = read(INFO), read(FULL_SUMS)
        expected = make_manifest(full_info_data, full_sums_data, manifest.get('full_evidence'))
        require(json_bytes(manifest) == json_bytes(expected), 'Runtime manifest differs from complete inventory')
        require(set(rows) == set(expected['files']) | {MANIFEST, SUMS}, 'Runtime ZIP inventory differs')
        for name, item in expected['files'].items():
            require(record(read(name)) == item, f'Runtime file checksum differs: {name}')
        _full.windows_executable(read(EXE))
        require(read(SUMS) == checksum_bytes({**expected['files'], MANIFEST: record(manifest_data)}),
                'Runtime checksums differ')
    require(file_sha(archive) == expected_sha256, 'Runtime ZIP changed during verification')
    if full_archive is not None:
        full_archive = Path(full_archive)
        binding = expected['full_evidence']
        require(full_archive.stat().st_size == binding['bytes'], 'Full archive size differs')
        full = verify_full_archive(full_archive, expected['source'], binding['sha256'], full_info_data, full_sums_data)
        require(json_bytes(full) == json_bytes(parse_json(full_info_data)), 'Full inventory differs from runtime binding')
        with zipfile.ZipFile(full_archive) as full_package:
            require(full_package.read(FOLDER + '/' + INFO) == full_info_data
                    and full_package.read(FOLDER + '/' + SUMS) == full_sums_data,
                    'Original full metadata bytes differ')
        require(file_sha(full_archive) == binding['sha256'], 'Full archive changed during audit')
    return {'source': expected['source'], 'executable': expected['executable'],
            'runtime_integrity': 'verified',
            'full_native_evidence': 'revalidated' if full_archive is not None else 'not-revalidated',
            'checkpoint_acceptance': 'not-asserted'}


def publish_files(pairs):
    """Publish complete staged files exclusively; roll back only our own links."""
    created = []
    try:
        for staged, destination in pairs:
            os.link(staged, destination)
            created.append((staged, destination))
    except OSError as failure:
        cleanup_errors = []
        for staged, destination in reversed(created):
            try:
                if not destination.is_symlink() and destination.exists() and staged.samefile(destination):
                    destination.unlink()
            except OSError as cleanup:
                cleanup_errors.append(str(cleanup))
        if cleanup_errors:
            raise OSError('Publication failed; cleanup also failed: ' + '; '.join(cleanup_errors)) from failure
        raise


def create_runtime(full_archive, output, commit, tree, evidence_url):
    full_archive, output = Path(full_archive), Path(output)
    require(output.suffix == '.zip' and not output.exists()
            and not output.with_suffix('.zip.sha256').exists(), 'Output ZIP/checksum must be new')
    require(full_archive.stat().st_size <= MAX_TOTAL_BYTES, 'Full ZIP exceeds size bound')
    with zipfile.ZipFile(full_archive) as package:
        rows = inventory(package)
        read = lambda name: read_member(package, rows, name)
        info_data, full_sums = read(INFO), read(SUMS)
        info = parse_json(info_data)
        full_inventory(info)
        require(info['git_commit'] == commit and info['git_tree'] == tree, 'Requested source/tree differs')
        require(set(rows) == set(info['files']) | {INFO, SUMS}, 'Full ZIP inventory differs')
        binding = {'filename': full_archive.name, 'sha256': file_sha(full_archive),
                   'bytes': full_archive.stat().st_size, 'reference': evidence_reference(evidence_url, commit)}
        manifest = make_manifest(info_data, full_sums, binding)
        verified = verify_full_archive(full_archive, manifest['source'], binding['sha256'], info_data, full_sums)
        require(json_bytes(verified) == json_bytes(info), 'Full verifier inventory differs')
        # Validate all hashes ourselves too; no omission is accepted at this boundary.
        for name, item in info['files'].items():
            require(record(read(name)) == item, f'Full file checksum differs: {name}')
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='wmc-runtime-', dir=output.parent) as temporary:
            candidate = Path(temporary) / output.name
            manifest_data = json_bytes(manifest)
            metadata = {INFO: info_data, FULL_SUMS: full_sums, GUIDE: GUIDE_BYTES, MANIFEST: manifest_data,
                        SUMS: checksum_bytes({**manifest['files'], MANIFEST: record(manifest_data)})}
            with zipfile.ZipFile(candidate, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as runtime:
                for name in sorted(set(manifest['files']) | {MANIFEST, SUMS}):
                    data = metadata[name] if name in metadata else read(name)
                    member = zipfile.ZipInfo(FOLDER + '/' + name, date_time=(1980, 1, 1, 0, 0, 0))
                    member.compress_type = zipfile.ZIP_DEFLATED
                    member.external_attr = (stat.S_IFREG | 0o644) << 16
                    runtime.writestr(member, data)
            require(file_sha(full_archive) == binding['sha256'], 'Full ZIP changed during runtime creation')
            archive_digest = file_sha(candidate)
            verify_runtime(candidate, archive_digest)
            staged_sums = Path(temporary) / 'runtime-checksum.txt'
            staged_sums.write_text(f'{archive_digest}  {output.name}\n', encoding='utf-8', newline='\n')
            # Same-filesystem links publish already-complete files without an
            # overwrite window. If the second link fails, roll back our first.
            publish_files([(candidate, output), (staged_sums, output.with_suffix('.zip.sha256'))])
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('create')
    create.add_argument('full_archive', type=Path)
    create.add_argument('output', type=Path)
    create.add_argument('--commit', required=True)
    create.add_argument('--tree', required=True)
    create.add_argument('--evidence-reference', required=True)
    verify = commands.add_parser('verify')
    verify.add_argument('archive', type=Path)
    verify.add_argument('--expected-sha256', required=True)
    verify.add_argument('--full-archive', type=Path)
    args = parser.parse_args()
    if args.command == 'create':
        result = create_runtime(args.full_archive, args.output, args.commit, args.tree, args.evidence_reference)
        print(f'Runtime candidate created for {result["source"]["git_commit"]}; checkpoint acceptance not asserted')
    else:
        print(json.dumps(verify_runtime(args.archive, args.expected_sha256, args.full_archive), sort_keys=True))


if __name__ == '__main__':
    main()
