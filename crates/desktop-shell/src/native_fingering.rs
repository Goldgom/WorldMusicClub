//! Key-bound advisory planning. Package loading holds the existing library lock;
//! planning uses that immutable validated snapshot, never renderer score data.
use crate::native_library::{fail, LibraryError, NativeLibrary};
use score_core::{fingering_source::FingeringSource, guitar_fingering, piano_fingering};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Source {
    key: String,
    content_sha256: String,
    profile: String,
    choice: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    source: Source,
    settings: Value,
    #[serde(default)]
    pitch_mod: Option<practice_server::pitch_mod_api::Configuration>,
}

fn invalid(message: impl Into<String>) -> LibraryError {
    fail(400, "library_invalid_request", message)
}
fn mismatch() -> LibraryError {
    fail(422, "library_fingering_source", "Fingering requires the current saved complete package, matching content and profile, and its explicit supported practice choice")
}

pub(crate) fn plan(
    library: &NativeLibrary,
    bytes: &[u8],
    piano: bool,
) -> Result<Value, LibraryError> {
    let mut request: Request = serde_json::from_slice(bytes).map_err(|e| invalid(e.to_string()))?;
    let settings = request
        .settings
        .as_object_mut()
        .ok_or_else(|| invalid("Fingering settings must be an object"))?;
    if settings.contains_key("score") || settings.contains_key("timeline") {
        return Err(invalid(
            "Native fingering does not accept a renderer score or timeline",
        ));
    }
    let shift = request
        .pitch_mod
        .as_ref()
        .map(crate::native_pitch_mod::shift)
        .transpose()?
        .unwrap_or(0);
    let (native, identity, receipt) = if shift != 0 {
        let choice = match request.source.choice.as_deref() {
            None => None,
            Some("base_notes_instrumental") => {
                Some(score_core::vsq_clean::PracticeChoice::BaseNotesInstrumental)
            }
            _ => return Err(mismatch()),
        };
        let policy = match (request.source.profile.as_str(), choice) {
            (score_core::clean_song::PROFILE, None) => score_core::clean_song::PROFILE,
            (score_core::vsq_clean::PROFILE, Some(_)) => {
                score_core::practice_source::VSQ_RUNTIME_POLICY
            }
            _ => return Err(mismatch()),
        };
        let source = crate::native_assistance::Source {
            key: request.source.key.clone(),
            content_sha256: request.source.content_sha256.clone(),
            profile: request.source.profile.clone(),
            choice,
            runtime_policy: policy.into(),
        };
        let (_, projection) = crate::native_pitch_mod::load_projection(library, &source, shift)?;
        let identity =
            serde_json::to_value(projection.identity()).map_err(|e| invalid(e.to_string()))?;
        let receipt = serde_json::to_value(projection.source().receipt())
            .map_err(|e| invalid(e.to_string()))?;
        (
            projection
                .into_fingering_source()
                .map_err(crate::native_pitch_mod::projection_error)?,
            Some(identity),
            Some(receipt),
        )
    } else {
        if request.source.key != format!("song-{}", request.source.content_sha256) {
            return Err(mismatch());
        }
        let loaded = library.load(&request.source.key)?;
        let package = loaded.clean_package.ok_or_else(mismatch)?;
        if package.content_sha256 != request.source.content_sha256
            || package
                .profile
                .as_deref()
                .unwrap_or(score_core::clean_song::PROFILE)
                != request.source.profile
        {
            return Err(mismatch());
        }
        let native = match (
            request.source.profile.as_str(),
            request.source.choice.as_deref(),
        ) {
            (score_core::clean_song::PROFILE, None) => {
                let score = score_core::clean_song::decode_json(package.score_json.as_bytes())
                    .map_err(|e| fail(422, "clean_package_invalid", e))?;
                FingeringSource::complete_midi(&score)
            }
            (score_core::vsq_clean::PROFILE, Some("base_notes_instrumental")) => {
                let score = score_core::vsq_clean::decode_json(package.score_json.as_bytes())
                    .map_err(|e| fail(422, "clean_package_invalid", e))?;
                FingeringSource::explicit_vsq(
                    &score,
                    score_core::vsq_clean::PracticeChoice::BaseNotesInstrumental,
                )
            }
            // A full-event package without notation cannot acquire practice targets.
            _ => return Err(mismatch()),
        }
        .map_err(|e| fail(422, "library_fingering_unavailable", e))?;
        (native, None, None)
    };
    settings.insert(
        "score".into(),
        serde_json::to_value(native.score()).map_err(|e| invalid(e.to_string()))?,
    );
    let result = if piano {
        let settings =
            serde_json::from_value(request.settings).map_err(|e| invalid(e.to_string()))?;
        let result = piano_fingering::plan_piano_fingering_from_source(settings, native)
            .map_err(|e| fail(422, "library_fingering_unavailable", e))?;
        serde_json::to_value(result)
    } else {
        let settings =
            serde_json::from_value(request.settings).map_err(|e| invalid(e.to_string()))?;
        let result = guitar_fingering::plan_guitar_fingering_from_source(settings, native)
            .map_err(|e| fail(422, "library_fingering_unavailable", e))?;
        serde_json::to_value(result)
    }
    .map_err(|e| fail(422, "library_fingering_unavailable", e.to_string()))?;
    let mut response = json!({"source": request.source, "plan": result});
    if let (Some(identity), Some(receipt)) = (identity, receipt) {
        response["pitch_mod"] = identity;
        response["receipt"] = receipt;
    }
    Ok(response)
}
