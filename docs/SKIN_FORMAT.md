# Portable skin format v1

WorldMusicClub skins describe presentation only. The same UTF-8 JSON manifest can
be read by a browser, Unity or another renderer without changing the Rust score,
clock, note targets or assessment engine. This first implementation supplies a
strict schema, a dependency-free JavaScript reference reader, a bounded directory
validator and an original sample. The current app also has a bounded
[import/select/reset adapter](SKIN_APP_MVP.md); its declared support is narrower
than the portable format. This does not establish browser, Unity, native Windows
or accessibility acceptance.

中文：皮肤只控制外观，不更改原谱、计时、判定、乐器或演奏者。人类与机器
必须同时以不同颜色、不同形状和明确图例区分。缺失图片回退为纯色；不支持
的显示特性使用内置默认值并报告原因。当前包含独立格式、解析器、样例以及
范围受限的应用内导入／选择／重置功能，尚不代表全产品外观功能已通过验收。

## Package and version

A v1 package is a directory containing `skin.json` and optional PNGs beneath
`assets/`. The sample is [`skins/original-midnight`](../skins/original-midnight/).
[`skins/default.skin.json`](../skins/default.skin.json) is a standalone manifest
with no resources. There is no ZIP importer, network installer or archive
extraction contract in v1; renaming a ZIP to `.wmcskin` does not make it supported.

- `format` is exactly `worldmusicclub-skin`; `version` is integer `1`
- Schema: [`schema/worldmusicclub-skin-v1.schema.json`](../schema/worldmusicclub-skin-v1.schema.json), ID `urn:worldmusicclub:skin:v1`
- Reference parser/resolver: [`web/skin-format.js`](../web/skin-format.js)
- CLI: `node scripts/validate-skin.mjs skins/original-midnight --strict-assets`
- Pure tests: `npm run test:skin`

All fields are required, including explicit `null` for an absent background
asset. All objects reject unknown fields. V1 has no executable extensions or
engine-specific escape hatch. Unsupported versions and invalid manifests must
produce a visible diagnostic and keep or restore the built-in default. A reader
must never silently accept an unknown version as v1. Future incompatible fields
need another version and an explicit migration; no migration is implemented here.

`id` is a stable lowercase identifier. `name`, `author`, `license` and
`attribution` are bounded, nonempty, trimmed plain text. They must be displayed as
text, never HTML, a shell command, a URL to fetch or an instruction. A license
claim is metadata, not proof of third-party rights. Only verified-compatible or
original assets may be distributed with the project.

## Visual fields and semantic boundary

| Field | Meaning |
| --- | --- |
| `palette` | Opaque background, gameplay surface, foreground, muted text, outline and judgment-line colors |
| `notes.human`, `notes.machine` | Falling-note body `fill`, label `foreground`, `outline`, role `marker` and optional `pattern` |
| `keyboard` | White, black and pressed key colors, their respective text colors, and key border |
| `notation` | Opaque notation paper and ink; no glyph replacement |
| `layout` | Bounded notation/piano height, common side margin and note width scale |
| `background` | Optional local asset ID, `cover`/`contain`/`tile` fit, and opacity 0–0.25 |
| `assets` | Declared local PNG resources with exact byte and pixel dimensions |
| `fallback` | Fixed v1 fallback policy, not user code |

Colors are opaque sRGB `#RRGGBB`, case-insensitive. CSS names, alpha colors, CSS
expressions and URL values are invalid. Note markers are `circle`, `diamond`,
`square` or `triangle`; patterns are `solid` or `stripes`. Markers are added to
falling-note bodies and the legend. They do not replace engraved noteheads,
rests, accidentals, beams, ties, articulation or duration-bearing shapes.

Human and machine styles must have different fills **and** different markers.
The host supplies localized semantic labels (`performer.human` /
`performer.machine`), draws the two marker swatches in a persistent legend, and
uses the actual performer assignment from song configuration. A skin cannot
rename, hide or reassign those roles. Color is never the sole performer cue.

Per-song Mod settings, including part instrument, performer, mute/visibility and
musical layout choices, are a separate configuration. Skins do not carry part or
song IDs. They cannot alter source notes, score spelling, notation staff/voice
selection, pitch, timing, duration, velocity, tempo, audio, judgment windows,
scoring, keyboard mappings or human target selection. Applying/resetting a skin
must preserve playback and the current practice configuration.

## Fixed layers and geometry

All v1 normalized coordinates have a top-left origin. The reference
`skinLayoutBands` helper returns the following fixed layer rectangles. Notation is an overlay inside the falling lane, never a
separate dock that removes vertical space from it:

| Layer | Top | Height |
| --- | --- | --- |
| Notation | 0 | `notation_height` |
| Falling notes / judgment | 0 | `1 - piano_height` |
| Piano | `1 - piano_height` | `piano_height` |

Every band has x=`side_margin`, width=`1 - 2*side_margin`.
`judgment_line_y = 1 - piano_height`: it is always pinned to the top of the piano.
Draw the notation layer behind the falling-note bodies, inside their shared
lane. Its optional opaque reading background is confined to its overlay region;
notes continue through that same region. Increasing notation height must never
shorten, clip or push down the falling lane. The default notation background is
the same dark color as the gameplay surface. The renderer maps the canonical
current time to that line; a skin must not
offset the time origin or change note travel time/speed. `note_width_scale`
affects width within a pitch lane only, never note length or pitch position.

- `notation_height`: 0.15–0.35
- `piano_height`: 0.15–0.30
- Falling lane retains 70–85% of stage height regardless of notation height
- `side_margin`: 0–0.06
- `note_width_scale`: 0.60–0.95

Layer ordering, opaque reading surfaces, host HUD/safety notices, semantic
visibility, minimum font sizes and input hit targets are owned by the renderer.
The host may enforce a larger minimum readable layout for a small window and
report `layout_bands` fallback. Skins cannot introduce arbitrary positioning,
z-order, clipping, animation or hide the piano/judgment/notation bands. If the
user hides notation using a separate app preference, layout reflow is host-owned.

## Readability

The reference validator uses sRGB relative luminance and `(Lmax+.05)/(Lmin+.05)`.
This is a numeric minimum, not a claim of complete accessibility certification.

- Foreground and muted text: at least 4.5:1 against both background and surface
- Judgment line and surface outline: at least 3:1 against the gameplay surface
- Falling-note fill: at least 3:1 against both gameplay and notation backgrounds;
  note label: 4.5:1 against fill;
  note outline: 3:1 against fill
- Each keyboard label: 4.5:1 against its key; white/black keys: 3:1 between them;
  pressed fill and key border: 3:1 against both unpressed key colors
- Notation ink: at least 7:1 against its opaque paper

The background image is decorative and behind opaque gameplay/notation/text
surfaces. It may appear in surrounding gutters. Never composite it over text or
music; its low opacity alone is not a contrast guarantee. Pattern lines belong
on a small marker/edge area, never over labels or as substitutes for note shapes.
An engine unable to maintain these guarantees must use the built-in default.

## Resource safety and bounds

| Limit | Value |
| --- | --- |
| Manifest UTF-8 bytes / nesting | 65,536 bytes / 12 levels |
| Asset count | 4 |
| Bytes per PNG / total declared and supplied | 2 MiB / 8 MiB |
| Width or height | 1–2,048 pixels |
| Pixels per PNG / total declared | 4,194,304 / 8,388,608 |

Manifest decoding rejects duplicate JSON keys, malformed UTF-8 and non-JSON
numeric values. Schema validation checks structure; semantic validation also
checks readability, distinct role markers, cross-field resource sums,
reference integrity and portable paths. Passing JSON Schema alone is insufficient.

Paths are lowercase ASCII under `assets/`, consisting of alphanumeric,
underscore or hyphen segments with a final `.png`. Each segment starts with an
alphanumeric character. Paths are at most 160 characters. Absolute, parent,
dot, empty, percent-encoded, backslash, query, fragment, drive, network and Windows
reserved-device paths are rejected. IDs and paths must be unique. Asset IDs in
`background.asset` must exist in the manifest. Resources outside that declaration
are rejected, even if their paths look safe. No HTTP, file, data or blob URL is
accepted as package data; no fetch is performed.

The supported image subset is a metadata-free, static, noninterlaced 8-bit RGB or
RGBA PNG containing only `IHDR`, nonempty contiguous `IDAT` chunks and `IEND`.
SVG, JPEG, APNG, palette PNG, embedded color profiles, text chunks, animation,
shaders, fonts, audio and arbitrary files are unsupported. The reference
validator checks the actual signature, chunk bounds/CRC, exact declared bytes
and dimensions, supported header, and terminal IEND without trailing data. A
bounded deflate read checks exact decompressed scanline length and filter bytes
before an image may be handed to the engine's image decoder. Rendering/decoding
must still fail safely; successful validation is not evidence of GUI rendering.
RGBA is allowed only in decorative image pixels, not palette colors.

The pure resource reader takes an in-memory `Map<path, Uint8Array>` and never
opens files. It snapshots the manifest and all bounded input bytes before the
first asynchronous decoder read. The CLI canonicalizes the explicitly selected
root with `realpath` (that selected root may itself be a symlink), then refuses
symlinks within that canonical root, non-regular files and real paths outside it.
It bounds file reads before allocation/decompression. Use a stable, private staging directory: the
CLI is not a sandbox against another process racing ancestor-directory swaps.
A future archive importer must independently cap compressed/expanded entries,
reject duplicates/symlinks/traversal and stage atomically before calling this API.

## Fallback, capabilities and reset

V1 embeds these exact policy values:

- `fallback.missing_asset = solid_background`
- `fallback.unsupported_feature = builtin_default`
- `fallback.invalid_skin = builtin_default`

Missing or corrupt optional PNGs produce diagnostics and a solid background
while keeping the valid palette. Undeclared or oversized supplied resources are
package errors, not an invitation to load them. `--strict-assets` makes the CLI
exit unsuccessfully when any optional resource needs fallback; without it the
CLI reports the usable manifest and warnings.

Hosts advertise a subset of `background_image`, `marker_shapes`, `note_patterns`
and `layout_bands` to `resolveSkin`. The default list is empty, so support is
explicit rather than assumed:

- No `background_image`: use the solid background
- No `marker_shapes`: use mandatory baseline human circle / machine diamond
- No `note_patterns`: both bodies are solid; color, marker and legend remain
- No `layout_bands`: use the built-in band sizes

A v1 renderer must support the baseline palette, keyboard, notation paper/ink,
circle/diamond role markers and labeled legend. It must refuse v1 or retain its
safe built-in presentation if it cannot. A renderer's extra shader/animation
features do not make them valid v1 manifest fields. The reader returns a
diagnostic for every requested feature it actually changes. Supported fields
that equal the baseline need no warning.

`resetSkin()` returns the immutable built-in manifest. Resolve it through the
same renderer capabilities. It does not write storage or alter any musical
state; the host owns explicit selection/persistence and restoring defaults.
Failed import must not destroy the previously saved selection. Apply a fully
resolved snapshot atomically; surface fallback diagnostics to the user.

Example reference usage (no network or product integration implied):

```js
import {resolveSkin, SKIN_FEATURES, resetSkin} from '../web/skin-format.js';
const resolved = await resolveSkin(manifestBytes, {
  resources: new Map([['assets/woven.png', pngBytes]]),
  features: SKIN_FEATURES, // Only list capabilities the renderer really implements.
});
// resolved.skin, bands, legend, background_bytes and diagnostics are visual data.
const defaultManifest = resetSkin();
```

## Verification boundary

Pure tests cover schema/reader agreement, missing/unknown fields, semantic
protection, duplicate members, malformed UTF-8, path traversal, resource budgets,
PNG corruption/animation, bounded decompression, readable contrast, overlapping notation/lane
geometry, capability fallback, reset, immutability and filesystem symlinks.
The sample's PNG is decoded as bounded data by the CLI with no warnings.

Browser application wiring, user skin import/export controls, Unity compilation,
GPU rendering, native Windows package acceptance and user-visible runtime
fallback checks remain separate implementation/acceptance steps. No local
browser, GUI or server was launched to verify this format.
