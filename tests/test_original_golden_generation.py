"""Mock collector tests; these are never genuine Rust acceptance evidence."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('goldens', Path(__file__).resolve().parents[1] / 'scripts/regenerate-original-goldens.py')
G = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(G)


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'source'
        self.root.mkdir()
        for p in G.OUTPUTS:
            target = self.root / p
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('{}\n')
        (self.root / 'original.mid').write_bytes(b'original synthetic test placeholder')
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        subprocess.run(['git', '-C', str(self.root), 'add', '.'], check=True)
        subprocess.run(['git', '-C', str(self.root), '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Original fixtures'], check=True)
        self.sha = G.git(self.root, 'rev-parse', 'HEAD')
        self.tree = G.git(self.root, 'rev-parse', 'HEAD^{tree}')
        self.output = Path(self.temp.name) / 'artifact'
        self.real_run = subprocess.run
        self.calls = []
        self.env = patch.dict('os.environ', {'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_REPOSITORY': 'test/original', 'WMH_UPDATE_UNEXPECTED': '1'})
        self.env.start()
        self.addCleanup(self.env.stop)

    def read_command(self, args, **kwargs):
        if args[0] in ('rustc', 'cargo'):
            return 'mock-toolchain-for-collector-tests\n'
        return self.real_run(args, stdout=subprocess.PIPE, check=True, **kwargs).stdout

    def producer(self, args, **kwargs):
        flag, package, test, outputs = G.STEPS[len(self.calls)]
        self.assertEqual(args, ['cargo', 'test', '-p', package, '--test', test, '--locked'])
        self.assertEqual([k for k in kwargs['env'] if k.startswith('WMH_UPDATE_')], [flag])
        self.assertEqual(kwargs['env'][flag], '1')
        self.assertEqual(kwargs['timeout'], 900)
        self.assertTrue(kwargs['check'])
        for p in outputs:
            path = 'tests/fixtures/' + p
            if path not in G.UNCHANGED:
                (self.root / path).write_text(json.dumps({'producer': len(self.calls)}))
        self.calls.append(args)

    def generate(self, producer=None):
        with patch.object(G.subprocess, 'check_output', side_effect=self.read_command), patch.object(G.subprocess, 'run', side_effect=producer or self.producer):
            G.generate(self.root, self.output, self.sha, self.tree)

    def test_order_allowlist_and_hash_binding(self):
        self.generate()
        self.assertEqual(len(self.calls), 6)
        manifest = json.loads((self.output / 'provenance.json').read_text())
        self.assertEqual(manifest['source_sha'], self.sha)
        self.assertEqual(manifest['source_tree'], self.tree)
        self.assertEqual(manifest['run']['GITHUB_RUN_ID'], '123')
        self.assertIn('NOT ACCEPTANCE', manifest['status'])
        self.assertEqual({p.relative_to(self.output).as_posix() for p in self.output.rglob('*') if p.is_file()}, set(G.OUTPUTS) | {'provenance.json'})
        for p in G.OUTPUTS:
            self.assertEqual(G.digest(self.output / p), manifest['output_sha256'][p])
        self.assertEqual(len(manifest['changed_outputs']), 12)

    def reject_mutation(self, mutation, pattern):
        def bad(*args, **kwargs):
            self.producer(*args, **kwargs)
            mutation()
        with self.assertRaisesRegex(RuntimeError, pattern):
            self.generate(bad)
        self.assertFalse(self.output.exists())

    def test_original_change_rejected(self):
        self.reject_mutation(lambda: (self.root / 'original.mid').write_bytes(b'changed'), 'non-allowlisted')

    def test_untracked_output_rejected(self):
        self.reject_mutation(lambda: (self.root / 'unexpected').write_text('never upload'), 'untracked')

    def test_embedded_original_change_rejected(self):
        self.reject_mutation(lambda: (self.root / G.OUTPUTS[0]).write_text('{"score_json":"changed"}'), 'Embedded original')

    def test_vsq_change_rejected(self):
        def mutation():
            if len(self.calls) == 3:
                (self.root / G.UNCHANGED[0]).write_text('{"changed":true}')
        self.reject_mutation(mutation, 'VSQ')

    def test_wrong_source_and_dirty_checkout_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'SHA/tree'):
            G.generate(self.root, self.output, '0' * 40, self.tree)
        (self.root / 'unexpected').write_text('untracked')
        with self.assertRaisesRegex(RuntimeError, 'clean checkout'):
            G.generate(self.root, self.output, self.sha, self.tree)

    def test_missing_run_identity_rejected(self):
        with patch.dict('os.environ', {'GITHUB_RUN_ID': ''}):
            with self.assertRaisesRegex(RuntimeError, 'run identity'):
                self.generate()

    def test_failed_producer_never_collects(self):
        def bad(*args, **kwargs):
            raise subprocess.CalledProcessError(1, args[0])
        with self.assertRaises(subprocess.CalledProcessError):
            self.generate(bad)
        self.assertFalse(self.output.exists())

    def test_symlink_output_rejected(self):
        target = self.root / G.OUTPUTS[0]
        target.unlink()
        target.symlink_to(self.root / 'original.mid')
        with self.assertRaisesRegex(RuntimeError, 'regular file'):
            G.digest(target)

    def test_destination_inside_checkout_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'outside checkout'):
            G.generate(self.root, self.root / 'out', self.sha, self.tree)

    def test_oversize_output_rejected(self):
        real_digest = G.digest
        def guard(path):
            if self.calls and path.stat().st_size > 1:
                raise AssertionError('Oversized output hashed before size rejection')
            return real_digest(path)
        with patch.object(G, 'MAX_OUTPUT_BYTES', 1), patch.object(G, 'digest', side_effect=guard):
            with self.assertRaisesRegex(RuntimeError, 'bounded size'):
                self.generate()
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
