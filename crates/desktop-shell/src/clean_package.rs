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
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

type Result<T> = std::result::Result<T, LibraryError>;
pub const MAX_JSON_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_METADATA_BYTES: usize = 256 * 1024;
pub const MAX_PACKAGE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_STORAGE_BYTES: u64 = 3 * 1024 * 1024 * 1024;
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
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
        if let Some(raw) = &self.notation_json {
            // Profile validation has already checked every retained source event.
            // Basic-key notation intentionally permits an unknown source meter
            // or clock, so catalog reads must not invoke the playback compiler.
            let score = if self.profile.as_deref() == Some(score_core::basic_keys::PROFILE) {
                serde_json::from_str(raw)
                    .map_err(|e| invalid(format!("Invalid basic-key notation: {e}")))?
            } else {
                checked_score(raw)?.0
            };
            Ok((score.composer, score.provenance))
        } else {
            Ok((
                String::new(),
                score_core::Provenance {
                    kind: "user_supplied".into(),
                    attribution: self.metadata.rights.attribution.clone(),
                    source_url: None,
                    license: self.metadata.rights.license.clone(),
                },
            ))
        }
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
/// Validate JSON and inventory first; assets are independently checked while
/// streaming from the ZIP or complete native folder, never retained in a plan.
pub fn parse(
    metadata_bytes: &[u8],
    score_bytes: &[u8],
    files: &BTreeMap<String, (u64, String)>,
) -> Result<Package> {
    parse_inner(metadata_bytes, score_bytes, files, true)
}
fn parse_inner(
    metadata_bytes: &[u8],
    score_bytes: &[u8],
    files: &BTreeMap<String, (u64, String)>,
    with_runtime: bool,
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
            let score = score_core::basic_keys::decode_json(score_bytes).map_err(invalid)?;
            let runtime = if with_runtime {
                serde_json::to_value(
                    practice_server::basic_keys_api::compile(&score).map_err(invalid)?,
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
                Some(score_core::basic_keys::PROFILE.to_owned()),
                Some(serde_json::to_value(score.capabilities).map_err(|e| invalid(e.to_string()))?),
                vec![],
            )
        }
        (1, None, Some("wmh-semantic-midi1-v1")) => {
            let score = score_core::clean_song::decode_json(score_bytes).map_err(invalid)?;
            let runtime = if with_runtime {
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
            let runtime = if with_runtime {
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
    // Metadata whitespace is not identity; exact score and every asset digest are.
    let identity = digest(&serde_json::to_vec(&metadata).map_err(|e| invalid(e.to_string()))?);
    let package = Package {
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
    };
    if serde_json::to_vec(
        &serde_json::json!({"score_json":package.legacy_notation_json(),"clean_package":package.opened()}),
    )
    .map_err(|e| invalid(e.to_string()))?
    .len()
        > 31 * 1024 * 1024
    {
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
                // List/open/export always hash every declared asset independently.
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
fn read_package(folder: &Path, asset_only: bool) -> Result<Package> {
    check_node(folder, true)?;
    let metadata = read_bounded(&folder.join("metadata.json"), MAX_METADATA_BYTES)?;
    let score = read_bounded(&folder.join("score.json"), MAX_JSON_BYTES)?;
    let descriptor: Metadata =
        serde_json::from_slice(&metadata).map_err(|e| invalid(e.to_string()))?;
    let deferred = asset_only.then_some(descriptor.media.as_slice());
    let package = parse_inner(
        &metadata,
        &score,
        &folder_inventory(folder, deferred)?,
        !asset_only,
    )?;
    if !asset_only {
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
    load_folder_mode(folder, key, false)
}
fn load_folder_mode(folder: &Path, key: &str, asset_only: bool) -> Result<(Entry, Package)> {
    #[cfg(test)]
    tests::record_validation(folder);
    check_node(folder, true)?;
    let entry: Entry = serde_json::from_slice(&read_bounded(
        &folder.join("entry.json"),
        MAX_METADATA_BYTES,
    )?)
    .map_err(|e| invalid(e.to_string()))?;
    let package = read_package(&folder.join("package"), asset_only)?;
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
    _lock: super::LibraryLock<'a>,
    inventory: Inventory,
    reserved_bytes: u64,
}
impl<'a> Batch<'a> {
    pub fn begin(library: &'a NativeLibrary) -> Result<Self> {
        let lock = library.lock()?;
        areas(library)?;
        let inventory = library.scan()?;
        let reserved_bytes = storage_usage(library)?;
        Ok(Self {
            library,
            _lock: lock,
            inventory,
            reserved_bytes,
        })
    }
    pub fn entries(&self) -> &[Entry] {
        &self.inventory.entries
    }
    pub fn save(
        &mut self,
        package: &Package,
        label: Option<String>,
        keep_both: bool,
        mut reader: impl FnMut(&Media) -> Result<Vec<u8>>,
    ) -> Result<Entry> {
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
        match load_folder(&folder, key) {
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
            match load_folder(&folder, key) {
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
        match load_folder(&folder, key) {
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
pub(super) fn load(library: &NativeLibrary, key: &str) -> Result<Option<LoadedScore>> {
    areas(library)?;
    let folder = library.root.join("clean-songs").join(key);
    match fs::symlink_metadata(&folder) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(io_error(e)),
        Ok(_) => (),
    }
    let (entry, package) = load_folder(&folder, key)?;
    let (backup, _) = load_folder(&library.root.join("clean-backups").join(key), key)?;
    if serde_json::to_value(&entry).ok() != serde_json::to_value(&backup).ok() {
        return Err(invalid(
            "Clean primary and independent backup metadata disagree",
        ));
    }
    Ok(Some(LoadedScore {
        entry,
        score_json: package.legacy_notation_json().map(str::to_owned),
        clean_package: Some(package.opened()),
    }))
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
    let (_, package) = load_folder_mode(&folder, key, true)?;
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
                    let mut metadata: Value = serde_json::from_slice(include_bytes!(
                        "../../../tests/fixtures/clean-song-v2/metadata.json"
                    ))
                    .unwrap();
                    let mut score: Value = serde_json::from_slice(include_bytes!(
                        "../../../tests/fixtures/clean-song-v2/score.json"
                    ))
                    .unwrap();
                    let id = format!("original-scan-exercise-{index}");
                    metadata["id"] = id.clone().into();
                    score["notation"]["id"] = id.into();
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
                                false,
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
