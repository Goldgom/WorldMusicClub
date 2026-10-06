# Original VSQ authoring focused acceptance

This isolated acceptance slice starts at commit
`7758c78a04d3aedf4f436e8f480ea7ab80ec7e02`, which combines the audited VSQ draft
backend and authoring UI with the existing MIDI authoring/profile acceptance.
It changes acceptance harnesses, fixtures, tests and documentation only. The
current MIDI validation source and its final promotion/package gates remain
unchanged. Preparing this slice does not establish browser or Windows success.

## Original source and exact response contract

The single picker file is `authoring-original.vsq`, materialized solely from
`tests/fixtures/song-authoring/vsq-request.json`. This original synthetic C/E
exercise has four raw SMF tracks and 152 events, separate from three logical
vocal parts and two authored notes. One vocal part is muted; another contains no
notes. Both remain in authoring inventory, clean metadata/score bytes and the
explicitly chosen practice runtime. Raw channel records never imply vocal
routing. The split CP932 lyric, singer descriptors, expression curves, mixer
flags, rational timing and large integer token `9007199254740993` remain intact.

`acceptance-vsq-{draft,opened,runtime}.json` are actual Rust stdio responses,
with only their outer JSON pretty-printed. Embedded metadata/score strings are
compared exactly; they are never parsed and reserialized into replacement
canonical bytes. The adjacent provenance binds original request bytes, capture
basis/tree, driver, output hashes and normalized display filename/title.
The capture had uncommitted acceptance harness work; it is a fixture oracle,
not an exact clean-source or final executable acceptance claim. The package
keeps the application's user-supplied/unverified rights metadata; the original
fixture's CC0 provenance does not manufacture a rights claim in the package.

The old `vsq-song` scenario imports a previously prepared clean ZIP. This new
`vsq-authoring` scenario starts at the actual MIDI/VSQ authoring file chooser and
uses the real draft, pack, preview and save routes. The existing `authoring`
scenario continues to cover the separate standard MIDI profiles, unsupported
controller rejection, retitle, duplicate and explicit keep-both behavior.

## Actual UI route and independent admission

Seed and restart run as `vsq-authoring-seed` and `vsq-authoring-restart`:

1. Seed demonstrates a running built-in Listen session becoming paused through
   actual navigation, then selects the original VSQ using the owned chooser
2. Review shows the whole raw and logical inventory in English and Chinese,
   including muted and note-free parts, without persistence or new audio
3. A built-in human Play/KeyR/Pause take establishes the baseline after chooser
   blur is finished. With sound enabled, an explicit VSQ Save, complete export,
   authoring key and settings key must preserve that entire take and input state
4. Show in song library exposes the explicit interpretation choice. Saving,
   browsing, choosing the projection and fresh loading do not start audio or
   resume the paused session. Original vocal rendering remains unavailable
5. Only the trusted base-note instrumental choice requests the exact native
   runtime. The post-choice snapshot waits for the same saved source and consumed
   runtime, with visible Start and Mod enabled after compatibility admission.
   Preview `ready` and enabled Mod alone are insufficient while the asynchronous
   target/instrument check is pending. All-machine Mod and unified Start then
   exercise Listen; Play after Reset follows its sounding interval, release gap,
   declared tail and final readout. This observes source scheduling, not physical
   audibility or original vocals
6. A reload requires the choice again. Normal process close precedes a fresh
   browser profile/process against the same Scores library; restart rechecks
   every stored metadata/score string and independently repeats the choice flow

The native picker admits one exact ordinary file, retains owned HWND/readback/
dismissal checks and hashes actual selected File bytes. There are no expanded
path or wildcard aliases. Actions remain the existing finite click/picker/KeyR
set and 64-action bound; phase-qualified downloads retain the 1–16 limit.
Independent Node verification binds trusted gestures, consumed responses, golden
package/runtime bytes, saved primary/backup files, retained ZIPs, snapshots,
profiles and real PNG screenshots. A separate Python manifest rechecks the
source SHA/tree, executable bytes/hash, closed claim set and proof file hashes.

## Authorized run and limits

`preview/vsq-authoring` or an explicit dispatch of
`.github/workflows/vsq-authoring-preview.yml` runs both focused environments on
one exact clean SHA/tree. Hosted Chromium uses real Rust stdio and covers
1280×720, 1280×900 and 1920×1080 with fresh contexts. Windows uses the real owned
OS picker, separate atomic profiles, the same native Scores folder and normal
close. Both retain actual Chinese raw-track and vocal-part screenshots plus
choice/notation views. Review those images from the successful exact-source run.

The no-listener local precheck is:

```
WMH_NATIVE_IMPORT_DRIVER=<exact-source-driver> \
WMH_VSQ_AUTHORING_REPORT=<receipt.json> node scripts/check-vsq-authoring-native.mjs
```

Local unit tests and stdio cannot substitute for hosted/Windows GUI evidence.
No local browser, server or GUI is required or authorized by this slice.
Unsupported semantics, response/score/source size bounds, scoring, original-vocal
and permission guards are unchanged. No private VSQ or private clean package is
included in this repository or uploaded by its CI.

This focused workflow neither publishes nor accepts a package. Before promotion,
the same final combined SHA/tree/EXE must still pass the full Rust workspace,
Node, formatting/clippy, real-browser, existing Windows/native and extracted
package gates. The full native workflow now also runs these original VSQ authoring
checks and requires their exact source/EXE/report/profile proof and focused manifest
in the candidate ZIP. This requirement preserves the focused evidence scope; it
does not turn a standalone focused run into release acceptance.
