# Original-instrument Human admission for Basic MIDI

This policy excludes only source attack IDs classified as known unsupported by
`wmc-basic-known-unsupported-human-exclusion-v1`. Missing General MIDI declarations,
unreviewed banks/programs and other successfully analyzed unresolved attacks keep
their existing raw-key compatibility. It adds no GM mappings, pitch changes,
cross-instrument adaptation, inferred timbres or automatic assistance.

## Native contract

`POST /api/library/practice-admission` is a native-library operation, including
through the owned hosted-browser bridge. The closed request contains:

- `source`: the existing strict saved-source descriptor (key, package SHA,
  profile, explicit choice and original runtime policy)
- `pitch_mod`: required configuration, including explicit zero semitones
- `selection`: exact selected part IDs and physical device profile
- optional `plan`: an already explicitly selected assistance plan

The verified loader reloads original saved bytes, checks their current package
identity and constructs the immutable PracticeSource. It computes original
eligibility before projecting pitch. Neither a caller timeline, path, cached
identity, excluded-ID list nor a caller fingerprint can authorize this operation.
Original means every original attack in the selected parts. Any excluded Human
source ID rejects the entire assignment. Explicit assistance may assign complete
indivisible groups to Machine; it never splits a full-source assistance atom.
Unassisted Original groups only its complete selected Human scope, preserving
prior solo practice when an unselected Machine part has a coincident note.
Original, create, validate and progression all enforce the same final Human-ID
rule.

The response contains the existing `source` and `checked` assignment, plus the
existing pitch identity for nonzero projection. Basic runtime receipts require
`source_eligibility`, including the original compact-wire binding, current
analysis/table/product/eligibility policy IDs and a separately domain-bound
fingerprint of the complete native exclusion inventory and part counts. The
checked plan's selection digest binds the actual final Human IDs and profile.

Package SHA, compact-wire source digest, complete-serde PracticeSource digest,
effective runtime digest, eligibility fingerprint and assignment digest have
separate domains. Opaque browser intent/session tokens only fence races.

## Rendering and migration

Complete source bytes, rendition gates and reference audio are unchanged.
The optional compact runtime summary carries one count row per part and no
excluded-attack list. If analysis fails, it reports unavailable. If this optional
summary alone would push a response over an existing byte cap, only that summary
is omitted; a previously fitting complete reference response remains available.
The mandatory source-bound receipt cannot be omitted or partially returned.

Fresh untouched setup selects the first nonempty wholly eligible part in source
order, including unresolved-only parts. If none is available, it defaults to
all-Machine Listen. Saved preferences and open drafts are retained unchanged;
rejected Human assignments have an explicit Machine/Listen repair through Mod.
Old Basic receipts must revalidate. Missing fields never mean Human approval.

The archived `wmh-basic-key-practice-v1` files in consumer tests are runtime
responses, not a separate saved music format. Accepted 727 already regenerated
`wmh-basic-key-practice-v2` from unchanged Basic package bytes on native load.
The authoring mock now uses its existing paired v2 response, with the same source
SHA and all three original attacks; it retains positive save/practice/reopen
coverage. A separate archived-response test has no current native proof and
stays inspectable. No v1 profile blacklist was added: complete matching targets
may still pass a fresh source-bound native check. Incomplete old projections
cannot authorize missing attacks. Reopen the same saved song in the current
native app to regenerate its runtime and receipt; no source conversion,
replacement, or note deletion is needed.

Optional detailed identity errors, 404/413 responses and delayed labels cannot
change ownership or authority. Canonical imports keep their existing path.

The browser checks the native assignment against every original source occurrence
and validates physical strike groups separately. It admits an immutable token,
fences asynchronous completion, rechecks before committing ownership/session
state, and guards capture, live synthesis, take creation and scoring. Muting,
hiding, changing timbre, range repair or assistance Off cannot bypass admission.
AudioContext unlock may run on the user's gesture before an await; playback and
recording remain behind the current admission.

## Validation boundary

New Rust tests use original CC0 fixtures, including program changes, held and
zero-length attacks, missing GM, both unison representative orders, 3 original
attacks versus 2 physical groups, forged/stale/missing receipts, native reload
and exact response byte boundaries. No private music is included.

JavaScript consumer and mocked DOM tests are explicitly identified as mocks.
They are not native or browser acceptance. The existing CI-only source-identity
hosted proof now checks real native Human rejection, draft preservation,
all-Machine complete listening, restart/reload and unresolved practice across
optional metadata failures. Real Rust fixture regeneration, full Rust/fmt/clippy,
real Chromium and Windows/native acceptance remain required before promotion.
