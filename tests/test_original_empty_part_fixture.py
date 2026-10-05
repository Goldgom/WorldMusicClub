"""Pure source/response proof; never starts a server or accesses a user library."""
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/generate-original-empty-part.py'
SPEC = importlib.util.spec_from_file_location('original_empty_part', SCRIPT)
GENERATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GENERATOR)


class OriginalEmptyPartFixture(unittest.TestCase):
    def test_authored_bytes_and_complete_native_response_chain(self):
        directory = ROOT / 'tests/fixtures'
        provenance = json.loads((directory / 'original-active-and-empty-provenance.json').read_bytes())
        source = (directory / provenance['source_file']).read_bytes()
        fixture = (directory / provenance['fixture_file']).read_bytes()
        trace_bytes = (directory / provenance['native_protocol_trace']).read_bytes()
        self.assertEqual(source, GENERATOR.original_source())
        self.assertEqual(provenance['original_authored'], True)
        self.assertEqual(provenance['license'], 'CC0-1.0')
        for field, data in [('source_sha256', source), ('fixture_sha256', fixture),
                            ('generator_sha256', SCRIPT.read_bytes()),
                            ('native_protocol_trace_sha256', trace_bytes)]:
            self.assertEqual(provenance[field], hashlib.sha256(data).hexdigest())
        proof = GENERATOR.verify_trace(json.loads(trace_bytes), fixture)
        for field, value in proof.items():
            self.assertEqual(provenance[field], value)
        with self.assertRaises(AssertionError):
            GENERATOR.verify_trace(json.loads(trace_bytes), fixture + b' ')


if __name__ == '__main__':
    unittest.main()
