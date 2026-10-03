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
    Ok(json!({"source": request.source, "plan": result}))
}
