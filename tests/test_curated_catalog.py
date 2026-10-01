import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepare', ROOT / 'scripts/prepare-openscore-candidates.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class CuratedEditionTests(unittest.TestCase):
    def test_retained_originals_have_exact_pinned_hashes_and_complete_separate_license(self):
        index = json.loads((ROOT / 'catalog/index.json').read_text(encoding='utf-8'))
        candidates = json.loads(prepare.MANIFEST.read_text(encoding='utf-8'))
        for entry in index['editions']:
            directory = ROOT / 'catalog' / entry['directory']
            score = json.loads((directory / 'score.json').read_text(encoding='utf-8'))
            provenance = json.loads((directory / 'provenance.json').read_text(encoding='utf-8'))
            retained = json.loads(score['source']['content'])
            self.assertEqual(score['id'], entry['id'])
            self.assertEqual(retained['provenance'], provenance)
            self.assertFalse(provenance['evaluation']['expressive_performance_equivalent'])
            license_bytes = (directory / 'LICENSE-CC0.txt').read_bytes()
            self.assertEqual(license_bytes.decode(), retained['license_text'])
            self.assertEqual(hashlib.sha256(license_bytes).hexdigest(), provenance['license_text_sha256'])
            self.assertIn('CC0 1.0 Universal', retained['license_text'])
            candidate = next(c for c in candidates['scores'] if c['id'] == provenance['upstream']['id'])
            self.assertEqual(provenance['upstream']['source_sha256'], candidate['source_sha256'])
            self.assertEqual(provenance['upstream']['commit'], candidates['upstream_commit'])
            for name, info in retained['files'].items():
                data = base64.b64decode(info['content'], validate=True) if info['encoding'] == 'base64' else info['content'].encode()
                self.assertEqual(len(data), info['bytes'], name)
                self.assertEqual(hashlib.sha256(data).hexdigest(), info['sha256'], name)
                self.assertEqual({k:v for k,v in info.items() if k != 'content'}, provenance['source_chain'][name])
            self.assertEqual(retained['files']['original.mscx']['sha256'], candidate['source_sha256'])

    def test_complete_written_inventory_is_preserved_independently_of_runtime_reader(self):
        directory = ROOT / 'catalog/editions/cc0-schubert-wandrers-nachtlied-d768'
        score = json.loads((directory / 'score.json').read_text(encoding='utf-8'))
        retained = json.loads(score['source']['content'])
        source_xml = retained['files']['import.musicxml']['content']
        self.assertEqual(prepare.written_event_inventory(source_xml), prepare.canonical_written_inventory({'score':score}))
        self.assertEqual(prepare.source_pitch_inventory(retained['files']['original.mscx']['content'].encode()), prepare.canonical_pitch_inventory({'score':score}))
        self.assertEqual(sum(len(part['notes']) for part in score['parts']), 334)
        self.assertIn('written_note_practice_edition', [d['code'] for d in score['source']['import_diagnostics']])
        normalized, changes = prepare.normalize_converted_xml(retained['files']['converter.musicxml']['content'].encode())
        self.assertEqual(normalized, source_xml)
        self.assertEqual(changes, retained['provenance']['normalizations'][:1])


if __name__ == '__main__':
    unittest.main()
