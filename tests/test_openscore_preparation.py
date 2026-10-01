import importlib.util
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
        self.assertTrue(all(s['status'] == 'conversion_and_review_pending' for s in manifest['scores']))

    def test_normalization_keeps_raw_input_and_declares_exact_vendor_header_removal(self):
        raw = b'<?xml version="1.0"?>\n<!DOCTYPE score-partwise  PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n<score-partwise/>'
        text, changes = prepare.normalize_converted_xml(raw)
        self.assertIn(b'<!DOCTYPE', raw)
        self.assertNotIn('<!DOCTYPE', text)
        self.assertEqual(len(changes), 1)
        self.assertEqual(prepare.normalize_converted_xml(b'<score-partwise/>'), ('<score-partwise/>', []))

    def test_converter_cancellation_owns_the_process_group(self):
        process = MagicMock(); process.pid = 12345; process.poll.return_value = None
        with TemporaryDirectory() as temporary:
            folder = Path(temporary)
            with patch.object(prepare.subprocess, 'Popen', return_value=process) as launch, patch.object(prepare.time, 'monotonic', side_effect=[0, 121]), patch.object(prepare.os, 'killpg') as cancel:
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
