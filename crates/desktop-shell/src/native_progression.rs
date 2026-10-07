//! Every operation reloads the complete saved source and verifies its exact
//! identity before the independent progression proof is generated or checked.
use crate::{
    native_assistance::{decode, load_effective_source, Source},
    native_library::{fail, LibraryError, NativeLibrary},
};
use score_core::{
    automatic_assistance::AssistanceSelection,
    practice_progression::{self, PracticeProgressionPlan, ProgressionLayer},
};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GenerateRequest {
    source: Source,
    #[serde(default)]
    pitch_mod: Option<practice_server::pitch_mod_api::Configuration>,
    selection: AssistanceSelection,
    layer: ProgressionLayer,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ValidateRequest {
    source: Source,
    #[serde(default)]
    pitch_mod: Option<practice_server::pitch_mod_api::Configuration>,
    plan: PracticeProgressionPlan,
}

pub(crate) fn generate(library: &NativeLibrary, bytes: &[u8]) -> Result<Value, LibraryError> {
    let request: GenerateRequest = decode(bytes)?;
    let (source, pitch_mod) =
        load_effective_source(library, &request.source, request.pitch_mod.as_ref())?;
    let checked = practice_progression::generate(&source, &request.selection, request.layer)
        .map_err(|error| fail(422, "library_progression_unavailable", error.to_string()))?;
    let mut response = json!({"source":request.source,"checked":checked});
    if let Some(identity) = pitch_mod {
        response["pitch_mod"] = serde_json::to_value(identity)
            .map_err(|error| fail(422, "library_progression_unavailable", error.to_string()))?;
    }
    Ok(response)
}

pub(crate) fn validate(library: &NativeLibrary, bytes: &[u8]) -> Result<Value, LibraryError> {
    let request: ValidateRequest = decode(bytes)?;
    let (source, pitch_mod) =
        load_effective_source(library, &request.source, request.pitch_mod.as_ref())?;
    let checked = practice_progression::validate(&source, &request.plan)
        .map_err(|error| fail(422, "library_progression_unavailable", error.to_string()))?;
    let mut response = json!({"source":request.source,"checked":checked});
    if let Some(identity) = pitch_mod {
        response["pitch_mod"] = serde_json::to_value(identity)
            .map_err(|error| fail(422, "library_progression_unavailable", error.to_string()))?;
    }
    Ok(response)
}
