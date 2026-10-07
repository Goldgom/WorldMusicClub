//! The new canonical source contract stays distinct from both saved-package
//! requests and the existing `/api/assistance` v1 written-note API.
use super::{bounded_response, encoded_error, ApiResponse};
use score_core::{
    automatic_assistance::{
        self, AssistanceSelection, AutomaticSettings, CheckedPracticeAssistance,
        PracticeAssistanceError, PracticeAssistancePlan,
    },
    practice_source::{PracticeRuntimeReceipt, PracticeSource},
    Score,
};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OriginalRequest {
    score: Score,
    #[serde(default)]
    pitch_mod: Option<crate::pitch_mod_api::Configuration>,
    selection: AssistanceSelection,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GenerateRequest {
    score: Score,
    #[serde(default)]
    pitch_mod: Option<crate::pitch_mod_api::Configuration>,
    selection: AssistanceSelection,
    settings: AutomaticSettings,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateRequest {
    score: Score,
    #[serde(default)]
    pitch_mod: Option<crate::pitch_mod_api::Configuration>,
    selection: AssistanceSelection,
    human_source_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ValidateRequest {
    score: Score,
    #[serde(default)]
    pitch_mod: Option<crate::pitch_mod_api::Configuration>,
    plan: PracticeAssistancePlan,
}

fn decode<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> Result<T, ApiResponse> {
    serde_json::from_slice(bytes).map_err(|error| {
        super::song_api_error(
            400,
            "practice_assistance_invalid_request",
            &crate::json_input_error("practice assistance request", error),
        )
    })
}

fn source(
    score: &Score,
    pitch_mod: Option<&crate::pitch_mod_api::Configuration>,
) -> Result<
    (
        PracticeSource,
        Option<score_core::pitch_projection::PitchProjectionIdentity>,
    ),
    ApiResponse,
> {
    if let Some(configuration) = pitch_mod {
        let shift = configuration
            .validate()
            .map_err(|error| super::song_api_error(422, "pitch_mod_configuration", &error))?;
        if shift != 0 {
            return crate::pitch_mod_api::source(score, pitch_mod);
        }
    }
    PracticeSource::from_canonical(score)
        .map(|source| (source, None))
        .map_err(|error| {
            super::song_api_error(422, "practice_assistance_source", &error.to_string())
        })
}

fn checked(
    result: Result<CheckedPracticeAssistance, PracticeAssistanceError>,
) -> Result<CheckedPracticeAssistance, ApiResponse> {
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
            runtime_policy: score_core::practice_source::CANONICAL_RUNTIME_POLICY,
        }
    }
}

#[derive(Serialize)]
struct Response<'a> {
    source: CanonicalSource<'a>,
    checked: &'a CheckedPracticeAssistance,
    #[serde(skip_serializing_if = "Option::is_none")]
    pitch_mod: Option<&'a score_core::pitch_projection::PitchProjectionIdentity>,
}

pub(super) fn response(path: &str, bytes: &[u8]) -> ApiResponse {
    let result = (|| match path {
        "/api/practice-assistance/original" => {
            let request: OriginalRequest = decode(bytes)?;
            let (source, pitch_mod) = source(&request.score, request.pitch_mod.as_ref())?;
            checked(automatic_assistance::original(&source, &request.selection))
                .map(|checked| (checked, pitch_mod))
        }
        "/api/practice-assistance/generate" => {
            let request: GenerateRequest = decode(bytes)?;
            let (source, pitch_mod) = source(&request.score, request.pitch_mod.as_ref())?;
            checked(automatic_assistance::generate(
                &source,
                &request.selection,
                &request.settings,
            ))
            .map(|checked| (checked, pitch_mod))
        }
        "/api/practice-assistance/create" => {
            let request: CreateRequest = decode(bytes)?;
            let (source, pitch_mod) = source(&request.score, request.pitch_mod.as_ref())?;
            checked(automatic_assistance::create(
                &source,
                &request.selection,
                &request.human_source_ids,
            ))
            .map(|checked| (checked, pitch_mod))
        }
        "/api/practice-assistance/validate" => {
            let request: ValidateRequest = decode(bytes)?;
            let (source, pitch_mod) = source(&request.score, request.pitch_mod.as_ref())?;
            checked(automatic_assistance::validate(&source, &request.plan))
                .map(|checked| (checked, pitch_mod))
        }
        _ => unreachable!("Only registered practice-assistance routes reach this adapter"),
    })();
    match result {
        Ok((checked, pitch_mod)) => bounded_response(
            200,
            &Response {
                source: (&checked.receipt).into(),
                checked: &checked,
                pitch_mod: pitch_mod.as_ref(),
            },
        ),
        Err(response) => response,
    }
}
