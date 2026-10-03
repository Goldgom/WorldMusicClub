# Single logical MIDI device routing

MIDI FF09 DeviceName is routing information. It is retained as
`text { role: "device_name", text: <exact name> }` for format compatibility, but
is never accepted as an ignored descriptive cue by a complete-song receiver.
FF08 ProgramName remains a label for a program; neither name proves a bank map,
General MIDI compatibility, original device availability or original timbre.

## Standard and bounded interpretation

[MIDI RP-019, Device Name and Program Name Meta Events](https://amei.or.jp/midistandardcommittee/Recommended_Practice/e/rp19a.pdf)
specifies one DeviceName per track before sendable MIDI events and before
ProgramName, bank-select and program-change events (page1). Tracks may address
the same logical name. The destination on another computer is chosen by its
software/user while preserving those names (page2). This permits an explicit
mapping from one named logical device to a selected procedural reference output;
it does not permit silently ignoring the routing information.

The supported mapping is deliberately narrower than a general MIDI router:

- No DeviceName anywhere: preserve the existing unnamed/default route behavior
- If any DeviceName is present, every channel-emitting track has exactly one
  nonempty DeviceName with the identical exact string
- Each declaration is at source tick/beat zero, before all channel commands and
  ProgramName on its own track, including commands sharing the same tick
- Ordinary non-addressed metadata may precede it. Unnamed conductor tracks that
  emit no channel commands are allowed. Any named silent track follows the same
  declaration/name rules
- A channel belongs to only one source track for the entire named-device file
- Repeated declarations, name changes, distinct names, empty names, mixed
  named/default channel tracks, late declarations and other routing mechanisms
  are unresolved. Port, channel-prefix and SysEx support is not introduced

Names are compared exactly, without case folding, trimming, aliases, replacing
characters or treating a software synthesizer label as a General MIDI promise.
The WMH named-route label rule is valid UTF-8 of at most4096 bytes, with at least
one non-whitespace character and no Unicode control characters. Exact leading
and trailing non-control spaces are retained, as are case and every other
non-control character. This is a WMH profile bound, not an RP-019 encoding rule.
Existing opaque-project/plain-text guards also apply: a line beginning with `DM:`
after leading Unicode whitespace is rejected, as is any ASCII alphanumeric/`+`/`/`/`=`
token longer than256 bytes. These are additional WMH restrictions; no generic
text guard is relaxed. Typed structurally valid DeviceName
text containing newline/tab may remain retained, but cannot select a receiver. Every original event, duplicate,
coordinate and rational time remains in structurally supported typed data.

## Validation and playback

The canonical MIDI importer checks this device scope before note pairing.
The strict complete-score validator checks it again on clean JSON load, using
both retained commands and the original attack/release coordinates. It cannot
pair notes through an unresolved route.

Independent typed performance conversion can retain unresolved DeviceName events
without claiming notation or targets. Existing independent structural guards
still apply, including unsupported port/prefix/System Exclusive commands and
ambiguous simultaneous cross-track channel events; no per-device interpreter is
added to bypass them. A receiver capability decision is separate from structural
completeness, and unresolved routes prohibit the current reference playback.

Both complete-song receivers explicitly map a fully proved single logical name
to the chosen WMH procedural reference receiver. The exact name and mapping are
disclosed in English/Chinese alongside the sound-policy choice. Mapping is a
reference-output choice, not a claim to reproduce the named device. A distinct
named-route policy identifies this choice. DeviceName events receive explicit
mapping acknowledgements at their original times; pause/resume keeps the same
mapping. Source and runtime declarations must agree in the strict receiver.

Nonzero banks remain blocked. DeviceName never supplies the missing bank121
map, changes programs, transposes keys, authorizes bends, changes RPN guards or
creates practice targets. No-source-name packages keep their previous behavior.

Tests use newly authored synthetic names and source messages. Private device
names, music and derived private packages are kept outside the repository and CI.
Source-event and receiver tests are not real-browser, native-package or physical
audibility acceptance. Source-count gains require independent source evidence
and remain conditional until the exact application build is accepted.
