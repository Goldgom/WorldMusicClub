//! Saved-source assistance is a read-only ownership projection. Only this
//! adapter admits package identities: renderer timelines and cached runtimes
//! cannot construct a trusted practice source.
use crate::native_library::{fail, LibraryError, NativeLibrary};
use score_core::{
    automatic_assistance::{
        self, AssistanceSelection, AutomaticSettings, CheckedPracticeAssistance,
        PracticeAssistancePlan,
    },
    practice_source::{PracticeSource, CANONICAL_PROFILE},
};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{json, Value};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Source {
    key: String,
    content_sha256: String,
    profile: String,
    // A missing choice is not an explicit choice, even for profiles using null.
    #[serde(deserialize_with = "explicit_choice")]
    choice: Option<score_core::vsq_clean::PracticeChoice>,
    runtime_policy: String,
}

fn explicit_choice<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<score_core::vsq_clean::PracticeChoice>, D::Error> {
    Option::deserialize(deserializer)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OriginalRequest {
    source: Source,
    selection: AssistanceSelection,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GenerateRequest {
    source: Source,
    selection: AssistanceSelection,
    settings: AutomaticSettings,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateRequest {
    source: Source,
    selection: AssistanceSelection,
    human_source_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ValidateRequest {
    source: Source,
    plan: PracticeAssistancePlan,
}

fn invalid(message: impl Into<String>) -> LibraryError {
    fail(400, "library_invalid_request", message)
}

fn mismatch() -> LibraryError {
    fail(422, "library_assistance_source", "Assistance requires the current saved source, matching content and profile, and its explicit supported practice choice and runtime policy")
}

fn unavailable(message: impl Into<String>) -> LibraryError {
    fail(422, "library_assistance_unavailable", message)
}

pub(crate) fn decode<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> Result<T, LibraryError> {
    // Native dispatch also enforces this bound. Retain it here so future
    // internal callers cannot bypass request admission.
    if bytes.len() > crate::MAX_BODY {
        return Err(fail(
            413,
            "library_request_limit",
            "Assistance request exceeds 8 MiB; no source was discarded",
        ));
    }
    serde_json::from_slice(bytes).map_err(|error| invalid(error.to_string()))
}

pub(crate) fn load_source(
    library: &NativeLibrary,
    source: &Source,
) -> Result<PracticeSource, LibraryError> {
    if source.content_sha256.len() != 64
        || !source
            .content_sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        || source.key != format!("song-{}", source.content_sha256)
    {
        return Err(mismatch());
    }
    // The loader rechecks exact persisted bytes and active edition; complete
    // packages also verify their independent backup. Everything below uses
    // this immutable snapshot. Assistance writes no source or runtime sidecar.
    let loaded = library.load(&source.key)?;
    if loaded.entry.content_sha256 != source.content_sha256 {
        return Err(mismatch());
    }
    let native = match loaded.clean_package {
        Some(package) => {
            let profile = package
                .profile
                .as_deref()
                .unwrap_or(score_core::clean_song::PROFILE);
            if package.content_sha256 != source.content_sha256 || profile != source.profile {
                return Err(mismatch());
            }
            match (profile, source.choice) {
                (score_core::basic_keys::PROFILE, None) => {
                    let score = score_core::basic_keys::decode_json(package.score_json.as_bytes())
                        .map_err(|error| fail(422, "clean_package_invalid", error))?;
                    PracticeSource::from_basic(&score)
                }
                (score_core::clean_song::PROFILE, None) => {
                    let score = score_core::clean_song::decode_json(package.score_json.as_bytes())
                        .map_err(|error| fail(422, "clean_package_invalid", error))?;
                    PracticeSource::from_complete_midi(&score)
                }
                (score_core::vsq_clean::PROFILE, Some(choice)) => {
                    let score = score_core::vsq_clean::decode_json(package.score_json.as_bytes())
                        .map_err(|error| fail(422, "clean_package_invalid", error))?;
                    PracticeSource::from_vsq(&score, choice)
                }
                // Event-only/unresolved packages cannot acquire a notation
                // fallback or gain targets by claiming a different profile.
                _ => return Err(mismatch()),
            }
        }
        None if source.profile == CANONICAL_PROFILE && source.choice.is_none() => {
            let score: score_core::Score =
                serde_json::from_str(loaded.score_json.as_deref().ok_or_else(mismatch)?)
                    .map_err(|error| invalid(error.to_string()))?;
            PracticeSource::from_canonical(&score)
        }
        None => return Err(mismatch()),
    }
    .map_err(|error| unavailable(error.to_string()))?;
    let receipt = native.receipt();
    if receipt.source_profile != source.profile
        || receipt.runtime_policy != source.runtime_policy
        || receipt.choice != source.choice
    {
        return Err(mismatch());
    }
    // The request's hash becomes an admitted package binding only after the
    // loader and profile-specific constructor have independently checked it.
    native
        .with_verified_saved_binding(&source.content_sha256)
        .map_err(|error| unavailable(error.to_string()))
}

fn response(source: Source, checked: CheckedPracticeAssistance) -> Result<Value, LibraryError> {
    Ok(json!({"source": source, "checked": checked}))
}

pub(crate) fn original(library: &NativeLibrary, bytes: &[u8]) -> Result<Value, LibraryError> {
    let request: OriginalRequest = decode(bytes)?;
    let native = load_source(library, &request.source)?;
    let checked = automatic_assistance::original(&native, &request.selection)
        .map_err(|error| unavailable(error.to_string()))?;
    response(request.source, checked)
}

pub(crate) fn generate(library: &NativeLibrary, bytes: &[u8]) -> Result<Value, LibraryError> {
    let request: GenerateRequest = decode(bytes)?;
    let native = load_source(library, &request.source)?;
    let checked = automatic_assistance::generate(&native, &request.selection, &request.settings)
        .map_err(|error| unavailable(error.to_string()))?;
    response(request.source, checked)
}

pub(crate) fn create(library: &NativeLibrary, bytes: &[u8]) -> Result<Value, LibraryError> {
    let request: CreateRequest = decode(bytes)?;
    let native = load_source(library, &request.source)?;
    let checked =
        automatic_assistance::create(&native, &request.selection, &request.human_source_ids)
            .map_err(|error| unavailable(error.to_string()))?;
    response(request.source, checked)
}

pub(crate) fn validate(library: &NativeLibrary, bytes: &[u8]) -> Result<Value, LibraryError> {
    let request: ValidateRequest = decode(bytes)?;
    let native = load_source(library, &request.source)?;
    let checked = automatic_assistance::validate(&native, &request.plan)
        .map_err(|error| unavailable(error.to_string()))?;
    response(request.source, checked)
}
