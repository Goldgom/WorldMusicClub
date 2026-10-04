//! Deterministic, bounded canonical-score interchange, not original-engraving recovery.
use crate::{Beat, Diagnostic, Key, Meter, Note, Part, Pitch, Score};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fmt::{Arguments, Write};

const MAX_XML_BYTES: usize = 8 * 1024 * 1024;
const MAX_DIVISIONS: i64 = 1_000_000;
const MAX_DURATION_TICKS: i64 = 1_000_000_000;
const MAX_SEGMENTS: usize = 100_000;
const MAX_LANES: usize = 256;
const MAX_EVENTS: usize = 500_000;
const MAX_NOTE_MAP_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ExportedMusicXml {
    pub xml: String,
    pub diagnostics: Vec<Diagnostic>,
    /// Canonical part ID to generated, XML-safe part ID.
    pub part_id_map: BTreeMap<String, String>,
    /// Explicit reversible labels for numeric engraving voices; one entry per lane.
    pub voice_id_map: Vec<ExportedVoiceId>,
    /// Complete written-segment identity map, or None with an explicit diagnostic.
    /// This is display metadata; MusicXML and canonical music remain independent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_id_map: Option<ExportedNoteMap>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ExportedNoteMap {
    pub version: u32,
    pub segments: Vec<ExportedNoteSegment>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ExportedNoteSegment {
    pub xml_note_id: String,
    pub source_note_id: String,
    pub part_id: String,
    pub xml_part_id: String,
    /// Zero-based ordinal, never the possibly repeated printed measure label.
    pub source_measure_index: usize,
    pub measure_number: u32,
    pub staff: u8,
    pub voice: String,
    pub lane: u16,
    pub xml_voice: String,
    /// All times use exact quarter-note beats, including split notes and rests.
    pub at: Beat,
    pub measure_at: Beat,
    pub duration: Beat,
    pub pitch: Option<Pitch>,
    pub tie_start: bool,
    pub tie_stop: bool,
    pub chord: bool,
}

struct NoteMapBuilder {
    map: Option<ExportedNoteMap>,
    remaining: usize,
}
impl std::io::Write for NoteMapBuilder {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.remaining = self.remaining.checked_sub(bytes.len()).ok_or_else(|| {
            std::io::Error::other("Written-note identity metadata exceeds its size limit")
        })?;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
impl NoteMapBuilder {
    fn new(limit: usize) -> Self {
        Self {
            map: Some(ExportedNoteMap {
                version: 1,
                segments: vec![],
            }),
            // Includes the empty wrapper; each entry reserves a comma as well.
            remaining: limit.saturating_sub(b"{\"version\":1,\"segments\":[]}".len()),
        }
    }
    fn push(&mut self, segment: ExportedNoteSegment) {
        if self.map.is_none() {
            return;
        }
        if serde_json::to_writer(&mut *self, &segment).is_err() || self.remaining == 0 {
            self.map = None;
            return;
        }
        self.remaining -= 1;
        self.map.as_mut().expect("checked").segments.push(segment);
    }
}

fn tick_beat(value: i64, divisions: i64) -> Beat {
    let divisor = gcd(value, divisions);
    Beat::new(value / divisor, divisions / divisor)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ExportedVoiceId {
    pub part_id: String,
    pub staff: u8,
    pub voice: String,
    /// One-based lane within the original (staff, voice) group.
    pub lane: u16,
    pub xml_voice: String,
}

#[derive(Default)]
struct Xml {
    text: String,
    events: usize,
}
impl Write for Xml {
    fn write_str(&mut self, s: &str) -> std::fmt::Result {
        if s.len() > MAX_XML_BYTES.saturating_sub(self.text.len()) {
            return Err(std::fmt::Error);
        }
        self.text.push_str(s);
        Ok(())
    }
}
impl Xml {
    fn put(&mut self, value: Arguments<'_>) -> Result<(), String> {
        self.write_fmt(value).map_err(|_| {
            "Generated MusicXML exceeds the 8 MiB output limit; export a smaller score".into()
        })
    }
    fn event(&mut self) -> Result<(), String> {
        self.events += 1;
        if self.events > MAX_EVENTS {
            return Err(
                "Generated MusicXML exceeds the 500,000-event limit; export a smaller score".into(),
            );
        }
        Ok(())
    }
}
fn escape(value: &str) -> Result<String, String> {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            '\r' => out.push_str("&#13;"),
            '\t' | '\n' => out.push(ch),
            '\u{20}'..='\u{d7ff}' | '\u{e000}'..='\u{fffd}' | '\u{10000}'..='\u{10ffff}' => out.push(ch),
            _ => return Err("Score text contains a character forbidden by XML 1.0; remove control characters before export".into()),
        }
    }
    Ok(out)
}
fn gcd(mut a: i64, mut b: i64) -> i64 {
    while b != 0 {
        let r = a % b;
        a = b;
        b = r;
    }
    a.max(1)
}
fn include_divisions(divisions: &mut i64, beat: Beat) -> Result<(), String> {
    let denominator = beat.denominator / gcd(beat.numerator.abs(), beat.denominator);
    *divisions = (*divisions / gcd(*divisions, denominator))
        .checked_mul(denominator)
        .filter(|n| *n <= MAX_DIVISIONS)
        .ok_or("Exact MusicXML divisions exceed 1,000,000; simplify incompatible rational denominators or export smaller sections (timing is never rounded)")?;
    Ok(())
}
fn ticks(beat: Beat, divisions: i64) -> Result<i64, String> {
    let value = beat.numerator as i128 * divisions as i128;
    if value % beat.denominator as i128 != 0 {
        return Err("Internal MusicXML divisions do not exactly represent a beat".into());
    }
    i64::try_from(value / beat.denominator as i128)
        .map_err(|_| "MusicXML tick arithmetic overflow".into())
}
#[derive(Clone, Copy)]
struct Bar {
    number: u32,
    start: i64,
    end: i64,
    implicit: bool,
}
#[derive(Default)]
struct Attributes<'a> {
    key: Option<&'a Key>,
    meter: Option<&'a Meter>,
}
struct TickNote<'a> {
    note: &'a Note,
    index: usize,
    start: i64,
    end: i64,
}
struct Lane<'a> {
    voice: String,
    original_voice: String,
    ordinal: u16,
    staff: u8,
    notes: Vec<TickNote<'a>>,
    onset: i64,
    end: i64,
    pitches: HashSet<u8>,
    pitched: bool,
}
impl Lane<'_> {
    fn fits(&self, n: &TickNote<'_>) -> bool {
        self.end <= n.start
            || (self.onset == n.start
                && self.pitched
                && n.note
                    .pitch
                    .as_ref()
                    .and_then(|p| p.midi())
                    .is_some_and(|p| !self.pitches.contains(&p)))
    }
}
struct Segment<'a> {
    note: &'a Note,
    note_index: usize,
    lane: usize,
    start: i64,
    end: i64,
    tie_start: bool,
    tie_stop: bool,
}

/// Export a validated canonical score as self-contained MusicXML 4.0 partwise.
/// Musical time is exact or the operation fails. The input and retained source
/// are never modified; original source bytes are never embedded in the output.
pub fn export_musicxml(score: &Score) -> Result<ExportedMusicXml, String> {
    export_musicxml_inner(score, &BTreeSet::new(), &BTreeSet::new(), false)
}

/// Source-bound display excerpts can carry ties beyond the requested window.
/// The caller proves these continuations against complete source intervals;
/// they are not orphan canonical tie segments or newly inferred durations.
pub(crate) fn export_musicxml_excerpt(
    score: &Score,
    incoming: &BTreeSet<String>,
    outgoing: &BTreeSet<String>,
) -> Result<ExportedMusicXml, String> {
    export_musicxml_inner(score, incoming, outgoing, true)
}
fn export_musicxml_inner(
    score: &Score,
    incoming: &BTreeSet<String>,
    outgoing: &BTreeSet<String>,
    display_only: bool,
) -> Result<ExportedMusicXml, String> {
    if display_only {
        // Playback's10–600BPM gate is not a notation requirement. Validate all
        // canonical structure with a local validation clock, then validate the
        // actual display/source tempo separately. No fake tempo enters Score
        // or exported XML; an unavailable source clock may have no tempo mark.
        let mut validation = score.clone();
        validation.tempo = vec![crate::Tempo {
            at: Beat::ZERO,
            bpm: 120.,
        }];
        crate::validate(&validation)?;
        let mut prior: Option<Beat> = None;
        for tempo in &score.tempo {
            if !tempo.at.valid()
                || tempo.at.numerator < 0
                || !tempo.bpm.is_finite()
                || tempo.bpm <= 0.
                || prior.is_some_and(|at| at.compare(tempo.at).is_ge())
            {
                return Err("Invalid exact display tempo map".into());
            }
            prior = Some(tempo.at);
        }
    } else {
        crate::validate(score)?;
    }
    if score.measures.is_empty() {
        return Err("MusicXML export requires a contiguous measure map beginning at beat zero; add measures before export".into());
    }
    let mut divisions = 1;
    for beat in score
        .measures
        .iter()
        .flat_map(|m| [m.at, m.length])
        .chain(
            score
                .parts
                .iter()
                .flat_map(|p| p.notes.iter().flat_map(|n| [n.at, n.duration])),
        )
        .chain(score.tempo.iter().map(|t| t.at))
        .chain(score.meters.iter().map(|m| m.at))
        .chain(score.keys.iter().map(|k| k.at))
        .chain(score.repeats.iter().flat_map(|r| [r.from, r.to]))
    {
        include_divisions(&mut divisions, beat)?;
    }
    let mut attributes: BTreeMap<i64, Attributes<'_>> = BTreeMap::new();
    for key in &score.keys {
        if !matches!(
            key.mode.as_str(),
            "major"
                | "minor"
                | "dorian"
                | "phrygian"
                | "lydian"
                | "mixolydian"
                | "aeolian"
                | "ionian"
                | "locrian"
                | "none"
                | "unknown"
        ) {
            return Err(
                "Unsupported key mode for MusicXML; use a standard mode or 'unknown'".into(),
            );
        }
        if attributes
            .entry(ticks(key.at, divisions)?)
            .or_default()
            .key
            .replace(key)
            .is_some()
        {
            return Err(
                "Multiple key signatures at one beat cannot be exported; keep one shared key event"
                    .into(),
            );
        }
    }
    for meter in &score.meters {
        if attributes
            .entry(ticks(meter.at, divisions)?)
            .or_default()
            .meter
            .replace(meter)
            .is_some()
        {
            return Err("Multiple time signatures at one beat cannot be exported; keep one shared meter event".into());
        }
    }
    let mut bars = Vec::with_capacity(score.measures.len());
    let mut end = 0;
    let mut active_meter: Option<&Meter> = None;
    let mut attribute_iter = attributes.iter().peekable();
    for measure in &score.measures {
        let start = ticks(measure.at, divisions)?;
        if start != end {
            return Err("Measure map has a gap, overlap, or is out of order; MusicXML requires contiguous measures starting at beat zero".into());
        }
        let length = ticks(measure.length, divisions)?;
        if length > MAX_DURATION_TICKS {
            return Err("A measure exceeds 1,000,000,000 MusicXML duration units; shorten measures or simplify rational divisions".into());
        }
        end = start
            .checked_add(length)
            .ok_or("MusicXML measure timing overflow")?;
        while attribute_iter.peek().is_some_and(|(at, _)| **at <= start) {
            if let Some((_, event)) = attribute_iter.next() {
                if event.meter.is_some() {
                    active_meter = event.meter;
                }
            }
        }
        let implicit = active_meter.is_none_or(|m| {
            length as i128 * m.denominator as i128 != m.numerator as i128 * 4 * divisions as i128
        });
        bars.push(Bar {
            number: measure.number,
            start,
            end,
            implicit,
        });
    }
    if attributes.last_key_value().is_some_and(|(at, _)| *at > end) {
        return Err(
            "A key or meter event lies beyond the final measure; extend the measure map".into(),
        );
    }
    let tempos = score
        .tempo
        .iter()
        .map(|t| Ok((ticks(t.at, divisions)?, t.bpm)))
        .collect::<Result<Vec<_>, String>>()?;
    if tempos.last().is_some_and(|(at, _)| *at > end) {
        return Err("A tempo event lies beyond the final measure; extend the measure map".into());
    }
    let boundaries: BTreeSet<_> = bars.iter().map(|b| b.start).chain([end]).collect();
    let mut repeats = score
        .repeats
        .iter()
        .map(|r| Ok((ticks(r.from, divisions)?, ticks(r.to, divisions)?, r.times)))
        .collect::<Result<Vec<_>, String>>()?;
    repeats.sort_unstable();
    let mut repeat_end = 0;
    let mut repeat_starts = BTreeSet::new();
    let mut repeat_ends = BTreeMap::new();
    let mut repeat_boundaries = BTreeSet::new();
    for (from, to, times) in repeats {
        if from < repeat_end || to > end {
            return Err("Overlapping, nested, or out-of-score repeats cannot be exported; write out the playing order or use disjoint repeat regions".into());
        }
        if !boundaries.contains(&from) || !boundaries.contains(&to) {
            return Err("A repeat boundary falls inside a measure; split the measure at the exact repeat boundary before MusicXML export".into());
        }
        repeat_end = to;
        repeat_starts.insert(from);
        repeat_ends.insert(to, times);
        repeat_boundaries.extend([from, to]);
    }
    let mut diagnostics = vec![Diagnostic::warning("musicxml_generated_engraving", "Generated MusicXML preserves supported canonical music, not original engraving. Clefs and rhythmic spelling are inferred; source images, source XML, layout, lyrics, articulations and source-only instructions are not copied.", None)];
    let mut xml = Xml::default();
    xml.put(format_args!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<score-partwise version=\"4.0\">\n<work><work-title>{}</work-title></work>\n", escape(&score.title)?))?;
    // Rights notices are copied as supplied metadata, never inferred clearance.
    // In particular, retained source bytes and provenance.source_url are not used.
    xml.put(format_args!("<identification>"))?;
    if !score.composer.trim().is_empty() {
        xml.put(format_args!(
            "<creator type=\"composer\">{}</creator>",
            escape(&score.composer)?
        ))?;
    } else {
        escape(&score.composer)?;
    }
    if !score.provenance.attribution.is_empty() {
        xml.put(format_args!(
            "<rights type=\"attribution\">{}</rights>",
            escape(&score.provenance.attribution)?
        ))?;
    }
    if let Some(license) = &score.provenance.license {
        xml.put(format_args!(
            "<rights type=\"license\">{}</rights>",
            escape(license)?
        ))?;
    }
    xml.put(format_args!(
        "<encoding><software>WorldMusicHub {}</software></encoding></identification>\n",
        env!("CARGO_PKG_VERSION")
    ))?;
    xml.put(format_args!("<part-list>\n"))?;
    for (index, part) in score.parts.iter().enumerate() {
        if part.name.trim().is_empty() || part.instrument.trim().is_empty() {
            return Err("MusicXML export requires nonblank part and instrument names; name each part before export".into());
        }
        xml.put(format_args!("<score-part id=\"P{}\"><part-name>{}</part-name><score-instrument id=\"I{}\"><instrument-name>{}</instrument-name></score-instrument></score-part>\n", index + 1, escape(&part.name)?, index + 1, escape(&part.instrument)?))?;
    }
    xml.put(format_args!("</part-list>\n"))?;
    let mut segment_count = 0;
    let mut uses_tuplets = false;
    let mut voice_id_map = Vec::new();
    let mut note_map = NoteMapBuilder::new(MAX_NOTE_MAP_BYTES);
    for (part_index, part) in score.parts.iter().enumerate() {
        let lanes = make_lanes(part, divisions, end, &repeat_boundaries, &mut diagnostics)?;
        if lanes
            .iter()
            .any(|lane| lane.voice != lane.original_voice || lane.ordinal > 1)
        {
            diagnostics.push(Diagnostic::warning("musicxml_voice_ids", format!("Part '{}' uses generated positive-integer MusicXML voice IDs for engraving compatibility. voice_id_map retains every original staff/voice label and overlap lane; the canonical score is unchanged.", part.name), None));
        }
        voice_id_map.extend(lanes.iter().map(|lane| ExportedVoiceId {
            part_id: part.id.clone(),
            staff: lane.staff,
            voice: lane.original_voice.clone(),
            lane: lane.ordinal,
            xml_voice: lane.voice.clone(),
        }));
        let mut segments: Vec<Vec<Segment<'_>>> = (0..bars.len()).map(|_| Vec::new()).collect();
        for (lane_index, lane) in lanes.iter().enumerate() {
            for n in &lane.notes {
                let mut bar_index = bars.partition_point(|b| b.end <= n.start);
                let mut start = n.start;
                while start < n.end {
                    segment_count += 1;
                    if segment_count > MAX_SEGMENTS {
                        return Err("Splitting notes/rests at measure boundaries exceeds 100,000 exported segments; export smaller sections".into());
                    }
                    let segment_end = n.end.min(bars[bar_index].end);
                    segments[bar_index].push(Segment {
                        note: n.note,
                        note_index: n.index,
                        lane: lane_index,
                        start,
                        end: segment_end,
                        tie_start: n.note.pitch.is_some()
                            && (segment_end < n.end
                                || n.note.tie_start
                                || outgoing.contains(&n.note.id)),
                        tie_stop: n.note.pitch.is_some()
                            && (start > n.start
                                || n.note.tie_stop
                                || incoming.contains(&n.note.id)),
                    });
                    start = segment_end;
                    bar_index += 1;
                }
            }
        }
        let staves = part.notes.iter().map(|n| n.staff).max().unwrap_or(1);
        xml.put(format_args!("<part id=\"P{}\">\n", part_index + 1))?;
        for (bar_index, (bar, notes)) in bars.iter().zip(&mut segments).enumerate() {
            xml.event()?;
            xml.put(format_args!(
                "<measure number=\"{}\"{}>\n",
                bar.number,
                if bar.implicit {
                    " implicit=\"yes\""
                } else {
                    ""
                }
            ))?;
            if repeat_starts.contains(&bar.start) {
                xml.put(format_args!(
                    "<barline location=\"left\"><repeat direction=\"forward\"/></barline>\n"
                ))?;
            }
            write_attributes(
                &mut xml,
                attributes.get(&bar.start),
                (bar_index == 0).then_some((divisions, staves, part)),
            )?;
            let inclusive_end = bar_index + 1 == bars.len();
            let tempo_start = tempos.partition_point(|(at, _)| *at < bar.start);
            for (at, bpm) in tempos[tempo_start..]
                .iter()
                .take_while(|(at, _)| *at < bar.end || (inclusive_end && *at == bar.end))
            {
                // Directions don't move the duration cursor. sound=yes makes the
                // written and sounding offsets agree, including intra-note tempo.
                xml.event()?;
                xml.put(format_args!("<direction placement=\"above\"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>{bpm}</per-minute></metronome></direction-type><offset sound=\"yes\">{}</offset><sound tempo=\"{bpm}\"/></direction>\n", at - bar.start))?;
            }
            let mut cursor = 0;
            for (at, event) in attributes.range((
                std::ops::Bound::Excluded(bar.start),
                if inclusive_end {
                    std::ops::Bound::Included(bar.end)
                } else {
                    std::ops::Bound::Excluded(bar.end)
                },
            )) {
                move_cursor(&mut xml, &mut cursor, at - bar.start, None)?;
                write_attributes(&mut xml, Some(event), None)?;
            }
            move_cursor(&mut xml, &mut cursor, 0, None)?;
            notes.sort_by(|a, b| {
                a.lane
                    .cmp(&b.lane)
                    .then(a.start.cmp(&b.start))
                    .then(b.end.cmp(&a.end))
                    .then(a.note.id.cmp(&b.note.id))
            });
            let mut previous_lane = None;
            let mut chord_at = None;
            for segment in notes {
                let lane = &lanes[segment.lane];
                let at = segment.start - bar.start;
                let same_lane = previous_lane == Some(segment.lane);
                if !same_lane {
                    move_cursor(&mut xml, &mut cursor, 0, None)?;
                    chord_at = None;
                }
                let chord = chord_at == Some(at) && segment.note.pitch.is_some();
                if !chord {
                    move_cursor(&mut xml, &mut cursor, at, Some(lane))?;
                }
                uses_tuplets |= write_note(
                    &mut xml, segment, lane, chord, divisions, part_index, bar_index,
                )?;
                if note_map.map.is_some() {
                    note_map.push(ExportedNoteSegment {
                        xml_note_id: format!(
                            "N{}_{}_{}",
                            part_index + 1,
                            segment.note_index + 1,
                            bar_index + 1
                        ),
                        source_note_id: segment.note.id.clone(),
                        part_id: part.id.clone(),
                        xml_part_id: format!("P{}", part_index + 1),
                        source_measure_index: bar_index,
                        measure_number: bar.number,
                        staff: segment.note.staff,
                        voice: lane.original_voice.clone(),
                        lane: lane.ordinal,
                        xml_voice: lane.voice.clone(),
                        at: tick_beat(segment.start, divisions),
                        measure_at: tick_beat(at, divisions),
                        duration: tick_beat(segment.end - segment.start, divisions),
                        pitch: segment.note.pitch.clone(),
                        tie_start: segment.tie_start,
                        tie_stop: segment.tie_stop,
                        chord,
                    });
                }
                if !chord {
                    cursor = segment.end - bar.start;
                    chord_at = segment.note.pitch.as_ref().map(|_| at);
                }
                previous_lane = Some(segment.lane);
            }
            move_cursor(&mut xml, &mut cursor, bar.end - bar.start, None)?;
            if let Some(times) = repeat_ends.get(&bar.end) {
                xml.put(format_args!("<barline location=\"right\"><repeat direction=\"backward\" times=\"{times}\"/></barline>\n"))?;
            }
            xml.put(format_args!("</measure>\n"))?;
        }
        xml.put(format_args!("</part>\n"))?;
    }
    xml.put(format_args!("</score-partwise>\n"))?;
    if uses_tuplets {
        diagnostics.push(Diagnostic::warning("musicxml_inferred_rhythm", "Nonstandard note lengths use exact time-modification ratios. Rhythmic grouping is inferred; unusual MIDI durations may produce complex tuplets rather than quantized notation.", None));
    }
    if note_map.map.is_none() {
        diagnostics.push(Diagnostic::warning("musicxml_note_map_unavailable", "The complete written-note identity map exceeds 4 MiB. Exact notehead following is unavailable; generated MusicXML, canonical notes and playback are unchanged. Use measure following or a smaller score.", None));
    }
    Ok(ExportedMusicXml {
        xml: xml.text,
        diagnostics,
        voice_id_map,
        note_id_map: note_map.map,
        part_id_map: score
            .parts
            .iter()
            .enumerate()
            .map(|(i, p)| (p.id.clone(), format!("P{}", i + 1)))
            .collect(),
    })
}

fn make_lanes<'a>(
    part: &'a Part,
    divisions: i64,
    score_end: i64,
    repeat_boundaries: &BTreeSet<i64>,
    diagnostics: &mut Vec<Diagnostic>,
) -> Result<Vec<Lane<'a>>, String> {
    // Validate the part as a whole before allocating per-voice engraving lanes.
    // A uniquely identified adjacent explicit tie may move written voice/staff;
    // keeping its endpoints in those original lanes must not invent an orphan.
    let mut ordered: Vec<_> = part.notes.iter().enumerate().collect();
    ordered.sort_by(|a, b| a.1.at.compare(b.1.at).then(a.1.id.cmp(&b.1.id)));
    let mut tracker = crate::ties::TieTracker::default();
    let mut cross_stops = HashSet::new();
    let mut cross_starts = HashSet::new();
    for (index, note) in ordered {
        let Some(midi) = note.pitch.as_ref().and_then(|p| p.midi()) else {
            continue;
        };
        if note.tie_stop {
            let previous = tracker.take(note, midi)?.ok_or_else(|| {
                format!(
                    "Note {} has an orphan tie stop; correct ties before MusicXML export",
                    note.id
                )
            })?;
            if !previous.end.equivalent(note.at) {
                return Err(format!(
                    "Note {} has a non-adjacent tie; correct ties before MusicXML export",
                    note.id
                ));
            }
            if previous.cross_lane {
                cross_stops.insert(index);
                cross_starts.insert(previous.index);
                diagnostics.push(Diagnostic::warning("musicxml_cross_lane_tie", "Retained a uniquely matched adjacent tie across written voice/staff lanes. Both endpoint lanes remain mapped explicitly; no source note or canonical voice was changed.",Some(note.id.clone())));
            }
        }
        if note.tie_start {
            tracker.start(
                note,
                midi,
                index,
                note.at
                    .checked_add(note.duration)
                    .ok_or("MusicXML tie timing overflow")?,
            )?;
        }
    }
    if !tracker.unresolved().is_empty() {
        return Err(format!(
            "Part '{}' has an unclosed tie; add its continuation or remove the tie before export",
            part.name
        ));
    }
    let mut groups: BTreeMap<(&str, u8), Vec<TickNote<'_>>> = BTreeMap::new();
    for (index, note) in part.notes.iter().enumerate() {
        escape(&note.voice)?;
        if note.voice.trim() != note.voice || note.voice.trim().is_empty() {
            return Err(format!("Voice for note {} has leading/trailing whitespace; use a nonblank stable voice label", note.id));
        }
        let start = ticks(note.at, divisions)?;
        let end = start
            .checked_add(ticks(note.duration, divisions)?)
            .ok_or("MusicXML note timing overflow")?;
        if end > score_end {
            return Err(format!(
                "Note {} extends beyond the final measure; extend the measure map before export",
                note.id
            ));
        }
        if note.pitch.is_some()
            && (repeat_boundaries
                .range((
                    std::ops::Bound::Excluded(start),
                    std::ops::Bound::Excluded(end),
                ))
                .next()
                .is_some()
                || (note.tie_start && repeat_boundaries.contains(&end))
                || (note.tie_stop && repeat_boundaries.contains(&start)))
        {
            return Err(format!("Note {} or its tie crosses a repeat boundary; write out the playing order or end the sounding note at that boundary", note.id));
        }
        groups
            .entry((&note.voice, note.staff))
            .or_default()
            .push(TickNote {
                note,
                index,
                start,
                end,
            });
    }
    let mut lanes: Vec<Lane<'a>> = Vec::new();
    for ((voice, staff), mut notes) in groups {
        notes.sort_by(|a, b| {
            a.start
                .cmp(&b.start)
                .then(b.end.cmp(&a.end))
                .then(a.note.id.cmp(&b.note.id))
        });
        let mut group_lanes: Vec<usize> = Vec::new();
        let mut ties: HashMap<u8, (i64, usize)> = HashMap::new();
        for n in notes {
            let midi = n.note.pitch.as_ref().and_then(|p| p.midi());
            let required_lane = if n.note.tie_stop && !cross_stops.contains(&n.index) {
                let (previous_end, lane) = ties
                    .remove(&midi.expect("validated pitched tie"))
                    .ok_or_else(|| {
                        format!(
                            "Note {} has an orphan tie stop; correct ties before MusicXML export",
                            n.note.id
                        )
                    })?;
                if previous_end != n.start {
                    return Err(format!(
                        "Note {} has a non-adjacent tie; correct ties before MusicXML export",
                        n.note.id
                    ));
                }
                Some(lane)
            } else {
                None
            };
            let lane_index = if let Some(index) = required_lane {
                if !lanes[index].fits(&n) {
                    return Err(format!("Tie continuation {} overlaps other notes in its engraving lane; assign distinct canonical voices before export", n.note.id));
                }
                index
            } else if let Some(index) = group_lanes.iter().copied().find(|i| lanes[*i].fits(&n)) {
                index
            } else {
                if lanes.len() >= MAX_LANES {
                    return Err("MusicXML export exceeds 256 engraving lanes in one part; separate or simplify dense overlapping voices".into());
                }
                // MusicXML allows text voice labels, but OSMD 2.1.3 parses
                // them with parseInt. Unique positive IDs avoid NaN/prefix collisions.
                let label = (lanes.len() + 1).to_string();
                if !group_lanes.is_empty() {
                    diagnostics.push(Diagnostic::warning("musicxml_engraving_lane", format!("Part '{}', staff {staff}, voice '{voice}' contains overlapping events. Exported voice '{label}' preserves the additional polyphony; the canonical score is unchanged.", part.name), Some(n.note.id.clone())));
                }
                let index = lanes.len();
                lanes.push(Lane {
                    voice: label,
                    original_voice: voice.to_string(),
                    ordinal: (group_lanes.len() + 1) as u16,
                    staff,
                    notes: Vec::new(),
                    onset: -1,
                    end: 0,
                    pitches: HashSet::new(),
                    pitched: false,
                });
                group_lanes.push(index);
                index
            };
            if n.note.tie_start
                && !cross_starts.contains(&n.index)
                && ties
                    .insert(midi.expect("validated pitched tie"), (n.end, lane_index))
                    .is_some()
            {
                return Err(format!(
                    "Note {} begins an ambiguous overlapping tie; assign distinct voices",
                    n.note.id
                ));
            }
            let lane = &mut lanes[lane_index];
            if lane.onset != n.start {
                lane.pitches.clear();
                lane.end = n.end;
            }
            lane.onset = n.start;
            lane.end = lane.end.max(n.end);
            lane.pitched = midi.is_some();
            if let Some(midi) = midi {
                lane.pitches.insert(midi);
            }
            lane.notes.push(n);
        }
        if !ties.is_empty() {
            return Err(format!("Part '{}', voice '{voice}', staff {staff} has an unclosed tie; add its continuation or remove the tie before export", part.name));
        }
    }
    Ok(lanes)
}

fn write_attributes(
    xml: &mut Xml,
    attributes: Option<&Attributes<'_>>,
    initial: Option<(i64, u8, &Part)>,
) -> Result<(), String> {
    if attributes.is_none() && initial.is_none() {
        return Ok(());
    }
    xml.event()?;
    xml.put(format_args!("<attributes>"))?;
    if let Some((divisions, _, _)) = initial {
        xml.put(format_args!("<divisions>{divisions}</divisions>"))?;
    }
    if let Some(key) = attributes.and_then(|a| a.key) {
        xml.put(format_args!("<key><fifths>{}</fifths>", key.fifths))?;
        if key.mode != "unknown" {
            xml.put(format_args!("<mode>{}</mode>", key.mode))?;
        }
        xml.put(format_args!("</key>"))?;
    }
    if let Some(meter) = attributes.and_then(|a| a.meter) {
        xml.put(format_args!(
            "<time><beats>{}</beats><beat-type>{}</beat-type></time>",
            meter.numerator, meter.denominator
        ))?;
    }
    if let Some((_, staves, part)) = initial {
        xml.put(format_args!("<staves>{staves}</staves>"))?;
        // The canonical model has no clefs. Infer concert-pitch treble/bass;
        // never introduce guitar's octave-transposing treble convention.
        let mut ranges = vec![(0_u64, 0_u64); staves as usize];
        for n in &part.notes {
            if let Some(pitch) = n.pitch.as_ref().and_then(|p| p.midi()) {
                let (sum, count) = &mut ranges[n.staff as usize - 1];
                *sum += pitch as u64;
                *count += 1;
            }
        }
        for staff in 1..=staves {
            let (sum, count) = ranges[staff as usize - 1];
            let bass = if count == 0 {
                staff > 1
            } else {
                sum < 60 * count
            };
            xml.put(format_args!(
                "<clef number=\"{staff}\"><sign>{}</sign><line>{}</line></clef>",
                if bass { "F" } else { "G" },
                if bass { 4 } else { 2 }
            ))?;
        }
    }
    xml.put(format_args!("</attributes>\n"))
}
fn move_cursor(
    xml: &mut Xml,
    cursor: &mut i64,
    target: i64,
    lane: Option<&Lane<'_>>,
) -> Result<(), String> {
    if target == *cursor {
        return Ok(());
    }
    xml.event()?;
    if target < *cursor {
        xml.put(format_args!(
            "<backup><duration>{}</duration></backup>\n",
            *cursor - target
        ))?;
    } else {
        xml.put(format_args!(
            "<forward><duration>{}</duration>",
            target - *cursor
        ))?;
        if let Some(lane) = lane {
            xml.put(format_args!(
                "<voice>{}</voice><staff>{}</staff>",
                escape(&lane.voice)?,
                lane.staff
            ))?;
        }
        xml.put(format_args!("</forward>\n"))?;
    }
    *cursor = target;
    Ok(())
}

// All arithmetic is integer. Tuplet ratio is normal/actual, so the written
// power-of-two duration times that ratio equals the exact sounding duration.
fn write_rhythm(xml: &mut Xml, duration: i64, divisions: i64) -> Result<bool, String> {
    const TYPES: [(&str, i64, i64); 14] = [
        ("maxima", 32, 1),
        ("long", 16, 1),
        ("breve", 8, 1),
        ("whole", 4, 1),
        ("half", 2, 1),
        ("quarter", 1, 1),
        ("eighth", 1, 2),
        ("16th", 1, 4),
        ("32nd", 1, 8),
        ("64th", 1, 16),
        ("128th", 1, 32),
        ("256th", 1, 64),
        ("512th", 1, 128),
        ("1024th", 1, 256),
    ];
    for (name, n, d) in TYPES {
        for dots in 0..=3 {
            let factor_d = 1_i64 << dots;
            let factor_n = 2 * factor_d - 1;
            if duration as i128 * d as i128 * factor_d as i128
                == divisions as i128 * n as i128 * factor_n as i128
            {
                xml.put(format_args!("<type>{name}</type>"))?;
                for _ in 0..dots {
                    xml.put(format_args!("<dot/>"))?;
                }
                return Ok(false);
            }
        }
    }
    let (name, n, d) = TYPES
        .iter()
        .copied()
        .take_while(|(_, n, d)| *n as i128 * divisions as i128 >= duration as i128 * *d as i128)
        .last()
        .unwrap_or(TYPES[0]);
    let normal = duration
        .checked_mul(d)
        .ok_or("MusicXML rhythmic spelling overflow")?;
    let actual = divisions
        .checked_mul(n)
        .ok_or("MusicXML rhythmic spelling overflow")?;
    let divisor = gcd(normal, actual);
    let (normal, actual) = (normal / divisor, actual / divisor);
    if normal > MAX_DIVISIONS || actual > MAX_DIVISIONS {
        return Err("Exact rhythmic spelling requires a tuplet ratio greater than 1,000,000; shorten the measure or simplify its note durations".into());
    }
    xml.put(format_args!("<type>{name}</type><time-modification><actual-notes>{actual}</actual-notes><normal-notes>{normal}</normal-notes><normal-type>{name}</normal-type></time-modification>"))?;
    Ok(true)
}
#[allow(clippy::too_many_arguments)]
fn write_note(
    xml: &mut Xml,
    segment: &Segment<'_>,
    lane: &Lane<'_>,
    chord: bool,
    divisions: i64,
    part_index: usize,
    bar_index: usize,
) -> Result<bool, String> {
    xml.event()?;
    xml.put(format_args!(
        "<note id=\"N{}_{}_{}\"",
        part_index + 1,
        segment.note_index + 1,
        bar_index + 1
    ))?;
    if segment.note.pitch.is_some() {
        // MusicXML dynamics is a percentage of MIDI forte (90). Six decimals
        // round-trip all 128 integer velocities through nearest-MIDI conversion.
        xml.put(format_args!(
            " dynamics=\"{:.6}\"",
            segment.note.velocity as f64 * 100.0 / 90.0
        ))?;
    }
    xml.put(format_args!(">"))?;
    if chord {
        xml.put(format_args!("<chord/>"))?;
    }
    if let Some(pitch) = &segment.note.pitch {
        xml.put(format_args!(
            "<pitch><step>{}</step><alter>{}</alter><octave>{}</octave></pitch>",
            pitch.step, pitch.alter, pitch.octave
        ))?;
    } else {
        xml.put(format_args!("<rest/>"))?;
    }
    xml.put(format_args!(
        "<duration>{}</duration>",
        segment.end - segment.start
    ))?;
    if segment.tie_stop {
        xml.put(format_args!("<tie type=\"stop\"/>"))?;
    }
    if segment.tie_start {
        xml.put(format_args!("<tie type=\"start\"/>"))?;
    }
    xml.put(format_args!("<voice>{}</voice>", escape(&lane.voice)?))?;
    let tuplet = write_rhythm(xml, segment.end - segment.start, divisions)?;
    xml.put(format_args!("<staff>{}</staff>", segment.note.staff))?;
    if segment.tie_stop || segment.tie_start {
        xml.put(format_args!("<notations>"))?;
        if segment.tie_stop {
            xml.put(format_args!("<tied type=\"stop\"/>"))?;
        }
        if segment.tie_start {
            xml.put(format_args!("<tied type=\"start\"/>"))?;
        }
        xml.put(format_args!("</notations>"))?;
    }
    xml.put(format_args!("</note>\n"))?;
    Ok(tuplet)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{compile, import_musicxml, Measure, Pitch, Provenance, Repeat, Source, Tempo};

    fn score() -> Score {
        Score {
            format_metadata: Some(crate::FormatMetadata::current()),
            version: 1,
            id: "original-id".into(),
            title: "Exact étude & <duet> 🎹".into(),
            composer: "世界 'Composer' \"C\"".into(),
            provenance: Provenance {
                kind: "original".into(),
                attribution: "Test authors".into(),
                source_url: Some("https://example.invalid/private-source".into()),
                license: Some("MIT".into()),
            },
            parts: vec![Part {
                id: "canonical/unsafe id".into(),
                name: "Piano & 琴".into(),
                instrument: "piano".into(),
                notes: vec![],
            }],
            tempo: vec![Tempo {
                at: Beat::ZERO,
                bpm: 120.,
            }],
            meters: vec![Meter {
                at: Beat::ZERO,
                numerator: 4,
                denominator: 4,
            }],
            keys: vec![Key {
                at: Beat::ZERO,
                fifths: 0,
                mode: "major".into(),
            }],
            measures: vec![
                Measure {
                    number: 1,
                    at: Beat::ZERO,
                    length: Beat::new(4, 1),
                },
                Measure {
                    number: 2,
                    at: Beat::new(4, 1),
                    length: Beat::new(4, 1),
                },
            ],
            repeats: vec![],
            source: Some(Source {
                import_diagnostics: None,
                format: "image".into(),
                filename: Some("private.png".into()),
                content: "RAW_IMAGE_NOT_XML <!DOCTYPE malicious> https://example.invalid/image"
                    .into(),
            }),
        }
    }
    fn note(
        id: &str,
        at: Beat,
        duration: Beat,
        pitch: Option<(&str, i8, i8)>,
        voice: &str,
        staff: u8,
    ) -> Note {
        Note {
            id: id.into(),
            at,
            duration,
            pitch: pitch.map(|(step, alter, octave)| Pitch {
                step: step.into(),
                alter,
                octave,
            }),
            voice: voice.into(),
            staff,
            velocity: if pitch.is_some() { 73 } else { 0 },
            tie_start: false,
            tie_stop: false,
        }
    }
    fn sounding(score: Score) -> Vec<(usize, u8, i64, i64, u8, u8)> {
        let ids: HashMap<_, _> = score
            .parts
            .iter()
            .enumerate()
            .map(|(i, p)| (p.id.clone(), i))
            .collect();
        let mut result: Vec<_> = compile(score)
            .unwrap()
            .timeline
            .notes
            .into_iter()
            .map(|n| {
                (
                    ids[&n.part_id],
                    n.midi,
                    (n.start_ms * 1_000_000.).round() as i64,
                    (n.duration_ms * 1_000_000.).round() as i64,
                    n.staff,
                    n.velocity,
                )
            })
            .collect();
        result.sort_unstable();
        result
    }
    fn round_trip(original: &Score) -> (ExportedMusicXml, Score) {
        let before = serde_json::to_string(original).unwrap();
        let exported = export_musicxml(original).unwrap();
        let (imported, _) = import_musicxml(&exported.xml).unwrap();
        assert_eq!(
            before,
            serde_json::to_string(original).unwrap(),
            "export mutated its input"
        );
        assert_eq!(sounding(original.clone()), sounding(imported.clone()));
        let first = compile(original.clone()).unwrap().timeline.duration_ms;
        let second = compile(imported.clone()).unwrap().timeline.duration_ms;
        assert!((first - second).abs() < 0.000001);
        (exported, imported)
    }
    #[test]
    fn written_identity_map_matches_xml_cursor_voices_splits_and_unequal_chords() {
        let mut original = score();
        original.measures[0].number = 0;
        original.measures[1].number = 0;
        original.parts[0].notes = vec![
            note(
                "long C",
                Beat::ZERO,
                Beat::new(6, 1),
                Some(("C", 0, 4)),
                "melody",
                1,
            ),
            note(
                "short D",
                Beat::ZERO,
                Beat::new(1, 3),
                Some(("D", 0, 4)),
                "melody",
                1,
            ),
            note(
                "unison C",
                Beat::ZERO,
                Beat::new(2, 1),
                Some(("C", 0, 4)),
                "melody",
                1,
            ),
            note("rest", Beat::new(3, 1), Beat::new(3, 1), None, "bass", 2),
            note(
                "repeat C",
                Beat::new(6, 1),
                Beat::new(1, 1),
                Some(("C", 0, 4)),
                "melody",
                1,
            ),
        ];
        let before = serde_json::to_string(&original).unwrap();
        let exported = export_musicxml(&original).unwrap();
        assert_eq!(before, serde_json::to_string(&original).unwrap());
        let map = exported.note_id_map.as_ref().unwrap();
        assert_eq!(map.version, 1);
        assert_eq!(map.segments.len(), 7);
        let by_id: HashMap<_, _> = map
            .segments
            .iter()
            .map(|s| (s.xml_note_id.as_str(), s))
            .collect();
        assert_eq!(by_id.len(), 7);
        let document = roxmltree::Document::parse(&exported.xml).unwrap();
        let child = |n: roxmltree::Node<'_, '_>, name: &str| {
            n.children()
                .find(|c| c.has_tag_name(name))
                .unwrap()
                .text()
                .unwrap()
                .to_owned()
        };
        let mut visited = 0;
        for part in document
            .root_element()
            .children()
            .filter(|n| n.has_tag_name("part"))
        {
            let mut divisions = 0_i64;
            for (measure_index, measure) in part
                .children()
                .filter(|n| n.has_tag_name("measure"))
                .enumerate()
            {
                let (mut cursor, mut chord_at) = (0_i64, 0_i64);
                for event in measure.children().filter(|n| n.is_element()) {
                    match event.tag_name().name() {
                        "attributes" => {
                            if let Some(d) = event.children().find(|n| n.has_tag_name("divisions"))
                            {
                                divisions = d.text().unwrap().parse().unwrap();
                            }
                        }
                        "backup" => cursor -= child(event, "duration").parse::<i64>().unwrap(),
                        "forward" => cursor += child(event, "duration").parse::<i64>().unwrap(),
                        "note" => {
                            visited += 1;
                            let segment = by_id[event.attribute("id").unwrap()];
                            let chord = event.children().any(|n| n.has_tag_name("chord"));
                            let duration: i64 = child(event, "duration").parse().unwrap();
                            if !chord {
                                chord_at = cursor;
                                cursor += duration;
                            }
                            assert_eq!(segment.xml_part_id, part.attribute("id").unwrap());
                            assert_eq!(segment.source_measure_index, measure_index);
                            assert_eq!(segment.measure_number, 0);
                            assert_eq!(segment.xml_voice, child(event, "voice"));
                            assert_eq!(segment.staff.to_string(), child(event, "staff"));
                            assert_eq!(segment.chord, chord);
                            assert!(segment
                                .measure_at
                                .equivalent(Beat::new(chord_at, divisions)));
                            assert!(segment.duration.equivalent(Beat::new(duration, divisions)));
                            assert!(segment.at.equivalent(
                                original.measures[measure_index]
                                    .at
                                    .checked_add(segment.measure_at)
                                    .unwrap()
                            ));
                            assert_eq!(
                                segment.pitch.is_none(),
                                event.children().any(|n| n.has_tag_name("rest"))
                            );
                            for (kind, expected) in
                                [("start", segment.tie_start), ("stop", segment.tie_stop)]
                            {
                                assert_eq!(
                                    expected,
                                    event.children().any(|n| n.has_tag_name("tie")
                                        && n.attribute("type") == Some(kind))
                                );
                            }
                            if let Some(pitch) = &segment.pitch {
                                let p = event.children().find(|n| n.has_tag_name("pitch")).unwrap();
                                assert_eq!(pitch.step, child(p, "step"));
                                assert_eq!(pitch.alter.to_string(), child(p, "alter"));
                                assert_eq!(pitch.octave.to_string(), child(p, "octave"));
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
        assert_eq!(visited, map.segments.len());
        let long: Vec<_> = map
            .segments
            .iter()
            .filter(|s| s.source_note_id == "long C")
            .collect();
        assert_eq!(long.len(), 2);
        assert!(long[0].tie_start && !long[0].tie_stop);
        assert!(!long[1].tie_start && long[1].tie_stop);
        let short = map
            .segments
            .iter()
            .find(|s| s.source_note_id == "short D")
            .unwrap();
        assert!(short.chord && short.duration.equivalent(Beat::new(1, 3)));
        let unison = map
            .segments
            .iter()
            .find(|s| s.source_note_id == "unison C")
            .unwrap();
        assert_ne!(long[0].xml_voice, unison.xml_voice);
        assert_eq!(long[0].voice, unison.voice);
        assert!(map
            .segments
            .iter()
            .filter(|s| s.source_note_id == "rest")
            .all(|s| !s.tie_start && !s.tie_stop));
    }

    #[test]
    fn identity_metadata_is_complete_or_explicitly_unavailable_and_old_exports_decode() {
        let score = crate::catalog().remove(0);
        let exported = export_musicxml(&score).unwrap();
        let segment = exported.note_id_map.as_ref().unwrap().segments[0].clone();
        let mut bounded = NoteMapBuilder::new(600);
        bounded.push(segment.clone());
        assert!(bounded.map.is_some());
        bounded.push(segment.clone());
        assert!(bounded.map.is_none(), "never retain a partial identity map");
        bounded.push(segment);
        assert!(bounded.map.is_none());
        let mut old = serde_json::to_value(&exported).unwrap();
        old.as_object_mut().unwrap().remove("note_id_map");
        let decoded: ExportedMusicXml = serde_json::from_value(old).unwrap();
        assert!(decoded.note_id_map.is_none());
        assert_eq!(decoded.xml, exported.xml);
        for id in [
            "cc0-schubert-wandrers-nachtlied-d768",
            "cc0-beethoven-gottes-macht-op48-5",
        ] {
            {
                let score = crate::catalog_score(id).expect("admitted complete edition");
                let output = export_musicxml(&score).unwrap();
                let map = output.note_id_map.unwrap();
                let mapped: HashSet<_> = map.segments.iter().map(|s| &s.source_note_id).collect();
                let original: HashSet<_> = score
                    .parts
                    .iter()
                    .flat_map(|p| p.notes.iter().map(|n| &n.id))
                    .collect();
                assert_eq!(mapped, original);
            }
        }
    }
    #[test]
    fn complete_cc0_edition_exports_its_valid_cross_voice_tie_without_changing_sources() {
        let original = crate::catalog_score("cc0-schubert-wandrers-nachtlied-d768").unwrap();
        let (exported, imported) = round_trip(&original);
        assert_eq!(compile(imported.clone()).unwrap().timeline.notes.len(), 321);
        assert_eq!(
            imported
                .parts
                .iter()
                .flat_map(|p| &p.notes)
                .filter(|n| n.pitch.is_some())
                .count(),
            324
        );
        assert!(exported
            .diagnostics
            .iter()
            .any(|d| d.code == "musicxml_cross_lane_tie"));
        assert!(exported
            .voice_id_map
            .iter()
            .any(|v| v.part_id == "P2" && v.voice == "1"));
        assert!(exported
            .voice_id_map
            .iter()
            .any(|v| v.part_id == "P2" && v.voice == "2"));
    }
    #[test]
    fn imported_standard_headers_never_reach_generated_renderer_xml() {
        let xml = include_str!("../../../tests/fixtures/original-duet-standard-header.musicxml");
        let original = import_musicxml(xml).unwrap().0;
        let (exported, imported) = round_trip(&original);
        assert!(!exported.xml.contains("<!DOCTYPE"));
        assert!(!exported.xml.contains("<!ENTITY"));
        assert_eq!(
            original.source.as_ref().unwrap().content.as_bytes(),
            xml.as_bytes()
        );
        assert!(imported
            .source
            .as_ref()
            .unwrap()
            .import_diagnostics
            .as_ref()
            .unwrap()
            .iter()
            .all(|d| d.code != "musicxml_header_normalized"));
        let expected = import_musicxml(include_str!(
            "../../../tests/fixtures/original-duet.musicxml"
        ))
        .unwrap()
        .0;
        let baseline_export = export_musicxml(&expected).unwrap();
        assert_eq!(
            exported.xml, baseline_export.xml,
            "Source-only header and source-derived IDs do not alter generated supported notation"
        );
        assert_eq!(
            serde_json::to_value(&original.tempo).unwrap(),
            serde_json::to_value(&imported.tempo).unwrap()
        );
        assert_eq!(
            serde_json::to_value(&original.meters).unwrap(),
            serde_json::to_value(&imported.meters).unwrap()
        );
        assert_eq!(
            serde_json::to_value(&original.keys).unwrap(),
            serde_json::to_value(&imported.keys).unwrap()
        );
    }
    #[test]
    fn explicit_cross_voice_and_staff_chains_keep_written_lanes_and_one_sounding_note() {
        let mut s = score();
        s.parts[0].notes = vec![
            note(
                "a",
                Beat::ZERO,
                Beat::new(1, 1),
                Some(("C", 0, 4)),
                "left",
                1,
            ),
            note(
                "b",
                Beat::new(1, 1),
                Beat::new(1, 1),
                Some(("C", 0, 4)),
                "right",
                1,
            ),
            note(
                "c",
                Beat::new(2, 1),
                Beat::new(1, 1),
                Some(("C", 0, 4)),
                "lower",
                2,
            ),
        ];
        s.parts[0].notes[0].tie_start = true;
        s.parts[0].notes[1].tie_stop = true;
        s.parts[0].notes[1].tie_start = true;
        s.parts[0].notes[2].tie_stop = true;
        let (exported, imported) = round_trip(&s);
        assert_eq!(compile(imported).unwrap().timeline.notes.len(), 1);
        assert_eq!(exported.voice_id_map.len(), 3);
        assert_eq!(
            exported
                .diagnostics
                .iter()
                .filter(|d| d.code == "musicxml_cross_lane_tie")
                .count(),
            2
        );
        for n in &mut s.parts[0].notes {
            n.tie_start = false;
            n.tie_stop = false;
        }
        let (_, rearticulated) = round_trip(&s);
        assert_eq!(compile(rearticulated).unwrap().timeline.notes.len(), 3);
    }
    #[test]
    fn ambiguous_cross_voice_tie_still_requires_explicit_correction() {
        let mut s = score();
        s.parts[0].notes = vec![
            note(
                "a",
                Beat::ZERO,
                Beat::new(1, 1),
                Some(("C", 0, 4)),
                "one",
                1,
            ),
            note(
                "b",
                Beat::ZERO,
                Beat::new(1, 1),
                Some(("C", 0, 4)),
                "two",
                1,
            ),
            note(
                "c",
                Beat::new(1, 1),
                Beat::new(1, 1),
                Some(("C", 0, 4)),
                "three",
                1,
            ),
        ];
        s.parts[0].notes[0].tie_start = true;
        s.parts[0].notes[1].tie_start = true;
        s.parts[0].notes[2].tie_stop = true;
        assert!(export_musicxml(&s)
            .unwrap_err()
            .contains("Ambiguous cross-voice/staff tie"));
    }
    #[test]
    fn unicode_safe_xml_names_and_retained_source_are_isolated() {
        let mut s = score();
        s.parts[0].notes.push(note(
            "<unsafe-note-id>",
            Beat::ZERO,
            Beat::new(1, 1),
            Some(("C", 1, 4)),
            "右 & 左",
            1,
        ));
        let (out, imported) = round_trip(&s);
        assert_eq!(s.title, imported.title);
        assert_eq!(s.composer, imported.composer);
        assert_eq!(s.parts[0].name, imported.parts[0].name);
        assert_eq!(out.voice_id_map[0].voice, s.parts[0].notes[0].voice);
        assert_eq!(
            out.voice_id_map[0].xml_voice,
            imported.parts[0].notes[0].voice
        );
        assert_eq!(out.part_id_map["canonical/unsafe id"], "P1");
        assert!(out.xml.contains("&amp; &lt;duet&gt;"));
        for forbidden in [
            "RAW_IMAGE",
            "<!DOCTYPE",
            "example.invalid",
            "private.png",
            "unsafe-note-id",
        ] {
            assert!(!out.xml.contains(forbidden));
        }
        assert_eq!(
            roxmltree::Document::parse(&out.xml)
                .unwrap()
                .root_element()
                .tag_name()
                .name(),
            "score-partwise"
        );
    }
    #[test]
    fn rights_notices_are_escaped_preserved_in_source_and_never_inferred() {
        let mut s = score();
        s.composer.clear();
        s.provenance.kind = "user_import".into();
        s.provenance.attribution =
            "© 2026 世界 & \"Author\" <arrangement> 'credit'\rSecond line".into();
        s.provenance.license = Some("CC BY-SA 4.0 & <custom notice>".into());
        let (out, imported) = round_trip(&s);
        let document = roxmltree::Document::parse(&out.xml).unwrap();
        let identification = document
            .root_element()
            .children()
            .find(|n| n.has_tag_name("identification"))
            .unwrap();
        let notices: BTreeMap<_, _> = identification
            .children()
            .filter(|n| n.has_tag_name("rights"))
            .map(|n| (n.attribute("type").unwrap(), n.text().unwrap_or("")))
            .collect();
        assert_eq!(notices["attribution"], s.provenance.attribution);
        assert_eq!(notices["license"], s.provenance.license.as_deref().unwrap());
        assert!(!identification.children().any(|n| n.has_tag_name("creator")));
        assert!(out
            .xml
            .contains("&amp; &quot;Author&quot; &lt;arrangement&gt; &apos;credit&apos;&#13;"));
        assert_eq!(imported.source.as_ref().unwrap().content, out.xml);
        assert!(
            imported.provenance.license.is_none(),
            "import must not mistake supplied notices for verified clearance"
        );
        assert!(!out.xml.contains("RAW_IMAGE"));
        assert!(!out.xml.contains("example.invalid"));
        assert!(!document
            .descendants()
            .any(|n| n.is_element() && matches!(n.tag_name().name(), "image" | "source" | "link")));
        s.provenance.license = None;
        let no_license = export_musicxml(&s).unwrap();
        let document = roxmltree::Document::parse(&no_license.xml).unwrap();
        assert_eq!(
            document
                .descendants()
                .filter(|n| n.has_tag_name("rights"))
                .count(),
            1
        );
        assert!(!no_license.xml.contains("type=\"license\""));
        s.provenance.attribution.push('\u{1}');
        assert!(export_musicxml(&s).unwrap_err().contains("XML 1.0"));
        s.provenance.attribution = "Attribution".into();
        s.provenance.license = Some("invalid\u{1}".into());
        assert!(export_musicxml(&s).unwrap_err().contains("XML 1.0"));
    }
    #[test]
    fn imported_original_midi_round_trips_without_timing_quantization() {
        let (s, _) = crate::import_midi(include_bytes!(
            "../../../tests/fixtures/midi-original-ppq.mid"
        ))
        .unwrap();
        let (out, imported) = round_trip(&s);
        assert_eq!(s.parts.len(), imported.parts.len());
        assert!(!out.xml.contains(&s.source.as_ref().unwrap().content));
        assert!(out
            .diagnostics
            .iter()
            .any(|d| d.code == "musicxml_generated_engraving"));
    }
    #[test]
    fn original_duet_preserves_two_hands_maps_chords_rests_and_ties() {
        let (s, _) = import_musicxml(include_str!(
            "../../../tests/fixtures/original-duet.musicxml"
        ))
        .unwrap();
        let (out, imported) = round_trip(&s);
        assert!(out.xml.contains("<chord/>"));
        assert!(out.xml.contains("<backup>"));
        assert!(out.xml.contains("<staves>2</staves>"));
        assert!(out.xml.contains("implicit=\"yes\""));
        assert_eq!(
            serde_json::to_string(&s.tempo).unwrap(),
            serde_json::to_string(&imported.tempo).unwrap()
        );
        assert_eq!(
            serde_json::to_string(&s.meters).unwrap(),
            serde_json::to_string(&imported.meters).unwrap()
        );
        assert_eq!(
            serde_json::to_string(&s.keys).unwrap(),
            serde_json::to_string(&imported.keys).unwrap()
        );
        assert_eq!(
            s.parts
                .iter()
                .flat_map(|p| &p.notes)
                .filter(|n| n.pitch.is_none())
                .count(),
            imported
                .parts
                .iter()
                .flat_map(|p| &p.notes)
                .filter(|n| n.pitch.is_none())
                .count()
        );
    }
    #[test]
    fn cross_bar_notes_and_rests_split_exactly_with_pitched_ties_only() {
        let mut s = score();
        s.parts[0].notes = vec![
            note(
                "long",
                Beat::new(3, 1),
                Beat::new(4, 1),
                Some(("G", -1, 3)),
                "upper",
                1,
            ),
            note("rest", Beat::new(2, 1), Beat::new(4, 1), None, "lower", 2),
        ];
        s.tempo.push(Tempo {
            at: Beat::new(9, 2),
            bpm: 87.25,
        });
        let (out, imported) = round_trip(&s);
        let pitched: Vec<_> = imported.parts[0]
            .notes
            .iter()
            .filter(|n| n.pitch.is_some())
            .collect();
        assert_eq!(pitched.len(), 2);
        assert!(pitched[0].tie_start && pitched[1].tie_stop);
        let rests: Vec<_> = imported.parts[0]
            .notes
            .iter()
            .filter(|n| n.pitch.is_none())
            .collect();
        assert_eq!(rests.len(), 2);
        assert!(rests.iter().all(|n| !n.tie_start && !n.tie_stop));
        assert!(out.xml.contains("<tied type=\"start\"/>"));
        assert!(rests[0].at.equivalent(Beat::new(2, 1)) && rests[1].at.equivalent(Beat::new(4, 1)));
        assert!(rests.iter().all(|n| n.duration.equivalent(Beat::new(2, 1))));
    }
    #[test]
    fn exact_lcm_tuplets_and_intra_measure_signatures() {
        let mut s = score();
        s.parts[0].notes = vec![
            note(
                "third",
                Beat::new(1, 3),
                Beat::new(2, 3),
                Some(("D", 0, 4)),
                "1",
                1,
            ),
            note(
                "fifth",
                Beat::new(6, 5),
                Beat::new(1, 5),
                Some(("E", 0, 4)),
                "1",
                1,
            ),
        ];
        s.keys.push(Key {
            at: Beat::new(1, 2),
            fifths: -3,
            mode: "minor".into(),
        });
        s.meters.push(Meter {
            at: Beat::new(3, 2),
            numerator: 5,
            denominator: 8,
        });
        s.tempo.push(Tempo {
            at: Beat::new(1, 7),
            bpm: 113.75,
        });
        let (out, imported) = round_trip(&s);
        assert!(out.xml.contains("<divisions>210</divisions>"));
        assert!(out
            .diagnostics
            .iter()
            .any(|d| d.code == "musicxml_inferred_rhythm"));
        assert!(imported.keys[1].at.equivalent(Beat::new(1, 2)));
        assert!(imported.meters[1].at.equivalent(Beat::new(3, 2)));
        assert!(imported.parts[0].notes[0].at.equivalent(Beat::new(1, 3)));
    }
    #[test]
    fn overlapping_midi_polyphony_and_unison_use_explicit_lanes() {
        let mut s = score();
        s.parts[0].notes = vec![
            note(
                "base",
                Beat::ZERO,
                Beat::new(4, 1),
                Some(("C", 0, 4)),
                "1",
                1,
            ),
            note(
                "unison",
                Beat::ZERO,
                Beat::new(2, 1),
                Some(("C", 0, 4)),
                "1",
                1,
            ),
            note(
                "inner",
                Beat::new(1, 1),
                Beat::new(4, 1),
                Some(("E", 0, 4)),
                "1",
                1,
            ),
            note(
                "chord",
                Beat::ZERO,
                Beat::new(1, 1),
                Some(("G", 0, 4)),
                "1",
                1,
            ),
        ];
        let (out, imported) = round_trip(&s);
        assert_eq!(
            out.diagnostics
                .iter()
                .filter(|d| d.code == "musicxml_engraving_lane")
                .count(),
            2
        );
        let voices: HashSet<_> = imported.parts[0].notes.iter().map(|n| &n.voice).collect();
        assert_eq!(voices.len(), 3);
        assert!(out.xml.contains("<chord/>"));
    }
    #[test]
    fn explicit_ties_keep_their_lane_and_all_integer_velocities_round_trip() {
        let mut s = score();
        s.parts[0].notes.clear();
        for velocity in 0..=127 {
            let mut n = note(
                &format!("v{velocity}"),
                Beat::ZERO,
                Beat::new(1, 1),
                Some(("C", 0, 4)),
                &format!("{velocity}"),
                1,
            );
            n.velocity = velocity;
            s.parts[0].notes.push(n);
        }
        round_trip(&s);
        s.parts[0].notes = vec![
            note("t1", Beat::ZERO, Beat::new(1, 1), Some(("C", 0, 4)), "1", 1),
            note(
                "t2",
                Beat::new(1, 1),
                Beat::new(1, 1),
                Some(("C", 0, 4)),
                "1",
                1,
            ),
            note(
                "overlap",
                Beat::new(1, 2),
                Beat::new(2, 1),
                Some(("D", 0, 4)),
                "1",
                1,
            ),
        ];
        s.parts[0].notes[0].tie_start = true;
        s.parts[0].notes[1].tie_stop = true;
        round_trip(&s);
    }
    #[test]
    fn repeats_are_exact_and_adjacent_regions_work() {
        let (s, _) = import_musicxml(include_str!(
            "../../../tests/fixtures/original-repeat.musicxml"
        ))
        .unwrap();
        round_trip(&s);
        let mut s = score();
        s.parts[0].notes = vec![
            note(
                "one",
                Beat::ZERO,
                Beat::new(1, 1),
                Some(("C", 0, 4)),
                "1",
                1,
            ),
            note(
                "two",
                Beat::new(4, 1),
                Beat::new(1, 1),
                Some(("D", 0, 4)),
                "1",
                1,
            ),
        ];
        s.repeats = vec![
            Repeat {
                from: Beat::ZERO,
                to: Beat::new(4, 1),
                times: 2,
            },
            Repeat {
                from: Beat::new(4, 1),
                to: Beat::new(8, 1),
                times: 3,
            },
        ];
        let (_, imported) = round_trip(&s);
        assert_eq!(imported.repeats.len(), 2);
    }
    #[test]
    fn partial_and_empty_measures_and_final_boundary_metadata_survive() {
        let mut s = score();
        s.measures[0].number = 0;
        s.measures[0].length = Beat::new(1, 1);
        s.measures[1].at = Beat::new(1, 1);
        s.measures[1].length = Beat::new(3, 2);
        s.tempo.push(Tempo {
            at: Beat::new(5, 2),
            bpm: 60.,
        });
        s.keys.push(Key {
            at: Beat::new(5, 2),
            fifths: 2,
            mode: "unknown".into(),
        });
        let (out, imported) = round_trip(&s);
        assert_eq!(out.xml.matches("implicit=\"yes\"").count(), 2);
        assert!(imported.parts[0].notes.is_empty());
        assert!(imported.measures[1].length.equivalent(Beat::new(3, 2)));
        assert!(imported.keys[1].at.equivalent(Beat::new(5, 2)));
        assert_eq!(imported.keys[1].mode, "unknown");
    }
    #[test]
    fn rejects_inexact_or_unsafe_inputs_with_actionable_errors() {
        let mut s = score();
        s.title.push('\u{1}');
        assert!(export_musicxml(&s).unwrap_err().contains("XML 1.0"));
        s.title = "Safe".into();
        s.parts[0].notes = vec![
            note(
                "a",
                Beat::ZERO,
                Beat::new(1, 997),
                Some(("C", 0, 4)),
                "1",
                1,
            ),
            note(
                "b",
                Beat::new(1, 991),
                Beat::new(1, 983),
                Some(("D", 0, 4)),
                "1",
                1,
            ),
        ];
        assert!(export_musicxml(&s)
            .unwrap_err()
            .contains("divisions exceed"));
        s.parts[0].notes.clear();
        s.measures[1].at = Beat::new(5, 1);
        assert!(export_musicxml(&s).unwrap_err().contains("gap, overlap"));
        s.measures[1].at = Beat::new(4, 1);
        s.parts[0].notes.push(note(
            "too-long",
            Beat::new(7, 1),
            Beat::new(2, 1),
            Some(("C", 0, 4)),
            "1",
            1,
        ));
        assert!(export_musicxml(&s)
            .unwrap_err()
            .contains("beyond the final measure"));
    }
    #[test]
    fn rejects_unsupported_repeat_boundaries_and_broken_ties() {
        let mut s = score();
        s.repeats.push(Repeat {
            from: Beat::ZERO,
            to: Beat::new(3, 1),
            times: 2,
        });
        assert!(export_musicxml(&s)
            .unwrap_err()
            .contains("split the measure"));
        s.repeats[0].to = Beat::new(4, 1);
        s.parts[0].notes.push(note(
            "cross",
            Beat::new(3, 1),
            Beat::new(2, 1),
            Some(("C", 0, 4)),
            "1",
            1,
        ));
        assert!(export_musicxml(&s)
            .unwrap_err()
            .contains("crosses a repeat boundary"));
        s.repeats.clear();
        s.parts[0].notes[0].tie_stop = true;
        assert!(export_musicxml(&s).unwrap_err().contains("orphan tie"));
        s.parts[0].notes[0].tie_stop = false;
        s.parts[0].notes[0].tie_start = true;
        assert!(export_musicxml(&s).unwrap_err().contains("unclosed tie"));
    }
    #[test]
    fn output_writer_and_event_budget_are_bounded() {
        let mut xml = Xml::default();
        assert!(xml
            .put(format_args!("{}", "x".repeat(MAX_XML_BYTES + 1)))
            .unwrap_err()
            .contains("8 MiB"));
        assert!(xml.text.len() <= MAX_XML_BYTES);
        xml.events = MAX_EVENTS;
        assert!(xml.event().unwrap_err().contains("event limit"));
    }
    #[test]
    fn numeric_voice_ids_do_not_merge_parse_int_collisions_or_two_staves() {
        let mut s = score();
        for (i, label) in ["1", "01", "1abc", "1xyz", "right", "left", "NaN"]
            .iter()
            .enumerate()
        {
            s.parts[0].notes.push(note(
                &format!("n{i}"),
                Beat::ZERO,
                Beat::new(1, 1),
                Some(("C", 0, 4)),
                label,
                1,
            ));
        }
        s.parts[0].notes.push(note(
            "lower",
            Beat::ZERO,
            Beat::new(1, 1),
            Some(("C", 0, 3)),
            "1",
            2,
        ));
        let (out, imported) = round_trip(&s);
        let ids: HashSet<_> = out
            .voice_id_map
            .iter()
            .map(|v| v.xml_voice.parse::<u16>().unwrap())
            .collect();
        assert_eq!(ids.len(), 8);
        assert!(ids.iter().all(|n| *n > 0));
        for original in &s.parts[0].notes {
            let mapped = out
                .voice_id_map
                .iter()
                .find(|v| v.voice == original.voice && v.staff == original.staff)
                .unwrap();
            assert_eq!(mapped.part_id, s.parts[0].id);
            assert_eq!(mapped.lane, 1);
            assert!(imported.parts[0]
                .notes
                .iter()
                .any(|n| n.voice == mapped.xml_voice && n.staff == original.staff));
        }
    }
    #[test]
    fn output_is_deterministic_and_preserves_original_voice_names() {
        let mut s = score();
        s.parts[0].notes = vec![
            note(
                "n1",
                Beat::ZERO,
                Beat::new(2, 1),
                Some(("A", 0, 4)),
                "wmh-lane-1",
                1,
            ),
            note(
                "n2",
                Beat::ZERO,
                Beat::new(2, 1),
                Some(("A", 0, 4)),
                "wmh-lane-1",
                1,
            ),
            note("n3", Beat::new(2, 1), Beat::new(1, 1), None, "staff-two", 2),
        ];
        let first = export_musicxml(&s).unwrap();
        let second = export_musicxml(&s).unwrap();
        assert_eq!(first.xml, second.xml);
        assert!(first.xml.contains("<voice>3</voice>"));
        assert!(first.xml.contains("<voice>2</voice>"));
        assert!(first
            .voice_id_map
            .iter()
            .any(|v| v.voice == "wmh-lane-1" && v.lane == 2));
        assert!(first
            .diagnostics
            .iter()
            .any(|d| d.code == "musicxml_voice_ids"));
        round_trip(&s);
    }
}
