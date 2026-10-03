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
struct Clock {
    segments: Vec<Segment>,
}
impl Clock {
    fn new(events: &[Event]) -> Result<Self, String> {
        let mut result = Self {
            segments: vec![Segment {
                at: Beat::ZERO,
                elapsed: Rational::ZERO,
                tempo: 500_000,
            }],
        };
        for event in events {
            let Command::Tempo {
                microseconds_per_quarter,
            } = event.command
            else {
                continue;
            };
            let elapsed = result.at(event.at)?;
            let last = result.segments.last_mut().ok_or("Missing clock origin")?;
            if last.at.equivalent(event.at) {
                last.tempo = microseconds_per_quarter;
            } else {
                result.segments.push(Segment {
                    at: event.at,
                    elapsed,
                    tempo: microseconds_per_quarter,
                });
            }
        }
        Ok(result)
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
        events,
        notes,
        duration_ms: duration.milliseconds(),
        duration_microseconds: duration.output(),
    })
}
