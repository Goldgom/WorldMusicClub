#!/usr/bin/env python3
"""Offline runtime extraction and post-packaging startup evidence binding.

No download, executable launch, or acceptance-summary substitution. The Windows
wrapper owns normal startup; this helper verifies bytes and its retained report.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import stat
import zipfile

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location('runtime_package', ROOT / 'scripts/native-runtime-package.py')
runtime = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(runtime)
require = runtime.require
REPORT = 'normal-native-report.json'
SCREENSHOT = 'normal-native-window.png'
LOG = 'normal-stderr.log'
MAX_PROOF_BYTES = 32 * 1024 * 1024


def regular_file(path, maximum=runtime.MAX_MEMBER_BYTES):
    path = Path(path)
    details = path.lstat()
    require(stat.S_ISREG(details.st_mode) and not path.is_symlink()
            and not getattr(path, 'is_junction', lambda: False)(), f'Not a regular file: {path.name}')
    require(details.st_size <= maximum, f'File exceeds size bound: {path.name}')
    data = path.read_bytes()
    require(len(data) <= maximum, f'File grew beyond size bound: {path.name}')
    return data


def checked_runtime(archive, expected_sha256, expected_full_sha256, commit, tree, run_id, repository, full_artifact_id, full_archive=None):
    archive = Path(archive)
    result = runtime.verify_runtime(archive, expected_sha256, full_archive)
    require(regular_file(archive.with_suffix('.zip.sha256'), 1024)
            == f'{expected_sha256}  {archive.name}\n'.encode(), 'Runtime checksum sidecar differs')
    with zipfile.ZipFile(archive) as package:
        rows = runtime.inventory(package)
        manifest = runtime.parse_json(runtime.read_member(package, rows, runtime.MANIFEST))
    runtime.digest(expected_full_sha256)
    require(manifest['full_evidence']['sha256'] == expected_full_sha256, 'Runtime full ZIP differs from pre-upload digest')
    source = manifest['source']
    require(source['git_commit'] == commit and source['git_tree'] == tree, 'Runtime source/tree differs')
    expected_url = f'https://github.com/{repository}/actions/runs/{run_id}/artifacts/{full_artifact_id}'
    expected_reference = runtime.evidence_reference(expected_url, commit)
    require(manifest['full_evidence']['reference'] == expected_reference,
            'Runtime full artifact repository/run/identity differs')
    return manifest, result


def checked_extracted(archive, directory):
    """Require every extracted byte and no added/linked file, including metadata."""
    directory = Path(directory)
    require(directory.is_dir() and not directory.is_symlink()
            and not getattr(directory, 'is_junction', lambda: False)(), 'Invalid extracted root')
    with zipfile.ZipFile(archive) as package:
        rows = runtime.inventory(package)
        expected_dirs = set()
        for name in rows:
            parts = name.split('/')
            expected_dirs.update('/'.join(parts[:end]) for end in range(1, len(parts)))
        files, directories = set(), set()
        for path in directory.rglob('*'):
            name = path.relative_to(directory).as_posix()
            require(not path.is_symlink() and not getattr(path, 'is_junction', lambda: False)(),
                    f'Linked extracted member: {name}')
            if path.is_dir():
                directories.add(name)
            else:
                require(name in rows, f'Unexpected extracted member: {name}')
                require(runtime.record(regular_file(path)) == runtime.record(runtime.read_member(package, rows, name)),
                        f'Extracted bytes differ: {name}')
                files.add(name)
        require(files == set(rows) and directories == expected_dirs, 'Extracted inventory differs')
    return len(files)


def extract_runtime(archive, destination, **identity):
    manifest, _ = checked_runtime(archive, **identity)
    destination = Path(destination)
    require(not destination.exists() and not destination.is_symlink(), 'Extraction destination must be new')
    destination.mkdir(parents=False)
    directory = destination / runtime.FOLDER
    directory.mkdir()
    # Read only previously bounded, verified names. No platform ZIP extractor can
    # reinterpret an alias; writes are exclusive into our new empty directory.
    with zipfile.ZipFile(archive) as package:
        rows = runtime.inventory(package)
        for name in sorted(rows):
            path = directory / name
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('xb') as output:
                output.write(runtime.read_member(package, rows, name))
    checked_extracted(archive, directory)
    require(runtime.file_sha(archive) == identity['expected_sha256'], 'Runtime changed during extraction')
    return manifest


def startup_evidence(directory, manifest, extracted=None):
    directory = Path(directory)
    require(directory.is_dir() and not directory.is_symlink()
            and not getattr(directory, 'is_junction', lambda: False)(), 'Invalid startup evidence root')
    required = {REPORT, SCREENSHOT, LOG}
    require({path.name for path in directory.iterdir()} == required, 'Startup evidence inventory differs')
    data = {name: regular_file(directory / name, MAX_PROOF_BYTES) for name in required}
    report = runtime.parse_json(data[REPORT])
    source = manifest['source']
    require(isinstance(report, dict) and set(report) == {
        'version', 'source_sha', 'source_tree', 'commit_count', 'executable_sha256',
        'workflow_run_id', 'native_process_id', 'package_directory', 'executable_path',
        'normal_startup', 'ok', 'normal_close', 'test_hooks_enabled', 'clean_machine_installation',
        'window_title', 'window_width', 'window_height', 'sampled_client_colors',
        'executable_tcp_listeners', 'startup_control'}, 'Unexpected portable startup report fields')
    require(type(report.get('version')) is int and report['version'] == 1,
            'Unsupported portable startup report')
    require(report.get('source_sha') == source['git_commit']
            and report.get('source_tree') == source['git_tree']
            and type(report.get('commit_count')) is int and report['commit_count'] == source['commit_count']
            and report.get('executable_sha256') == manifest['executable']['sha256'],
            'Portable startup source/tree/EXE differs')
    require(report.get('workflow_run_id') == manifest['full_evidence']['reference']['workflow_run_id'],
            'Portable startup workflow run differs')
    require(type(report.get('native_process_id')) is int and report['native_process_id'] > 0,
            'Portable startup process missing')
    package = report.get('package_directory')
    require(isinstance(package, str) and Path(package).is_absolute()
            and report.get('executable_path') == str(Path(package) / runtime.EXE),
            'Portable startup executable path differs')
    if extracted is not None:
        require(Path(package).resolve() == Path(extracted).resolve(), 'Runtime startup used a different extracted directory')
    for field in ('normal_startup', 'ok', 'normal_close'):
        require(report.get(field) is True, f'Portable startup did not pass: {field}')
    for field in ('test_hooks_enabled', 'clean_machine_installation'):
        require(report.get(field) is False, f'Invalid portable startup scope: {field}')
    require(report.get('window_title') == 'WorldMusicClub', 'Wrong portable startup window')
    for field, minimum in [('window_width', 640), ('window_height', 480), ('sampled_client_colors', 8)]:
        require(type(report.get(field)) is int and report[field] >= minimum, f'Invalid startup rendering: {field}')
    require(type(report.get('executable_tcp_listeners')) is int and report['executable_tcp_listeners'] == 0,
            'Portable executable opened a listener')
    control = report.get('startup_control', {})
    require(isinstance(control, dict) and set(control) == {'automation_id', 'name', 'enabled', 'offscreen'}
            and isinstance(control['automation_id'], str) and isinstance(control['name'], str)
            and control.get('enabled') is True and control.get('offscreen') is False
            and (control.get('automation_id') == 'home-single-player' or control.get('name') in {
                '单人模式 选一首曲子，进入你的音乐舞台', 'Single player Choose a song. Make the stage yours.'}),
            'Portable startup control not observed')
    require(data[SCREENSHOT].startswith(b'\x89PNG\r\n\x1a\n'), 'Startup screenshot is not PNG')
    return {name: runtime.record(value) for name, value in sorted(data.items())}


def delivery_record(archive, full_archive, extracted, full_startup, runtime_startup, **identity):
    manifest, verification = checked_runtime(archive, full_archive=full_archive, **identity)
    file_count = checked_extracted(archive, extracted)
    require(Path(full_archive).name == manifest['full_evidence']['filename'], 'Full ZIP filename differs')
    require(Path(full_startup).resolve() != Path(runtime_startup).resolve(), 'Startup evidence roots must differ')
    full_proof = startup_evidence(full_startup, manifest)
    runtime_proof = startup_evidence(runtime_startup, manifest, extracted)
    full_report = runtime.parse_json(regular_file(Path(full_startup) / REPORT, MAX_PROOF_BYTES))
    require(Path(full_report['package_directory']).resolve() != Path(extracted).resolve(),
            'Full and runtime startup extraction directories must differ')
    # Origin belongs to the existing instrumented full startup, never pretend
    # that the ordinary UI Automation smoke observed location.origin directly.
    with zipfile.ZipFile(full_archive) as package:
        rows = runtime.inventory(package)
        host = runtime.parse_json(runtime.read_member(package, rows, 'evidence/native-report.json'))
        renderer = runtime.parse_json(runtime.read_member(package, rows, 'evidence/renderer-report.json'))
        require(host.get('source_sha') == identity['commit']
                and host.get('executable_sha256') == manifest['executable']['sha256']
                and host.get('renderer_origin') == 'https://wmh.localhost'
                and renderer.get('origin') == 'https://wmh.localhost'
                and renderer.get('ok') is True, 'Same-EXE full startup origin differs')
    require(runtime.file_sha(archive) == identity['expected_sha256']
            and runtime.file_sha(full_archive) == manifest['full_evidence']['sha256'],
            'Archive changed while binding delivery evidence')
    return {'format': 'worldmusicclub.native-runtime-delivery', 'format_version': 1,
            'source': manifest['source'], 'workflow_run_id': identity['run_id'],
            'repository': identity['repository'], 'executable': manifest['executable'],
            'runtime_archive': {'filename': Path(archive).name, 'sha256': identity['expected_sha256'],
                                'bytes': Path(archive).stat().st_size},
            'full_evidence': manifest['full_evidence'],
            'runtime_verification': verification,
            'extracted_runtime_file_count': file_count,
            'full_normal_startup': full_proof, 'runtime_normal_startup': runtime_proof,
            'origin': {'value': 'https://wmh.localhost', 'basis': 'same-executable-full-startup-evidence',
                       'ordinary_startup_origin_observed': False},
            'acceptance_scope': 'native-windows-only', 'checkpoint_acceptance': 'not-asserted',
            'clean_machine_installation': False, 'audibility': False,
            'checkpoint_requirements': ['Native Windows feature acceptance / acceptance-summary for this source and run',
                                        'Verify WorldMusicClub for this source']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('extract', 'create', 'verify'):
        command = commands.add_parser(name)
        command.add_argument('--archive', type=Path, required=True)
        command.add_argument('--expected-sha256', required=True)
        command.add_argument('--expected-full-sha256', required=True)
        command.add_argument('--commit', required=True)
        command.add_argument('--tree', required=True)
        command.add_argument('--run-id', required=True)
        command.add_argument('--repository', required=True)
        command.add_argument('--full-artifact-id', required=True)
        if name == 'extract':
            command.add_argument('--destination', type=Path, required=True)
        else:
            command.add_argument('--full-archive', type=Path, required=True)
            command.add_argument('--extracted', type=Path, required=True)
            command.add_argument('--full-startup', type=Path, required=True)
            command.add_argument('--runtime-startup', type=Path, required=True)
            command.add_argument('--record', type=Path, required=True)
    args = vars(parser.parse_args())
    command = args.pop('command')
    if command == 'extract':
        result = extract_runtime(**args)
        print(json.dumps({'source': result['source'], 'extracted_runtime': 'verified'}, sort_keys=True))
    else:
        path = args.pop('record')
        result = delivery_record(**args)
        if command == 'create':
            with path.open('xb') as output:
                output.write(runtime.json_bytes(result))
        else:
            require(regular_file(path, runtime.MAX_JSON_BYTES) == runtime.json_bytes(result), 'Delivery record differs')
        print(json.dumps({'delivery_record': 'created' if command == 'create' else 'verified', 'sha256': runtime.file_sha(path),
                          'checkpoint_acceptance': 'not-asserted'}, sort_keys=True))


if __name__ == '__main__':
    main()
