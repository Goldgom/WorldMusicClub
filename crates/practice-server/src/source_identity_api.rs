//! Optional identity facts for complete Basic sources. Numeric disclosure and
//! every practice/runtime consumer remain independent of this route.
use crate::song_api::{bounded_response, song_api_error, ApiResponse};
use score_core::{basic_keys, source_identity};
use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Serialize)]
struct Response {
    /// SHA-256 of exact incoming bytes, separate from the core source binding.
    request_sha256: String,
    details: source_identity::SourceIdentityDisclosure,
}

fn bounded_identity_response<T: Serialize>(value: &T) -> ApiResponse {
    let response = bounded_response(200, value);
    if response.status == 413 {
        song_api_error(
            413,
            "source_identity_response_limit",
            "Complete informational identity response exceeds 16 MiB; numeric details and practice remain available, and no partial identity is returned",
        )
    } else {
        response
    }
}

pub(crate) fn response(bytes: &[u8]) -> ApiResponse {
    // Only the complete Basic decoder admits input. Canonical scores, cached
    // disclosures, and projections never acquire Basic source authority.
    let score = match basic_keys::decode_json(bytes) {
        Ok(score) => score,
        Err(message) => return song_api_error(400, "source_identity_invalid_request", &message),
    };
    match source_identity::describe_basic(&score) {
        Ok(details) => bounded_identity_response(&Response {
            request_sha256: format!("{:x}", Sha256::digest(bytes)),
            details,
        }),
        Err(error) => song_api_error(
            if error.code() == "analysis_limit" {
                413
            } else {
                422
            },
            error.code(),
            error.message(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn identity_transport_bound_includes_envelope_and_never_returns_partial_details() {
        let overhead = serde_json::to_vec(&json!({"request_sha256":"0".repeat(64),"details":""}))
            .unwrap()
            .len();
        let mut text = "x".repeat(crate::MAX_SONG_RESPONSE_BYTES - overhead);
        let exact = json!({"request_sha256":"0".repeat(64),"details":text});
        let response = bounded_identity_response(&exact);
        assert_eq!(response.status, 200);
        assert_eq!(response.body.len(), crate::MAX_SONG_RESPONSE_BYTES);
        text.push('x');
        let over = json!({"request_sha256":"0".repeat(64),"details":text});
        let response = bounded_identity_response(&over);
        assert_eq!(response.status, 413);
        let error: Value = serde_json::from_slice(&response.body).unwrap();
        assert_eq!(error["code"], "source_identity_response_limit");
        assert!(error.get("details").is_none());
        assert!(error.get("request_sha256").is_none());
        // The existing numeric route retains its own original budget error.
        let numeric = bounded_response(200, &over);
        assert_eq!(numeric.status, 413);
        assert_eq!(
            serde_json::from_slice::<Value>(&numeric.body).unwrap()["code"],
            "response_body_limit"
        );
    }
}
