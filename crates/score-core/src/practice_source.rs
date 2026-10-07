//! Trusted, immutable practice input. A renderer cannot deserialize a timeline
//! into this type. Native adapters load and verify saved packages before binding.
use crate::{basic_keys, clean_song, vsq_clean, Beat, Diagnostic, Score, Timeline};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    cmp::Ordering,
    collections::{HashMap, HashSet},
};

pub const CANONICAL_PROFILE: &str = "wmc-canonical-score-v1";
pub const CANONICAL_RUNTIME_POLICY: &str = "wmc-canonical-practice-v1";
pub const VSQ_RUNTIME_POLICY: &str = "wmh-vsq-base-note-practice-v1";
pub const MAX_SOURCE_UNITS: usize = 100_000;
pub const MAX_OCCURRENCES: usize = 100_000;
const MAX_SOURCE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PracticeSourceBinding {
    pub domain: String,
    pub serialization_revision: u32,
    pub digest: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PracticeRuntimeReceipt {
    pub source_binding: PracticeSourceBinding,
    pub saved_package_sha256: Option<String>,
    pub source_profile: String,
    pub runtime_policy: String,
    pub choice: Option<vsq_clean::PracticeChoice>,
    pub runtime_digest: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct PracticeSourceError {
    pub code: String,
    pub message: String,
    pub source_ids: Vec<String>,
}
impl PracticeSourceError {
    pub(crate) fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            source_ids: vec![],
        }
    }
}
impl std::fmt::Display for PracticeSourceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for PracticeSourceError {}
pub(crate) fn hash<T: Serialize>(value: &T) -> Result<String, PracticeSourceError> {
    let bytes = serde_json::to_vec(value)
        .map_err(|e| PracticeSourceError::new("practice_source_encoding", e.to_string()))?;
    if bytes.len() > MAX_SOURCE_BYTES {
        return Err(PracticeSourceError::new(
            "practice_source_limit",
            "Complete source or runtime exceeds 32 MiB; nothing was truncated",
        ));
    }
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

/// Internal nonnegative exact rational microseconds. Arithmetic has explicit
/// overflow rejection; comparison uses Euclidean division, never binary64.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub(crate) struct Exact {
    #[serde(serialize_with = "serialize_u128")]
    n: u128,
    #[serde(serialize_with = "serialize_u128")]
    d: u128,
}
fn serialize_u128<S: serde::Serializer>(value: &u128, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&value.to_string())
}
fn clock_error() -> PracticeSourceError {
    PracticeSourceError::new(
        "practice_exact_clock_limit",
        "Exact rational clock exceeds the supported arithmetic bound; no time was rounded",
    )
}
impl Exact {
    pub(crate) const ZERO: Self = Self { n: 0, d: 1 };
    fn new(n: u128, d: u128) -> Result<Self, PracticeSourceError> {
        if d == 0 {
            return Err(clock_error());
        }
        let g = crate::gcd(n, d);
        Ok(Self { n: n / g, d: d / g })
    }
    fn parse(n: &str, d: u64) -> Result<Self, PracticeSourceError> {
        Self::new(n.parse().map_err(|_| clock_error())?, d.into())
    }
    fn beat(at: Beat) -> Result<Self, PracticeSourceError> {
        Self::new(
            u128::try_from(at.numerator).map_err(|_| clock_error())?,
            u128::try_from(at.denominator).map_err(|_| clock_error())?,
        )
    }
    fn bpm(value: f64) -> Result<Self, PracticeSourceError> {
        if !value.is_finite() || value <= 0.0 {
            return Err(clock_error());
        }
        let bits = value.to_bits();
        let mantissa = u128::from((bits & ((1_u64 << 52) - 1)) | (1_u64 << 52));
        let shift = ((bits >> 52) & 2047) as i32 - 1023 - 52;
        if shift >= 0 {
            Self::new(
                mantissa.checked_shl(shift as u32).ok_or_else(clock_error)?,
                1,
            )
        } else {
            Self::new(
                mantissa,
                1_u128
                    .checked_shl((-shift) as u32)
                    .ok_or_else(clock_error)?,
            )
        }
    }
    pub(crate) fn add(self, rhs: Self) -> Result<Self, PracticeSourceError> {
        self.combine(rhs, false)
    }
    pub(crate) fn sub(self, rhs: Self) -> Result<Self, PracticeSourceError> {
        self.combine(rhs, true)
    }
    fn combine(self, rhs: Self, subtract: bool) -> Result<Self, PracticeSourceError> {
        let g = crate::gcd(self.d, rhs.d);
        let a = self.n.checked_mul(rhs.d / g).ok_or_else(clock_error)?;
        let b = rhs.n.checked_mul(self.d / g).ok_or_else(clock_error)?;
        let n = if subtract {
            a.checked_sub(b)
        } else {
            a.checked_add(b)
        }
        .ok_or_else(clock_error)?;
        Self::new(n, self.d.checked_mul(rhs.d / g).ok_or_else(clock_error)?)
    }
    fn mul(self, rhs: Self) -> Result<Self, PracticeSourceError> {
        let a = crate::gcd(self.n, rhs.d);
        let b = crate::gcd(rhs.n, self.d);
        Self::new(
            (self.n / a)
                .checked_mul(rhs.n / b)
                .ok_or_else(clock_error)?,
            (self.d / b)
                .checked_mul(rhs.d / a)
                .ok_or_else(clock_error)?,
        )
    }
    pub(crate) fn milliseconds(value: u32) -> Self {
        Self {
            n: u128::from(value) * 1000,
            d: 1,
        }
    }
}
impl Ord for Exact {
    fn cmp(&self, rhs: &Self) -> Ordering {
        let (mut a, mut b, mut c, mut d) = (self.n, self.d, rhs.n, rhs.d);
        let mut reverse = false;
        loop {
            let order = (a / b).cmp(&(c / d));
            if order != Ordering::Equal {
                return if reverse { order.reverse() } else { order };
            }
            let (ar, cr) = (a % b, c % d);
            if ar == 0 || cr == 0 {
                let order = ar.cmp(&cr);
                return if reverse { order.reverse() } else { order };
            }
            (a, b, c, d) = (b, ar, d, cr);
            reverse = !reverse;
        }
    }
}
impl PartialOrd for Exact {
    fn partial_cmp(&self, rhs: &Self) -> Option<Ordering> {
        Some(self.cmp(rhs))
    }
}
#[derive(Clone, Debug, Serialize)]
pub(crate) struct Gate {
    pub start: Exact,
    pub end: Exact,
}
#[derive(Clone, Debug, Serialize)]
pub struct PracticeSourceUnit {
    pub source_id: String,
    pub part_id: String,
}

/// No Deserialize and no public field constructor: complete validated sources
/// and their native interpreters are the only admission paths.
#[derive(Clone, Debug)]
pub struct PracticeSource {
    receipt: PracticeRuntimeReceipt,
    pub(crate) timeline: Timeline,
    pub(crate) parts: Vec<String>,
    pub(crate) units: Vec<PracticeSourceUnit>,
    pub(crate) gates: HashMap<String, Gate>,
    pub(crate) keyboard_excluded: HashSet<String>,
    pub(crate) diagnostics: Vec<Diagnostic>,
}
impl PracticeSource {
    pub fn receipt(&self) -> &PracticeRuntimeReceipt {
        &self.receipt
    }
    pub fn timeline(&self) -> &Timeline {
        &self.timeline
    }
    pub fn source_units(&self) -> &[PracticeSourceUnit] {
        &self.units
    }
    pub fn part_ids(&self) -> &[String] {
        &self.parts
    }
    /// Call only after the native adapter has loaded and verified these exact
    /// saved package bytes. A digest supplied by JavaScript is not verification.
    pub fn with_verified_saved_binding(
        mut self,
        digest: &str,
    ) -> Result<Self, PracticeSourceError> {
        if digest.len() != 64
            || !digest
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(PracticeSourceError::new(
                "practice_package_binding",
                "Verified saved binding must be a lowercase SHA-256 digest",
            ));
        }
        self.receipt.saved_package_sha256 = Some(digest.into());
        Ok(self)
    }
    pub fn from_canonical(score: &Score) -> Result<Self, PracticeSourceError> {
        let compiled = crate::compile(score.clone())
            .map_err(|e| PracticeSourceError::new("practice_source_compile", e))?;
        let retained = score
            .source
            .as_ref()
            .and_then(|s| s.import_diagnostics.as_ref())
            .map_or(0, Vec::len);
        if compiled.diagnostics.iter().skip(retained).any(|d| {
            matches!(
                d.code.as_str(),
                "broken_tie" | "orphan_tie" | "unclosed_tie"
            )
        }) {
            return Err(PracticeSourceError::new(
                "practice_unresolved_tie",
                "Correct unresolved ties before assigning ownership",
            ));
        }
        let exact_notes = crate::fingering_clock::exact_notes(&compiled, None)
            .map_err(|e| PracticeSourceError::new("practice_exact_clock", e))?;
        let segments = crate::navigation_segments(score, crate::written_duration(score))
            .map_err(|e| PracticeSourceError::new("practice_exact_clock", e))?;
        let clock = CanonicalClock::new(score)?;
        let mut offsets = Vec::with_capacity(segments.len());
        let mut elapsed = Exact::ZERO;
        for segment in &segments {
            offsets.push(elapsed);
            elapsed = elapsed.add(clock.at(segment.end)?.sub(clock.at(segment.start)?)?)?;
        }
        let mut gates = HashMap::new();
        for note in exact_notes {
            let segment = &segments[note.start.segment];
            let at = |beat| {
                offsets[note.start.segment].add(clock.at(beat)?.sub(clock.at(segment.start)?)?)
            };
            gates.insert(
                note.note.id,
                Gate {
                    start: at(note.start.at)?,
                    end: at(note.end.at)?,
                },
            );
        }
        let units = score
            .parts
            .iter()
            .flat_map(|p| {
                p.notes
                    .iter()
                    .filter(|n| n.pitch.is_some())
                    .map(|n| PracticeSourceUnit {
                        source_id: n.id.clone(),
                        part_id: p.id.clone(),
                    })
            })
            .collect();
        Self::finish(
            score,
            "wmc-canonical-score-serde-json",
            CANONICAL_PROFILE,
            CANONICAL_RUNTIME_POLICY,
            None,
            compiled.timeline,
            score.parts.iter().map(|p| p.id.clone()).collect(),
            units,
            gates,
            HashSet::new(),
            compiled.diagnostics,
        )
    }
    pub fn from_basic(score: &basic_keys::CompleteBasicKeys) -> Result<Self, PracticeSourceError> {
        // Interpret ALL source events before any ownership choice. In particular,
        // filtering note-ons here would change FIFO release assignments.
        let compiled = basic_keys::compile_rendition(score)
            .map_err(|e| PracticeSourceError::new("practice_basic_compile", e))?;
        let gates = compiled
            .rendition
            .notes
            .iter()
            .map(|n| {
                Ok((
                    n.note_id.clone(),
                    Gate {
                        start: Exact::parse(&n.start.numerator, n.start.denominator.into())?,
                        end: Exact::parse(&n.end.numerator, n.end.denominator.into())?,
                    },
                ))
            })
            .collect::<Result<_, PracticeSourceError>>()?;
        let units = compiled
            .timeline
            .notes
            .iter()
            .map(|n| PracticeSourceUnit {
                source_id: n.source_note_id.clone(),
                part_id: n.part_id.clone(),
            })
            .collect();
        Self::finish(
            score,
            "wmc-basic-complete-serde-json",
            basic_keys::PROFILE,
            basic_keys::RENDITION_POLICY,
            None,
            compiled.timeline,
            score
                .performance
                .parts
                .iter()
                .map(|p| p.id.clone())
                .collect(),
            units,
            gates,
            compiled
                .rendition
                .notes
                .iter()
                .filter(|n| n.role == basic_keys::RenditionRole::PercussionSelector)
                .map(|n| n.note_id.clone())
                .collect(),
            compiled.diagnostics,
        )
    }
    pub fn from_vsq(
        score: &vsq_clean::VsqCompleteScore,
        choice: vsq_clean::PracticeChoice,
    ) -> Result<Self, PracticeSourceError> {
        let (runtime, compiled) = vsq_clean::compile_practice_with_compilation(score, choice)
            .map_err(|e| PracticeSourceError::new("practice_vsq_compile", e))?;
        let gates = runtime
            .notes
            .iter()
            .map(|n| {
                Ok((
                    n.note_id.clone(),
                    Gate {
                        start: Exact::parse(
                            &n.start_microseconds.numerator,
                            n.start_microseconds.denominator,
                        )?,
                        end: Exact::parse(
                            &n.end_microseconds.numerator,
                            n.end_microseconds.denominator,
                        )?,
                    },
                ))
            })
            .collect::<Result<_, PracticeSourceError>>()?;
        let units = runtime
            .notes
            .iter()
            .map(|n| PracticeSourceUnit {
                source_id: n.note_id.clone(),
                part_id: n.part_id.clone(),
            })
            .collect();
        Self::finish(
            score,
            "wmc-vsq-complete-serde-json",
            vsq_clean::PROFILE,
            VSQ_RUNTIME_POLICY,
            Some(choice),
            compiled.timeline,
            runtime.parts.iter().map(|p| p.part_id.clone()).collect(),
            units,
            gates,
            HashSet::new(),
            compiled.diagnostics,
        )
    }
    pub fn from_complete_midi(
        score: &clean_song::CompleteScore,
    ) -> Result<Self, PracticeSourceError> {
        let runtime = clean_song::compile_complete(score)
            .map_err(|e| PracticeSourceError::new("practice_semantic_compile", e))?;
        let gates = runtime
            .notes
            .iter()
            .map(|n| {
                Ok((
                    n.note_id.clone(),
                    Gate {
                        start: Exact::parse(
                            &n.start_microseconds.numerator,
                            n.start_microseconds.denominator,
                        )?,
                        end: Exact::parse(
                            &n.end_microseconds.numerator,
                            n.end_microseconds.denominator,
                        )?,
                    },
                ))
            })
            .collect::<Result<_, PracticeSourceError>>()?;
        let units = runtime
            .notes
            .iter()
            .map(|n| PracticeSourceUnit {
                source_id: n.note_id.clone(),
                part_id: n.part_id.clone(),
            })
            .collect();
        Self::finish(
            score,
            "wmc-semantic-complete-serde-json",
            clean_song::PROFILE,
            clean_song::PROFILE,
            None,
            runtime.compilation.timeline,
            score
                .performance
                .parts
                .iter()
                .map(|p| p.id.clone())
                .collect(),
            units,
            gates,
            runtime
                .notes
                .iter()
                .filter(|n| n.channel == 9)
                .map(|n| n.note_id.clone())
                .collect(),
            runtime.compilation.diagnostics,
        )
    }
    #[allow(clippy::too_many_arguments)]
    fn finish<T: Serialize>(
        source: &T,
        domain: &str,
        profile: &str,
        policy: &str,
        choice: Option<vsq_clean::PracticeChoice>,
        timeline: Timeline,
        parts: Vec<String>,
        units: Vec<PracticeSourceUnit>,
        gates: HashMap<String, Gate>,
        keyboard_excluded: HashSet<String>,
        diagnostics: Vec<Diagnostic>,
    ) -> Result<Self, PracticeSourceError> {
        if units.len() > MAX_SOURCE_UNITS
            || timeline.notes.len() > MAX_OCCURRENCES
            || parts.len() > 128
        {
            return Err(PracticeSourceError::new(
                "practice_source_limit",
                "Source exceeds 100,000 units/occurrences or 128 parts; nothing was truncated",
            ));
        }
        let unit_map: HashMap<_, _> = units
            .iter()
            .map(|u| (u.source_id.as_str(), u.part_id.as_str()))
            .collect();
        if unit_map.len() != units.len() || gates.len() != timeline.notes.len() {
            return Err(PracticeSourceError::new(
                "practice_source_inventory",
                "Source units and exact runtime gates must have unique complete identities",
            ));
        }
        let mut observed_units = HashSet::new();
        for note in &timeline.notes {
            observed_units.extend(note.source_note_ids.iter().map(String::as_str));
            let gate = gates.get(&note.id).ok_or_else(|| {
                PracticeSourceError::new("practice_source_inventory", "Missing exact runtime gate")
            })?;
            if gate.end <= gate.start
                || note.source_note_ids.is_empty()
                || note
                    .source_note_ids
                    .iter()
                    .any(|id| unit_map.get(id.as_str()).copied() != Some(note.part_id.as_str()))
            {
                return Err(PracticeSourceError::new(
                    "practice_source_inventory",
                    "Invalid gate or incomplete source references",
                ));
            }
        }
        if observed_units.len() != units.len() {
            return Err(PracticeSourceError::new(
                "practice_source_inventory",
                "Every source unit must retain at least one complete sounding occurrence",
            ));
        }
        // Reject all exact/display onset disagreements before the float-based
        // existing physical planner can accidentally merge distinct attacks.
        let mut ordered: Vec<_> = timeline.notes.iter().collect();
        ordered.sort_by(|a, b| {
            gates[&a.id]
                .start
                .cmp(&gates[&b.id].start)
                .then(a.id.cmp(&b.id))
        });
        for pair in ordered.windows(2) {
            let exact = gates[&pair[0].id].start.cmp(&gates[&pair[1].id].start);
            let display = pair[0].start_ms.total_cmp(&pair[1].start_ms);
            if exact != display {
                return Err(PracticeSourceError::new("practice_display_clock_collision", "Exact onsets cannot be represented by this display clock; no attacks were merged or removed"));
            }
        }
        let ordered_gates: Vec<_> = timeline
            .notes
            .iter()
            .map(|n| (&n.id, &gates[&n.id]))
            .collect();
        let mut excluded: Vec<_> = keyboard_excluded.iter().collect();
        excluded.sort();
        let receipt = PracticeRuntimeReceipt {
            source_binding: PracticeSourceBinding {
                domain: domain.into(),
                serialization_revision: 1,
                digest: hash(source)?,
            },
            saved_package_sha256: None,
            source_profile: profile.into(),
            runtime_policy: policy.into(),
            choice,
            runtime_digest: hash(&(policy, choice, &timeline, ordered_gates, excluded))?,
        };
        Ok(Self {
            receipt,
            timeline,
            parts,
            units,
            gates,
            keyboard_excluded,
            diagnostics,
        })
    }
}
struct CanonicalClock {
    points: Vec<(Beat, Exact, Exact)>,
}
impl CanonicalClock {
    fn new(score: &Score) -> Result<Self, PracticeSourceError> {
        let mut result = Self {
            points: vec![(Beat::ZERO, Exact::ZERO, Exact { n: 500_000, d: 1 })],
        };
        for tempo in &score.tempo {
            let elapsed = result.at(tempo.at)?;
            let bpm = Exact::bpm(tempo.bpm)?;
            let duration = Exact {
                n: 60_000_000,
                d: 1,
            }
            .mul(Exact { n: bpm.d, d: bpm.n })?;
            if result.points.last().unwrap().0.equivalent(tempo.at) {
                *result.points.last_mut().unwrap() = (tempo.at, elapsed, duration);
            } else {
                result.points.push((tempo.at, elapsed, duration));
            }
        }
        Ok(result)
    }
    fn at(&self, beat: Beat) -> Result<Exact, PracticeSourceError> {
        let i = self
            .points
            .partition_point(|p| p.0.compare(beat).is_le())
            .saturating_sub(1);
        let (at, elapsed, duration) = self.points[i];
        elapsed.add(Exact::beat(beat)?.sub(Exact::beat(at)?)?.mul(duration)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_comparison_handles_large_rationals_without_multiplication_overflow() {
        let a = Exact::new(u128::MAX - 1, u128::MAX).unwrap();
        let b = Exact::new(u128::MAX - 2, u128::MAX - 1).unwrap();
        assert!(a > b);
        assert_eq!(Exact::new(2, 6).unwrap(), Exact::new(1, 3).unwrap());
        assert_eq!(
            Exact::new(7, 3)
                .unwrap()
                .sub(Exact::new(2, 3).unwrap())
                .unwrap(),
            Exact::new(5, 3).unwrap()
        );
        assert!(Exact::new(u128::MAX, 1)
            .unwrap()
            .add(Exact::new(1, 1).unwrap())
            .is_err());
        assert!(Exact::ZERO.sub(Exact::new(1, 1).unwrap()).is_err());
    }
    #[test]
    fn canonical_exact_clock_respects_binary_tempo_and_all_changes() {
        let mut score = crate::catalog().remove(0);
        score.tempo = vec![
            crate::Tempo {
                at: Beat::ZERO,
                bpm: 120.0,
            },
            crate::Tempo {
                at: Beat::new(1, 3),
                bpm: 60.0,
            },
        ];
        let clock = CanonicalClock::new(&score).unwrap();
        assert_eq!(
            clock.at(Beat::new(2, 3)).unwrap(),
            Exact::new(500_000, 1).unwrap()
        );
        let bpm = Exact::bpm(120.5).unwrap();
        assert_eq!(bpm, Exact::new(241, 2).unwrap());
    }
    #[test]
    fn exact_native_display_collisions_fail_before_float_physical_grouping() {
        let mut score = crate::catalog().remove(0);
        score.parts[0].notes.truncate(2);
        let compiled = crate::compile(score.clone()).unwrap();
        let mut timeline = compiled.timeline;
        timeline.notes[1].start_ms = timeline.notes[0].start_ms;
        let units = timeline
            .notes
            .iter()
            .map(|n| PracticeSourceUnit {
                source_id: n.source_note_id.clone(),
                part_id: n.part_id.clone(),
            })
            .collect();
        let gates = timeline
            .notes
            .iter()
            .enumerate()
            .map(|(i, n)| {
                (
                    n.id.clone(),
                    Gate {
                        start: Exact::new(i as u128, 1_000_000).unwrap(),
                        end: Exact::new(1_000_000, 1).unwrap(),
                    },
                )
            })
            .collect();
        let error = PracticeSource::finish(
            &score,
            "test",
            CANONICAL_PROFILE,
            CANONICAL_RUNTIME_POLICY,
            None,
            timeline,
            score.parts.iter().map(|p| p.id.clone()).collect(),
            units,
            gates,
            HashSet::new(),
            vec![],
        )
        .unwrap_err();
        assert_eq!(error.code, "practice_display_clock_collision");
    }
    #[test]
    fn exact_serialization_is_lossless_and_source_bytes_are_bound_separately() {
        let score = crate::catalog().remove(0);
        let original = serde_json::to_vec(&score).unwrap();
        let source = PracticeSource::from_canonical(&score).unwrap();
        let bound = source
            .clone()
            .with_verified_saved_binding(&"a".repeat(64))
            .unwrap();
        assert_eq!(source.receipt.source_binding, bound.receipt.source_binding);
        assert_eq!(source.receipt.runtime_digest, bound.receipt.runtime_digest);
        assert_ne!(
            source.receipt.saved_package_sha256,
            bound.receipt.saved_package_sha256
        );
        assert_eq!(serde_json::to_vec(&score).unwrap(), original);
        assert!(source.with_verified_saved_binding(&"A".repeat(64)).is_err());
        assert_eq!(
            serde_json::to_value(Exact::new(u128::MAX, 1).unwrap()).unwrap()["n"],
            u128::MAX.to_string()
        );
    }
}
