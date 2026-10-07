//! Progression has its own versioned proof. Never accept a caller's hierarchy,
//! eligible set, checked assistance, or reduced rendering timeline as source.
use super::{bounded_response, encoded_error, ApiResponse};
use score_core::{
    automatic_assistance::{AssistanceSelection, PracticeAssistanceError},
    practice_progression::{
        self, CheckedPracticeProgression, PracticeProgressionPlan, ProgressionLayer,
    },
    practice_source::{PracticeRuntimeReceipt, PracticeSource},
    Score,
};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GenerateRequest {
    score: Score,
    selection: AssistanceSelection,
    layer: ProgressionLayer,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ValidateRequest {
    score: Score,
    plan: PracticeProgressionPlan,
}

fn decode<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> Result<T, ApiResponse> {
    serde_json::from_slice(bytes).map_err(|error| {
        super::song_api_error(
            400,
            "practice_progression_invalid_request",
            &crate::json_input_error("practice progression request", error),
        )
    })
}

fn source(score: &Score) -> Result<PracticeSource, ApiResponse> {
    PracticeSource::from_canonical(score).map_err(|error| {
        super::song_api_error(422, "practice_progression_source", &error.to_string())
    })
}

fn checked(
    result: Result<CheckedPracticeProgression, PracticeAssistanceError>,
) -> Result<CheckedPracticeProgression, ApiResponse> {
    result.map_err(|error| encoded_error(422, &error.code, &error.message, &error.source_ids))
}

#[derive(Serialize)]
struct CanonicalSource<'a> {
    kind: &'static str,
    source_binding: &'a score_core::practice_source::PracticeSourceBinding,
    profile: &'a str,
    choice: Option<score_core::vsq_clean::PracticeChoice>,
    runtime_policy: &'a str,
}

impl<'a> From<&'a PracticeRuntimeReceipt> for CanonicalSource<'a> {
    fn from(receipt: &'a PracticeRuntimeReceipt) -> Self {
        Self {
            kind: "canonical",
            source_binding: &receipt.source_binding,
            profile: &receipt.source_profile,
            choice: receipt.choice,
            runtime_policy: &receipt.runtime_policy,
        }
    }
}

#[derive(Serialize)]
struct Response<'a> {
    source: CanonicalSource<'a>,
    checked: &'a CheckedPracticeProgression,
}

pub(super) fn response(path: &str, bytes: &[u8]) -> ApiResponse {
    let result = (|| match path {
        "/api/practice-progression/generate" => {
            let request: GenerateRequest = decode(bytes)?;
            checked(practice_progression::generate(
                &source(&request.score)?,
                &request.selection,
                request.layer,
            ))
        }
        "/api/practice-progression/validate" => {
            let request: ValidateRequest = decode(bytes)?;
            checked(practice_progression::validate(
                &source(&request.score)?,
                &request.plan,
            ))
        }
        _ => unreachable!("Only registered practice-progression routes reach this adapter"),
    })();
    match result {
        Ok(checked) => bounded_response(
            200,
            &Response {
                source: (&checked.plan.receipt).into(),
                checked: &checked,
            },
        ),
        Err(response) => response,
    }
}
