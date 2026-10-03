//! Exact semantic tempo integration; binary64 only at the scheduling boundary.
use super::*;

#[derive(Clone, Debug, Serialize)]
pub struct ExactMicroseconds {
    pub numerator: String,
    pub denominator: u64,
}
#[derive(Clone, Debug, Serialize)]
pub struct Runtime {
    pub compilation: crate::Compilation,
    /// Display membership from canonical notation, timed by the exact semantic clock.
    /// Unavailable maps leave playback intact and add a compilation diagnostic.
    pub navigation: Option<crate::navigation::NotationNavigation>,
    pub events: Vec<RuntimeEvent>,
    pub notes: Vec<RuntimeNote>,
    pub duration_ms: f64,
    pub duration_microseconds: ExactMicroseconds,
}
#[derive(Clone, Debug, Serialize)]
pub struct RuntimeEvent {
    pub event_id: String,
    pub at_ms: f64,
    pub exact_microseconds: ExactMicroseconds,
    pub origin: Coordinate,
    pub command: Command,
}
#[derive(Clone, Debug, Serialize)]
pub struct RuntimeNote {
    pub event_id: String,
    pub note_id: String,
    pub part_id: String,
    pub track_id: String,
    pub channel: u8,
    pub start_ms: f64,
    pub end_ms: f64,
    pub start_microseconds: ExactMicroseconds,
    pub end_microseconds: ExactMicroseconds,
    pub key: u8,
    pub velocity: u8,
    pub release_velocity: u8,
    pub attack: Coordinate,
    pub release: Coordinate,
}
#[derive(Clone, Copy)]
struct Rational {
    n: u128,
    d: u128,
}
impl Rational {
    const ZERO: Self = Self { n: 0, d: 1 };
    fn new(n: u128, d: u128) -> Result<Self, String> {
        if d == 0 {
            return Err("Invalid exact clock denominator".into());
        }
        let gcd = crate::gcd(n, d);
        let value = Self {
            n: n / gcd,
            d: d / gcd,
        };
        if value.d > 1_000_000 {
            return Err("Exact clock denominator exceeds the semantic profile bound".into());
        }
        Ok(value)
    }
    fn beat(beat: Beat) -> Self {
        Self {
            n: beat.numerator as u128,
            d: beat.denominator as u128,
        }
    }
    fn combine(self, other: Self, subtract: bool) -> Result<Self, String> {
        let gcd = crate::gcd(self.d, other.d);
        let left = self
            .n
            .checked_mul(other.d / gcd)
            .ok_or("Exact clock overflow")?;
        let right = other
            .n
            .checked_mul(self.d / gcd)
            .ok_or("Exact clock overflow")?;
        let n = if subtract {
            left.checked_sub(right)
        } else {
            left.checked_add(right)
        }
        .ok_or("Exact clock overflow or negative interval")?;
        let d = self
            .d
            .checked_mul(other.d / gcd)
            .ok_or("Exact clock denominator overflow")?;
        Self::new(n, d)
    }
    fn multiply(self, value: u32) -> Result<Self, String> {
        Self::new(
            self.n
                .checked_mul(value as u128)
                .ok_or("Exact clock overflow")?,
            self.d,
        )
    }
    fn output(self) -> ExactMicroseconds {
        ExactMicroseconds {
            numerator: self.n.to_string(),
            denominator: self.d as u64,
        }
    }
    fn milliseconds(self) -> f64 {
        // Preserve integer and remainder separately until the output boundary.
        let d = self.d * 1000;
        (self.n / d) as f64 + (self.n % d) as f64 / d as f64
    }
}
struct Segment {
    at: Beat,
    elapsed: Rational,
    tempo: u32,
}
pub(crate) struct Clock {
    segments: Vec<Segment>,
}
impl Clock {
    pub(crate) fn new(events: &[Event]) -> Result<Self, String> {
        Self::from_tempos(events.iter().filter_map(|event| match event.command {
            Command::Tempo {
                microseconds_per_quarter,
            } => Some((event.at, microseconds_per_quarter)),
            _ => None,
        }))
    }
    pub(crate) fn from_tempos(
        tempos: impl IntoIterator<Item = (Beat, u32)>,
    ) -> Result<Self, String> {
        let mut result = Self {
            segments: vec![Segment {
                at: Beat::ZERO,
                elapsed: Rational::ZERO,
                tempo: 500_000,
            }],
        };
        for (at, tempo) in tempos {
            let elapsed = result.at(at)?;
            let last = result.segments.last_mut().ok_or("Missing clock origin")?;
            if last.at.equivalent(at) {
                last.tempo = tempo;
            } else {
                result.segments.push(Segment { at, elapsed, tempo });
            }
        }
        Ok(result)
    }
    pub(crate) fn relative_milliseconds(&self, at: Beat, origin: Beat) -> Result<f64, String> {
        if !at.valid() || at.numerator < 0 || at.compare(origin).is_lt() {
            return Err(
                "Fingering phrase boundaries must be at or after the native practice origin".into(),
            );
        }
        Ok(self.at(at)?.combine(self.at(origin)?, true)?.milliseconds())
    }
    fn at(&self, at: Beat) -> Result<Rational, String> {
        let index = self.segments.partition_point(|s| !s.at.compare(at).is_gt());
        let segment = self
            .segments
            .get(index.saturating_sub(1))
            .ok_or("Missing clock segment")?;
        let delta = Rational::beat(at)
            .combine(Rational::beat(segment.at), true)?
            .multiply(segment.tempo)?;
        segment.elapsed.combine(delta, false)
    }
}
fn event_id(hash: &str, origin: Coordinate) -> String {
    format!("midi:{hash}:t{}:e{}", origin.track, origin.event)
}

// Remapping binary64 boundaries can change their serialized lengths. Keep the
// existing navigation/cursor byte bounds after remapping, without allocating a
// second response or weakening the generic navigation limits.
fn fits_display_limit(value: &impl Serialize, limit: usize) -> bool {
    struct Remaining(usize);
    impl std::io::Write for Remaining {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 = self
                .0
                .checked_sub(bytes.len())
                .ok_or_else(|| std::io::Error::other("Display response limit exceeded"))?;
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    serde_json::to_writer(Remaining(limit), value).is_ok()
}

fn complete_navigation(
    score: &CompleteScore,
    clock: &Clock,
    compilation: &crate::Compilation,
) -> Result<crate::navigation::NotationNavigation, String> {
    // Reuse all canonical membership, count and response limits. This profile
    // is validated as an unfolded, untied performance, so source Beats are also
    // performance Beats; the BPM-derived boundaries must not survive this step.
    let mut navigation = crate::navigation::notation_navigation(score.notation.clone())?;
    if navigation
        .occurrences
        .last()
        .is_none_or(|last| !last.source_to.equivalent(score.performance.end))
    {
        return Err("The complete written measure map and semantic performance have different extents. No written intervals or performance tail were clipped".into());
    }
    for occurrence in &mut navigation.occurrences {
        occurrence.start_ms = clock.at(occurrence.source_from)?.milliseconds();
        occurrence.end_ms = clock.at(occurrence.source_to)?.milliseconds();
        if occurrence.end_ms <= occurrence.start_ms {
            return Err("Written intervals are too small for a reliable exact display clock; use manual notation paging".into());
        }
    }
    if let Some(cursor) = &mut navigation.written_cursor {
        let notes: BTreeMap<_, _> = score
            .notation
            .parts
            .iter()
            .flat_map(|part| part.notes.iter().map(|note| (note.id.as_str(), note)))
            .collect();
        for span in &mut cursor.spans {
            let note = notes[cursor.source_note_ids[span.source_note_index].as_str()];
            let occurrence = &navigation.occurrences[span.measure_occurrence_index];
            let from = if note.at.compare(occurrence.source_from).is_gt() {
                note.at
            } else {
                occurrence.source_from
            };
            let note_end = note
                .at
                .checked_add(note.duration)
                .ok_or("Note duration overflow")?;
            let to = if note_end.compare(occurrence.source_to).is_lt() {
                note_end
            } else {
                occurrence.source_to
            };
            span.start_ms = clock.at(from)?.milliseconds();
            span.end_ms = clock.at(to)?.milliseconds();
        }
    }
    if navigation.written_cursor.as_ref().is_some_and(|cursor| {
        cursor.spans.iter().any(|span| span.end_ms <= span.start_ms)
            || !fits_display_limit(cursor, 4 * 1024 * 1024)
    }) {
        navigation.written_cursor = None;
        navigation.diagnostics.push(crate::Diagnostic::warning(
            "notation_written_cursor_unavailable",
            "The complete exact written-note cursor exceeds 4 MiB or contains intervals too small for a reliable display clock. Measure navigation, canonical notes and playback are unchanged.",
            None,
        ));
    }
    // The display validator binds to the actual compilation, including its
    // start + duration binary64 representation. RuntimeNote::end_ms remains the
    // separately integrated exact endpoint and must not be replaced by this sum.
    navigation.sounding_groups = compilation
        .timeline
        .notes
        .iter()
        .map(|note| crate::navigation::SoundingGroup {
            occurrence_id: note.id.clone(),
            part_id: note.part_id.clone(),
            source_note_ids: note.source_note_ids.clone(),
            start_ms: note.start_ms,
            end_ms: note.start_ms + note.duration_ms,
        })
        .collect();
    navigation.duration_ms = compilation.timeline.duration_ms;
    if !fits_display_limit(&navigation, 16 * 1024 * 1024)
        && navigation.written_cursor.take().is_some()
    {
        navigation.diagnostics.push(crate::Diagnostic::warning(
            "notation_written_cursor_unavailable",
            "Adding the complete exact written-note cursor exceeds the navigation response limit. Use measure following; canonical notes and playback are unchanged.",
            None,
        ));
    }
    if !fits_display_limit(&navigation, 16 * 1024 * 1024) {
        return Err("Exact notation following exceeds 16 MiB; use manual paging or a smaller score. No source events were removed".into());
    }
    Ok(navigation)
}

/// Same validated canonical engine, with times integrated from exact semantic
/// tempo values. Runtime is derived and must never be imported as a score.
pub fn compile_complete(score: &CompleteScore) -> Result<Runtime, String> {
    validate(score)?;
    let clock = Clock::new(&score.performance.events)?;
    let duration = clock.at(score.performance.end)?;
    if duration.milliseconds() > 86_400_000.0 {
        return Err("Complete runtime exceeds the 24-hour playback bound".into());
    }
    let mut compilation = crate::compile(score.notation.clone())?;
    let canonical: BTreeMap<_, _> = score
        .notation
        .parts
        .iter()
        .flat_map(|p| p.notes.iter().map(move |n| (n.id.as_str(), n)))
        .collect();
    let parts: BTreeMap<_, _> = score
        .performance
        .parts
        .iter()
        .map(|p| (p.id.as_str(), p))
        .collect();
    let mut notes = Vec::with_capacity(score.performance.notes.len());
    for source in &score.performance.notes {
        let note = canonical[source.note_id.as_str()];
        let part = parts[source.part_id.as_str()];
        let start = clock.at(note.at)?;
        let end = clock.at(note
            .at
            .checked_add(note.duration)
            .ok_or("Note duration overflow")?)?;
        notes.push(RuntimeNote {
            event_id: event_id(&score.source.sha256, source.attack),
            note_id: source.note_id.clone(),
            part_id: source.part_id.clone(),
            track_id: part.track_id.clone(),
            channel: part.channel,
            start_ms: start.milliseconds(),
            end_ms: end.milliseconds(),
            start_microseconds: start.output(),
            end_microseconds: end.output(),
            key: note
                .pitch
                .as_ref()
                .and_then(|p| p.midi())
                .ok_or("Missing pitch")?,
            velocity: note.velocity,
            release_velocity: source.release_velocity,
            attack: source.attack,
            release: source.release,
        });
    }
    notes.sort_by(|a, b| {
        a.start_ms
            .total_cmp(&b.start_ms)
            .then(a.attack.cmp(&b.attack))
    });
    let by_id: BTreeMap<_, _> = notes.iter().map(|n| (n.note_id.as_str(), n)).collect();
    for note in &mut compilation.timeline.notes {
        let exact = by_id
            .get(note.source_note_id.as_str())
            .ok_or("Canonical runtime note lacks semantic identity")?;
        note.start_ms = exact.start_ms;
        note.duration_ms = exact.end_ms - exact.start_ms;
    }
    compilation
        .timeline
        .notes
        .sort_by(|a, b| a.start_ms.total_cmp(&b.start_ms).then(a.id.cmp(&b.id)));
    compilation.timeline.duration_ms = duration.milliseconds();
    let navigation = match complete_navigation(score, &clock, &compilation) {
        Ok(navigation) => Some(navigation),
        Err(error) => {
            compilation.diagnostics.push(crate::Diagnostic::warning(
                "clean_song_navigation_unavailable",
                format!("Exact clean-song notation following is unavailable: {error}. Static notation and playback remain available."),
                None,
            ));
            None
        }
    };
    let events = score
        .performance
        .events
        .iter()
        .map(|event| {
            let at = clock.at(event.at)?;
            Ok(RuntimeEvent {
                event_id: event_id(&score.source.sha256, event.origin),
                at_ms: at.milliseconds(),
                exact_microseconds: at.output(),
                origin: event.origin,
                command: event.command.clone(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(Runtime {
        compilation,
        navigation,
        events,
        notes,
        duration_ms: duration.milliseconds(),
        duration_microseconds: duration.output(),
    })
}
