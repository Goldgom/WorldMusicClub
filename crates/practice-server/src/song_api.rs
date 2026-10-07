//! Stateless assistance and raw-source inspection contracts shared by adapters.
use score_core::{assistance, instruments::InstrumentProfile, midi_events, Score};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::io::{self, Write};
#[path = "practice_assistance_api.rs"]
mod practice_assistance_api;
#[path = "practice_progression_api.rs"]
mod practice_progression_api;

pub const MAX_REQUEST_BYTES: usize = 8 * 1024 * 1024;
/// Complete encoded new-route responses, including metadata. Never truncate.
pub const MAX_SONG_RESPONSE_BYTES: usize = 16 * 1024 * 1024;

/// Already-serialized bytes give HTTP and native adapters the identical body.
#[derive(Debug, PartialEq, Eq)]
pub struct ApiResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

pub fn is_song_api_route(path: &str) -> bool {
    matches!(
        path,
        "/api/assistance/create"
            | "/api/assistance/validate"
            | "/api/practice-assistance/original"
            | "/api/practice-assistance/generate"
            | "/api/practice-assistance/create"
            | "/api/practice-assistance/validate"
            | "/api/practice-progression/generate"
            | "/api/practice-progression/validate"
            | "/api/midi/events"
            | "/api/clean-song/basic-keys"
            | "/api/clean-song/draft"
            | "/api/clean-song/draft/pack"
    )
}

/// Adapter failures for the new contracts use the same error representation.
pub fn song_api_error(status: u16, code: &str, message: &str) -> ApiResponse {
    encoded_error(status, code, message, &[])
}

pub fn request_limit_response() -> ApiResponse {
    song_api_error(
        413,
        "request_body_limit",
        "Complete request exceeds 8 MiB; no source or selection was truncated",
    )
}

fn encoded_error(
    status: u16,
    code: &str,
    message: &str,
    source_note_ids: &[String],
) -> ApiResponse {
    bounded_response(
        status,
        &json!({"error":message,"code":code,"source_note_ids":source_note_ids}),
    )
}

struct BoundedBytes {
    bytes: Vec<u8>,
    limit: usize,
    exceeded: bool,
}
impl Write for BoundedBytes {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if buf.len() > self.limit.saturating_sub(self.bytes.len()) {
            self.exceeded = true;
            return Err(io::Error::other("Complete response exceeds byte limit"));
        }
        self.bytes.extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

pub(super) fn bounded_response<T: Serialize>(status: u16, value: &T) -> ApiResponse {
    bounded_response_with_limit(status, value, MAX_SONG_RESPONSE_BYTES)
}
fn bounded_response_with_limit<T: Serialize>(status: u16, value: &T, limit: usize) -> ApiResponse {
    let mut writer = BoundedBytes {
        bytes: Vec::new(),
        limit,
        exceeded: false,
    };
    match serde_json::to_writer(&mut writer, value) {
        Ok(()) => ApiResponse {
            status,
            body: writer.bytes,
        },
        Err(_) => {
            let (status, code, message) = if writer.exceeded {
                (413, "response_body_limit", "Complete response exceeds 16 MiB; no partial events, source IDs, or plan were returned")
            } else {
                (
                    500,
                    "response_serialization",
                    "The engine could not serialize the complete response",
                )
            };
            ApiResponse {
                status,
                body: serde_json::to_vec(
                    &json!({"error":message,"code":code,"source_note_ids":[]}),
                )
                .expect("fixed response error"),
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateRequest {
    score: Score,
    selected_part_ids: Vec<String>,
    profile: InstrumentProfile,
    human_source_note_ids: Vec<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ValidateRequest {
    score: Score,
    plan: assistance::AssistancePlan,
}
fn decode<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> Result<T, ApiResponse> {
    serde_json::from_slice(bytes).map_err(|error| {
        let code = if error.is_data() && error.to_string().contains("unknown field") {
            "assistance_unsupported_request"
        } else {
            "assistance_invalid_request"
        };
        song_api_error(
            400,
            code,
            &crate::json_input_error("assistance request", error),
        )
    })
}
fn assistance_response(
    result: Result<assistance::CheckedAssistancePlan, assistance::AssistanceError>,
) -> ApiResponse {
    match result {
        Ok(checked) => bounded_response(200, &checked),
        Err(error) => encoded_error(
            if error.code == "assistance_source_limit" {
                413
            } else {
                400
            },
            &error.code,
            &error.message,
            &error.source_note_ids,
        ),
    }
}

/// New routes carry structured failures. All existing operations keep api()'s
/// original result, error string and status behavior; GET remains adapter-owned.
pub fn api_response(path: &str, bytes: Vec<u8>) -> ApiResponse {
    if is_song_api_route(path) && bytes.len() > MAX_REQUEST_BYTES {
        return request_limit_response();
    }
    match path {
        "/api/practice-assistance/original"
        | "/api/practice-assistance/generate"
        | "/api/practice-assistance/create"
        | "/api/practice-assistance/validate" => practice_assistance_api::response(path, &bytes),
        "/api/practice-progression/generate" | "/api/practice-progression/validate" => {
            practice_progression_api::response(path, &bytes)
        }
        "/api/clean-song/basic-keys" => crate::basic_keys_api::response(&bytes),
        "/api/clean-song/draft" => crate::clean_draft_api::response(&bytes, false),
        "/api/clean-song/draft/pack" => crate::clean_draft_api::response(&bytes, true),
        "/api/assistance/create" => match decode::<CreateRequest>(&bytes) {
            Ok(request) => assistance_response(assistance::create_assistance_plan(
                &request.score,
                &request.selected_part_ids,
                &request.profile,
                &request.human_source_note_ids,
            )),
            Err(response) => response,
        },
        "/api/assistance/validate" => match decode::<ValidateRequest>(&bytes) {
            Ok(request) => assistance_response(assistance::validate_assistance_plan(
                &request.score,
                &request.plan,
            )),
            Err(response) => response,
        },
        "/api/midi/events" => match midi_events::parse_midi_events(&bytes, None) {
            Ok(timeline) => bounded_response(200, &timeline),
            Err(error) => {
                let status = match error.code {
                    midi_events::ErrorCode::SourceLimit
                    | midi_events::ErrorCode::TrackLimit
                    | midi_events::ErrorCode::EventLimit
                    | midi_events::ErrorCode::TickLimit => 413,
                    _ => 400,
                };
                bounded_response(
                    status,
                    &json!({"error":error.message,"code":error.code,"source_note_ids":[]}),
                )
            }
        },
        _ => {
            let (status, value) = match crate::api(path, bytes) {
                Ok(value) => (200, value),
                Err(error) => (400, json!({"error":error})),
            };
            ApiResponse {
                status,
                body: serde_json::to_vec(&value).expect("engine JSON value"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn serialized_response_limit_is_exact_and_never_returns_partial_json() {
        let value = json!({"events":["complete"]});
        let bytes = serde_json::to_vec(&value).unwrap();
        assert_eq!(
            bounded_response_with_limit(200, &value, bytes.len()).body,
            bytes
        );
        let rejected = bounded_response_with_limit(200, &value, bytes.len() - 1);
        assert_eq!(rejected.status, 413);
        let body: serde_json::Value = serde_json::from_slice(&rejected.body).unwrap();
        assert_eq!(body["code"], "response_body_limit");
        assert!(body.get("events").is_none());
    }
}
