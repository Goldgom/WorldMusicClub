//! Complete, immutable v2 song folders. Only verified relative media descriptors
//! become internal paths; renderer input supplies entry-bound opaque handles.
use super::{
    check_node, checked_score, create_directory_tree, digest, fail, io_error, read_bounded,
    sync_directory, write_new, Entry, Inventory, Issue, LibraryError, LoadedScore, NativeLibrary,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

type Result<T> = std::result::Result<T, LibraryError>;
pub const MAX_JSON_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_METADATA_BYTES: usize = 256 * 1024;
pub const MAX_PACKAGE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_STORAGE_BYTES: u64 = 3 * 1024 * 1024 * 1024;
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
// One bounded source across all libraries, never a directory/metadata verdict.
// Locks only protect Arc replacement; no cache guard spans storage access.
static NOTATION_SOURCE: Mutex<Option<Arc<ParsedBasicSource>>> = Mutex::new(None);

#[derive(Debug)]
pub(crate) struct ParsedBasicSource {
    json: Vec<u8>,
    pub validated: score_core::basic_keys::ValidatedSource,
}
impl ParsedBasicSource {
    fn decode(json: &[u8]) -> Result<Arc<Self>> {
        #[cfg(test)]
        tests::record_basic_decode();
        let validated =
            score_core::basic_keys::ValidatedSource::decode_json(json).map_err(invalid)?;
        Ok(Arc::new(Self {
            json: json.to_vec(),
            validated,
        }))
    }
}
fn invalid(message: impl Into<String>) -> LibraryError {
    fail(422, "clean_package_invalid", message)
}
fn valid_hash(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Rights {
    pub status: String,
    pub attribution: String,
    pub license: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FileDescriptor {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SourceEvidence {
    pub format: String,
    pub bytes: usize,
    pub sha256: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Media {
    pub id: String,
    pub role: String,
    pub path: String,
    pub mime: String,
    pub bytes: u64,
    pub sha256: String,
    pub rights: Rights,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parts: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offset_ms: Option<i64>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Metadata {
    pub format: String,
    pub version: u32,
    pub id: String,
    pub title: String,
    pub score: FileDescriptor,
    pub sources: Vec<SourceEvidence>,
    pub rights: Rights,
    pub media: Vec<Media>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Asset {
    pub id: String,
    pub role: String,
    pub mime: String,
    pub bytes: u64,
    pub sha256: String,
    pub handle: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parts: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offset_ms: Option<i64>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Summary {
    pub version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub interpretation_limits: Vec<score_core::vsq_clean::CleanInterpretationLimit>,
    pub content_sha256: String,
    pub bytes: u64,
    pub media: Vec<Asset>,
    pub coverage: Value,
    pub notation_available: bool,
}
#[derive(Clone, Debug, Serialize)]
pub struct OpenPackage {
    pub version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub interpretation_limits: Vec<score_core::vsq_clean::CleanInterpretationLimit>,
    pub content_sha256: String,
    pub metadata_json: String,
    pub score_json: String,
    pub media: Vec<Asset>,
    pub runtime: Value,
    pub coverage: Value,
    pub notation_available: bool,
}
#[derive(Clone, Debug)]
pub struct Package {
    pub profile: Option<String>,
    pub capabilities: Option<Value>,
    pub interpretation_limits: Vec<score_core::vsq_clean::CleanInterpretationLimit>,
    pub metadata_json: String,
    pub score_json: String,
    pub notation_json: Option<String>,
    pub metadata: Metadata,
    pub identity: String,
    pub bytes: u64,
    pub runtime: Value,
    pub coverage: Value,
    catalog_fields: (String, score_core::Provenance),
    basic_source: Option<Arc<ParsedBasicSource>>,
}
impl Package {
    /// Index the actual authoritative payload when no notation exists. Never
    /// construct a placeholder Score merely to pass canonical-score consumers.
    pub(crate) fn index_json(&self) -> &str {
        self.notation_json.as_deref().unwrap_or(&self.score_json)
    }
    /// The basic-key wire already contains the complete canonical projection.
    /// Avoid sending it a second time, so large sources fit the existing bound.
    fn legacy_notation_json(&self) -> Option<&str> {
        if self.profile.as_deref() == Some(score_core::basic_keys::PROFILE) {
            None
        } else {
            self.notation_json.as_deref()
        }
    }
    pub(crate) fn catalog_fields(&self) -> Result<(String, score_core::Provenance)> {
        // These fields came from this operation's validated typed profile, not
        // another decode/compile of its serialized notation or a disk cache.
        Ok(self.catalog_fields.clone())
    }
    pub fn summary(&self) -> Summary {
        Summary {
            version: 2,
            profile: self.profile.clone(),
            capabilities: self.capabilities.clone(),
            interpretation_limits: self.interpretation_limits.clone(),
            content_sha256: self.identity.clone(),
            bytes: self.bytes,
            media: self
                .metadata
                .media
                .iter()
                .map(|m| Asset {
                    id: m.id.clone(),
                    role: m.role.clone(),
                    mime: m.mime.clone(),
                    bytes: m.bytes,
                    sha256: m.sha256.clone(),
                    handle: format!(
                        "asset-{}",
                        digest(format!("{}\0{}\0{}", self.identity, m.id, m.sha256).as_bytes())
                    ),
                    parts: m.parts.clone(),
                    offset_ms: m.offset_ms,
                })
                .collect(),
            coverage: self.coverage.clone(),
            notation_available: self.notation_json.is_some(),
        }
    }
    fn opened(&self) -> OpenPackage {
        OpenPackage {
            version: 2,
            profile: self.profile.clone(),
            capabilities: self.capabilities.clone(),
            interpretation_limits: self.interpretation_limits.clone(),
            content_sha256: self.identity.clone(),
            metadata_json: self.metadata_json.clone(),
            score_json: self.score_json.clone(),
            media: self.summary().media,
            runtime: self.runtime.clone(),
            coverage: self.coverage.clone(),
            notation_available: self.notation_json.is_some(),
        }
    }
}
fn rights(rights: &Rights) -> Result<()> {
    if !matches!(
        rights.status.as_str(),
        "user_supplied_unverified" | "original_authored" | "licensed" | "public_domain"
    ) || rights.attribution.len() > 4096
        || rights
            .attribution
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\t'))
        || rights
            .license
            .as_ref()
            .is_some_and(|s| s.len() > 2048 || s.chars().any(char::is_control))
    {
        return Err(invalid(
            "Invalid rights evidence; it is never a license grant",
        ));
    }
    Ok(())
}
/// Portable storage names, also safe on case-insensitive Windows filesystems.
pub fn safe_path(path: &str) -> Result<()> {
    if path.is_empty()
        || path.len() > 512
        || !path.is_ascii()
        || path.split('/').count() > 8
        || path.split('/').any(|segment| {
            let stem = segment.split('.').next().unwrap_or("").to_ascii_lowercase();
            segment.is_empty()
                || segment.starts_with('.')
                || segment.ends_with('.')
                || segment.ends_with(' ')
                || !segment
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
                || matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
                || (stem.len() == 4
                    && (stem.starts_with("com") || stem.starts_with("lpt"))
                    && matches!(stem.as_bytes()[3], b'1'..=b'9'))
        })
    {
        return Err(invalid(
            "Clean package paths require safe portable non-hidden relative segments",
        ));
    }
    Ok(())
}
const MAX_OPEN_RESPONSE_BYTES: usize = 31 * 1024 * 1024;

#[derive(Clone, Copy, PartialEq, Eq)]
enum ReadMode {
    Full,
    // Basic-key metadata uses a proved response-size bound. Other profiles keep
    // their existing runtime admission checks (including semantic MIDI's 24h
    // limit) until those checks have a separate validation-only core API.
    Catalog,
    // This alone may defer unrelated media hashes. Never use it for a catalog.
    Asset,
}

#[derive(Default)]
struct JsonByteCount(usize);
impl Write for JsonByteCount {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0 = self.0.saturating_add(bytes.len());
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn json_bytes(value: &impl Serialize) -> Result<usize> {
    let mut count = JsonByteCount::default();
    serde_json::to_writer(&mut count, value).map_err(|e| invalid(e.to_string()))?;
    Ok(count.0)
}
fn basic_runtime(score: &score_core::basic_keys::CompleteBasicKeys) -> Result<Value> {
    #[cfg(test)]
    tests::record_runtime_compilation();
    serde_json::to_value(practice_server::basic_keys_api::compile(score).map_err(invalid)?)
        .map_err(|e| invalid(e.to_string()))
}

/// A one-sided proof for the basic-key runtime wire. It includes every decoded
/// attack's target and rendition evidence, exact escaped identifiers, the full
/// part inventory, and room for every release to be unmatched. Each JSON f64
/// uses fewer than 64 bytes. 8192 covers compilation/timeline envelopes, clocks,
/// the fixed diagnostic and maximal decimal coverage counters. Tests
/// compare the bound with the actual compiler, including extreme numbers and
/// escaped identifiers. Failure to prove room always invokes the real compiler;
/// this is never an estimated size used to reject or admit a borderline song.
fn basic_runtime_upper_bound(score: &score_core::basic_keys::CompleteBasicKeys) -> Result<usize> {
    let base = json_bytes(&practice_server::basic_keys_api::Runtime {
        profile: practice_server::basic_keys_api::RUNTIME_PROFILE,
        source_sha256: score.source.sha256.clone(),
        compilation: None,
        rendition: Some(score_core::basic_keys::RenditionEvidence {
            policy_id: score_core::basic_keys::RENDITION_POLICY,
            source_sha256: score.source.sha256.clone(),
            source_clock_available: false,
            source_duration_ms: 0.0,
            duration_ms: 0.0,
            policy: score_core::basic_keys::RenditionPolicy::default(),
            coverage: score_core::basic_keys::RenditionCoverage::default(),
            note_columns: score_core::basic_keys::RENDITION_NOTE_COLUMNS,
            notes: vec![],
            unmatched_releases: vec![],
        }),
        parts: score_core::basic_keys::part_inventory(score),
        reference_audio: "basic_synthesized",
        source_rendition: "unresolved",
    })?;
    let envelope = basic_note_envelope_bytes()?;
    let evidence_envelope = basic_rendition_note_envelope_bytes()?;
    let mut bytes = base
        .saturating_add(8192)
        .saturating_add(score.coverage.key_releases.saturating_mul(64));
    for note in &score.performance.notes {
        bytes = bytes.saturating_add(basic_note_upper_bound(
            envelope,
            &note.note_id,
            &note.part_id,
        )?);
        bytes = bytes
            .saturating_add(evidence_envelope)
            .saturating_add(json_bytes(&note.note_id)?.saturating_sub(2))
            .saturating_add(1); // Array comma.
    }
    Ok(bytes)
}
fn basic_rendition_note_envelope_bytes() -> Result<usize> {
    use score_core::basic_keys::*;
    let at = Coordinate {
        track: u16::MAX,
        event: u32::MAX,
    };
    let time = ExactMicroseconds {
        numerator: u64::MAX.to_string(),
        denominator: u16::MAX,
    };
    json_bytes(&RenditionNote {
        note_id: String::new(),
        attack: at,
        release: Some(at),
        route: usize::MAX,
        channel: u8::MAX,
        role: RenditionRole::PercussionSelector,
        start: time.clone(),
        end: time,
        source_end_tick: Some(u64::MAX),
        receiver_end_tick: u64::MAX,
        source_release_status: ReleaseStatus::UnresolvedRouteOwnership,
        end_reason: RenditionEndReason::SourceEndCleanup,
        synthetic_gate: false,
    })
}
fn basic_note_envelope_bytes() -> Result<usize> {
    json_bytes(&score_core::TimedNote {
        velocity: u8::MAX,
        id: String::new(),
        source_note_id: String::new(),
        source_note_ids: vec![String::new()],
        part_id: String::new(),
        midi: u8::MAX,
        start_ms: 0.0,
        duration_ms: 0.0,
        voice: "1".into(),
        staff: 1,
    })
}
fn basic_note_upper_bound(envelope: usize, note_id: &str, part_id: &str) -> Result<usize> {
    Ok(envelope
        .saturating_add(2 * 64 + 1)
        .saturating_add(json_bytes(&note_id)?.saturating_sub(2).saturating_mul(3))
        .saturating_add(json_bytes(&part_id)?.saturating_sub(2)))
}

/// Count the existing native wire directly from references. Serializing an
/// owned OpenPackage/Value duplicates large score strings and runtime arrays.
fn open_response_bytes(package: &Package) -> Result<usize> {
    #[derive(Serialize)]
    struct Open<'a> {
        version: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        profile: &'a Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        capabilities: &'a Option<Value>,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        interpretation_limits: &'a Vec<score_core::vsq_clean::CleanInterpretationLimit>,
        content_sha256: &'a str,
        metadata_json: &'a str,
        score_json: &'a str,
        media: Vec<Asset>,
        runtime: &'a Value,
        coverage: &'a Value,
        notation_available: bool,
    }
    #[derive(Serialize)]
    struct Response<'a> {
        score_json: Option<&'a str>,
        clean_package: Open<'a>,
    }
    json_bytes(&Response {
        score_json: package.legacy_notation_json(),
        clean_package: Open {
            version: 2,
            profile: &package.profile,
            capabilities: &package.capabilities,
            interpretation_limits: &package.interpretation_limits,
            content_sha256: &package.identity,
            metadata_json: &package.metadata_json,
            score_json: &package.score_json,
            media: package.summary().media,
            runtime: &package.runtime,
            coverage: &package.coverage,
            notation_available: package.notation_json.is_some(),
        },
    })
}

/// Validate JSON and inventory first; assets are independently checked while
/// streaming from the ZIP or complete native folder, never retained in a plan.
pub fn parse(
    metadata_bytes: &[u8],
    score_bytes: &[u8],
    files: &BTreeMap<String, (u64, String)>,
) -> Result<Package> {
    parse_inner(metadata_bytes, score_bytes, files, ReadMode::Full)
}
fn parse_inner(
    metadata_bytes: &[u8],
    score_bytes: &[u8],
    files: &BTreeMap<String, (u64, String)>,
    mode: ReadMode,
) -> Result<Package> {
    parse_reusing_source(metadata_bytes, score_bytes, files, mode, None)
}
fn parse_reusing_source(
    metadata_bytes: &[u8],
    score_bytes: &[u8],
    files: &BTreeMap<String, (u64, String)>,
    mode: ReadMode,
    reuse: Option<&Arc<ParsedBasicSource>>,
) -> Result<Package> {
    if metadata_bytes.len() > MAX_METADATA_BYTES || score_bytes.len() > MAX_JSON_BYTES {
        return Err(invalid("Clean package JSON exceeds its bounded limit"));
    }
    let metadata: Metadata = serde_json::from_slice(metadata_bytes)
        .map_err(|e| invalid(format!("Invalid clean metadata: {e}")))?;
    // Dispatch before interpreting any coverage, channel or authoring fields.
    // This small header is not validation; the selected closed Rust decoder is.
    #[derive(Deserialize)]
    struct Header {
        format: String,
        version: u32,
        profile: Option<String>,
        performance: Option<PerformanceHeader>,
    }
    #[derive(Deserialize)]
    struct PerformanceHeader {
        profile: String,
    }
    let header: Header = serde_json::from_slice(score_bytes)
        .map_err(|e| invalid(format!("Invalid complete-score header: {e}")))?;
    if header.format != "worldmusichub-complete-score" {
        return Err(invalid("Unsupported complete-score format"));
    }
    #[cfg(test)]
    tests::record_profile_validation();
    let mut deferred_basic = None;
    let mut runtime_upper_bound = None;
    let (
        id,
        title,
        notation,
        part_ids,
        source,
        coverage,
        runtime,
        profile,
        capabilities,
        interpretation_limits,
    ) = match (
        header.version,
        header.profile.as_deref(),
        header.performance.as_ref().map(|p| p.profile.as_str()),
    ) {
        (1, Some(score_core::vsq_clean::PROFILE), None) => {
            let score = score_core::vsq_clean::decode_json(score_bytes).map_err(invalid)?;
            (
                score.notation.id.clone(),
                score.notation.title.clone(),
                Some(score.notation.clone()),
                score
                    .notation
                    .parts
                    .iter()
                    .map(|p| p.id.clone())
                    .collect::<BTreeSet<_>>(),
                SourceEvidence {
                    format: score.source.format,
                    bytes: score.source.bytes,
                    sha256: score.source.sha256,
                },
                serde_json::to_value(score.coverage).map_err(|e| invalid(e.to_string()))?,
                Value::Null,
                Some(score.profile),
                Some(serde_json::to_value(score.capabilities).map_err(|e| invalid(e.to_string()))?),
                score.interpretation_limits,
            )
        }
        (1, None, Some(score_core::basic_keys::PROFILE)) => {
            let decoded;
            let score = if mode == ReadMode::Catalog {
                // Exact bytes, not a digest, path, timestamp or length hint.
                deferred_basic = Some(match reuse.filter(|old| old.json == score_bytes) {
                    Some(old) => Arc::clone(old),
                    None => ParsedBasicSource::decode(score_bytes)?,
                });
                deferred_basic.as_ref().unwrap().validated.source()
            } else {
                decoded = score_core::basic_keys::decode_json(score_bytes).map_err(invalid)?;
                &decoded
            };
            let runtime = if mode == ReadMode::Full {
                basic_runtime(score)?
            } else {
                if mode == ReadMode::Catalog {
                    runtime_upper_bound = Some(basic_runtime_upper_bound(score)?);
                }
                Value::Null
            };
            let fields = (
                score.notation.id.clone(),
                score.notation.title.clone(),
                Some(score.notation.clone()),
                score
                    .notation
                    .parts
                    .iter()
                    .map(|p| p.id.clone())
                    .collect::<BTreeSet<_>>(),
                SourceEvidence {
                    format: score.source.format.clone(),
                    bytes: score.source.bytes,
                    sha256: score.source.sha256.clone(),
                },
                serde_json::to_value(&score.coverage).map_err(|e| invalid(e.to_string()))?,
                runtime,
                Some(score_core::basic_keys::PROFILE.to_owned()),
                Some(
                    serde_json::to_value(&score.capabilities)
                        .map_err(|e| invalid(e.to_string()))?,
                ),
                vec![],
            );
            fields
        }
        (1, None, Some("wmh-semantic-midi1-v1")) => {
            let score = score_core::clean_song::decode_json(score_bytes).map_err(invalid)?;
            let runtime = if mode != ReadMode::Asset {
                #[cfg(test)]
                tests::record_runtime_compilation();
                serde_json::to_value(
                    score_core::clean_song::compile_complete(&score).map_err(invalid)?,
                )
                .map_err(|e| invalid(e.to_string()))?
            } else {
                Value::Null
            };
            (
                score.notation.id.clone(),
                score.notation.title.clone(),
                Some(score.notation.clone()),
                score
                    .notation
                    .parts
                    .iter()
                    .map(|p| p.id.clone())
                    .collect::<BTreeSet<_>>(),
                SourceEvidence {
                    format: score.source.format,
                    bytes: score.source.bytes,
                    sha256: score.source.sha256,
                },
                serde_json::to_value(score.coverage).map_err(|e| invalid(e.to_string()))?,
                runtime,
                None,
                None,
                vec![],
            )
        }
        (2, None, Some(score_core::clean_performance::PROFILE)) => {
            let score = score_core::clean_performance::decode_json(score_bytes).map_err(invalid)?;
            let runtime = if mode != ReadMode::Asset {
                #[cfg(test)]
                tests::record_runtime_compilation();
                serde_json::to_value(
                    score_core::clean_performance::compile_performance(score_bytes)
                        .map_err(invalid)?,
                )
                .map_err(|e| invalid(e.to_string()))?
            } else {
                Value::Null
            };
            (
                score.id,
                score.title,
                None,
                score
                    .performance
                    .parts
                    .iter()
                    .map(|p| p.id.clone())
                    .collect::<BTreeSet<_>>(),
                SourceEvidence {
                    format: score.source.format,
                    bytes: score.source.bytes,
                    sha256: score.source.sha256,
                },
                serde_json::to_value(score.coverage).map_err(|e| invalid(e.to_string()))?,
                runtime,
                Some(score_core::clean_performance::PROFILE.to_string()),
                None,
                vec![],
            )
        }
        _ => {
            return Err(invalid(
                "Unsupported complete-score version/profile combination",
            ))
        }
    };
    if metadata.format != "worldmusichub-song"
        || metadata.version != 2
        || metadata.id != id
        || metadata.title != title
        || metadata.score.path != "score.json"
        || metadata.score.bytes != score_bytes.len() as u64
        || metadata.score.sha256 != digest(score_bytes)
        || metadata.sources.len() != 1
        || metadata.sources[0].format != source.format
        || metadata.sources[0].bytes != source.bytes
        || metadata.sources[0].sha256 != source.sha256
    {
        return Err(invalid(
            "Metadata must exactly describe the complete score and source evidence",
        ));
    }
    rights(&metadata.rights)?;
    if metadata.media.len() > 32 {
        return Err(invalid(
            "A clean song allows at most 32 declared media assets",
        ));
    }
    let mut paths = BTreeSet::from(["metadata.json".to_string(), "score.json".to_string()]);
    let mut ids = BTreeSet::new();
    let mut singleton_roles = BTreeSet::new();
    for media in &metadata.media {
        safe_path(&media.path)?;
        if !media.path.starts_with("media/")
            || !paths.insert(media.path.to_ascii_lowercase())
            || media.id.is_empty()
            || media.id.len() > 128
            || !media
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
            || !ids.insert(&media.id)
            || !valid_hash(&media.sha256)
            || media.bytes == 0
        {
            return Err(invalid(
                "Invalid, duplicate or ambiguous media identity/path",
            ));
        }
        rights(&media.rights)?;
        let image = matches!(media.role.as_str(), "cover" | "background");
        let timed = matches!(media.role.as_str(), "pv" | "full_mix" | "stem");
        if (!image && !timed)
            || (media.role != "stem" && !singleton_roles.insert(&media.role))
            || (image && (media.offset_ms.is_some() || media.parts.is_some()))
            || (timed && media.offset_ms.is_none())
            || media
                .offset_ms
                .is_some_and(|n| !(-86_400_000..=86_400_000).contains(&n))
            || (media.role != "stem" && media.parts.is_some())
        {
            return Err(invalid("Invalid media role, clock offset or part binding"));
        }
        if media.role == "stem" {
            let selected = media
                .parts
                .as_ref()
                .ok_or_else(|| invalid("A stem must identify its performance parts"))?;
            let unique: BTreeSet<_> = selected.iter().collect();
            if selected.is_empty()
                || unique.len() != selected.len()
                || selected.iter().any(|p| !part_ids.contains(p.as_str()))
            {
                return Err(invalid("Stem refers to invalid or repeated parts"));
            }
        }
        let limit = if image {
            16 * 1024 * 1024
        } else {
            64 * 1024 * 1024
        };
        if media.bytes > limit
            || (image && !media.mime.starts_with("image/"))
            || (media.role == "pv" && !media.mime.starts_with("video/"))
            || (matches!(media.role.as_str(), "full_mix" | "stem")
                && !media.mime.starts_with("audio/"))
        {
            return Err(invalid(
                "Media type or per-file size does not match its role",
            ));
        }
        if files.get(&media.path) != Some(&(media.bytes, media.sha256.clone())) {
            return Err(invalid(format!(
                "Declared media is missing or has a size/hash mismatch: {}",
                media.path
            )));
        }
    }
    if files.len() != paths.len()
        || files
            .keys()
            .any(|p| !paths.contains(&p.to_ascii_lowercase()))
        || files.get("metadata.json")
            != Some(&(metadata_bytes.len() as u64, digest(metadata_bytes)))
        || files.get("score.json") != Some(&(score_bytes.len() as u64, digest(score_bytes)))
    {
        return Err(invalid(
            "Clean song inventory must contain exactly both JSONs and the declared runtime media",
        ));
    }
    let directories: BTreeSet<_> = metadata
        .media
        .iter()
        .flat_map(|media| {
            media
                .path
                .match_indices('/')
                .map(|(at, _)| media.path[..at].to_owned())
        })
        .collect();
    if directories.len() > 64 {
        return Err(invalid("Clean media uses too many directory segments"));
    }
    let bytes = files
        .values()
        .try_fold(0u64, |sum, (size, _)| sum.checked_add(*size))
        .ok_or_else(|| invalid("Package size overflow"))?;
    if bytes > MAX_PACKAGE_BYTES {
        return Err(invalid("Complete clean song exceeds 128 MiB"));
    }
    let notation_json = notation
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| invalid(e.to_string()))?;
    if profile.as_deref() != Some(score_core::basic_keys::PROFILE) {
        if let Some(raw) = &notation_json {
            checked_score(raw)?;
        }
    }
    let catalog_fields = notation.as_ref().map_or_else(
        || {
            (
                String::new(),
                score_core::Provenance {
                    kind: "user_supplied".into(),
                    attribution: metadata.rights.attribution.clone(),
                    source_url: None,
                    license: metadata.rights.license.clone(),
                },
            )
        },
        |score| (score.composer.clone(), score.provenance.clone()),
    );
    // Metadata whitespace is not identity; exact score and every asset digest are.
    let identity = digest(&serde_json::to_vec(&metadata).map_err(|e| invalid(e.to_string()))?);
    let mut package = Package {
        profile,
        capabilities,
        interpretation_limits,
        metadata_json: String::from_utf8(metadata_bytes.to_vec())
            .map_err(|_| invalid("Metadata must be UTF-8"))?,
        score_json: String::from_utf8(score_bytes.to_vec())
            .map_err(|_| invalid("Complete score must be UTF-8"))?,
        notation_json,
        metadata,
        identity,
        bytes,
        runtime,
        coverage,
        catalog_fields,
        basic_source: deferred_basic,
    };
    let mut response_bytes = open_response_bytes(&package)?;
    if let Some(upper_bound) = runtime_upper_bound {
        // Replacing the four-byte null runtime with this proved upper bound
        // cannot admit an oversized response. Near the boundary, use the exact
        // existing compiler and size check, preserving its acceptance/errors.
        if response_bytes.saturating_sub(4).saturating_add(upper_bound) > MAX_OPEN_RESPONSE_BYTES {
            package.runtime =
                basic_runtime(package.basic_source.as_ref().unwrap().validated.source())?;
            response_bytes = open_response_bytes(&package)?;
        }
    }
    #[cfg(test)]
    tests::record_response_bytes(response_bytes);
    if response_bytes > MAX_OPEN_RESPONSE_BYTES {
        return Err(invalid(
            "Clean song exceeds the bounded native open response",
        ));
    }
    Ok(package)
}

pub fn verify_media(media: &Media, bytes: &[u8]) -> Result<()> {
    if bytes.len() as u64 != media.bytes || digest(bytes) != media.sha256 {
        return Err(invalid(format!(
            "Runtime media size/hash mismatch: {}",
            media.id
        )));
    }
    let ext = media
        .path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let riff = |kind: &[u8]| {
        bytes.len() >= 16
            && bytes.starts_with(b"RIFF")
            && bytes.get(8..12) == Some(kind)
            && u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize + 8 == bytes.len()
    };
    let valid = match (media.mime.as_str(), ext.as_str()) {
        ("image/png", "png") => {
            bytes.len() >= 33
                && bytes.starts_with(b"\x89PNG\r\n\x1a\n")
                && bytes.get(8..16) == Some(b"\0\0\0\rIHDR")
        }
        ("image/jpeg", "jpg" | "jpeg") => {
            bytes.len() >= 4 && bytes.starts_with(b"\xff\xd8\xff") && bytes.ends_with(b"\xff\xd9")
        }
        ("image/webp", "webp") => {
            riff(b"WEBP") && matches!(bytes.get(12..16), Some(b"VP8 " | b"VP8L" | b"VP8X"))
        }
        ("video/mp4", "mp4") => {
            bytes.len() >= 16 && bytes.get(4..8) == Some(b"ftyp") && {
                let len = u32::from_be_bytes(bytes[..4].try_into().unwrap()) as usize;
                len >= 16 && len <= bytes.len()
            }
        }
        ("video/webm", "webm") => {
            bytes.starts_with(b"\x1a\x45\xdf\xa3")
                && bytes[..bytes.len().min(128)]
                    .windows(4)
                    .any(|w| w == b"webm")
        }
        ("audio/wav", "wav") => {
            riff(b"WAVE")
                && bytes.windows(4).any(|w| w == b"fmt ")
                && bytes.windows(4).any(|w| w == b"data")
        }
        ("audio/ogg", "ogg") => {
            bytes.len() >= 27
                && bytes.starts_with(b"OggS\0")
                && bytes[..bytes.len().min(512)]
                    .windows(8)
                    .any(|w| w == b"OpusHead" || w.starts_with(b"\x01vorbis"))
        }
        ("audio/mpeg", "mp3") => mp3_magic(bytes),
        _ => false,
    };
    if !valid {
        return Err(invalid(format!(
            "Runtime media MIME, extension and container signature disagree: {}",
            media.id
        )));
    }
    Ok(())
}
fn mp3_magic(bytes: &[u8]) -> bool {
    let mut offset = 0;
    if bytes.starts_with(b"ID3") {
        if bytes.len() < 10 || bytes[6..10].iter().any(|b| b & 0x80 != 0) {
            return false;
        }
        offset = 10
            + bytes[6..10]
                .iter()
                .fold(0usize, |n, b| (n << 7) | *b as usize);
    }
    bytes.get(offset..offset + 4).is_some_and(|h| {
        h[0] == 0xff
            && h[1] & 0xe0 == 0xe0
            && h[1] & 0x18 != 0x08
            && h[1] & 0x06 != 0
            && h[2] & 0xf0 != 0xf0
            && h[2] & 0x0c != 0x0c
    })
}

fn areas(library: &NativeLibrary) -> Result<()> {
    for area in ["clean-songs", "clean-backups", ".clean-staging"] {
        create_directory_tree(&library.root.join(area))?;
    }
    Ok(())
}
fn children(folder: &Path, limit: usize) -> Result<Vec<PathBuf>> {
    check_node(folder, true)?;
    let mut out = Vec::new();
    for item in fs::read_dir(folder).map_err(io_error)? {
        if out.len() >= limit {
            return Err(invalid("Clean package directory exceeds its bound"));
        }
        out.push(item.map_err(io_error)?.path());
    }
    out.sort();
    Ok(out)
}
fn folder_inventory(
    folder: &Path,
    deferred_media: Option<&[Media]>,
) -> Result<BTreeMap<String, (u64, String)>> {
    let mut out = BTreeMap::new();
    let mut pending = vec![(folder.to_path_buf(), String::new())];
    let mut nodes = 0;
    let mut directories = Vec::new();
    while let Some((directory, prefix)) = pending.pop() {
        for path in children(&directory, 128)? {
            nodes += 1;
            if nodes > 128 {
                return Err(invalid("Clean folder contains too many nodes"));
            }
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or_else(|| invalid("Invalid clean filename"))?;
            let relative = format!("{prefix}{name}");
            safe_path(&relative)?;
            let meta = fs::symlink_metadata(&path).map_err(io_error)?;
            if meta.is_dir() {
                check_node(&path, true)?;
                if relative != "media" && !relative.starts_with("media/") {
                    return Err(invalid("Undeclared package directory"));
                }
                directories.push(relative.clone());
                pending.push((path, format!("{relative}/")));
            } else if let Some(media) =
                deferred_media.and_then(|media| media.iter().find(|m| m.path == relative))
            {
                // Asset requests validate the two JSONs, full inventory, ordinary
                // file types and all sizes, then hash only the asset being used.
                // Catalog/source/open/export hash every declared asset independently.
                check_node(&path, false)?;
                out.insert(relative, (meta.len(), media.sha256.clone()));
            } else {
                let bytes = read_bounded(&path, 64 * 1024 * 1024)?;
                out.insert(relative, (bytes.len() as u64, digest(&bytes)));
            }
        }
    }
    if directories
        .iter()
        .any(|d| !out.keys().any(|p| p.starts_with(&format!("{d}/"))))
    {
        return Err(invalid("Empty or undeclared clean package directory"));
    }
    Ok(out)
}
fn read_package(
    folder: &Path,
    mode: ReadMode,
    reuse: Option<&Arc<ParsedBasicSource>>,
) -> Result<Package> {
    check_node(folder, true)?;
    let metadata = read_bounded(&folder.join("metadata.json"), MAX_METADATA_BYTES)?;
    let score = read_bounded(&folder.join("score.json"), MAX_JSON_BYTES)?;
    let descriptor: Metadata =
        serde_json::from_slice(&metadata).map_err(|e| invalid(e.to_string()))?;
    let deferred = (mode == ReadMode::Asset).then_some(descriptor.media.as_slice());
    let package = parse_reusing_source(
        &metadata,
        &score,
        &folder_inventory(folder, deferred)?,
        mode,
        reuse,
    )?;
    if mode != ReadMode::Asset {
        for media in &package.metadata.media {
            verify_media(media, &read_media(folder, media)?)?;
        }
    }
    Ok(package)
}
fn read_media(folder: &Path, media: &Media) -> Result<Vec<u8>> {
    safe_path(&media.path)?;
    let mut current = folder.to_path_buf();
    let pieces: Vec<_> = media.path.split('/').collect();
    for piece in &pieces[..pieces.len() - 1] {
        current.push(piece);
        check_node(&current, true)?;
    }
    read_bounded(&folder.join(&media.path), 64 * 1024 * 1024)
}
fn load_folder(folder: &Path, key: &str) -> Result<(Entry, Package)> {
    load_folder_mode(folder, key, ReadMode::Full)
}
fn load_folder_mode(folder: &Path, key: &str, mode: ReadMode) -> Result<(Entry, Package)> {
    load_folder_reusing_source(folder, key, mode, None)
}
fn load_folder_reusing_source(
    folder: &Path,
    key: &str,
    mode: ReadMode,
    reuse: Option<&Arc<ParsedBasicSource>>,
) -> Result<(Entry, Package)> {
    #[cfg(test)]
    tests::record_validation(folder);
    check_node(folder, true)?;
    let entry: Entry = serde_json::from_slice(&read_bounded(
        &folder.join("entry.json"),
        MAX_METADATA_BYTES,
    )?)
    .map_err(|e| invalid(e.to_string()))?;
    let package = read_package(&folder.join("package"), mode, reuse)?;
    let (composer, provenance) = package.catalog_fields()?;
    if entry.library_format_version != 2
        || entry.revision != 1
        || entry.key != key
        || key != format!("song-{}", package.identity)
        || entry.content_sha256 != package.identity
        || entry.score_bytes != package.index_json().len()
        || entry.score_sha256 != digest(package.index_json().as_bytes())
        || entry.score_id != package.metadata.id
        || entry.title != package.metadata.title
        || entry.composer != composer
        || entry.label.is_empty()
        || entry.label.len() > 1024
        || entry.retained_source.is_some()
        || entry.clean_package.as_ref() != Some(&package.summary())
        || serde_json::to_value(&entry.provenance).ok() != serde_json::to_value(&provenance).ok()
    {
        return Err(invalid(
            "Clean library entry does not describe its complete package",
        ));
    }
    Ok((entry, package))
}
fn stage(
    library: &NativeLibrary,
    entry: &Entry,
    package: &Package,
    reader: &mut impl FnMut(&Media) -> Result<Vec<u8>>,
) -> Result<PathBuf> {
    let mut staged = None;
    for _ in 0..32 {
        let path = library.root.join(".clean-staging").join(format!(
            "{}-{}-{}",
            entry.key,
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        match fs::create_dir(&path) {
            Ok(()) => {
                staged = Some(path);
                break;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
            Err(e) => return Err(io_error(e)),
        }
    }
    let staged = staged.ok_or_else(|| invalid("Cannot allocate a clean package stage"))?;
    let folder = staged.join("package");
    fs::create_dir(&folder).map_err(io_error)?;
    write_new(&folder.join("score.json"), package.score_json.as_bytes())?;
    let mut directories = BTreeSet::new();
    for media in &package.metadata.media {
        let path = folder.join(&media.path);
        let parent = path
            .parent()
            .ok_or_else(|| invalid("Missing media parent"))?;
        create_directory_tree(parent)?;
        let mut current = parent;
        while current != folder {
            directories.insert(current.to_path_buf());
            current = current
                .parent()
                .ok_or_else(|| invalid("Invalid staged media ancestry"))?;
        }
        let bytes = reader(media)?;
        verify_media(media, &bytes)?;
        write_new(&path, &bytes)?;
    }
    for directory in directories.iter().rev() {
        sync_directory(directory)?;
    }
    write_new(
        &folder.join("metadata.json"),
        package.metadata_json.as_bytes(),
    )?;
    sync_directory(&folder)?;
    write_new(
        &staged.join("entry.json"),
        &serde_json::to_vec(entry).map_err(|e| invalid(e.to_string()))?,
    )?;
    sync_directory(&staged)?;
    Ok(staged)
}
fn publish(library: &NativeLibrary, stage: &Path, area: &str, key: &str) -> Result<()> {
    let destination = library.root.join(area).join(key);
    match fs::symlink_metadata(&destination) {
        Ok(_) => {
            return Err(fail(
                409,
                "library_path_conflict",
                "Existing clean package was preserved without overwrite",
            ))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
        Err(e) => return Err(io_error(e)),
    }
    fs::rename(stage, &destination).map_err(io_error)?;
    sync_directory(&library.root.join(area))
}
fn storage_usage(library: &NativeLibrary) -> Result<u64> {
    let mut total = 0u64;
    let mut pending = vec![
        library.root.join("clean-songs"),
        library.root.join("clean-backups"),
        library.root.join(".clean-staging"),
    ];
    let mut nodes = 0;
    while let Some(folder) = pending.pop() {
        for path in children(&folder, 4096)? {
            nodes += 1;
            if nodes > 150_000 {
                return Err(invalid("Clean storage inventory exceeds its bound"));
            }
            let metadata = fs::symlink_metadata(&path).map_err(io_error)?;
            if metadata.is_dir() {
                check_node(&path, true)?;
                pending.push(path);
            } else {
                check_node(&path, false)?;
                total = total
                    .checked_add(metadata.len())
                    .ok_or_else(|| invalid("Clean storage size overflow"))?;
            }
        }
    }
    Ok(total)
}
fn room_for(library: &NativeLibrary, bytes: u64) -> Result<()> {
    if storage_usage(library)?
        .checked_add(bytes)
        .is_none_or(|n| n > MAX_STORAGE_BYTES)
    {
        return Err(fail(413,"library_capacity","Complete packages, backups and interrupted stages exceed the 3 GiB clean storage limit; existing files were preserved"));
    }
    Ok(())
}

/// One import transaction holds the existing process/OS lock and reuses only
/// this transaction's freshly verified index. No persistent cache can hide edits.
pub struct Batch<'a> {
    library: &'a NativeLibrary,
    _lock: Option<super::LibraryLock<'a>>,
    inventory: Inventory,
    reserved_bytes: u64,
    inventory_dirty: bool,
}
impl<'a> Batch<'a> {
    pub fn begin(library: &'a NativeLibrary) -> Result<Self> {
        let lock = library.lock()?;
        crate::catalog_product::load_managed_locked(library)?;
        let mut batch = Self::begin_locked(library)?;
        batch._lock = Some(lock);
        Ok(batch)
    }
    /// The importer holds the native lock across source retention, every song
    /// save and the final receipt, and checks the managed catalog before entry.
    pub(crate) fn begin_locked(library: &'a NativeLibrary) -> Result<Self> {
        areas(library)?;
        let inventory = library.scan()?;
        let reserved_bytes = storage_usage(library)?;
        Ok(Self {
            library,
            _lock: None,
            inventory,
            reserved_bytes,
            inventory_dirty: false,
        })
    }
    pub fn entries(&self) -> &[Entry] {
        &self.inventory.entries
    }
    pub(crate) fn save_legacy(&mut self, request: super::SaveRequest) -> Result<Entry> {
        // A failed publication can still leave a recoverable backup. The next
        // clean admission must refresh physical quota/dedupe even on an error.
        self.inventory_dirty = true;
        self.library.save_locked(request)
    }
    pub fn save(
        &mut self,
        package: &Package,
        label: Option<String>,
        keep_both: bool,
        mut reader: impl FnMut(&Media) -> Result<Vec<u8>>,
    ) -> Result<Entry> {
        if self.inventory_dirty {
            self.inventory = self.library.scan()?;
            self.reserved_bytes = storage_usage(self.library)?;
            self.inventory_dirty = false;
        }
        save_checked(
            self.library,
            &mut self.inventory,
            &mut self.reserved_bytes,
            package,
            label,
            keep_both,
            &mut reader,
            || Ok(()),
        )
    }
}

pub fn save(
    library: &NativeLibrary,
    package: &Package,
    label: Option<String>,
    keep_both: bool,
    mut reader: impl FnMut(&Media) -> Result<Vec<u8>>,
) -> Result<Entry> {
    save_with_boundary(library, package, label, keep_both, &mut reader, || Ok(()))
}
fn save_with_boundary(
    library: &NativeLibrary,
    package: &Package,
    label: Option<String>,
    keep_both: bool,
    reader: &mut impl FnMut(&Media) -> Result<Vec<u8>>,
    after_backup: impl FnOnce() -> Result<()>,
) -> Result<Entry> {
    let mut batch = Batch::begin(library)?;
    save_checked(
        library,
        &mut batch.inventory,
        &mut batch.reserved_bytes,
        package,
        label,
        keep_both,
        reader,
        after_backup,
    )
}
#[allow(clippy::too_many_arguments)]
fn save_checked(
    library: &NativeLibrary,
    inventory: &mut Inventory,
    reserved_bytes: &mut u64,
    package: &Package,
    label: Option<String>,
    keep_both: bool,
    reader: &mut impl FnMut(&Media) -> Result<Vec<u8>>,
    after_backup: impl FnOnce() -> Result<()>,
) -> Result<Entry> {
    let key = format!("song-{}", package.identity);
    if let Some(existing) = inventory.entries.iter().find(|e| e.key == key) {
        let mut error = fail(
            409,
            "library_duplicate",
            "This complete clean package is already saved",
        );
        error.existing = Some(Box::new(existing.clone()));
        return Err(error);
    }
    let (composer, provenance) = package.catalog_fields()?;
    if !keep_both {
        if let Some(existing) = inventory
            .entries
            .iter()
            .find(|e| e.score_id == package.metadata.id)
        {
            let mut error=fail(409,"library_id_conflict","A different edition has this score ID; explicitly keep both to preserve both packages");
            error.existing = Some(Box::new(existing.clone()));
            return Err(error);
        }
    }
    let label = label.unwrap_or_else(|| package.metadata.title.clone());
    if label.trim().is_empty() || label.len() > 1024 {
        return Err(invalid("Invalid clean song label"));
    }
    if inventory.entries.len() >= super::MAX_ENTRIES
        || inventory
            .entries
            .iter()
            .map(|e| e.score_bytes)
            .sum::<usize>()
            + package.index_json().len()
            > super::MAX_LIBRARY_BYTES
    {
        return Err(fail(
            413,
            "library_capacity",
            "Clean save would exceed the native library capacity",
        ));
    }
    let reserve = 2 * (package.bytes + MAX_METADATA_BYTES as u64);
    if reserved_bytes
        .checked_add(reserve)
        .is_none_or(|n| n > MAX_STORAGE_BYTES)
    {
        return Err(fail(
            413,
            "library_capacity",
            "Clean import exceeds 3 GiB including backups and interrupted stages",
        ));
    }
    *reserved_bytes += reserve;
    for area in ["songs", "backups", "clean-songs", "clean-backups"] {
        if fs::symlink_metadata(library.root.join(area).join(&key)).is_ok() {
            return Err(fail(
                409,
                "library_path_conflict",
                "Existing archive occupies this key and was preserved",
            ));
        }
    }
    let entry = Entry {
        library_format_version: 2,
        revision: 1,
        key: key.clone(),
        content_sha256: package.identity.clone(),
        score_sha256: digest(package.index_json().as_bytes()),
        score_bytes: package.index_json().len(),
        score_id: package.metadata.id.clone(),
        title: package.metadata.title.clone(),
        composer,
        label,
        saved_at_unix_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| invalid(e.to_string()))?
            .as_millis()
            .try_into()
            .map_err(|_| invalid("Clock overflow"))?,
        provenance,
        retained_source: None,
        clean_package: Some(package.summary()),
    };
    let primary = stage(library, &entry, package, reader)?;
    let backup = stage(library, &entry, package, reader)?;
    // A complete independent backup publishes first. Any later failure is
    // uncertain and recoverable on refresh; retry never overwrites either copy.
    publish(library, &backup, "clean-backups", &key).map_err(|e| {
        if fs::symlink_metadata(library.root.join("clean-backups").join(&key)).is_ok() {
            fail(
                500,
                "library_commit_uncertain",
                format!(
                    "Clean backup may be published; refresh to verify/recover: {}",
                    e.error
                ),
            )
        } else {
            e
        }
    })?;
    after_backup()
        .and_then(|()| publish(library, &primary, "clean-songs", &key))
        .map_err(|e| {
            fail(
                500,
                "library_commit_uncertain",
                format!(
                    "Complete clean backup exists; refresh to recover or confirm this package: {}",
                    e.error
                ),
            )
        })?;
    inventory.entries.push(entry.clone());
    Ok(entry)
}

pub(super) fn scan(library: &NativeLibrary, inventory: &mut Inventory) -> Result<()> {
    areas(library)?;
    // Keep only verified catalog entries for this locked scan. Full packages,
    // runtime values and media bytes are dropped after validating each primary.
    let mut primaries = BTreeMap::new();
    for folder in children(&library.root.join("clean-songs"), 4096)? {
        let key = folder.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if !super::valid_key(key) {
            inventory.issues.push(Issue {
                key: None,
                code: "library_unrecognized_clean_entry".into(),
                message: "Unrecognized clean package folder preserved and excluded".into(),
            });
            continue;
        }
        match load_folder_mode(&folder, key, ReadMode::Catalog) {
            Ok((entry, _)) => {
                primaries.insert(key.to_owned(), entry);
            }
            Err(error) => inventory.issues.push(Issue {
                key: Some(key.into()),
                code: error.code.into(),
                message: error.error,
            }),
        }
    }
    let mut unpaired_backups = Vec::new();
    for folder in children(&library.root.join("clean-backups"), 4096)? {
        let key = folder.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if !super::valid_key(key) {
            inventory.issues.push(Issue {
                key: None,
                code: "library_unrecognized_clean_entry".into(),
                message: "Unrecognized clean package folder preserved and excluded".into(),
            });
            continue;
        }
        if let Some(primary) = primaries.get(key) {
            // One complete backup validation supplies both the primary-pair
            // check and backup diagnostics. Every independent scan rereads and
            // hashes every file; no path/mtime or cross-operation cache is used.
            match load_folder_mode(&folder, key, ReadMode::Catalog) {
                Ok((backup, _))
                    if serde_json::to_value(primary).ok() == serde_json::to_value(&backup).ok() =>
                {
                    inventory.entries.push(primaries.remove(key).unwrap());
                }
                Err(error) => inventory.issues.push(Issue {
                    key: Some(key.into()),
                    code: "library_backup_invalid".into(),
                    message: error.error,
                }),
                _ => (),
            }
        } else {
            unpaired_backups.push(folder);
        }
    }
    for key in primaries.into_keys() {
        inventory.issues.push(Issue {
            key: Some(key),
            code: "library_clean_backup_missing".into(),
            message:
                "Complete clean backup is missing or invalid; primary was preserved and excluded"
                    .into(),
        });
    }
    // Admit all verified existing pairs before recovery, just as before, so
    // orphan backups cannot consume space reserved for existing primary songs.
    // Retain only paths here; recovery validates each package when it is used.
    for folder in unpaired_backups {
        let key = folder.file_name().and_then(|s| s.to_str()).unwrap_or("");
        match load_folder_mode(&folder, key, ReadMode::Catalog) {
            Err(error) => inventory.issues.push(Issue {
                key: Some(key.into()),
                code: "library_backup_invalid".into(),
                message: error.error,
            }),
            Ok((entry, package)) => {
                if matches!(fs::symlink_metadata(library.root.join("clean-songs").join(key)),Err(e) if e.kind()==std::io::ErrorKind::NotFound)
                {
                    let recovery = (|| {
                        if inventory.entries.len() >= super::MAX_ENTRIES
                            || inventory
                                .entries
                                .iter()
                                .map(|e| e.score_bytes)
                                .sum::<usize>()
                                + entry.score_bytes
                                > super::MAX_LIBRARY_BYTES
                        {
                            return Err(fail(
                                413,
                                "library_capacity",
                                "Recovery would exceed native library capacity",
                            ));
                        }
                        room_for(library, package.bytes + MAX_METADATA_BYTES as u64)?;
                        let staged = stage(library, &entry, &package, &mut |media| {
                            read_media(&folder.join("package"), media)
                        })?;
                        publish(library, &staged, "clean-songs", key)
                    })();
                    match recovery {
                        Ok(()) => {
                            inventory.entries.push(entry);
                            inventory.issues.push(Issue{key:Some(key.into()),code:"library_recovered_backup".into(),message:"Recovered the complete clean package and all runtime assets from verified backup".into()});
                        }
                        Err(e) => inventory.issues.push(Issue {
                            key: Some(key.into()),
                            code: "library_recovery_failed".into(),
                            message: e.error,
                        }),
                    }
                }
            }
        }
    }
    let stages = children(&library.root.join(".clean-staging"), 4096)?;
    if !stages.is_empty() {
        inventory.issues.push(Issue {
            key: None,
            code: "library_incomplete_clean_stages".into(),
            message: format!(
                "{} interrupted clean package stages were preserved and excluded",
                stages.len()
            ),
        });
    }
    Ok(())
}
/// Source for key-bound inspection APIs. Every call rereads both copies and
/// rechecks all storage/admission evidence. Only immutable semantics of exact
/// matching score bytes can survive an operation, in one bounded cache slot.
pub(crate) struct SourcePackage {
    pub profile: Option<String>,
    pub content_sha256: String,
    pub basic_source: Option<Arc<ParsedBasicSource>>,
}
pub(crate) fn load_source(library: &NativeLibrary, key: &str) -> Result<Option<SourcePackage>> {
    load_source_with_cache(library, key, &NOTATION_SOURCE)
}
fn load_source_with_cache(
    library: &NativeLibrary,
    key: &str,
    cache: &Mutex<Option<Arc<ParsedBasicSource>>>,
) -> Result<Option<SourcePackage>> {
    if !super::valid_key(key) {
        return Err(fail(
            400,
            "library_invalid_key",
            "A library key must be song- followed by 64 lowercase hexadecimal digits",
        ));
    }
    let _lock = library.lock()?;
    crate::catalog_product::require_active_locked(library, &format!("clean:{key}"))?;
    // Snapshot after queueing on the existing library gate: a preceding cold
    // request may have published this exact source while we were waiting.
    let reuse = cache.lock().ok().and_then(|cache| cache.clone());
    let loaded = load_pair_reusing_source(library, key, ReadMode::Catalog, reuse.as_ref())?;
    if let Some((_, package)) = &loaded {
        // Publish only after both independent copies and entries passed. Cache
        // poisoning is a miss, not permission to bypass a storage check.
        if let Ok(mut cache) = cache.lock() {
            *cache = package.basic_source.clone();
        }
    }
    Ok(loaded.map(|(_, package)| SourcePackage {
        profile: package.profile,
        content_sha256: package.identity,
        basic_source: package.basic_source,
    }))
}
fn load_pair(
    library: &NativeLibrary,
    key: &str,
    mode: ReadMode,
) -> Result<Option<(Entry, Package)>> {
    load_pair_reusing_source(library, key, mode, None)
}
fn load_pair_reusing_source(
    library: &NativeLibrary,
    key: &str,
    mode: ReadMode,
    reuse: Option<&Arc<ParsedBasicSource>>,
) -> Result<Option<(Entry, Package)>> {
    areas(library)?;
    let folder = library.root.join("clean-songs").join(key);
    match fs::symlink_metadata(&folder) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(io_error(e)),
        Ok(_) => (),
    }
    let (entry, package) = load_folder_reusing_source(&folder, key, mode, reuse)?;
    let (backup, _) = load_folder_reusing_source(
        &library.root.join("clean-backups").join(key),
        key,
        mode,
        package.basic_source.as_ref(),
    )?;
    if serde_json::to_value(&entry).ok() != serde_json::to_value(&backup).ok() {
        return Err(invalid(
            "Clean primary and independent backup metadata disagree",
        ));
    }
    Ok(Some((entry, package)))
}
pub(super) fn load(library: &NativeLibrary, key: &str) -> Result<Option<LoadedScore>> {
    Ok(
        load_pair(library, key, ReadMode::Full)?.map(|(entry, package)| LoadedScore {
            entry,
            score_json: package.legacy_notation_json().map(str::to_owned),
            clean_package: Some(package.opened()),
        }),
    )
}
/// Caller holds the native lock; each existing copy is fully reverified.
pub(super) fn verified_retained_payload_bytes(
    library: &NativeLibrary,
    entry: &Entry,
) -> Result<u64> {
    let expected = serde_json::to_value(entry).map_err(|e| invalid(e.to_string()))?;
    let mut total = 0u64;
    for area in ["clean-songs", "clean-backups"] {
        let folder = library.root.join(area).join(&entry.key);
        match fs::symlink_metadata(&folder) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(io_error(error)),
            Ok(_) => (),
        }
        let (stored, package) = load_folder(&folder, &entry.key)?;
        if serde_json::to_value(stored).map_err(|e| invalid(e.to_string()))? != expected {
            return Err(invalid(
                "Retained clean copies disagree with the verified edition",
            ));
        }
        // package.bytes includes metadata.json; only the exact semantic score
        // and declared, fully verified runtime media are retained payloads.
        total = total
            .checked_add(package.metadata.score.bytes)
            .ok_or_else(|| invalid("Retained clean payload size overflow"))?;
        for media in package.metadata.media {
            total = total
                .checked_add(media.bytes)
                .ok_or_else(|| invalid("Retained clean payload size overflow"))?;
        }
    }
    if total == 0 {
        return Err(invalid(
            "No verified retained clean payload remains for this edition",
        ));
    }
    Ok(total)
}
pub fn export_files(library: &NativeLibrary, key: &str) -> Result<BTreeMap<String, Vec<u8>>> {
    if !super::valid_key(key) {
        return Err(invalid("Invalid clean library key"));
    }
    let _lock = library.lock()?;
    areas(library)?;
    let folder = library.root.join("clean-songs").join(key);
    let (_, package) = load_folder(&folder, key)?;
    let mut files = BTreeMap::from([
        ("metadata.json".into(), package.metadata_json.into_bytes()),
        ("score.json".into(), package.score_json.into_bytes()),
    ]);
    for media in &package.metadata.media {
        let bytes = read_media(&folder.join("package"), media)?;
        verify_media(media, &bytes)?;
        files.insert(media.path.clone(), bytes);
    }
    Ok(files)
}
pub fn asset(library: &NativeLibrary, key: &str, handle: &str) -> Result<(String, Vec<u8>)> {
    if !super::valid_key(key) || !handle.starts_with("asset-") || !valid_hash(&handle[6..]) {
        return Err(invalid("Invalid entry-bound asset request"));
    }
    let _lock = library.lock()?;
    areas(library)?;
    let folder = library.root.join("clean-songs").join(key);
    let (_, package) = load_folder_mode(&folder, key, ReadMode::Asset)?;
    let assets = package.summary().media;
    let index = assets
        .iter()
        .position(|a| a.handle == handle)
        .ok_or_else(|| {
            fail(
                404,
                "library_asset_not_found",
                "Asset handle does not belong to this song",
            )
        })?;
    let media = &package.metadata.media[index];
    let bytes = read_media(&folder.join("package"), media)?;
    verify_media(media, &bytes)?;
    Ok((media.mime.clone(), bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    thread_local! {
        static VALIDATIONS: RefCell<Option<Vec<PathBuf>>> = const { RefCell::new(None) };
        static PROFILE_VALIDATIONS: RefCell<usize> = const { RefCell::new(0) };
        static RUNTIME_COMPILATIONS: RefCell<usize> = const { RefCell::new(0) };
        static LAST_RESPONSE_BYTES: RefCell<usize> = const { RefCell::new(0) };
        static BASIC_DECODES: RefCell<usize> = const { RefCell::new(0) };
    }
    pub(super) fn record_basic_decode() {
        BASIC_DECODES.with_borrow_mut(|count| *count += 1);
    }
    pub(super) fn record_profile_validation() {
        PROFILE_VALIDATIONS.with_borrow_mut(|count| *count += 1);
    }
    pub(super) fn record_runtime_compilation() {
        RUNTIME_COMPILATIONS.with_borrow_mut(|count| *count += 1);
    }
    pub(super) fn record_response_bytes(bytes: usize) {
        LAST_RESPONSE_BYTES.with_borrow_mut(|count| *count = bytes);
    }
    fn reset_work_counts() {
        PROFILE_VALIDATIONS.with_borrow_mut(|count| *count = 0);
        RUNTIME_COMPILATIONS.with_borrow_mut(|count| *count = 0);
    }
    fn work_counts() -> (usize, usize) {
        (
            PROFILE_VALIDATIONS.with_borrow(|count| *count),
            RUNTIME_COMPILATIONS.with_borrow(|count| *count),
        )
    }
    pub(super) fn record_validation(folder: &Path) {
        VALIDATIONS.with_borrow_mut(|trace| {
            if let Some(paths) = trace {
                paths.push(folder.to_path_buf());
            }
        });
    }
    struct ValidationTrace;
    impl ValidationTrace {
        fn start() -> Self {
            VALIDATIONS.with_borrow_mut(|trace| {
                assert!(trace.replace(Vec::new()).is_none());
            });
            Self
        }
        fn finish(self) -> Vec<PathBuf> {
            VALIDATIONS.with_borrow_mut(|trace| trace.take().unwrap())
        }
    }
    impl Drop for ValidationTrace {
        fn drop(&mut self) {
            VALIDATIONS.with_borrow_mut(|trace| *trace = None);
        }
    }
    struct SyntheticLibrary {
        root: PathBuf,
        library: NativeLibrary,
        entries: Vec<Entry>,
        files: Vec<BTreeMap<String, Vec<u8>>>,
    }
    impl SyntheticLibrary {
        fn new(count: usize) -> Self {
            Self::with_profile(count, false)
        }
        fn basic(count: usize) -> Self {
            Self::with_profile(count, true)
        }
        fn with_profile(count: usize, basic: bool) -> Self {
            let root = std::env::temp_dir().join(format!(
                "wmh-clean-scan-{}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            let library = NativeLibrary::open(root.join("Scores")).unwrap();
            let mut entries = Vec::new();
            let mut all_files = Vec::new();
            {
                let mut batch = Batch::begin(&library).unwrap();
                for index in 0..count {
                    // The existing score fixture is an original authored exercise.
                    // Its editions and this silent PCM sample are synthetic only.
                    let (metadata_bytes, score_bytes): (&[u8], &[u8]) = if basic {
                        (
                            include_bytes!(
                                "../../../tests/fixtures/basic-key-acceptance/metadata.json"
                            ),
                            include_bytes!(
                                "../../../tests/fixtures/basic-key-acceptance/score.json"
                            ),
                        )
                    } else {
                        (
                            include_bytes!("../../../tests/fixtures/clean-song-v2/metadata.json"),
                            include_bytes!("../../../tests/fixtures/clean-song-v2/score.json"),
                        )
                    };
                    let mut metadata: Value = serde_json::from_slice(metadata_bytes).unwrap();
                    let mut score: Value = serde_json::from_slice(score_bytes).unwrap();
                    let id = format!("original-scan-exercise-{index}");
                    if basic {
                        metadata["title"] = id.clone().into();
                        score["notation"]["title"] = id.into();
                    } else {
                        metadata["id"] = id.clone().into();
                        score["notation"]["id"] = id.into();
                    }
                    let score = serde_json::to_vec_pretty(&score).unwrap();
                    metadata["score"]["bytes"] = score.len().into();
                    metadata["score"]["sha256"] = digest(&score).into();
                    let mut wav = b"RIFF".to_vec();
                    wav.extend(38u32.to_le_bytes());
                    wav.extend(b"WAVEfmt ");
                    wav.extend(16u32.to_le_bytes());
                    wav.extend(1u16.to_le_bytes());
                    wav.extend(1u16.to_le_bytes());
                    wav.extend(8000u32.to_le_bytes());
                    wav.extend(16000u32.to_le_bytes());
                    wav.extend(2u16.to_le_bytes());
                    wav.extend(16u16.to_le_bytes());
                    wav.extend(b"data");
                    wav.extend(2u32.to_le_bytes());
                    wav.extend(0i16.to_le_bytes());
                    metadata["media"] = serde_json::json!([{
                        "id": "silence", "role": "full_mix", "path": "media/silence.wav",
                        "mime": "audio/wav", "bytes": wav.len(), "sha256": digest(&wav), "offset_ms": 0,
                        "rights": {"status": "original_authored", "attribution": "Original test silence", "license": "CC0-1.0"}
                    }]);
                    let files: BTreeMap<String, Vec<u8>> = BTreeMap::from([
                        (
                            "metadata.json".into(),
                            serde_json::to_vec_pretty(&metadata).unwrap(),
                        ),
                        ("score.json".into(), score),
                        ("media/silence.wav".into(), wav),
                    ]);
                    let hashes = files
                        .iter()
                        .map(|(name, bytes)| (name.clone(), (bytes.len() as u64, digest(bytes))))
                        .collect();
                    let package =
                        parse(&files["metadata.json"], &files["score.json"], &hashes).unwrap();
                    entries.push(
                        batch
                            .save(
                                &package,
                                None,
                                basic,
                                |media| Ok(files[&media.path].clone()),
                            )
                            .unwrap(),
                    );
                    all_files.push(files);
                }
            }
            Self {
                root,
                library,
                entries,
                files: all_files,
            }
        }
        fn folder(&self, area: &str, index: usize) -> PathBuf {
            self.library.root.join(area).join(&self.entries[index].key)
        }
        fn assert_exact_files(&self, index: usize) {
            for area in ["clean-songs", "clean-backups"] {
                for (path, original) in &self.files[index] {
                    let actual =
                        fs::read(self.folder(area, index).join("package").join(path)).unwrap();
                    assert_eq!(&actual, original);
                    assert_eq!(digest(&actual), digest(original));
                }
            }
        }
    }
    impl Drop for SyntheticLibrary {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.root).unwrap();
        }
    }

    #[test]
    fn retained_clean_payload_count_excludes_metadata_and_rejects_changed_media() {
        let fixture = SyntheticLibrary::new(1);
        let sentinel = fixture.root.join("ORIGINAL-outside-sentinel");
        fs::write(&sentinel, b"ORIGINAL outside sentinel").unwrap();
        let expected_one = fixture.files[0]["score.json"].len() as u64
            + fixture.files[0]["media/silence.wav"].len() as u64;
        let _lock = fixture.library.lock().unwrap();
        assert_eq!(
            verified_retained_payload_bytes(&fixture.library, &fixture.entries[0]).unwrap(),
            expected_one * 2
        );
        let media = fixture
            .folder("clean-backups", 0)
            .join("package/media/silence.wav");
        let original = fs::read(&media).unwrap();
        fs::write(&media, b"ORIGINAL changed test media").unwrap();
        assert!(verified_retained_payload_bytes(&fixture.library, &fixture.entries[0]).is_err());
        fs::write(&media, original).unwrap();
        fixture.assert_exact_files(0);
        assert_eq!(fs::read(sentinel).unwrap(), b"ORIGINAL outside sentinel");
    }

    #[test]
    fn basic_catalog_preserves_exact_response_admission_near_and_over_limit() {
        // Original mechanical one-key events, not a song or third-party source.
        let mut track = Vec::new();
        for _ in 0..60_000 {
            track.extend([0, 0x90, 60, 90, 1, 0x80, 60, 0]);
        }
        track.extend([0, 255, 47, 0]);
        let mut midi = b"MThd\0\0\0\x06\0\0\0\x01\0\x60MTrk".to_vec();
        midi.extend((track.len() as u32).to_be_bytes());
        midi.extend(track);
        let score = score_core::basic_keys::convert_midi(&midi, "Original response-bound exercise")
            .unwrap();
        let mut score = score_core::basic_keys::encode_json(&score).unwrap();
        assert!(score.len() < MAX_JSON_BYTES);
        let mut metadata: Metadata = serde_json::from_slice(include_bytes!(
            "../../../tests/fixtures/basic-key-acceptance/metadata.json"
        ))
        .unwrap();
        let decoded: Value = serde_json::from_slice(&score).unwrap();
        metadata.id = decoded["notation"]["id"].as_str().unwrap().into();
        metadata.title = decoded["notation"]["title"].as_str().unwrap().into();
        metadata.sources = vec![SourceEvidence {
            format: "midi".into(),
            bytes: midi.len(),
            sha256: digest(&midi),
        }];
        let mut outcomes = Vec::new();
        let unpadded_len = score.len();
        for padding in [None, Some(b' '), Some(b'\t')] {
            score.truncate(unpadded_len);
            if let Some(byte) = padding {
                // Escaped valid JSON whitespace exercises the native string
                // envelope's real boundary after compact runtime transport.
                score.resize(MAX_JSON_BYTES, byte);
            }
            metadata.score.bytes = score.len() as u64;
            metadata.score.sha256 = digest(&score);
            let metadata = serde_json::to_vec(&metadata).unwrap();
            let files = BTreeMap::from([
                (
                    "metadata.json".into(),
                    (metadata.len() as u64, digest(&metadata)),
                ),
                ("score.json".into(), (score.len() as u64, digest(&score))),
            ]);
            reset_work_counts();
            let full = parse_inner(&metadata, &score, &files, ReadMode::Full);
            let full_bytes = LAST_RESPONSE_BYTES.with_borrow(|bytes| *bytes);
            let catalog = parse_inner(&metadata, &score, &files, ReadMode::Catalog);
            assert_eq!(full_bytes, LAST_RESPONSE_BYTES.with_borrow(|bytes| *bytes));
            eprintln!("Basic response boundary: source={} bytes, native={full_bytes} bytes, padding={padding:?}", score.len());
            assert_eq!(
                work_counts(),
                (2, 2),
                "borderline catalog must fall back to exact compiler"
            );
            match (full, catalog) {
                (Ok(full), Ok(catalog)) => {
                    assert_eq!(full.summary(), catalog.summary());
                    assert_eq!(
                        open_response_bytes(&full).unwrap(),
                        open_response_bytes(&catalog).unwrap()
                    );
                    outcomes.push(true);
                }
                (Err(full), Err(catalog)) => {
                    assert_eq!(full.code, catalog.code);
                    assert_eq!(
                        full.error,
                        "Clean song exceeds the bounded native open response"
                    );
                    assert_eq!(catalog.error, full.error);
                    outcomes.push(false);
                }
                _ => panic!("catalog and full response admission diverged"),
            }
        }
        assert_eq!(outcomes, [true, true, false]);
    }

    #[test]
    fn runtime_size_proof_covers_escaped_identifiers_and_extreme_json_numbers() {
        for id in ["", "midi-t128-e250000", "\"\\\n\u{0000}中文"] {
            for number in [0.0, -0.0, f64::MAX, f64::MIN, f64::MIN_POSITIVE, 5e-324] {
                let note = score_core::TimedNote {
                    velocity: u8::MAX,
                    id: id.into(),
                    source_note_id: id.into(),
                    source_note_ids: vec![id.into()],
                    part_id: id.into(),
                    midi: u8::MAX,
                    start_ms: number,
                    duration_ms: number,
                    voice: "1".into(),
                    staff: 1,
                };
                assert!(
                    json_bytes(&note).unwrap()
                        < basic_note_upper_bound(basic_note_envelope_bytes().unwrap(), id, id)
                            .unwrap()
                );
            }
        }
        let fixture = SyntheticLibrary::basic(1);
        let (_, package) =
            load_folder(&fixture.folder("clean-songs", 0), &fixture.entries[0].key).unwrap();
        let runtime = &package.runtime;
        let mut envelope = runtime.clone();
        envelope["compilation"]["timeline"]["notes"] = serde_json::json!([]);
        envelope["rendition"]["notes"] = serde_json::json!([]);
        assert!(json_bytes(&runtime["compilation"]["diagnostics"]).unwrap() < 512);
        assert!(json_bytes(&envelope).unwrap() < 8192);
    }

    #[test]
    fn basic_catalog_validates_both_copies_without_compiling_runtime() {
        let fixture = SyntheticLibrary::basic(6);
        for _ in 0..2 {
            reset_work_counts();
            let trace = ValidationTrace::start();
            let inventory = fixture.library.list().unwrap();
            assert_eq!(trace.finish().len(), 12);
            assert_eq!(work_counts(), (12, 0));
            assert!(inventory.issues.is_empty());
            let mut expected = fixture.entries.clone();
            expected.sort_by(|a, b| a.key.cmp(&b.key));
            assert_eq!(
                serde_json::to_value(&inventory.entries).unwrap(),
                serde_json::to_value(expected).unwrap()
            );
        }
        reset_work_counts();
        let batch = Batch::begin(&fixture.library).unwrap();
        assert_eq!(batch.entries().len(), 6);
        assert_eq!(work_counts(), (12, 0));
        drop(batch);
        for entry in &fixture.entries {
            reset_work_counts();
            let source = load_source(&fixture.library, &entry.key).unwrap().unwrap();
            assert_eq!(work_counts(), (2, 0));
            assert_eq!(
                source.profile.as_deref(),
                Some(score_core::basic_keys::PROFILE)
            );
            assert_eq!(source.content_sha256, entry.content_sha256);
            let loaded = fixture
                .library
                .load(&entry.key)
                .unwrap()
                .clean_package
                .unwrap();
            assert_eq!(
                source.basic_source.unwrap().json,
                loaded.score_json.as_bytes()
            );
        }
        for index in 0..6 {
            let folder = fixture.folder("clean-songs", index);
            let (_, catalog) =
                load_folder_mode(&folder, &fixture.entries[index].key, ReadMode::Catalog).unwrap();
            let (_, full) = load_folder(&folder, &fixture.entries[index].key).unwrap();
            assert!(catalog.runtime.is_null());
            assert!(!full.runtime.is_null());
            assert_eq!(catalog.summary(), full.summary());
            assert_eq!(catalog.index_json(), full.index_json());
            assert_eq!(
                serde_json::to_value(catalog.catalog_fields().unwrap()).unwrap(),
                serde_json::to_value(full.catalog_fields().unwrap()).unwrap()
            );
            let existing_response = serde_json::json!({"score_json":full.legacy_notation_json(),"clean_package":full.opened()});
            assert_eq!(
                open_response_bytes(&full).unwrap(),
                serde_json::to_vec(&existing_response).unwrap().len()
            );
            let decoded = score_core::basic_keys::decode_json(full.score_json.as_bytes()).unwrap();
            assert!(
                basic_runtime_upper_bound(&decoded).unwrap() >= json_bytes(&full.runtime).unwrap()
            );
            fixture.assert_exact_files(index);
        }
    }

    #[test]
    fn basic_source_reuses_only_exact_bytes_after_rechecking_both_copies() {
        let fixture = SyntheticLibrary::basic(1);
        let key = &fixture.entries[0].key;
        BASIC_DECODES.with_borrow_mut(|count| *count = 0);
        let trace = ValidationTrace::start();
        let (_, cold) = load_pair_reusing_source(&fixture.library, key, ReadMode::Catalog, None)
            .unwrap()
            .unwrap();
        assert_eq!(trace.finish().len(), 2);
        BASIC_DECODES.with_borrow(|count| assert_eq!(*count, 1));
        let source = cold.basic_source.unwrap();
        let trace = ValidationTrace::start();
        let (_, warm) =
            load_pair_reusing_source(&fixture.library, key, ReadMode::Catalog, Some(&source))
                .unwrap()
                .unwrap();
        assert_eq!(trace.finish().len(), 2);
        BASIC_DECODES.with_borrow(|count| assert_eq!(*count, 1));
        assert!(Arc::ptr_eq(&source, warm.basic_source.as_ref().unwrap()));
        let mut request = score_core::basic_keys::NotationRequest {
            part_id: source.validated.source().performance.parts[0].id.clone(),
            rendition_policy_id: None,
            first_measure: 0,
            measure_count: 1,
            display_meter: Some(score_core::basic_keys::DisplayMeter {
                numerator: 4,
                denominator: 4,
            }),
            position_ms: None,
        };
        for policy in [
            None,
            Some(score_core::basic_keys::RENDITION_POLICY.to_owned()),
        ] {
            request.rendition_policy_id = policy;
            for first_measure in 0..3 {
                request.first_measure = first_measure;
                let expected =
                    score_core::basic_keys::notation_page(source.validated.source(), &request)
                        .unwrap();
                for _ in 0..2 {
                    let actual = source.validated.notation_page(&request).unwrap();
                    assert_eq!(
                        serde_json::to_vec(&actual).unwrap(),
                        serde_json::to_vec(&expected).unwrap()
                    );
                }
            }
        }
        // Another valid source cannot borrow the first source's semantic proof.
        let other = SyntheticLibrary::basic(2);
        let (_, changed) = load_pair_reusing_source(
            &other.library,
            &other.entries[1].key,
            ReadMode::Catalog,
            Some(&source),
        )
        .unwrap()
        .unwrap();
        assert!(!Arc::ptr_eq(
            &source,
            changed.basic_source.as_ref().unwrap()
        ));
        fixture.assert_exact_files(0);
    }

    #[test]
    fn warmed_notation_source_obeys_catalog_trash_and_explicit_restore() {
        let fixture = SyntheticLibrary::basic(1);
        let library = &fixture.library;
        let key = &fixture.entries[0].key;
        let cache = Mutex::new(None);
        let before = load_source_with_cache(library, key, &cache)
            .unwrap()
            .unwrap()
            .basic_source
            .unwrap();
        let call = |suffix: &str, body: Value| {
            let response = crate::catalog_product::dispatch(
                library,
                if suffix == "status" { "GET" } else { "POST" },
                &format!("/api/library/catalog/{suffix}"),
                &serde_json::to_vec(&body).unwrap(),
            );
            let value: Value = serde_json::from_slice(response.body()).unwrap();
            assert_eq!(response.status(), 200, "{value}");
            value
        };
        let commit_body = |value: &Value| serde_json::json!({"library_id":value["library_id"],"preview":value["preview"]});
        let initialize = call("initialize/preview", serde_json::json!({}));
        call("initialize", commit_body(&initialize));
        let plan = |action: &str, trash: Value| {
            let status = call("status", serde_json::json!({}));
            call(
                "preview",
                serde_json::json!({
                    "library_id":status["library_id"], "action":action,
                    "edition_ids":[format!("clean:{key}")], "trash_operation_id":trash,
                    "expected_generation":status["generation"], "catalog_digest":status["catalog_digest"]
                }),
            )
        };
        let trash = plan("trash_songs", Value::Null);
        call("commit", commit_body(&trash));
        // Warm and cold requests both recheck the journal before source reuse.
        for source_cache in [&cache, &Mutex::new(None)] {
            let error = load_source_with_cache(library, key, source_cache)
                .err()
                .unwrap();
            assert_eq!(error.status, 409);
            assert_eq!(error.code, "catalog_in_trash");
        }
        assert!(Arc::ptr_eq(
            &before,
            cache.lock().unwrap().as_ref().unwrap()
        ));
        let restore = plan(
            "restore_songs",
            trash["preview"]["request"]["operation_id"].clone(),
        );
        call("commit", commit_body(&restore));
        let after = load_source_with_cache(library, key, &cache)
            .unwrap()
            .unwrap()
            .basic_source
            .unwrap();
        assert!(Arc::ptr_eq(&before, &after));
        fixture.assert_exact_files(0);
    }

    #[test]
    fn queued_cold_notation_requests_share_one_validated_source() {
        use std::time::{Duration, Instant};
        let fixture = SyntheticLibrary::basic(1);
        let library = &fixture.library;
        let key = &fixture.entries[0].key;
        let cache = &Mutex::new(None);
        let held = library.lock().unwrap();
        std::thread::scope(|scope| {
            let handles: Vec<_> = (0..2)
                .map(|_| {
                    scope.spawn(|| {
                        BASIC_DECODES.with_borrow_mut(|count| *count = 0);
                        let source = load_source_with_cache(library, key, cache)
                            .unwrap()
                            .unwrap()
                            .basic_source
                            .unwrap();
                        (source, BASIC_DECODES.with_borrow(|count| *count))
                    })
                })
                .collect();
            let deadline = Instant::now() + Duration::from_secs(5);
            while library.process_lock.waiting.load(Ordering::SeqCst) != 2
                && Instant::now() < deadline
            {
                std::thread::yield_now();
            }
            let waiting = library.process_lock.waiting.load(Ordering::SeqCst);
            drop(held);
            let results: Vec<_> = handles
                .into_iter()
                .map(|handle| handle.join().unwrap())
                .collect();
            assert_eq!(
                waiting, 2,
                "Both cold requests must reach the held library gate"
            );
            assert_eq!(results.iter().map(|result| result.1).sum::<usize>(), 1);
            assert!(Arc::ptr_eq(&results[0].0, &results[1].0));
        });
        fixture.assert_exact_files(0);
    }

    #[test]
    fn warmed_notation_source_rejects_same_size_same_mtime_changes_to_either_copy() {
        use std::fs::{File, FileTimes};
        let fixture = SyntheticLibrary::basic(1);
        let key = &fixture.entries[0].key;
        let source = load_source(&fixture.library, key)
            .unwrap()
            .unwrap()
            .basic_source
            .unwrap();
        let request = serde_json::json!({
            "source": {"key": key, "content_sha256": fixture.entries[0].content_sha256, "profile": score_core::basic_keys::PROFILE},
            "settings": {"part_id": source.validated.source().performance.parts[0].id,
                "first_measure": 0, "measure_count": 1, "display_meter": {"numerator": 4, "denominator": 4},
                "rendition_policy_id": score_core::basic_keys::RENDITION_POLICY}
        });
        let request = serde_json::to_vec(&request).unwrap();
        let expected = crate::native_basic_keys::notation(&fixture.library, &request).unwrap();
        for area in ["clean-songs", "clean-backups"] {
            for relative in [
                "entry.json",
                "package/metadata.json",
                "package/score.json",
                "package/media/silence.wav",
            ] {
                let path = fixture.folder(area, 0).join(relative);
                let original = fs::read(&path).unwrap();
                let stamp = fs::metadata(&path).unwrap().modified().unwrap();
                let mut changed = original.clone();
                if relative.ends_with(".wav") {
                    *changed.last_mut().unwrap() ^= 1;
                } else {
                    let needle = b"original-scan-exercise-0";
                    let at = changed
                        .windows(needle.len())
                        .position(|w| w == needle)
                        .unwrap();
                    changed[at] = b'O';
                }
                fs::write(&path, &changed).unwrap();
                File::options()
                    .write(true)
                    .open(&path)
                    .unwrap()
                    .set_times(FileTimes::new().set_modified(stamp))
                    .unwrap();
                assert_eq!(fs::metadata(&path).unwrap().len(), original.len() as u64);
                assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), stamp);
                assert!(
                    crate::native_basic_keys::notation(&fixture.library, &request).is_err(),
                    "{area}/{relative}"
                );
                fs::write(&path, &original).unwrap();
                let restored =
                    crate::native_basic_keys::notation(&fixture.library, &request).unwrap();
                assert_eq!(
                    serde_json::to_vec(&restored).unwrap(),
                    serde_json::to_vec(&expected).unwrap()
                );
            }
            let extra = fixture.folder(area, 0).join("package/extra.json");
            fs::write(&extra, b"{}").unwrap();
            assert!(crate::native_basic_keys::notation(&fixture.library, &request).is_err());
            fs::remove_file(extra).unwrap();
        }
        fixture.assert_exact_files(0);
    }

    #[test]
    #[cfg(unix)]
    fn warmed_notation_source_rejects_symlinked_source_files() {
        let fixture = SyntheticLibrary::basic(1);
        let key = &fixture.entries[0].key;
        assert!(load_source(&fixture.library, key).unwrap().is_some());
        for area in ["clean-songs", "clean-backups"] {
            let source = fixture.folder(area, 0).join("package/score.json");
            let held = fixture.root.join("held-score.json");
            fs::rename(&source, &held).unwrap();
            std::os::unix::fs::symlink(&held, &source).unwrap();
            assert!(load_source(&fixture.library, key).is_err());
            fs::remove_file(&source).unwrap();
            fs::rename(&held, &source).unwrap();
            assert!(load_source(&fixture.library, key).unwrap().is_some());
        }
        fixture.assert_exact_files(0);
    }

    #[test]
    fn basic_catalog_rechecks_semantics_hashes_and_orphan_recovery() {
        let fixture = SyntheticLibrary::basic(2);
        let key = &fixture.entries[0].key;
        let backup = fixture.folder("clean-backups", 0);
        let original = fixture.files[0]["media/silence.wav"].clone();
        let mut changed = original.clone();
        *changed.last_mut().unwrap() ^= 1;
        fs::write(backup.join("package/media/silence.wav"), changed).unwrap();
        assert!(load_source(&fixture.library, key).is_err());
        let inventory = fixture.library.list().unwrap();
        assert_eq!(inventory.entries.len(), 1);
        for code in ["library_backup_invalid", "library_clean_backup_missing"] {
            assert!(inventory
                .issues
                .iter()
                .any(|issue| issue.key.as_ref() == Some(key) && issue.code == code));
        }
        fs::write(backup.join("package/media/silence.wav"), original).unwrap();
        assert!(fixture.library.list().unwrap().issues.is_empty());
        assert!(load_source(&fixture.library, key).unwrap().is_some());
        // Rehash a false semantic claim; integrity alone must never admit it.
        let mut score: Value = serde_json::from_slice(&fixture.files[0]["score.json"]).unwrap();
        score["coverage"]["key_attacks"] = 9000.into();
        let score = serde_json::to_vec(&score).unwrap();
        let mut metadata: Value =
            serde_json::from_slice(&fixture.files[0]["metadata.json"]).unwrap();
        metadata["score"]["sha256"] = digest(&score).into();
        metadata["score"]["bytes"] = score.len().into();
        fs::write(backup.join("package/score.json"), score).unwrap();
        fs::write(
            backup.join("package/metadata.json"),
            serde_json::to_vec(&metadata).unwrap(),
        )
        .unwrap();
        assert!(load_source(&fixture.library, key).is_err());
        let inventory = fixture.library.list().unwrap();
        assert_eq!(inventory.entries.len(), 1);
        assert!(inventory
            .issues
            .iter()
            .any(|issue| issue.code == "library_backup_invalid"
                && issue.message.contains("coverage")));
        for (path, bytes) in &fixture.files[0] {
            fs::write(backup.join("package").join(path), bytes).unwrap();
        }
        fs::rename(
            fixture.folder("clean-songs", 0),
            fixture.root.join("held-primary"),
        )
        .unwrap();
        reset_work_counts();
        let recovered = fixture.library.list().unwrap();
        assert_eq!(recovered.entries.len(), 2);
        assert_eq!(work_counts(), (3, 0));
        assert!(recovered
            .issues
            .iter()
            .any(|issue| issue.code == "library_recovered_backup"));
        fixture.assert_exact_files(0);
        assert!(fixture.library.list().unwrap().issues.is_empty());
    }

    #[test]
    fn catalog_preserves_invalid_orphans_unrecognized_folders_and_interrupted_stages() {
        let fixture = SyntheticLibrary::basic(2);
        fs::rename(
            fixture.folder("clean-songs", 0),
            fixture.root.join("held-primary"),
        )
        .unwrap();
        let bad_asset = fixture
            .folder("clean-backups", 0)
            .join("package/media/silence.wav");
        let mut damaged = fixture.files[0]["media/silence.wav"].clone();
        *damaged.last_mut().unwrap() ^= 1;
        fs::write(&bad_asset, &damaged).unwrap();
        fs::rename(
            fixture.folder("clean-backups", 1),
            fixture.root.join("held-backup"),
        )
        .unwrap();
        for area in ["clean-songs", "clean-backups", ".clean-staging"] {
            fs::create_dir(
                fixture
                    .library
                    .root
                    .join(area)
                    .join("unfinished-original-fixture"),
            )
            .unwrap();
        }
        reset_work_counts();
        let inventory = fixture.library.list().unwrap();
        assert!(inventory.entries.is_empty());
        assert_eq!(work_counts(), (2, 0));
        let codes: Vec<_> = inventory
            .issues
            .iter()
            .map(|issue| issue.code.as_str())
            .collect();
        assert_eq!(
            codes
                .iter()
                .filter(|code| **code == "library_unrecognized_clean_entry")
                .count(),
            2
        );
        for code in [
            "library_backup_invalid",
            "library_clean_backup_missing",
            "library_incomplete_clean_stages",
        ] {
            assert!(codes.contains(&code));
        }
        assert!(!codes.contains(&"library_recovered_backup"));
        assert!(!fixture.folder("clean-songs", 0).exists());
        assert_eq!(fs::read(bad_asset).unwrap(), damaged);
        assert!(load_source(&fixture.library, &fixture.entries[0].key)
            .unwrap()
            .is_none());
        assert!(load_source(&fixture.library, &fixture.entries[1].key).is_err());
    }

    #[test]
    fn catalog_recovery_preserves_canonical_byte_quota() {
        let fixture = SyntheticLibrary::basic(2);
        fs::rename(
            fixture.folder("clean-songs", 0),
            fixture.root.join("held-primary"),
        )
        .unwrap();
        let mut previous = fixture.entries[1].clone();
        previous.score_bytes = super::super::MAX_LIBRARY_BYTES;
        let mut inventory = Inventory {
            storage: "native-filesystem",
            library_format_version: 1,
            directory: fixture.library.root.to_string_lossy().into_owned(),
            entries: vec![previous],
            issues: Vec::new(),
        };
        let lock = fixture.library.lock().unwrap();
        scan(&fixture.library, &mut inventory).unwrap();
        drop(lock);
        assert_eq!(inventory.entries.len(), 2);
        assert!(inventory
            .issues
            .iter()
            .any(|issue| issue.code == "library_recovery_failed"
                && issue.message == "Recovery would exceed native library capacity"));
        assert!(!fixture.folder("clean-songs", 0).exists());
    }

    #[test]
    fn scan_validates_each_complete_folder_once_per_independent_operation() {
        let fixture = SyntheticLibrary::new(6);
        let expected: BTreeSet<_> = (0..fixture.entries.len())
            .flat_map(|index| {
                [
                    fixture.folder("clean-songs", index),
                    fixture.folder("clean-backups", index),
                ]
            })
            .collect();
        for _ in 0..2 {
            let trace = ValidationTrace::start();
            let inventory = fixture.library.list().unwrap();
            let paths = trace.finish();
            assert_eq!(inventory.entries.len(), 6);
            assert!(inventory.issues.is_empty());
            assert_eq!(paths.iter().cloned().collect::<BTreeSet<_>>(), expected);
            assert_eq!(
                paths.len(),
                12,
                "6 songs must require exactly 12 full folder validations per scan"
            );
        }
        let trace = ValidationTrace::start();
        let batch = Batch::begin(&fixture.library).unwrap();
        assert_eq!(batch.entries().len(), 6);
        let paths = trace.finish();
        assert_eq!(paths.iter().cloned().collect::<BTreeSet<_>>(), expected);
        assert_eq!(
            paths.len(),
            12,
            "a new transaction must independently revalidate both copies"
        );
        drop(batch);
        for index in 0..6 {
            fixture.assert_exact_files(index);
            let opened = fixture
                .library
                .load(&fixture.entries[index].key)
                .unwrap()
                .clean_package
                .unwrap();
            assert_eq!(
                opened.score_json.as_bytes(),
                fixture.files[index]["score.json"]
            );
            assert_eq!(
                opened.metadata_json.as_bytes(),
                fixture.files[index]["metadata.json"]
            );
        }
    }

    #[test]
    fn scan_rechecks_changed_missing_and_invalid_backups_without_hiding_other_songs() {
        let fixture = SyntheticLibrary::new(6);
        let folder = fixture.folder("clean-backups", 0);
        let key = &fixture.entries[0].key;
        let entry_bytes = fs::read(folder.join("entry.json")).unwrap();
        for change in ["media", "score", "entry", "missing", "undeclared"] {
            match change {
                "media" => {
                    let mut bytes = fixture.files[0]["media/silence.wav"].clone();
                    *bytes.last_mut().unwrap() ^= 1; // Same size, different hash.
                    fs::write(folder.join("package/media/silence.wav"), bytes).unwrap();
                }
                "score" => {
                    let mut bytes = fixture.files[0]["score.json"].clone();
                    let at = bytes.iter().position(|byte| *byte == b' ').unwrap();
                    bytes[at] = b'\t'; // Still valid JSON, same size, different hash.
                    fs::write(folder.join("package/score.json"), bytes).unwrap();
                }
                "entry" => {
                    let mut entry: Entry = serde_json::from_slice(&entry_bytes).unwrap();
                    entry.label = "Different valid backup label".into();
                    fs::write(
                        folder.join("entry.json"),
                        serde_json::to_vec(&entry).unwrap(),
                    )
                    .unwrap();
                }
                "missing" => fs::rename(&folder, fixture.root.join("held-backup")).unwrap(),
                "undeclared" => fs::write(folder.join("package/extra.json"), b"{}").unwrap(),
                _ => unreachable!(),
            }
            let trace = ValidationTrace::start();
            let inventory = fixture.library.list().unwrap();
            let paths = trace.finish();
            assert_eq!(inventory.entries.len(), 5, "{change}");
            assert!(
                !inventory.entries.iter().any(|entry| &entry.key == key),
                "{change}"
            );
            assert!(
                inventory
                    .issues
                    .iter()
                    .any(|issue| issue.key.as_ref() == Some(key)
                        && issue.code == "library_clean_backup_missing"),
                "{change}"
            );
            assert_eq!(
                inventory
                    .issues
                    .iter()
                    .any(|issue| issue.key.as_ref() == Some(key)
                        && issue.code == "library_backup_invalid"),
                matches!(change, "media" | "score" | "undeclared"),
                "{change}"
            );
            assert_eq!(
                paths.iter().filter(|path| **path == folder).count(),
                usize::from(change != "missing")
            );
            let batch = Batch::begin(&fixture.library).unwrap();
            assert_eq!(batch.entries().len(), 5, "{change}");
            assert!(
                !batch.entries().iter().any(|entry| &entry.key == key),
                "{change}"
            );
            drop(batch);
            assert!(fixture.library.load(key).is_err(), "{change}");
            assert!(load_source(&fixture.library, key).is_err(), "{change}");
            match change {
                "missing" => fs::rename(fixture.root.join("held-backup"), &folder).unwrap(),
                "entry" => fs::write(folder.join("entry.json"), &entry_bytes).unwrap(),
                "undeclared" => fs::remove_file(folder.join("package/extra.json")).unwrap(),
                _ => {
                    for (path, bytes) in &fixture.files[0] {
                        fs::write(folder.join("package").join(path), bytes).unwrap();
                    }
                }
            }
            let healthy = fixture.library.list().unwrap();
            assert_eq!(healthy.entries.len(), 6, "{change}");
            assert!(healthy.issues.is_empty(), "{change}");
            fixture.assert_exact_files(0);
        }
        let primary_asset = fixture
            .folder("clean-songs", 0)
            .join("package/media/silence.wav");
        let mut damaged = fixture.files[0]["media/silence.wav"].clone();
        *damaged.last_mut().unwrap() ^= 1;
        fs::write(&primary_asset, &damaged).unwrap();
        assert!(load_source(&fixture.library, key).is_err());
        let inventory = fixture.library.list().unwrap();
        assert_eq!(inventory.entries.len(), 5);
        assert!(inventory
            .issues
            .iter()
            .any(|issue| issue.key.as_ref() == Some(key) && issue.code == "clean_package_invalid"));
        assert!(!inventory
            .issues
            .iter()
            .any(|issue| issue.code == "library_recovered_backup"
                || issue.code == "library_backup_invalid"));
        assert_eq!(
            fs::read(primary_asset).unwrap(),
            damaged,
            "a valid backup must not overwrite a damaged existing primary"
        );
    }

    #[test]
    fn scan_admits_existing_pairs_before_bounded_orphan_recovery() {
        let fixture = SyntheticLibrary::new(2);
        let orphan = usize::from(fixture.entries[1].key < fixture.entries[0].key);
        let paired = 1 - orphan;
        fs::rename(
            fixture.folder("clean-songs", orphan),
            fixture.root.join("held-primary"),
        )
        .unwrap();
        let mut inventory = Inventory {
            storage: "native-filesystem",
            library_format_version: 1,
            directory: fixture.library.root.to_string_lossy().into_owned(),
            entries: vec![fixture.entries[paired].clone(); super::super::MAX_ENTRIES - 1],
            issues: Vec::new(),
        };
        let lock = fixture.library.lock().unwrap();
        let trace = ValidationTrace::start();
        scan(&fixture.library, &mut inventory).unwrap();
        assert_eq!(trace.finish().len(), 3);
        drop(lock);
        assert_eq!(inventory.entries.len(), super::super::MAX_ENTRIES);
        assert!(inventory.issues.iter().any(|issue| issue.key.as_ref()
            == Some(&fixture.entries[orphan].key)
            && issue.code == "library_recovery_failed"
            && issue.message == "Recovery would exceed native library capacity"));
        assert!(!fixture.folder("clean-songs", orphan).exists());
        let recovered = fixture.library.list().unwrap();
        assert_eq!(recovered.entries.len(), 2);
        assert!(recovered
            .issues
            .iter()
            .any(|issue| issue.code == "library_recovered_backup"));
        fixture.assert_exact_files(orphan);
        fixture.assert_exact_files(paired);
    }

    #[test]
    fn interrupted_publication_is_uncertain_and_retry_recovers_complete_package() {
        let root = std::env::temp_dir().join(format!(
            "wmh-clean-interrupted-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        let library = NativeLibrary::open(root.join("Scores")).unwrap();
        let metadata = include_bytes!("../../../tests/fixtures/clean-song-v2/metadata.json");
        let score = include_bytes!("../../../tests/fixtures/clean-song-v2/score.json");
        let files = BTreeMap::from([
            (
                "metadata.json".into(),
                (metadata.len() as u64, digest(metadata)),
            ),
            ("score.json".into(), (score.len() as u64, digest(score))),
        ]);
        let package = parse(metadata, score, &files).unwrap();
        let mut reader = |_: &Media| Err(invalid("Fixture has no assets"));
        let error = save_with_boundary(&library, &package, None, false, &mut reader, || {
            Err(io_error(std::io::Error::other(
                "Injected failure after independent backup publication",
            )))
        })
        .unwrap_err();
        assert_eq!(error.code, "library_commit_uncertain");
        let key = format!("song-{}", package.identity);
        assert!(!library.root.join("clean-songs").join(&key).exists());
        assert!(library
            .root
            .join("clean-backups")
            .join(&key)
            .join("package/score.json")
            .exists());
        let inventory = library.list().unwrap();
        assert_eq!(inventory.entries.len(), 1);
        assert!(inventory
            .issues
            .iter()
            .any(|i| i.code == "library_recovered_backup"));
        assert!(inventory
            .issues
            .iter()
            .any(|i| i.code == "library_incomplete_clean_stages"));
        let error = save(&library, &package, None, false, &mut reader).unwrap_err();
        assert_eq!(error.code, "library_duplicate");
        assert_eq!(
            library
                .load(&key)
                .unwrap()
                .clean_package
                .unwrap()
                .score_json
                .as_bytes(),
            score
        );
        fs::remove_dir_all(root).unwrap();
    }
}
