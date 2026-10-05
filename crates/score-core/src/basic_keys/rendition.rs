//! Disposable basic audition/practice interpretation of the complete event
//! model. Nothing here rewrites a source event or proves an original rendition.
use super::*;
use crate::midi_events::{ChannelMessage, EventKind};
use crate::{Diagnostic, TimedNote, Timeline};
use serde::ser::SerializeTuple;
use serde::Serializer;
use std::collections::VecDeque;

pub const RENDITION_POLICY: &str = "wmh-basic-key-rendition-fifo-v1";
pub const RENDITION_LOOKAHEAD_MS: u16 = 100;
pub const RENDITION_VOICE_LIMIT: usize = 128;
const ZERO_GATE_US: u64 = 20_000;
pub const RENDITION_NOTE_COLUMNS: [&str; 13] = [
    "note_id",
    "attack",
    "release",
    "route",
    "channel",
    "role",
    "start",
    "end",
    "source_end_tick",
    "receiver_end_tick",
    "source_release_status",
    "end_reason",
    "synthetic_gate",
];

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RenditionRole {
    MelodicKey,
    PercussionSelector,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RenditionEndReason {
    FifoRelease,
    AllSoundOff,
    AllNotesOff,
    SourceEndCleanup,
}
/// Join one-to-one to `compilation.timeline.notes` by `note_id`. Source event
/// IDs are losslessly `source_event_id(evidence.source_sha256, attack/release)`.
/// Times here are the chosen receiver clock; `source_end_tick` is a separate
/// proved source fact. A synthetic gate never changes that source endpoint.
#[derive(Clone, Debug)]
pub struct RenditionNote {
    pub note_id: String,
    pub attack: Coordinate,
    pub release: Option<Coordinate>,
    pub route: usize,
    pub channel: u8,
    pub role: RenditionRole,
    pub start: ExactMicroseconds,
    pub end: ExactMicroseconds,
    pub source_end_tick: Option<u64>,
    pub receiver_end_tick: u64,
    pub source_release_status: ReleaseStatus,
    pub end_reason: RenditionEndReason,
    pub synthetic_gate: bool,
}
// Repeated per-attack property names exceed the existing large-source wire
// budget. The policy and root columns version these lossless compact rows.
impl Serialize for RenditionNote {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut row = serializer.serialize_tuple(13)?;
        row.serialize_element(&self.note_id)?;
        row.serialize_element(&(self.attack.track, self.attack.event))?;
        row.serialize_element(&self.release.map(|at| (at.track, at.event)))?;
        row.serialize_element(&self.route)?;
        row.serialize_element(&self.channel)?;
        row.serialize_element(&self.role)?;
        row.serialize_element(&(&self.start.numerator, self.start.denominator))?;
        row.serialize_element(&(&self.end.numerator, self.end.denominator))?;
        row.serialize_element(&self.source_end_tick)?;
        row.serialize_element(&self.receiver_end_tick)?;
        row.serialize_element(&self.source_release_status)?;
        row.serialize_element(&self.end_reason)?;
        row.serialize_element(&self.synthetic_gate)?;
        row.end()
    }
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct RenditionCoverage {
    pub source_events: usize,
    pub source_attacks: usize,
    pub derived_voices: usize,
    pub practice_targets: usize,
    pub melodic_targets: usize,
    pub percussion_selectors: usize,
    pub source_releases: usize,
    pub paired_releases: usize,
    pub unmatched_releases: usize,
    pub source_proved_ends: usize,
    pub source_end_cleanups: usize,
    pub synthetic_gates: usize,
    pub maximum_simultaneous_voices: usize,
    pub maximum_allocated_voices: usize,
    pub tempo_events: usize,
    pub zero_tempo_events: usize,
    pub routing_events: usize,
    pub metadata_events: usize,
    pub uninterpreted_controller_events: usize,
    pub interpreted_channel_stop_events: usize,
    pub control_ended_voices: usize,
    pub uninterpreted_program_events: usize,
    pub uninterpreted_pressure_events: usize,
    pub uninterpreted_pitch_bend_events: usize,
    pub uninterpreted_sysex_events: usize,
    pub source_silence_controller_events: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct RenditionPolicy {
    pub allocation_lookahead_ms: u16,
    pub voice_limit: usize,
    pub receiver_gate_tail_ms: u16,
    pub event_order: &'static str,
    pub routes: &'static str,
    pub tempo: &'static str,
    pub repeated_keys: &'static str,
    pub missing_release: &'static str,
    pub instantaneous: &'static str,
    pub melodic_sound: &'static str,
    pub percussion_sound: &'static str,
    pub controls: &'static str,
    pub mixing: &'static str,
    pub transport: &'static str,
    pub scoring: &'static str,
}
impl Default for RenditionPolicy {
    fn default() -> Self {
        Self {
            allocation_lookahead_ms: RENDITION_LOOKAHEAD_MS,
            voice_limit: RENDITION_VOICE_LIMIT,
            receiver_gate_tail_ms: 0,
            event_order: "tick_track_index_event_index",
            routes: "Each distinct Port/DeviceName declaration is a separate virtual bus; the fully unspecified declaration is one shared default bus. No physical-device alias is inferred. Channel state is shared across tracks on the same virtual bus.",
            tempo: "Start at 500000 microseconds per quarter; apply positive tempo changes in tick/track/event order. Last positive tempo at a tick wins. A zero tempo is retained and acknowledged but holds the previous positive tempo. This chosen clock is not a claim that conflicting source tempos have an exact original order.",
            repeated_keys: "Every positive NoteOn creates a voice. NoteOff and zero-velocity NoteOn release the oldest held voice on the same virtual bus/channel/key, including across tracks. Unmatched releases are acknowledged.",
            missing_release: "A held voice without a chosen release ends at the global source end; an individual track's EndOfTrack does not clear shared state. This is receiver cleanup, not an original duration.",
            instantaneous: "Only a zero-time receiver gate receives a 20ms audition/target gate. Source start/end and chosen release remain unchanged. Positive gates are never lengthened, quantized or clamped.",
            melodic_sound: "WMH basic sine v1: one neutral sine at the nominal MIDI key frequency for every key 0..127, using the positive source attack velocity. No original-instrument, acoustic-pitch or physical-keyboard provenance claim.",
            percussion_sound: "WMH basic percussion pulse v1: the same deterministic dry noise pulse at 1500Hz for every channel-10 key selector 0..127. Selectors remain distinct; no original kit or GM map is inferred.",
            controls: "CC120 AllSoundOff and CC123 AllNotesOff end all held voices on their virtual bus/channel immediately under this basic receiver policy, without sustain. Other controllers, program, bank, bend, pressure and SysEx remain counted source evidence but do not alter this rendition. Source mixer/silence controls are disclosed; all attacks audition by default.",
            mixing: "Mute/solo filters attack-owned voices after complete-source FIFO interpretation. Release events from muted tracks still determine gates. Practice part selection is separate from accompaniment audibility.",
            transport: "Stop/pause/seek must cancel all active and scheduled audio. Resume may restart remaining derived gates with a fresh basic envelope; preserve IDs and the common transport clock. Never feed synthesized accompaniment into user MIDI input.",
            scoring: "Use this same interpreted timeline for selected-part MIDI note-on targets. Score attack timing/key only, never inferred releases, hold duration, original timbre or kit identity. Prefer a melodic part; percussion selector practice must be explicitly selected. Device range is diagnosed without dropping, folding or clamping keys.",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct RenditionEvidence {
    pub policy_id: &'static str,
    pub source_sha256: String,
    pub source_clock_available: bool,
    pub source_duration_ms: f64,
    pub duration_ms: f64,
    pub policy: RenditionPolicy,
    pub coverage: RenditionCoverage,
    pub note_columns: [&'static str; 13],
    pub notes: Vec<RenditionNote>,
    pub unmatched_releases: Vec<Coordinate>,
}

#[derive(Clone, Debug)]
pub struct RenditionCompilation {
    pub timeline: Timeline,
    pub rendition: RenditionEvidence,
    pub diagnostics: Vec<Diagnostic>,
}

fn exact(numerator: u64, ppq: u16) -> ExactMicroseconds {
    let gcd = crate::gcd(numerator.into(), ppq.into()) as u64;
    ExactMicroseconds {
        numerator: (numerator / gcd).to_string(),
        denominator: (u64::from(ppq) / gcd) as u16,
    }
}
fn milliseconds(numerator: u64, ppq: u16) -> f64 {
    numerator as f64 / f64::from(ppq) / 1000.0
}
fn peak(mut edges: Vec<(u64, i32)>) -> usize {
    edges.sort_unstable(); // Ends precede allocations at the same exact time.
    let (mut active, mut maximum) = (0_i32, 0_usize);
    for (_, delta) in edges {
        active += delta;
        debug_assert!(active >= 0);
        maximum = maximum.max(active as usize);
    }
    maximum
}

/// Compile every source attack under the named explicit receiver policy. The
/// canonical envelope, notation and uncertainty evidence remain unchanged.
pub fn compile_rendition(score: &CompleteBasicKeys) -> Result<RenditionCompilation, String> {
    validate(score)?;
    compile_validated(score)
}

/// Only sibling core code holding an already validated immutable source may
/// bypass re-derivation. The public compiler continues to validate its input.
pub(super) fn compile_validated(score: &CompleteBasicKeys) -> Result<RenditionCompilation, String> {
    let raw = conversion::timeline_from_records(&score.performance)?;
    let ppq = raw.ppq();
    let routes: BTreeMap<_, _> = score
        .performance
        .routes
        .iter()
        .enumerate()
        .map(|(index, route)| (route.clone(), index))
        .collect();
    let parts: BTreeMap<_, _> = score
        .performance
        .parts
        .iter()
        .map(|part| (part.id.as_str(), part))
        .collect();
    let mut route_state = vec![
        Route {
            port: None,
            device_name_bytes: None
        };
        usize::from(raw.track_count())
    ];
    let mut held = BTreeMap::<(usize, u8, u8), VecDeque<usize>>::new();
    let mut notes = Vec::<TimedNote>::with_capacity(score.performance.notes.len());
    let mut evidence = Vec::<RenditionNote>::with_capacity(score.performance.notes.len());
    let mut starts = Vec::with_capacity(score.performance.notes.len());
    let mut ends = Vec::with_capacity(score.performance.notes.len());
    let mut unmatched_releases = vec![];
    let mut coverage = RenditionCoverage {
        source_events: raw.events().len(),
        ..Default::default()
    };
    let (mut tick, mut elapsed, mut tempo) = (0, 0_u64, 500_000_u32);
    for event in raw.events() {
        elapsed = elapsed
            .checked_add(
                (event.tick() - tick)
                    .checked_mul(u64::from(tempo))
                    .ok_or("Basic rendition clock overflow")?,
            )
            .ok_or("Basic rendition clock overflow")?;
        tick = event.tick();
        let origin = Coordinate {
            track: event.id().track_index(),
            event: event.id().event_index(),
        };
        let track = usize::from(origin.track);
        match event.kind() {
            EventKind::Tempo {
                microseconds_per_quarter,
            } => {
                coverage.tempo_events += 1;
                if *microseconds_per_quarter > 0 {
                    tempo = *microseconds_per_quarter;
                } else {
                    coverage.zero_tempo_events += 1;
                }
            }
            EventKind::Meta {
                meta_type: 0x21,
                data,
            } if data.len() == 1 => {
                coverage.routing_events += 1;
                route_state[track].port = Some(data[0]);
            }
            EventKind::Meta { meta_type: 9, data } => {
                coverage.routing_events += 1;
                route_state[track].device_name_bytes = Some(data.clone());
            }
            EventKind::Meta { .. } | EventKind::TimeSignature { .. } => {
                coverage.metadata_events += 1
            }
            EventKind::SysEx { .. } | EventKind::Escape { .. } => {
                coverage.uninterpreted_sysex_events += 1
            }
            EventKind::Channel { channel, message } => {
                let route = *routes
                    .get(&route_state[track])
                    .ok_or("Missing derived virtual route")?;
                match message {
                    ChannelMessage::NoteOn { key, velocity } if *velocity > 0 => {
                        let source = score
                            .performance
                            .notes
                            .get(notes.len())
                            .ok_or("Extra rendition attack")?;
                        let part = parts
                            .get(source.part_id.as_str())
                            .ok_or("Missing source attack part")?;
                        if source.attack != origin
                            || source.key != *key
                            || source.velocity != *velocity
                            || part.channel != *channel
                            || part.route != route
                        {
                            return Err("Rendition/source attack identity mismatch".into());
                        }
                        let role = if *channel == 9 {
                            coverage.percussion_selectors += 1;
                            RenditionRole::PercussionSelector
                        } else {
                            coverage.melodic_targets += 1;
                            RenditionRole::MelodicKey
                        };
                        held.entry((route, *channel, *key))
                            .or_default()
                            .push_back(notes.len());
                        coverage.source_proved_ends += usize::from(source.end.is_some());
                        starts.push(elapsed);
                        ends.push(None);
                        notes.push(TimedNote {
                            velocity: *velocity,
                            id: source.note_id.clone(),
                            source_note_id: source.note_id.clone(),
                            source_note_ids: vec![source.note_id.clone()],
                            part_id: source.part_id.clone(),
                            midi: *key,
                            start_ms: milliseconds(elapsed, ppq),
                            duration_ms: 0.0,
                            voice: "1".into(),
                            staff: 1,
                        });
                        evidence.push(RenditionNote {
                            note_id: source.note_id.clone(),
                            attack: origin,
                            release: None,
                            route,
                            channel: *channel,
                            role,
                            start: exact(elapsed, ppq),
                            end: exact(elapsed, ppq),
                            source_end_tick: source.end.as_ref().map(|end| end.tick),
                            receiver_end_tick: raw.end_tick(),
                            source_release_status: source.release.status.clone(),
                            end_reason: RenditionEndReason::SourceEndCleanup,
                            synthetic_gate: false,
                        });
                    }
                    ChannelMessage::NoteOn { key, .. } | ChannelMessage::NoteOff { key, .. } => {
                        coverage.source_releases += 1;
                        if let Some(index) = held
                            .get_mut(&(route, *channel, *key))
                            .and_then(VecDeque::pop_front)
                        {
                            ends[index] = Some(elapsed);
                            evidence[index].release = Some(origin);
                            evidence[index].receiver_end_tick = tick;
                            evidence[index].end_reason = RenditionEndReason::FifoRelease;
                            coverage.paired_releases += 1;
                        } else {
                            unmatched_releases.push(origin);
                        }
                    }
                    ChannelMessage::Controller { controller, value } => {
                        if [120, 123].contains(controller) {
                            coverage.interpreted_channel_stop_events += 1;
                            // At most 128 key queues, independent of other
                            // buses/channels and the number of prior routes.
                            for (_, queue) in
                                held.range_mut((route, *channel, 0)..=(route, *channel, 127))
                            {
                                for index in queue.drain(..) {
                                    ends[index] = Some(elapsed);
                                    evidence[index].release = Some(origin);
                                    evidence[index].receiver_end_tick = tick;
                                    evidence[index].end_reason = if *controller == 120 {
                                        RenditionEndReason::AllSoundOff
                                    } else {
                                        RenditionEndReason::AllNotesOff
                                    };
                                    coverage.control_ended_voices += 1;
                                }
                            }
                        } else {
                            coverage.uninterpreted_controller_events += 1;
                        }
                        if ([7, 11].contains(controller) && *value == 0)
                            || [120, 123].contains(controller)
                        {
                            coverage.source_silence_controller_events += 1;
                        }
                    }
                    ChannelMessage::ProgramChange { .. } => {
                        coverage.uninterpreted_program_events += 1
                    }
                    ChannelMessage::PitchBend { .. } => {
                        coverage.uninterpreted_pitch_bend_events += 1
                    }
                    ChannelMessage::KeyPressure { .. } | ChannelMessage::ChannelPressure { .. } => {
                        coverage.uninterpreted_pressure_events += 1
                    }
                }
            }
        }
    }
    coverage.source_attacks = score.coverage.key_attacks;
    coverage.derived_voices = evidence.len();
    coverage.practice_targets = notes.len();
    coverage.unmatched_releases = unmatched_releases.len();
    let mut duration = elapsed;
    let mut voice_edges = Vec::with_capacity(notes.len() * 2);
    let mut allocation_edges = Vec::with_capacity(notes.len() * 2);
    let lookahead = u64::from(RENDITION_LOOKAHEAD_MS) * 1000 * u64::from(ppq);
    for index in 0..notes.len() {
        let mut end = ends[index].unwrap_or_else(|| {
            coverage.source_end_cleanups += 1;
            elapsed
        });
        if end == starts[index] {
            end = end
                .checked_add(ZERO_GATE_US * u64::from(ppq))
                .ok_or("Basic rendition gate overflow")?;
            evidence[index].synthetic_gate = true;
            coverage.synthetic_gates += 1;
        }
        duration = duration.max(end);
        evidence[index].end = exact(end, ppq);
        notes[index].duration_ms = milliseconds(end - starts[index], ppq);
        voice_edges.push((starts[index], 1_i32));
        voice_edges.push((end, -1_i32));
        allocation_edges.push((starts[index].saturating_sub(lookahead), 1_i32));
        allocation_edges.push((end, -1_i32));
    }
    coverage.maximum_simultaneous_voices = peak(voice_edges);
    coverage.maximum_allocated_voices = peak(allocation_edges);
    let represented = coverage.source_attacks
        + coverage.source_releases
        + coverage.tempo_events
        + coverage.routing_events
        + coverage.metadata_events
        + coverage.uninterpreted_controller_events
        + coverage.uninterpreted_program_events
        + coverage.uninterpreted_pressure_events
        + coverage.uninterpreted_pitch_bend_events
        + coverage.uninterpreted_sysex_events
        + coverage.interpreted_channel_stop_events;
    if coverage.source_attacks != notes.len()
        || represented != coverage.source_events
        || coverage.source_releases != score.coverage.key_releases
        || coverage.source_releases != coverage.paired_releases + coverage.unmatched_releases
        || coverage.source_attacks
            != coverage.paired_releases
                + coverage.control_ended_voices
                + coverage.source_end_cleanups
    {
        return Err("Basic rendition event/voice/target coverage did not reconcile".into());
    }
    let duration_ms = milliseconds(duration, ppq);
    Ok(RenditionCompilation {
        timeline: Timeline { notes, duration_ms },
        rendition: RenditionEvidence { policy_id: RENDITION_POLICY, source_sha256: score.source.sha256.clone(),
            source_clock_available: raw.relative_clock_available(), source_duration_ms: milliseconds(elapsed, ppq), duration_ms,
            policy: RenditionPolicy::default(), coverage, note_columns: RENDITION_NOTE_COLUMNS, notes: evidence, unmatched_releases },
        diagnostics: vec![Diagnostic::warning("basic_key_rendition_interpretation",
            "Complete basic-key rendition uses the named FIFO virtual-route/tempo policy and the same all-attack practice timeline. Percussion is a named selector pulse; channel stops close gates and other effects remain uninterpreted. Inferred ends and 20ms zero gates are receiver choices, never original durations or hold-scoring targets.", None)],
    })
}

#[cfg(test)]
mod tests;
