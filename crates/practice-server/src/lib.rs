//! Shared, bounded-operation engine entry points for HTTP and desktop adapters.
use serde::Deserialize;
mod song_api;
pub use song_api::{
    api_response, is_song_api_route, request_limit_response, song_api_error, ApiResponse,
    MAX_REQUEST_BYTES, MAX_SONG_RESPONSE_BYTES,
};
include!(concat!(env!("OUT_DIR"), "/web_assets.rs"));

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AdaptationRequest {
    score: score_core::Score,
    operation: score_core::adaptation::OctaveOperation,
    profile: score_core::instruments::InstrumentProfile,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TranspositionRequest {
    score: score_core::Score,
    operation: score_core::transposition::TranspositionOperation,
    profile: score_core::instruments::InstrumentProfile,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OmrConfirmationRequest {
    score: score_core::Score,
    confirmation: score_core::external_omr::ReviewConfirmation,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MetronomeRequest {
    score: score_core::Score,
    #[serde(default)]
    pulse: score_core::metronome::PulseMode,
}
#[derive(Deserialize)]
struct WindowRequest {
    score: score_core::Score,
    from: score_core::Beat,
    to: score_core::Beat,
}
#[derive(Deserialize)]
struct InstrumentRequest {
    timeline: score_core::Timeline,
    profile: score_core::instruments::InstrumentProfile,
}
#[derive(Deserialize)]
struct AssessRequest {
    timeline: score_core::Timeline,
    inputs: Vec<score_core::InputEvent>,
    tolerance_ms: f64,
}

fn json_input_error(context: &str, error: serde_json::Error) -> String {
    let detail = error.to_string();
    if error.is_data() && detail.contains("unknown field") {
        format!("Unsupported field or metadata in {context}. This file may require a newer WorldMusicHub app; it was not changed or stripped. Keep the original. Details: {detail}")
    } else {
        format!("Invalid {context}: {detail}")
    }
}

pub fn content_type_allowed(path: &str, content_type: &str) -> bool {
    if path == "/api/midi/events" {
        return matches!(
            content_type,
            "audio/midi" | "audio/x-midi" | "application/octet-stream"
        );
    }
    content_type.starts_with("application/json")
        || (path == "/api/import/jianpu" && content_type.starts_with("text/plain"))
        || (path == "/api/import/midi"
            && matches!(
                content_type,
                "audio/midi" | "audio/x-midi" | "application/octet-stream"
            ))
        || (path == "/api/import/mxl"
            && matches!(
                content_type,
                "application/vnd.recordare.musicxml"
                    | "application/zip"
                    | "application/octet-stream"
            ))
        || (path == "/api/import/image"
            && matches!(
                content_type,
                "image/png" | "image/jpeg" | "application/octet-stream"
            ))
        || (path == "/api/import/musicxml"
            && (content_type.starts_with("application/xml")
                || content_type.starts_with("text/xml")))
}
pub fn api(path: &str, bytes: Vec<u8>) -> Result<serde_json::Value, String> {
    match path {
        "/api/omr/audiveris-draft" => {
            serde_json::from_slice::<score_core::external_omr::AudiverisInput>(&bytes)
                .map_err(|e| json_input_error("external OMR input", e))
                .and_then(score_core::external_omr::prepare_audiveris)
                .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string()))
        }
        "/api/omr/confirm" => serde_json::from_slice::<OmrConfirmationRequest>(&bytes)
            .map_err(|e| json_input_error("OMR review confirmation", e))
            .and_then(|r| score_core::external_omr::confirm_review(r.score, r.confirmation))
            .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        "/api/adaptation/preview" => serde_json::from_slice::<AdaptationRequest>(&bytes)
            .map_err(|e| json_input_error("adaptation request", e))
            .and_then(|r| {
                score_core::adaptation::preview_octaves(&r.score, r.operation, &r.profile)
            })
            .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        "/api/adaptation/restore" => serde_json::from_slice::<score_core::Score>(&bytes)
            .map_err(|e| json_input_error("adapted score", e))
            .and_then(|score| score_core::adaptation::restore_original(&score))
            .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        "/api/transposition/preview" => serde_json::from_slice::<TranspositionRequest>(&bytes)
            .map_err(|e| json_input_error("transposition request", e))
            .and_then(|r| {
                score_core::transposition::preview_transposition(&r.score, r.operation, &r.profile)
            })
            .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        "/api/transposition/restore" => serde_json::from_slice::<score_core::Score>(&bytes)
            .map_err(|e| json_input_error("transposed score", e))
            .and_then(|score| score_core::transposition::restore_original(&score))
            .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        "/api/compile" => serde_json::from_slice(&bytes)
            .map_err(|e| json_input_error("score JSON", e))
            .and_then(score_core::compile)
            .and_then(|c| serde_json::to_value(c).map_err(|e| e.to_string())),
        "/api/notation-navigation" => serde_json::from_slice::<score_core::Score>(&bytes)
            .map_err(|e| json_input_error("notation navigation score", e))
            .and_then(score_core::navigation::notation_navigation)
            .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        "/api/metronome" => serde_json::from_slice::<MetronomeRequest>(&bytes)
            .map_err(|e| json_input_error("metronome request", e))
            .and_then(|r| score_core::metronome::metronome_grid(r.score, r.pulse))
            .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        "/api/practice-window" => serde_json::from_slice::<WindowRequest>(&bytes)
            .map_err(|e| json_input_error("loop request", e))
            .and_then(|r| score_core::practice::practice_window(&r.score, r.from, r.to))
            .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        "/api/practice-targets" => serde_json::from_slice::<InstrumentRequest>(&bytes)
            .map_err(|e| json_input_error("target request", e))
            .and_then(|r| score_core::targets::plan_targets(&r.timeline, &r.profile))
            .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        "/api/instrument-check" => serde_json::from_slice::<InstrumentRequest>(&bytes)
            .map_err(|e| json_input_error("instrument request", e))
            .and_then(|r| score_core::instruments::analyze_instrument(&r.timeline, &r.profile))
            .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        "/api/fingering/piano" => {
            serde_json::from_slice::<score_core::piano_fingering::PianoFingeringRequest>(&bytes)
                .map_err(|e| json_input_error("piano fingering request", e))
                .and_then(score_core::piano_fingering::plan_piano_fingering)
                .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string()))
        }
        "/api/fingering/guitar" => {
            serde_json::from_slice::<score_core::guitar_fingering::GuitarFingeringRequest>(&bytes)
                .map_err(|e| json_input_error("guitar fingering request", e))
                .and_then(score_core::guitar_fingering::plan_guitar_fingering)
                .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string()))
        }
        "/api/export/jianpu" => serde_json::from_slice::<score_core::Score>(&bytes)
            .map_err(|e| json_input_error("score JSON", e))
            .and_then(|score| score_core::export_jianpu(&score))
            .and_then(|result| serde_json::to_value(result).map_err(|e| e.to_string())),
        "/api/export/musicxml" => serde_json::from_slice::<score_core::Score>(&bytes)
            .map_err(|e| json_input_error("score JSON", e))
            .and_then(|score| score_core::export_musicxml(&score))
            .and_then(|result| serde_json::to_value(result).map_err(|e| e.to_string())),
        "/api/import/jianpu" => String::from_utf8(bytes)
            .map_err(|_| "Jianpu text must be UTF-8".to_string())
            .and_then(|text| score_core::import_jianpu(&text))
            .and_then(|(score, _warnings)| score_core::compile(score))
            .and_then(|c| serde_json::to_value(c).map_err(|e| e.to_string())),
        "/api/import/midi" => score_core::import_midi(&bytes)
            .and_then(|(score, _warnings)| score_core::compile(score))
            .and_then(|c| serde_json::to_value(c).map_err(|e| e.to_string())),
        "/api/import/mxl" => score_core::import_mxl(&bytes)
            .and_then(|(score, _warnings)| score_core::compile(score))
            .and_then(|c| serde_json::to_value(c).map_err(|e| e.to_string())),
        "/api/import/image" => score_core::omr::analyze_image(&bytes)
            .and_then(|review| serde_json::to_value(review).map_err(|e| e.to_string())),
        "/api/import/musicxml" => String::from_utf8(bytes)
            .map_err(|_| "MusicXML must be UTF-8; convert the source encoding first".to_string())
            .and_then(|xml| score_core::import_musicxml(&xml))
            .and_then(|(score, _warnings)| score_core::compile(score))
            .and_then(|c| serde_json::to_value(c).map_err(|e| e.to_string())),
        "/api/assess" => serde_json::from_slice::<AssessRequest>(&bytes)
            .map_err(|e| json_input_error("performance JSON", e))
            .and_then(|r| score_core::assess(&r.timeline, &r.inputs, r.tolerance_ms))
            .and_then(|a| serde_json::to_value(a).map_err(|e| e.to_string())),
        _ => Err("Unknown API route".into()),
    }
}

/// Retrieve an exact embedded asset; never reads a runtime path.
pub fn asset(path: &str) -> Option<&'static [u8]> {
    web_asset(path)
}
