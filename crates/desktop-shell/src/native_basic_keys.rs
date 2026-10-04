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
}

pub(crate) fn notation(library: &NativeLibrary, bytes: &[u8]) -> Result<Value, LibraryError> {
    let request: NotationRequest = serde_json::from_slice(bytes)
        .map_err(|e| fail(400, "library_invalid_request", e.to_string()))?;
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
    let score = basic_keys::decode_json(package.score_json.as_bytes())
        .map_err(|e| fail(422, "clean_package_invalid", e))?;
    let page = basic_keys::notation_page(&score, &request.settings)
        .map_err(|e| fail(422, "library_basic_keys_notation", e))?;
    Ok(json!({"source": request.source, "page": page}))
}
