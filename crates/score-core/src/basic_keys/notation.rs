//! Bounded source-bound engraving views. These are disposable canonical Score
//! projections, never mutations of the persisted complete event package.
use super::rendition::{RenditionCompilation, RenditionEndReason, RenditionRole, RENDITION_POLICY};
use super::*;
use crate::midi_events::EventKind;
use crate::{Diagnostic, ExportedMusicXml, Key, Measure, Meter, Tempo};

const MAX_MEASURES: u16 = 32;
const MAX_PAGE_ATTACKS: usize = 2048;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DisplayMeter {
    pub numerator: u16,
    pub denominator: u16,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NotationRequest {
    pub part_id: String,
    /// Absent requests the legacy, source-proved interval view.
    #[serde(default)]
    pub rendition_policy_id: Option<String>,
    #[serde(default)]
    pub first_measure: u32,
    #[serde(default = "default_measure_count")]
    pub measure_count: u16,
    #[serde(default)]
    pub display_meter: Option<DisplayMeter>,
    #[serde(default)]
    pub position_ms: Option<f64>,
}
fn default_measure_count() -> u16 {
    16
}
#[derive(Clone, Debug, Serialize)]
pub struct NotationCoverage {
    pub source_attacks: usize,
    pub part_attacks: usize,
    pub part_unresolved_attacks: usize,
    pub part_instantaneous_attacks: usize,
    pub window_attacks: usize,
    pub rendered_positive_keys: usize,
    pub unresolved_attacks: usize,
    pub instantaneous_attacks: usize,
}
#[derive(Clone, Debug, Serialize)]
pub struct PageAttack {
    pub note_id: String,
    pub key: u8,
    pub source_at: Beat,
    pub release_status: ReleaseStatus,
}
#[derive(Clone, Debug, Serialize)]
pub struct PageContinuation {
    pub note_id: String,
    pub source_start: Beat,
    /// Source-proved end in v1; chosen receiver tick in policy-bound v2.
    pub source_end: Beat,
    pub enters_page: bool,
    pub leaves_page: bool,
}
#[derive(Clone, Debug, Serialize)]
pub struct NotationMeasure {
    pub source_measure_index: u32,
    pub source_at: Beat,
    pub source_end: Beat,
    pub start_ms: Option<f64>,
    pub end_ms: Option<f64>,
    /// Receiver follow boundary; only the terminal bar can include a synthetic tail.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub follow_end_ms: Option<f64>,
}
/// Bounded evidence for every selected receiver target displayed on this page.
/// `receiver_end` is the chosen event tick, before any explicit synthetic gate.
#[derive(Clone, Debug, Serialize)]
pub struct InterpretedPageNote {
    pub note_id: String,
    pub key: u8,
    pub role: RenditionRole,
    pub attack: Coordinate,
    pub release: Option<Coordinate>,
    pub source_at: Beat,
    pub receiver_end: Beat,
    pub source_end_tick: Option<u64>,
    pub receiver_end_tick: u64,
    pub start_ms: f64,
    pub end_ms: f64,
    pub start_exact: ExactMicroseconds,
    pub end_exact: ExactMicroseconds,
    pub source_release_status: ReleaseStatus,
    pub end_reason: RenditionEndReason,
    pub synthetic_gate: bool,
    pub display_kind: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct NotationPage {
    pub profile: String,
    pub view_version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rendition_policy_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rendition_duration_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_clock_available: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub follow_end_ms: Option<f64>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub interpreted_notes: Vec<InterpretedPageNote>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub onsets: Vec<PageAttack>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub selectors: Vec<PageAttack>,
    pub status: String,
    pub source_sha256: String,
    pub part_id: String,
    pub first_measure: u32,
    pub measure_count: u16,
    pub total_measures: u64,
    pub next_measure: Option<u32>,
    pub source_start: Option<Beat>,
    pub source_end: Option<Beat>,
    pub source_start_ms: Option<f64>,
    pub source_end_ms: Option<f64>,
    pub source_duration_ms: Option<f64>,
    pub resolved_position_ms: Option<f64>,
    pub measures: Vec<NotationMeasure>,
    pub meter_origin: String,
    pub tempo_origin: String,
    pub key_origin: String,
    pub score: Option<Score>,
    pub musicxml: Option<ExportedMusicXml>,
    pub coverage: NotationCoverage,
    pub unresolved: Vec<PageAttack>,
    pub instantaneous: Vec<PageAttack>,
    pub continuations: Vec<PageContinuation>,
    pub diagnostics: Vec<Diagnostic>,
}

fn warning(code: &str, message: &str) -> Diagnostic {
    Diagnostic {
        severity: "warning".into(),
        code: code.into(),
        message: message.into(),
        note_id: None,
    }
}
fn rat(n: i128, d: i128) -> Result<Beat, String> {
    let gcd = crate::gcd(n.unsigned_abs(), d.unsigned_abs()) as i128;
    let value = Beat::new(
        i64::try_from(n / gcd).map_err(|_| "Notation numerator overflow")?,
        i64::try_from(d / gcd).map_err(|_| "Notation denominator overflow")?,
    );
    value.valid().then_some(value).ok_or_else(|| {
        "Exact notation page exceeds canonical rational bounds; no timing was rounded".into()
    })
}
fn sub(a: Beat, b: Beat) -> Result<Beat, String> {
    rat(
        i128::from(a.numerator) * i128::from(b.denominator)
            - i128::from(b.numerator) * i128::from(a.denominator),
        i128::from(a.denominator) * i128::from(b.denominator),
    )
}
fn plus_multiple(a: Beat, b: Beat, count: u64) -> Result<Beat, String> {
    rat(
        i128::from(a.numerator) * i128::from(b.denominator)
            + i128::from(b.numerator) * i128::from(a.denominator) * i128::from(count),
        i128::from(a.denominator) * i128::from(b.denominator),
    )
}
fn min(a: Beat, b: Beat) -> Beat {
    if a.compare(b).is_lt() {
        a
    } else {
        b
    }
}
fn max(a: Beat, b: Beat) -> Beat {
    if a.compare(b).is_gt() {
        a
    } else {
        b
    }
}
fn source_end(score: &CompleteBasicKeys) -> Result<Beat, String> {
    rat(
        i128::from(score.performance.end_tick),
        i128::from(score.performance.ppq),
    )
}

fn onset_in_window(at: Beat, start: Beat, stop: Beat, source_end: Beat) -> bool {
    at.compare(start).is_ge()
        && (at.compare(stop).is_lt() || (stop.equivalent(source_end) && at.equivalent(stop)))
}

struct ClockSegment {
    at: Beat,
    numerator: u64,
    denominator: u16,
    tempo: u32,
}
struct PageClock {
    segments: Vec<ClockSegment>,
    chosen_ppq: Option<u16>,
}
impl PageClock {
    fn chosen(timeline: &midi_events::RawMidiTimeline) -> Result<Self, String> {
        let mut segments = vec![ClockSegment {
            at: Beat::ZERO,
            numerator: 0,
            denominator: 1,
            tempo: 500000,
        }];
        let (mut tick, mut elapsed, mut tempo) = (0, 0u64, 500000u32);
        for event in timeline.events() {
            elapsed = elapsed
                .checked_add(
                    (event.tick() - tick)
                        .checked_mul(u64::from(tempo))
                        .ok_or("Notation chosen clock overflow")?,
                )
                .ok_or("Notation chosen clock overflow")?;
            tick = event.tick();
            if let EventKind::Tempo {
                microseconds_per_quarter,
            } = event.kind()
            {
                if *microseconds_per_quarter == 0 {
                    continue;
                }
                tempo = *microseconds_per_quarter;
                let divisor = crate::gcd(elapsed.into(), timeline.ppq().into()) as u64;
                let segment = ClockSegment {
                    at: event.beat(),
                    numerator: elapsed / divisor,
                    denominator: (u64::from(timeline.ppq()) / divisor) as u16,
                    tempo,
                };
                if segments
                    .last()
                    .is_some_and(|last| last.at.equivalent(segment.at))
                {
                    *segments.last_mut().expect("initial clock segment") = segment;
                } else {
                    segments.push(segment);
                }
            }
        }
        Ok(Self {
            segments,
            chosen_ppq: Some(timeline.ppq()),
        })
    }
    fn new(timeline: &midi_events::RawMidiTimeline) -> Option<Self> {
        if !timeline.relative_clock_available() {
            return None;
        }
        let mut segments = vec![ClockSegment {
            at: Beat::ZERO,
            numerator: 0,
            denominator: 1,
            tempo: 500000,
        }];
        for event in timeline.events() {
            if let EventKind::Tempo {
                microseconds_per_quarter,
            } = event.kind()
            {
                let time = event
                    .relative_microseconds()
                    .expect("available source clock");
                segments.push(ClockSegment {
                    at: event.beat(),
                    numerator: time.numerator(),
                    denominator: time.denominator(),
                    tempo: *microseconds_per_quarter,
                });
            }
        }
        Some(Self {
            segments,
            chosen_ppq: None,
        })
    }
    fn at(&self, at: Beat) -> Result<f64, String> {
        let index = self
            .segments
            .partition_point(|segment| segment.at.compare(at).is_le())
            .saturating_sub(1);
        let segment = &self.segments[index];
        let delta = sub(at, segment.at)?;
        let n = i128::from(segment.numerator) * i128::from(delta.denominator)
            + i128::from(delta.numerator)
                * i128::from(segment.tempo)
                * i128::from(segment.denominator);
        let d = i128::from(segment.denominator) * i128::from(delta.denominator);
        // Match the rendition's single conversion to f64 at source event ticks,
        // including large numerators. Exact evidence remains authoritative.
        if let Some(ppq) = self.chosen_ppq {
            let common = n * i128::from(ppq);
            if common % d == 0 {
                return Ok((common / d) as f64 / f64::from(ppq) / 1000.);
            }
        }
        let gcd = crate::gcd(n.unsigned_abs(), d as u128) as i128;
        Ok((n / gcd) as f64 / (d / gcd) as f64 / 1000.)
    }
    fn approximate_beat(&self, ms: f64) -> f64 {
        let index = self
            .segments
            .partition_point(|segment| {
                segment.numerator as f64 / f64::from(segment.denominator) / 1000. <= ms
            })
            .saturating_sub(1);
        let segment = &self.segments[index];
        segment.at.value()
            + (ms - segment.numerator as f64 / f64::from(segment.denominator) / 1000.) * 1000.
                / f64::from(segment.tempo)
    }
}
fn count_measures(span: Beat, full: Beat) -> Result<u64, String> {
    let n = i128::from(span.numerator) * i128::from(full.denominator);
    let d = i128::from(span.denominator) * i128::from(full.numerator);
    u64::try_from((n + d - 1) / d).map_err(|_| "Measure count overflow".into())
}
fn measure_at_ms(meters: &[Meter], end: Beat, clock: &PageClock, ms: f64) -> Result<u64, String> {
    let mut total = 0;
    for (index, meter) in meters.iter().enumerate() {
        if meter.at.compare(end).is_ge() {
            break;
        }
        let boundary = min(meters.get(index + 1).map_or(end, |m| m.at), end);
        let full = Beat::new(i64::from(meter.numerator) * 4, i64::from(meter.denominator));
        let count = count_measures(sub(boundary, meter.at)?, full)?;
        if count == 0 {
            continue;
        }
        if ms < clock.at(boundary)? || boundary.equivalent(end) {
            // Float inversion only estimates the index; exact-rational source
            // clock values settle the adjacent measure boundaries.
            let estimate = ((clock.approximate_beat(ms) - meter.at.value()) / full.value())
                .floor()
                .max(0.) as u64;
            let mut offset = estimate.min(count - 1);
            while offset > 0 && clock.at(plus_multiple(meter.at, full, offset)?)? > ms {
                offset -= 1;
            }
            while offset + 1 < count && clock.at(plus_multiple(meter.at, full, offset + 1)?)? <= ms
            {
                offset += 1;
            }
            return Ok(total + offset);
        }
        total += count;
    }
    Ok(0)
}

/// Same bar-boundary rule as the strict MIDI importer: source meter changes
/// and source end truncate a bar exactly, without quantization or padding.
/// Arithmetic skips complete meter segments; even a very distant page does
/// not allocate or iterate its preceding measures.
fn measures(
    meters: &[Meter],
    end: Beat,
    request: &NotationRequest,
) -> Result<(u64, Vec<Measure>), String> {
    let first = u64::from(request.first_measure);
    let last = first + u64::from(request.measure_count);
    let mut total = 0u64;
    let mut page = vec![];
    for (i, meter) in meters.iter().enumerate() {
        if meter.at.compare(end).is_ge() {
            break;
        }
        let boundary = min(meters.get(i + 1).map_or(end, |m| m.at), end);
        let span = sub(boundary, meter.at)?;
        if span.numerator <= 0 {
            continue;
        }
        let full = Beat::new(i64::from(meter.numerator) * 4, i64::from(meter.denominator));
        let count = count_measures(span, full)?;
        let segment_end = total.checked_add(count).ok_or("Measure count overflow")?;
        for index in first.max(total)..last.min(segment_end) {
            let offset = index - total;
            let at = plus_multiple(meter.at, full, offset)?;
            // The last bar ends at the exact source change/end, including a
            // partial bar; avoid representing an out-of-source next boundary.
            let next = if offset + 1 == count {
                boundary
            } else {
                plus_multiple(meter.at, full, offset + 1)?
            };
            page.push(Measure {
                number: u32::try_from(index + 1)
                    .map_err(|_| "Display measure number exceeds u32")?,
                at,
                length: sub(next, at)?,
            });
        }
        total = segment_end;
    }
    Ok((total, page))
}

fn fill_rendition_records(
    source: &CompleteBasicKeys,
    attacks: &[&KeyNote],
    compilation: &RenditionCompilation,
    start: Beat,
    stop: Beat,
    page: &mut NotationPage,
) -> Result<(), String> {
    let indexes: BTreeMap<_, _> = compilation
        .rendition
        .notes
        .iter()
        .zip(&compilation.timeline.notes)
        .map(|(evidence, timed)| (evidence.note_id.as_str(), (evidence, timed)))
        .collect();
    let end = source_end(source)?;
    let mut selected = vec![];
    for source_note in attacks {
        let (note, timed) = indexes
            .get(source_note.note_id.as_str())
            .ok_or("Missing rendition target for a source attack")?;
        let in_window = onset_in_window(source_note.start.beat, start, stop, end);
        if in_window {
            page.coverage.window_attacks += 1;
        }
        let receiver_end = rat(
            i128::from(note.receiver_end_tick),
            i128::from(source.performance.ppq),
        )?;
        let end_ms = timed.start_ms + timed.duration_ms;
        let overlaps = if note.synthetic_gate {
            in_window
                || (timed.start_ms < page.source_end_ms.expect("chosen page clock")
                    && end_ms > page.source_start_ms.expect("chosen page clock"))
        } else {
            source_note.start.beat.compare(stop).is_lt() && receiver_end.compare(start).is_gt()
        };
        if overlaps {
            selected.push((*source_note, *note, *timed, receiver_end, end_ms));
        }
    }
    if selected.len() > MAX_PAGE_ATTACKS {
        page.status = "page_limit".into();
        page.diagnostics.push(warning("notation_page_limit", &format!(
            "This page contains {} receiver targets, above the2048-record display limit. Request fewer measures or a different part; no partial page or trimmed source was returned.", selected.len())));
        return Ok(());
    }
    for (source_note, note, timed, receiver_end, end_ms) in selected {
        let percussion = note.role == RenditionRole::PercussionSelector;
        let display_kind = if percussion {
            "percussion_selector"
        } else if note.synthetic_gate {
            "synthetic_onset"
        } else {
            "interval"
        };
        if percussion || note.synthetic_gate {
            let marker = PageAttack {
                note_id: note.note_id.clone(),
                key: source_note.key,
                source_at: source_note.start.beat,
                release_status: note.source_release_status.clone(),
            };
            if percussion {
                page.selectors.push(marker);
            } else {
                page.onsets.push(marker);
            }
        }
        page.interpreted_notes.push(InterpretedPageNote {
            note_id: note.note_id.clone(),
            key: source_note.key,
            role: note.role.clone(),
            attack: note.attack,
            release: note.release,
            source_at: source_note.start.beat,
            receiver_end,
            source_end_tick: note.source_end_tick,
            receiver_end_tick: note.receiver_end_tick,
            start_ms: timed.start_ms,
            end_ms,
            start_exact: note.start.clone(),
            end_exact: note.end.clone(),
            source_release_status: note.source_release_status.clone(),
            end_reason: note.end_reason.clone(),
            synthetic_gate: note.synthetic_gate,
            display_kind: display_kind.into(),
        });
    }
    Ok(())
}

fn nominal_rendition_note(note: &InterpretedPageNote, source: &KeyNote) -> crate::Note {
    let steps = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
    let alters = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
    crate::Note {
        id: note.note_id.clone(),
        at: note.source_at,
        duration: Beat::ZERO,
        pitch: Some(crate::Pitch {
            step: steps[usize::from(note.key % 12)].into(),
            alter: alters[usize::from(note.key % 12)],
            octave: (note.key / 12) as i8 - 1,
        }),
        voice: "1".into(),
        staff: 1,
        velocity: source.velocity,
        tie_start: false,
        tie_stop: false,
    }
}

pub fn notation_page(
    source: &CompleteBasicKeys,
    request: &NotationRequest,
) -> Result<NotationPage, String> {
    validate(source)?;
    let rendition = match request.rendition_policy_id.as_deref() {
        None => None,
        Some(RENDITION_POLICY) => Some(super::rendition::compile_rendition(source)?),
        Some(_) => return Err("Unknown basic-key notation rendition policy".into()),
    };
    if request
        .position_ms
        .is_some_and(|ms| !ms.is_finite() || ms < 0.)
    {
        return Err("Notation follow position must be finite and nonnegative".into());
    }
    if request.measure_count == 0 || request.measure_count > MAX_MEASURES {
        return Err("Notation page requires 1–32 measures".into());
    }
    let part = source
        .performance
        .parts
        .iter()
        .find(|part| part.id == request.part_id)
        .ok_or("Unknown source-bound notation part")?;
    let original = source
        .notation
        .parts
        .iter()
        .find(|part| part.id == request.part_id)
        .ok_or("Missing canonical notation part")?;
    let attacks: Vec<_> = source
        .performance
        .notes
        .iter()
        .filter(|note| note.part_id == request.part_id)
        .collect();
    let mut result=NotationPage {
        profile:PROFILE.into(),view_version:if rendition.is_some() {2} else {1},status:"ready".into(),source_sha256:source.source.sha256.clone(),part_id:request.part_id.clone(),
        rendition_policy_id:request.rendition_policy_id.clone(),rendition_duration_ms:rendition.as_ref().map(|r|r.rendition.duration_ms),source_clock_available:rendition.as_ref().map(|r|r.rendition.source_clock_available),follow_end_ms:None,interpreted_notes:vec![],onsets:vec![],selectors:vec![],
        first_measure:request.first_measure,measure_count:0,total_measures:0,next_measure:None,source_start:None,source_end:None,source_start_ms:None,source_end_ms:None,source_duration_ms:None,resolved_position_ms:None,measures:vec![],
        meter_origin:"unavailable".into(),tempo_origin:"unavailable".into(),key_origin:"unspecified".into(),score:None,musicxml:None,
        coverage:NotationCoverage {source_attacks:source.coverage.key_attacks,part_attacks:attacks.len(),
            part_unresolved_attacks:attacks.iter().filter(|note|note.end.is_none()).count(),
            part_instantaneous_attacks:attacks.iter().filter(|note|note.end.as_ref().is_some_and(|end|end.tick==note.start.tick)).count(),
            window_attacks:0,rendered_positive_keys:0,unresolved_attacks:0,instantaneous_attacks:0},
        unresolved:vec![],instantaneous:vec![],continuations:vec![],diagnostics:vec![warning("basic_nominal_key_notation","This view engraves determined nominal MIDI key intervals; it does not establish original engraving, acoustic pitch or source sound. All unresolved and zero-time attacks remain in the complete source package.")],
    };
    if rendition.is_some() {
        result.diagnostics = vec![warning("basic_rendition_notation", "This page displays the named basic receiver rendition: FIFO, channel-stop and source-end cleanup gates are chosen intervals, not original written durations. Synthetic 20ms gates appear as labeled onset markers with exact receiver timing; nominal MIDI keys do not establish acoustic pitch or original instruments.")];
    }
    if part.channel == 9 && rendition.is_none() {
        result.status = "percussion_mapping_required".into();
        result.diagnostics.push(warning("percussion_key_numbers","Channel-10 key numbers require an explicit percussion notation mapping; they were not converted to pitched piano notation."));
        return Ok(result);
    }
    let end = source_end(source)?;
    if end.numerator == 0 && rendition.is_none() {
        result.status = "empty_page".into();
        result.diagnostics.push(warning("no_positive_source_span","The source has no positive beat span to lay out. Its instantaneous and unresolved attacks remain explicitly counted; no positive duration or grace notation was invented."));
        return Ok(result);
    }
    let choice=request.display_meter.as_ref().map(|meter| {
        if meter.numerator==0 || meter.numerator>64 || meter.denominator==0 || meter.denominator>64 || !meter.denominator.is_power_of_two() {
            Err("Chosen display meter requires numerator1–64 and a power-of-two denominator1–64".to_string())
        }else {Ok(Meter {at:Beat::ZERO,numerator:meter.numerator,denominator:meter.denominator})}
    }).transpose()?;
    let meter_ambiguous = source.performance.timing.meter == "ambiguous_or_unconventional";
    let mut meter_map = if meter_ambiguous {
        vec![]
    } else {
        source.notation.meters.clone()
    };
    let missing_initial = meter_map
        .first()
        .is_none_or(|meter| !meter.at.equivalent(Beat::ZERO));
    if meter_ambiguous || missing_initial {
        let Some(display) = choice else {
            result.status = "display_meter_required".into();
            result.diagnostics.push(warning("display_meter_required","The source has no unambiguous initial meter. Choose a labeled display meter to lay out bars; no source4/4 meter was inferred."));
            return Ok(result);
        };
        meter_map.insert(0, display);
        result.meter_origin = if meter_ambiguous || source.notation.meters.is_empty() {
            "chosen_display_meter"
        } else {
            "source_with_chosen_initial_meter"
        }
        .into();
        result.diagnostics.push(warning("chosen_display_meter","The user-chosen meter is a display layout choice, not an original source event. Source events and source timing remain unchanged."));
    } else {
        result.meter_origin = "source".into();
    }
    let timeline = conversion::timeline_from_records(&source.performance)?;
    let clock = if rendition.is_some() {
        Some(PageClock::chosen(&timeline)?)
    } else {
        PageClock::new(&timeline)
    };
    result.source_duration_ms = clock.as_ref().map(|clock| clock.at(end)).transpose()?;
    let mut resolved_request = request.clone();
    if let Some(ms) = request.position_ms {
        let clock = clock.as_ref().ok_or(
            "Source clock is unavailable; omit position_ms for paused beat-based notation",
        )?;
        let resolved = ms.min(result.rendition_duration_ms.unwrap_or(clock.at(end)?));
        result.resolved_position_ms = Some(resolved);
        let selected = measure_at_ms(&meter_map, end, clock, resolved)?;
        let count = u64::from(request.measure_count);
        resolved_request.first_measure = u32::try_from(selected / count * count)
            .map_err(|_| "Follow position exceeds notation measure index bounds")?;
        result.first_measure = resolved_request.first_measure;
    }
    // A zero-tick source can still have explicit 20ms receiver targets. It has
    // no positive written duration, so return a bounded onset/selector page.
    if let (0, Some(compilation)) = (end.numerator, rendition.as_ref()) {
        result.total_measures = 1;
        if resolved_request.first_measure != 0 {
            result.status = "empty_page".into();
            return Ok(result);
        }
        result.measure_count = 1;
        result.source_start = Some(Beat::ZERO);
        result.source_end = Some(Beat::ZERO);
        result.source_start_ms = Some(0.);
        result.source_end_ms = Some(0.);
        result.follow_end_ms = result.rendition_duration_ms;
        result.tempo_origin = "chosen_rendition_clock".into();
        result.measures.push(NotationMeasure {
            source_measure_index: 0,
            source_at: Beat::ZERO,
            source_end: Beat::ZERO,
            start_ms: Some(0.),
            end_ms: Some(0.),
            follow_end_ms: result.follow_end_ms,
        });
        fill_rendition_records(
            source,
            &attacks,
            compilation,
            Beat::ZERO,
            Beat::ZERO,
            &mut result,
        )?;
        if result.status != "page_limit" {
            result.status = if part.channel == 9 {
                "percussion_selectors"
            } else {
                "onset_page"
            }
            .into();
        }
        return Ok(result);
    }
    let (total, source_bars) = measures(&meter_map, end, &resolved_request)?;
    result.total_measures = total;
    result.measure_count = source_bars.len() as u16;
    let Some(first) = source_bars.first() else {
        result.status = "empty_page".into();
        return Ok(result);
    };
    let start = first.at;
    let last = source_bars.last().expect("nonempty page");
    let stop = last
        .at
        .checked_add(last.length)
        .ok_or("Page end rational overflow")?;
    result.source_start = Some(start);
    result.source_end = Some(stop);
    result.source_start_ms = clock.as_ref().map(|clock| clock.at(start)).transpose()?;
    result.source_end_ms = clock.as_ref().map(|clock| clock.at(stop)).transpose()?;
    result.follow_end_ms = rendition.as_ref().map(|r| {
        if stop.equivalent(end) {
            r.rendition.duration_ms
        } else {
            result.source_end_ms.expect("chosen clock")
        }
    });
    result.measures = source_bars
        .iter()
        .map(|bar| {
            let bar_end = bar
                .at
                .checked_add(bar.length)
                .ok_or("Measure end exceeds rational bounds")?;
            let end_ms = clock.as_ref().map(|clock| clock.at(bar_end)).transpose()?;
            Ok(NotationMeasure {
                source_measure_index: bar.number - 1,
                source_at: bar.at,
                source_end: bar_end,
                start_ms: clock.as_ref().map(|clock| clock.at(bar.at)).transpose()?,
                end_ms,
                follow_end_ms: rendition.as_ref().map(|r| {
                    if bar_end.equivalent(end) {
                        r.rendition.duration_ms
                    } else {
                        end_ms.expect("chosen clock")
                    }
                }),
            })
        })
        .collect::<Result<_, String>>()?;
    let next = u64::from(resolved_request.first_measure) + source_bars.len() as u64;
    if next < total {
        result.next_measure =
            Some(u32::try_from(next).map_err(|_| "Next measure exceeds display index bounds")?);
    }
    let mut view = Score {
        format_metadata: source.notation.format_metadata.clone(),
        version: source.notation.version,
        id: source.notation.id.clone(),
        title: source.notation.title.clone(),
        composer: source.notation.composer.clone(),
        provenance: source.notation.provenance.clone(),
        parts: vec![crate::Part {
            id: original.id.clone(),
            name: original.name.clone(),
            instrument: original.instrument.clone(),
            notes: vec![],
        }],
        tempo: vec![],
        meters: vec![],
        keys: vec![],
        measures: vec![],
        repeats: vec![],
        source: None,
    };
    // Truncate only the display label to canonical UTF-8 bounds; the complete
    // original track-name bytes remain source events.
    while view.parts[0].name.len() > 256 {
        view.parts[0].name.pop();
    }
    view.measures = source_bars
        .iter()
        .map(|bar| {
            Ok(Measure {
                number: bar.number,
                at: sub(bar.at, start)?,
                length: bar.length,
            })
        })
        .collect::<Result<_, String>>()?;
    view.meters = vec![];
    let active = meter_map
        .iter()
        .rfind(|meter| meter.at.compare(start).is_le())
        .expect("initial meter");
    view.meters.push(Meter {
        at: Beat::ZERO,
        ..active.clone()
    });
    for meter in &meter_map {
        if meter.at.compare(start).is_gt() && meter.at.compare(stop).is_lt() {
            view.meters.push(Meter {
                at: sub(meter.at, start)?,
                ..meter.clone()
            });
        }
    }
    view.tempo = vec![];
    if rendition.is_some() {
        let clock = clock.as_ref().expect("chosen rendition clock");
        let active = clock
            .segments
            .iter()
            .rfind(|segment| segment.at.compare(start).is_le())
            .expect("initial chosen tempo");
        view.tempo.push(Tempo {
            at: Beat::ZERO,
            bpm: 60_000_000. / f64::from(active.tempo),
        });
        for segment in &clock.segments {
            if segment.at.compare(start).is_gt() && segment.at.compare(stop).is_lt() {
                view.tempo.push(Tempo {
                    at: sub(segment.at, start)?,
                    bpm: 60_000_000. / f64::from(segment.tempo),
                });
            }
        }
        result.tempo_origin = "chosen_rendition_clock".into();
    } else if source.performance.timing.relative_clock_available {
        let active = source
            .notation
            .tempo
            .iter()
            .rfind(|tempo| tempo.at.compare(start).is_le());
        view.tempo.push(Tempo {
            at: Beat::ZERO,
            bpm: active.map_or(120., |tempo| tempo.bpm),
        });
        if active.is_none() {
            result.tempo_origin = "smf_default_presentation".into();
            result.diagnostics.push(warning("smf_default_presentation_tempo","The initial120 BPM display mark comes from the SMF default clock, not a source tempo event."));
        } else {
            result.tempo_origin = "source".into();
        }
        for tempo in &source.notation.tempo {
            if tempo.at.compare(start).is_gt() && tempo.at.compare(stop).is_lt() {
                view.tempo.push(Tempo {
                    at: sub(tempo.at, start)?,
                    ..tempo.clone()
                });
            }
        }
    } else {
        result.diagnostics.push(warning("source_clock_ambiguous","Source tempo is ambiguous; this beat-based notation view has no invented tempo mark and cannot establish a timed performance."));
    }
    let mut key_map: BTreeMap<u64, BTreeSet<(i8, u8)>> = BTreeMap::new();
    let mut invalid_key = false;
    for event in timeline.events() {
        if let EventKind::Meta {
            meta_type: 0x59,
            data,
        } = event.kind()
        {
            if data.len() != 2 || !(-7..=7).contains(&(data[0] as i8)) || data[1] > 1 {
                invalid_key = true;
            } else {
                key_map
                    .entry(event.tick())
                    .or_default()
                    .insert((data[0] as i8, data[1]));
            }
        }
    }
    view.keys = vec![];
    if invalid_key || key_map.values().any(|keys| keys.len() > 1) {
        result.key_origin = "ambiguous_or_invalid".into();
        result.diagnostics.push(warning("source_key_ambiguous","Conflicting or invalid source key signatures remain events; no replacement key signature was inferred."));
    } else {
        let keys: Vec<_> = key_map
            .into_iter()
            .map(|(tick, values)| {
                let (fifths, mode) = values.into_iter().next().expect("source key");
                Ok(Key {
                    at: rat(i128::from(tick), i128::from(source.performance.ppq))?,
                    fifths,
                    mode: if mode == 0 { "major" } else { "minor" }.into(),
                })
            })
            .collect::<Result<_, String>>()?;
        if let Some(active) = keys.iter().rfind(|key| key.at.compare(start).is_le()) {
            view.keys.push(Key {
                at: Beat::ZERO,
                ..active.clone()
            });
        }
        for key in &keys {
            if key.at.compare(start).is_gt() && key.at.compare(stop).is_lt() {
                view.keys.push(Key {
                    at: sub(key.at, start)?,
                    ..key.clone()
                });
            }
        }
        if !view.keys.is_empty() {
            result.key_origin = "source".into();
        } else {
            result.diagnostics.push(warning("source_key_unspecified","No key signature is specified for this page; nominal MIDI-key spellings are retained without inventing a source key."));
        }
    }
    let mut incoming = BTreeSet::new();
    let mut outgoing = BTreeSet::new();
    if let Some(compilation) = rendition.as_ref() {
        fill_rendition_records(source, &attacks, compilation, start, stop, &mut result)?;
        if result.status == "page_limit" {
            return Ok(result);
        }
        if part.channel == 9 {
            result.status = "percussion_selectors".into();
            result.diagnostics.push(warning("rendition_percussion_selectors", "Channel-10 targets are displayed as nonpitched MIDI key selectors with exact chosen receiver gates; no staff pitch or drum-kit mapping is inferred."));
            return Ok(result);
        }
        let source_notes: BTreeMap<_, _> = attacks
            .iter()
            .map(|note| (note.note_id.as_str(), *note))
            .collect();
        for note in &result.interpreted_notes {
            if note.synthetic_gate {
                continue;
            }
            let enter = note.source_at.compare(start).is_lt();
            let leave = note.receiver_end.compare(stop).is_gt();
            if enter {
                incoming.insert(note.note_id.clone());
            }
            if leave {
                outgoing.insert(note.note_id.clone());
            }
            if enter || leave {
                result.continuations.push(PageContinuation {
                    note_id: note.note_id.clone(),
                    source_start: note.source_at,
                    source_end: note.receiver_end,
                    enters_page: enter,
                    leaves_page: leave,
                });
            }
            let from = max(note.source_at, start);
            let to = min(note.receiver_end, stop);
            view.parts[0].notes.push(crate::Note {
                at: sub(from, start)?,
                duration: sub(to, from)?,
                ..nominal_rendition_note(note, source_notes[note.note_id.as_str()])
            });
        }
        if !result.onsets.is_empty() {
            result.diagnostics.push(warning("rendition_synthetic_onsets", "Labeled onset markers retain every 20ms synthetic receiver gate and its source ID. They have no invented original written duration; exact start/end receiver times remain authoritative."));
        }
    } else {
        let mut page_records = 0;
        for note in &attacks {
            let in_window = onset_in_window(note.start.beat, start, stop, end);
            if in_window {
                result.coverage.window_attacks += 1;
            }
            match &note.end {
                None if in_window => {
                    page_records += 1;
                    result.coverage.unresolved_attacks += 1;
                }
                Some(end) if end.tick == note.start.tick && in_window => {
                    page_records += 1;
                    result.coverage.instantaneous_attacks += 1;
                }
                Some(end)
                    if end.tick > note.start.tick
                        && note.start.beat.compare(stop).is_lt()
                        && end.beat.compare(start).is_gt() =>
                {
                    page_records += 1;
                }
                _ => {}
            }
        }
        if page_records > MAX_PAGE_ATTACKS {
            result.status = "page_limit".into();
            result.diagnostics.push(warning("notation_page_limit",&format!("This page contains {page_records} key records, above the2048-record display limit. Request fewer measures or a different part; no partial page or trimmed source was returned.")));
            return Ok(result);
        }
        let canonical_notes: BTreeMap<_, _> = original
            .notes
            .iter()
            .map(|note| (note.id.as_str(), note))
            .collect();
        for note in attacks {
            let in_window = onset_in_window(note.start.beat, start, stop, end);
            match &note.end {
                None if in_window => {
                    result.unresolved.push(PageAttack {
                        note_id: note.note_id.clone(),
                        key: note.key,
                        source_at: note.start.beat,
                        release_status: note.release.status.clone(),
                    });
                }
                Some(end) if end.tick == note.start.tick && in_window => {
                    result.instantaneous.push(PageAttack {
                        note_id: note.note_id.clone(),
                        key: note.key,
                        source_at: note.start.beat,
                        release_status: note.release.status.clone(),
                    });
                }
                Some(end)
                    if end.tick > note.start.tick
                        && note.start.beat.compare(stop).is_lt()
                        && end.beat.compare(start).is_gt() =>
                {
                    let enter = note.start.beat.compare(start).is_lt();
                    let leave = end.beat.compare(stop).is_gt();
                    if enter {
                        incoming.insert(note.note_id.clone());
                    }
                    if leave {
                        outgoing.insert(note.note_id.clone());
                    }
                    if enter || leave {
                        result.continuations.push(PageContinuation {
                            note_id: note.note_id.clone(),
                            source_start: note.start.beat,
                            source_end: end.beat,
                            enters_page: enter,
                            leaves_page: leave,
                        });
                    }
                    let canonical = canonical_notes
                        .get(note.note_id.as_str())
                        .ok_or("Missing determined canonical key")?;
                    let from = max(note.start.beat, start);
                    let to = min(end.beat, stop);
                    view.parts[0].notes.push(crate::Note {
                        at: sub(from, start)?,
                        duration: sub(to, from)?,
                        ..(*canonical).clone()
                    });
                }
                _ => {}
            }
        }
    }
    result.coverage.rendered_positive_keys = view.parts[0].notes.len();
    result.coverage.unresolved_attacks = result.unresolved.len();
    result.coverage.instantaneous_attacks = result.instantaneous.len();
    if !result.unresolved.is_empty() || !result.instantaneous.is_empty() {
        result.diagnostics.push(warning("notation_subset","Unresolved and zero-time attacks are explicitly listed beside this positive-duration notation view; no grace notes or release durations were invented."));
    }
    match crate::musicxml_export::export_musicxml_excerpt(&view, &incoming, &outgoing) {
        Ok(exported) => result.musicxml = Some(exported),
        Err(error) => {
            result.status = "rendering_unavailable".into();
            result.diagnostics.push(warning("notation_rendering_unavailable",&format!("The complete source and exact page remain available, but this engraving exceeds a renderer capability: {error}")));
        }
    }
    result.score = Some(view);
    Ok(result)
}
