# WorldMusicClub score format v1 / 单曲乐谱格式 v1

## Contract and file naming / 契约与文件名

Save one composition or arrangement as UTF-8 JSON named `<stable-song-id>.wmhscore.json`, for example `original-tied-step.wmhscore.json`. The extension is a naming recommendation, not a different encoding. The JSON root is the Rust `Score` object, called the **canonical score** here. Save `compilation.score` from the API, not the `{score, timeline, diagnostics}` response wrapper.

每首曲目或编曲建议保存为一个 UTF-8 JSON 文件，文件名为 `<稳定曲目ID>.wmhscore.json`。根对象是 Rust 的 `Score`，本文称为**标准乐谱模型**。API 返回结果中只取 `score` 保存；不要把包含 `timeline`、`diagnostics` 的整个返回结果当作乐谱文件。

- Machine-readable structural contract: [`schema/worldmusichub-score-v1.schema.json`](../schema/worldmusichub-score-v1.schema.json)
- Authoritative parser and musical validation: [`crates/score-core/src/lib.rs`](../crates/score-core/src/lib.rs), `Score`, `validate`, and `compile`
- Transport and import routes: [API contract](API.md)
- Schema dialect: [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12/schema); schema identifier: `urn:worldmusichub:score:v1` (an identifier, not a download URL)

The file MUST contain `"version": 1`. The format version is independent of the app/package version. Unknown versions and unknown object fields are rejected, including unknown fields nested inside notes or rational beats. Do not put `$schema`, `timeline`, `diagnostics`, arbitrary extensions, or editor metadata into the score. Configure editor/schema association outside the file. New model fields require an explicitly documented format evolution and a reader that understands them; changing the version number alone is not a migration. Keep the original file when migrating.

文件必须含有 `"version": 1`；它与应用版本号无关。未知版本和任何层级的未知字段都会被拒绝。不要加入 `$schema`、演奏时间线、诊断信息或自定义扩展字段；请在编辑器外部配置 Schema 关联。新增模型字段需要明确的格式演进与兼容读取器，单独修改版本号不构成迁移；迁移时保留原文件。

## Three different representations / 三种不同表示

1. **Canonical score:** written pitches/spellings, exact onsets/durations, rests, voices, staff numbers, tie segments, part identity, global tempo/meter/key maps, measure positions, supported repeat regions, attribution, and an optional retained source payload. Chords are separate notes with the same onset. Every supported written note, including each tied continuation, remains its own record.
2. **Performance timeline:** derived by Rust. Rational quarter-note positions become milliseconds, adjacent matching ties merge into one sounding note, rests generate no attacks, and supported repeats produce playback occurrences linked by `source_note_id`. It is unsuitable as a replacement for the canonical score.
3. **Original source/engraving:** the original MusicXML, MIDI bytes, numbered-notation text, or reviewed image payload when retained. The v1 model has no independent fields for lyrics, slurs, articulations, ornament symbols, beam groups, clefs, page layout, or detailed engraving. Such details can remain in retained source content without being modeled, displayed, or performed faithfully.

1. **标准乐谱模型：**保存受支持的每个书面音符和休止符，包含拼写、精确时值、声部、谱表编号、延音线分段、声部组、全局速度/拍号/调号、小节位置、受支持的反复区域、来源说明和可选源文件内容。同一时刻的多个音符表示和弦，延音线后的音符也保留独立记录。
2. **演奏时间线：**由 Rust 生成毫秒时间，合并相邻且匹配的延音线音符，不为休止符生成击键，展开受支持的反复并保留源音符关联。它不能替代标准乐谱文件。
3. **原始来源/排版：**可保留原始 MusicXML、MIDI 字节、简谱文本或人工校对的图像资料。v1 没有歌词、圆滑线、奏法、装饰音符号、连梁、谱号、页布局等独立字段。源文件中保留这些内容，不代表它们已被模型理解、准确显示或正确演奏。

## Fields, absence, and defaults / 字段、缺省与默认值

All names are case-sensitive and use the exact snake_case spellings shown. Objects reject additional properties. Unless listed as optional below, every field is required even when an empty string or array is valid. Required arrays and booleans cannot be `null`; explicitly nullable optional metadata is listed below.

字段名区分大小写，必须使用本文中的 snake_case 拼写。除下列可选字段外，其余字段均必须存在，即使允许值为空字符串或空数组。数组和布尔值不能为 `null`。

| Object / 对象 | Required fields / 必填字段 | Optional fields / 可选字段 |
| --- | --- | --- |
| Score | `version`, `id`, `title`, `composer`, `provenance`, `parts`, `tempo`, `meters`, `keys`, `measures` | `repeats` → `[]`; `source`, `format_metadata` → `null` |
| Part | `id`, `name`, `instrument`, `notes` | none / 无 |
| Note or rest / 音符或休止符 | `id`, `at`, `duration`, `voice`, `staff`, `velocity` | `pitch` → `null`; `tie_start`, `tie_stop` → `false` |
| Pitch | `step`, `alter`, `octave` | none / 无 |
| Beat | `numerator`, `denominator` | none / 无 |
| Tempo | `at`, `bpm` | none / 无 |
| Meter | `at`, `numerator`, `denominator` | none / 无 |
| Key | `at`, `fifths`, `mode` | none / 无 |
| Measure | `number`, `at`, `length` | none / 无 |
| Repeat | `from`, `to`, `times` | none / 无 |
| Provenance | `kind`, `attribution` | `source_url`, `license` → `null` |
| Source | `format`, `content` | `filename`, `import_diagnostics` → `null` |
| Format metadata | `schema_revision`, `producer`, `producer_version` | none |
| Retained diagnostic | `severity`, `code`, `message` | `note_id` → `null` |

For nullable fields, either absence or explicit `null` means `None` in Rust. Therefore an omitted `pitch` is a rest, not an unknown pitch awaiting recognition. Prefer writing `pitch: null` explicitly for rests. A pitched note requires the full `Pitch` object; partial pitches are invalid. The `default` keywords in the schema describe Rust's behavior; they are annotations and do not require a schema validator to change the input. Rust serialization emits defaulted musical fields and most nullable fields explicitly; absent optional `format_metadata` and `source.import_diagnostics` remain omitted. Deserialize/serialize preserves the model, not whitespace, object-key order, or generally whether a default was omitted. Retained `source.content` remains the decoded string, independently of JSON escaping.

可空字段可以缺省或显式写为 `null`，二者在 Rust 中都表示 `None`。因此缺少 `pitch` 的记录是休止符，不是“尚未识别的音高”；建议休止符明确写 `pitch: null`。有音高时必须提供完整的 `Pitch` 对象。Schema 中的 `default` 只是说明 Rust 的默认行为，不要求校验器修改输入。Rust 再次序列化会显式输出带默认值的音乐字段和大多数可空字段；缺省的可选 `format_metadata` 与 `source.import_diagnostics` 则继续省略。因此模型可以保留，但 JSON 空白、键顺序以及其他“曾省略默认值”的写法不保证原样保留；`source.content` 解码后的内容不因 JSON 转义改变。

### Exact musical time / 精确音乐时间

`Beat` is a rational number of **quarter notes**. `{ "numerator": 1, "denominator": 3 }` is exactly one third of a quarter note; it is not one third of a measure. An eighth note is `1/2`, a dotted quarter is `3/2`, and a triplet eighth is `1/3`. Fractions need not be reduced: `2/4` and `1/2` are equivalent. `at`, `from`, and `to` use the global written-score clock, not a part-local or measure-local clock. Onsets are nonnegative; durations and measure lengths are positive. Do not convert canonical time to floating-point milliseconds for storage.

`Beat` 的单位是**四分音符**，不是秒或小节。八分音符为 `1/2`，附点四分音符为 `3/2`，三连音中的八分音符为 `1/3`。分数无需约分，`2/4` 与 `1/2` 等价。所有 `at`、`from`、`to` 都使用整首书面乐谱的统一时间轴；起点不能为负，时值和小节长度必须为正。不要把标准时间转换成浮点毫秒后保存。

### Pitch, rests, voices, and ties / 音高、休止、声部与延音线

`step` is uppercase `C`–`B`; `alter` is an integer from −2 through 2; `octave` uses scientific pitch numbering (`C4` is MIDI 60). Rust evaluates `(octave + 1) × 12 + step_offset + alter` and requires MIDI 0–127. The schema's octave storage range of −128…127 is deliberately not a claim that every combination is playable. The schema cannot replace this cross-field pitch check.

`pitch: null` creates a rest. Rests still have an ID, onset, duration, voice, staff, and velocity; they cannot have either tie flag set. A velocity of zero is permitted and does not turn a pitched note into a rest. `voice` is a nonempty identifier within a part; `staff` is 1-based. v1 has no separate staff-definition array. Pitched records with `tie_start`/`tie_stop` preserve written segments; Rust first matches adjacent ties within one part by voice, staff, and sounding MIDI pitch. If that lane has no active start, exactly one explicit start at the same rational endpoint/pitch may continue across voices or staves, with a diagnostic and all written lanes/IDs retained. Multiple cross-lane candidates are refused rather than guessed. Missing or nonadjacent continuations produce diagnostics; ambiguous overlapping starts are errors. A repeated pitch without explicit tie flags is never merged.

`step` 为大写音名 C–B，`alter` 为 −2 到 2 的整数，中央 C 写作 `C4`（MIDI 60）。Rust 联合校验音名、升降号和八度，结果必须位于 MIDI 0–127；Schema 的八度整数存储范围不表示所有组合都可演奏。休止符仍有 ID、时间、声部、谱表编号和力度，但不能带延音线标志。力度为零不会把有音高的音符变成休止符。`voice` 为非空标识，`staff` 从 1 开始；v1 没有单独的谱表定义数组。延音线在同一 Part 中按 voice、staff 和 MIDI 音高匹配；不相邻或缺失的衔接会产生诊断，歧义的重叠起点会被拒绝。

### Maps, measures, and repeats / 全局映射、小节与反复

Tempo is in quarter notes per minute, including in compound meter. The tempo map must start at exact beat zero and be strictly increasing; held notes integrate tempo changes. Meter and key maps are global. `fifths` is −7…7; `mode` is a string, not a closed enum. `instrument`, provenance `kind`, and source `format` are also labels rather than closed enums; unknown labels do not imply feature support.

`meters`, `keys`, `measures`, and a part's `notes` may be empty. Core v1 validation does not require meter/key maps to begin at zero or be sorted/unique, or measure numbers to be consecutive/unique. Measure number zero is accepted. It checks each measure's positive length and representable end, but does not establish a complete nonoverlapping measure grid, meter consistency, or note coverage. Use ordered, consistent maps and measure boundaries for interchange; import/export or rendering operations may impose stricter requirements and return errors. Passing the schema or `validate` alone is not proof of engravability.

A repeat plays the half-open written interval `[from, to)` a total of `times` times (2–16, including the first pass). Rust requires `to > from`; compilation rejects nested/overlapping regions, out-of-score endpoints, and sounding notes crossing jump boundaries. v1 cannot express alternate endings, D.C., D.S., coda, or a general navigation graph. It does not expand the stored canonical notes.

速度一律为“每分钟四分音符数”，复拍子也一样；速度映射必须从精确的零拍开始并严格递增，持续音跨越速度变化时由 Rust 积分。拍号和调号映射是全局的。`fifths` 为 −7…7；`mode`、`instrument`、`kind`、`format` 都是字符串标签而非封闭枚举，标签存在不代表功能受支持。

拍号、调号、小节数组以及 Part 的音符数组可以为空。当前核心不强制拍号/调号从零开始、排序或唯一，也不强制小节编号连续或唯一；小节编号可以为零。核心检查小节正长度及结束位置可表示，但不保证小节网格连续、不重叠、符合拍号或覆盖所有音符。为了交换数据，应使用有序一致的映射和边界；导入、导出或排版可有更严格限制并明确报错。结构验证通过不等于能准确排版。

反复区域 `[from, to)` 总共演奏 `times` 次（2–16 次，包含首次）。Rust 检查终点大于起点，并在编译时拒绝嵌套、重叠、超出乐谱范围或持续音跨越跳转边界等情况。v1 不能表示不同结尾、D.C.、D.S.、Coda 等通用导航；存储的标准音符不会被反复展开。

## Bounds and Rust-only checks / 边界与 Rust 专属校验

| Field / 字段 | Bound / 限制 |
| --- | --- |
| Beat numerator / 分子 | 0…1,000,000,000 for positions; 1…1,000,000,000 for durations / 起点允许零，时值必须为正 |
| Beat denominator / 分母 | 1…1,000,000 |
| Parts / Part 数 | 1…128 |
| Written notes/rests / 音符和休止符 | At most 100,000 **in total** / 全曲总计不超过 100,000 |
| Tempo, meter, key, measure events / 各类映射与小节事件 | At most 100,000 in each array / 各数组不超过 100,000 |
| Repeat regions / 反复区域 | At most 10,000 / 不超过 10,000 |
| Expanded sounding occurrences / 展开后的发声音符 | At most 100,000 / 不超过 100,000 |
| BPM | 10…600, finite / 有限数 |
| Staff; velocity / 谱表编号；力度 | 1…255; 0…127 |
| Meter numerator; denominator / 拍号分子；分母 | 1…65,535; powers of two 1…32,768 / 2 的幂 |
| Measure number / 小节编号 | 0…4,294,967,295 (`u32`) |
| Score/part/note ID / 各类 ID | 128 UTF-8 bytes / 字节 |
| Title; composer; part name / 曲名；作者；Part 名 | 1000; 1024; 256 UTF-8 bytes / 字节 |
| Voice; instrument; provenance kind; source format | 64 UTF-8 bytes each / 各 64 字节 |
| Attribution; source URL; license; source filename | 8192; 4096; 256; 1024 UTF-8 bytes / 字节 |
| Retained source content / 保留的来源内容 | 8 MiB UTF-8 bytes / 字节 |

JSON Schema checks property sets, required fields, types, per-field ranges, per-array caps, and that rests are not tied. It is a **structural preflight**, not the musical engine. Rust remains authoritative for:

- UTF-8 **byte** lengths and non-whitespace score ID/title. Schema `maxLength` counts Unicode code points; for example 400 Chinese characters can fit a 1000-character schema limit while exceeding the 1000-byte title limit
- The global note-count sum, globally unique note IDs, and unique part IDs
- Pitch-to-MIDI relationships and exact rational comparison/addition; even valid individual fractions may sum to an unrepresentable end after reduction
- Zero-start/increasing tempo, repeat ordering/extent, supported navigation, tie resolution, and expanded timeline limits
- Operation-specific measure/map requirements. The core's current permissive measure behavior above is intentional documentation, not an extra schema promise

Schema 仅做结构预检：字段集合、必填项、类型、单字段数值范围、单数组上限和休止符无延音线。UTF-8 字节长度、去空白后的曲目 ID/曲名、全曲音符总量、ID 唯一性、音高关系、精确分数运算、速度排序、延音线处理、反复导航与展开上限，仍以 Rust 为准。两个分别合法的分数，相加约分后仍可能超出允许范围。不同导出/排版操作也可能要求更严格的小节与映射结构。

Use JSON integer tokens for integer fields, not quoted numbers, `1.0`, or exponent notation. JSON Schema sees a mathematical integer after JSON parsing, while Serde's integer parser can reject a decimal/exponent token. Avoid duplicate JSON property names; a generic JavaScript JSON parse can hide a duplicate that Rust rejects. JSON itself excludes `NaN` and infinity. The HTTP server additionally caps the entire request body at 8 MiB; JSON escaping, base64 growth, and other score fields count toward that cap, so a source payload near its standalone limit may not fit an API request.

整数字段请使用 JSON 整数文本，不要使用字符串、`1.0` 或指数写法。Schema 处理解析后的数学数值，无法完全代替 Serde 对原始数值文本的判断。也不要写重复的对象键；普通 JavaScript 解析可能掩盖 Rust 会拒绝的重复键。JSON 不支持 NaN 或无穷大。HTTP 的 8 MiB 限制针对整个请求体，含 JSON 转义、Base64 膨胀和其他字段，来源内容未超过自身上限也可能使整个请求超限。

## Compatibility and producer policy / 格式兼容与生成工具

Score `version: 1` describes the musical model. Additive nonmusical metadata is schema revision 2 in the 0.2.0-alpha.1 development series. Optional `format_metadata` records the claimed origin producer and its version; new application-created/imported canonical records stamp these values, while reading legacy files never invents missing producer information. Ordinary compile and reversible copy/restore retain origin metadata; it is not a signature, musical authorship or a complete edit history. Unknown fields and future declared revisions produce compatibility errors, never silent field stripping. See [format compatibility policy](FORMAT_COMPATIBILITY.md).

## Source preservation and diagnostics / 来源保留与诊断

`source` contains at most one payload. `source.content` is an opaque string to score validation, not executable content and not automatically decoded according to `format`. `source_url` is metadata, not a request to fetch a resource. Do not use provenance claims as permission to redistribute a score; the application's MIT license does not license imported music. Keep independent copies of original files, especially unsupported or rejected inputs.

Current importer conventions:

- `musicxml`: the original XML text is retained. Older MXL imports also used this format for only the selected root XML; their missing archive cannot be reconstructed
- `worldmusichub-mxl-archive-v1`: new MXL imports retain a versioned JSON envelope containing the original compressed archive as base64, the selected MusicXML as exact UTF-8 text, its manifest path and both byte counts. Ancillary bytes remain inert inside the original archive. The complete canonical score must fit the 8 MiB save/import budget; sources are never dropped just to fit
- `midi-base64`: base64 of the original MIDI bytes. Canonical pitch spelling, voices/staves, and notation are inferred; source-byte preservation is not original-notation recovery
- `worldmusichub-jianpu-text-v1`: the explicit [numbered-notation dialect](JIANPU_TEXT.md) retains the input text verbatim
- `image-review`: content is a JSON string holding the original image data URL, crop/review information, and manually entered notes. A raw recognition result is not a playable score; unknown rhythm/accidentals require review. This is not lossless PDF/image transcription

Importers reject unsupported sound-affecting semantics rather than quietly inventing playback. Visual or expressive material outside the model may be retained only in source and accompanied by warnings. This does not mean every arbitrary source is accepted or every unsupported feature has its own diagnostic. If an import fails, no successful canonical score is promised; the caller must retain the original input.

Runtime diagnostics remain operation results. New imports also retain their original observations in optional `source.import_diagnostics`, so JSON export, library save/restore and recompilation preserve source-only limitations. Each entry has `severity` (`warning` or `info`), `code`, `message` and optional `note_id`; maximum256 entries,64-byte codes,8192-byte messages and128-byte note IDs. Compilation prefixes these as retained import observations rather than claiming they describe later edits. Errors may instead return `{error}`. Older files without this field remain readable, but their missing warnings cannot be reconstructed automatically. This optional metadata requires the updated reader; older strict alpha readers may reject it rather than discard it. Never treat an empty diagnostic list or successful validation as a guarantee of complete transcription, original engraving, instrument playability, copyright clearance, or performance accuracy.

`source` 最多包含一份来源，`content` 在标准校验中是不会自动执行或解码的字符串。`source_url` 只是元数据；来源声明不等于转载授权，应用的 MIT 许可不覆盖导入音乐。应独立保存原文件，尤其是导入失败或尚不支持的文件。

当前 MusicXML 导入保留原 XML 文本；新 MXL 导入保存完整原压缩包、选中的根 XML、清单路径和字节数，附属文件只归档，不解压显示或播放。完整标准乐谱连同 Base64/JSON 开销必须不超过 8 MiB，否则明确拒绝，不会丢掉附件以便导入。旧版 MXL 导入若只保存了 XML，需要重新导入原 MXL 才能补齐归档。MIDI 以 Base64 保留原字节，但音符拼写、声部和谱表信息属于推断。明确支持的简谱方言保留原文本。图像校对保存图像、裁剪/复核信息和人工输入；自动识别候选不等于可播放乐谱，也不保证 PDF/图像无损转谱。

影响发声且不支持的语义会被拒绝；部分显示/表情细节可能仅留在源内容中并附警告。这不代表任意源文件都可导入或每种未知特征都有单独诊断。导入失败时不承诺生成标准乐谱，调用者必须保留输入。

操作会返回当前诊断；新版导入也把原始观察保存在可选的 `source.import_diagnostics` 中，保存完整 `score` 或曲库备份即可保留。重新编译会明确标注它们是历史导入观察，不代表后续编辑后的当前状态。旧文件未保存的警告无法自动恢复。较早的严格读取器可能拒绝新增元数据，应更新应用并保留原文件，不要删掉字段强行导入。校验成功或没有警告，不保证完整转写、原始排版、乐器可演奏性、版权许可或演奏准确性。

## Original complete example / 完整原创示例

This one-bar original exercise has two written tied C4 quarters, an eighth rest, and a dotted-quarter E4. It quotes no existing score. Save the following object as `original-tied-step.wmhscore.json`. At 120 BPM the derived timeline has two sounding notes: C4 at 0 ms for 1000 ms, E4 at 1250 ms for 750 ms; the four written records remain intact.

此原创单小节练习含两个以延音线相连的 C4 四分音符、一个八分休止符及一个 E4 附点四分音符，未引用现有曲谱。保存为 `original-tied-step.wmhscore.json`。120 BPM 时，演奏时间线只有两个发声音符：C4 从 0 ms 持续 1000 ms，E4 从 1250 ms 持续 750 ms；四条书面记录均保留。

```json
{
  "version": 1,
  "id": "original-tied-step",
  "title": "Tied step / 延音小练习",
  "composer": "WorldMusicHub original example",
  "provenance": {
    "kind": "original_exercise",
    "attribution": "Original four-event documentation exercise for WorldMusicHub; no third-party score quoted.",
    "source_url": null,
    "license": "MIT"
  },
  "parts": [{
    "id": "piano",
    "name": "Piano / 钢琴",
    "instrument": "piano",
    "notes": [
      {"id": "c-start", "at": {"numerator": 0, "denominator": 1}, "duration": {"numerator": 1, "denominator": 1}, "pitch": {"step": "C", "alter": 0, "octave": 4}, "voice": "1", "staff": 1, "velocity": 90, "tie_start": true, "tie_stop": false},
      {"id": "c-stop", "at": {"numerator": 1, "denominator": 1}, "duration": {"numerator": 1, "denominator": 1}, "pitch": {"step": "C", "alter": 0, "octave": 4}, "voice": "1", "staff": 1, "velocity": 90, "tie_start": false, "tie_stop": true},
      {"id": "rest", "at": {"numerator": 2, "denominator": 1}, "duration": {"numerator": 1, "denominator": 2}, "pitch": null, "voice": "1", "staff": 1, "velocity": 0, "tie_start": false, "tie_stop": false},
      {"id": "e-step", "at": {"numerator": 5, "denominator": 2}, "duration": {"numerator": 3, "denominator": 2}, "pitch": {"step": "E", "alter": 0, "octave": 4}, "voice": "1", "staff": 1, "velocity": 90, "tie_start": false, "tie_stop": false}
    ]
  }],
  "tempo": [{"at": {"numerator": 0, "denominator": 1}, "bpm": 120}],
  "meters": [{"at": {"numerator": 0, "denominator": 1}, "numerator": 4, "denominator": 4}],
  "keys": [{"at": {"numerator": 0, "denominator": 1}, "fifths": 0, "mode": "major"}],
  "measures": [{"number": 1, "at": {"numerator": 0, "denominator": 1}, "length": {"numerator": 4, "denominator": 1}}],
  "repeats": [],
  "source": null
}
```

## Verification / 验证

Run `npm test` (or `node --test tests/score-schema.test.js`) for Draft 2020-12 schema tests using development-only Ajv. They validate this exact documentation example, the frontend fixture, invalid structures, nullable/default behavior, and correspondence to Serde's field declarations. Run `cargo test --workspace --locked` for the Rust engine. Before playback or assessment, submit the score to `POST /api/compile` and handle both errors and diagnostics; a schema-valid score can still fail Rust validation or compilation.

运行 `npm test`（或 `node --test tests/score-schema.test.js`）可用仅开发阶段依赖的 Ajv 校验本文完整示例、前端样例、错误结构、可空/默认值行为以及与 Serde 字段声明的一致性。Rust 测试使用 `cargo test --workspace --locked`。播放或评估之前仍应调用 `POST /api/compile` 并处理错误与诊断，不能只依赖 Schema 校验通过。
