//! Controller-free VSQ authoring and named engine semantics, independently
//! versioned from MIDI, with explicitly limited instrumental practice.
mod model;
mod runtime;
#[cfg(test)]
mod tests;
mod validate;
pub use model::*;
pub use runtime::{
    compile_practice, compile_vocal, ExactMicroseconds, PracticeChoice, PracticeRuntime,
    RuntimeMasterMix, RuntimeNote, RuntimePart,
};
pub use validate::{decode_json, encode_json, validate};
pub const FORMAT: &str = "worldmusichub-complete-score";
pub const PROFILE: &str = "wmh-vsq-clean-v1";
pub const MAX_SOURCE_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_SCORE_BYTES: usize = 64 * 1024 * 1024;

/// Only conversion verifies source evidence against the original bytes.
/// An imported hash is an evidence claim, not authentication.
pub fn convert_vsq(bytes: &[u8], title: &str) -> Result<VsqCompleteScore, String> {
    let project = crate::vsq::decode_vsq(bytes)?;
    let dispatch = crate::vsq_engine::normalize_engine_dispatch(&project)?;
    from_decoded(&project, dispatch, bytes.len(), title)
}
fn from_decoded(
    project: &crate::vsq::VsqProject,
    engine_dispatch: crate::vsq_engine::EngineDispatch,
    source_bytes: usize,
    title: &str,
) -> Result<VsqCompleteScore, String> {
    let authoring = AuthoringProject::from(project);
    let score = VsqCompleteScore {
        format: FORMAT.into(),
        version: 1,
        profile: PROFILE.into(),
        source: SourceEvidence {
            format: "vsq".into(),
            bytes: source_bytes,
            sha256: project.source_sha256.clone(),
        },
        notation: project.canonical_score(title)?,
        coverage: Coverage::calculate(&authoring, &engine_dispatch),
        authoring,
        engine_dispatch,
        capabilities: Capabilities::required(),
        interpretation_limits: CLEAN_LIMITS.to_vec(),
    };
    validate(&score)?;
    Ok(score)
}
/// Metadata for the bounded two-file converter. Optional media is empty.
/// Exact bytes must describe this validated score.
pub fn package_metadata(
    score: &VsqCompleteScore,
    score_bytes: &[u8],
) -> Result<PackageMetadata, String> {
    use sha2::{Digest, Sha256};
    let decoded = decode_json(score_bytes)?;
    if serde_json::to_value(&decoded).map_err(|e| e.to_string())?
        != serde_json::to_value(score).map_err(|e| e.to_string())?
    {
        return Err("VSQ package bytes do not describe the supplied complete score".into());
    }
    Ok(PackageMetadata {
        format: "worldmusichub-song".into(),
        version: 2,
        id: score.notation.id.clone(),
        title: score.notation.title.clone(),
        score: PackageScore {
            path: "score.json".into(),
            bytes: score_bytes.len(),
            sha256: format!("{:x}", Sha256::digest(score_bytes)),
        },
        sources: vec![score.source.clone()],
        rights: PackageRights {
            status: "user_supplied_unverified".into(),
            attribution:
                "User-supplied VSQ; source rights and voicebank availability are unverified".into(),
            license: None,
        },
        media: [],
    })
}
