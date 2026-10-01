import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('comparison', Path(__file__).parents[1] / 'scripts/compare-score-content.py')
comparison = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comparison)


def fixture():
    b = lambda n: {'numerator': n, 'denominator': 1}
    note = {'at': b(0), 'duration': b(1), 'pitch': {'step': 'C', 'alter': 1, 'octave': 4}, 'voice': '1', 'staff': 1, 'tie_start': False, 'tie_stop': False}
    return {'score': {'parts': [{'id': 'p1', 'notes': [note]}], 'tempo': [{'at': b(0), 'bpm': 90}], 'keys': [{'at': b(0), 'fifths': 0, 'mode': 'major'}], 'meters': [{'at': b(0), 'numerator': 4, 'denominator': 4}], 'repeats': []}, 'timeline': {'duration_ms': 2000 / 3, 'notes': [{'part_id': 'p1', 'midi': 61, 'start_ms': 0, 'duration_ms': 2000 / 3}]}}


class ScoreComparisonTests(unittest.TestCase):
    def test_equivalent_rationals_and_imported_ids_do_not_imply_loss(self):
        a = fixture(); b = copy.deepcopy(a)
        b['score']['parts'][0]['notes'][0]['duration'] = {'numerator': 2, 'denominator': 2}
        b['score']['parts'][0]['id'] = 'P1'; b['timeline']['notes'][0]['part_id'] = 'P1'
        self.assertTrue(comparison.compare(a, b)['all_compared_content_matches'])

    def test_enharmonic_spelling_is_distinct_from_sounding_pitch(self):
        a = fixture(); b = copy.deepcopy(a)
        b['score']['parts'][0]['notes'][0]['pitch'] = {'step': 'D', 'alter': -1, 'octave': 4}
        m = comparison.compare(a, b)['metrics']
        self.assertFalse(m['written_pitch_spelling']['matches'])
        self.assertTrue(m['sounding_pitch_inventory']['matches'])

    def test_default_tempo_cannot_hide_behind_correct_notes(self):
        a = fixture(); b = copy.deepcopy(a)
        b['score']['tempo'][0]['bpm'] = 120; b['timeline']['notes'][0]['duration_ms'] = 500
        m = comparison.compare(a, b)['metrics']
        self.assertTrue(m['written_structure']['matches'])
        self.assertFalse(m['tempo']['matches']); self.assertFalse(m['sounding_timing']['matches'])

    def test_duplicate_events_and_rests_are_not_collapsed(self):
        a = fixture(); b = copy.deepcopy(a)
        note = copy.deepcopy(b['score']['parts'][0]['notes'][0]); note['pitch'] = None
        b['score']['parts'][0]['notes'] += [copy.deepcopy(b['score']['parts'][0]['notes'][0]), note]
        m = comparison.compare(a, b)['metrics']
        self.assertEqual(m['written_pitch_spelling']['extra_count'], 1)
        self.assertEqual(m['written_rhythm']['extra_count'], 2)

    def test_voice_aliases_are_reported_separately_from_timing(self):
        a = fixture(); b = copy.deepcopy(a); b['score']['parts'][0]['notes'][0]['voice'] = '5'
        m = comparison.compare(a, b)['metrics']
        self.assertFalse(m['written_structure']['matches']); self.assertTrue(m['written_rhythm']['matches'])

    def test_samples_are_bounded_but_counts_are_complete(self):
        m = comparison.metric(range(30), range(30, 60))
        self.assertEqual(m['missing_count'], 30); self.assertEqual(m['extra_count'], 30)
        self.assertEqual(len(m['missing_sample']), 10)


if __name__ == '__main__':
    unittest.main()
