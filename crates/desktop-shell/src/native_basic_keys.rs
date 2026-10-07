//! Bounded views of an immutable saved source. Renderer input never supplies
//! canonical notes, event bytes, a filesystem path, or a replacement timeline.
use crate::native_library::{clean_package, fail, LibraryError, NativeLibrary};
use score_core::basic_keys;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Source {
    key: String,
    content_sha256: String,
    profile: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NotationRequest {
    source: Source,
    settings: basic_keys::NotationRequest,
    #[serde(default)]
    pitch_mod: Option<practice_server::pitch_mod_api::Configuration>,
}

pub(crate) fn notation(library: &NativeLibrary, bytes: &[u8]) -> Result<Value, LibraryError> {
    let request: NotationRequest = serde_json::from_slice(bytes)
        .map_err(|e| fail(400, "library_invalid_request", e.to_string()))?;
    let shift = request
        .pitch_mod
        .as_ref()
        .map(crate::native_pitch_mod::shift)
        .transpose()?
        .unwrap_or(0);
    if shift != 0 {
        let source = crate::native_assistance::Source {
            key: request.source.key.clone(),
            content_sha256: request.source.content_sha256.clone(),
            profile: request.source.profile.clone(),
            choice: None,
            runtime_policy: basic_keys::RENDITION_POLICY.into(),
        };
        let (original, projection) =
            crate::native_pitch_mod::load_projection(library, &source, shift)?;
        let crate::native_pitch_mod::Original::Basic(original) = original else {
            return Err(fail(
                422,
                "library_basic_keys_source",
                "Notation requires the saved complete basic-key source",
            ));
        };
        let page = projection
            .basic_notation_page(&original, &request.settings)
            .map_err(crate::native_pitch_mod::projection_error)?;
        return Ok(
            json!({"source":request.source,"page":page,"pitch_mod":projection.identity(),"receipt":projection.source().receipt()}),
        );
    }
    let mismatch = || {
        fail(422, "library_basic_keys_source", "The notation view must name the current saved complete basic-key package and its exact content identity")
    };
    if request.source.profile != basic_keys::PROFILE
        || request.source.key != format!("song-{}", request.source.content_sha256)
    {
        return Err(mismatch());
    }
    let package = clean_package::load_source(library, &request.source.key)?.ok_or_else(mismatch)?;
    if package.content_sha256 != request.source.content_sha256
        || package.profile.as_deref() != Some(basic_keys::PROFILE)
    {
        return Err(mismatch());
    }
    let source = package.basic_source.as_ref().ok_or_else(mismatch)?;
    let page = source
        .validated
        .notation_page(&request.settings)
        .map_err(|e| fail(422, "library_basic_keys_notation", e))?;
    Ok(json!({"source": request.source, "page": page}))
}
