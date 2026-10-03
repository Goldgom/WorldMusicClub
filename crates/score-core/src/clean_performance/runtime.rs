//! Exact event-clock integration, with no note pairing or synthesized duration.
use super::*;
use sha2::{Digest, Sha256};
#[derive(Clone, Debug, Serialize)]
pub struct ExactMicroseconds {
    pub numerator: String,
    pub denominator: u64,
}
#[derive(Clone, Debug, Serialize)]
pub struct Runtime {
    pub profile: String,
    pub score_id: String,
    pub score_sha256: String,
    pub source_sha256: String,
    pub tracks: Vec<Track>,
    pub parts: Vec<Part>,
    pub events: Vec<RuntimeEvent>,
    pub coverage: Coverage,
    pub duration_microseconds: ExactMicroseconds,
}
#[derive(Clone, Debug, Serialize)]
pub struct RuntimeEvent {
    pub event_id: String,
    pub exact_microseconds: ExactMicroseconds,
    pub origin: Coordinate,
    pub command: Command,
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
            return Err("Invalid clock denominator".into());
        }
        let g = crate::gcd(n, d);
        let r = Self { n: n / g, d: d / g };
        if r.d > 1_000_000 || r.n > u64::MAX as u128 {
            return Err("Exact clock exceeds bounds".into());
        }
        Ok(r)
    }
    fn add_interval(self, prior: Beat, next: Beat, tempo: u32) -> Result<Self, String> {
        let left = next.numerator as u128 * prior.denominator as u128;
        let right = prior.numerator as u128 * next.denominator as u128;
        let n = left
            .checked_sub(right)
            .ok_or("Negative exact interval")?
            .checked_mul(tempo as u128)
            .ok_or("Exact clock overflow")?;
        let interval = Self::new(n, next.denominator as u128 * prior.denominator as u128)?;
        let g = crate::gcd(self.d, interval.d);
        let n = self
            .n
            .checked_mul(interval.d / g)
            .and_then(|a| {
                interval
                    .n
                    .checked_mul(self.d / g)
                    .and_then(|b| a.checked_add(b))
            })
            .ok_or("Exact clock overflow")?;
        Self::new(n, self.d * (interval.d / g))
    }
    fn output(self) -> ExactMicroseconds {
        ExactMicroseconds {
            numerator: self.n.to_string(),
            denominator: self.d as u64,
        }
    }
}
fn clock(
    score: &CompletePerformance,
    output: bool,
) -> Result<(Vec<RuntimeEvent>, Rational), String> {
    let mut elapsed = Rational::ZERO;
    let mut prior = Beat::ZERO;
    let mut tempo = 500_000;
    let mut events = Vec::new();
    for event in &score.performance.events {
        elapsed = elapsed.add_interval(prior, event.at, tempo)?;
        if elapsed.n > 86_400_000_000 * elapsed.d {
            return Err("Performance exceeds the 24-hour playback bound".into());
        }
        prior = event.at;
        if output {
            events.push(RuntimeEvent {
                event_id: event.event_id.clone(),
                exact_microseconds: elapsed.output(),
                origin: event.origin,
                command: event.command.clone(),
            });
        }
        if let Command::Tempo {
            microseconds_per_quarter,
        } = event.command
        {
            tempo = microseconds_per_quarter;
        }
    }
    Ok((events, elapsed))
}
pub(super) fn validate_clock(score: &CompletePerformance) -> Result<(), String> {
    clock(score, false).map(|_| ())
}
/// Hash-bound derived runtime from authoritative clean score bytes, never raw event JSON.
pub fn compile_performance(bytes: &[u8]) -> Result<Runtime, String> {
    let score = decode_json(bytes)?;
    let (events, duration) = clock(&score, true)?;
    Ok(Runtime {
        profile: PROFILE.into(),
        score_id: score.id,
        score_sha256: Sha256::digest(bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect(),
        source_sha256: score.source.sha256,
        tracks: score.performance.tracks,
        parts: score.performance.parts,
        events,
        coverage: score.coverage,
        duration_microseconds: duration.output(),
    })
}
