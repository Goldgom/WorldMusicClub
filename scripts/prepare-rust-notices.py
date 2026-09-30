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

ROOT = pathlib.Path(__file__).resolve().parents[1]
REVIEWED = {'MIT', 'Apache-2.0', '0BSD', 'Unlicense', 'Zlib', 'BSD-3-Clause', 'BSD-2-Clause', 'Unicode-3.0', 'ISC'}
FALLBACK = {
    ('midly', '0.5.3'): ('Unlicense', ['midly-0.5.3-LICENSE']),
    ('zune-core', '0.4.12'): ('Zlib', ['zune-LICENSE-ZLIB']),
    ('zune-jpeg', '0.4.21'): ('Zlib', ['zune-LICENSE-ZLIB']),
}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def read_notice(path, base, limit=2 * 1024 * 1024):
    path, base = pathlib.Path(path), pathlib.Path(base).resolve()
    if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(base):
        raise ValueError(f'Expected regular notice within its package: {path.name}')
    if path.stat().st_size > limit:
        raise ValueError(f'Notice exceeds build limit: {path.name}')
    data = path.read_bytes()
    data.decode('utf-8')
    return data

def check_license(expression):
    tokens = set(re.findall(r'[A-Za-z0-9.-]+', expression or '')) - {'OR', 'AND', 'WITH'}
    if not tokens or not tokens <= REVIEWED:
        raise ValueError(f'Unreviewed Cargo license expression: {expression}')

def collect(metadata, root=ROOT):
    root = pathlib.Path(root).resolve()
    fallback_root = root / 'third_party/rust'
    provenance = {item['file']: item for item in json.loads((fallback_root / 'manifest.json').read_text())}
    workspace = set(metadata['workspace_members'])
    components, sections = [], []
    for package in sorted(metadata['packages'], key=lambda p: (p['name'], p['version'])):
        name, version = package['name'], package['version']
        check_license(package['license'])
        materials, selected, origins = [], None, []
        base = pathlib.Path(package['manifest_path']).resolve().parent
        if package['id'] in workspace:
            materials.append(('LICENSE', read_notice(root / 'LICENSE', root)))
        else:
            if not (package.get('source') or '').startswith('registry+'):
                raise ValueError(f'Only reviewed registry dependencies are supported: {name}')
            for path in sorted(base.iterdir()):
                if path.name.lower().startswith(('license', 'copying', 'notice', 'copyright')) and path.is_file():
                    materials.append((path.name, read_notice(path, base)))
            if not materials:
                selected, names = FALLBACK.get((name, version), (None, []))
                if not names:
                    raise ValueError(f'No distribution notice for {name} {version}')
                for filename in names:
                    data = read_notice(fallback_root / filename, fallback_root)
                    item = provenance[filename]
                    if digest(data) != item['sha256']:
                        raise ValueError(f'Changed reviewed fallback: {filename}')
                    materials.append((filename, data))
                    origins.append(item)
        component = {'name': name, 'version': version, 'license': package['license'], 'source': package.get('source'), 'notices': [{'name': filename, 'sha256': digest(data), 'bytes': len(data)} for filename, data in materials]}
        if selected:
            component['selected_license'] = selected
            component['notice_provenance'] = origins
        components.append(component)
        sections.append(f'\n========== {name} {version} ({package["license"]}) ==========\n')
        if selected:
            sections.append(f'This distribution elects the {selected} option.\n')
        sections.extend(f'\n--- {filename} ---\n{data.decode("utf-8")}\n' for filename, data in materials)
    text = ('WorldMusicHub Rust dependency notices\n\n'
            'This conservative inventory includes locked build, target and runtime dependencies; it is not a claim that every package is linked into the executable. '
            'WorldMusicHub code is MIT licensed. Original score and third-party engraving licenses are documented separately. '
            'License texts and copyright notices below are copied without alteration.\n' + ''.join(sections))
    if len(text.encode()) > 8 * 1024 * 1024:
        raise ValueError('Combined Cargo notices exceed build limit')
    return text, components

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'dist/licenses/rust')
    args = parser.parse_args()
    metadata = json.loads(subprocess.check_output(['cargo', 'metadata', '--locked', '--offline', '--format-version=1'], cwd=ROOT))
    notices, components = collect(metadata)
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
    manifest = {'format_version': 1, 'rustc': subprocess.check_output(['rustc', '--version'], text=True).strip(), 'cargo_lock_sha256': digest((ROOT / 'Cargo.lock').read_bytes()), 'components': components, 'standard_library': {'copyright_sha256': digest(library), 'license_texts': [{'name': name, 'sha256': digest(data)} for name, data in standard]}}
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Prepared notices for {len(components)} locked Cargo packages and the installed Rust standard library')

if __name__ == '__main__':
    main()
