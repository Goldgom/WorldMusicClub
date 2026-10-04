#!/usr/bin/env python3
"""Collect locked Cargo dependency and Rust standard-library redistribution notices.

Reads only installed registry packages and reviewed, version-pinned fallback notices.
It does not download packages, execute their code, or include machine-local paths.
"""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import tomllib

ROOT = pathlib.Path(__file__).resolve().parents[1]
REVIEWED = {'MIT', 'Apache-2.0', '0BSD', 'Unlicense', 'Zlib', 'BSD-3-Clause', 'BSD-2-Clause', 'Unicode-3.0', 'ISC', 'LLVM-exception', 'CC0-1.0', 'MPL-2.0'}
REGISTRY = 'registry+https://github.com/rust-lang/crates.io-index'
SELECTIONS = {
    ('dunce', '1.0.5'): 'CC0-1.0',
}
FALLBACK = {
    ('midly', '0.5.3'): ('Unlicense', ['midly-0.5.3-LICENSE']),
    ('zune-core', '0.4.12'): ('Zlib', ['zune-LICENSE-ZLIB']),
    ('zune-jpeg', '0.4.21'): ('Zlib', ['zune-LICENSE-ZLIB']),
}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def read_file(path, base, limit=2 * 1024 * 1024):
    path, base = pathlib.Path(path), pathlib.Path(base).resolve()
    if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(base):
        raise ValueError(f'Expected regular notice within its package: {path.name}')
    if path.stat().st_size > limit:
        raise ValueError(f'Notice exceeds build limit: {path.name}')
    return path.read_bytes()

def read_notice(path, base, limit=2 * 1024 * 1024):
    data = read_file(path, base, limit)
    data.decode('utf-8')
    return data

def check_license(expression):
    tokens = set(re.findall(r'[A-Za-z0-9.-]+', expression or '')) - {'OR', 'AND', 'WITH'}
    if not tokens or not tokens <= REVIEWED:
        raise ValueError(f'Unreviewed Cargo license expression: {expression}')

def package_notices(package, base):
    """Include nested attribution, declared license files and British spelling."""
    paths = set()
    for path in base.rglob('*'):
        if (path.is_file() and re.match(r'(?i)^(licen[sc]e|copying|notice|copyright)(?:$|[._-])', path.name)
                and path.suffix.lower() not in {'.rs', '.c', '.h', '.cpp', '.js', '.py'}):
            paths.add(path)
    if package.get('license_file'):
        paths.add(base / package['license_file'])
    return [(path.relative_to(base).as_posix(), read_notice(path, base)) for path in sorted(paths)]

def source_archive(package, base, root):
    """Preserve exact MPL source offline, checked against the committed lockfile."""
    name, version = package['name'], package['version']
    locked = tomllib.loads((root / 'Cargo.lock').read_text())['package']
    expected = next((p.get('checksum') for p in locked if (p['name'], p['version'], p.get('source')) == (name, version, REGISTRY)), None)
    filename = f'{name}-{version}.crate'
    cache = base.parent.parent.parent / 'cache' / base.parent.name
    data = read_file(cache / filename, cache, 32 * 1024 * 1024)
    if not expected or digest(data) != expected:
        raise ValueError(f'MPL source archive does not match Cargo.lock: {filename}')
    return {'name': filename, 'sha256': expected, 'bytes': len(data),
            'url': f'https://static.crates.io/crates/{name}/{filename}'}, data

def collect(metadata, root=ROOT, target=None):
    root = pathlib.Path(root).resolve()
    fallback_root = root / 'third_party/rust'
    provenance = {item['file']: item for item in json.loads((fallback_root / 'manifest.json').read_text())}
    fallbacks = {key: (selected, list(names)) for key, (selected, names) in FALLBACK.items()}
    for filename, item in provenance.items():
        for package in item.get('packages', []):
            key = (package['name'], package['version'])
            selected, names = fallbacks.setdefault(key, (package['selected_license'], []))
            if selected != package['selected_license']:
                raise ValueError(f'Conflicting fallback license selection: {key}')
            names.append(filename)
    workspace = set(metadata['workspace_members'])
    components, sections, sources = [], [], []
    for package in sorted(metadata['packages'], key=lambda p: (p['name'], p['version'])):
        name, version = package['name'], package['version']
        selected = SELECTIONS.get((name, version)) or fallbacks.get((name, version), (None, []))[0]
        if selected and selected not in re.split(r'\s+OR\s+|\s*/\s*', package['license'] or ''):
            raise ValueError(f'Selected license is not an offered option: {name} {version}')
        check_license(selected or package['license'])
        materials, origins = [], []
        base = pathlib.Path(package['manifest_path']).resolve().parent
        if package['id'] in workspace:
            materials.append(('LICENSE', read_notice(root / 'LICENSE', root)))
        else:
            if package.get('source') != REGISTRY:
                raise ValueError(f'Only reviewed registry dependencies are supported: {name}')
            materials.extend(package_notices(package, base))
            if not materials:
                selected, names = fallbacks.get((name, version), (None, []))
                if not names:
                    raise ValueError(f'No distribution notice for {name} {version}')
                for filename in names:
                    data = read_notice(fallback_root / filename, fallback_root)
                    item = provenance[filename]
                    if digest(data) != item['sha256']:
                        raise ValueError(f'Changed reviewed fallback: {filename}')
                    materials.append((filename, data))
                    origins.append(item)
            # Native libraries shipped inside a Rust crate can have a separate
            # vendor license. Verify their exact bytes before adding its notices.
            for filename, item in provenance.items():
                if {'name': name, 'version': version} not in item.get('supplement_for', []):
                    continue
                for binary in item['bundled_files']:
                    if digest(read_file(base / binary['path'], base, 32 * 1024 * 1024)) != binary['sha256']:
                        raise ValueError(f'Changed reviewed bundled file: {name} {binary["path"]}')
                data = read_notice(fallback_root / filename, fallback_root)
                if digest(data) != item['sha256']:
                    raise ValueError(f'Changed reviewed supplemental notice: {filename}')
                check_license(item['component']['license'])
                materials.append((filename, data))
                origins.append(item)
        component = {'name': name, 'version': version, 'license': package['license'], 'source': package.get('source'), 'notices': [{'name': filename, 'sha256': digest(data), 'bytes': len(data)} for filename, data in materials]}
        if selected:
            component['selected_license'] = selected
        if origins:
            component['notice_provenance'] = origins
        bundled = [item['component'] for item in origins if 'component' in item]
        if bundled:
            component['bundled_components'] = list({json.dumps(item, sort_keys=True): item for item in bundled}.values())
        if 'MPL-2.0' in (selected or package['license']):
            archive, data = source_archive(package, base, root)
            component['source_archive'] = archive
            sources.append((archive['name'], data))
        components.append(component)
        sections.append(f'\n========== {name} {version} ({package["license"]}) ==========\n')
        if selected:
            sections.append(f'This distribution elects the {selected} option.\n')
        for bundled in component.get('bundled_components', []):
            sections.append(f'Also includes {bundled["name"]} {bundled["version"]}, under {bundled["license"]}; its vendor notices are included below.\n')
        if 'source_archive' in component:
            archive = component['source_archive']
            sections.append(f'Unmodified MPL-2.0 source is included in sources/{archive["name"]} and available at {archive["url"]}. SHA-256: {archive["sha256"]}.\n')
        sections.extend(f'\n--- {filename} ---\n{data.decode("utf-8")}\n' for filename, data in materials)
    text = ('WorldMusicClub Rust dependency notices\n\n'
            f'This conservative inventory includes locked build and runtime dependencies for {target or "all targets"}; it is not a claim that every package is linked into the executable. '
            'WorldMusicClub code is MIT licensed. Original score and third-party engraving licenses are documented separately. '
            'License texts and copyright notices below are copied without alteration.\n' + ''.join(sections))
    if len(text.encode()) > 8 * 1024 * 1024:
        raise ValueError('Combined Cargo notices exceed build limit')
    return text, components, sources

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'dist/licenses/rust')
    parser.add_argument('--target', help='Cargo target triple; omit to inventory all locked targets')
    args = parser.parse_args()
    command = ['cargo', 'metadata', '--locked', '--offline', '--format-version=1']
    if args.target:
        command.extend(['--filter-platform', args.target])
    metadata = json.loads(subprocess.check_output(command, cwd=ROOT))
    notices, components, sources = collect(metadata, target=args.target)
    sysroot = pathlib.Path(subprocess.check_output(['rustc', '--print', 'sysroot'], text=True).strip())
    documentation = sysroot / 'share/doc/rust'
    library = read_notice(documentation / 'COPYRIGHT-library.html', documentation, 8 * 1024 * 1024)
    standard = []
    for path in sorted((documentation / 'licenses').glob('*.txt')):
        standard.append((path.name, read_notice(path, documentation)))
    if not standard:
        raise ValueError('Rust standard-library license texts are missing; install rust-docs before packaging')
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    (output / 'CARGO-THIRD-PARTY-NOTICES.txt').write_text(notices, encoding='utf-8', newline='\n')
    (output / 'RUST-STANDARD-LIBRARY-COPYRIGHT.html').write_bytes(library)
    license_dir = output / 'licenses'
    license_dir.mkdir(exist_ok=True)
    for name, data in standard:
        (license_dir / name).write_bytes(data)
    if sources:
        source_dir = output / 'sources'
        source_dir.mkdir(exist_ok=True)
        for name, data in sources:
            (source_dir / name).write_bytes(data)
    manifest = {'format_version': 2, 'target': args.target, 'rustc': subprocess.check_output(['rustc', '--version'], text=True).strip(), 'cargo_lock_sha256': digest((ROOT / 'Cargo.lock').read_bytes()), 'components': components, 'standard_library': {'copyright_sha256': digest(library), 'license_texts': [{'name': name, 'sha256': digest(data)} for name, data in standard]}}
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Prepared notices for {len(components)} locked Cargo packages and the installed Rust standard library')

if __name__ == '__main__':
    main()
