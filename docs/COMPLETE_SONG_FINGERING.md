# Complete-song fingering clocks

Saved semantic MIDI and explicitly selected VSQ base-note practice use the
native package clock for advisory piano and guitar plans. Generic score plans
continue using `/api/fingering/piano` and `/api/fingering/guitar`.

The native routes are `POST /api/library/fingering/piano` and
`POST /api/library/fingering/guitar`. Both accept:

```json
{
  "source": {
    "key": "song-<native content hash>",
    "content_sha256": "<native content hash>",
    "profile": "wmh-vsq-clean-v1",
    "choice": "base_notes_instrumental"
  },
  "settings": {
    "part_id": null,
    "profile": {"kind": "piano", "key_count": 88, "lowest_midi": 21},
    "locks": []
  }
}
```

Semantic MIDI uses profile `wmh-semantic-midi1-v1` and `choice: null`. Settings
retain the existing planner's hand ranges, reach, locks, fret span, exact phrase
scope and inventory-only options; they cannot supply a score or timeline.
Guitar settings additionally accept `selected_part_ids` with `part_id:null` for
an exact human-part union, including native All. It is normalized in source order
and echoed by both the inventory and plan. Empty, duplicate, unknown, explicit
null and conflicting legacy selections are rejected. Absent-field legacy piano
and guitar requests retain their previous contracts. Both native guitar request
phases use the same source-bound union and original occurrence identities.
The response is `{source, plan}`, where `source` identifies the saved package
and explicit interpretation and `plan` retains the existing planner contract.

Native loading validates the saved complete package under the library lock.
The opaque Rust `FingeringSource` can only be constructed through canonical
compilation or a validated complete-MIDI/explicit-VSQ compiler. VSQ runtime
admission and fingering share the same compilation projection. The existing
solvers receive that compilation before search, so their movement costs and
output times use its native clock. Held-note occupancy, ties, unisons, locks and
phrase membership still use exact written coordinates and original identities.

Guitar scope boundaries use exact semantic microseconds and, for VSQ, subtract
the native PreMeasure origin before conversion to milliseconds. A phrase boundary
before practice time zero is rejected with an explicit error. The original
whole-selection path, search limits and no-partial-plan behavior remain intact.
The shared semantic-clock bounds also apply to arbitrary phrase coordinates.

Frontend requests require an admitted song object and its current compilation.
VSQ requires the explicit base-note practice runtime. Every reply must match the
source envelope and the existing strict score/part/instrument/settings/lock and
timeline checks. A new load or choice invalidates in-flight and cached plans.
An unsupported or missing-notation package never falls back to generic score
planning or acquires fabricated targets.

The compilation represents intervals as `start_ms` and `duration_ms`. Existing
strict plan checks require `end_ms == start_ms + duration_ms`; this may differ by
one binary64 step from the separate playback runtime's original endpoint after
subtraction/addition. Exact source occupancy and runtime rational endpoints stay
unchanged. No JavaScript offset, epsilon or quantization is used.

Both routes share the native large-operation admission gate, request limits,
32 MiB response envelope limit, and existing planner 8 MiB output/search limits.
Recommendations remain bounded heuristics, not global or biomechanical optima.
MIDI input does not verify hands, fingers, strings or independent voice releases.

Original synthetic tests cover PreMeasure, unusual microseconds-per-quarter,
multiple tempo changes, binary64 endpoint reconstruction, source binding,
constraints, infeasibility, scope inventories, stale requests and unchanged
saved bytes. Browser/Windows packaging and private-song checks are separate
acceptance evidence; passing these tests does not certify those stages.
