#!/usr/bin/env python3
"""Transfer bounded, unchanged native acceptance inputs between Windows CI jobs.

This is an integrity/transport gate, not semantic acceptance. The join job must
run the original verifiers against the same checkout and restored native paths.
No evidence JSON is parsed or rewritten. Browser profiles are never transferred.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import struct
import subprocess
import sys
import zipfile


SCHEMA = 'worldmusichub.native-acceptance-transfer.v1'
MANIFEST = 'ACCEPTANCE-MANIFEST.json'
MAX_FILES = 16384
MAX_DIRECTORIES = 4096
MAX_NODES = 32768
MAX_TOTAL_BYTES = 1024 * 1024 * 1024
MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_EXE_BYTES = 256 * 1024 * 1024
MAX_MANIFEST_BYTES = 4 * 1024 * 1024
MAX_ARCHIVE_BYTES = MAX_TOTAL_BYTES + MAX_MANIFEST_BYTES + 8 * 1024 * 1024
BLOCK = 1024 * 1024
IDENTITY_FIELDS = frozenset((
    'source_sha', 'source_tree', 'run_id', 'run_attempt', 'repository',
    'cargo_lock_sha256', 'npm_lock_sha256', 'rust', 'node', 'python', 'runner_os', 'rustflags',
))
SCENARIOS = (
    'desktop-startup', 'desktop-acceptance', 'desktop-song-folder',
    'desktop-bulk-import', 'desktop-clean-song', 'desktop-vsq-song',
    'desktop-performance-song', 'desktop-pitch-bend', 'desktop-authoring',
    'desktop-vsq-authoring', 'desktop-basic-key', 'desktop-complete-practice',
    'desktop-canonical-practice', 'desktop-build-diagnostics',
)
CATALOG = 'library-management-windows'
EXE = 'workspace/target/release/worldmusichub-desktop.exe'
PROVENANCE = 'workspace/target/release/native-build-provenance.json'
NOTICES = 'workspace/dist/licenses/native-rust'
VENDOR = 'workspace/web/vendor'
REQUIRED_FILES = frozenset((
    EXE, PROVENANCE, NOTICES + '/manifest.json', NOTICES + '/CARGO-THIRD-PARTY-NOTICES.txt',
    NOTICES + '/RUST-STANDARD-LIBRARY-COPYRIGHT.html',
    VENDOR + '/engraving-manifest.json', VENDOR + '/OSMD-LICENSE.txt',
    VENDOR + '/OSMD-AUTHORS.txt', VENDOR + '/opensheetmusicdisplay.min.js.LICENSE.txt',
))
PAYLOAD_AREAS = frozenset(('songs', 'backups', 'clean-songs', 'clean-backups', 'imports', 'import-backups'))
STAGING_AREAS = frozenset(('.staging', '.clean-staging', '.import-staging', '.catalog-staging'))
CLEAN_SCENARIOS = frozenset((
    'desktop-clean-song', 'desktop-vsq-song', 'desktop-performance-song',
    'desktop-pitch-bend', 'desktop-authoring', 'desktop-vsq-authoring', 'desktop-basic-key',
))
SHARED_DIRECTORIES = frozenset((
    'workspace/target', 'workspace/target/release', 'workspace/dist',
    'workspace/dist/licenses', 'workspace/web', VENDOR,
))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=True, indent=2) + '\n').encode('utf-8')


def parse_json(data):
    require(len(data) <= MAX_MANIFEST_BYTES, 'Manifest/identity exceeds byte limit')

    def distinct(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'Duplicate JSON key')
            result[key] = value
        return result

    return json.loads(data, object_pairs_hook=distinct,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Non-finite JSON value')))


def checked_identity(value):
    require(type(value) is dict and set(value) == IDENTITY_FIELDS, 'Exact identity fields are required')
    require(all(type(item) is str and len(item) <= 4096 and '\x00' not in item for item in value.values()),
            'Identity values must be bounded strings')
    require(all(value[key] for key in IDENTITY_FIELDS - {'rustflags'}), 'Identity values must not be empty')
    for key in ('source_sha', 'source_tree'):
        require(re.fullmatch('[0-9a-f]{40}', value[key]), 'Invalid source SHA/tree identity')
    for key in ('cargo_lock_sha256', 'npm_lock_sha256'):
        require(re.fullmatch('[0-9a-f]{64}', value[key]), 'Invalid lockfile identity')
    for key in ('run_id', 'run_attempt'):
        require(re.fullmatch('[1-9][0-9]*', value[key]), 'Invalid workflow run identity')
    require(re.fullmatch('[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', value['repository']), 'Invalid repository identity')
    return value


def safe_name(name):
    require(type(name) is str and 0 < len(name) <= 768, 'Unsafe transfer path')
    parts = name.split('/')
    require(len(parts) <= 16, 'Transfer path is too deep')
    for part in parts:
        stem = part.partition('.')[0].rstrip(' ')
        require(part and part not in ('.', '..') and len(part) <= 255
                and not part.endswith((' ', '.'))
                and not re.search(r'[\x00-\x1f\x7f<>:"\\|?*]', part)
                and not re.fullmatch(r'(?i:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])', stem),
                'Unsafe Windows transfer path: ' + name)
    return parts


def private_name(parts):
    """Never descend into profiles, secret stores, or dependency/cache trees."""
    return any(part.casefold().startswith(('webview', '.env', '.git', '.aws', '.ssh'))
               or part.casefold() in {'node_modules', 'credentials', 'credentials.json', 'secrets',
                                      'secrets.json', 'id_rsa', 'id_ed25519'} for part in parts)


def scenario_parts(name):
    parts = safe_name(name)
    if private_name(parts):
        return None
    if len(parts) >= 2 and ((parts[0] == 'workspace' and parts[1] in SCENARIOS)
                            or (parts[0] == 'runner-temp' and parts[1] == CATALOG)):
        return parts[1], parts[2:]
    return None


def score_areas(scenario):
    if scenario == CATALOG:
        return PAYLOAD_AREAS | STAGING_AREAS | {'catalog', 'catalog-backups'}
    if scenario in CLEAN_SCENARIOS:
        return {'clean-songs', 'clean-backups', 'imports', 'import-backups'} | STAGING_AREAS
    if scenario == 'desktop-complete-practice':
        return {'clean-songs', 'clean-backups'} | STAGING_AREAS
    if scenario in {'desktop-song-folder', 'desktop-canonical-practice'}:
        return {'songs', 'backups'} | STAGING_AREAS
    if scenario == 'desktop-bulk-import':
        return {'songs', 'backups', 'imports', 'import-backups'} | STAGING_AREAS
    return set()


def allowed_file(name):
    parts = safe_name(name)
    if private_name(parts):
        return False
    if name in {EXE, PROVENANCE} or name.startswith(NOTICES + '/'):
        return not any(part.startswith('.') for part in parts)
    if len(parts) == 4 and '/'.join(parts[:3]) == VENDOR:
        return parts[-1] == 'engraving-manifest.json' or parts[-1].endswith('.txt')
    scenario = scenario_parts(name)
    if scenario is None:
        return False
    root, rest = scenario
    if any(part.startswith('.') for part in rest):
        return False  # staging directories are preserved, never staging payloads
    if len(rest) == 1:
        return rest[0].endswith(('.json', '.png', '.log'))
    if root == 'desktop-build-diagnostics':
        return False
    if len(rest) == 2 and rest[0] == 'downloads' and root != 'desktop-startup':
        if root == 'desktop-authoring':
            return rest[1].endswith(('.json', '.zip'))
        return root != 'desktop-complete-practice' or rest[1].endswith('.json')
    if len(rest) == 2 and rest[0] == 'fixtures':
        return root not in {'desktop-startup', 'desktop-acceptance', 'desktop-song-folder'}
    if len(rest) >= 3 and rest[0] == 'Scores' and rest[1] in score_areas(root) - STAGING_AREAS:
        if root in {'desktop-song-folder', 'desktop-bulk-import'}:
            return len(rest) == 4
        return True
    return False


def allowed_directory(name):
    parts = safe_name(name)
    if private_name(parts):
        return False
    if name in SHARED_DIRECTORIES or name == NOTICES or name.startswith(NOTICES + '/'):
        return not any(part.startswith('.') for part in parts)
    scenario = scenario_parts(name)
    if scenario is None:
        return False
    root, rest = scenario
    if not rest:
        return True
    if root == 'desktop-build-diagnostics':
        return False
    if rest == ['downloads']:
        return root != 'desktop-startup'
    if rest == ['fixtures']:
        return root not in {'desktop-startup', 'desktop-acceptance', 'desktop-song-folder'}
    if rest == ['Scores']:
        return bool(score_areas(root))
    if len(rest) >= 2 and rest[0] == 'Scores' and rest[1] in score_areas(root):
        if rest[1] in STAGING_AREAS:
            return len(rest) == 2
        return not any(part.startswith('.') for part in rest) and (
            root not in {'desktop-song-folder', 'desktop-bulk-import'} or len(rest) <= 3)
    return False


def ordinary_stat(info, directory=None, allow_build_exe_link=False):
    require(not stat.S_ISLNK(info.st_mode) and not getattr(info, 'st_file_attributes', 0) & 0x400,
            'Symbolic links and Windows reparse points are forbidden')
    require(stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode),
            'Transfer input must be an ordinary ' + ('directory' if directory else 'file'))
    if not directory:
        require(info.st_nlink == 1 or allow_build_exe_link, 'Hard-linked transfer files are forbidden')


def checked_path(path, *, directory=None, missing=False, allow_build_exe_link=False):
    """lstat every component without resolving/following symlinks or junctions."""
    path = Path(os.path.abspath(path))
    for current in reversed((path, *path.parents)):
        try:
            info = current.lstat()
        except FileNotFoundError:
            require(missing, 'Missing transfer path: ' + str(current))
            continue
        ordinary_stat(info, directory=(directory if current == path else True),
                      allow_build_exe_link=allow_build_exe_link and current == path)
    return path


def roots(workspace, runner_temp):
    result = {'workspace': checked_path(workspace, directory=True),
              'runner-temp': checked_path(runner_temp, directory=True)}
    first, second = result.values()
    require(first != second and not first.is_relative_to(second) and not second.is_relative_to(first),
            'Workspace and runner temp must be separate directories')
    return result


def destination(roots_by_name, name):
    parts = safe_name(name)
    require(parts[0] in roots_by_name and len(parts) > 1, 'Unknown transfer destination root')
    return roots_by_name[parts[0]].joinpath(*parts[1:])


def tracked_paths(workspace):
    result = subprocess.run(['git', 'ls-files', '--cached', '-z'], cwd=workspace,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    require(result.returncode == 0 and len(result.stdout) <= 16 * 1024 * 1024,
            'Cannot establish tracked checkout destinations')
    return {('workspace/' + name.decode('utf-8')).casefold()
            for name in result.stdout.split(b'\0') if name}


def file_limit(name):
    return MAX_EXE_BYTES if name == EXE else MAX_FILE_BYTES


def stream_record(stream, expected_size, output=None):
    digest = hashlib.sha256()
    size = 0
    while block := stream.read(min(BLOCK, expected_size - size + 1)):
        size += len(block)
        require(size <= expected_size, 'File exceeds declared byte limit')
        digest.update(block)
        if output is not None:
            output.write(block)
    require(size == expected_size, 'File size differs from inventory')
    return {'bytes': size, 'sha256': digest.hexdigest()}


def read_ordinary(path, size, output=None, allow_build_exe_link=False):
    checked_path(path, directory=False, allow_build_exe_link=allow_build_exe_link)
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0) | getattr(os, 'O_BINARY', 0)
    with os.fdopen(os.open(path, flags), 'rb') as stream:
        before = os.fstat(stream.fileno())
        ordinary_stat(before, allow_build_exe_link=allow_build_exe_link)
        require(before.st_size == size, 'Transfer input size changed')
        record = stream_record(stream, size, output)
        after = os.fstat(stream.fileno())
        require((before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                == (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'Transfer input changed while reading')
    return record


def file_sha(path):
    path = checked_path(path, directory=False)
    require(path.stat().st_size <= MAX_ARCHIVE_BYTES, 'Transfer archive exceeds byte limit')
    return read_ordinary(path, path.stat().st_size)['sha256']


def inventory_paths(files, directories):
    require(type(files) is dict and 0 < len(files) <= MAX_FILES, 'Invalid transfer file count')
    require(type(directories) is list and len(directories) <= MAX_DIRECTORIES,
            'Invalid transfer directory count')
    require(all(type(name) is str for name in directories) and len(set(directories)) == len(directories),
            'Duplicate/invalid transfer directory')
    require(not set(files).intersection(directories), 'Transfer file/directory collision')
    aliases = {}
    for name in [*files, *directories]:
        parts = safe_name(name)
        for end in range(1, len(parts) + 1):
            prefix = '/'.join(parts[:end])
            folded = prefix.casefold()
            require(folded not in aliases or aliases[folded] == prefix, 'Case-colliding transfer paths')
            aliases[folded] = prefix
        require(all('/'.join(parts[:end]) not in files for end in range(1, len(parts))),
                'Transfer file is also a parent directory')
    for name in directories:
        require(allowed_directory(name), 'Directory outside transfer allowlist: ' + name)
    directory_set = set(directories)
    for name in [*files, *directories]:
        parts = name.split('/')
        require(all('/'.join(parts[:end]) in directory_set for end in range(2, len(parts))),
                'Manifest omits parent directory')
    total = 0
    for name, record in files.items():
        require(allowed_file(name), 'File outside transfer allowlist: ' + name)
        require(type(record) is dict and set(record) == {'bytes', 'sha256'}
                and type(record['bytes']) is int and 0 <= record['bytes'] <= file_limit(name)
                and type(record['sha256']) is str and re.fullmatch('[0-9a-f]{64}', record['sha256']),
                'Invalid bounded file record')
        total += record['bytes']
    require(total <= MAX_TOTAL_BYTES, 'Transfer payload exceeds total byte limit')
    require(REQUIRED_FILES <= set(files) and all(files[name]['bytes'] > 0 for name in REQUIRED_FILES),
            'Required executable or license notices are missing/empty')
    require(any(name.startswith(NOTICES + '/licenses/') and record['bytes'] > 0 for name, record in files.items()),
            'Rust standard-library license texts are missing')
    for root in [*('workspace/' + name for name in SCENARIOS), 'runner-temp/' + CATALOG]:
        require(any(name.startswith(root + '/') and record['bytes'] > 0 for name, record in files.items()),
                'Required native scenario has no files: ' + root)
    return total


def collect(roots_by_name):
    files, directories, nodes, total = {}, set(), 0, 0

    def visit(name):
        nonlocal nodes, total
        path = destination(roots_by_name, name)
        info = path.lstat()
        nodes += 1
        require(nodes <= MAX_NODES, 'Transfer traversal exceeds node limit')
        if stat.S_ISDIR(info.st_mode):
            if not allowed_directory(name):
                return
            ordinary_stat(info, directory=True)
            directories.add(name)
            require(len(directories) <= MAX_DIRECTORIES, 'Too many transfer directories')
            with os.scandir(path) as entries:
                for entry in entries:
                    child = name + '/' + entry.name
                    if allowed_file(child) or allowed_directory(child):
                        visit(child)
                    else:
                        nodes += 1
                        require(nodes <= MAX_NODES, 'Transfer traversal exceeds node limit')
                        # Staging must remain empty; silently dropping files
                        # would turn unfinished recovery into fabricated proof.
                        require(name.split('/')[-1] not in STAGING_AREAS, 'Staging directory is not empty')
        elif allowed_file(name) or allowed_directory(name):
            # Cargo can hard-link this exact output from target/release/deps.
            # Archive writing copies its checked bytes into an independent
            # ordinary member; no link identity reaches the consumer.
            ordinary_stat(info, allow_build_exe_link=name == EXE)
            require(allowed_file(name), 'Expected an ordinary evidence directory')
            require(info.st_size <= file_limit(name), 'Transfer file exceeds byte limit')
            total += info.st_size
            require(total <= MAX_TOTAL_BYTES and len(files) < MAX_FILES, 'Transfer payload exceeds bounds')
            files[name] = read_ordinary(path, info.st_size, allow_build_exe_link=name == EXE)

    top = [*('workspace/' + name for name in SCENARIOS), 'runner-temp/' + CATALOG,
           'workspace/target', 'workspace/dist', 'workspace/web']
    for name in top:
        visit(name)
    inventory_paths(files, sorted(directories))
    return dict(sorted(files.items())), sorted(directories)


def refuse_tracked(files, directories, workspace):
    tracked = tracked_paths(workspace)
    require(not any(name.casefold() in tracked for name in [*files, *directories]),
            'Tracked source cannot be transferred')
    require(not any(any(path.startswith(name.casefold() + '/') for path in tracked)
                    for name in directories if name not in SHARED_DIRECTORIES),
            'Transfer directory contains tracked source')


def create(workspace, runner_temp, output, identity):
    identity = checked_identity(identity)
    locations = roots(workspace, runner_temp)
    output = checked_path(output, directory=False, missing=True)
    require(not output.exists() and output.parent.is_dir(), 'Transfer archive must be a fresh file in an existing directory')
    files, directories = collect(locations)
    refuse_tracked(files, directories, locations['workspace'])
    manifest = {'schema': SCHEMA, 'identity': identity,
                'original_paths': {name: str(path) for name, path in locations.items()},
                'files': files, 'directories': directories,
                'file_count': len(files), 'payload_bytes': sum(row['bytes'] for row in files.values())}
    data = json_bytes(manifest)
    require(len(data) <= MAX_MANIFEST_BYTES, 'Transfer manifest exceeds byte limit')
    # Stored members avoid nested compression bombs and make the byte bound
    # independent of compression ratios. Artifact transport can compress it.
    with output.open('xb') as handle:
        try:
            with zipfile.ZipFile(handle, 'w', compression=zipfile.ZIP_STORED, allowZip64=False) as archive:
                for name, expected in files.items():
                    info = zipfile.ZipInfo(name)
                    info.external_attr = (stat.S_IFREG | 0o600) << 16
                    with archive.open(info, 'w') as target:
                        actual = read_ordinary(destination(locations, name), expected['bytes'], target,
                                               allow_build_exe_link=name == EXE)
                    require(actual == expected, 'Transfer input changed after inventory')
                archive.writestr(MANIFEST, data)
        except BaseException:
            handle.close()
            output.unlink()
            raise
    return file_sha(output)


def zip_envelope(path):
    """Bound central-directory parsing before ZipFile allocates entry objects."""
    with path.open('rb') as stream:
        stream.seek(0, os.SEEK_END)
        size = stream.tell()
        require(size >= 52, 'Truncated transfer ZIP')
        stream.seek(-22, os.SEEK_END)
        signature, disk, central_disk, disk_entries, count, central_size, offset, comment = struct.unpack(
            '<4s4H2LH', stream.read(22))
        require(signature == b'PK\x05\x06' and not disk and not central_disk and not comment
                and disk_entries == count, 'ZIP must have one disk and no trailing data/comments')
        require(0 < count <= MAX_FILES + 1, 'Archive entry count exceeds bounds')
        require(0 < central_size <= (MAX_FILES + 1) * (46 + 768)
                and offset >= 30 and offset + central_size + 22 == size,
                'ZIP central directory is unbounded or has an unsupported layout')
    return count, offset


def zip_inventory(archive, envelope):
    entries = archive.infolist()
    count, central_offset = envelope
    require(len(entries) == count, 'ZIP central directory count differs')
    names, folded, total = {}, set(), 0
    for entry in entries:
        name = entry.filename
        safe_name(name)
        require(entry.orig_filename == name, 'ZIP filename was normalized/truncated')
        require(name not in names and name.casefold() not in folded, 'Duplicate/case-colliding ZIP member')
        require(not entry.is_dir() and not entry.external_attr & (0x10 | 0x400),
                'ZIP directory/reparse attributes are forbidden')
        mode = entry.external_attr >> 16
        require(stat.S_IFMT(mode) in (0, stat.S_IFREG), 'ZIP special files or links are forbidden')
        require(entry.compress_type == zipfile.ZIP_STORED and entry.compress_size == entry.file_size,
                'Only uncompressed bounded ZIP members are supported')
        require(not entry.flag_bits & ~0x800 and not entry.extra and not entry.comment,
                'Unsupported ZIP flags, aliases or metadata')
        limit = MAX_MANIFEST_BYTES if name == MANIFEST else file_limit(name)
        require(0 <= entry.file_size <= limit, 'ZIP member exceeds byte limit')
        require(name == MANIFEST or allowed_file(name), 'Unknown ZIP member: ' + name)
        total += entry.file_size
        require(total <= MAX_TOTAL_BYTES + MAX_MANIFEST_BYTES, 'ZIP payload exceeds total byte limit')
        names[name] = entry
        folded.add(name.casefold())
    require(MANIFEST in names and not archive.comment, 'Missing manifest or unsupported ZIP comment')
    # Every byte before the central directory belongs to exactly one declared
    # member. Reject hidden local entries, aliases, prefixes and data gaps.
    offset = 0
    for entry in sorted(entries, key=lambda row: row.header_offset):
        require(entry.header_offset == offset, 'ZIP has hidden, overlapping or omitted local members')
        archive.fp.seek(offset)
        header = archive.fp.read(30)
        require(len(header) == 30, 'Truncated ZIP local header')
        signature, _, flags, compression, _, _, crc, compressed, size, name_size, extra_size = struct.unpack(
            '<4s5H3L2H', header)
        require(signature == b'PK\x03\x04' and flags == entry.flag_bits
                and compression == entry.compress_type and crc == entry.CRC
                and compressed == entry.compress_size and size == entry.file_size and not extra_size,
                'ZIP local and central metadata differ')
        local_name = archive.fp.read(name_size).decode('utf-8' if flags & 0x800 else 'cp437')
        require(local_name == entry.orig_filename, 'ZIP local filename differs')
        offset += 30 + name_size + size
    require(offset == central_offset, 'ZIP has unbound bytes before its central directory')
    return names


def preflight_destinations(locations, files, directories):
    refuse_tracked(files, directories, locations['workspace'])
    for name in [*directories, *files]:
        path = destination(locations, name)
        checked_path(path, directory=name in directories, missing=True)
        require(not path.exists() or name in SHARED_DIRECTORIES, 'Transfer destination already exists: ' + name)
        # Even Linux tests enforce Windows case-insensitive destination names.
        for current in (path, *path.parents):
            if current in locations.values():
                break
            if current.parent.is_dir():
                with os.scandir(current.parent) as entries:
                    require(all(entry.name.casefold() != current.name.casefold() or entry.name == current.name
                                for entry in entries), 'Case-alias destination already exists')


def restore(workspace, runner_temp, archive_path, expected_sha256, identity):
    identity = checked_identity(identity)
    locations = roots(workspace, runner_temp)
    require(type(expected_sha256) is str and re.fullmatch('[0-9a-f]{64}', expected_sha256),
            'Trusted producer SHA-256 is required')
    archive_path = checked_path(archive_path, directory=False)
    require(file_sha(archive_path) == expected_sha256, 'Transfer archive SHA-256 differs from trusted producer output')
    envelope = zip_envelope(archive_path)
    with zipfile.ZipFile(archive_path) as archive:
        entries = zip_inventory(archive, envelope)
        manifest = parse_json(archive.read(entries[MANIFEST]))
        require(type(manifest) is dict and set(manifest) == {
            'schema', 'identity', 'original_paths', 'files', 'directories', 'file_count', 'payload_bytes'},
            'Unexpected transfer manifest fields')
        require(manifest['schema'] == SCHEMA, 'Unknown transfer manifest schema')
        require(checked_identity(manifest['identity']) == identity, 'Transfer identity differs')
        require(manifest['original_paths'] == {name: str(path) for name, path in locations.items()},
                'Original absolute workspace/runner-temp paths differ; rebasing evidence is forbidden')
        files, directories = manifest['files'], manifest['directories']
        total = inventory_paths(files, directories)
        require(type(manifest['file_count']) is int and manifest['file_count'] == len(files)
                and type(manifest['payload_bytes']) is int and manifest['payload_bytes'] == total,
                'Transfer manifest totals differ')
        require(set(entries) == set(files) | {MANIFEST}, 'Exact manifest/ZIP membership is required')
        for name, expected in files.items():
            require(entries[name].file_size == expected['bytes'], 'ZIP/manifest file size differs')
            with archive.open(entries[name]) as stream:
                require(stream_record(stream, expected['bytes']) == expected, 'Transferred file hash differs: ' + name)
        preflight_destinations(locations, files, directories)
        # All records, bytes, paths and destinations have passed before writes.
        created_files, created_directories = [], []
        try:
            for name in sorted(directories, key=lambda value: (value.count('/'), value)):
                path = destination(locations, name)
                checked_path(path, directory=True, missing=True)
                if name in SHARED_DIRECTORIES and path.exists():
                    continue
                path.mkdir()
                created_directories.append(path)
            for name, expected in files.items():
                path = destination(locations, name)
                checked_path(path, directory=False, missing=True)
                with path.open('xb') as target:
                    created_files.append(path)
                    with archive.open(entries[name]) as stream:
                        require(stream_record(stream, expected['bytes'], target) == expected,
                                'Archive bytes changed during restore')
        except BaseException:
            for path in reversed(created_files):
                path.unlink()
            for path in reversed(created_directories):
                path.rmdir()
            raise
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for command in ('create', 'restore'):
        child = commands.add_parser(command)
        child.add_argument('--workspace', required=True)
        child.add_argument('--runner-temp', required=True)
        child.add_argument('--identity', default=os.environ.get('ACCEPTANCE_IDENTITY'))
        if command == 'create':
            child.add_argument('--output', required=True)
        else:
            child.add_argument('--archive', required=True)
            child.add_argument('--expected-sha256', required=True)
    args = parser.parse_args()
    require(args.identity is not None, '--identity or ACCEPTANCE_IDENTITY is required')
    identity = parse_json(args.identity.encode('utf-8'))
    if args.command == 'create':
        digest = create(args.workspace, args.runner_temp, args.output, identity)
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8', newline='\n') as output:
                output.write('sha256=' + digest + '\n')
        print('Created bounded native acceptance transfer; sha256=' + digest)
    else:
        manifest = restore(args.workspace, args.runner_temp, args.archive, args.expected_sha256, identity)
        print(f"Restored {manifest['file_count']} unchanged native input files; original semantic verifiers must still pass")


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, zipfile.BadZipFile, RuntimeError) as error:
        print('Native acceptance transfer failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
