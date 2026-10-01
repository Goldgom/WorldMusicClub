import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from collections import Counter
from fractions import Fraction
import xml.etree.ElementTree as ET

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

    def test_beethoven_original_mscx_preserves_every_spelled_timed_event_and_tie(self):
        directory = ROOT / 'catalog/editions/cc0-beethoven-gottes-macht-op48-5'
        score = json.loads((directory / 'score.json').read_text(encoding='utf-8'))
        retained = json.loads(score['source']['content'])
        original = ET.fromstring(retained['files']['original.mscx']['content'])
        self.assertEqual(original.get('version'), '2.06')
        music = original.find('Score')
        self.assertEqual(music.findtext('Division'), '480')
        self.assertEqual([[s.get('id') for s in p.findall('Staff')] for p in music.findall('Part')], [['1'], ['2', '3']])
        # Numeric spelling facts from the official MuseScore v3.6.2 TPC enum.
        # This is an independent comparison of this one pinned MSCX subset, not a runtime importer.
        tpc = {13: ('F', 0), 14: ('C', 0), 15: ('G', 0), 16: ('D', 0),
               17: ('A', 0), 18: ('E', 0), 19: ('B', 0), 20: ('F', 1), 22: ('G', 1)}
        semitones = dict(C=0, D=2, E=4, F=5, G=7, A=9, B=11)
        durations = {'whole': Fraction(4), 'half': Fraction(2), 'quarter': Fraction(1), 'eighth': Fraction(1, 2)}
        lanes = {'1': ('P1', 1, '1'), '2': ('P2', 1, '1'), '3': ('P2', 2, '5')}
        source, starts, stops = Counter(), {}, {}
        for staff in music.findall('Staff'):
            part, number, voice = lanes[staff.get('id')]
            for unsupported in ['voice', 'tick', 'move', 'Tuplet', 'startRepeat', 'endRepeat', 'RepeatMeasure', 'KeySig']:
                self.assertEqual(staff.findall('.//' + unsupported), [])
            self.assertEqual(len(staff.findall('Measure')), 18)
            self.assertEqual([(n.findtext('sigN'), n.findtext('sigD')) for n in staff.findall('.//TimeSig')], [('2', '2')])
            for index, measure in enumerate(staff.findall('Measure')):
                self.assertEqual(measure.attrib, {'number': str(index + 1)})
                cursor = Fraction(0)
                for child in measure:
                    self.assertIn(child.tag, ['Chord', 'Rest', 'Clef', 'TimeSig', 'Tempo', 'BarLine', 'LayoutBreak', 'Dynamic'])
                    if child.tag not in ['Chord', 'Rest']:
                        continue
                    kind = child.findtext('durationType')
                    if kind == 'measure':
                        self.assertEqual(child.tag, 'Rest')
                        self.assertEqual(child.find('duration').attrib, {'z': '1', 'n': '1'})
                        duration = Fraction(4)
                    else:
                        duration = durations[kind] * sum((Fraction(1, 2 ** n) for n in range(int(child.findtext('dots', '0')) + 1)), Fraction(0))
                    at = Fraction(4 * index) + cursor
                    for note in child.findall('Note') if child.tag == 'Chord' else [None]:
                        pitch, start, stop = None, False, False
                        if note is not None:
                            step, alter = tpc[int(note.findtext('tpc'))]
                            shifted = int(note.findtext('pitch')) - semitones[step] - alter
                            self.assertEqual(shifted % 12, 0)
                            pitch = (step, alter, shifted // 12 - 1)
                            start, stop = note.find('Tie') is not None, note.find('endSpanner') is not None
                            if start:
                                identity = note.find('Tie').get('id')
                                self.assertNotIn(identity, starts)
                                starts[identity] = (part, number, pitch, at + duration)
                            if stop:
                                identity = note.find('endSpanner').get('id')
                                self.assertNotIn(identity, stops)
                                stops[identity] = (part, number, pitch, at)
                        source[(part, str(at), str(duration), pitch, voice, number, start, stop)] += 1
                    cursor += duration
                self.assertEqual(cursor, 4, (staff.get('id'), index + 1))
        self.assertEqual(starts, stops)
        self.assertEqual(len(starts), 6)
        self.assertEqual(sum(source.values()), 226)
        self.assertEqual(sum(count for event, count in source.items() if event[3] is None), 22)
        self.assertEqual(source, prepare.canonical_written_inventory({'score': score}))
        self.assertEqual(prepare.written_event_inventory(retained['files']['import.musicxml']['content']), source)
        self.assertEqual(music.find('.//Tempo/tempo').text, '2.33333')
        self.assertEqual(Fraction('140') - Fraction('2.33333') * 60, Fraction(1, 5000))
        self.assertEqual(score['tempo'], [{'at': {'denominator': 1, 'numerator': 0}, 'bpm': 140.0}])
        self.assertEqual(score['keys'], [{'at': {'denominator': 1, 'numerator': 0}, 'fifths': 0, 'mode': 'unknown'}])
        self.assertEqual(score['meters'], [{'at': {'denominator': 1, 'numerator': 0}, 'denominator': 2, 'numerator': 2}])
        self.assertEqual(score['repeats'], [])
        self.assertEqual([(m['number'], Fraction(m['at']['numerator'], m['at']['denominator']), Fraction(m['length']['numerator'], m['length']['denominator'])) for m in score['measures']], [(n, Fraction((n - 1) * 4), Fraction(4)) for n in range(1, 19)])
        self.assertEqual(set(retained['files']), {'original.mscx', 'converter.musicxml', 'import.musicxml', 'reference.mid', 'source-1.png'})
        normalized, changes = prepare.normalize_converted_xml(retained['files']['converter.musicxml']['content'].encode())
        self.assertEqual(normalized, retained['files']['import.musicxml']['content'])
        self.assertEqual(changes, retained['provenance']['normalizations'][:1])


if __name__ == '__main__':
    unittest.main()
