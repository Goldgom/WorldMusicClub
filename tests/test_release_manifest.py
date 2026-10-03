"""Synthetic PE fixtures exercise package inventory, not Windows acceptance."""
import importlib.util,json,pathlib,tempfile,unittest,zipfile,shutil
ROOT=pathlib.Path(__file__).resolve().parents[1]
SCHEMAS=('schema/worldmusichub-score-v1.schema.json','schemas/vsq-complete-score-v1.schema.json')
spec=importlib.util.spec_from_file_location('release',ROOT/'scripts/release-manifest.py');release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
class ReleaseManifestTests(unittest.TestCase):
 def fixture(self,directory):
  pe=bytearray(100);pe[:2]=b'MZ';pe[60:64]=(64).to_bytes(4,'little');pe[64:70]=b'PE\x00\x00\x64\x86'
  files={'WorldMusicHub.exe':bytes(pe),'README.md':b'WorldMusicHub','LICENSE':b'MIT','START-HERE.md':b'Extract before running','licenses/engraving/engraving-manifest.json':b'{}','licenses/engraving/opensheetmusicdisplay.min.js.LICENSE.txt':b'BSD notice','licenses/rust/manifest.json':b'{}','licenses/rust/CARGO-THIRD-PARTY-NOTICES.txt':b'Crate notices','licenses/rust/RUST-STANDARD-LIBRARY-COPYRIGHT.html':b'Std notices'}
  files.update({name:(ROOT/name).read_bytes() for name in SCHEMAS})
  for name,data in files.items():p=directory/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
  (directory/'catalog').mkdir(exist_ok=True);(directory/'catalog/index.json').write_text('{"version":1,"editions":[]}',encoding='utf-8')
 def test_portable_inventory_and_zip_checksums_match_exact_bytes(self):
  with tempfile.TemporaryDirectory() as temporary:
   root=pathlib.Path(temporary);directory=root/'WorldMusicHub';self.fixture(directory)
   info=release.create_manifest(directory,{'git_commit':'a'*40,'commit_count':50})
   self.assertNotIn(temporary,json.dumps(info));self.assertIn('WorldMusicHub.exe',info['files'])
   archive=root/'package.zip'
   release.create_archive(directory,archive)
   self.assertEqual(release.verify_archive(archive)['commit_count'],50);self.assertTrue((root/'package.zip.sha256').is_file())
   with zipfile.ZipFile(archive) as package:
    sums=package.read('WorldMusicHub/SHA256.txt').decode('utf-8').splitlines()
    for name in SCHEMAS:
     data=(ROOT/name).read_bytes();digest=release.sha(data)
     self.assertEqual(info['files'][name],{'sha256':digest,'bytes':len(data)})
     self.assertEqual(package.read('WorldMusicHub/'+name),data)
     self.assertIn(f'{digest}  {name}',sums)
 def test_package_requires_both_score_schemas_before_writing_inventory(self):
  with tempfile.TemporaryDirectory() as temporary:
   directory=pathlib.Path(temporary);self.fixture(directory)
   for name in SCHEMAS:
    path=directory/name;data=path.read_bytes();path.unlink()
    with self.subTest(missing=name),self.assertRaisesRegex(ValueError,'Package is missing '+name):
     release.create_manifest(directory,{})
    self.assertFalse((directory/release.INFO).exists());self.assertFalse((directory/release.SUMS).exists())
    path.write_bytes(data)
 def test_archived_vsq_schema_tampering_is_rejected(self):
  with tempfile.TemporaryDirectory() as temporary:
   root=pathlib.Path(temporary);directory=root/'WorldMusicHub';self.fixture(directory)
   release.create_manifest(directory,{'git_commit':'a'*40,'commit_count':50})
   name='schemas/vsq-complete-score-v1.schema.json'
   (directory/name).write_bytes((directory/name).read_bytes()+b'\n')
   with self.assertRaisesRegex(ValueError,'Checksum mismatch: '+name):
    release.create_archive(directory,root/'changed-schema.zip')
 def test_archive_cannot_omit_a_schema_even_with_rewritten_inventory_and_checksums(self):
  with tempfile.TemporaryDirectory() as temporary:
   root=pathlib.Path(temporary);directory=root/'WorldMusicHub';self.fixture(directory)
   original=release.create_manifest(directory,{'git_commit':'a'*40,'commit_count':50})
   for name in SCHEMAS:
    path=directory/name;data=path.read_bytes();path.unlink()
    info={**original,'files':{key:value for key,value in original['files'].items() if key!=name}}
    (directory/release.INFO).write_text(json.dumps(info),encoding='utf-8')
    sums={key:value['sha256'] for key,value in info['files'].items()}
    sums[release.INFO]=release.sha((directory/release.INFO).read_bytes())
    (directory/release.SUMS).write_text(''.join(f'{sums[key]}  {key}\n' for key in sorted(sums)),encoding='utf-8',newline='\n')
    with self.subTest(missing=name),self.assertRaisesRegex(ValueError,'Package is missing '+name):
     release.create_archive(directory,root/'omitted-schema.zip')
    path.write_bytes(data)
 def test_package_requires_native_x64_header_and_complete_notices(self):
  with tempfile.TemporaryDirectory() as temporary:
   directory=pathlib.Path(temporary);self.fixture(directory);(directory/'WorldMusicHub.exe').write_bytes(b'Linux executable')
   with self.assertRaisesRegex(ValueError,'Windows PE'):release.create_manifest(directory,{})
   self.fixture(directory);(directory/'LICENSE').unlink()
   with self.assertRaisesRegex(ValueError,'missing LICENSE'):release.create_manifest(directory,{})
 def test_package_requires_every_declared_score_source_and_license(self):
  with tempfile.TemporaryDirectory() as temporary:
   directory=pathlib.Path(temporary);self.fixture(directory)
   shutil.copyfile(ROOT/'catalog/index.json',directory/'catalog/index.json')
   with self.assertRaisesRegex(ValueError,'missing edition asset'):release.create_manifest(directory,{})
   shutil.copytree(ROOT/'catalog/editions',directory/'catalog/editions')
   info=release.create_manifest(directory,{})
   edition=info['curated_editions'][0]
   self.assertEqual(edition['id'],'cc0-schubert-wandrers-nachtlied-d768')
   self.assertFalse(edition['expressive_performance_equivalent'])
   self.assertIn('catalog/'+edition['directory']+'/LICENSE-CC0.txt',info['files'])
   (directory/'catalog'/edition['directory']/'LICENSE-CC0.txt').write_text('incomplete copy',encoding='utf-8')
   with self.assertRaisesRegex(ValueError,'archive/provenance/license differs'):release.create_manifest(directory,{})
if __name__=='__main__':unittest.main()
