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
    })
}
pub(super) fn response(bytes: &[u8]) -> super::ApiResponse {
    match basic_keys::decode_json(bytes).and_then(|score| compile(&score)) {
        Ok(runtime) => super::song_api::bounded_response(200, &runtime),
        Err(message) => super::song_api::song_api_error(422, "basic_keys_invalid", &message),
    }
}
