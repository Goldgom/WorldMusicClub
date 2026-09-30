import importlib.util,json,pathlib,tempfile,unittest,zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('release',ROOT/'scripts/release-manifest.py');release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
class ReleaseManifestTests(unittest.TestCase):
 def fixture(self,directory):
  pe=bytearray(100);pe[:2]=b'MZ';pe[60:64]=(64).to_bytes(4,'little');pe[64:70]=b'PE\x00\x00\x64\x86'
  files={'WorldMusicHub.exe':bytes(pe),'README.md':b'WorldMusicHub','LICENSE':b'MIT','START-HERE.md':b'Extract before running','schema/worldmusichub-score-v1.schema.json':b'{}','licenses/engraving/engraving-manifest.json':b'{}','licenses/engraving/opensheetmusicdisplay.min.js.LICENSE.txt':b'BSD notice','licenses/rust/manifest.json':b'{}','licenses/rust/CARGO-THIRD-PARTY-NOTICES.txt':b'Crate notices','licenses/rust/RUST-STANDARD-LIBRARY-COPYRIGHT.html':b'Std notices'}
  for name,data in files.items():p=directory/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
 def test_portable_inventory_and_zip_checksums_match_exact_bytes(self):
  with tempfile.TemporaryDirectory() as temporary:
   root=pathlib.Path(temporary);directory=root/'WorldMusicHub';self.fixture(directory)
   info=release.create_manifest(directory,{'git_commit':'a'*40,'commit_count':50})
   self.assertNotIn(temporary,json.dumps(info));self.assertIn('WorldMusicHub.exe',info['files'])
   archive=root/'package.zip'
   release.create_archive(directory,archive)
   self.assertEqual(release.verify_archive(archive)['commit_count'],50);self.assertTrue((root/'package.zip.sha256').is_file())
 def test_package_requires_native_x64_header_and_complete_notices(self):
  with tempfile.TemporaryDirectory() as temporary:
   directory=pathlib.Path(temporary);self.fixture(directory);(directory/'WorldMusicHub.exe').write_bytes(b'Linux executable')
   with self.assertRaisesRegex(ValueError,'Windows PE'):release.create_manifest(directory,{})
   self.fixture(directory);(directory/'LICENSE').unlink()
   with self.assertRaisesRegex(ValueError,'missing LICENSE'):release.create_manifest(directory,{})
if __name__=='__main__':unittest.main()
