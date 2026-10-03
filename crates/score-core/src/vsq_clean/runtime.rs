use super::*;
use crate::vsq::{VsqMixerTrack, VsqSinger};
use serde::{Deserialize, Serialize};
macro_rules! record {
    ($name:ident { $($field:ident : $ty:ty),* $(,)? }) => {
        #[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
        #[serde(deny_unknown_fields)]
        pub struct $name { $(pub $field: $ty),* }
    };
}
/// No default or automatic fallback from vocal playback exists.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PracticeChoice {
    BaseNotesInstrumental,
}
// Decimal-string numerators avoid JavaScript integer rounding.
record!(ExactMicroseconds {
    numerator: String,
    denominator: u64
});
record!(PracticeRuntime {
    profile: String, source_sha256: String, choice: PracticeChoice,
    project_ppq: u16, premeasure_bars: u32, practice_origin_tick: u64,
    practice_origin_project_microseconds: ExactMicroseconds,
    project_end_tick: u64, end_microseconds: ExactMicroseconds, end_ms: f64,
    master_mix: RuntimeMasterMix, parts: Vec<RuntimePart>, notes: Vec<RuntimeNote>,
    interpretation_limits: Vec<CleanInterpretationLimit>,
});
record!(RuntimeMasterMix {
    fader: i32,
    panpot: i32,
    mute: bool,
    output_mode: i32
});
record!(RuntimePart {
    part_id: String, source_track_index: u16, name: String,
    mix: VsqMixerTrack, audible: bool, singer_descriptors: Vec<VsqSinger>,
});
record!(RuntimeNote {
    note_id: String,
    authored_note_id: String,
    part_id: String,
    source_track_index: u16,
    singer_event_id: String,
    key: u8,
    dynamics: u8,
    project_start_tick: u64,
    project_end_tick: u64,
    start_microseconds: ExactMicroseconds,
    end_microseconds: ExactMicroseconds,
    start_ms: f64,
    end_ms: f64,
    audible: bool,
});
fn exact(numerator: u128, denominator: u64) -> ExactMicroseconds {
    let g = crate::gcd(numerator, u128::from(denominator));
    ExactMicroseconds {
        numerator: (numerator / g).to_string(),
        denominator: denominator / g as u64,
    }
}
fn milliseconds(numerator: u128, denominator: u64) -> f64 {
    let divisor = u128::from(denominator) * 1000;
    (numerator / divisor) as f64 + (numerator % divisor) as f64 / divisor as f64
}
/// Structural preservation cannot enable voicebank synthesis automatically.
pub fn compile_vocal(score: &VsqCompleteScore) -> Result<PracticeRuntime, String> {
    validate(score)?;
    Err("Whole-vocal rendering is blocked: compatible voicebank synthesis, phonetics, expression, dispatch timing and acoustic tails are not implemented. Explicit base-note instrumental practice is available separately.".into())
}
/// Includes every authored note, including muted/unsoloed tracks. `audible`
/// is a reversible reference-listening flag. Exact tempo integration uses one
/// prefix clock after validation and includes changes inside note intervals.
pub fn compile_practice(
    score: &VsqCompleteScore,
    choice: PracticeChoice,
) -> Result<PracticeRuntime, String> {
    validate(score)?;
    let p = &score.authoring;
    let denominator = u64::from(p.ppq);
    let mut accumulated = 0_u128;
    let mut prefix = Vec::with_capacity(p.tempo.len());
    for (i, tempo) in p.tempo.iter().enumerate() {
        if i > 0 {
            let previous = &p.tempo[i - 1];
            accumulated += u128::from(tempo.tick - previous.tick)
                * u128::from(previous.microseconds_per_quarter);
        }
        prefix.push(accumulated);
    }
    let at = |tick: u64| -> u128 {
        let i = p.tempo.partition_point(|t| t.tick <= tick) - 1;
        prefix[i]
            + u128::from(tick - p.tempo[i].tick) * u128::from(p.tempo[i].microseconds_per_quarter)
    };
    let origin = at(p.premeasure_ticks);
    let mut project_end_tick = p.master_end_tick.max(p.premeasure_ticks);
    for track in &p.tracks {
        project_end_tick = project_end_tick.max(track.eos_tick).max(track.end_tick);
        for note in &track.notes {
            project_end_tick = project_end_tick.max(note.tick + note.length_ticks);
        }
    }
    let end = at(project_end_tick) - origin;
    if end > 86_400_000_000_u128 * u128::from(denominator) {
        return Err("VSQ instrumental practice exceeds the 24-hour scheduling limit".into());
    }
    let any_solo = p.mixer.tracks.iter().any(|t| t.solo);
    let mut parts = Vec::with_capacity(p.tracks.len());
    let mut notes = Vec::with_capacity(score.coverage.project.notes);
    for (track, mix) in p.tracks.iter().zip(&p.mixer.tracks) {
        let audible = !p.mixer.master_mute && !mix.mute && (!any_solo || mix.solo);
        let part_id = format!("vsq-track-{}", track.source_track_index);
        parts.push(RuntimePart {
            part_id: part_id.clone(),
            source_track_index: track.source_track_index,
            name: track.common.name.clone(),
            mix: mix.clone(),
            audible,
            singer_descriptors: track.singers.clone(),
        });
        for note in &track.notes {
            let end_tick = note.tick + note.length_ticks;
            let start = at(note.tick)
                .checked_sub(origin)
                .ok_or("VSQ note precedes practice origin")?;
            let end = at(end_tick)
                .checked_sub(origin)
                .ok_or("VSQ note end precedes practice origin")?;
            notes.push(RuntimeNote {
                note_id: format!("vsq-t{}-{}", track.source_track_index, note.id),
                authored_note_id: note.id.clone(),
                part_id: part_id.clone(),
                source_track_index: track.source_track_index,
                singer_event_id: note.singer_event_id.clone(),
                key: note.note_number,
                dynamics: note.dynamics,
                project_start_tick: note.tick,
                project_end_tick: end_tick,
                start_microseconds: exact(start, denominator),
                end_microseconds: exact(end, denominator),
                start_ms: milliseconds(start, denominator),
                end_ms: milliseconds(end, denominator),
                audible,
            });
        }
    }
    // Stable sorting preserves authored EventList order at an equal clock in
    // the same track. Note IDs are identities, not chronological sort keys.
    notes.sort_by_key(|n| (n.project_start_tick, n.source_track_index));
    Ok(PracticeRuntime {
        profile: "wmh-vsq-base-note-practice-v1".into(),
        source_sha256: score.source.sha256.clone(),
        choice,
        project_ppq: p.ppq,
        premeasure_bars: p.premeasure_bars,
        practice_origin_tick: p.premeasure_ticks,
        practice_origin_project_microseconds: exact(origin, denominator),
        project_end_tick,
        end_microseconds: exact(end, denominator),
        end_ms: milliseconds(end, denominator),
        master_mix: RuntimeMasterMix {
            fader: p.mixer.master_fader,
            panpot: p.mixer.master_panpot,
            mute: p.mixer.master_mute,
            output_mode: p.mixer.output_mode,
        },
        parts,
        notes,
        interpretation_limits: CLEAN_LIMITS.to_vec(),
    })
}
