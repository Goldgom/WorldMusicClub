#!/usr/bin/env python3
"""Compare two Rust compilations for original-fixture OMR/import evaluation.

This is an exact-content regression report, not a calibrated recognition-confidence score.
Input scores must already have passed the Rust compiler. No files are uploaded or executed.
"""
import argparse
from collections import Counter
from fractions import Fraction
import json
from pathlib import Path


def beat(value):
    return str(Fraction(value['numerator'], value['denominator']))


def pitch(value):
    return None if value is None else (value['step'], value['alter'], value['octave'])


def keys(compilation):
    score = compilation['score']
    parts = {part['id']: index for index, part in enumerate(score['parts'])}
    result = {name: [] for name in ['written_pitch_spelling', 'written_rhythm', 'written_structure',
                                  'sounding_pitch_inventory', 'sounding_timing', 'performance_duration', 'tempo', 'key', 'meter', 'measures', 'repeats']}
    for index, part in enumerate(score['parts']):
        for note in part['notes']:
            at, duration, value = beat(note['at']), beat(note['duration']), pitch(note['pitch'])
            if value is not None:
                result['written_pitch_spelling'].append((index, at, value))
            result['written_rhythm'].append((index, at, duration, value is None))
            result['written_structure'].append((index, at, duration, value, note['voice'], note['staff'],
                                                note.get('tie_start', False), note.get('tie_stop', False)))
    for note in compilation['timeline']['notes']:
        part = parts[note['part_id']]
        result['sounding_pitch_inventory'].append((part, note['midi']))
        # Fixed microsecond-of-a-millisecond serialization rounding, not a performance tolerance.
        result['sounding_timing'].append((part, note['midi'], round(note['start_ms'], 6), round(note['duration_ms'], 6)))
    result['performance_duration'] = [round(compilation['timeline']['duration_ms'], 6)]
    result['measures'] = [(m['number'], beat(m['at']), beat(m['length'])) for m in score.get('measures', [])]
    result['tempo'] = [(beat(t['at']), t['bpm']) for t in score['tempo']]
    result['key'] = [(beat(k['at']), k['fifths'], k['mode']) for k in score['keys']]
    result['meter'] = [(beat(m['at']), m['numerator'], m['denominator']) for m in score['meters']]
    result['repeats'] = [(beat(r['from']), beat(r['to']), r['times']) for r in score.get('repeats', [])]
    return result


def metric(expected, actual):
    a, b = Counter(expected), Counter(actual)
    missing, extra = a - b, b - a
    sample = lambda counts: [{'value': key, 'count': count} for key, count in sorted(counts.items(), key=lambda x: repr(x[0]))[:10]]
    return {'matches': a == b, 'expected_count': sum(a.values()), 'actual_count': sum(b.values()),
            'missing_count': sum(missing.values()), 'extra_count': sum(extra.values()),
            'missing_sample': sample(missing), 'extra_sample': sample(extra)}


def compare(expected, actual):
    a, b = keys(expected), keys(actual)
    metrics = {name: metric(a[name], b[name]) for name in a}
    return {'report_version': 1, 'all_compared_content_matches': all(m['matches'] for m in metrics.values()),
            'metrics': metrics,
            'policy': 'Part matching is by explicitly corresponding part order; stable IDs are ignored. Voice labels/staves/ties are strict in written_structure. Sound timing rounds to 0.000001 ms. No note is silently omitted.',
            'recognition_confidence': None,
            'limitations': 'Ground-truth fixture comparison only. No confidence calibration, visual-layout fidelity, title/text/dynamics assessment or automatic approval for a new score.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('expected', type=Path)
    parser.add_argument('actual', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    for path in [args.expected, args.actual]:
        if path.stat().st_size > 32 * 1024 * 1024:
            parser.error('Evaluation compilation JSON exceeds 32 MiB')
    report = compare(json.loads(args.expected.read_text(encoding='utf-8')),
                     json.loads(args.actual.read_text(encoding='utf-8')))
    text = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        args.output.write_text(text, encoding='utf-8')
    else:
        print(text, end='')
    return 0 if report['all_compared_content_matches'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
