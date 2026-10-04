//! Read-only preparation and fingerprint-bound ZIP transport. Persistence stays
//! behind the existing native import preview/commit workflow.
use crate::song_api::{bounded_response, song_api_error, ApiResponse};
use score_core::clean_conversion::{self, Request, State};
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PackRequest {
    source_base64: String,
    source_name: String,
    title: String,
    expected_draft_sha256: String,
}
pub(super) fn response(bytes: &[u8], pack: bool) -> ApiResponse {
    let decoded = if pack {
        serde_json::from_slice::<PackRequest>(bytes).map(|request| {
            (
                Request {
                    source_base64: request.source_base64,
                    source_name: request.source_name,
                    title: request.title,
                },
                Some(request.expected_draft_sha256),
            )
        })
    } else {
        serde_json::from_slice::<Request>(bytes).map(|request| (request, None))
    };
    let (request, expected) = match decoded {
        Ok(request) => request,
        Err(error) => {
            return song_api_error(
                400,
                "clean_draft_invalid_request",
                &crate::json_input_error("clean conversion request", error),
            )
        }
    };
    if request.source_base64.len() > score_core::midi_events::MAX_SOURCE_BYTES.div_ceil(3) * 4 {
        return song_api_error(
            413,
            "clean_draft_source_limit",
            "Original MIDI/VSQ exceeds the 5 MiB source limit; no source was truncated",
        );
    }
    let draft = match clean_conversion::prepare_request(request) {
        Ok(draft) => draft,
        Err(error) => {
            return song_api_error(
                if error.source_limit { 413 } else { 400 },
                if error.source_limit {
                    "clean_draft_source_limit"
                } else {
                    "clean_draft_invalid_request"
                },
                &error.message,
            )
        }
    };
    if draft.state == State::Rejected {
        return bounded_response(422, &draft);
    }
    // A compressed ZIP must not bypass the complete review response limit.
    let prepared = bounded_response(200, &draft);
    if !pack || prepared.status != 200 {
        return prepared;
    }
    if expected.as_ref() != draft.draft_sha256.as_ref() {
        return song_api_error(409, "clean_draft_changed", "The source or title differs from the reviewed complete draft; prepare and review it again before saving");
    }
    match draft.pack() {
        Ok(bytes) => {
            use base64::Engine;
            bounded_response(
                200,
                &json!({
                    "draft_sha256":draft.draft_sha256,
                    "filename":format!("worldmusichub-{}.zip", &draft.source.sha256[..16]),
                    "zip_base64":base64::engine::general_purpose::STANDARD.encode(bytes)
                }),
            )
        }
        Err(error) => song_api_error(422, "clean_draft_pack_rejected", &error),
    }
}
