#!/usr/bin/env python3
"""Create and verify portable Windows release provenance and file checksums."""
import argparse
import hashlib
import json
import os
import pathlib
import platform
import re
import subprocess
import tomllib
import zipfile

ROOT=pathlib.Path(__file__).resolve().parents[1]
INFO='BUILD-INFO.json'
SUMS='SHA256.txt'
SCORE_SCHEMAS=('schema/worldmusichub-score-v1.schema.json','schemas/vsq-complete-score-v1.schema.json')

def sha(data): return hashlib.sha256(data).hexdigest()

def require_windows_x64(data):
    if len(data)<64 or data[:2]!=b'MZ': raise ValueError('Executable is not a Windows PE file')
    offset=int.from_bytes(data[60:64],'little')
    if offset+6>len(data) or data[offset:offset+4]!=b'PE\x00\x00' or int.from_bytes(data[offset+4:offset+6],'little')!=0x8664:
        raise ValueError('Expected an x86-64 Windows PE executable')

def create_manifest(directory,metadata):
    directory=pathlib.Path(directory)
    required=['WorldMusicClub.exe','README.md','LICENSE','START-HERE.md',*SCORE_SCHEMAS,'licenses/engraving/engraving-manifest.json','licenses/engraving/opensheetmusicdisplay.min.js.LICENSE.txt','licenses/rust/manifest.json','licenses/rust/CARGO-THIRD-PARTY-NOTICES.txt','licenses/rust/RUST-STANDARD-LIBRARY-COPYRIGHT.html']
    for name in required:
        if not (directory/name).is_file(): raise ValueError(f'Package is missing {name}')
    index_path=directory/'catalog/index.json'
    if not index_path.is_file(): raise ValueError('Package is missing catalog/index.json')
    catalog=json.loads(index_path.read_text(encoding='utf-8'))
    if catalog.get('version')!=1 or not isinstance(catalog.get('editions'),list):raise ValueError('Unknown packaged catalog index')
    editions=[]
    for edition in catalog['editions']:
        relative=pathlib.PurePosixPath(edition['directory'])
        if relative.is_absolute() or '..' in relative.parts:raise ValueError('Invalid edition directory')
        for name in ['score.json','provenance.json','LICENSE-CC0.txt']:
            if not (directory/'catalog'/relative/name).is_file():raise ValueError(f'Package is missing edition asset {relative}/{name}')
        folder=directory/'catalog'/relative
        score_bytes=(folder/'score.json').read_bytes()
        score=json.loads(score_bytes);provenance=json.loads((folder/'provenance.json').read_bytes())
        retained=json.loads(score['source']['content']);license_bytes=(folder/'LICENSE-CC0.txt').read_bytes()
        if score['id']!=edition['id'] or provenance['edition_id']!=edition['id']:raise ValueError('Packaged edition identity mismatch')
        if score['provenance']['license']!=edition['license'] or provenance['edition_license']!=edition['license']:raise ValueError('Packaged edition license mismatch')
        if retained['provenance']!=provenance or retained['license_text'].encode('utf-8')!=license_bytes or sha(license_bytes)!=provenance['license_text_sha256']:raise ValueError('Packaged edition archive/provenance/license differs')
        editions.append({'id':edition['id'],'directory':edition['directory'],'license':edition['license'],'score_sha256':sha(score_bytes),'retained_source_sha256':sha(score['source']['content'].encode('utf-8')),'license_sha256':sha(license_bytes),'expressive_performance_equivalent':False})
    require_windows_x64((directory/'WorldMusicClub.exe').read_bytes())
    files={}
    for path in sorted(directory.rglob('*')):
        if path.is_symlink(): raise ValueError('Portable packages cannot contain symbolic links')
        if not path.is_file(): continue
        name=path.relative_to(directory).as_posix()
        if name in (INFO,SUMS): continue
        data=path.read_bytes();files[name]={'sha256':sha(data),'bytes':len(data)}
    info={'format_version':1,**metadata,'curated_editions':editions,'files':files}
    (directory/INFO).write_text(json.dumps(info,indent=2,ensure_ascii=False)+'\n',encoding='utf-8',newline='\n')
    entries={**files,INFO:{'sha256':sha((directory/INFO).read_bytes())}}
    (directory/SUMS).write_text(''.join(f'{entries[name]["sha256"]}  {name}\n' for name in sorted(entries)),encoding='utf-8',newline='\n')
    return info

def verify_archive(archive):
    archive=pathlib.Path(archive)
    with zipfile.ZipFile(archive) as package:
        names=[entry.filename for entry in package.infolist() if not entry.is_dir()]
        if len(names)!=len(set(names)):raise ValueError('Archive contains duplicate paths')
        prefix='WorldMusicClub/'
        info=json.loads(package.read(prefix+INFO))
        for name in SCORE_SCHEMAS:
            if name not in info['files']:raise ValueError(f'Package is missing {name}')
        required=set(info['files'])|{INFO,SUMS}
        if set(names)!={prefix+name for name in required}:raise ValueError('Archive contents differ from the release inventory')
        for name,item in info['files'].items():
            if name.startswith('/') or '..' in pathlib.PurePosixPath(name).parts:raise ValueError('Invalid archive path')
            data=package.read(prefix+name)
            if len(data)!=item['bytes'] or sha(data)!=item['sha256']:raise ValueError(f'Checksum mismatch: {name}')
        require_windows_x64(package.read(prefix+'WorldMusicClub.exe'))
        checksum_entries={name:item['sha256'] for name,item in info['files'].items()}
        checksum_entries[INFO]=sha(package.read(prefix+INFO))
        expected=''.join(f'{checksum_entries[name]}  {name}\n' for name in sorted(checksum_entries))
        if package.read(prefix+SUMS).decode('utf-8')!=expected:raise ValueError('Portable checksum file differs from the inventory')
    archive.with_suffix(archive.suffix+'.sha256').write_text(f'{sha(archive.read_bytes())}  {archive.name}\n',encoding='utf-8',newline='\n')
    return info

def create_archive(directory,archive):
    directory,archive=pathlib.Path(directory),pathlib.Path(archive)
    if directory.name!='WorldMusicClub':raise ValueError('Portable folder must be named WorldMusicClub')
    with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as package:
        for path in sorted(directory.rglob('*')):
            if path.is_file():package.write(path,'WorldMusicClub/'+path.relative_to(directory).as_posix())
    return verify_archive(archive)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    commands=parser.add_subparsers(dest='command',required=True)
    create=commands.add_parser('create');create.add_argument('directory',type=pathlib.Path);create.add_argument('--commit',required=True);create.add_argument('--count',required=True,type=int);create.add_argument('--recovery-for',type=int,default=0)
    verify=commands.add_parser('verify');verify.add_argument('archive',type=pathlib.Path)
    archive=commands.add_parser('archive');archive.add_argument('directory',type=pathlib.Path);archive.add_argument('archive',type=pathlib.Path)
    args=parser.parse_args()
    if args.command in ('verify','archive'):
        info=verify_archive(args.archive) if args.command=='verify' else create_archive(args.directory,args.archive);print(f'Verified Windows package: commit {info["commit_count"]}, {info["git_commit"]}')
        return
    def git(*arguments):return subprocess.check_output(['git',*arguments],cwd=ROOT,text=True).strip()
    commit=git('rev-parse','HEAD');count=int(git('rev-list','--count','HEAD'))
    if not re.fullmatch('[0-9a-f]{40}',args.commit) or args.commit!=commit or args.count!=count:raise ValueError('Requested release commit/count does not match this complete checkout')
    if args.recovery_for and (args.recovery_for<1 or args.recovery_for%50 or not args.recovery_for<count<args.recovery_for+50):raise ValueError('Invalid recovery milestone for this actual source count')
    if git('status','--porcelain'):raise ValueError('Release checkout must be clean; do not label uncommitted code with a committed SHA')
    if platform.system()!='Windows':raise ValueError('Release manifests must be created on Windows after native build and smoke tests')
    host=next((line.split(': ',1)[1] for line in subprocess.check_output(['rustc','-vV'],text=True).splitlines() if line.startswith('host: ')),None)
    if host!='x86_64-pc-windows-msvc':raise ValueError('Expected the native Windows x64 MSVC toolchain')
    metadata={'name':'WorldMusicClub','git_commit':commit,'git_tree':git('rev-parse','HEAD^{tree}'),'commit_count':count,'recovery_for':args.recovery_for or None,'release_label':f'commit-{count}'+(f'-recovery-for-{args.recovery_for}' if args.recovery_for else ''),'target':host,'rustflags':os.environ.get('RUSTFLAGS',''),'build_platform':platform.platform(),'rustc':subprocess.check_output(['rustc','--version'],text=True).strip(),'rustc_verbose':subprocess.check_output(['rustc','-vV'],text=True).strip(),'cargo':subprocess.check_output(['cargo','--version'],text=True).strip(),'node':subprocess.check_output(['node','--version'],text=True).strip(),'python':platform.python_version(),'cargo_lock_sha256':sha((ROOT/'Cargo.lock').read_bytes()),'npm_lock_sha256':sha((ROOT/'package-lock.json').read_bytes()),'offline_engraving_version':'2.1.3','distribution':'unsigned portable alpha; browser UI; physical MIDI/audio latency not verified'}
    metadata['app_version']=tomllib.loads((ROOT/'Cargo.toml').read_text(encoding='utf-8'))['workspace']['package']['version']
    metadata['score_schema_revision']=int(re.search(r'pub const SCORE_SCHEMA_REVISION: u32 = (\d+);',(ROOT/'crates/score-core/src/lib.rs').read_text(encoding='utf-8')).group(1))
    create_manifest(args.directory,metadata);print(f'Created release inventory for commit {count}: {commit}')

if __name__=='__main__':main()
