//! Pitch configuration is a request, never a receipt or caller-provided runtime.
//! Every derived value starts from the complete original validated score.
use crate::song_api::{bounded_response, song_api_error, ApiResponse};
use score_core::{
    pitch_projection::PitchProjection,
    practice_source::{PracticeRuntimeReceipt, PracticeSource, PracticeSourceBinding},
    Score,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Configuration {
    pub format: String,
    pub version: u32,
    pub semitones: i16,
}

impl Configuration {
    pub fn validate(&self) -> Result<i16, String> {
        if self.format != "wmc-pitch-mod" || self.version != 1 {
            return Err("Unsupported pitch Mod configuration format or version".into());
        }
        if !(-12..=12).contains(&self.semitones) {
            return Err(
                "Pitch Mod requires a whole-song integer shift from -12 to 12 semitones".into(),
            );
        }
        Ok(self.semitones)
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    score: Score,
    configuration: Configuration,
}

/// This descriptor always describes the original source and interpretation.
/// Effective identity belongs only in the separately issued Rust receipt.
#[derive(Serialize)]
pub struct CanonicalSource<'a> {
    kind: &'static str,
    source_binding: &'a PracticeSourceBinding,
    profile: &'a str,
    choice: Option<score_core::vsq_clean::PracticeChoice>,
    runtime_policy: &'a str,
}

impl<'a> From<&'a PracticeRuntimeReceipt> for CanonicalSource<'a> {
    fn from(receipt: &'a PracticeRuntimeReceipt) -> Self {
        Self {
            kind: "canonical",
            source_binding: &receipt.source_binding,
            profile: &receipt.source_profile,
            choice: receipt.choice,
            runtime_policy: &receipt.runtime_policy,
        }
    }
}

pub(crate) fn source(
    score: &Score,
    configuration: Option<&Configuration>,
) -> Result<
    (
        PracticeSource,
        Option<score_core::pitch_projection::PitchProjectionIdentity>,
    ),
    ApiResponse,
> {
    match configuration {
        None => PracticeSource::from_canonical(score)
            .map(|source| (source, None))
            .map_err(source_error),
        Some(configuration) => {
            let semitones = configuration
                .validate()
                .map_err(|error| song_api_error(422, "pitch_mod_configuration", &error))?;
            PitchProjection::from_canonical(score, semitones)
                .map(|projection| (projection.source().clone(), projection.identity().cloned()))
                .map_err(source_error)
        }
    }
}

fn source_error(error: score_core::practice_source::PracticeSourceError) -> ApiResponse {
    // MIDI-domain rejection is distinct from later instrument-range diagnostics.
    song_api_error(422, &error.code, &error.message)
}

pub(crate) fn response(bytes: &[u8]) -> ApiResponse {
    let result = (|| {
        let request: Request = serde_json::from_slice(bytes).map_err(|error| {
            song_api_error(
                400,
                "pitch_mod_invalid_request",
                &crate::json_input_error("pitch Mod request", error),
            )
        })?;
        let shift = request
            .configuration
            .validate()
            .map_err(|error| song_api_error(422, "pitch_mod_configuration", &error))?;
        let projection =
            PitchProjection::from_canonical(&request.score, shift).map_err(source_error)?;
        let audio_profile =
            score_core::canonical_audio::compile_audio_profile(projection.notation().clone())
                .map_err(|error| song_api_error(422, "pitch_mod_audio_profile", &error))?;
        Ok(serde_json::json!({
            "source": CanonicalSource::from(projection.original_receipt()),
            "configuration": request.configuration,
            "identity": projection.identity(),
            "receipt": projection.source().receipt(),
            "source_pitches": projection.source_pitches(),
            "compilation": projection.compilation(),
            "audio_profile": audio_profile,
        }))
    })();
    match result {
        Ok(value) => bounded_response(200, &value),
        Err(response) => response,
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FingeringRequest {
    score: Score,
    configuration: Configuration,
    settings: serde_json::Value,
}

pub(crate) fn fingering(bytes: &[u8], piano: bool) -> ApiResponse {
    let result = (|| {
        let mut request: FingeringRequest = serde_json::from_slice(bytes).map_err(|error| {
            song_api_error(
                400,
                "pitch_mod_invalid_request",
                &crate::json_input_error("pitch Mod fingering request", error),
            )
        })?;
        let shift = request
            .configuration
            .validate()
            .map_err(|error| song_api_error(422, "pitch_mod_configuration", &error))?;
        let projection =
            PitchProjection::from_canonical(&request.score, shift).map_err(source_error)?;
        let mut response = serde_json::json!({
            "source":CanonicalSource::from(projection.original_receipt()),
            "pitch_mod":projection.identity(), "receipt":projection.source().receipt(),
        });
        let invalid = |message: &str| song_api_error(400, "pitch_mod_invalid_request", message);
        let settings = request
            .settings
            .as_object_mut()
            .ok_or_else(|| invalid("Fingering settings must be an object"))?;
        if settings.contains_key("score") || settings.contains_key("timeline") {
            return Err(invalid(
                "Pitch Mod fingering settings cannot supply an effective score or timeline",
            ));
        }
        let native = projection.into_fingering_source().map_err(source_error)?;
        settings.insert(
            "score".into(),
            serde_json::to_value(native.score()).map_err(|error| invalid(&error.to_string()))?,
        );
        let planned = if piano {
            let settings = serde_json::from_value(request.settings)
                .map_err(|error| invalid(&error.to_string()))?;
            score_core::piano_fingering::plan_piano_fingering_from_source(settings, native)
                .and_then(|plan| serde_json::to_value(plan).map_err(|error| error.to_string()))
        } else {
            let settings = serde_json::from_value(request.settings)
                .map_err(|error| invalid(&error.to_string()))?;
            score_core::guitar_fingering::plan_guitar_fingering_from_source(settings, native)
                .and_then(|plan| serde_json::to_value(plan).map_err(|error| error.to_string()))
        }
        .map_err(|error| song_api_error(422, "pitch_mod_fingering", &error))?;
        response["plan"] = planned;
        Ok(response)
    })();
    match result {
        Ok(value) => bounded_response(200, &value),
        Err(response) => response,
    }
}
