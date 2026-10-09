# Read-only source instrument details

Instrument disclosure is optional information, not a runtime, ownership plan,
verified instrument classification, or authorization to adapt a part. A missing
or unsupported disclosure must not prevent existing practice from loading.

## Requests

All routes are POST with `application/json`. Stateless routes are shared by the
loopback HTTP server and native desktop dispatcher:

- `/api/source-instrument-details/canonical`: the **original Score object** as
  the whole request body, with retained `midi-base64` source bytes.
- `/api/source-instrument-details/basic`: the complete Basic compact wire JSON
  as the whole request body, not its canonical practice projection.
- `/api/library/source-instrument-details`: native-only saved source request
  `{"source":{"key":"song-…","content_sha256":"…","profile":"…","choice":null,"runtime_policy":"…"}}`.
  The descriptor is the existing original native practice source descriptor.
  It reloads the verified saved source; it accepts neither paths nor caller
  runtimes, pitch configuration, selection, or cached instrument details.

Native supports retained-MIDI canonical sources and complete Basic packages.
Other sources are explicitly unsupported. The current source profile, explicit
choice and original runtime policy must match; pitch-modified receipt policies
are not original source policies.

## Response

Stateless success: `{"request_sha256":"…", "details": SourceInstrumentDetails}`.
Native success: `{"source": <verified request descriptor>, "details": SourceInstrumentDetails}`.

`request_sha256` is the lowercase hexadecimal SHA-256 of the exact raw JSON
request body bytes, including whitespace and property order. It is computed
from the received byte slice, not a reserialized score. Snapshot the outgoing
JSON once and verify this echo before accepting a delayed response. It is a
transport correlation check, not a source receipt or replacement for the core
binding. The native saved-source envelope is unchanged and uses its separately
verified `source` descriptor. Error envelopes never include a request digest.

The details serialize the score-core disclosure directly. Match its complete
`source_binding`, including format/version/domain/hash, before reuse. Native's
saved content descriptor is separate: its package hash does not replace the
Basic compact-wire binding. Do not hash rounded renderer data or reuse details
based on a title, part name or pitch Mod's effective score.

Details retain source track names, instrument/program names, logical routing,
channel and numeric bank/program declarations, event coordinates and exact
source PPQ tick/beat positions, per-part source attacks/notated counts and key
ranges. All names are untrusted plain text. Numeric program declarations do not
prove a General MIDI instrument. `instrument_namespace` is `unknown`. No
renderer sound, default piano, or part display name supplies missing evidence.

Canonical retained bytes are verified against their musical projection. Basic
has validated complete event metadata with **declared provenance only**, not
independent possession or verification of original MIDI bytes. Missing programs,
invalid declarations, simultaneous ambiguity, and uninterpreted sound events
remain explicit.

## Failures and bounds

Failures have non-200 status and a structured `code`/`error`, never partial
`details`. `unsupported_source_profile` and `source_projection_mismatch` are 422;
malformed stateless request is 400 `source_instrument_invalid_request`. Native
uses existing library request/identity errors. Request size is 8 MiB. Stateless
responses have the existing 16 MiB complete-response bound; native responses
have the existing 32 MiB bound. Over-budget responses are 413 and do not truncate
names, events, parts or source IDs.

Do not persist or send details back as trusted source state. After a pitch Mod,
request against the unchanged original source or reuse only its matching bound
response. This API does not modify score bytes, save a sidecar, compile a new
instrument assignment or change eligibility.

## Separate informational GM identity

Identity is an independent, optional disclosure. The numeric routes above keep
exactly their existing envelopes, errors and `instrument_namespace: "unknown"`.
No identity result changes eligibility, raw MIDI-key practice, background sound,
score import, runtime compilation, pitch Mods, ownership, assistance or scoring.
`known_unsupported` grants no cross-instrument adaptation. `unresolved` grants
neither an instrument label nor a new blanket prohibition on existing practice.

- `POST /api/source-identity/basic`: the original, complete Basic compact wire
  JSON as the whole body, with exact `application/json` media type (parameters
  such as `charset=utf-8` are accepted). Returns
  `{"request_sha256":"…","details":SourceIdentityDisclosure}`. The digest is
  SHA-256 of the exact received bytes, including whitespace and property order;
  callers must compare the snapshot of their outgoing bytes before display.
- `POST /api/library/source-identity`: native-only, the same strict original
  saved `{"source":{…}}` descriptor used by numeric disclosure. Returns
  `{"source":<verified descriptor>,"details":SourceIdentityDisclosure}`. The
  shared saved-source verifier reloads the current source and independently
  checks its backup, package hash, profile, explicit choice and original runtime
  policy. It does not use the runtime/assistance loader or its admission limits.

Only complete Basic MIDI is admitted. There is no canonical identity route and
no implicit canonical-to-Basic conversion. A valid saved canonical or another
saved profile fails the native identity request with 422 `non_basic_profile`.
Malformed stateless JSON, non-Basic wire input, unknown fields and caller-supplied
cached identity fail with 400 `source_identity_invalid_request`. Native retains
the existing strict library request and descriptor errors, including rejection
of missing `choice`, stale descriptors, pitch policies and extra fields. Errors
never include `details` or an authoritative success envelope.

`details` is the analyzer's serialize-only, private-field output. Its revision,
analysis-policy ID, identity-table revision and provisional product-policy ID
remain distinct. Its `source_binding` uses the original Basic compact-wire
serialization domain/revision/hash, not the native package digest or declared
original MIDI SHA-256. Basic provenance remains `declared_provenance_only`.
Route evidence, epochs, original per-attack snapshots, per-part counts, mixed
summaries and diagnostics are preserved without reinterpretation. Labels and
source names are plain text; a renderer must never infer identity from numeric
programs, selected sound, part name or a chosen practice instrument. The GM
identity table and provisional product policy are intentionally separate and
limited; `supported` is not proof of physical playability or acoustic fidelity.

Identity has its own complete-output failure path. Requests retain the adapter's
8 MiB bound. The analyzer's 32 MiB budget fails with 413 `analysis_limit`; the
complete stateless envelope retains the lower 16 MiB bound, and the complete
native saved-source envelope retains 32 MiB, including descriptor overhead.
Envelope overflow fails with 413 `source_identity_response_limit`, never a
truncated or apparently complete identity. An identity budget failure does not
alter numeric disclosure, source bytes, saved files or practice. Consumers can
continue presenting numeric details independently when identity is unavailable.
Neither disclosure is persisted as trusted state or accepted back as authority.

### Current Mod display consumer

The admitted frontend Basic package currently uses a verified `native:song-…`
identity; there is no browser-only Basic-package admission path in this slice.
The Mod display therefore calls the saved-source identity route. The stateless
route remains independently available for complete compact-wire API callers and
is not used to reinterpret a browser's canonical MIDI score as Basic.

Opening Mod starts two independent optional requests. Identity is cached by the
original immutable package, including failures, and never by song or part IDs
alone. Closing, reopening, pitch shifting or redrawing reuses that package's
entry. A delayed response must match the exact saved descriptor, original MIDI
provenance, Basic profile and complete binding shape/domain/revision; it must
also match the policy/table revisions and every source attack coordinate, part,
route and aggregate count. The renderer checks compact source event references;
it does not reconstruct the Rust wire digest from JavaScript numbers. It builds
one per-source identity index and does not scan attacks on frames or redraws.

Known names come only from Rust's reviewed table. This version recognizes six
GM1/base entries, two GM2 melodic variants, generic GM1 percussion and one GM2
kit. Other entries, including otherwise valid unreviewed programs, stay
unresolved. File instrument-name metadata is a separate literal declaration.
Collapsed summaries and paginated details show mixed identities and known and
unresolved attack counts, including zero-attack parts; all labels, errors and
source text are bounded and rendered as text in both interface locales. These
facts are informational and never flow into activity labels, playback,
assignment, input policy or scoring.
