import importlib.util
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch
from tempfile import TemporaryDirectory

spec = importlib.util.spec_from_file_location('prepare', Path(__file__).parents[1] / 'scripts/prepare-openscore-candidates.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class OpenScorePreparationTests(unittest.TestCase):
    def test_committed_candidates_have_pinned_sources_and_explicit_cc0(self):
        manifest = json.loads(prepare.MANIFEST.read_text(encoding='utf-8'))
        prepare.validate_manifest(manifest)
        self.assertEqual(len(manifest['scores']), 4)
        self.assertEqual(manifest['converter']['sha256'], 'c59a41ee88bc7c565a939b9c73498ac0451bbd86574e95cb6e359302c1465290')
        self.assertEqual(sum(s['status'] == 'held' for s in manifest['scores']),3)
        self.assertEqual(sum(s['status'] == 'conversion_and_review_pending' for s in manifest['scores']),1)

    def test_normalization_keeps_raw_input_and_declares_exact_vendor_header_removal(self):
        raw = b'<?xml version="1.0"?>\n<!DOCTYPE score-partwise  PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n<score-partwise/>'
        text, changes = prepare.normalize_converted_xml(raw)
        self.assertIn(b'<!DOCTYPE', raw)
        self.assertNotIn('<!DOCTYPE', text)
        self.assertEqual(len(changes), 1)
        self.assertEqual(prepare.normalize_converted_xml(b'<score-partwise/>'), ('<score-partwise/>', []))

    def test_candidate_states_cannot_silently_become_admitted_or_have_empty_refusals(self):
        manifest = json.loads(prepare.MANIFEST.read_text(encoding='utf-8'))
        missing = copy.deepcopy(manifest)
        missing['scores'][0]['expected_import_error'] = ''
        with self.assertRaisesRegex(ValueError, 'Held candidates require'):
            prepare.validate_manifest(missing)
        unexpected = copy.deepcopy(manifest)
        unexpected['scores'][0]['status'] = 'admitted'
        with self.assertRaisesRegex(ValueError, 'explicit held or pending'):
            prepare.validate_manifest(unexpected)

    def test_held_work_never_auto_enters_catalog_and_unexpected_results_fail(self):
        held = {'status':'held','expected_import_error':'Grace notes are unsupported'}
        result = {'pitch_inventory_matches':True,'rust_import_status':400,'import_error':{'error':'Part P1: Grace notes are unsupported'}}
        self.assertTrue(prepare.candidate_gate(held,result))
        self.assertFalse(prepare.candidate_gate(held,{**result,'rust_import_status':200}))
        self.assertFalse(prepare.candidate_gate(held,{**result,'pitch_inventory_matches':False}))
        self.assertFalse(prepare.candidate_gate(held,{**result,'import_error':{'error':'Unexpected parser regression'}}))
        self.assertFalse(prepare.candidate_gate({'status':'conversion_and_review_pending'},{'pitch_inventory_matches':True,'rust_import_status':200,'import_diagnostics':[{'code':'broken_tie'}]}))

    def test_written_gate_distinguishes_rhythm_voice_and_ties_beyond_pitch_counts(self):
        xml='<score-partwise><part id="P1"><measure><attributes><divisions>3</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>2</voice><tie type="start"/></note><note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>2</voice><tie type="stop"/></note></measure></part></score-partwise>'
        beat=lambda n,d=1:{'numerator':n,'denominator':d}
        note=lambda at,duration,start,stop:{'at':at,'duration':duration,'pitch':{'step':'C','alter':0,'octave':4},'voice':'2','staff':1,'tie_start':start,'tie_stop':stop}
        compiled={'score':{'parts':[{'id':'P1','notes':[note(beat(0),beat(1,3),True,False),note(beat(1,3),beat(2,3),False,True)]}]}}
        self.assertEqual(prepare.written_event_inventory(xml),prepare.canonical_written_inventory(compiled))
        compiled['score']['parts'][0]['notes'][1]['at']=beat(1,2)
        self.assertNotEqual(prepare.written_event_inventory(xml),prepare.canonical_written_inventory(compiled))

    def test_reference_metrics_keep_onset_duration_and_extra_notes_distinct(self):
        canonical={'score':{},'timeline':{'notes':[{'id':'n1','midi':60,'start_ms':0,'duration_ms':1000}],'duration_ms':1000}}
        reference={'score':{'tempo':[]},'timeline':{'notes':[{'midi':60,'start_ms':0,'duration_ms':900},{'midi':62,'start_ms':900,'duration_ms':100}],'duration_ms':1000},'diagnostics':[]}
        grade={'hits':[{'note_id':'n1','midi':60,'actual_ms':0,'delta_ms':0}],'misses':[],'extras':[{}]}
        report=prepare.reference_agreement(canonical,reference,grade)
        self.assertEqual(report['matches_within_1ms'],1); self.assertEqual(report['extra_reference_attacks'],1)
        self.assertEqual(report['duration_differences_over_1ms'],1); self.assertEqual(report['largest_duration_difference_ms'],100)

    def test_converter_cancellation_owns_the_process_group(self):
        process = MagicMock(); process.pid = 12345; process.poll.return_value = None
        with TemporaryDirectory() as temporary:
            folder = Path(temporary)
            with patch.object(prepare.subprocess, 'Popen', return_value=process) as launch, patch.object(prepare.time, 'monotonic', side_effect=[0, 121]), patch.object(prepare.os, 'killpg', create=True) as cancel, patch.object(prepare.signal, 'SIGKILL', 9, create=True):
                with self.assertRaisesRegex(RuntimeError, 'runtime/log/output'):
                    prepare.run_bounded(['fixed-converter', '--version'], folder, {}, folder / 'log')
                self.assertTrue(launch.call_args.kwargs['start_new_session'])
                cancel.assert_called_once_with(12345, prepare.signal.SIGKILL)
                process.wait.assert_called_once_with(timeout=5)

    def test_source_and_musicxml_pitch_inventories_keep_chord_duplicates(self):
        mscx = b'<museScore><Score><metaTag name="copyright">OpenScore (CC0)</metaTag><Staff><Measure><voice><Chord><Note><pitch>60</pitch></Note><Note><pitch>60</pitch></Note><Note><pitch>63</pitch></Note></Chord></voice></Measure></Staff></Score></museScore>'
        xml = '<score-partwise><part><measure><note><pitch><step>C</step><octave>4</octave></pitch></note><note><chord/><pitch><step>C</step><octave>4</octave></pitch></note><note><pitch><step>E</step><alter>-1</alter><octave>4</octave></pitch></note><note><rest/></note></measure></part></score-partwise>'
        expected = prepare.source_pitch_inventory(mscx)
        self.assertEqual(expected, prepare.xml_pitch_inventory(xml))
        self.assertEqual(expected[60], 2)


if __name__ == '__main__':
    unittest.main()
