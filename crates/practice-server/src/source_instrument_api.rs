//! Optional, read-only source evidence. Neither renderer timbres nor Mod
//! projections can be used to fill missing instrument declarations.
use crate::song_api::{bounded_response, song_api_error, ApiResponse};
use score_core::{basic_keys, source_instrument};
use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Serialize)]
struct Response {
    /// Transport identity of the exact JSON request bytes, not a source receipt.
    request_sha256: String,
    details: source_instrument::SourceInstrumentDetails,
}

pub(crate) fn response(bytes: &[u8], basic: bool) -> ApiResponse {
    let result = if basic {
        match basic_keys::decode_json(bytes) {
            Ok(score) => source_instrument::describe_basic(&score),
            Err(message) => {
                return song_api_error(400, "source_instrument_invalid_request", &message)
            }
        }
    } else {
        match serde_json::from_slice::<score_core::Score>(bytes) {
            Ok(score) => source_instrument::describe_canonical_midi(&score),
            Err(error) => {
                return song_api_error(
                    400,
                    "source_instrument_invalid_request",
                    &crate::json_input_error("source instrument score", error),
                )
            }
        }
    };
    match result {
        Ok(details) => bounded_response(
            200,
            &Response {
                request_sha256: format!("{:x}", Sha256::digest(bytes)),
                details,
            },
        ),
        Err(error) => song_api_error(
            if error.code == "source_disclosure_limit" {
                413
            } else {
                422
            },
            error.code,
            &error.message,
        ),
    }
}
