"""Real Git checks keep generated native evidence out of source provenance."""
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class NativeOutputHygieneTests(unittest.TestCase):
    def test_all_declared_native_outputs_keep_source_guard_clean(self):
        workflow = (ROOT / '.github/workflows/windows-desktop-acceptance.yml').read_text(encoding='utf-8')
        outputs = set(re.findall(r'-OutputDirectory\s+(desktop-[a-z-]+)', workflow))
        self.assertIn('desktop-clean-song', outputs)
        self.assertGreaterEqual(len(outputs), 6)
        with tempfile.TemporaryDirectory(prefix='wmh-source-guard-') as temporary:
            directory = Path(temporary)

            def git(*arguments):
                return subprocess.check_output(['git', *arguments], cwd=directory, encoding='utf-8', stderr=subprocess.PIPE).strip()

            git('init', '-q')
            (directory / '.gitignore').write_bytes((ROOT / '.gitignore').read_bytes())
            source = directory / 'source.rs'
            source.write_text('// original fixture\n', encoding='utf-8')
            git('add', '.gitignore', 'source.rs')
            git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                'commit', '-qm', 'original source fixture')
            for output in outputs:
                generated = directory / output / 'Scores/imports/original/inventory.json'
                generated.parent.mkdir(parents=True)
                generated.write_text('{}\n', encoding='utf-8')
            self.assertEqual(git('status', '--porcelain', '--untracked-files=all'), '')
            source.write_text('// changed source\n', encoding='utf-8')
            (directory / 'unexpected.rs').write_text('// unexpected source\n', encoding='utf-8')
            (directory / 'desktop-clean-song.rs').write_text('// source, not output directory\n', encoding='utf-8')
            status = git('status', '--porcelain', '--untracked-files=all')
            self.assertIn('M source.rs', status)
            self.assertIn('?? unexpected.rs', status)
            self.assertIn('?? desktop-clean-song.rs', status)


if __name__ == '__main__':
    unittest.main()
