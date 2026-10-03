use crate::vsq::*;
use crate::vsq_engine::EngineDispatch;
use crate::Score;
use serde::{Deserialize, Serialize};
macro_rules! record {
    ($name:ident { $($field:ident : $ty:ty),* $(,)? }) => {
        #[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
        #[serde(deny_unknown_fields)]
        pub struct $name { $(pub $field: $ty),* }
    };
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VsqCompleteScore {
    pub format: String,
    pub version: u32,
    pub profile: String,
    pub source: SourceEvidence,
    pub notation: Score,
    pub authoring: AuthoringProject,
    pub engine_dispatch: EngineDispatch,
    pub coverage: Coverage,
    pub capabilities: Capabilities,
    pub interpretation_limits: Vec<CleanInterpretationLimit>,
}
record!(SourceEvidence {
    format: String,
    bytes: usize,
    sha256: String
});
// Authored fields only; frozen nested DTOs are closed authoring structures.
record!(AuthoringProject {
    profile: String, source_sha256: String, ppq: u16, master_track_name: String,
    master_end_tick: u64, tempo: Vec<VsqTempo>, meters: Vec<VsqMeter>,
    premeasure_bars: u32, premeasure_ticks: u64, mixer: VsqMixer,
    tracks: Vec<AuthoringTrack>, interpretation_limits: Vec<VsqInterpretationLimit>,
});
record!(AuthoringTrack {
    source_track_index: u16, smf_track_name: String, project_text_sha256: String,
    common: VsqCommon, end_tick: u64, eos_tick: u64, singers: Vec<VsqSinger>,
    notes: Vec<VsqNote>, curves: Vec<VsqCurve>,
});
impl From<&VsqProject> for AuthoringProject {
    fn from(p: &VsqProject) -> Self {
        Self {
            profile: p.profile.clone(),
            source_sha256: p.source_sha256.clone(),
            ppq: p.ppq,
            master_track_name: p.master_track_name.clone(),
            master_end_tick: p.master_end_tick,
            tempo: p.tempo.clone(),
            meters: p.meters.clone(),
            premeasure_bars: p.premeasure_bars,
            premeasure_ticks: p.premeasure_ticks,
            mixer: p.mixer.clone(),
            interpretation_limits: p.interpretation_limits.clone(),
            tracks: p
                .tracks
                .iter()
                .map(|t| AuthoringTrack {
                    source_track_index: t.source_track_index,
                    smf_track_name: t.smf_track_name.clone(),
                    project_text_sha256: t.project_text_sha256.clone(),
                    common: t.common.clone(),
                    end_tick: t.end_tick,
                    eos_tick: t.eos_tick,
                    singers: t.singers.clone(),
                    notes: t.notes.clone(),
                    curves: t.curves.clone(),
                })
                .collect(),
        }
    }
}
impl AuthoringProject {
    // In-memory reuse of the reviewed authored-field validator, without
    // permitting the omitted controller sequence in clean serialization.
    pub(crate) fn as_project(&self) -> VsqProject {
        VsqProject {
            profile: self.profile.clone(),
            source_sha256: self.source_sha256.clone(),
            ppq: self.ppq,
            master_track_name: self.master_track_name.clone(),
            master_end_tick: self.master_end_tick,
            tempo: self.tempo.clone(),
            meters: self.meters.clone(),
            premeasure_bars: self.premeasure_bars,
            premeasure_ticks: self.premeasure_ticks,
            mixer: self.mixer.clone(),
            interpretation_limits: self.interpretation_limits.clone(),
            tracks: self
                .tracks
                .iter()
                .map(|t| VsqTrack {
                    source_track_index: t.source_track_index,
                    smf_track_name: t.smf_track_name.clone(),
                    project_text_sha256: t.project_text_sha256.clone(),
                    common: t.common.clone(),
                    end_tick: t.end_tick,
                    eos_tick: t.eos_tick,
                    singers: t.singers.clone(),
                    notes: t.notes.clone(),
                    curves: t.curves.clone(),
                    controller_events: vec![],
                })
                .collect(),
        }
    }
}
record!(Coverage {
    status: CoverageStatus,
    notation: NotationCoverage,
    project: ProjectCoverage,
    named_dispatch: DispatchCoverage,
});
record!(ProjectCoverage {
    tracks: usize,
    notes: usize,
    singers: usize,
    lyrics: usize,
    vibratos: usize,
    envelope_points: usize,
    curves: usize,
    curve_points: usize,
    tempo_changes: usize,
    meter_changes: usize,
});
record!(DispatchCoverage {
    tracks: usize,
    commands: usize,
    parameter_fields: usize,
    source_controller_records_accounted: usize,
});
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CoverageStatus {
    StructurallyCompleteAuthoringAndNamedDispatch,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NotationCoverage {
    AllAuthoredBaseNotes,
}
impl Coverage {
    pub(crate) fn calculate(p: &AuthoringProject, e: &EngineDispatch) -> Self {
        let notes: Vec<_> = p.tracks.iter().flat_map(|t| &t.notes).collect();
        Self {
            status: CoverageStatus::StructurallyCompleteAuthoringAndNamedDispatch,
            notation: NotationCoverage::AllAuthoredBaseNotes,
            project: ProjectCoverage {
                tracks: p.tracks.len(),
                notes: notes.len(),
                singers: p.tracks.iter().map(|t| t.singers.len()).sum(),
                lyrics: notes.iter().map(|n| n.lyrics.len()).sum(),
                vibratos: notes.iter().filter(|n| n.vibrato.is_some()).count(),
                envelope_points: notes
                    .iter()
                    .filter_map(|n| n.vibrato.as_ref())
                    .map(|v| v.depth.points.len() + v.rate.points.len())
                    .sum(),
                curves: p.tracks.iter().map(|t| t.curves.len()).sum(),
                curve_points: p
                    .tracks
                    .iter()
                    .flat_map(|t| &t.curves)
                    .map(|c| c.points.len())
                    .sum(),
                tempo_changes: p.tempo.len(),
                meter_changes: p.meters.len(),
            },
            named_dispatch: DispatchCoverage {
                tracks: e.tracks.len(),
                commands: e.command_count(),
                parameter_fields: e.parameter_field_count(),
                source_controller_records_accounted: e.source_controller_events,
            },
        }
    }
}
record!(Capabilities {
    whole_vocal_rendering: VocalRendering,
    instrumental_practice: InstrumentalPractice,
});
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VocalRendering {
    Blocked,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InstrumentalPractice {
    RequiresExplicitBaseNoteChoice,
}
impl Capabilities {
    pub(crate) fn required() -> Self {
        Self {
            whole_vocal_rendering: VocalRendering::Blocked,
            instrumental_practice: InstrumentalPractice::RequiresExplicitBaseNoteChoice,
        }
    }
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CleanInterpretationLimit {
    WholeVocalRenderingUnavailable,
    PracticeUsesAuthoredBaseNotesOnly,
    PitchBendAndSensitivityNotRendered,
    VibratoAndExpressionNotRendered,
    LyricsAndPhoneticsNotSynthesized,
    SourceVoiceProgramIsDescriptorNotGeneralMidi,
    MixerGainPanAndOutputModeNotInterpreted,
    EngineDispatchTimingAndAcousticTailsNotRendered,
}
pub const CLEAN_LIMITS: [CleanInterpretationLimit; 8] = [
    CleanInterpretationLimit::WholeVocalRenderingUnavailable,
    CleanInterpretationLimit::PracticeUsesAuthoredBaseNotesOnly,
    CleanInterpretationLimit::PitchBendAndSensitivityNotRendered,
    CleanInterpretationLimit::VibratoAndExpressionNotRendered,
    CleanInterpretationLimit::LyricsAndPhoneticsNotSynthesized,
    CleanInterpretationLimit::SourceVoiceProgramIsDescriptorNotGeneralMidi,
    CleanInterpretationLimit::MixerGainPanAndOutputModeNotInterpreted,
    CleanInterpretationLimit::EngineDispatchTimingAndAcousticTailsNotRendered,
];
record!(PackageMetadata {
    format: String, version: u32, id: String, title: String,
    score: PackageScore, sources: Vec<SourceEvidence>, rights: PackageRights,
    media: [(); 0],
});
record!(PackageScore {
    path: String,
    bytes: usize,
    sha256: String
});
record!(PackageRights { status: String, attribution: String, license: Option<String> });
