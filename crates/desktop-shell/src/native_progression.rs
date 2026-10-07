//! Every operation reloads the complete saved source and verifies its exact
//! identity before the independent progression proof is generated or checked.
use crate::{
    native_assistance::{decode, load_source, Source},
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
    selection: AssistanceSelection,
    layer: ProgressionLayer,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ValidateRequest {
    source: Source,
    plan: PracticeProgressionPlan,
}

pub(crate) fn generate(library: &NativeLibrary, bytes: &[u8]) -> Result<Value, LibraryError> {
    let request: GenerateRequest = decode(bytes)?;
    let source = load_source(library, &request.source)?;
    let checked = practice_progression::generate(&source, &request.selection, request.layer)
        .map_err(|error| fail(422, "library_progression_unavailable", error.to_string()))?;
    Ok(json!({"source":request.source,"checked":checked}))
}

pub(crate) fn validate(library: &NativeLibrary, bytes: &[u8]) -> Result<Value, LibraryError> {
    let request: ValidateRequest = decode(bytes)?;
    let source = load_source(library, &request.source)?;
    let checked = practice_progression::validate(&source, &request.plan)
        .map_err(|error| fail(422, "library_progression_unavailable", error.to_string()))?;
    Ok(json!({"source":request.source,"checked":checked}))
}
