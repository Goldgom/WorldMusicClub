//! Named VOCALOID2 engine commands. Reconstructed after workspace replacement;
//! no post-recovery compilation or private comparison has yet run.
mod normalize;
#[cfg(test)]
mod tests;
mod validate;
use crate::vsq::VsqProject;
pub use normalize::normalize_engine_dispatch;
use serde::{Deserialize, Serialize};
pub const ENGINE_PROFILE: &str = "wmh-vocaloid2-named-dispatch-v1";
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EngineDispatch {
    pub profile: String,
    pub source_sha256: String,
    pub source_controller_events: usize,
    pub tracks: Vec<EngineTrack>,
    pub interpretation_limits: Vec<EngineInterpretationLimit>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EngineTrack {
    pub source_track_index: u16,
    pub commands: Vec<EngineCommand>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EngineCommand {
    pub tick: u64,
    pub source_order_first: u32,
    pub source_order_last: u32,
    pub explicit_transport: Option<EngineTransport>,
    pub command: EngineCommandKind,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EngineTransport {
    pub identity: Option<EngineIdentity>,
    pub delay_ms: Option<u16>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EngineIdentity {
    pub version: u8,
    pub device: u8,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum EngineCommandKind {
    Note {
        note: EngineNote,
    },
    VoiceBank {
        bank: u8,
    },
    VoiceProgram {
        program: u8,
    },
    PitchBend {
        value: i16,
    },
    Dynamics {
        value: u8,
    },
    VibratoRate {
        value: u8,
    },
    VibratoDepth {
        value: u8,
    },
    VoiceParameter {
        parameter: EngineVoiceParameter,
        value: u8,
    },
    PitchBendSensitivity {
        semitones: u8,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EngineNote {
    pub authored_note_id: String,
    pub note_number: u8,
    pub velocity: u8,
    pub duration_ms: u16,
    pub location: EngineNoteLocation,
    pub vibrato: Option<EngineVibrato>,
    pub phonetic_symbols: Vec<EnginePhoneticSymbol>,
    pub intonation: EngineIntonation,
    pub portamento_flags: u8,
    pub decay: u8,
    pub accent: u8,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EngineNoteLocation {
    ConnectedBeforeAndAfter,
    ConnectedAfter,
    ConnectedBefore,
    Isolated,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EngineVibrato {
    pub database_index: u16,
    pub type_index: u8,
    pub duration_parameter: u8,
    pub delay_parameter: u8,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EnginePhoneticSymbol {
    pub symbol: String,
    pub consonant_adjustment: Option<u8>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EngineIntonation {
    pub v1_mean_parameter: u8,
    pub d1_mean_parameter: u8,
    pub d1_mean_first_note_parameter: u8,
    pub d2_mean_parameter: u8,
    pub d4_mean_parameter: u8,
    pub p_mean_onset_first_note_parameter: u8,
    pub v_mean_note_transition_parameter: u8,
    pub p_mean_ending_note_parameter: u8,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EngineVoiceParameter {
    Breathiness,
    Brightness,
    Clearness,
    PortamentoTiming,
    Opening,
    GenderFactor,
    Resonance1Frequency,
    Resonance2Frequency,
    Resonance3Frequency,
    Resonance4Frequency,
    Resonance1Bandwidth,
    Resonance2Bandwidth,
    Resonance3Bandwidth,
    Resonance4Bandwidth,
    Resonance1Amplitude,
    Resonance2Amplitude,
    Resonance3Amplitude,
    Resonance4Amplitude,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EngineInterpretationLimit {
    CrossGroupTransportInheritanceUnverified,
    EngineDurationRoundingNotReconstructed,
    VibratoParameterUnitsUnverified,
    D1MeanFirstNoteUnitUnverified,
    LegacyResonance255MeaningUnverified,
    VocalSynthesisNotImplemented,
}
pub const ENGINE_LIMITS: [EngineInterpretationLimit; 6] = [
    EngineInterpretationLimit::CrossGroupTransportInheritanceUnverified,
    EngineInterpretationLimit::EngineDurationRoundingNotReconstructed,
    EngineInterpretationLimit::VibratoParameterUnitsUnverified,
    EngineInterpretationLimit::D1MeanFirstNoteUnitUnverified,
    EngineInterpretationLimit::LegacyResonance255MeaningUnverified,
    EngineInterpretationLimit::VocalSynthesisNotImplemented,
];
impl EngineDispatch {
    pub fn validate(&self, authored: &VsqProject) -> Result<(), String> {
        validate::validate(self, authored)
    }
    pub fn command_count(&self) -> usize {
        self.tracks.iter().map(|t| t.commands.len()).sum()
    }
    pub fn parameter_field_count(&self) -> usize {
        self.tracks
            .iter()
            .flat_map(|t| &t.commands)
            .map(|c| {
                let header = c.explicit_transport.as_ref().map_or(0, |s| {
                    usize::from(s.identity.is_some()) + usize::from(s.delay_ms.is_some())
                });
                let body = match &c.command {
                    EngineCommandKind::Note { note } => {
                        18 + note.phonetic_symbols.len() + usize::from(note.vibrato.is_some()) * 3
                    }
                    EngineCommandKind::VoiceParameter { .. } => 2,
                    _ => 1,
                };
                header + body
            })
            .sum()
    }
}
