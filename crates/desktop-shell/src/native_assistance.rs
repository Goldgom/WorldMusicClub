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
    pub(crate) key: String,
    pub(crate) content_sha256: String,
    pub(crate) profile: String,
    // A missing choice is not an explicit choice, even for profiles using null.
    #[serde(deserialize_with = "explicit_choice")]
    pub(crate) choice: Option<score_core::vsq_clean::PracticeChoice>,
    pub(crate) runtime_policy: String,
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
    #[serde(default)]
    pitch_mod: Option<practice_server::pitch_mod_api::Configuration>,
    selection: AssistanceSelection,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GenerateRequest {
    source: Source,
    #[serde(default)]
    pitch_mod: Option<practice_server::pitch_mod_api::Configuration>,
    selection: AssistanceSelection,
    settings: AutomaticSettings,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateRequest {
    source: Source,
    #[serde(default)]
    pitch_mod: Option<practice_server::pitch_mod_api::Configuration>,
    selection: AssistanceSelection,
    human_source_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ValidateRequest {
    source: Source,
    #[serde(default)]
    pitch_mod: Option<practice_server::pitch_mod_api::Configuration>,
    plan: PracticeAssistancePlan,
}

/// Required immediately before every saved-source Human-practice launch.
/// Even pitch-off is explicit; no caller timeline or exclusion list is accepted.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AdmissionRequest {
    source: Source,
    pitch_mod: practice_server::pitch_mod_api::Configuration,
    selection: AssistanceSelection,
    #[serde(default)]
    plan: Option<PracticeAssistancePlan>,
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

pub(crate) fn load_effective_source(
    library: &NativeLibrary,
    source: &Source,
    configuration: Option<&practice_server::pitch_mod_api::Configuration>,
) -> Result<
    (
        PracticeSource,
        Option<score_core::pitch_projection::PitchProjectionIdentity>,
    ),
    LibraryError,
> {
    let shift = configuration
        .map(crate::native_pitch_mod::shift)
        .transpose()?
        .unwrap_or(0);
    if shift == 0 {
        return load_source(library, source).map(|source| (source, None));
    }
    crate::native_pitch_mod::load_projection(library, source, shift)
        .map(|(_, projection)| (projection.source().clone(), projection.identity().cloned()))
}

fn response(
    source: Source,
    checked: CheckedPracticeAssistance,
    pitch_mod: Option<score_core::pitch_projection::PitchProjectionIdentity>,
) -> Result<Value, LibraryError> {
    let mut response = json!({"source":source,"checked":checked});
    if let Some(identity) = pitch_mod {
        response["pitch_mod"] =
            serde_json::to_value(identity).map_err(|error| invalid(error.to_string()))?;
    }
    Ok(response)
}

pub(crate) fn original(library: &NativeLibrary, bytes: &[u8]) -> Result<Value, LibraryError> {
    let request: OriginalRequest = decode(bytes)?;
    let (native, pitch_mod) =
        load_effective_source(library, &request.source, request.pitch_mod.as_ref())?;
    let checked = automatic_assistance::original(&native, &request.selection)
        .map_err(|error| unavailable(error.to_string()))?;
    response(request.source, checked, pitch_mod)
}

pub(crate) fn generate(library: &NativeLibrary, bytes: &[u8]) -> Result<Value, LibraryError> {
    let request: GenerateRequest = decode(bytes)?;
    let (native, pitch_mod) =
        load_effective_source(library, &request.source, request.pitch_mod.as_ref())?;
    let checked = automatic_assistance::generate(&native, &request.selection, &request.settings)
        .map_err(|error| unavailable(error.to_string()))?;
    response(request.source, checked, pitch_mod)
}

pub(crate) fn create(library: &NativeLibrary, bytes: &[u8]) -> Result<Value, LibraryError> {
    let request: CreateRequest = decode(bytes)?;
    let (native, pitch_mod) =
        load_effective_source(library, &request.source, request.pitch_mod.as_ref())?;
    let checked =
        automatic_assistance::create(&native, &request.selection, &request.human_source_ids)
            .map_err(|error| unavailable(error.to_string()))?;
    response(request.source, checked, pitch_mod)
}

pub(crate) fn validate(library: &NativeLibrary, bytes: &[u8]) -> Result<Value, LibraryError> {
    let request: ValidateRequest = decode(bytes)?;
    let (native, pitch_mod) =
        load_effective_source(library, &request.source, request.pitch_mod.as_ref())?;
    let checked = automatic_assistance::validate(&native, &request.plan)
        .map_err(|error| unavailable(error.to_string()))?;
    response(request.source, checked, pitch_mod)
}

pub(crate) fn admit(library: &NativeLibrary, bytes: &[u8]) -> Result<Value, LibraryError> {
    let request: AdmissionRequest = decode(bytes)?;
    let (native, pitch_mod) =
        load_effective_source(library, &request.source, Some(&request.pitch_mod))?;
    let checked = if let Some(plan) = &request.plan {
        // Normalize only request ordering. Duplicate/foreign part IDs, profile
        // mismatches and stale plan receipts remain errors, never retargeting.
        let mut selected = request.selection.selected_part_ids.clone();
        selected.sort();
        if selected.windows(2).any(|pair| pair[0] == pair[1])
            || selected != plan.selection.selected_part_ids
            || serde_json::to_value(&request.selection.profile)
                .map_err(|error| invalid(error.to_string()))?
                != serde_json::to_value(&plan.selection.profile)
                    .map_err(|error| invalid(error.to_string()))?
        {
            return Err(fail(
                422,
                "library_practice_admission_selection",
                "The explicitly chosen assistance plan must match the current selected parts and instrument profile",
            ));
        }
        automatic_assistance::validate(&native, plan)
    } else {
        // Original includes every attack in the selected parts. It must never
        // silently turn unsupported attacks into accompaniment.
        automatic_assistance::original(&native, &request.selection)
    }
    .map_err(|error| {
        let code = if error.code == "practice_original_instrument_unsupported" {
            "practice_original_instrument_unsupported"
        } else {
            "library_practice_admission_unavailable"
        };
        fail(422, code, error.to_string())
    })?;
    response(request.source, checked, pitch_mod)
}
