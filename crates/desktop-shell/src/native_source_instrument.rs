//! Reload immutable saved sources for optional instrument evidence. This is
//! independent of runtime compilation, ownership and pitch Mod configuration.
use crate::{
    native_assistance::{decode, Source},
    native_library::{fail, LibraryError, NativeLibrary},
};
use score_core::{basic_keys, practice_source, source_identity, source_instrument};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    source: Source,
}

fn mismatch() -> LibraryError {
    fail(422, "library_source_instrument_source", "Source instrument details require the current saved source, exact content identity, original profile, explicit choice and runtime policy")
}
fn unsupported() -> LibraryError {
    fail(422, "unsupported_source_profile", "Instrument disclosure requires retained canonical MIDI bytes or complete Basic MIDI metadata")
}

enum VerifiedSource {
    Basic(Box<basic_keys::CompleteBasicKeys>),
    Canonical(Box<score_core::Score>),
    Unsupported,
}

/// One verification policy for both optional disclosures. It does not compile
/// a practice runtime or impose runtime note limits on complete source evidence.
fn load_verified(
    library: &NativeLibrary,
    bytes: &[u8],
) -> Result<(Source, VerifiedSource), LibraryError> {
    let Request { source } = decode(bytes)?;
    if source.content_sha256.len() != 64
        || !source
            .content_sha256
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || source.key != format!("song-{}", source.content_sha256)
    {
        return Err(mismatch());
    }
    // Rechecks persisted bytes, active edition and independent package backup.
    // A renderer-supplied cached disclosure is never accepted as evidence.
    let loaded = library.load(&source.key)?;
    if loaded.entry.content_sha256 != source.content_sha256 {
        return Err(mismatch());
    }
    let verified = match loaded.clean_package {
        Some(package) => {
            let profile = package
                .profile
                .as_deref()
                .unwrap_or(score_core::clean_song::PROFILE);
            if package.content_sha256 != source.content_sha256 || profile != source.profile {
                return Err(mismatch());
            }
            if profile != basic_keys::PROFILE {
                return Ok((source, VerifiedSource::Unsupported));
            }
            if source.choice.is_some() || source.runtime_policy != basic_keys::RENDITION_POLICY {
                return Err(mismatch());
            }
            let score = basic_keys::decode_json(package.score_json.as_bytes())
                .map_err(|error| fail(422, "clean_package_invalid", error))?;
            VerifiedSource::Basic(Box::new(score))
        }
        None => {
            if source.profile != practice_source::CANONICAL_PROFILE
                || source.choice.is_some()
                || source.runtime_policy != practice_source::CANONICAL_RUNTIME_POLICY
            {
                return Err(mismatch());
            }
            let score = serde_json::from_str(loaded.score_json.as_deref().ok_or_else(mismatch)?)
                .map_err(|error| {
                    fail(422, "library_source_instrument_source", error.to_string())
                })?;
            VerifiedSource::Canonical(Box::new(score))
        }
    };
    Ok((source, verified))
}

pub(crate) fn describe(library: &NativeLibrary, bytes: &[u8]) -> Result<Value, LibraryError> {
    let (source, verified) = load_verified(library, bytes)?;
    let details = match verified {
        VerifiedSource::Basic(score) => source_instrument::describe_basic(&score),
        VerifiedSource::Canonical(score) => source_instrument::describe_canonical_midi(&score),
        VerifiedSource::Unsupported => return Err(unsupported()),
    }
    .map_err(|error| {
        fail(
            if error.code == "source_disclosure_limit" {
                413
            } else {
                422
            },
            error.code,
            error.message,
        )
    })?;
    // Keep the core binding unchanged: a Basic compact-wire digest and a saved
    // package digest are different domains. The verified descriptor is separate.
    Ok(json!({"source":source, "details":details}))
}

/// Basic-only GM evidence. A canonical saved score is never converted or
/// reinterpreted as Basic, even when it retains valid original MIDI bytes.
pub(crate) fn describe_identity(
    library: &NativeLibrary,
    bytes: &[u8],
) -> Result<Value, LibraryError> {
    let (source, verified) = load_verified(library, bytes)?;
    let score = match verified {
        VerifiedSource::Basic(score) => score,
        VerifiedSource::Canonical(_) | VerifiedSource::Unsupported => {
            return Err(fail(
                422,
                "non_basic_profile",
                "Informational source identity requires a complete saved Basic MIDI source",
            ))
        }
    };
    let details = source_identity::describe_basic(&score).map_err(|error| {
        fail(
            if error.code() == "analysis_limit" {
                413
            } else {
                422
            },
            error.code(),
            error.message(),
        )
    })?;
    Ok(json!({"source":source, "details":details}))
}
