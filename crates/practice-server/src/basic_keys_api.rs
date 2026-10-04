//! Basic-key inspection and targets are independent of source/reference audio.
use score_core::{basic_keys, Diagnostic, Timeline};
use serde::Serialize;

pub const RUNTIME_PROFILE: &str = "wmh-basic-key-practice-v1";
#[derive(Serialize)]
pub struct Runtime {
    pub profile: &'static str,
    pub source_sha256: String,
    pub compilation: Option<PracticeCompilation>,
    pub parts: Vec<basic_keys::PartInventory>,
    pub reference_audio: &'static str,
    pub source_rendition: &'static str,
}
/// The canonical score is already included in the native load response. Keep
/// one exact projection instead of duplicating it in a large runtime response.
#[derive(Serialize)]
pub struct PracticeCompilation {
    pub timeline: Timeline,
    pub diagnostics: Vec<Diagnostic>,
}
pub fn compile(score: &basic_keys::CompleteBasicKeys) -> Result<Runtime, String> {
    let compilation = basic_keys::compile_practice(score)?.map(|compiled| PracticeCompilation {
        timeline: compiled.timeline,
        diagnostics: compiled.diagnostics,
    });
    Ok(Runtime {
        profile: RUNTIME_PROFILE,
        source_sha256: score.source.sha256.clone(),
        compilation,
        parts: basic_keys::part_inventory(score),
        reference_audio: "unavailable",
        source_rendition: "unresolved",
    })
}
pub(super) fn response(bytes: &[u8]) -> super::ApiResponse {
    match basic_keys::decode_json(bytes).and_then(|score| compile(&score)) {
        Ok(runtime) => super::song_api::bounded_response(200, &runtime),
        Err(message) => super::song_api::song_api_error(422, "basic_keys_invalid", &message),
    }
}
