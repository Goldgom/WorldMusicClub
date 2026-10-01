import importlib.util
import copy
from contextlib import ExitStack
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
        self.assertEqual(len(manifest['scores']), 5)
        self.assertEqual(manifest['converter']['sha256'], 'c59a41ee88bc7c565a939b9c73498ac0451bbd86574e95cb6e359302c1465290')
        self.assertEqual(sum(s['status'] == 'held' for s in manifest['scores']),3)
        self.assertEqual(sum(s['status'] == 'conversion_and_review_pending' for s in manifest['scores']),2)

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

    def test_raw_key_observation_keeps_tempo_changes_and_refuses_ambiguous_noteoffs(self):
        event = lambda tick, kind: {'tick': tick, 'port': 0, 'channel': 0, 'midi': 60, 'velocity': 90, 'kind': kind}
        observation = {'ticks_per_quarter': 480, 'final_tick': 960,
                       'tempo_events': [{'tick': 0, 'microseconds_per_quarter': 500000}, {'tick': 480, 'microseconds_per_quarter': 1000000}],
                       'note_messages': [event(0, 'on'), event(960, 'off')],
                       'non_note_messages': [{'controller': 64, 'value': 127}], 'interpretation': 'Keys only'}
        result = prepare.observed_key_reference(observation)
        self.assertEqual(result['timeline']['notes'][0]['duration_ms'], 1500)
        self.assertEqual(result['non_note_messages'], observation['non_note_messages'])
        observation['note_messages'] = [event(0, 'on'), event(1, 'on'), event(480, 'off'), event(960, 'off')]
        ambiguous = prepare.observed_key_reference(observation)
        self.assertEqual(ambiguous['unpaired_or_ambiguous_key_durations'], 2)
        self.assertTrue(all(n['duration_ms'] is None for n in ambiguous['timeline']['notes']))

    def test_source_and_musicxml_pitch_inventories_keep_chord_duplicates(self):
        mscx = b'<museScore><Score><metaTag name="copyright">OpenScore (CC0)</metaTag><Staff><Measure><voice><Chord><Note><pitch>60</pitch></Note><Note><pitch>60</pitch></Note><Note><pitch>63</pitch></Note></Chord></voice></Measure></Staff></Score></museScore>'
        xml = '<score-partwise><part><measure><note><pitch><step>C</step><octave>4</octave></pitch></note><note><chord/><pitch><step>C</step><octave>4</octave></pitch></note><note><pitch><step>E</step><alter>-1</alter><octave>4</octave></pitch></note><note><rest/></note></measure></part></score-partwise>'
        expected = prepare.source_pitch_inventory(mscx)
        self.assertEqual(expected, prepare.xml_pitch_inventory(xml))
        self.assertEqual(expected[60], 2)

    def test_second_candidate_still_uses_input_directory_after_reference_assessment(self):
        xml = '<score-partwise><part id="P1"><measure><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>'
        mscx = '<museScore><Score><metaTag name="copyright">OpenScore CC0</metaTag><Staff><Measure><Note><pitch>60</pitch></Note></Measure></Staff></Score></museScore>'
        beat = lambda value: {'numerator': value, 'denominator': 1}
        note = {'id':'n1','at':beat(0),'duration':beat(1),'pitch':{'step':'C','alter':0,'octave':4},'voice':'1','staff':1,'tie_start':False,'tie_stop':False}
        compiled = {'score':{'parts':[{'id':'P1','notes':[note]}],'tempo':[],'repeats':[]},'timeline':{'notes':[{'id':'n1','source_note_id':'n1','midi':60,'start_ms':0,'duration_ms':500,'velocity':90}],'duration_ms':500},'diagnostics':[]}
        observation = {'ticks_per_quarter':480,'final_tick':480,'tempo_events':[{'tick':0,'microseconds_per_quarter':500000}], 'note_messages':[{'tick':0,'port':0,'channel':0,'kind':'on','midi':60,'velocity':90},{'tick':480,'port':0,'channel':0,'kind':'off','midi':60,'velocity':0}], 'non_note_messages':[],'interpretation':'test keys'}
        manifest = json.loads(prepare.MANIFEST.read_text(encoding='utf-8'))
        manifest['scores'] = [dict(manifest['scores'][2], id='first-study'), dict(manifest['scores'][2], id='second-study')]
        calls = []
        def download(url, path, *args):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(mscx if path.suffix == '.mscx' else 'fixture', encoding='utf-8')
        def run(arguments, cwd, env, log, **kwargs):
            log.parent.mkdir(parents=True, exist_ok=True)
            log.write_text(json.dumps(observation) if 'inspector' in str(arguments[0]) else 'fixture', encoding='utf-8')
            if '--appimage-extract' in arguments:
                target = cwd / 'squashfs-root/AppRun'; target.parent.mkdir(); target.write_text('fixture')
            if '-o' in arguments:
                target = Path(arguments[arguments.index('-o') + 1]); target.write_text(xml if target.suffix == '.musicxml' else 'fixture', encoding='utf-8')
        def post(base, route, *args):
            calls.append(route)
            if route == '/api/import/musicxml': return 200, copy.deepcopy(compiled)
            if route == '/api/import/midi': return 400, {'error':'controller 121'}
            return 200, {'hits':[{'note_id':'n1','midi':60,'actual_ms':0,'delta_ms':0}], 'misses':[], 'extras':[]}
        with TemporaryDirectory() as temporary, ExitStack() as stack:
            folder = Path(temporary); manifest_path = folder / 'manifest.json'; manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
            for owner, name, value in [(prepare,'MANIFEST',manifest_path),(prepare.sys,'platform','linux'),(prepare.sys,'argv',['prepare','--workspace',str(folder/'work'),'--server-binary','server','--reference-inspector','inspector']), (prepare,'download',download),(prepare,'run_bounded',run),(prepare,'post',post)]:
                stack.enter_context(patch.object(owner, name, value))
            stack.enter_context(patch.object(prepare.subprocess, 'Popen', return_value=MagicMock()))
            stack.enter_context(patch.object(prepare.urllib.request, 'urlopen', return_value=MagicMock()))
            self.assertEqual(prepare.main(), 0)
            self.assertEqual(calls.count('/api/assess'), 2)
            report = json.loads((folder/'work/review-artifacts/conversion-report.json').read_text(encoding='utf-8'))
            self.assertEqual([r['id'] for r in report['results']], ['first-study','second-study'])


if __name__ == '__main__':
    unittest.main()
