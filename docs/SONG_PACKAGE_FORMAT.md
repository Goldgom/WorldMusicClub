# 完整曲包格式（Song Package Format）

本文是**当前源码实际支持的可移植曲包参考**。曲包保存完整的受支持音乐语义，
由 Rust 校验后提供各 profile 明确支持的记谱、练习或参考播放视图。“完整”必须按具体转换 profile
解释；它不等于原音色、原歌手、原录音或全部 MIDI/VSQ 特性的音响复现。

这里的文件格式、转换工具、原生导入和播放器能力分别说明。某项存在于源码，
不表示它已经进入某个已验收的 Windows 安装包；分发包以其 `BUILD-INFO.json`
及对应验收记录为准。Android、界面内一键全曲转换等后续功能不能由此推定为已完成。
本文也包含尚待发行验收的 typed 全事件、controls-v2、初始 RPN 和零 SMPTE origin
源码能力；它们已接入所述代码路径，不能据此认定已验收应用具有相同能力。

## 1. 一个包中究竟有什么

推荐的多曲 ZIP 结构如下。目录名只是可移植容器内的名称，不会成为本地曲库的存储键。

```text
manifest.json
songs/example/metadata.json
songs/example/score.json
songs/example/media/cover.png       # 可选，存在时必须在 metadata.media 中声明
songs/example/media/background.png  # 可选
songs/example/media/pv.webm         # 可选
```

`manifest.json` 的完整最小示例：

```json
{
  "format": "worldmusichub-song-pack",
  "version": 2,
  "songs": [{ "folder": "songs/example" }]
}
```

- `songs` 必须有 1–1024 项；每项只有 `folder`，相对于 manifest 所在目录解析
- 单曲可以只有 `metadata.json`、`score.json` 和声明过的媒体，不需要 manifest；
  原生导入入口接收 ZIP，可以将这一个曲目文件夹作为 ZIP 的全部内容
- ZIP 可以在 manifest 与曲目目录外再包一层目录；导出器总把 manifest 放在 ZIP 根目录
- 多曲必须有 v2 manifest；不允许重复 manifest、重复/互相嵌套的曲目目录、
  未声明的曲目、额外旁车文件或没有文件后代的空目录
- 一个 ZIP 可以容纳受支持的 MIDI 和 VSQ clean profiles，但不能混装 clean v2
  曲目与旧 v1/仅源文件曲目
- 每首曲目只能有两个 JSON 和声明过的媒体。原始 `.mid`/`.vsq`、工程文本、
  原始压缩包、`source.payload`、Base64 原文件、审计报告、脚本均不属于交付曲包

原始输入与转换审计应另行保留；不把它们装入 clean 曲包，也不因转换成功而删除。
`score.json` 是音乐数据，ZIP 只是运输容器。派生的 runtime、原生响应、导航缓存和
本地存储索引也不属于可移植文件清单。

## 2. metadata.json：完整字段与绑定关系

v2 metadata 是封闭对象。Rust 直接反序列化并拒绝未知字段、重复字段及不一致的绑定。
不要沿用 v1 的字符串 `score` 或对象式 `media`。

| 字段 | 当前要求 |
| --- | --- |
| `format` | 固定为 `worldmusichub-song` |
| `version` | 固定为 `2`，这是曲目容器版本 |
| `id` | 严格 MIDI/VSQ 与 `notation.id` 相同；typed 全事件与完整 score 顶层 `id` 相同 |
| `title` | 严格 MIDI/VSQ 与 `notation.title` 相同；typed 全事件与完整 score 顶层 `title` 相同；允许中文 |
| `score` | 只有 `path`、`bytes`、`sha256`；`path` 固定为 `score.json` |
| `score.bytes` | 这个文件实际 UTF-8 字节数，不是字符数 |
| `score.sha256` | 这个文件**精确字节**的 SHA-256，64 位小写十六进制 |
| `sources` | 当前恰好一个来源描述，与完整 score 的 `source` 完全相同 |
| `rights` | 下面的权益描述对象 |
| `media` | 必需的数组；没有媒体时写 `[]`，最多 32 项 |

一个来源描述只有 `format`、`bytes`、`sha256`。现有 profiles 分别使用 `midi` 或
`vsq`；两者原始输入上限都是 5 MiB，不能把 `original_authored` 用作输入格式。
来源描述没有路径、下载链接或原始内容。只有转换器读取原文件时才能核对它；
从外部曲包读取到的哈希仍是来源证据声明，不能单独证明原文件真实性或授权。

`rights` 有以下字段；歌曲与每个媒体各有自己的对象：

| 字段 | 当前要求 |
| --- | --- |
| `status` | `user_supplied_unverified`、`original_authored`、`licensed`、`public_domain` 之一 |
| `attribution` | 文本，最多 4096 UTF-8 字节；控制字符只允许换行、制表符 |
| `license` | 字符串或 `null`；字符串最多 2048 UTF-8 字节，不含控制字符；Rust 也接受省略 |

这些字段记录权益证据，不会授予许可证。代码的 MIT 许可不会自动覆盖曲谱、编曲、
声库、图像、录音或视频。只对自己确实拥有相应权利的原创素材标注原创许可。

以下是仓库[原创短曲 fixture 的 metadata](../tests/fixtures/clean-song-v2/metadata.json)，
可与其[完整 score.json](../tests/fixtures/clean-song-v2/score.json)直接配对：

```json
{
  "format": "worldmusichub-song",
  "version": 2,
  "id": "midi-d38ca0ab0a824ca3",
  "title": "Clean Fixture",
  "score": {
    "path": "score.json",
    "bytes": 11196,
    "sha256": "45fae36dd9e93b2ebe617df073f13fc400c0d01efab7e8d863d08e6f763869ad"
  },
  "sources": [{
    "format": "midi",
    "bytes": 176,
    "sha256": "777e30db44e7c54ef0adfd1f21ab2fd8fcca49d7a0ffa64c8464dcce5e7fa084"
  }],
  "rights": {
    "status": "original_authored",
    "attribution": "WorldMusicHub original authored test exercise",
    "license": "CC0-1.0"
  },
  "media": []
}
```

复制示例后若改动 score 的任何字节，包括缩进、字段顺序或末尾换行，必须重新计算
`score.bytes` 与 `score.sha256`。改动标题、ID 或来源还必须满足对应的 Rust 跨层校验。
metadata 没有通用 `artist`、`album`、`difficulty`、`duration`、`bpm`、
`default_instrument` 或任意扩展字典；不要自行增加这些字段。作者文本在已有的
`notation.composer`，出处在 `notation.provenance`，不代替上述包级权益声明。
typed 全事件没有 notation，也没有额外的顶层 composer 字段；其本地索引作者为空，
出处说明来自包级 rights，不能伪造一个空乐谱来补齐界面字段。

## 3. score.json：选择正确的完整音乐 profile

三个受支持的完整 score 都使用 `format: "worldmusichub-complete-score"`。
**外层曲包 v2、完整 score 的 v1/v2、内部 canonical Score v1 是不同层的版本。**

| 内容 | 严格语义 MIDI | typed MIDI 全事件 | VSQ clean |
| --- | --- | --- | --- |
| 完整 score 版本 | `1` | `2` | `1` |
| profile 位置 | `performance.profile = "wmh-semantic-midi1-v1"` | `performance.profile = "wmh-performance-midi1-v1"` | 顶层 `profile = "wmh-vsq-clean-v1"` |
| ID/title 位置 | `notation.id/title` | 完整 score 顶层 `id/title` | `notation.id/title` |
| `notation` | 完整推导的 canonical Score | 必须为 `null` | 全部创作基础音符的 canonical Score |
| 音乐层 | 按键区间及其原事件证据、其他命名指令 | 独立起音、释放和其他命名指令；不推断配对 | 创作项目及独立命名引擎调度 |
| 当前用途 | 有目标的练习及受限参考演奏 | 显式选择受支持的 FIFO 参考试听；无记谱/评分 | 显式选择“基础音符器乐练习”；完整人声不可用 |

三个 envelope 都有 `format`、`version`、`source`、`notation`、`coverage`。
严格 MIDI 另外有 `performance`；typed MIDI 另外有 `id`、`title`、`performance`；
VSQ 另外有 `profile`、`authoring`、`engine_dispatch`、`capabilities`、`interpretation_limits`。
不能把某个 profile 的字段复制到另一个封闭对象中。

原生读取器同时匹配 format、score version、顶层 profile 与 performance profile，
然后调用对应的 Rust decoder。不认识的组合拒绝。两种 MIDI envelope 均没有顶层
`profile`；原生 load 返回的 `clean_package.profile` 是派生的分派标识，位置不能
照搬回 score 文件。不能只看 `version: 2` 就把曲包版本误当成 typed 音乐版本。

### 3.1 有记谱时的 canonical notation

严格 MIDI/VSQ 的 `notation` 是[canonical Score v1](SCORE_FORMAT.md)，由现有 Rust
校验、编译、乐器适配与评分引擎处理，内部 `source` 必须为 `null`。
typed MIDI 的整个 `notation` 为 `null`，不走这些消费者。有记谱时的结构包括：

- `version`、`id`、`title`、`composer`、`provenance`，以及可选的 `format_metadata`
  （`schema_revision`、`producer`、`producer_version`）
- `parts`：每个分部有 `id`、`name`、`instrument`、`notes`
- 每个音符有 `id`、`at`、`duration`、`pitch`、`voice`、`staff`、`velocity`，
  以及 `tie_start`/`tie_stop`；pitch 有 `step`、`alter`、`octave`
- `tempo`、`meters`、`keys`、`measures`、`repeats`；具体 profile 进一步限制这些内容

`Beat` 用 `numerator` / `denominator` 表示**四分音符单位**，不是秒、tick 或小节号。
例如四分音符为 1/1、八分音符为 1/2；分母为正，当前最多 1,000,000，分子绝对值
最多 1,000,000,000。MIDI profile 的事件位置非负。不要先把音乐时间四舍五入到
毫秒再生成 score。

必须区分这些身份：

- **源轨 track**：文件中的事件容器，包括没有可弹音符的指挥/节奏信息轨
- **分部 part**：具有稳定 ID；严格 MIDI/VSQ 可选作练习目标，typed MIDI 则只标识
  track/channel 路由，不能因此获得练习目标；它不等于一个乐器音色
- **MIDI channel**：0–15 的共享控制路由，program/bank/volume 等状态属于路由
- **voice**：canonical 音符的声部标识；VSQ 投影视图保留 singer event 身份
- **staff**：音符所属谱表编号；不是源轨号或 MIDI 通道
- **乐器/音色**：源文件的声明、用户选择的练习乐器、播放器可用音色是不同概念

没有现成的通用乐器身份/置信度对象可以任意写入 JSON。严格 MIDI 的
`notation_origin: "inferred"` 明示记谱推断；typed part 的
`sound_identity: "unspecified_midi_route"` 明示声源未知。单独的 program 数值不能证明声源
符合 General MIDI。VSQ singer 的 `voice.program` 是歌手描述，不能解释成 GM 乐器。

### 3.2 严格 MIDI：可证明的全轨按键区间与事件覆盖

`performance` 包含 `profile`、`end`、`tracks`、`parts`、`notes`、`events`：

| 对象 | 必须保留的关系 |
| --- | --- |
| track | `id`, `name`, `source_index`, `source_event_count`, `end`；源轨按原顺序排列，索引从 0 开始 |
| part | `id`, `track_id`, `channel`, `notation_origin: "inferred"`, `target: "key_release"`；与 notation 分部一一对应 |
| performance note | `note_id`, `part_id`, `attack`, `release`, `release_velocity`；音高、起点、按键时长和攻击力度从关联的 canonical 音符取得 |
| event | `at`, `origin`, `command`；`origin` 与 note 的 attack/release 都是 `{track, event}`，两个索引均从 0 开始 |

每个原始事件坐标必须恰好出现一次：或者作为音符 attack/release，或者作为有类型的
command。验证器检查每条轨的计数、顺序、最终 `track_end`、最长结束时间及每个音符
的对应关系。无音符轨不能丢弃，末尾静默也不能简单裁到最后一个 note-off。

`coverage` 必须是实际重算结果：`status: "complete"`、`notation: "inferred"`、
`source_tracks`、`source_events`、`represented_events`、`pitched_notes`。
不能把 notes 数量当 events 数量，也不能只修改 `status` 来声称完成。

当前封闭 command 集合为：

- `instrument_program`、`bank_select`（`most_significant` / `least_significant`）、
  `volume`、`pan`、`expression`、`reverb_send`、`chorus_send`
- `key_pressure`、`channel_pressure`、`initial_controller_reset`、`initial_sustain_off`
- `initial_pitch_bend_sensitivity`（下面的受限六步24初始化）、
  `initial_pitch_bend_sensitivity12`（独立的起音前12初始化）、`smpte_offset`（仅第 3.5 节的零 origin）
- `tempo`、`meter`（含节拍器分组字段）、`key_signature`、`sequence_number`、`track_end`
- `text`，其 role 只能是 `text`、`copyright`、`track_name`、`instrument_name`、
  `lyric`、`marker`、`cue`、`program_name`、`device_name`

不存在 `unknown`、原始 MIDI 字节、任意 controller 对象或源文件 byte offset 字段。
普通 UTF-8 文本提示有长度和内容限制；VSQ `DM:` 工程块不允许伪装成 text。
其中 FF09 `device_name` 是逻辑输出路由，不能当作无影响说明文字忽略；见第 3.6 节。

`tempo.microseconds_per_quarter` 是权威时钟，当前为 100,000–6,000,000 的整数。
无零时刻 tempo 时采用 MIDI 默认 500,000 微秒/四分音符，无零时刻 meter 时采用 4/4；
这些是推导默认值，不虚构源事件。缺失调号不会自动宣称 C 大调。跨速度变化的音符
须分段积分；`notation.tempo.bpm` 只是与精确时钟对应的显示值。

目前严格 profile 不接受打击乐通道、同音高歧义重叠、跨轨释放、同一通道同刻跨轨
事件排序歧义、未解析路由、活动踏板、pitch bend、未知元数据、SysEx 等。
控制初始化支持已验证的零时刻 reset/sustain-off 组合，以及下述独立的 RPN 0 初始化，
不是任意 CC/RPN 支持。
该 profile 的 canonical 音符必须有音高、无连音线且唯一对应按键释放区间；
`repeats` 为空，因为这里保存已展开的实际序列。遇到不支持内容必须失败并说明原因，
不能丢事件、换成钢琴或输出片段后标记“完整”。

原有24半音初始 RPN 仍只允许 `initial_pitch_bend_sensitivity { channel, step }` 的六个有序步骤：
`select_most_significant_zero`、`select_least_significant_zero`、`set_semitones24`、
`set_cents_zero`、`deselect_most_significant`、`deselect_least_significant`。
它们分别表示 CC101=0、CC100=0、CC6=24、CC38=0、CC101=127、CC100=127；每步
独立计入源事件覆盖。没有自由数值 sensitivity 字段。

每个涉及的通道只能有一组，全部在 tick 0，同一源轨、连续源事件坐标、严格顺序；
整个文件中该通道只能由这一轨拥有。该通道上只有 program 可先于组，metadata
可以先出现但不能打断六步。不能与 reset/sustain-off 在同通道混用，也不许可活动
pitch bend、其他参数、调音或改值。参考播放器显式执行这组状态，在居中 bend 下
保持原 key；不通过忽略命令来通过能力检查。见[初始灵敏度](INITIAL_MIDI_SENSITIVITY.md)。

另有独立的 `initial_pitch_bend_sensitivity12 { channel, step }`，四个封闭步骤为
`select_least_significant_zero`（L）、`select_most_significant_zero`（M）、
`set_semitones12`（S）、`set_cents_zero`（C）。只允许 L,M,S,C；L,M,L,M,S,S,C,C；
M,L,M,L,S,S,C,C 三种整组序列，分别保留每次 CC100=0、CC101=0、CC6=12、CC38=0。
重复写入仍是独立源事件；没有 deselect，RPN0 保持选中。

12初始化不要求 tick0，但时刻必须非负、单调，整组必须在首个 attack/release/key-pressure
之前完成；同刻以原始源事件顺序为准。每通道一组，整个通道由唯一源轨拥有，源事件坐标
连续。组前可有 program/bank/volume/pan/expression/reverb/chorus；任何事件均不得打断组。
不接受其他 selector、任意值、缺步、未审查的重复或顺序、后续 data entry、第二组、共享轨
路由或任何 pitch bend（包括居中值）。两种 clean JSON 重载都会重新验证语义、时间和覆盖。
参考 receiver 自己从居中 bend 开始，逐步应用12/零 cents并保持原 key；非零 bank 仍然
阻止参考播放。严格音符配对和乐器适配仍需独立通过，typed 成功本身不产生练习目标。
同一通道不能混用 reset/sustain-off 与12初始化；原有24半音六步的边界不变。

### 3.3 typed MIDI：完整独立事件，记谱和练习目标不可用

`wmh-performance-midi1-v1` 不调用 canonical 音符配对器。完整 score 顶层 `id`
为 1–200 个 ASCII 字母、数字、`-` 或 `_`；`title` 为非空、最多 1024 UTF-8 字节的
受限普通文本。`notation` 必须是 JSON `null`，不是字符串 `"null"`、空对象或假乐谱。

`performance` 只有 `profile`、`end`、`tracks`、`parts`、`events`，**没有 `notes`**：

| 对象 | 当前字段与含义 |
| --- | --- |
| track | `id`, `name`, `source_index`, `source_event_count`, `end`；与严格 profile 一样保留全部源轨和结束位置 |
| part | `id`, `track_id`, `channel`, `sound_identity: "unspecified_midi_route"`；每个实际出现的轨/通道路由都有身份，包含只有控制命令的路由 |
| event | `event_id`, `at`, `origin`, `command`；`event_id` 固定由 `midi:<source sha256>:t<track>:e<event>` 组成 |
| key command | `key_attack` 或 `key_release`，都有 `part_id`, `channel`, `key`, `velocity`；起音 velocity 1–127，释放 0–127 |

每个源事件只对应一个 typed event；包括独立释放、同音高重叠、打击乐路由和静默
指挥轨。零力度 note-on 规范化为 velocity 0 的释放，原线缆编码不保留。
源释放可以没有可证明的配对；不得补一个时长，也不得把参考播放器的 FIFO 配对
写回文件。`at` 仍为精确四分音符有理数，时间和同刻源坐标顺序都必须通过 Rust 校验。

`coverage` 分为三个对象：

- `performance`：`status: "complete"`，以及实际重算的 `source_tracks`、
  `source_events`、`represented_events`、`key_attacks`、`key_releases`
- `notation` 与 `targets`：分别为 `status: "unavailable"`、`represented_attacks: 0`、
  `reason: "not_derived_from_independent_events"`

当前即使某些起音可能将来能够配对，也不能自行填入部分 notation 或非零 target
coverage。允许局部目标将需要另一套经审查的证据绑定；不能以裁剪后的子曲冒充完整源曲。

command 还支持 program、bank、volume、pan、expression、`sustain`、受限
`initial_controller_reset`、`initial_pitch_bend_sensitivity12`（第 3.2 节三种起音前序列）、
reverb/chorus send、key/channel pressure，以及 tempo、
meter、key signature、sequence number、text、track end 和第 3.5 节的 `smpte_offset`。
`sustain { channel, value }` 保留全部 0–127 值；它与严格 profile 的
`initial_sustain_off` 不是同一命令。严格 profile 的原有24半音六步 RPN **尚不属于 typed
converter 的词汇**，不能把“更完整”理解为它包含所有严格 profile 的初始化能力。
另有 `pitch_bend { channel, value }` 保留原始 0–16383 值，中心为 8192；弯音通道必须
由单条源轨拥有。其独立参考规则默认 2 半音，允许已验证的起音前12设置，不接受24设置
或任意 RPN。每个值在原始时刻调整按键及踏板保持声部，不移动原始键值，不生成记谱、
指法或评分目标。打击乐弯音和不受支持的声学范围仍阻止播放；详见
[弯音参考边界](REFERENCE_PITCH_BENDS.md)。严格记谱 profile 仍拒绝所有弯音。
未知 CC、未解析路由、SysEx/系统设备消息和不支持的文本仍阻止整曲转换。
同通道同刻跨轨事件的歧义仍不接受。

typed 的 `initial_controller_reset` 只表示 CC121=0：必须在 beat 0、该通道尚无
attack/release/key-pressure、整个通道属于一条源轨；下一个**同通道**事件必须是同轨、
beat 0 的 `sustain { value: 0 }`。其他通道事件或非通道 metadata 可以介入，合法的
初始组合可以重复；这与严格 profile 的单组初始化限制不同，不是曲中任意 reset。

typed tempo 允许 1–16,777,215 微秒/四分音符（比严格 profile 范围宽）；无初始值时
采用 500,000。meter 保留分组，不因无记谱而强制其 `thirty_seconds_per_quarter`
等于 8，但必须非零。运行时只积分 PPQ 与 tempo，保留字符串分子的精确微秒，
完整时长包括所有 track ends；其 24 小时界限也在 authoritative JSON 校验中检查。
没有 `compilation`、note interval、评分 timeline 或从 BPM 反推的浏览器时钟。

原生 load 的外层 `score_json` 是 JSON null；`clean_package.score_json` 仍是精确的
完整文件字符串，`runtime` 是 Rust 派生的 hash-bound 事件 DTO，摘要为
`notation_available: false`。能保存不等于能听：还需第 6 节所述显式参考策略及所有
命令的渲染能力检查。完整实现参考 [typed profile](CLEAN_PERFORMANCE_PROFILE.md) 和
[原生消费者](CLEAN_PERFORMANCE_NATIVE_BRIDGE.md)。

### 3.4 VSQ：创作语义与显式器乐练习

VSQ clean profile 保留受支持的 DSB301 创作结构和独立命名引擎调度：

- `authoring` 保存 PPQ、全部 tempo/meter origins、PreMeasure、master/track/EOS
  结束位置、mixer、全部轨、singers、音符、歌词/音素、精确小数、vibrato 和曲线
- `engine_dispatch.profile` 为 `wmh-vocaloid2-named-dispatch-v1`；命名指令与
  源控制记录范围、创作音符和歌手绑定；不会导出原始 controller 数组或工程文本
- `notation` 必须等于完整创作数据的合法投影，不能只保存当前目标轨或未静音轨
- `coverage.status` 为 `structurally_complete_authoring_and_named_dispatch`，
  `coverage.notation` 为 `all_authored_base_notes`
- `coverage.project` 分别计 tracks、notes、singers、lyrics、vibratos、envelope_points、
  curves、curve_points、tempo_changes、meter_changes；`coverage.named_dispatch`
  分别计 tracks、commands、parameter_fields、source_controller_records_accounted

VSQ 的单位不是 MIDI `represented_events`。它的完整性声明限于受支持的创作与命名
调度结构；不宣称已解释所有调度延时、声音引擎参数或已复现人声。

能力声明固定为 `whole_vocal_rendering: "blocked"` 和
`instrumental_practice: "requires_explicit_base_note_choice"`。原生 load 返回
`runtime: null`；只有显式选择 `base_notes_instrumental` 才调用 Rust
`compile_practice`，生成 `wmh-vsq-base-note-practice-v1`。选择 `full_vocal` 被拒绝，
不会自动回退器乐。重新加载或重启后必须重新选择。

基础音符练习保留项目 tick、原始 note/part/singer ID；练习时钟减去 PreMeasure，
记谱与 authoring 仍保持原项目位置。整数 tempo 只在 Rust 中积分；runtime 精确微秒
使用字符串 `numerator` 与整数 `denominator`，只在调度边界派生毫秒。
超过 24 小时的练习 runtime 被拒绝，源数据的保存能力与运行能力分别判断。

必需的八项 `interpretation_limits` 不能删除或重排：

1. `whole_vocal_rendering_unavailable`
2. `practice_uses_authored_base_notes_only`
3. `pitch_bend_and_sensitivity_not_rendered`
4. `vibrato_and_expression_not_rendered`
5. `lyrics_and_phonetics_not_synthesized`
6. `source_voice_program_is_descriptor_not_general_midi`
7. `mixer_gain_pan_and_output_mode_not_interpreted`
8. `engine_dispatch_timing_and_acoustic_tails_not_rendered`

原始 Dynamics（包括 0）保留，但当前练习参考力度固定为 90；不能因此漏掉音符。
mute/solo 初始化可逆的伴奏选择，仍保留所有音符与分部。源 fader/pan/output mode
的声学解释不做猜测。详见 [VSQ profile](VSQ_CLEAN_PROFILE.md)、
[命名引擎指令](VSQ_ENGINE_COMMANDS.md)、[原生桥接](VSQ_NATIVE_BRIDGE.md)。

### 3.5 两种 MIDI profile 的零 SMPTE origin

两种 MIDI 完整 profile 都支持 `smpte_offset`，其中只有 `timecode` 对象：
`frame_rate`、`hours`、`minutes`、`seconds`、`frames`、`fractional_frames`。
rate 只允许 `fps24`、`fps25`、`drop_frame30`、`fps30`；其他五个字段都必须为 0。
原始 SMF 的长度、保留位和数值范围在解码时另外检查，不能先掩码掉非法值。

最多出现一次，在源 track 0、tick 0，且早于该轨任何 channel message；其他轨的
tick-zero 消息不据此建立跨轨先后关系。重复相同 origin、冲突 rate、其他轨、晚于
零时刻、非零时间分量均拒绝。它保留为一个真实源事件并计入 coverage。

这只承认绝对时间原点为零，不移动 PPQ/tempo 导出的相对时钟，不支持 SMPTE time
division、非零 timecode 算术或外部设备同步。`drop_frame30` 只保留原始 rate 身份，
不能当成非 drop 的 30 Hz 时钟。它也不是媒体的 `offset_ms`。
见[零 SMPTE origin](ZERO_SMPTE_ORIGIN.md)。

### 3.6 FF09 DeviceName：显式单逻辑设备映射

`text { role: "device_name", text: <完整原名> }` 保持原有格式，但其语义是逻辑
输出设备。[MIDI RP-019](https://amei.or.jp/midistandardcommittee/Recommended_Practice/e/rp19a.pdf)
规定同一轨只能有一个 DeviceName，且须先于可发送 MIDI 事件以及 ProgramName、bank、
program；多轨可指向同一名字，另一台机器的软件／用户选择实际输出。

当前只支持把一个完整、明确的命名设备显式映射到用户选择的 WMH 程序参考合成器：
每条产生通道命令的源轨都须在 tick/beat0、其首个通道命令和 ProgramName 之前拥有
唯一且完全相同的名字。WMH 名称规则为有效 UTF-8、最多4096字节、至少一个非空白字符、
不含 Unicode 控制字符；有意义的首尾空格和大小写原样保留。这是 WMH 边界，并非 RP-019
的编码要求。既有不透明数据限制仍适用：去掉行首 Unicode 空白后以 `DM:` 开头的行、
超过256字节的 ASCII 字母数字／`+`／`/`／`=` 连续词均拒绝；其他文字校验不变。同刻依据源事件坐标，不能事后重排。无通道命令的无名指挥轨
可保留；命名静默轨也须满足同名、单次、零时刻与顺序要求。命名文件中每通道只属一条源轨。

重复或改变名字、多设备名、空白名、混用命名／默认路由、晚声明和共享通道均未解析；
port/channel-prefix/SysEx 仍不支持。源事件、原名、坐标与精确时刻不删除、不改名、不合并。
严格 importer 必须先证明设备范围再配对音符；严格 clean JSON 重载再次验证。
typed 可以保留结构上支持但路由未解析的独立事件，仍须通过既有结构歧义检查；不因此
获得记谱、练习或参考播放能力。两种参考 receiver 都显式检查路由，未解析时阻止播放。

中英文声音选择显示确切逻辑设备名及其到 WMH 参考输出的映射；名字只标识路由，不能证明
GM、原声库、bank121 或音色。无 DeviceName 的来源保持既有行为。详见
[单逻辑设备路由](MIDI_DEVICE_ROUTING.md)。

## 4. 可选媒体、默认表现与时间偏移

每个 `media` 项包含 `id`、`role`、`path`、`mime`、`bytes`、`sha256`、`rights`。
`id` 为 1–128 个 ASCII 字母、数字、`-` 或 `_`，曲内唯一；文件不能为空。
`bytes` 与哈希必须匹配实际文件。不是只校验扩展名，还校验 MIME 和容器/文件签名；
这不保证当前 WebView 支持该文件使用的具体编解码器。

| role | 数量与允许格式 | `offset_ms` / `parts` | 当前实际消费 |
| --- | --- | --- | --- |
| `cover` | 至多 1；PNG/JPEG/WebP | 均不能有非 null 值，推荐省略 | 曲目封面 |
| `background` | 至多 1；PNG/JPEG/WebP | 同上 | 演奏界面背景 |
| `pv` | 至多 1；MP4/WebM | 必须有整数 offset；无 parts 绑定 | 跟随歌曲时钟的静音视频 |
| `full_mix` | 至多 1；WAV/MP3/Ogg | 必须有整数 offset；无 parts 绑定 | 校验、保存、导出；当前不作为播放音源 |
| `stem` | 可多项；WAV/MP3/Ogg | 必须有整数 offset；`parts` 必须为非空且不重复的现有 part ID 数组 | 校验、保存、导出；当前不作为播放音源 |

stem 的 part 集合按 profile 取得：严格 MIDI/VSQ 来自 `notation.parts`，typed MIDI
来自 `performance.parts`。绑定 typed 路由并不表示这些路由有可评分的音符。

MIME 与扩展名的对应是 `image/png`/`.png`、`image/jpeg`/`.jpg` 或 `.jpeg`、
`image/webp`/`.webp`、`video/mp4`/`.mp4`、`video/webm`/`.webm`、
`audio/wav`/`.wav`、`audio/mpeg`/`.mp3`、`audio/ogg`/`.ogg`。
不支持 SVG、HTML、CSS、JS、远程 URL、data URI 或可执行皮肤。

`offset_ms` 范围是 −86,400,000 到 86,400,000，定义“媒体零时刻位于歌曲时钟的何处”。
PV 的媒体时间 =（歌曲时间 − offset）/1000 秒：正值延后起播，负值在歌曲零时刻
已进入媒体内部。必须显式写出 0，不能把 timed asset 的缺失字段当默认零。
这个字段只属于 timed media，不是整首 MIDI、VSQ 项目或乐谱的通用时间修正。

没有声明媒体是合法的：使用应用通常的曲目/背景显示，PV 不显示，不会下载替代素材。
声明了文件却缺失、大小或哈希错误时，该曲包不能通过导入；导入后出现浏览器解码
错误则报告可选媒体错误、释放资源，保留已验证的音乐。PV 默认静音且不开自动播放；
用户主动播放后才获得播放许可。暂停、换曲、退出会停止旧媒体并撤销旧资源。

**VSQ 当前端到端边界：** 原生 v2 容器可以校验和保存 VSQ 的媒体描述，但目前
VSQ 前端 admission 明确要求 `media: []`，离线 VSQ 转换器也只生成空媒体列表。
因此要在当前 VSQ 界面中使用，必须使用无媒体曲包；不能把原生存储支持说成
VSQ 封面/PV 已集成。严格 MIDI clean 路径已消费上述视觉媒体。
typed MIDI 接收媒体描述并可在预览显示 cover；当前试听停留在曲库预览，不进入
canonical 演奏舞台，background/PV 未接入它的试听时钟，仍只保留供导出。

## 5. 路径、大小与严格校验

两类相对路径规则有意不同：

- ZIP/manifest 的路径是 UTF-8、最多 1024 字节；不能绝对定位，不能含反斜杠、
  冒号、控制字符、空段、`.` 或 `..` 段。外层文件夹可以是中文。ZIP 名称以
  Unicode 小写比较拒绝大小写歧义；文件/目录碰撞也拒绝
- 曲内媒体路径必须以 `media/` 开始，最多 512 ASCII 字节、8 段；每段只含字母、
  数字、`-`、`_`、`.`，不以 `.` 开头，不以 `.` 或空格结尾；拒绝 Windows
  保留名 `CON`、`PRN`、`AUX`、`NUL`、`COM1`–`COM9`、`LPT1`–`LPT9`
  （含这些名字加扩展名）。媒体路径按 ASCII 大小写折叠后必须唯一

别把 ZIP 里的宽松外层目录规则误用于媒体文件。原生导入不会把用户路径直接解压成
本地文件系统路径；它先检查清单，再写入由本地库生成的存储位置。

| 范围 | 当前上限 |
| --- | --- |
| 每曲 metadata.json | 256 KiB |
| 原生 clean score.json | 16 MiB |
| 派生 canonical notation JSON | 存在 notation 时为 8 MiB，另须通过现有 canonical 校验；不把此上限当作 typed 全事件文件上限 |
| 单张 cover/background | 16 MiB |
| 单个 PV/full_mix/stem | 64 MiB |
| 每曲全部文件之和 | 128 MiB；最多 32 个媒体、64 个媒体目录前缀 |
| ZIP 传输 | 压缩后 128 MiB、展开 2 GiB、单文件 64 MiB、1–4096 个 ZIP entries |
| 曲目数 | manifest 最多 1024；还受上述字节和 entry 上限限制 |
| MIDI 严格转换输入 | 5 MiB、128 轨、250,000 事件、100,000 音符 |
| typed MIDI 转换 | 原始输入 5 MiB、128 轨、250,000 事件；至多 128×16 个轨/通道路由；不声称配对音符数 |

普通 ZIP 只支持 stored 或 DEFLATE；拒绝加密、多卷、前置可执行内容、重叠记录、
符号链接、设备/特殊文件和名称变换型 UnicodePath extra。不要生成 ZIP64 容器；
实现只容忍与中央目录完全一致的特定 local ZIP64 大小占位，不是通用 ZIP64 支持。

限制需要**同时**满足。原生还限制 JSON 响应（open 内容预检 31 MiB，协议响应
上限 32 MiB），并限制导入中累计 metadata/报告等资源。极限大小的各文件未必能
组合成功。VSQ 核心 decoder/encoder 的 64 MiB 上限高于原生曲包的 16 MiB：
离线转换成功不能证明可直接导入原生库。

当前没有独立的 v2 manifest/metadata JSON Schema；权威实现是
[`clean_package.rs`](../crates/desktop-shell/src/clean_package.rs) 与
[`song_pack.rs`](../crates/desktop-shell/src/song_pack.rs)。
[`schema/worldmusichub-song-folder-v1.schema.json`](../schema/worldmusichub-song-folder-v1.schema.json)
和 pack-v1 schema **只对应旧版容器**。

完整音乐的结构 schema 分别是
[`schema/worldmusichub-complete-score-v1.schema.json`](../schema/worldmusichub-complete-score-v1.schema.json)
和 [`schemas/vsq-complete-score-v1.schema.json`](../schemas/vsq-complete-score-v1.schema.json)。
它们分别对应严格 MIDI v1 与 VSQ v1；目前 typed score v2 没有单独的 JSON Schema，
其封闭结构与跨字段校验由
[`clean_performance.rs`](../crates/score-core/src/clean_performance.rs) 负责，不能套用 v1 schema。
Schema 通过仍不等于语义通过：源事件覆盖、跨层 ID、精确时间、再生记谱、权益字段、
媒体文件清单/签名/哈希以及播放权限都需相应 Rust 校验。

## 6. 人的目标分部、机器伴奏与渲染能力

完整 score 不因选择或静音某一分部而改变。对有记谱与练习目标的严格 MIDI/VSQ，
听歌时可听参考演奏；练习时选择恰好一个人的
目标 part，机器把它静音，只对这部分人的输入评分，其他 part 可各自开关伴奏。
机器伴奏不会成为演奏输入证据。目标分部与钢琴/吉他练习乐器分别选择。

严格 MIDI 当前播放器声明 `wmh-procedural-reference-v1`：使用程序化参考音色，而非声库、
插件或原录音。初始接收器默认 program 0、volume 100、expression 127、pan 64；
这些是播放器默认值，不会写回原文件证据。Program 与控制状态按通道保持，
分部静音只控制其发声，不删除共享状态。松键力度保留，但不改变此参考包络。

当前参考渲染可处理程序家族、volume/expression/pan 和声明的参考混响；非零 bank、
非零 chorus、压力命令会阻止该渲染器播放，即使完整 score 本身可以合法保存。
因此应分别报告：转换是否完整、记谱是否可用、所选渲染器是否可用。
`full_mix` 不能承诺单乐器静音；当前录音混音与 stems 均不叠加到参考合成音源上。

### typed MIDI 的显式参考策略

typed 曲目在现有曲库预览中显示全部轨、起音数及“记谱/练习目标不可用”。
只有所有保留指令都可由接收器执行，且用户勾选当前参考策略，才允许播放。
曲中没有扩展控制时策略为 `wmh-original-reference-fifo-v1`；出现 volume、expression、
pan、reverb、sustain、初始 reset、bank 或 chorus 命令时为
`wmh-original-reference-fifo-controls-v2`。这是派生的播放器策略，不改变 score 的
`performance.profile`，也不是可以写入 metadata 的 playback-choice 字段。

每次 attack 创建独立发声层；release 在同一 channel/key 上关闭最早仍按住的层
（FIFO），未匹配 release 仍有明确响应，未释放层到全曲 end 停止。程序化音色家族
和声明的参考打击乐映射（含 85/86/87 的替代音）不保证原音色或原鼓组。
FIFO 门控时长不是源音符时长，不能送去五线谱、指法或评分。

controls-v2 的解释严格限定为：

- CC64 的 `sustain` 值 64–127 为踩下、0–63 为抬起。release 先消费最早仍按住的层，
  已抬键但被踏板保持的层不再占 FIFO 按键队列；抬踏板或全曲 end 才结束其发声
- volume/expression 的声道增益为 `(volume/127) × (expression/127)`，默认 100/127，
  影响当前及后续发声，包括踏板保持层；pan 默认 64，0/64/127 精确映射为 −1/0/+1，
  中心两侧线性映射至 StereoPanner 的等功率声像
- reverb 默认 0，使用声明的 WMH Reference Room v1；全曲 end 在下游准确关闭尾音，
  暂停/停止也断开所有发声与效果尾音
- 合法初始 reset 只恢复 expression 127 与 sustain off；保留 program、bank、volume、
  pan、reverb，后续显式 sustain-zero 事件仍独立消费
- bank 的 MSB/LSB 均只允许零；chorus 零表示关闭。非零 bank/chorus、key/channel
  pressure 或未映射的打击乐 key 会阻止**整个参考演奏**，不会静默忽略

通道控制作用于所有使用该通道的轨。独立轨仅在停止时可切换静音，静音不删除事件或
共享控制；共享通道的轨不能独立静音。暂停清除所有声源，继续时重放先前控制状态，
为剩余 FIFO/踏板门控重新启动参考包络，并按原顺序执行恢复位置上的事件；这不是
原录音的无缝恢复。任意 seek 不支持，Stop 回到零。全局最多 128 个同时调度的声音，
超限、错过截止时间或分配失败均停止整次演奏，不偷换声部。换曲或导航撤销策略选择。

typed 曲目的 Practice、canonical 钢琴/吉他舞台、记谱、跟谱、指法建议与评分均不可用。
保存成功、完整覆盖或勾选策略都不能消除接收器阻断条件。

### 有目标曲目的原生时钟与变换边界

严格 MIDI 和显式选择后的 VSQ 使用原生完整曲目时钟生成钢琴/吉他指法建议，
绑定存储键、内容哈希、profile 和 VSQ choice。规划输入不接受前端自行提供的 score
或 timeline，也不在 JS 里用近似 BPM/PreMeasure 偏移重算。原接口为
`/api/library/fingering/piano`、`/api/library/fingering/guitar`；typed/null-notation
不能回退到普通乐谱规划以制造目标。见[完整曲目指法时钟](COMPLETE_SONG_FINGERING.md)。

当前有目标完整曲目的改速、A–B 循环、节拍器和移调副本操作受限；不能只修改 notation
却继续播放旧 performance。普通 notation-only 保存/备份不能替代完整曲包导出。
运行时边界详见 [MIDI runtime](CLEAN_SONG_RUNTIME.md) 和
[VSQ 前端桥接](VSQ_FRONTEND_BRIDGE.md)。

## 7. 存储、重复、冲突与导出

原生曲库先在暂存目录写 `score.json` 和逐个验证的媒体，最后写 `metadata.json`，
同步后发布完整主副本与独立备份。两个副本都完整且一致才列为正常曲目。
暂存失败不显示为完成；提交结果不确定时，应刷新曲库确认/恢复后再重试。
只有主副本缺失时才从已验证备份恢复；不会覆盖已存在但损坏的用户文件。

本地实现使用 `clean-songs`、`clean-backups`、`.clean-staging`，每个条目还带有
本地 `entry.json`。它们是存储实现，不是 ZIP 应该复制的结构。
clean 主副本、备份和未完成暂存总计受 3 GiB 限制；还受原生库 1024 条目与
256 MiB 索引音乐载荷累计限制：有记谱时计 canonical notation，无记谱 typed 条目则计
完整 score 字节。同样，typed 本地条目的 score 字节数/哈希指完整文件，不是假乐谱。
备份在同一台机器上，不能代替外部备份。

内容身份来自 Rust 规范序列化的 metadata 的 SHA-256，其中已绑定精确 score 字节
和每个媒体哈希。本地键为 `song-<content_sha256>`：

- metadata 的空白或对象属性顺序变化不产生新内容身份；数组顺序和字段值仍有意义
- score 的字节变化（即使只改空白）会改变其哈希及内容身份；本地显示标签不是音乐身份
- 相同内容重导入报 `duplicate`；同一 score ID 的不同内容报 `conflict`，必须显式
  “保留两者”才能另存版本。相同内容不因“保留两者”复制出第二份
- 多曲导入逐项报告 `ready`、`saved`、`duplicate`、`conflict`、
  `retained_nonplayable`、`error`；批次可以部分成功，不能只用总数宣称全部完成
- VSQ 可以 `saved` 而 `playable: false`，这是等待显式练习选择，不等于丢失创作数据
- typed 条目也可 `saved` 而 `playable: false`：它没有普通练习能力；能否显式参考试听
  另看接收器能力，不能把该导入标记直接当作删除或丢弃条目的理由

clean 导出通过本地键选择文件，保留验证过的两个 JSON **精确字节**及每个媒体，
生成根目录 manifest。MIDI 与 VSQ clean 可以一起导出，旧 v1 曲目须另选另导。
前端不得解析再重写 VSQ authoring 作为持久化路径：其整数/精确小数可能超过
JavaScript 安全整数范围。原始 metadata/score 字符串与原生导出是保存边界。

导入历史另行私有保留收到的完整原始输入及报告，供原件恢复。
`/api/library/import/export` 的原件导出与 `/api/library/pack/export` 的 clean 曲包
导出不同；前者可能包含原始作品，不应当作 clean 交付包。

## 8. 实际转换和导入入口

### 内置完整 MIDI 草稿 API

当前源码新增无状态 `POST /api/clean-song/draft`，从完整原始 MIDI 与用户标题生成
绑定精确字节的 metadata/score，以及包含全部源轨、通道和事件计数的检查清单。
结果明确区分严格记谱候选、独立事件参考候选和整曲拒绝；转换成功不代表播放器或
评分能力通过。`POST /api/clean-song/draft/pack` 按已检查草稿的指纹重新校验并生成
同一格式 ZIP，复用原生 clean 导出的写入器，不自动保存或切换当前曲目。
具体请求、上限、失败和原生保存边界见[内置转换 API](CLEAN_CONVERSION_API.md)。
这些源码接口不表示已经完成 Windows/浏览器发行验收。

### 严格 MIDI 离线 CLI

生产转换 API 为 `score_core::clean_song::{convert_midi, validate, encode_json,
decode_json, compile_complete}`。CLI 从 stdin 读取原始 MIDI，输出完整 score：

```sh
cargo run --locked -p score-core --example clean-song-convert < original.mid > score.json
cargo run --locked -p score-core --example clean-song-convert -- --runtime < original.mid > runtime.json
cargo run --locked -p score-core --example clean-song-convert -- --validate-runtime < score.json > reloaded-runtime.json
```

不支持的输入非零退出，不输出部分 score。Shell 的 `>` 仍可能留下空文件，不能仅凭
文件存在判断成功。此 CLI **只输出 score 或测试用 runtime**，并不自动生成 metadata、
媒体、文件夹或 ZIP；制作可导入文件夹还须按本参考绑定 metadata 并通过原生校验。
runtime 文件应放在曲包之外。

### typed MIDI 全事件离线 CLI

生产 API 为 `score_core::clean_performance::{convert_midi, validate, encode_json,
decode_json, compile_performance}`；`convert_midi` 接收原 bytes、调用者提供的 ID/title。
CLI 使用固定 ID `midi-performance`、title `MIDI performance`：

```sh
cargo run --locked -p score-core --example clean-performance-convert < original.mid > score.json
cargo run --locked -p score-core --example clean-performance-convert -- --runtime < original.mid > runtime.json
cargo run --locked -p score-core --example clean-performance-convert -- --validate-runtime < score.json > reloaded-runtime.json
```

它同样只输出 score 或派生 runtime，不生成 metadata/ZIP，不作 reference-policy 选择。
批量使用固定 CLI ID 可能在曲库形成同 ID 不同内容的冲突；应通过 API 设置稳定且
正确的曲目 ID，或明确按冲突流程保留两者，不能依靠文件夹名字改变音乐身份。
typed 转换成功不代表严格配对、RPN 初始化、reference playback 或 graded practice 成功。

### VSQ 离线 CLI

```sh
cargo run --locked -p score-core --example convert_vsq_clean -- INPUT.vsq OUTPUT_DIR
```

`OUTPUT_DIR` 必须不存在。转换器先验证，再独占创建目录，写入/同步 `score.json`，
最后写入/同步 `metadata.json`；不替换既有文件、不删除原输入。失败可能留下新建的
不完整目录，不能把它当成成功曲包。默认权益为 `user_supplied_unverified`，
`media: []`。这不是整曲人声生成命令。

### 应用内入口和后续工作

当前 Windows 原生曲库的批量导入预览/提交入口接收这些 ZIP；导出入口按本地曲目键
创建包。现有普通 MIDI 导入调用的是 canonical `import_midi`，不是自动执行上述
全轨 clean 转换器。不要把“能导入 MIDI”理解为“已经一键生成完整曲包”。
普通网页原型也不具备原生文件系统曲库能力。

原生协议的具体路径是 `POST /api/library/import/preview`、
`POST /api/library/import/commit`（ZIP 请求体）、`POST /api/library/pack/export`
（`keys` 数组），以及 VSQ 显式选择的 `POST /api/library/runtime`
（`key`、`profile: "wmh-vsq-clean-v1"`、`choice: "base_notes_instrumental"`）。
这是原生宿主的协议接口，不表示存在可向远端访问的文件系统 HTTP 服务。

typed 全事件的原生存储、导出及显式参考试听已经接入当前源码；controls-v2 和仅零值的
SMPTE origin 也按本文边界消费。将原始 MIDI 转换、明确失败原因、metadata/ZIP 生成
整合成应用内一键作者流程，以及 Android 原生宿主/资源与音频实现，仍是后续工作，
各自需要完成和验收。更宽的控制器/调音、非零源 timecode、typed 目标推导需要另外审查；
不要将试验字段混入现有封闭对象，也不要承诺这些已接入能力让任意歌曲都可播放。

## 9. 旧备份与版本兼容

- 旧 `worldmusichub-song-pack` / `worldmusichub-song` v1 保持旧读取路径；其 score
  是 canonical 记谱，媒体/来源表示与 v2 不同，不自动获得全轨语义完整性
- `worldmusichub-library-backup` v1、`worldmusichub-native-score-backup` v1 可按
  原导入路径恢复旧乐谱；不能把版本号改为 2 就升级为完整曲包
- 从旧备份升级需要找回完整原始输入，用对应 clean 转换器重新转换，再制作/验证
  新包。若备份只剩记谱视图，缺失的事件、控制器、轨道或媒体不能凭空恢复
- 旧原件保留记录是审计/恢复资料；即使能派生可练习记谱，也不能把它等同于
  通过当前 profile 覆盖校验的 clean 包。新旧版本并存，不破坏性重写旧曲库
- 未知容器版本、未知 score/profile 或超出 profile 的字段拒绝解释，不自动降级；
  兼容的 producer 版本标记保留原值，不随当前构建随意改写

## 10. 可复现原创示例与验证入口

示例只用仓库原创音乐/生成媒体，不含用户提供的曲目、商业录音或声库。

| 示例 | 内容及复现来源 |
| --- | --- |
| [clean-song-v2](../tests/fixtures/clean-song-v2) | 3 轨（含指挥轨）、2 分部、5 音符、25 源事件、1.8 秒；[Rust 原创输入与往返测试](../crates/score-core/src/clean_song/tests.rs) |
| [clean-song-v2-long](../tests/fixtures/clean-song-v2-long) | 3 轨、2 分部、30 音符、74 源事件、32 秒；[Python 原创输入生成器](../scripts/generate-clean-song-long-fixture.py)调用同一个生产 converter |
| [媒体曲包生成器](../scripts/prepare-clean-song-fixtures.mjs) | 将长曲的精确 JSON 与原创 PNG/PV 装入 ZIP，生成单独的测试清单 |
| [clean-song-v2-rpn](../tests/fixtures/clean-song-v2-rpn) | 原创 4 轨、3 组严格六步 RPN（含静默设置轨）；[生成器](../scripts/generate-clean-song-rpn-fixture.py)调用严格 converter |
| [complete-performance-v2](../tests/fixtures/complete-performance-v2) | 原创 11 轨、20 起音、独立释放/重叠、参考打击乐；[Rust generator](../crates/desktop-shell/examples/generate_performance_fixture.rs)调用生产 typed converter 并生成无记谱原生响应 |
| [vsq-clean-v1](../tests/fixtures/vsq-clean-v1) | [Rust generator](../crates/desktop-shell/examples/generate_vsq_fixture.rs)直接构造原创语义测试模型；包含大于 2^53 的整数、零 Dynamics、静音轨及跨 tempo 音符 |

VSQ 语义 fixture 的源文件长度/哈希是**特意构造的证据声明**，不是实际原始 VSQ
转换真实性证据；它用于验证 profile、精确字节、原生存储与明确选择。
该区别不影响文件内部 score 哈希的真实校验。

typed fixture 的 `media/stem.wav` 是用于容器签名/字节往返的极小合成测试素材，
不提供录音播放质量证据。零 SMPTE origin 的四种 rate 身份由
[`midi_timecode.rs` 的原创测试](../crates/score-core/src/midi_timecode.rs)覆盖；
typed controls 的原创输入在
[`clean_performance/tests.rs`](../crates/score-core/src/clean_performance/tests.rs)，
不要把用于 UI mock 的描述符当作 authoritative portable package 示例。

以下命令只做离线生成/测试，不启动 GUI 或服务器。两个 ZIP 输出目录应为空或新建，
生成的 `*-fixtures.json` 留在 ZIP 外；原生导入使用 `.zip`。

```sh
node scripts/prepare-clean-song-fixtures.mjs /tmp/wmh-original-midi-pack
node scripts/prepare-vsq-song-fixtures.mjs /tmp/wmh-original-vsq-pack
node --test tests/clean-song-schema.test.js tests/clean-song-package-fixtures.test.js
cargo test --locked -p score-core clean_song --lib
cargo test --locked -p score-core clean_performance --lib
cargo test --locked -p score-core midi_timecode --lib
cargo test --locked -p score-core vsq_clean --lib
cargo test --locked -p worldmusichub-desktop --test clean_song_package --test complete_performance_package --test vsq_clean_package
```

MIDI schema 测试绑定本页 metadata 示例与完整 score 字节；原生测试覆盖完整清单、
媒体校验、目录封装、损坏/恢复、重复/冲突、VSQ 显式选择、typed null-notation/controls、混合 clean profiles 和
导出再导入。离线 tests/DOM/假音频不能证明实际 codec、真人输入、浏览器或 Windows
可执行包已验收。新发布仍需按仓库验收门槛验证对应的精确源码。
