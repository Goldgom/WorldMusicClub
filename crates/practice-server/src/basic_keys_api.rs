//! One explicit basic rendition supplies both playback and note-on targets.
use score_core::{basic_keys, Diagnostic, Timeline};
use serde::{ser::SerializeSeq, Serialize, Serializer};

pub const RUNTIME_PROFILE: &str = "wmh-basic-key-practice-v2";
pub const TARGET_NOTE_COLUMNS: [&str; 6] = [
    "id",
    "part_id",
    "midi",
    "velocity",
    "start_ms",
    "duration_ms",
];
#[derive(Serialize)]
pub struct Runtime {
    pub profile: &'static str,
    pub source_sha256: String,
    pub compilation: Option<PracticeCompilation>,
    pub rendition: Option<basic_keys::RenditionEvidence>,
    pub parts: Vec<basic_keys::PartInventory>,
    pub reference_audio: &'static str,
    pub source_rendition: &'static str,
    /// May be absent only to preserve an already-valid complete response at
    /// its byte cap. Missing evidence never grants Human admission.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_eligibility: Option<SourceEligibilitySummary>,
}
/// Informational counts only. Human admission independently reloads the saved
/// source and checks the complete native attack inventory.
#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SourceEligibilitySummary {
    Available {
        receipt: Box<score_core::practice_source::SourceEligibilityReceipt>,
        complete_attack_count: usize,
        known_unsupported_count: usize,
        unresolved_count: usize,
        parts: Vec<PartEligibilitySummary>,
    },
    Unavailable {
        code: &'static str,
        message: &'static str,
    },
}
impl SourceEligibilitySummary {
    pub fn unavailable() -> Self {
        Self::Unavailable {
            code: "practice_source_eligibility_unavailable",
            message: "Original instrument eligibility could not be checked. Human practice is unavailable; complete source and reference playback are retained.",
        }
    }
}
#[derive(Serialize)]
pub struct PartEligibilitySummary {
    part_id: String,
    attack_count: usize,
    supported_count: usize,
    known_unsupported_count: usize,
    unresolved_count: usize,
}
fn source_eligibility_summary(score: &basic_keys::CompleteBasicKeys) -> SourceEligibilitySummary {
    let Ok(analysis) = score_core::source_identity::analyze_basic_practice(score) else {
        return SourceEligibilitySummary::unavailable();
    };
    let Ok(receipt) = score_core::practice_source::SourceEligibilityReceipt::from_analysis(&analysis)
    else {
        return SourceEligibilitySummary::unavailable();
    };
    SourceEligibilitySummary::Available {
        receipt: Box::new(receipt),
        complete_attack_count: analysis.complete_attack_count(),
        known_unsupported_count: analysis.known_unsupported_source_attack_ids().len(),
        unresolved_count: analysis
            .parts()
            .iter()
            .map(|part| part.unresolved_count())
            .sum(),
        parts: analysis
            .parts()
            .iter()
            .map(|part| PartEligibilitySummary {
                part_id: part.part_id().into(),
                attack_count: part.attack_count(),
                supported_count: part.supported_count(),
                known_unsupported_count: part.known_unsupported_count(),
                unresolved_count: part.unresolved_count(),
            })
            .collect(),
    }
}
/// The canonical score is already included in the native load response. Keep
/// one exact projection instead of duplicating it in a large runtime response.
#[derive(Serialize)]
pub struct PracticeCompilation {
    #[serde(serialize_with = "serialize_timeline")]
    pub timeline: Timeline,
    pub diagnostics: Vec<Diagnostic>,
}
fn serialize_timeline<S: Serializer>(
    timeline: &Timeline,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    struct Rows<'a>(&'a [score_core::TimedNote]);
    impl Serialize for Rows<'_> {
        fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            let mut rows = serializer.serialize_seq(Some(self.0.len()))?;
            for note in self.0 {
                rows.serialize_element(&(
                    &note.id,
                    &note.part_id,
                    note.midi,
                    note.velocity,
                    note.start_ms,
                    note.duration_ms,
                ))?;
            }
            rows.end()
        }
    }
    #[derive(Serialize)]
    struct Wire<'a> {
        note_columns: [&'static str; 6],
        notes: Rows<'a>,
        duration_ms: f64,
    }
    // Every basic-key target is one source attack. The trusted v2 adapter
    // restores source_note_id=id, source_note_ids=[id], voice="1", staff=1
    // before all ordinary playback/scoring consumers see this timeline.
    Wire {
        note_columns: TARGET_NOTE_COLUMNS,
        notes: Rows(&timeline.notes),
        duration_ms: timeline.duration_ms,
    }
    .serialize(serializer)
}
pub fn compile(score: &basic_keys::CompleteBasicKeys) -> Result<Runtime, String> {
    let compiled = basic_keys::compile_rendition(score)?;
    let compilation = Some(PracticeCompilation {
        timeline: compiled.timeline,
        diagnostics: compiled.diagnostics,
    });
    Ok(Runtime {
        profile: RUNTIME_PROFILE,
        source_sha256: score.source.sha256.clone(),
        compilation,
        rendition: Some(compiled.rendition),
        parts: basic_keys::part_inventory(score),
        reference_audio: "basic_synthesized",
        source_rendition: "unresolved",
        source_eligibility: Some(source_eligibility_summary(score)),
    })
}
fn bounded_runtime(mut runtime: Runtime, limit: usize) -> super::ApiResponse {
    let response = super::song_api::bounded_response_with_limit(200, &runtime, limit);
    if response.status == 413 {
        // Optional disclosure must never remove a formerly available
        // complete reference runtime just by consuming its last bytes.
        runtime.source_eligibility = None;
        super::song_api::bounded_response_with_limit(200, &runtime, limit)
    } else {
        response
    }
}
pub(super) fn response(bytes: &[u8]) -> super::ApiResponse {
    match basic_keys::decode_json(bytes).and_then(|score| compile(&score)) {
        Ok(runtime) => bounded_runtime(runtime, super::MAX_SONG_RESPONSE_BYTES),
        Err(message) => super::song_api::song_api_error(422, "basic_keys_invalid", &message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source() -> basic_keys::CompleteBasicKeys {
        // Original CC0-1.0 unknown-identity mechanical note.
        let track = [0, 144, 60, 80, 96, 128, 60, 0, 0, 255, 47, 0];
        let mut midi = b"MThd\0\0\0\x06\0\0\0\x01\0\x60MTrk".to_vec();
        midi.extend((track.len() as u32).to_be_bytes());
        midi.extend(track);
        basic_keys::convert_midi(&midi, "Original summary-bound exercise").unwrap()
    }

    #[test]
    fn optional_summary_never_displaces_a_previously_fitting_complete_runtime() {
        let source = source();
        let mut original = compile(&source).unwrap();
        original.source_eligibility = None;
        let exact_original = serde_json::to_vec(&original).unwrap();
        let response = bounded_runtime(compile(&source).unwrap(), exact_original.len());
        assert_eq!(response.status, 200);
        assert_eq!(response.body, exact_original);
        assert_eq!(
            bounded_runtime(compile(&source).unwrap(), exact_original.len() - 1).status,
            413
        );
    }

    #[test]
    fn unavailable_summary_retains_full_reference_fields() {
        let source = source();
        let mut runtime = compile(&source).unwrap();
        let before = serde_json::to_value(&runtime).unwrap();
        runtime.source_eligibility = Some(SourceEligibilitySummary::unavailable());
        let response = bounded_runtime(runtime, super::super::MAX_SONG_RESPONSE_BYTES);
        assert_eq!(response.status, 200);
        let unavailable: serde_json::Value = serde_json::from_slice(&response.body).unwrap();
        assert_eq!(unavailable["source_eligibility"]["status"], "unavailable");
        for field in ["compilation", "rendition", "parts", "reference_audio", "source_sha256"] {
            assert_eq!(unavailable[field], before[field]);
        }
    }
}
