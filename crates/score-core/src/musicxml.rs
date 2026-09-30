//! Deliberately limited, non-fetching MusicXML score-partwise importer.
//!
//! Sounding pitches and durations are authoritative. Source-only visual details
//! are retained verbatim, and unsupported playback semantics are never hidden.
use crate::{
    Beat, Diagnostic, Key, Measure, Meter, Note, Part, Pitch, Provenance, Repeat, Score, Source,
    Tempo,
};
use roxmltree::{Document, Node, ParsingOptions};
use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap, HashSet};

const MAX_SOURCE_BYTES: usize = 8 * 1024 * 1024;
const MAX_NOTES: usize = 100_000;
const MAX_PARTS: usize = 128;

#[derive(Default)]
struct Warnings {
    entries: Vec<Diagnostic>,
    seen: HashSet<String>,
}
impl Warnings {
    fn add(&mut self, code: &str, message: impl Into<String>) {
        let message = message.into();
        if self.seen.insert(format!("{code}:{message}")) {
            self.entries.push(Diagnostic {
                severity: "warning".into(),
                code: code.into(),
                message,
                note_id: None,
            });
        }
    }
    fn source_only(&mut self, name: &str) {
        self.add("musicxml_source_only", format!("MusicXML <{name}> is retained in the original source only; its notation or performance instructions are not interpreted."));
    }
}

fn elements<'a, 'i>(node: Node<'a, 'i>) -> impl Iterator<Item = Node<'a, 'i>> {
    node.children().filter(Node::is_element)
}
fn one<'a, 'i>(node: Node<'a, 'i>, name: &str) -> Result<Option<Node<'a, 'i>>, String> {
    let mut found = elements(node).filter(|n| n.tag_name().name() == name);
    let first = found.next();
    if found.next().is_some() {
        return Err(format!(
            "Duplicate <{name}> inside <{}>",
            node.tag_name().name()
        ));
    }
    Ok(first)
}
fn required<'a, 'i>(node: Node<'a, 'i>, name: &str) -> Result<Node<'a, 'i>, String> {
    one(node, name)?.ok_or_else(|| format!("Missing <{name}> inside <{}>", node.tag_name().name()))
}
fn value<'a, 'i>(node: Node<'a, 'i>) -> Result<&'a str, String> {
    if elements(node).next().is_some() {
        return Err(format!(
            "Expected plain text inside <{}>",
            node.tag_name().name()
        ));
    }
    node.text()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("Empty <{}>", node.tag_name().name()))
}
fn text<'a, 'i>(node: Node<'a, 'i>, name: &str) -> Result<&'a str, String> {
    value(required(node, name)?)
}
fn optional_text<'a, 'i>(node: Node<'a, 'i>, name: &str) -> Result<Option<&'a str>, String> {
    one(node, name)?.map(value).transpose()
}
fn cmp(a: Beat, b: Beat) -> Ordering {
    (a.numerator as i128 * b.denominator as i128)
        .cmp(&(b.numerator as i128 * a.denominator as i128))
}
fn add(a: Beat, b: Beat) -> Result<Beat, String> {
    a.checked_add(b)
        .ok_or_else(|| "MusicXML timing exceeds supported rational limits".into())
}
fn rational(mut n: i128, mut d: i128) -> Result<Beat, String> {
    if d <= 0 {
        return Err("MusicXML timing requires a positive denominator".into());
    }
    let (mut a, mut b) = (n.unsigned_abs(), d as u128);
    while b != 0 {
        let r = a % b;
        a = b;
        b = r;
    }
    let g = a.max(1) as i128;
    n /= g;
    d /= g;
    let result = Beat::new(
        i64::try_from(n).map_err(|_| "MusicXML timing is too large")?,
        i64::try_from(d).map_err(|_| "MusicXML timing is too precise")?,
    );
    if !result.valid() {
        return Err("MusicXML timing exceeds supported rational limits (denominator 1,000,000; numerator 1,000,000,000)".into());
    }
    Ok(result)
}
/// XML decimal, without float rounding, exponent notation or unbounded precision.
fn decimal(input: &str, label: &str) -> Result<Beat, String> {
    let input = input.trim();
    let (negative, unsigned) = if let Some(s) = input.strip_prefix('-') {
        (true, s)
    } else {
        (false, input.strip_prefix('+').unwrap_or(input))
    };
    let mut pieces = unsigned.split('.');
    let whole = pieces.next().unwrap_or("");
    let fraction = pieces.next().unwrap_or("");
    if pieces.next().is_some()
        || (whole.is_empty() && fraction.is_empty())
        || whole.len() > 12
        || fraction.len() > 6
        || !whole.bytes().all(|b| b.is_ascii_digit())
        || !fraction.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(format!(
            "Invalid {label}: expected an exact decimal with at most six fractional digits"
        ));
    }
    let d = 10_i128.pow(fraction.len() as u32);
    let w = if whole.is_empty() {
        0
    } else {
        whole
            .parse::<i128>()
            .map_err(|_| format!("Invalid {label}"))?
    };
    let f = if fraction.is_empty() {
        0
    } else {
        fraction
            .parse::<i128>()
            .map_err(|_| format!("Invalid {label}"))?
    };
    rational((w * d + f) * if negative { -1 } else { 1 }, d)
}
fn in_quarters(input: &str, divisions: Option<Beat>, positive: bool) -> Result<Beat, String> {
    let d =
        divisions.ok_or("Missing <divisions>: declare divisions before durations or offsets")?;
    let n = decimal(input, "duration/offset")?;
    if positive && n.numerator <= 0 {
        return Err("MusicXML note, backup and forward durations must be positive".into());
    }
    rational(
        n.numerator as i128 * d.denominator as i128,
        n.denominator as i128 * d.numerator as i128,
    )
}

struct PartState<'a, 'i> {
    part: Part,
    measures: Vec<Node<'a, 'i>>,
    divisions: Option<Beat>,
    meters: Vec<Meter>,
    keys: Vec<Key>,
}
#[derive(Clone, Copy)]
struct BeatKey(Beat);
impl PartialEq for BeatKey {
    fn eq(&self, other: &Self) -> bool {
        cmp(self.0, other.0) == Ordering::Equal
    }
}
impl Eq for BeatKey {}
impl PartialOrd for BeatKey {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for BeatKey {
    fn cmp(&self, other: &Self) -> Ordering {
        cmp(self.0, other.0)
    }
}
#[derive(Clone, Copy)]
struct RepeatMark {
    at: Beat,
    forward: bool,
    times: u8,
}
#[derive(Default)]
struct Maps {
    tempo: Vec<Tempo>,
    meters: Vec<Meter>,
    keys: Vec<Key>,
    repeat_marks: Vec<RepeatMark>,
    tempo_index: BTreeMap<BeatKey, usize>,
    meter_index: BTreeMap<BeatKey, usize>,
    key_index: BTreeMap<BeatKey, usize>,
}
#[derive(Clone)]
struct Anchor {
    at: Beat,
    duration: Beat,
    voice: String,
    pitched: bool,
}
struct MeasureResult {
    extent: Beat,
    event_extent: Beat,
    marks: Vec<(bool, bool, u8)>,
}

/// Import uncompressed MusicXML. No network, filesystem, DTD, or entity resolver
/// is used. Errors are actionable rather than silently altering unsupported music.
pub fn import_musicxml(xml: &str) -> Result<(Score, Vec<Diagnostic>), String> {
    if xml.len() > MAX_SOURCE_BYTES {
        return Err("MusicXML exceeds the 8 MiB source limit".into());
    }
    if xml.contains("<!DOCTYPE") || xml.contains("<!ENTITY") {
        return Err("DTD and entity declarations are not allowed. Export self-contained MusicXML without a DOCTYPE or external entities.".into());
    }
    let doc = Document::parse_with_options(
        xml,
        ParsingOptions {
            allow_dtd: false,
            nodes_limit: 1_000_000,
            entity_resolver: None,
        },
    )
    .map_err(|e| format!("Malformed or unsafe MusicXML: {e}"))?;
    let root = doc.root_element();
    if root.tag_name().name() != "score-partwise" {
        return Err("Only uncompressed <score-partwise> MusicXML is supported. Export partwise .musicxml (not .mxl, score-timewise, PDF or an image).".into());
    }
    for node in doc.descendants() {
        if node.is_pi() {
            return Err("XML processing instructions are not allowed; remove external stylesheet or processing references".into());
        }
        if !node.is_element() {
            continue;
        }
        if node
            .tag_name()
            .namespace()
            .is_some_and(|ns| ns != "http://www.musicxml.org/ns/musicxml")
        {
            return Err("Foreign XML namespaces and inclusion elements are unsupported; export self-contained MusicXML".into());
        }
        if matches!(
            node.tag_name().name(),
            "link" | "image" | "opus" | "part-link"
        ) || node.attributes().any(|a| {
            matches!(
                a.name(),
                "href" | "src" | "schemaLocation" | "noNamespaceSchemaLocation"
            ) || a.namespace() == Some("http://www.w3.org/1999/xlink")
        }) {
            return Err("External file/network references are not allowed. Remove linked images, links, schemas and included scores before import.".into());
        }
        if matches!(node.tag_name().name(), "ending" | "segno" | "coda") {
            return Err("Alternate endings, segno and coda navigation are not supported. Export a score with its complete playing order written out.".into());
        }
    }
    let mut warnings = Warnings::default();
    warnings.add("musicxml_limited_import", "Imported sounding notes, rests, voices, staves and basic timing. Engraving, clefs, layout, lyrics and other visual details remain in the exact original MusicXML source; this is not a lossless notation editor.");
    let work_title = one(root, "work")?
        .map(|w| optional_text(w, "work-title"))
        .transpose()?
        .flatten();
    let title = optional_text(root, "movement-title")?
        .or(work_title)
        .unwrap_or("Imported score")
        .to_string();
    let composer = if let Some(identification) = one(root, "identification")? {
        elements(identification)
            .filter(|n| n.tag_name().name() == "creator" && n.attribute("type") == Some("composer"))
            .map(value)
            .collect::<Result<Vec<_>, _>>()?
            .join("; ")
    } else {
        String::new()
    };
    for node in elements(root) {
        if !matches!(
            node.tag_name().name(),
            "work"
                | "movement-number"
                | "movement-title"
                | "identification"
                | "defaults"
                | "credit"
                | "part-list"
                | "part"
        ) {
            warnings.source_only(node.tag_name().name());
        }
    }
    let part_list = required(root, "part-list")?;
    let mut declared = HashMap::new();
    for node in elements(part_list) {
        if node.tag_name().name() != "score-part" {
            warnings.source_only(node.tag_name().name());
            continue;
        }
        let id = node
            .attribute("id")
            .filter(|s| !s.trim().is_empty())
            .ok_or("Every <score-part> needs a nonempty id")?;
        if declared.insert(id, node).is_some() {
            return Err(format!("Duplicate score-part id: {id}"));
        }
    }
    if declared.is_empty() || declared.len() > MAX_PARTS {
        return Err("MusicXML requires 1–128 declared parts".into());
    }
    let mut states = Vec::new();
    let mut part_ids = HashSet::new();
    for node in elements(root).filter(|n| n.tag_name().name() == "part") {
        let id = node
            .attribute("id")
            .ok_or("Every <part> needs an id matching its score-part")?;
        if !part_ids.insert(id) {
            return Err(format!("Duplicate part id: {id}"));
        }
        let definition = *declared
            .get(id)
            .ok_or_else(|| format!("Part {id} is not declared in <part-list>"))?;
        let name = text(definition, "part-name")?.to_string();
        let instruments: Vec<_> = elements(definition)
            .filter(|n| n.tag_name().name() == "score-instrument")
            .collect();
        if instruments.len() > 1 {
            warnings.add("multiple_instruments", "Multiple instruments in one part are source-only; the practice sound uses one instrument per part.");
        }
        let instrument_name = instruments
            .first()
            .map(|n| optional_text(*n, "instrument-name"))
            .transpose()?
            .flatten()
            .unwrap_or(&name);
        let lower = instrument_name.to_lowercase();
        let instrument = if lower.contains("guitar") {
            "guitar".into()
        } else if lower.contains("piano") {
            "piano".into()
        } else {
            instrument_name.to_string()
        };
        if elements(definition)
            .any(|n| matches!(n.tag_name().name(), "midi-instrument" | "midi-device"))
        {
            warnings.add("midi_instrument_source_only", "MusicXML MIDI programs, channels and devices remain in the source. The practice app selects its own sound for each named instrument.");
        }
        let measures: Vec<_> = elements(node)
            .filter(|n| n.tag_name().name() == "measure")
            .collect();
        for n in elements(node).filter(|n| n.tag_name().name() != "measure") {
            warnings.source_only(n.tag_name().name());
        }
        if measures.is_empty() {
            return Err(format!("Part {id} contains no measures"));
        }
        states.push(PartState {
            part: Part {
                id: id.into(),
                name,
                instrument,
                notes: Vec::new(),
            },
            measures,
            divisions: None,
            meters: Vec::new(),
            keys: Vec::new(),
        });
    }
    if states.len() != declared.len() {
        return Err("Every declared score-part must have exactly one matching part body".into());
    }
    let count = states[0].measures.len();
    if states.iter().any(|p| p.measures.len() != count) {
        return Err(
            "Parts have different measure counts; align their measures before importing".into(),
        );
    }
    // Stable source-derived identifier, not a cryptographic integrity claim.
    let hash = xml.bytes().fold(0xcbf29ce484222325_u64, |h, b| {
        (h ^ b as u64).wrapping_mul(0x100000001b3)
    });
    let score_id = format!("musicxml-{hash:016x}");
    let mut maps = Maps::default();
    let mut measures = Vec::with_capacity(count);
    let mut start = Beat::ZERO;
    let mut total_notes = 0;
    for index in 0..count {
        let first = states[0].measures[index];
        let label = first.attribute("number").unwrap_or("");
        let number = label.parse::<u32>().unwrap_or_else(|_| {
            warnings.add("measure_label", "Non-numeric or missing measure labels use sequential numbers in the practice model; original labels remain in MusicXML.");
            (index + 1) as u32
        });
        let mut results = Vec::new();
        let mut length = Beat::ZERO;
        for (part_index, state) in states.iter_mut().enumerate() {
            let measure = state.measures[index];
            if measure.attribute("number").unwrap_or("") != label {
                return Err(format!("Part {} has a different label at measure {}; align part measures before import", state.part.id, index + 1));
            }
            let result = parse_measure(
                measure,
                state,
                start,
                &score_id,
                part_index,
                &mut total_notes,
                &mut maps,
                &mut warnings,
            )
            .map_err(|e| {
                format!(
                    "Part {}, measure {}: {e}",
                    state.part.id,
                    if label.is_empty() {
                        "(unlabeled)"
                    } else {
                        label
                    }
                )
            })?;
            if cmp(result.extent, length) == Ordering::Greater {
                length = result.extent;
            }
            results.push(result);
        }
        let nominal = maps
            .meter_index
            .range(..=BeatKey(start))
            .next_back()
            .map(|(_, i)| &maps.meters[*i])
            .map(|m| rational(m.numerator as i128 * 4, m.denominator as i128))
            .transpose()?;
        if length.numerator == 0 {
            length = nominal.ok_or(
                "An empty measure has no duration or time signature; add an explicit rest",
            )?;
            warnings.add("empty_measure", "Empty measures are retained as silence using the active time signature; add explicit rests to remove this assumption.");
        }
        if let Some(nominal) = nominal {
            if !length.equivalent(nominal)
                && first.attribute("implicit") != Some("yes")
                && index != 0
            {
                warnings.add("irregular_measure", "A measure differs from the active time signature. Its explicit MusicXML duration is retained without inventing extra beats.");
            }
        }
        let end = add(start, length)?;
        for result in results {
            if cmp(result.extent, length) == Ordering::Less && result.extent.numerator > 0 {
                warnings.add("part_measure_padding", "Parts have unequal content lengths in a measure. The next measure is aligned to the longest part; shorter parts have trailing silence.");
            }
            if cmp(result.event_extent, length) == Ordering::Greater {
                return Err(format!("Measure {label}: a tempo or attribute offset falls beyond the measure; correct its offset"));
            }
            for (right, forward, times) in result.marks {
                maps.repeat_marks.push(RepeatMark {
                    at: if right { end } else { start },
                    forward,
                    times,
                });
            }
        }
        measures.push(Measure {
            number,
            at: start,
            length,
        });
        start = end;
    }
    maps.tempo.sort_by(|a, b| cmp(a.at, b.at));
    if maps.tempo.first().is_none_or(|t| t.at.numerator != 0) {
        maps.tempo.insert(
            0,
            Tempo {
                at: Beat::ZERO,
                bpm: 120.,
            },
        );
        warnings.add("default_tempo", "No playback tempo is specified at the beginning; practice playback defaults to 120 quarter notes per minute.");
    }
    maps.meters.sort_by(|a, b| cmp(a.at, b.at));
    maps.keys.sort_by(|a, b| cmp(a.at, b.at));
    validate_part_signatures(&mut states, &maps, &mut warnings)?;
    let repeats = build_repeats(maps.repeat_marks)?;
    if !repeats.is_empty() {
        warnings.add("musicxml_repeats", "Simple repeat regions are retained for playback expansion; alternate endings and navigation jumps are unsupported.");
    }
    let score = Score {
        version: 1,
        id: score_id,
        title,
        composer,
        provenance: Provenance {
            kind: "user_import".into(),
            attribution:
                "User-provided MusicXML; rights and license are not inferred from file metadata."
                    .into(),
            source_url: None,
            license: None,
        },
        parts: states.into_iter().map(|s| s.part).collect(),
        tempo: maps.tempo,
        meters: maps.meters,
        keys: maps.keys,
        measures,
        repeats,
        source: Some(Source {
            format: "musicxml".into(),
            filename: None,
            content: xml.to_string(),
        }),
    };
    crate::validate(&score)
        .map_err(|e| format!("Imported MusicXML is outside the practice model: {e}"))?;
    Ok((score, warnings.entries))
}

#[allow(clippy::too_many_arguments)]
fn parse_measure(
    measure: Node<'_, '_>,
    state: &mut PartState<'_, '_>,
    start: Beat,
    score_id: &str,
    part_index: usize,
    total_notes: &mut usize,
    maps: &mut Maps,
    warnings: &mut Warnings,
) -> Result<MeasureResult, String> {
    let mut cursor = Beat::ZERO;
    let mut extent = Beat::ZERO;
    let mut event_extent = Beat::ZERO;
    let mut anchor: Option<Anchor> = None;
    let mut division_changes = Vec::new();
    let mut marks = Vec::new();
    for node in elements(measure) {
        match node.tag_name().name() {
            "attributes" => {
                for attr in elements(node) {
                    match attr.tag_name().name() {
                        "divisions" => {
                            let divisions = decimal(value(attr)?, "divisions")?;
                            if divisions.numerator <= 0 { return Err("Divisions must be positive".into()); }
                            if state.divisions.is_some_and(|old| !old.equivalent(divisions)) { division_changes.push(cursor); }
                            state.divisions = Some(divisions);
                        }
                        "time" => {
                            let event = parse_meter(attr, add(start, cursor)?)?;
                            insert_meter(maps, event.clone())?;
                            state.meters.push(event);
                        }
                        "key" => {
                            let event = parse_key(attr, add(start, cursor)?, warnings)?;
                            insert_key(maps, event.clone())?;
                            state.keys.push(event);
                        }
                        "transpose" => return Err("Transposing instruments are unsupported. Export in concert pitch with transposition removed before importing.".into()),
                        "measure-style" => return Err("Measure-repeat, multiple-rest and slash measure styles are unsupported. Export all notes/rests written out.".into()),
                        "staves" => { let n = value(attr)?.parse::<u8>().map_err(|_| "Invalid staff count")?; if n == 0 { return Err("Staff count must be positive".into()); } }
                        "clef" | "staff-details" | "part-symbol" => warnings.source_only(attr.tag_name().name()),
                        _ => warnings.source_only(attr.tag_name().name()),
                    }
                }
                anchor = None;
            }
            "note" => {
                *total_notes += 1;
                if *total_notes > MAX_NOTES {
                    return Err("MusicXML exceeds the 100,000-note import limit".into());
                }
                let pitch = parse_pitch(node)?;
                let duration = in_quarters(text(node, "duration")?, state.divisions, true)?;
                let is_chord = one(node, "chord")?.is_some();
                let voice = optional_text(node, "voice")?.unwrap_or("1").to_string();
                let staff = optional_text(node, "staff")?
                    .unwrap_or("1")
                    .parse::<u8>()
                    .map_err(|_| "Staff must be an integer from 1 to 255")?;
                if staff == 0 {
                    return Err("Staff must be an integer from 1 to 255".into());
                }
                let at = if is_chord {
                    let previous = anchor
                        .as_ref()
                        .ok_or("A chord tone has no preceding base note at the current position")?;
                    if previous.voice != voice || !previous.pitched || pitch.is_none() {
                        return Err("Chord tones must share the base note's voice and contain pitched notes, not rests".into());
                    }
                    if cmp(duration, previous.duration) == Ordering::Greater {
                        return Err("A chord tone cannot be longer than its base note; put the longest chord tone first".into());
                    }
                    previous.at
                } else {
                    cursor
                };
                let (tie_start, tie_stop) = parse_ties(node, warnings)?;
                if pitch.is_none() && (tie_start || tie_stop) {
                    return Err("Rests cannot be tied".into());
                }
                for name in ["attack", "release", "time-only"] {
                    if node.attribute(name).is_some() {
                        return Err(format!("Note @{name} playback overrides are unsupported; export explicit note timing"));
                    }
                }
                for name in ["dynamics", "end-dynamics", "pizzicato"] {
                    if node.attribute(name).is_some() {
                        warnings.source_only(&format!("note @{name}"));
                    }
                }
                for child in elements(node) {
                    match child.tag_name().name() {
                        "pitch" | "rest" | "duration" | "chord" | "voice" | "staff" | "tie" => {}
                        "type" | "dot" | "accidental" | "stem" | "beam" | "notehead" | "notehead-text" | "lyric" | "footnote" | "level" => {}
                        "time-modification" => warnings.add("tuplet_display", "Tuplet durations are imported exactly from <duration>/<divisions>; written tuplet grouping remains in the source."),
                        "notations" => { for notation in elements(child) { if notation.tag_name().name() != "tied" { warnings.source_only(notation.tag_name().name()); } } }
                        "grace" => return Err("Grace notes are unsupported; export an explicitly timed practice arrangement".into()),
                        "cue" => return Err("Cue notes are unsupported; remove cues or convert intended sounding notes to normal notes".into()),
                        _ => warnings.source_only(child.tag_name().name()),
                    }
                }
                let end = add(at, duration)?;
                if cmp(end, extent) == Ordering::Greater {
                    extent = end;
                }
                let id = format!(
                    "{score_id}-p{}-n{}",
                    part_index + 1,
                    state.part.notes.len() + 1
                );
                state.part.notes.push(Note {
                    id,
                    at: add(start, at)?,
                    duration,
                    pitch: pitch.clone(),
                    voice: voice.clone(),
                    staff,
                    velocity: if pitch.is_some() { 90 } else { 0 },
                    tie_start,
                    tie_stop,
                });
                if !is_chord {
                    anchor = Some(Anchor {
                        at,
                        duration,
                        voice,
                        pitched: pitch.is_some(),
                    });
                    cursor = end;
                }
            }
            "backup" | "forward" => {
                let duration = in_quarters(text(node, "duration")?, state.divisions, true)?;
                let previous = cursor;
                cursor = add(
                    cursor,
                    if node.tag_name().name() == "backup" {
                        Beat::new(-duration.numerator, duration.denominator)
                    } else {
                        duration
                    },
                )?;
                if cursor.numerator < 0 {
                    return Err("A <backup> moves before the start of its measure".into());
                }
                let (low, high) = if cmp(previous, cursor) == Ordering::Less {
                    (previous, cursor)
                } else {
                    (cursor, previous)
                };
                if division_changes.iter().any(|change| {
                    cmp(*change, low) == Ordering::Greater
                        && cmp(*change, high) != Ordering::Greater
                }) {
                    return Err("Backup/forward crosses a divisions change; export one divisions value per measure".into());
                }
                if cmp(cursor, extent) == Ordering::Greater {
                    extent = cursor;
                }
                anchor = None;
            }
            "direction" | "sound" => {
                let event = parse_direction(node, cursor, start, state.divisions, maps, warnings)?;
                if cmp(event, event_extent) == Ordering::Greater {
                    event_extent = event;
                }
            }
            "barline" => {
                if let Some(repeat) = one(node, "repeat")? {
                    let forward = match repeat.attribute("direction") {
                        Some("forward") => true,
                        Some("backward") => false,
                        _ => return Err("Repeat direction must be forward or backward".into()),
                    };
                    if repeat.attribute("after-jump").is_some() {
                        return Err("Repeats after navigation jumps are unsupported; export the playing order written out".into());
                    }
                    let times = repeat
                        .attribute("times")
                        .unwrap_or("2")
                        .parse::<u8>()
                        .map_err(|_| "Repeat count must be 2–16")?;
                    if !(2..=16).contains(&times) {
                        return Err("Repeat count must be 2–16".into());
                    }
                    let right = match node.attribute("location").unwrap_or("right") {
                        "right" => true,
                        "left" => false,
                        _ => {
                            return Err(
                                "Mid-measure repeats are unsupported; split the measure first"
                                    .into(),
                            )
                        }
                    };
                    marks.push((right, forward, times));
                }
                for child in elements(node) {
                    if !matches!(
                        child.tag_name().name(),
                        "repeat" | "bar-style" | "footnote" | "level"
                    ) {
                        warnings.source_only(child.tag_name().name());
                    }
                }
            }
            "print" | "bookmark" => {}
            other => warnings.source_only(other),
        }
    }
    Ok(MeasureResult {
        extent,
        event_extent,
        marks,
    })
}

fn parse_pitch(node: Node<'_, '_>) -> Result<Option<Pitch>, String> {
    if one(node, "grace")?.is_some() {
        return Err(
            "Grace notes are unsupported; export an explicitly timed practice arrangement".into(),
        );
    }
    if one(node, "cue")?.is_some() {
        return Err(
            "Cue notes are unsupported; remove cues or convert sounding notes to normal notes"
                .into(),
        );
    }
    if one(node, "unpitched")?.is_some() {
        return Err(
            "Unpitched percussion is unsupported; import pitched instruments separately".into(),
        );
    }
    let pitch = one(node, "pitch")?;
    let rest = one(node, "rest")?;
    if pitch.is_some() == rest.is_some() {
        return Err("Every note must contain exactly one <pitch> or <rest>".into());
    }
    let Some(pitch) = pitch else {
        return Ok(None);
    };
    let step = text(pitch, "step")?.to_string();
    let alter = decimal(
        optional_text(pitch, "alter")?.unwrap_or("0"),
        "pitch alteration",
    )?;
    if alter.denominator != 1 || !(-2..=2).contains(&alter.numerator) {
        return Err("Microtonal or greater-than-double accidentals are unsupported; choose a compatible pitched practice score".into());
    }
    let octave = text(pitch, "octave")?
        .parse::<i8>()
        .map_err(|_| "Invalid pitch octave")?;
    let result = Pitch {
        step,
        alter: alter.numerator as i8,
        octave,
    };
    if result.midi().is_none() {
        return Err("Pitch must use A–G and fall in the MIDI 0–127 range".into());
    }
    Ok(Some(result))
}

fn parse_ties(node: Node<'_, '_>, warnings: &mut Warnings) -> Result<(bool, bool), String> {
    let mut sounding = (false, false);
    let mut written = (false, false);
    let mut has_sound_tie = false;
    for tie in elements(node).filter(|n| n.tag_name().name() == "tie") {
        has_sound_tie = true;
        if tie.attribute("time-only").is_some() {
            return Err(
                "Pass-specific ties are unsupported; write out the repeated playing order".into(),
            );
        }
        match tie.attribute("type") {
            Some("start") => sounding.0 = true,
            Some("stop") => sounding.1 = true,
            _ => return Err("Sound ties must have type start or stop".into()),
        }
    }
    for notations in elements(node).filter(|n| n.tag_name().name() == "notations") {
        for tie in elements(notations).filter(|n| n.tag_name().name() == "tied") {
            match tie.attribute("type") {
                Some("start") => written.0 = true,
                Some("stop") => written.1 = true,
                // A visual continuation between systems is not a sound tie endpoint.
                Some("continue") => warnings.source_only("tied type=continue"),
                Some("let-ring") => warnings.source_only("tied type=let-ring"),
                _ => return Err("Invalid written tie type".into()),
            }
        }
    }
    if !has_sound_tie && written != (false, false) {
        warnings.add("notation_tie_inferred", "Written <tied> marks have no sounding <tie> tags; tie playback was inferred from the written start/stop marks.");
        Ok(written)
    } else {
        if written != (false, false) && written != sounding {
            warnings.add("tie_notation_mismatch", "Sounding <tie> and written <tied> marks disagree; sounding tie tags control playback.");
        }
        Ok(sounding)
    }
}

fn parse_meter(node: Node<'_, '_>, at: Beat) -> Result<Meter, String> {
    if one(node, "senza-misura")?.is_some() {
        return Err("Unmetered notation is unsupported; export explicit measured durations".into());
    }
    let numerator = text(node, "beats")?.parse::<u16>().map_err(|_| "Additive or composite time signatures are unsupported; use one numeric beats/beat-type pair")?;
    let denominator = text(node, "beat-type")?
        .parse::<u16>()
        .map_err(|_| "Invalid time-signature denominator")?;
    if numerator == 0 || denominator == 0 || !denominator.is_power_of_two() {
        return Err("Time signature requires positive beats and a power-of-two beat type".into());
    }
    if one(node, "interchangeable")?.is_some() {
        return Err(
            "Interchangeable time signatures are unsupported; choose one explicit meter".into(),
        );
    }
    Ok(Meter {
        at,
        numerator,
        denominator,
    })
}
fn parse_key(node: Node<'_, '_>, at: Beat, warnings: &mut Warnings) -> Result<Key, String> {
    if elements(node).any(|n| {
        matches!(
            n.tag_name().name(),
            "key-step" | "key-alter" | "key-accidental"
        )
    }) {
        return Err("Nontraditional or microtonal key signatures are unsupported".into());
    }
    let fifths = text(node, "fifths")?
        .parse::<i8>()
        .map_err(|_| "Invalid key fifths")?;
    if !(-7..=7).contains(&fifths) {
        return Err("Key fifths must be between -7 and 7".into());
    }
    for child in elements(node) {
        if !matches!(child.tag_name().name(), "fifths" | "mode") {
            warnings.source_only(child.tag_name().name());
        }
    }
    Ok(Key {
        at,
        fifths,
        mode: optional_text(node, "mode")?.unwrap_or("unknown").into(),
    })
}
fn insert_meter(maps: &mut Maps, event: Meter) -> Result<(), String> {
    if let Some(index) = maps.meter_index.get(&BeatKey(event.at)) {
        let old = &maps.meters[*index];
        if old.numerator != event.numerator || old.denominator != event.denominator {
            return Err(
                "Conflicting time signatures at the same beat (polymeter is unsupported)".into(),
            );
        }
    } else {
        maps.meter_index
            .insert(BeatKey(event.at), maps.meters.len());
        maps.meters.push(event);
    }
    Ok(())
}
fn insert_key(maps: &mut Maps, event: Key) -> Result<(), String> {
    if let Some(index) = maps.key_index.get(&BeatKey(event.at)) {
        let old = &mut maps.keys[*index];
        if old.fifths != event.fifths
            || (old.mode != event.mode && old.mode != "unknown" && event.mode != "unknown")
        {
            return Err(
                "Conflicting part/staff key signatures at the same beat are unsupported".into(),
            );
        }
        if old.mode == "unknown" {
            old.mode = event.mode;
        }
    } else {
        maps.key_index.insert(BeatKey(event.at), maps.keys.len());
        maps.keys.push(event);
    }
    Ok(())
}
fn insert_tempo(maps: &mut Maps, at: Beat, bpm: f64) -> Result<(), String> {
    if !bpm.is_finite() || !(10.0..=600.0).contains(&bpm) {
        return Err("Playback tempo must be 10–600 quarter notes per minute".into());
    }
    if let Some(index) = maps.tempo_index.get(&BeatKey(at)) {
        let old = &maps.tempo[*index];
        if (old.bpm - bpm).abs() > 0.000001 {
            return Err(
                "Conflicting playback tempos at the same beat; use one shared tempo map".into(),
            );
        }
    } else {
        maps.tempo_index.insert(BeatKey(at), maps.tempo.len());
        maps.tempo.push(Tempo { at, bpm });
    }
    Ok(())
}
fn validate_part_signatures(
    states: &mut [PartState<'_, '_>],
    maps: &Maps,
    warnings: &mut Warnings,
) -> Result<(), String> {
    for state in states {
        state.meters.sort_by(|a, b| cmp(a.at, b.at));
        state.keys.sort_by(|a, b| cmp(a.at, b.at));
        let (mut meter_cursor, mut key_cursor) = (0, 0);
        let mut active_meter: Option<&Meter> = None;
        for global in &maps.meters {
            while meter_cursor < state.meters.len()
                && cmp(state.meters[meter_cursor].at, global.at) != Ordering::Greater
            {
                active_meter = Some(&state.meters[meter_cursor]);
                meter_cursor += 1;
            }
            if let Some(local) = active_meter {
                if local.numerator != global.numerator || local.denominator != global.denominator {
                    return Err(format!("Part {} retains a different time signature after another part changes meter; polymeter is unsupported", state.part.id));
                }
            } else {
                warnings.add("shared_part_signatures", "A part omits a key or meter declaration; the shared score signature is used until that part specifies one.");
            }
        }
        let mut active_key: Option<&Key> = None;
        for global in &maps.keys {
            while key_cursor < state.keys.len()
                && cmp(state.keys[key_cursor].at, global.at) != Ordering::Greater
            {
                active_key = Some(&state.keys[key_cursor]);
                key_cursor += 1;
            }
            if let Some(local) = active_key {
                if local.fifths != global.fifths
                    || (local.mode != global.mode
                        && local.mode != "unknown"
                        && global.mode != "unknown")
                {
                    return Err(format!("Part {} retains a different key signature after another part changes key; independent part/staff keys are unsupported", state.part.id));
                }
            } else {
                warnings.add("shared_part_signatures", "A part omits a key or meter declaration; the shared score signature is used until that part specifies one.");
            }
        }
    }
    Ok(())
}
fn offset(
    node: Option<Node<'_, '_>>,
    cursor: Beat,
    divisions: Option<Beat>,
) -> Result<Beat, String> {
    let result = if let Some(node) = node {
        add(cursor, in_quarters(value(node)?, divisions, false)?)?
    } else {
        cursor
    };
    if result.numerator < 0 {
        return Err("Direction/sound offset moves before the current measure".into());
    }
    Ok(result)
}
fn parse_direction(
    node: Node<'_, '_>,
    cursor: Beat,
    start: Beat,
    divisions: Option<Beat>,
    maps: &mut Maps,
    warnings: &mut Warnings,
) -> Result<Beat, String> {
    let standalone = node.tag_name().name() == "sound";
    let direction_offset = if standalone {
        None
    } else {
        one(node, "offset")?
    };
    let sound = if standalone {
        Some(node)
    } else {
        one(node, "sound")?
    };
    let mut latest = cursor;
    let mut has_sound_tempo = false;
    if let Some(sound) = sound {
        for name in [
            "dacapo",
            "dalsegno",
            "tocoda",
            "fine",
            "segno",
            "coda",
            "time-only",
            "forward-repeat",
        ] {
            if sound.attribute(name).is_some() {
                return Err(format!(
                    "Sound @{name} navigation is unsupported; export the playing order written out"
                ));
            }
        }
        for attr in sound.attributes() {
            if attr.name() != "tempo" {
                warnings.source_only(&format!("sound @{}", attr.name()));
            }
        }
        for child in elements(sound) {
            if child.tag_name().name() != "offset" {
                warnings.source_only(child.tag_name().name());
            }
        }
        let sound_offset = one(sound, "offset")?
            .or_else(|| direction_offset.filter(|n| n.attribute("sound") == Some("yes")));
        let position = offset(sound_offset, cursor, divisions)?;
        if cmp(position, latest) == Ordering::Greater {
            latest = position;
        }
        if let Some(tempo) = sound.attribute("tempo") {
            insert_tempo(
                maps,
                add(start, position)?,
                tempo.parse::<f64>().map_err(|_| "Invalid sound tempo")?,
            )?;
            has_sound_tempo = true;
        }
    }
    if !standalone {
        let mut metronomes = Vec::new();
        for kind in elements(node).filter(|n| n.tag_name().name() == "direction-type") {
            for child in elements(kind) {
                match child.tag_name().name() {
                    "metronome" => metronomes.push(child),
                    "octave-shift" => return Err("Octave-shift notation is unsupported; export explicit concert pitches without octave-shift marks".into()),
                    _ => warnings.source_only(child.tag_name().name()),
                }
            }
        }
        if metronomes.len() > 1 {
            return Err("Multiple metronome marks in one direction are unsupported".into());
        }
        if let Some(metronome) = metronomes.first() {
            if has_sound_tempo {
                warnings.add("sound_tempo_authoritative", "Explicit <sound tempo> controls playback where a visual metronome mark is also present.");
            } else {
                let unit = text(*metronome, "beat-unit")?;
                let base = match unit {
                    "maxima" => 32.,
                    "long" => 16.,
                    "breve" => 8.,
                    "whole" => 4.,
                    "half" => 2.,
                    "quarter" => 1.,
                    "eighth" => 0.5,
                    "16th" => 0.25,
                    "32nd" => 0.125,
                    "64th" => 0.0625,
                    "128th" => 0.03125,
                    _ => {
                        return Err(
                            "Unsupported metronome beat unit; provide an explicit sound tempo"
                                .into(),
                        )
                    }
                };
                if elements(*metronome).any(|n| {
                    !matches!(
                        n.tag_name().name(),
                        "beat-unit" | "beat-unit-dot" | "per-minute"
                    )
                }) {
                    return Err("Metric-modulation metronome marks are unsupported; provide an explicit sound tempo".into());
                }
                let dots = elements(*metronome)
                    .filter(|n| n.tag_name().name() == "beat-unit-dot")
                    .count();
                if dots > 3 {
                    return Err("Metronome marks with more than three dots are unsupported".into());
                }
                let bpm = text(*metronome, "per-minute")?
                    .parse::<f64>()
                    .map_err(|_| {
                        "Tempo ranges or text are unsupported; provide one numeric tempo"
                    })?
                    * base
                    * (2. - 0.5_f64.powi(dots as i32));
                let position = offset(direction_offset, cursor, divisions)?;
                insert_tempo(maps, add(start, position)?, bpm)?;
                if cmp(position, latest) == Ordering::Greater {
                    latest = position;
                }
                warnings.add("metronome_tempo", "Playback tempo was derived from the written metronome mark because no explicit sound tempo was provided.");
            }
        }
        for child in elements(node) {
            if !matches!(
                child.tag_name().name(),
                "direction-type" | "offset" | "sound" | "voice" | "staff"
            ) {
                warnings.source_only(child.tag_name().name());
            }
        }
    }
    Ok(latest)
}

fn build_repeats(mut marks: Vec<RepeatMark>) -> Result<Vec<Repeat>, String> {
    // At an adjacent section boundary the backward marker closes before a new start.
    marks.sort_by(|a, b| cmp(a.at, b.at).then(a.forward.cmp(&b.forward)));
    let mut unique: Vec<RepeatMark> = Vec::new();
    for mark in marks {
        if let Some(old) = unique
            .last()
            .filter(|m| m.at.equivalent(mark.at) && m.forward == mark.forward)
        {
            if old.times != mark.times {
                return Err("Parts specify different repeat counts at the same boundary".into());
            }
        } else {
            unique.push(mark);
        }
    }
    let mut open = None;
    let mut repeats: Vec<Repeat> = Vec::new();
    for mark in unique {
        if mark.forward {
            if open.replace(mark.at).is_some() {
                return Err(
                    "Nested repeats are unsupported; export the playing order written out".into(),
                );
            }
        } else {
            let from = open.take().unwrap_or(Beat::ZERO);
            if cmp(mark.at, from) != Ordering::Greater {
                return Err("A repeat must span a positive duration".into());
            }
            if repeats
                .last()
                .is_some_and(|r| cmp(from, r.to) == Ordering::Less)
            {
                return Err("Overlapping/implicit nested repeats are unsupported; mark separate forward repeats or write out the playing order".into());
            }
            repeats.push(Repeat {
                from,
                to: mark.at,
                times: mark.times,
            });
        }
    }
    if open.is_some() {
        return Err("A forward repeat has no matching backward repeat".into());
    }
    Ok(repeats)
}

#[cfg(test)]
mod tests {
    use super::*;
    const DUET: &str = include_str!("../../../tests/fixtures/original-duet.musicxml");
    const REPEATED: &str = include_str!("../../../tests/fixtures/original-repeat.musicxml");
    fn wrap(body: &str) -> String {
        format!("<score-partwise><part-list><score-part id='P'><part-name>Piano</part-name></score-part></part-list><part id='P'><measure number='1'><attributes><divisions>1</divisions></attributes>{body}</measure></part></score-partwise>")
    }
    fn note(duration: &str) -> String {
        format!("<note><pitch><step>C</step><octave>4</octave></pitch><duration>{duration}</duration></note>")
    }
    fn is_at(actual: Beat, n: i64, d: i64) {
        assert!(
            actual.equivalent(Beat::new(n, d)),
            "{} / {} != {n} / {d}",
            actual.numerator,
            actual.denominator
        );
    }

    #[test]
    fn imports_original_duet_with_shared_measures_and_pickup() {
        let (s, _) = import_musicxml(DUET).unwrap();
        assert_eq!(s.title, "Small Exact Duet");
        assert_eq!(s.parts.len(), 2);
        assert_eq!(s.parts[0].instrument, "piano");
        assert_eq!(s.parts[1].instrument, "guitar");
        assert_eq!(s.measures[0].number, 0);
        is_at(s.measures[0].length, 1, 1);
        is_at(s.measures[1].at, 1, 1);
        is_at(s.measures[2].at, 5, 1);
        is_at(s.measures[2].length, 3, 1);
        is_at(s.parts[1].notes[1].at, 1, 1);
        assert_eq!(s.meters.len(), 2);
        assert_eq!(s.meters[1].numerator, 3);
        assert_eq!(s.keys[1].fifths, -2);
        is_at(s.keys[1].at, 5, 1);
    }
    #[test]
    fn preserves_chords_spelling_voices_staves_rests_and_cursor_changes() {
        let (s, _) = import_musicxml(DUET).unwrap();
        let notes = &s.parts[0].notes;
        is_at(notes[1].at, 1, 1);
        is_at(notes[2].at, 1, 1);
        is_at(notes[3].at, 3, 1);
        assert_eq!(notes[1].pitch.as_ref().unwrap().alter, 1);
        assert_eq!(notes[2].pitch.as_ref().unwrap().alter, -1);
        assert_eq!(notes[2].pitch.as_ref().unwrap().step, "E");
        assert!(notes[4].pitch.is_none());
        is_at(notes[4].at, 1, 1);
        is_at(notes[5].at, 3, 1);
        assert_eq!(notes[5].voice, "2");
        assert_eq!(notes[5].staff, 2);
    }
    #[test]
    fn tempo_inside_held_note_is_integrated_and_ties_compile() {
        let (s, _) = import_musicxml(DUET).unwrap();
        assert_eq!(s.tempo.len(), 3);
        is_at(s.tempo[1].at, 2, 1);
        let id = s.parts[0].notes[1].id.clone();
        assert!(s.parts[0].notes[6].tie_start);
        assert!(s.parts[0].notes[7].tie_stop);
        let c = crate::compile(s).unwrap();
        let chord_tone = c.timeline.notes.iter().find(|n| n.id == id).unwrap();
        assert!((chord_tone.start_ms - 500.).abs() < 0.001);
        assert!((chord_tone.duration_ms - 1500.).abs() < 0.001);
        assert_eq!(c.timeline.notes.iter().filter(|n| n.midi == 62).count(), 1);
    }
    #[test]
    fn exact_original_source_and_user_import_rights_are_retained() {
        let (s, _) = import_musicxml(DUET).unwrap();
        assert_eq!(s.source.as_ref().unwrap().content, DUET);
        assert_eq!(s.provenance.kind, "user_import");
        assert!(s.provenance.license.is_none());
        assert!(s.provenance.source_url.is_none());
        let decoded: Score = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert_eq!(decoded.source.unwrap().content, DUET);
        assert_eq!(s.id, import_musicxml(DUET).unwrap().0.id);
    }
    #[test]
    fn preserves_bounded_simple_repeat_regions() {
        let (s, warnings) = import_musicxml(REPEATED).unwrap();
        assert_eq!(s.repeats.len(), 1);
        assert_eq!(s.repeats[0].times, 3);
        is_at(s.repeats[0].from, 0, 1);
        is_at(s.repeats[0].to, 2, 1);
        assert!(warnings.iter().any(|d| d.code == "musicxml_repeats"));
    }
    #[test]
    fn decimal_divisions_and_tuplet_durations_stay_exact() {
        let xml = wrap(&format!(
            "<attributes><divisions>1.5</divisions></attributes>{}{}{}",
            note("0.5"),
            note("0.5"),
            note("0.5")
        ));
        let (s, _) = import_musicxml(&xml).unwrap();
        is_at(s.parts[0].notes[1].at, 1, 3);
        is_at(s.parts[0].notes[2].at, 2, 3);
        is_at(s.measures[0].length, 1, 1);
    }
    #[test]
    fn metronome_dotted_beat_converts_to_quarter_bpm() {
        let xml = wrap(&format!("<direction><direction-type><metronome><beat-unit>eighth</beat-unit><beat-unit-dot/><per-minute>120</per-minute></metronome></direction-type></direction>{}",note("1")));
        let (s, warnings) = import_musicxml(&xml).unwrap();
        assert_eq!(s.tempo[0].bpm, 90.);
        assert!(warnings.iter().any(|d| d.code == "metronome_tempo"));
    }
    #[test]
    fn sound_offset_overrides_direction_offset_and_visual_only_offset_does_not_move_audio() {
        let xml = wrap(&format!("{}<direction><offset>-1</offset><sound tempo='70'/></direction><direction><offset sound='yes'>-1</offset><sound tempo='80'><offset>-0.5</offset></sound></direction>",note("2")));
        let (s, _) = import_musicxml(&xml).unwrap();
        is_at(s.tempo[1].at, 3, 2);
        assert_eq!(s.tempo[1].bpm, 80.);
        is_at(s.tempo[2].at, 2, 1);
        assert_eq!(s.tempo[2].bpm, 70.);
    }
    #[test]
    fn missing_initial_tempo_is_an_explicit_default() {
        let (_, warnings) = import_musicxml(&wrap(&note("1"))).unwrap();
        assert!(warnings.iter().any(|d| d.code == "default_tempo"));
    }
    #[test]
    fn rejects_zero_negative_non_numeric_and_excessive_durations() {
        for duration in ["0", "-1", "NaN", "1e2", "0.0000001", "1000000001"] {
            assert!(
                import_musicxml(&wrap(&note(duration))).is_err(),
                "{duration}"
            );
        }
        for tag in ["backup", "forward"] {
            assert!(
                import_musicxml(&wrap(&format!("<{tag}><duration>0</duration></{tag}>"))).is_err()
            );
        }
    }
    #[test]
    fn rejects_invalid_divisions_and_missing_divisions() {
        for divisions in ["0", "-2", "word"] {
            let xml = wrap(&format!(
                "<attributes><divisions>{divisions}</divisions></attributes>{}",
                note("1")
            ));
            assert!(import_musicxml(&xml).is_err());
        }
        assert!(
            import_musicxml(&wrap(&note("1")).replace("<divisions>1</divisions>", "")).is_err()
        );
    }
    #[test]
    fn rejects_unsafe_or_malformed_xml() {
        for xml in ["", "<score-partwise>", "<score-timewise/>", "<!DOCTYPE score-partwise><score-partwise/>", "<!DOCTYPE score-partwise [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><score-partwise>&x;</score-partwise>", "<?xml-stylesheet href='https://example.invalid/a.xsl'?><score-partwise/>"] { assert!(import_musicxml(xml).is_err(),"{xml}"); }
        assert!(import_musicxml(&wrap("<link href='https://example.invalid'/>")).is_err());
        assert!(import_musicxml(&wrap("<image source='file:///tmp/a.png'/>")).is_err());
    }
    #[test]
    fn rejects_resource_limit_excesses() {
        assert!(import_musicxml(&" ".repeat(MAX_SOURCE_BYTES + 1))
            .unwrap_err()
            .contains("8 MiB"));
        let xml = wrap(&"<note><rest/><duration>1</duration></note>".repeat(MAX_NOTES + 1));
        assert!(import_musicxml(&xml).unwrap_err().contains("100,000"));
        let parts = (0..129)
            .map(|i| format!("<score-part id='p{i}'><part-name>Piano</part-name></score-part>"))
            .collect::<String>();
        assert!(import_musicxml(&format!(
            "<score-partwise><part-list>{parts}</part-list></score-partwise>"
        ))
        .unwrap_err()
        .contains("128"));
    }
    #[test]
    fn rejects_chord_without_base_longer_chord_and_cross_voice_chord() {
        let chord = "<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note>";
        assert!(import_musicxml(&wrap(chord)).is_err());
        assert!(import_musicxml(&wrap(&format!("{}{chord}", note("0.5")))).is_err());
        assert!(import_musicxml(&wrap(&format!(
            "{}{}",
            note("1"),
            chord.replace("</duration>", "</duration><voice>2</voice>")
        )))
        .is_err());
    }
    #[test]
    fn rejects_backup_before_measure_and_across_divisions_change() {
        assert!(import_musicxml(&wrap("<backup><duration>1</duration></backup>")).is_err());
        let xml = wrap(&format!("{}<attributes><divisions>2</divisions></attributes>{}<backup><duration>4</duration></backup>",note("1"),note("2")));
        assert!(import_musicxml(&xml)
            .unwrap_err()
            .contains("divisions change"));
    }
    #[test]
    fn rejects_unsupported_pitch_navigation_and_playback_semantics() {
        for body in [
            "<attributes><transpose><chromatic>2</chromatic></transpose></attributes>",
            "<barline><ending number='1' type='start'/></barline>",
            "<sound dacapo='yes'/>",
            "<direction><direction-type><octave-shift type='up'/></direction-type></direction>",
        ] {
            assert!(import_musicxml(&wrap(&format!("{body}{}", note("1")))).is_err());
        }
        assert!(import_musicxml(&wrap(
            &note("1").replace("<step>C</step>", "<step>C</step><alter>0.5</alter>")
        ))
        .is_err());
        assert!(import_musicxml(&wrap(&note("1").replace("<note>", "<note><cue/>"))).is_err());
        assert!(import_musicxml(&wrap(&note("1").replace("<note>", "<note attack='1'>"))).is_err());
    }
    #[test]
    fn unsupported_expression_is_warned_and_original_kept() {
        let xml = wrap(&note("1").replace("</note>","<notations><ornaments><trill-mark/></ornaments><articulations><staccato/></articulations></notations></note>"));
        let (s, warnings) = import_musicxml(&xml).unwrap();
        assert_eq!(s.source.unwrap().content, xml);
        assert!(warnings.iter().any(|d| d.message.contains("ornaments")));
        assert!(warnings.iter().any(|d| d.message.contains("articulations")));
    }
    #[test]
    fn rejects_duplicate_parts_conflicting_maps_and_unmatched_repeats() {
        assert!(import_musicxml(&DUET.replace("id=\"P2\"", "id=\"P1\"")).is_err());
        assert!(import_musicxml(&DUET.replace(
            "<note><rest/><duration>2</duration></note>",
            "<sound tempo='100'/><note><rest/><duration>2</duration></note>"
        ))
        .unwrap_err()
        .contains("Conflicting playback tempos"));
        assert!(import_musicxml(
            &REPEATED.replace("<repeat direction=\"backward\" times=\"3\"/>", "")
        )
        .unwrap_err()
        .contains("no matching"));
    }
    #[test]
    fn preserves_literal_entities_without_resolving_external_resources() {
        let xml = wrap(&note("1")).replace(
            "<part-name>Piano</part-name>",
            "<part-name>Piano &amp; Keys</part-name>",
        );
        assert_eq!(
            import_musicxml(&xml).unwrap().0.parts[0].name,
            "Piano & Keys"
        );
    }
    #[test]
    fn rejects_independent_part_signature_changes() {
        let without_second_change = DUET.replacen(
            "<attributes><time><beats>3</beats><beat-type>4</beat-type></time><key><fifths>-2</fifths><mode>minor</mode></key></attributes>",
            "", 1,
        );
        let error = import_musicxml(&without_second_change).unwrap_err();
        assert!(error.contains("different time signature"), "{error}");
        let no_second_key =
            DUET.replacen("<key><fifths>-2</fifths><mode>minor</mode></key>", "", 1);
        assert!(import_musicxml(&no_second_key)
            .unwrap_err()
            .contains("different key signature"));
    }
    #[test]
    fn omitted_key_mode_does_not_conflict_with_explicit_mode() {
        let xml = DUET
            .replace(
                "<key><fifths>1</fifths><mode>major</mode></key>",
                "<key><fifths>1</fifths></key>",
            )
            .replacen(
                "<key><fifths>1</fifths></key>",
                "<key><fifths>1</fifths><mode>major</mode></key>",
                1,
            );
        let (score, _) = import_musicxml(&xml).unwrap();
        assert_eq!(score.keys[0].mode, "major");
    }
}
