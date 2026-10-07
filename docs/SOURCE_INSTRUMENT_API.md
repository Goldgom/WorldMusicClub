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

Stateless success: `{"details": SourceInstrumentDetails}`.
Native success: `{"source": <verified request descriptor>, "details": SourceInstrumentDetails}`.

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
