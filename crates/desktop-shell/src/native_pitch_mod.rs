//! Read-only saved-source pitch views. Renderer requests carry a base identity
//! and configuration only; every request reloads the original immutable bytes.
use crate::{
    native_assistance::{decode, Source},
    native_library::{fail, LibraryError, NativeLibrary},
};
use practice_server::pitch_mod_api::Configuration;
use score_core::{pitch_projection::PitchProjection, practice_source::CANONICAL_PROFILE};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

pub(crate) enum Original {
    Canonical(score_core::Score),
    Basic(score_core::basic_keys::CompleteBasicKeys),
    Complete(score_core::clean_song::CompleteScore),
    Vsq(
        score_core::vsq_clean::VsqCompleteScore,
        score_core::vsq_clean::PracticeChoice,
    ),
}

fn mismatch() -> LibraryError {
    fail(422, "library_pitch_mod_source", "Pitch Mod requires the current saved source, exact content identity, and original explicit profile, practice choice and runtime policy")
}

pub(crate) fn projection_error(
    error: score_core::practice_source::PracticeSourceError,
) -> LibraryError {
    let code = match error.code.as_str() {
        "pitch_mod_shift" => "pitch_mod_shift",
        "pitch_mod_midi_range" => "pitch_mod_midi_range",
        "pitch_mod_no_pitched_notes" => "pitch_mod_no_pitched_notes",
        "pitch_mod_spelling" => "pitch_mod_spelling",
        "pitch_mod_inventory" => "pitch_mod_inventory",
        "pitch_mod_source_mismatch" => "pitch_mod_source_mismatch",
        "pitch_mod_fingering_unavailable" => "pitch_mod_fingering_unavailable",
        _ => "library_pitch_mod_source",
    };
    fail(422, code, error.to_string())
}

pub(crate) fn shift(configuration: &Configuration) -> Result<i16, LibraryError> {
    configuration
        .validate()
        .map_err(|error| fail(422, "pitch_mod_configuration", error))
}

pub(crate) fn load_projection(
    library: &NativeLibrary,
    source: &Source,
    semitones: i16,
) -> Result<(Original, PitchProjection), LibraryError> {
    if source.content_sha256.len() != 64
        || !source
            .content_sha256
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || source.key != format!("song-{}", source.content_sha256)
    {
        return Err(mismatch());
    }
    // This verifies persisted content, active edition and independent backup.
    // No derived runtime or path from the request is ever used as source.
    let loaded = library.load(&source.key)?;
    if loaded.entry.content_sha256 != source.content_sha256 {
        return Err(mismatch());
    }
    let original = match loaded.clean_package {
        Some(package) => {
            let profile = package
                .profile
                .as_deref()
                .unwrap_or(score_core::clean_song::PROFILE);
            if package.content_sha256 != source.content_sha256 || profile != source.profile {
                return Err(mismatch());
            }
            let invalid = |error| fail(422, "clean_package_invalid", error);
            match (profile, source.choice) {
                (score_core::basic_keys::PROFILE, None) => Original::Basic(
                    score_core::basic_keys::decode_json(package.score_json.as_bytes())
                        .map_err(invalid)?,
                ),
                (score_core::clean_song::PROFILE, None) => Original::Complete(
                    score_core::clean_song::decode_json(package.score_json.as_bytes())
                        .map_err(invalid)?,
                ),
                (score_core::vsq_clean::PROFILE, Some(choice)) => Original::Vsq(
                    score_core::vsq_clean::decode_json(package.score_json.as_bytes())
                        .map_err(invalid)?,
                    choice,
                ),
                _ => return Err(mismatch()),
            }
        }
        None if source.profile == CANONICAL_PROFILE && source.choice.is_none() => {
            Original::Canonical(
                serde_json::from_str(loaded.score_json.as_deref().ok_or_else(mismatch)?)
                    .map_err(|error| fail(422, "library_pitch_mod_source", error.to_string()))?,
            )
        }
        None => return Err(mismatch()),
    };
    let projection = match &original {
        Original::Canonical(score) => PitchProjection::from_canonical(score, semitones),
        Original::Basic(score) => PitchProjection::from_basic(score, semitones),
        Original::Complete(score) => PitchProjection::from_complete_midi(score, semitones),
        Original::Vsq(score, choice) => PitchProjection::from_vsq(score, *choice, semitones),
    }
    .map_err(projection_error)?;
    let receipt = projection.original_receipt();
    if receipt.source_profile != source.profile
        || receipt.choice != source.choice
        || receipt.runtime_policy != source.runtime_policy
    {
        return Err(mismatch());
    }
    let projection = projection
        .with_verified_saved_binding(&source.content_sha256)
        .map_err(projection_error)?;
    Ok((original, projection))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    source: Source,
    configuration: Configuration,
}

pub(crate) fn project(library: &NativeLibrary, bytes: &[u8]) -> Result<Value, LibraryError> {
    let request: Request = decode(bytes)?;
    let (original, projection) =
        load_projection(library, &request.source, shift(&request.configuration)?)?;
    let mut response = json!({
        "source":request.source, "configuration":request.configuration,
        "identity":projection.identity(), "receipt":projection.source().receipt(),
        "source_pitches":projection.source_pitches(), "compilation":projection.compilation(),
    });
    let invalid = |error| fail(422, "library_pitch_mod_runtime", error);
    // All joins use complete, Rust-created source identities. Neither clocks,
    // controls, note releases nor source events are recomputed from shifted keys.
    let pitches: HashMap<_, _> = projection
        .source_pitches()
        .iter()
        .map(|note| (note.source_id.as_str(), note.effective_midi))
        .collect();
    let key = |id: &str| {
        pitches.get(id).copied().ok_or_else(|| {
            invalid("Pitch projection is missing a native note identity".to_string())
        })
    };
    match &original {
        Original::Canonical(_) => {
            response["audio_profile"] = serde_json::to_value(
                score_core::canonical_audio::compile_audio_profile(projection.notation().clone())
                    .map_err(invalid)?,
            )
            .map_err(|error| invalid(error.to_string()))?;
        }
        Original::Basic(score) => {
            let mut runtime = practice_server::basic_keys_api::compile(score).map_err(invalid)?;
            let compiled = runtime
                .compilation
                .as_mut()
                .ok_or_else(|| invalid("Basic runtime has no complete rendition".to_string()))?;
            compiled.timeline = projection.source().timeline().clone();
            for part in &mut runtime.parts {
                part.range = projection
                    .source_pitches()
                    .iter()
                    .filter(|note| note.part_id == part.id)
                    .map(|note| [note.effective_midi, note.effective_midi])
                    .reduce(|[lo, hi], [key, _]| [lo.min(key), hi.max(key)]);
            }
            response["runtime"] =
                serde_json::to_value(runtime).map_err(|error| invalid(error.to_string()))?;
        }
        Original::Complete(score) => {
            let mut runtime = score_core::clean_song::compile_complete(score).map_err(invalid)?;
            for note in &mut runtime.notes {
                note.key = key(&note.note_id)?;
            }
            runtime.compilation = projection.compilation().clone();
            response["runtime"] =
                serde_json::to_value(runtime).map_err(|error| invalid(error.to_string()))?;
        }
        Original::Vsq(score, choice) => {
            let (mut runtime, compilation) =
                score_core::vsq_clean::compile_practice_with_compilation(score, *choice)
                    .map_err(invalid)?;
            // Navigation contains identity and clock membership, never key math.
            let navigation = crate::native_library::vsq_navigation::compile(
                score,
                &runtime,
                &compilation.timeline,
                &request.source.content_sha256,
            );
            match navigation {
                Ok(navigation) => {
                    response["navigation"] = serde_json::to_value(navigation)
                        .map_err(|error| invalid(error.to_string()))?
                }
                Err(message) => {
                    response["navigation_unavailable"] =
                        json!({"code":"vsq_navigation_unavailable","message":message})
                }
            }
            for note in &mut runtime.notes {
                note.key = key(&note.note_id)?;
            }
            response["runtime"] =
                serde_json::to_value(runtime).map_err(|error| invalid(error.to_string()))?;
            response["reference_velocity"] = json!(score_core::vsq_clean::REFERENCE_VELOCITY);
        }
    }
    Ok(response)
}
