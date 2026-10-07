//! Versioned song containers around the existing canonical Score. Pack contents
//! are data only. ZIP paths are never used as filesystem paths.
use crate::native_library::clean_package;
use crate::native_library::{
    self, checked_score, digest, fail, Entry, LibraryError, NativeLibrary, SaveRequest,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    io::{Cursor, Read, Write},
};
use zip::ZipArchive;

#[path = "song_pack_storage.rs"]
pub(crate) mod storage;
#[path = "song_pack_zip.rs"]
mod zip_guard;

pub const MAX_PACK_BYTES: usize = 128 * 1024 * 1024;
pub const MAX_BACKUP_BYTES: usize = 40 * 1024 * 1024;
pub const MAX_ENTRY_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_EXPANDED_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const MAX_ZIP_ENTRIES: usize = 4096;
pub const MAX_SONGS: usize = 1024;
const MAX_METADATA_BYTES: usize = 256 * 1024;
type Result<T> = std::result::Result<T, LibraryError>;
fn invalid(message: impl Into<String>) -> LibraryError {
    fail(400, "pack_invalid", message)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FileInventory {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Inventory {
    pub files: Vec<FileInventory>,
    pub expanded_bytes: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Source {
    pub filename: String,
    pub sha256: String,
    pub bytes: usize,
    pub retained: bool,
    pub archive_key: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Derivation {
    pub code: String,
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Item {
    pub index: usize,
    pub path: String,
    pub title: String,
    pub status: String,
    pub code: String,
    pub message: String,
    pub playable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clean_package: Option<clean_package::Summary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derivation: Option<Derivation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<Entry>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Report {
    pub format: String,
    pub version: u32,
    pub mode: String,
    pub source: Source,
    pub items: Vec<Item>,
    pub summary: BTreeMap<String, usize>,
    pub inventory: Inventory,
    pub warnings: Vec<String>,
}
struct Candidate {
    path: String,
    title: String,
    label: Option<String>,
    score: std::result::Result<String, String>,
    explicit_only: bool,
    derivation: Option<Derivation>,
    clean: Option<clean_package::Package>,
}
#[derive(Default)]
struct RecheckBudget {
    requests: usize,
    bytes: u64,
}
impl RecheckBudget {
    fn reserve(&mut self, bytes: u64) -> Result<()> {
        if self.requests >= MAX_SONGS || bytes > MAX_PACK_BYTES as u64 - self.bytes {
            return Err(fail(413, "pack_source_only", "Retained MIDI recheck exceeds 1024 parser requests or 128 MiB aggregate input; original retained without parsing"));
        }
        self.requests += 1;
        self.bytes += bytes;
        Ok(())
    }
}
struct Plan {
    report: Report,
    candidates: Vec<Candidate>,
}

// A repeated canonical_score or source descriptor key is ambiguous. Preserve
// such metadata as source-only instead of letting JSON's last value enable a
// recheck that an earlier value would forbid.
struct UniqueMetadata(Value);
impl<'de> Deserialize<'de> for UniqueMetadata {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = UniqueMetadata;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("JSON metadata without duplicate object keys")
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut map: A,
            ) -> std::result::Result<Self::Value, A::Error> {
                let mut value = serde_json::Map::new();
                while let Some((key, entry)) = map.next_entry::<String, UniqueMetadata>()? {
                    if value.insert(key, entry.0).is_some() {
                        return Err(serde::de::Error::custom("Duplicate metadata object key"));
                    }
                }
                Ok(UniqueMetadata(Value::Object(value)))
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> std::result::Result<Self::Value, A::Error> {
                let mut value = Vec::new();
                while let Some(entry) = seq.next_element::<UniqueMetadata>()? {
                    value.push(entry.0);
                }
                Ok(UniqueMetadata(Value::Array(value)))
            }
            fn visit_str<E: serde::de::Error>(
                self,
                value: &str,
            ) -> std::result::Result<Self::Value, E> {
                Ok(UniqueMetadata(Value::String(value.into())))
            }
            fn visit_bool<E: serde::de::Error>(
                self,
                value: bool,
            ) -> std::result::Result<Self::Value, E> {
                Ok(UniqueMetadata(Value::Bool(value)))
            }
            fn visit_u64<E: serde::de::Error>(
                self,
                value: u64,
            ) -> std::result::Result<Self::Value, E> {
                Ok(UniqueMetadata(value.into()))
            }
            fn visit_i64<E: serde::de::Error>(
                self,
                value: i64,
            ) -> std::result::Result<Self::Value, E> {
                Ok(UniqueMetadata(value.into()))
            }
            fn visit_f64<E: serde::de::Error>(
                self,
                value: f64,
            ) -> std::result::Result<Self::Value, E> {
                serde_json::Number::from_f64(value)
                    .map(|number| UniqueMetadata(Value::Number(number)))
                    .ok_or_else(|| E::custom("Invalid metadata number"))
            }
            fn visit_unit<E: serde::de::Error>(self) -> std::result::Result<Self::Value, E> {
                Ok(UniqueMetadata(Value::Null))
            }
        }
        deserializer.deserialize_any(Visitor)
    }
}

pub fn is_import_route(path: &str) -> bool {
    matches!(
        path,
        "/api/library/import/preview"
            | "/api/library/import/commit"
            | "/api/library/imports"
            | "/api/library/import/export"
            | "/api/library/import/report"
            | "/api/library/pack/export"
    )
}
pub fn is_large_operation(path: &str) -> bool {
    path.starts_with("/api/library/catalog/")
        || matches!(
            path,
            "/api/library/manage/query"
                | "/api/library/import/preview"
                | "/api/library/import/commit"
                | "/api/library/import/export"
                | "/api/library/pack/export"
                | "/api/library/asset"
                | "/api/library/runtime"
                | "/api/library/fingering/piano"
                | "/api/library/fingering/guitar"
                | "/api/library/assistance/original"
                | "/api/library/assistance/generate"
                | "/api/library/assistance/create"
                | "/api/library/assistance/validate"
                | "/api/library/progression/generate"
                | "/api/library/progression/validate"
        )
}
pub fn valid_history_query(uri: &http::Uri) -> bool {
    uri.path() == "/api/library/imports"
        && uri.query().is_some_and(|q| {
            q.strip_prefix("cursor=").is_some_and(|c| {
                !c.is_empty()
                    && c.len() <= 3
                    && c.bytes().all(|b| b.is_ascii_digit())
                    && c.parse::<usize>().is_ok_and(|n| n <= 128)
            })
        })
}
pub fn request_limit(path: &str) -> usize {
    if path.starts_with("/api/library/catalog/") {
        return crate::catalog_product::REQUEST_LIMIT;
    }
    if path == "/api/library/manage/query" {
        return native_library::pack_groups::REQUEST_LIMIT;
    }
    if matches!(
        path,
        "/api/library/import/preview" | "/api/library/import/commit"
    ) {
        MAX_PACK_BYTES
    } else {
        crate::MAX_BODY
    }
}

fn read_zip(archive: &mut ZipArchive<Cursor<&[u8]>>, path: &str, limit: usize) -> Result<Vec<u8>> {
    let file = archive
        .by_name(path)
        .map_err(|e| invalid(format!("Cannot read {path}: {e}")))?;
    let size = file.size();
    if size > limit as u64 {
        return Err(fail(
            413,
            "pack_entry_limit",
            format!("{path} exceeds its {limit}-byte parsing limit; original retained on commit"),
        ));
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| invalid(format!("Corrupt ZIP entry {path}: {e}")))?;
    if bytes.len() as u64 != size || bytes.len() > limit {
        return Err(invalid("ZIP expanded size does not match its inventory"));
    }
    Ok(bytes)
}
fn inventory_zip(archive: &mut ZipArchive<Cursor<&[u8]>>) -> Result<Inventory> {
    let mut files = Vec::new();
    let mut expanded_bytes = 0;
    // Hash and CRC-check every entry with a fixed-size buffer before a write.
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| invalid(e.to_string()))?;
        if file.is_dir() {
            continue;
        }
        let path = file.name().to_owned();
        let declared = file.size();
        let mut hasher = Sha256::new();
        let mut count = 0u64;
        let mut buf = [0u8; 65536];
        loop {
            let n = file
                .read(&mut buf)
                .map_err(|e| invalid(format!("Corrupt ZIP entry {path}: {e}")))?;
            if n == 0 {
                break;
            }
            count += n as u64;
            if count > declared || count > MAX_ENTRY_BYTES as u64 {
                return Err(invalid("ZIP expansion exceeds declared size"));
            }
            hasher.update(&buf[..n]);
        }
        if count != declared {
            return Err(invalid("ZIP expanded size mismatch"));
        }
        expanded_bytes += count;
        if expanded_bytes > MAX_EXPANDED_BYTES {
            return Err(invalid("Actual ZIP expansion exceeds 2 GiB"));
        }
        zip_guard::safe_path(&path, false).map_err(invalid)?;
        files.push(FileInventory {
            path,
            bytes: count,
            sha256: format!("{:x}", hasher.finalize()),
        });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let names: HashSet<&str> = files.iter().map(|f| f.path.as_str()).collect();
    for file in &files {
        for (at, b) in file.path.bytes().enumerate() {
            if b == b'/' && names.contains(&file.path[..at]) {
                return Err(invalid("ZIP file/directory path collision"));
            }
        }
    }
    Ok(Inventory {
        files,
        expanded_bytes,
    })
}
fn canonical(bytes: &[u8]) -> std::result::Result<String, String> {
    let raw = std::str::from_utf8(bytes).map_err(|_| "Canonical JSON must be UTF-8")?;
    checked_score(raw).map_err(|e| e.error)?;
    Ok(raw.to_owned())
}
fn standard(path: &str, bytes: &[u8]) -> std::result::Result<String, String> {
    if bytes.len() > native_library::MAX_SCORE_BYTES {
        return Err("Source exceeds the unchanged 8 MiB score/import limit".into());
    }
    let lower = path.to_lowercase();
    if lower.ends_with(".json") {
        return canonical(bytes);
    }
    let result =
        if bytes.starts_with(b"MThd") || lower.ends_with(".mid") || lower.ends_with(".midi") {
            score_core::import_midi(bytes)
        } else if lower.ends_with(".mxl") || bytes.starts_with(b"PK\x03\x04") {
            score_core::import_mxl(bytes)
        } else {
            let text = std::str::from_utf8(bytes).map_err(|_| "Text score must be UTF-8")?;
            if lower.ends_with(".xml")
                || lower.ends_with(".musicxml")
                || text.trim_start().starts_with('<')
            {
                score_core::import_musicxml(text)
            } else {
                score_core::import_jianpu(text)
            }
        };
    let (score, _) = result?;
    let raw = serde_json::to_string(&score).map_err(|e| e.to_string())?;
    checked_score(&raw).map_err(|e| e.error)?;
    Ok(raw)
}
fn candidate(
    path: String,
    title: String,
    label: Option<String>,
    score: std::result::Result<String, String>,
) -> Candidate {
    Candidate {
        path,
        title,
        label,
        score,
        explicit_only: false,
        derivation: None,
        clean: None,
    }
}
fn json_candidates(path: &str, bytes: &[u8]) -> Result<Vec<Candidate>> {
    let v: Value = serde_json::from_slice(bytes).map_err(|e| invalid(e.to_string()))?;
    match v.get("format").and_then(Value::as_str) {
        Some("worldmusichub-library-backup") => {
            if v["version"] != 1 {
                return Err(invalid("Unsupported library backup version"));
            }
            let entries = v["entries"]
                .as_array()
                .ok_or_else(|| invalid("Backup entries must be an array"))?;
            if entries.len() > MAX_SONGS {
                return Err(fail(
                    413,
                    "pack_song_limit",
                    "Backup exceeds 1024 song entries",
                ));
            }
            Ok(entries
                .iter()
                .enumerate()
                .map(|(i, e)| {
                    let score = serde_json::to_vec(&e["score"])
                        .map_err(|e| e.to_string())
                        .and_then(|b| canonical(&b));
                    candidate(
                        format!("{path}#entries/{i}"),
                        e["score"]["title"].as_str().unwrap_or(path).into(),
                        e["label"].as_str().map(str::to_owned),
                        score,
                    )
                })
                .collect())
        }
        Some("worldmusichub-native-score-backup") => {
            if v["version"] != 1 {
                return Err(invalid("Unsupported native score backup version"));
            }
            Ok(vec![candidate(
                path.into(),
                path.into(),
                v["entry"]["label"].as_str().map(str::to_owned),
                v["score_json"]
                    .as_str()
                    .ok_or_else(|| "Native backup score_json is missing".into())
                    .and_then(|s| canonical(s.as_bytes())),
            )])
        }
        _ => Ok(vec![candidate(
            path.into(),
            path.into(),
            None,
            canonical(bytes),
        )]),
    }
}
fn resolve(folder: &str, relative: &str) -> Result<String> {
    zip_guard::safe_path(relative, false).map_err(invalid)?;
    Ok(if folder.is_empty() {
        relative.into()
    } else {
        format!("{folder}/{relative}")
    })
}
fn metadata_candidate(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    inventory: &Inventory,
    path: &str,
    metadata: &Value,
    rechecks: &mut RecheckBudget,
) -> Candidate {
    let folder = path.rsplit_once('/').map(|x| x.0).unwrap_or("");
    let title = metadata["title"].as_str().unwrap_or(folder).to_owned();
    let mut derivation = None;
    let score = (|| -> Result<String> {
        if metadata["version"] != 1 {
            return Err(invalid("Unsupported song metadata version"));
        }
        let unified = metadata["format"] == "worldmusichub-song";
        let descriptors = if unified {
            metadata.get("sources")
        } else {
            metadata.get("source_files")
        };
        if let Some(sources) = descriptors {
            let sources = sources
                .as_array()
                .ok_or_else(|| invalid("Song sources must be an array"))?;
            for source in sources {
                let target = resolve(
                    folder,
                    source["path"]
                        .as_str()
                        .ok_or_else(|| invalid("Source path is missing"))?,
                )?;
                let actual = inventory
                    .files
                    .iter()
                    .find(|f| f.path == target)
                    .ok_or_else(|| invalid(format!("Missing retained source {target}")))?;
                if source
                    .get("bytes")
                    .is_some_and(|v| v.as_u64() != Some(actual.bytes))
                    || source
                        .get("sha256")
                        .is_some_and(|v| v.as_str() != Some(actual.sha256.as_str()))
                {
                    return Err(invalid(format!(
                        "Retained source checksum/size mismatch: {target}"
                    )));
                }
            }
        }
        if unified {
            if let Some(media) = metadata.get("media") {
                let media = media
                    .as_object()
                    .ok_or_else(|| invalid("Media must be an object of relative paths"))?;
                for (role, value) in media {
                    if !matches!(role.as_str(), "cover" | "background" | "pv" | "audio") {
                        return Err(invalid("Unsupported media role"));
                    }
                    if value.is_null() {
                        continue;
                    }
                    let target = resolve(
                        folder,
                        value
                            .as_str()
                            .ok_or_else(|| invalid("Media path must be a string"))?,
                    )?;
                    if !inventory.files.iter().any(|f| f.path == target) {
                        return Err(invalid(format!("Missing optional media {target}")));
                    }
                }
            }
        }
        let score_path = if unified {
            metadata.get("score").and_then(Value::as_str)
        } else {
            metadata["imports"]["canonical_score"].as_str()
        };
        if let Some(relative) = score_path {
            let target = resolve(folder, relative)?;
            return canonical(&read_zip(
                archive,
                &target,
                native_library::MAX_SCORE_BYTES,
            )?)
            .map_err(invalid);
        }
        if metadata["format"] == "private-complete-midi-source-folder"
            && metadata["imports"].get("canonical_score") == Some(&Value::Null)
        {
            let source = retained_midi_source(folder, metadata, inventory)?;
            if source.bytes > native_library::MAX_SCORE_BYTES as u64 {
                return Err(invalid(
                    "Source exceeds the unchanged 8 MiB score/import limit",
                ));
            }
            rechecks.reserve(source.bytes)?;
            let bytes = read_zip(archive, &source.path, native_library::MAX_SCORE_BYTES)?;
            // Use the same complete importer and serialization as a standalone
            // MIDI. Container provenance must not change the score or its ID.
            let score = standard(&source.path, &bytes).map_err(|current| {
                invalid(format!(
                    "Current retained MIDI recheck: {current}. Previous import diagnostic: {}",
                    metadata["imports"]["canonical_error"]
                        .as_str()
                        .unwrap_or("No canonical score was supplied")
                ))
            })?;
            derivation = Some(Derivation {
                code: "pack_retained_midi_recheck".into(),
                path: source.path.clone(),
                bytes: source.bytes,
                sha256: source.sha256.clone(),
            });
            return Ok(score);
        }
        // Legacy delivered source folders explicitly distinguish source-only
        // songs. Never reinterpret their events JSON as a canonical score.
        Err(fail(
            422,
            "pack_source_only",
            metadata["imports"]["canonical_error"]
                .as_str()
                .unwrap_or("Original source retained; no validated canonical score is supplied"),
        ))
    })()
    .map_err(|e| e.error);
    let mut candidate = candidate(
        path.into(),
        title,
        metadata["label"].as_str().map(str::to_owned),
        score,
    );
    if derivation.is_some() && candidate.label.is_none() {
        // A container caption is a library label, never canonical music data.
        candidate.label = metadata["title"]
            .as_str()
            .filter(|title| !title.trim().is_empty() && title.len() <= 1024)
            .map(str::to_owned);
    }
    candidate.derivation = derivation;
    candidate
}

fn retained_midi_source<'a>(
    folder: &str,
    metadata: &Value,
    inventory: &'a Inventory,
) -> Result<&'a FileInventory> {
    let reject = || {
        invalid("Legacy retained MIDI recheck requires one unambiguous declared MIDI, its verified size and SHA-256, and no supplied canonical score")
    };
    if metadata.get("title").is_some_and(|v| !v.is_string())
        || metadata
            .get("label")
            .is_some_and(|v| !v.is_null() && !v.is_string())
        || metadata.get("score").is_some_and(|v| !v.is_null())
        || metadata["imports"]
            .get("canonical_error")
            .is_some_and(|v| !v.is_null() && !v.is_string())
    {
        return Err(reject());
    }
    let prefix = if folder.is_empty() {
        String::new()
    } else {
        format!("{folder}/")
    };
    if inventory.files.iter().any(|file| {
        file.path.strip_prefix(&prefix).is_some_and(|relative| {
            let lower = relative.to_lowercase();
            lower.ends_with(".wmhscore.json")
                || lower == "score.json"
                || lower.ends_with("/score.json")
        })
    }) {
        return Err(reject());
    }
    let sources = metadata["source_files"].as_array().ok_or_else(reject)?;
    let mut paths = HashSet::new();
    let mut midi = None;
    for source in sources {
        let relative = source["path"].as_str().ok_or_else(reject)?;
        if !paths.insert(relative) {
            return Err(reject());
        }
        let lower = relative.to_lowercase();
        if !lower.ends_with(".mid") && !lower.ends_with(".midi") {
            continue;
        }
        if midi.is_some() || relative.split('/').any(|part| part.starts_with('.')) {
            return Err(reject());
        }
        let target = resolve(folder, relative)?;
        if target.split('/').any(|part| part.starts_with('.')) {
            return Err(reject());
        }
        let actual = inventory
            .files
            .iter()
            .find(|f| f.path == target)
            .ok_or_else(reject)?;
        if source["bytes"].as_u64() != Some(actual.bytes)
            || source["sha256"].as_str() != Some(actual.sha256.as_str())
            || metadata["imports"]
                .get("raw_midi")
                .is_some_and(|v| v.as_str() != Some(relative))
        {
            return Err(reject());
        }
        midi = Some(actual);
    }
    midi.ok_or_else(reject)
}

fn check_candidates(candidates: &[Candidate]) -> Result<()> {
    if candidates.len() > MAX_SONGS
        || candidates
            .iter()
            .filter_map(|c| c.score.as_ref().ok())
            .map(String::len)
            .sum::<usize>()
            > MAX_PACK_BYTES
    {
        return Err(fail(413,"pack_song_limit","A pack is bounded to 1024 song entries and 128 MiB of parsed canonical JSON; split the pack without discarding sources"));
    }
    Ok(())
}

fn plan(filename: &str, bytes: &[u8]) -> Result<Plan> {
    if bytes.len() > MAX_PACK_BYTES {
        return Err(fail(
            413,
            "pack_request_limit",
            "Pack exceeds 128 MiB compressed limit",
        ));
    }
    let sha256 = digest(bytes);
    let mut warnings = Vec::new();
    let (inventory, candidates) = if bytes.starts_with(b"PK") {
        let expected_entries = zip_guard::preflight(bytes).map_err(invalid)?;
        let mut archive =
            ZipArchive::new(Cursor::new(bytes)).map_err(|e| invalid(e.to_string()))?;
        if archive.len() != expected_entries {
            return Err(invalid("Parsed ZIP entry count differs from preflight; ambiguous transformed names are forbidden"));
        }
        let inventory = inventory_zip(&mut archive)?;
        let mxl = inventory
            .files
            .iter()
            .any(|f| f.path == "META-INF/container.xml");
        let mut metadata = Vec::new();
        let mut pack_manifest = None;
        let mut metadata_failures = Vec::new();
        let mut invalid_manifest = false;
        let mut metadata_bytes = 0u64;
        let mut metadata_count = 0usize;
        for f in &inventory.files {
            let is_metadata = f.path.ends_with("/metadata.json") || f.path == "metadata.json";
            let is_manifest = f.path.ends_with("/manifest.json") || f.path == "manifest.json";
            if !is_metadata && !is_manifest {
                continue;
            }
            metadata_bytes = metadata_bytes.saturating_add(f.bytes);
            metadata_count += 1;
            if metadata_bytes > 8 * 1024 * 1024 || metadata_count > MAX_SONGS + 1 {
                return Err(fail(
                    413,
                    "pack_metadata_limit",
                    "Song metadata is bounded to 8 MiB aggregate and 1025 descriptors",
                ));
            }
            let parsed = read_zip(&mut archive, &f.path, MAX_METADATA_BYTES).and_then(|data| {
                serde_json::from_slice::<UniqueMetadata>(&data)
                    .map(|metadata| metadata.0)
                    .map_err(|e| invalid(e.to_string()))
            });
            match parsed {
                Ok(value)
                    if is_metadata
                        && matches!(
                            value["format"].as_str(),
                            Some("worldmusichub-song" | "private-complete-midi-source-folder")
                        ) =>
                {
                    metadata.push((f.path.clone(), value))
                }
                Ok(value) if is_manifest && value["format"] == "worldmusichub-song-pack" => {
                    if pack_manifest.is_some() {
                        return Err(invalid("Multiple pack manifests are ambiguous"));
                    }
                    if value["version"] != 1 && value["version"] != 2 {
                        invalid_manifest = true;
                        metadata_failures.push(candidate(f.path.clone(),f.path.clone(),None,Err("Unsupported song-pack version; original retained without interpreting future semantics".into())));
                    } else {
                        pack_manifest = Some((f.path.clone(), value));
                    }
                }
                Ok(value)
                    if is_manifest && value["format"] == "private-complete-midi-collection" => {}
                result => {
                    if is_manifest {
                        invalid_manifest = true;
                    }
                    let message = result
                        .err()
                        .map(|e| e.error)
                        .unwrap_or_else(|| "Unsupported song metadata format".into());
                    metadata_failures.push(candidate(
                        f.path.clone(),
                        f.path.clone(),
                        None,
                        Err(message),
                    ));
                }
            }
        }
        let clean_version = metadata
            .iter()
            .any(|(_, v)| v["format"] == "worldmusichub-song" && v["version"] == 2)
            || pack_manifest
                .as_ref()
                .is_some_and(|(_, v)| v["version"] == 2);
        if clean_version {
            let candidates = if invalid_manifest || !metadata_failures.is_empty() || mxl {
                Err(invalid(
                    "Ambiguous, invalid or mixed clean package descriptors",
                ))
            } else {
                clean_candidates(&mut archive, &inventory, &metadata, pack_manifest.as_ref())
            }
            .unwrap_or_else(|error| {
                vec![candidate(
                    filename.into(),
                    filename.into(),
                    None,
                    Err(error.error),
                )]
            });
            return finish_plan(filename, bytes, inventory, candidates, vec!["Clean v2 folders contain only complete semantic music and declared runtime assets; original input is retained privately on commit".into()]);
        }
        if invalid_manifest {
            metadata.clear();
            pack_manifest = None;
        }
        if mxl && (!metadata.is_empty() || pack_manifest.is_some() || !metadata_failures.is_empty())
        {
            return Err(invalid(
                "Mixed MXL and song-pack schemas are ambiguous; separate these containers",
            ));
        }
        let mut candidates = metadata_failures;
        if mxl {
            candidates.push(candidate(
                filename.into(),
                filename.into(),
                None,
                standard("score.mxl", bytes),
            ));
        } else if !metadata.is_empty() || pack_manifest.is_some() || !candidates.is_empty() {
            if let Some((path, manifest)) = pack_manifest {
                if manifest["version"] != 1 {
                    return Err(invalid("Unsupported song-pack version"));
                }
                let folders = manifest["songs"]
                    .as_array()
                    .ok_or_else(|| invalid("Pack songs must be an array of folder descriptors"))?;
                let prefix = path.rsplit_once('/').map(|p| p.0).unwrap_or("");
                let mut wanted = HashSet::new();
                for folder in folders {
                    let target = resolve(
                        prefix,
                        folder["folder"]
                            .as_str()
                            .ok_or_else(|| invalid("Pack song folder missing"))?,
                    )?;
                    if !wanted.insert(format!("{target}/metadata.json")) {
                        return Err(invalid("Pack repeats a song folder"));
                    }
                }
                for target in &wanted {
                    if !metadata.iter().any(|(p, _)| p == target) {
                        candidates.push(candidate(
                            target.clone(),
                            target.clone(),
                            None,
                            Err(
                                "Declared song metadata missing or unsupported; original retained"
                                    .into(),
                            ),
                        ));
                    }
                }
                metadata.retain(|(p, _)| wanted.contains(p));
            }
            let mut rechecks = RecheckBudget::default();
            for (path, value) in metadata {
                candidates.push(metadata_candidate(
                    &mut archive,
                    &inventory,
                    &path,
                    &value,
                    &mut rechecks,
                ));
                check_candidates(&candidates)?;
            }
        } else {
            // Legacy ZIPs can repeat canonical songs in a backup. Keep each
            // candidate visible; commit reports exact duplicates explicitly.
            let canonical_stems: HashSet<String> = inventory
                .files
                .iter()
                .filter_map(|f| {
                    f.path
                        .to_lowercase()
                        .strip_suffix(".wmhscore.json")
                        .map(str::to_owned)
                })
                .collect();
            for f in &inventory.files {
                let lower = f.path.to_lowercase();
                let canonical_path = lower.ends_with(".wmhscore.json")
                    || lower.ends_with("/score.json")
                    || lower == "score.json";
                if canonical_path {
                    let score = read_zip(&mut archive, &f.path, native_library::MAX_SCORE_BYTES)
                        .map_err(|e| e.error)
                        .and_then(|b| canonical(&b));
                    candidates.push(candidate(f.path.clone(), f.path.clone(), None, score));
                } else if lower.ends_with(".json") && f.bytes <= MAX_BACKUP_BYTES as u64 {
                    let data = read_zip(&mut archive, &f.path, MAX_BACKUP_BYTES)?;
                    if let Ok(value) = serde_json::from_slice::<Value>(&data) {
                        if matches!(
                            value["format"].as_str(),
                            Some(
                                "worldmusichub-library-backup"
                                    | "worldmusichub-native-score-backup"
                            )
                        ) || value.get("parts").is_some()
                        {
                            match json_candidates(&f.path, &data) {
                                Ok(items) => candidates.extend(items),
                                Err(e) => candidates.push(candidate(
                                    f.path.clone(),
                                    f.path.clone(),
                                    None,
                                    Err(e.error),
                                )),
                            }
                        }
                    }
                } else if [".mid", ".midi", ".musicxml", ".xml", ".mxl", ".jianpu"]
                    .iter()
                    .any(|ext| lower.ends_with(ext))
                {
                    let score = read_zip(&mut archive, &f.path, native_library::MAX_SCORE_BYTES)
                        .map_err(|e| e.error)
                        .and_then(|b| standard(&f.path, &b));
                    let mut alternate = candidate(f.path.clone(), f.path.clone(), None, score);
                    alternate.explicit_only = lower
                        .rsplit_once('.')
                        .is_some_and(|(stem, _)| canonical_stems.contains(stem));
                    candidates.push(alternate);
                }
                check_candidates(&candidates)?;
            }
        }
        if candidates.is_empty() {
            candidates.push(candidate(filename.into(),filename.into(),None,Err("No canonical score or supported source was recognized; every file is retained in the original archive".into())));
        }
        warnings.push("Original archive files and optional media are preserved as inert data. Nested ZIPs and raw event JSON are not executed or treated as scores.".into());
        (inventory, candidates)
    } else {
        if bytes.len() > MAX_BACKUP_BYTES {
            return Err(fail(
                413,
                "pack_request_limit",
                "Non-ZIP input exceeds 40 MiB backup limit",
            ));
        }
        let candidates =
            if filename.to_lowercase().ends_with(".json") || bytes.first() == Some(&b'{') {
                json_candidates(filename, bytes).unwrap_or_else(|e| {
                    vec![candidate(
                        filename.into(),
                        filename.into(),
                        None,
                        Err(e.error),
                    )]
                })
            } else {
                vec![candidate(
                    filename.into(),
                    filename.into(),
                    None,
                    standard(filename, bytes),
                )]
            };
        (
            Inventory {
                files: vec![FileInventory {
                    path: filename.into(),
                    bytes: bytes.len() as u64,
                    sha256: sha256.clone(),
                }],
                expanded_bytes: bytes.len() as u64,
            },
            candidates,
        )
    };
    finish_plan(filename, bytes, inventory, candidates, warnings)
}

fn finish_plan(
    filename: &str,
    bytes: &[u8],
    inventory: Inventory,
    candidates: Vec<Candidate>,
    warnings: Vec<String>,
) -> Result<Plan> {
    if candidates.len() > MAX_SONGS {
        return Err(fail(
            413,
            "pack_song_limit",
            "Song pack exceeds 1024 entries",
        ));
    }
    check_candidates(&candidates)?;
    let sha256 = digest(bytes);
    let source = Source {
        filename: filename.into(),
        sha256: sha256.clone(),
        bytes: bytes.len(),
        retained: false,
        archive_key: format!("pack-{sha256}"),
    };
    Ok(Plan {
        report: Report {
            format: "worldmusichub-import-report".into(),
            version: 1,
            mode: "preview".into(),
            source,
            items: Vec::new(),
            summary: BTreeMap::new(),
            inventory,
            warnings,
        },
        candidates,
    })
}

fn clipped(text: &str, limit: usize) -> String {
    let mut out = String::new();
    for c in text.chars() {
        if out.len() + c.len_utf8() > limit {
            out.push('…');
            break;
        }
        out.push(if c.is_control() { ' ' } else { c });
    }
    out
}
fn check_report_budget(plan: &Plan) -> Result<()> {
    let mut budget = serde_json::to_vec(&plan.report.inventory)
        .map_err(|e| invalid(e.to_string()))?
        .len()
        + 65536;
    for c in &plan.candidates {
        budget += c.path.len() * 2 + 4096 + 8192;
        if let Some(clean) = &c.clean {
            budget += 2 * serde_json::to_vec(&clean.summary())
                .map_err(|e| invalid(e.to_string()))?
                .len();
        }
        if let Some(derivation) = &c.derivation {
            budget += serde_json::to_vec(derivation)
                .map_err(|e| invalid(e.to_string()))?
                .len();
        }
        if let Some(package) = &c.clean {
            let (composer, provenance) = package.catalog_fields()?;
            budget += serde_json::to_vec(&json!({"title":package.metadata.title,"composer":composer,"score_id":package.metadata.id,"provenance":provenance,"label":c.label.as_ref().unwrap_or(&package.metadata.title)})).map_err(|e|invalid(e.to_string()))?.len()+2048;
        } else if let Ok(raw) = &c.score {
            let score: score_core::Score =
                serde_json::from_str(raw).map_err(|e| invalid(e.to_string()))?;
            let retained = score
                .source
                .as_ref()
                .map(|source| json!({"format":source.format,"filename":source.filename}));
            budget+=serde_json::to_vec(&json!({"title":score.title,"composer":score.composer,"score_id":score.id,"provenance":score.provenance,"label":c.label.as_ref().unwrap_or(&score.title),"retained_source":retained})).map_err(|e|invalid(e.to_string()))?.len()+2048;
        }
    }
    if budget > 32 * 1024 * 1024 {
        return Err(fail(413,"pack_report_limit","The complete import report exceeds its 32 MiB budget; split this pack before importing"));
    }
    Ok(())
}

pub fn import(
    library: &NativeLibrary,
    filename: &str,
    bytes: &[u8],
    commit: bool,
    keep_both: bool,
    selected: Option<usize>,
) -> Result<Report> {
    import_with_boundary(
        library,
        filename,
        bytes,
        commit,
        keep_both,
        selected,
        || Ok(()),
    )
}

#[cfg(test)]
pub(crate) fn import_with_receipt_boundary(
    library: &NativeLibrary,
    filename: &str,
    bytes: &[u8],
    before_receipt: impl FnOnce() -> Result<()>,
) -> Result<Report> {
    import_with_boundary(library, filename, bytes, true, false, None, before_receipt)
}

fn import_with_boundary(
    library: &NativeLibrary,
    filename: &str,
    bytes: &[u8],
    commit: bool,
    keep_both: bool,
    selected: Option<usize>,
    before_receipt: impl FnOnce() -> Result<()>,
) -> Result<Report> {
    if filename.is_empty() || filename.len() > 1024 || filename.chars().any(char::is_control) {
        return Err(invalid(
            "Original filename must be 1–1024 UTF-8 bytes without control characters",
        ));
    }
    let mut plan = plan(filename, bytes)?;
    check_report_budget(&plan)?;
    if selected.is_some_and(|i| i >= plan.candidates.len()) {
        return Err(invalid("Selected song index is outside this pack"));
    }
    // Bootstrap/sync must never observe a newly saved edition before its exact
    // retained import receipt. One native lock covers the entire publication.
    let _lock = library.lock()?;
    crate::catalog_product::load_managed_locked(library)?;
    let mut batch = if commit && plan.candidates.iter().any(|c| c.clean.is_some()) {
        Some(clean_package::Batch::begin_locked(library)?)
    } else {
        None
    };
    let mut existing = if let Some(batch) = &batch {
        batch.entries().to_vec()
    } else {
        library.scan()?.entries
    };
    let mut planned_hashes = HashSet::new();
    let mut planned_ids = HashSet::new();
    if commit {
        storage::retain_locked(library, &plan.report, bytes)?;
        plan.report.source.retained = true;
        plan.report.mode = "commit".into();
    }
    for (index, candidate) in plan.candidates.into_iter().enumerate() {
        let mut item = Item {
            index,
            path: candidate.path,
            title: clipped(&candidate.title, 1000),
            status: "retained_nonplayable".into(),
            code: "pack_source_only".into(),
            message: String::new(),
            playable: false,
            clean_package: candidate.clean.as_ref().map(|p| p.summary()),
            derivation: candidate.derivation,
            entry: None,
        };
        match candidate.score {
            Err(message) => item.message = clipped(&message, 4096),
            Ok(score_json) => {
                let (score_id, score_title, hash) = if let Some(package) = &candidate.clean {
                    (
                        package.metadata.id.clone(),
                        package.metadata.title.clone(),
                        package.identity.clone(),
                    )
                } else {
                    let (score, hash) = checked_score(&score_json)?;
                    (score.id, score.title, hash)
                };
                item.title = if item.derivation.is_some() {
                    candidate.label.clone().unwrap_or(score_title)
                } else {
                    score_title
                };
                let explicit_practice = candidate
                    .clean
                    .as_ref()
                    .is_some_and(|p| p.profile.as_deref() == Some(score_core::vsq_clean::PROFILE));
                let performance_only = candidate.clean.as_ref().is_some_and(|p| {
                    p.profile.as_deref() == Some(score_core::clean_performance::PROFILE)
                });
                let basic_keys = candidate
                    .clean
                    .as_ref()
                    .is_some_and(|p| p.profile.as_deref() == Some(score_core::basic_keys::PROFILE));
                // This is availability for the shipped 128-voice basic
                // receiver, not a claim of original rendition or device range.
                let basic_ready = basic_keys
                    && candidate.clean.as_ref().is_some_and(|p| {
                        let runtime = &p.runtime;
                        let rendition = &runtime["rendition"];
                        let count = runtime["compilation"]["timeline"]["notes"]
                            .as_array()
                            .map(Vec::len);
                        runtime["profile"] == practice_server::basic_keys_api::RUNTIME_PROFILE
                            && rendition["policy_id"] == score_core::basic_keys::RENDITION_POLICY
                            && count.is_some_and(|count| {
                                count > 0
                                    && rendition["notes"]
                                        .as_array()
                                        .is_some_and(|notes| notes.len() == count)
                                    && rendition["coverage"]["source_attacks"].as_u64()
                                        == Some(count as u64)
                                    && rendition["coverage"]["derived_voices"].as_u64()
                                        == Some(count as u64)
                                    && rendition["coverage"]["practice_targets"].as_u64()
                                        == Some(count as u64)
                            })
                            && rendition["coverage"]["maximum_allocated_voices"]
                                .as_u64()
                                .is_some_and(|voices| {
                                    voices <= score_core::basic_keys::RENDITION_VOICE_LIMIT as u64
                                })
                    });
                item.playable =
                    basic_ready || (!explicit_practice && !performance_only && !basic_keys);
                let basic_message = if basic_ready {
                    "Complete basic synthesized rendition and note-on practice compiled from every source attack"
                } else {
                    "Complete key source retained; basic rendition needs a nonempty target set and sufficient receiver capacity"
                };
                item.status = "ready".into();
                item.code = "pack_valid_score".into();
                item.message = if basic_keys {
                    basic_message
                } else if performance_only {
                    "Complete performance validated by Rust; canonical notation is unavailable"
                } else {
                    "Canonical score validated by Rust"
                }
                .into();
                if let Some(entry) = existing.iter().find(|e| e.content_sha256 == hash) {
                    item.status = "duplicate".into();
                    item.code = "library_duplicate".into();
                    item.message = "This exact canonical score is already saved".into();
                    item.entry = Some(entry.clone());
                } else if candidate.explicit_only && !(keep_both && selected == Some(index)) {
                    item.status = "conflict".into();
                    item.code = "pack_alternate_source".into();
                    item.message="Another source shares this base filename with a canonical file. Its equivalence is unverified; explicitly select this row and keep both to save another edition. The complete original remains retained on commit.".into();
                } else if planned_hashes.contains(&hash) {
                    item.status = "ready".into();
                    item.code = "pack_duplicate_in_source".into();
                    item.message = "Duplicate canonical score within this source".into();
                } else if !keep_both
                    && (planned_ids.contains(&score_id)
                        || existing.iter().any(|e| e.score_id == score_id))
                {
                    item.status = "conflict".into();
                    item.code = "library_id_conflict".into();
                    item.message="A different edition has this score ID; explicitly keep both to save another edition".into();
                    item.entry = existing.iter().find(|e| e.score_id == score_id).cloned();
                } else if commit && selected.is_none_or(|i| i == index) {
                    let saved = if let Some(package) = &candidate.clean {
                        let folder = item.path.rsplit_once('/').map(|p| p.0).unwrap_or("");
                        let mut archive = ZipArchive::new(Cursor::new(bytes))
                            .map_err(|e| invalid(e.to_string()))?;
                        batch
                            .as_mut()
                            .ok_or_else(|| invalid("Clean import transaction missing"))?
                            .save(package, candidate.label, keep_both, |media| {
                                read_zip(
                                    &mut archive,
                                    &resolve(folder, &media.path)?,
                                    MAX_ENTRY_BYTES,
                                )
                            })
                    } else {
                        let request = SaveRequest {
                            score_json,
                            label: candidate.label,
                            allow_conflicting_id: keep_both,
                        };
                        if let Some(batch) = &mut batch {
                            batch.save_legacy(request)
                        } else {
                            library.save_locked(request)
                        }
                    };
                    match saved {
                        Ok(entry) => {
                            existing.push(entry.clone());
                            item.entry = Some(entry);
                            item.status = "saved".into();
                            item.code = "pack_saved".into();
                            item.message = if basic_keys {
                                basic_message
                            } else if performance_only {
                                "Saved complete performance with its independent native backup"
                            } else {
                                "Saved complete canonical score with its independent native backup"
                            }
                            .into();
                        }
                        Err(error) => {
                            item.status = match error.code {
                                "library_duplicate" => "duplicate",
                                "library_id_conflict" => "conflict",
                                _ => "error",
                            }
                            .into();
                            item.code = error.code.into();
                            item.message = clipped(&error.error, 4096);
                            item.entry = error.existing.map(|e| *e);
                        }
                    }
                }
                if performance_only {
                    item.message.push_str(" Complete independent performance commands retained for all tracks. Notation and practice targets are unavailable. Listening requires an explicitly selected, fully supported reference receiver.");
                }
                if basic_keys {
                    item.message.push_str(" Every source event and attack remains unchanged. Basic sine/pulse audition and selected-part note-on targets use the same declared FIFO/tempo interpretation. Inferred ends and zero gates are disclosed; percussion selectors do not identify an original kit. Original source-sound fidelity remains unresolved. Device range, receiver allocation and part selection require their own checks.");
                }
                if explicit_practice {
                    item.message.push_str(" All authored VSQ tracks and expressions are retained. Choose limited base-note instrumental practice explicitly; every authored note, including Dynamics 0, remains a practice target. Whole-vocal rendering is unsupported.");
                }
                if !commit {
                    planned_hashes.insert(hash);
                    planned_ids.insert(score_id);
                }
            }
        }
        if item.derivation.is_some() && matches!(item.status.as_str(), "saved" | "duplicate") {
            if let Some(entry) = &item.entry {
                item.title = entry.label.clone();
            }
        }
        plan.report.items.push(item);
    }
    drop(batch);
    for status in [
        "ready",
        "saved",
        "duplicate",
        "conflict",
        "retained_nonplayable",
        "error",
    ] {
        plan.report.summary.insert(
            status.into(),
            plan.report
                .items
                .iter()
                .filter(|i| i.status == status)
                .count(),
        );
    }
    plan.report
        .summary
        .insert("total".into(), plan.report.items.len());
    if commit {
        before_receipt().and_then(|()|storage::receipt_locked(library, &plan.report)).map_err(|e|fail(500,"library_commit_uncertain",format!("Original source retained and songs may be saved, but the final receipt could not be stored. Refresh before retrying: {}",e.error)))?;
    }
    Ok(plan.report)
}

fn header_filename(request: &http::Request<Vec<u8>>) -> Result<String> {
    let raw = request
        .headers()
        .get("x-wmh-filename")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("import.bin");
    let mut output = Vec::new();
    let b = raw.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = raw
                .get(i + 1..i + 3)
                .ok_or_else(|| invalid("Invalid encoded filename"))?;
            output.push(
                u8::from_str_radix(hex, 16).map_err(|_| invalid("Invalid encoded filename"))?,
            );
            i += 3;
        } else {
            output.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(output).map_err(|_| invalid("Filename must be UTF-8"))
}
pub fn dispatch(
    library: &NativeLibrary,
    request: &http::Request<Vec<u8>>,
) -> http::Response<Vec<u8>> {
    let path = request.uri().path();
    let result = (|| -> Result<http::Response<Vec<u8>>> {
        let value = match (request.method().as_str(), path) {
            ("POST", "/api/library/import/preview" | "/api/library/import/commit") => {
                let policy = request
                    .headers()
                    .get("x-wmh-conflict")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("skip");
                if !matches!(policy, "skip" | "keep-both") {
                    return Err(invalid("Conflict policy must be skip or keep-both"));
                }
                let selected = request
                    .headers()
                    .get("x-wmh-item-index")
                    .map(|v| {
                        v.to_str()
                            .ok()
                            .and_then(|s| s.parse().ok())
                            .ok_or_else(|| invalid("Song index must be a nonnegative integer"))
                    })
                    .transpose()?;
                serde_json::to_value(import(
                    library,
                    &header_filename(request)?,
                    request.body(),
                    path.ends_with("/commit"),
                    policy == "keep-both",
                    selected,
                )?)
                .map_err(|e| invalid(e.to_string()))?
            }
            ("GET", "/api/library/imports") => storage::history(
                library,
                request
                    .uri()
                    .query()
                    .and_then(|q| q.strip_prefix("cursor="))
                    .and_then(|c| c.parse().ok())
                    .unwrap_or(0),
            )?,
            ("POST", "/api/library/import/report") => {
                let v: Value =
                    serde_json::from_slice(request.body()).map_err(|e| invalid(e.to_string()))?;
                storage::report(
                    library,
                    v["archive_key"]
                        .as_str()
                        .ok_or_else(|| invalid("Archive key missing"))?,
                )?
            }
            ("POST", "/api/library/import/export") => {
                let v: Value =
                    serde_json::from_slice(request.body()).map_err(|e| invalid(e.to_string()))?;
                let bytes = storage::export(
                    library,
                    v["archive_key"]
                        .as_str()
                        .ok_or_else(|| invalid("Archive key missing"))?,
                )?;
                return Ok(crate::response(200, "application/octet-stream", bytes));
            }
            ("POST", "/api/library/pack/export") => return export_pack(library, request.body()),
            _ => {
                return Err(fail(
                    405,
                    "pack_method_not_allowed",
                    "Unsupported method for song-pack operation",
                ))
            }
        };
        let bytes = serde_json::to_vec(&value).map_err(|e| invalid(e.to_string()))?;
        if bytes.len() > 32 * 1024 * 1024 {
            return Err(fail(
                413,
                "pack_response_limit",
                "Import report exceeds 32 MiB",
            ));
        }
        Ok(crate::response(
            200,
            "application/json; charset=utf-8",
            bytes,
        ))
    })();
    result.unwrap_or_else(native_library::error_response)
}

fn export_pack(library: &NativeLibrary, bytes: &[u8]) -> Result<http::Response<Vec<u8>>> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Selection {
        keys: Vec<String>,
    }
    let selection: Selection = serde_json::from_slice(bytes).map_err(|e| invalid(e.to_string()))?;
    if selection.keys.is_empty() || selection.keys.len() > MAX_SONGS {
        return Err(invalid("Select 1–1024 canonical songs"));
    }
    let mut kinds = HashSet::new();
    for key in &selection.keys {
        kinds.insert(library.load(key)?.clean_package.is_some());
    }
    if kinds.len() > 1 {
        return Err(invalid(
            "Select clean v2 packages separately from legacy v1 scores",
        ));
    }
    if kinds.contains(&true) {
        return export_clean_pack(library, &selection.keys);
    }
    let mut seen = HashSet::new();
    let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mut folders = Vec::new();
    let mut expanded = 0usize;
    for key in selection.keys {
        if !seen.insert(key.clone()) {
            return Err(invalid("Duplicate song selection"));
        }
        let loaded = library.load(&key)?;
        let raw = loaded
            .score_json
            .as_deref()
            .ok_or_else(|| invalid("Complete performances require clean package export"))?;
        expanded += raw.len();
        if expanded > MAX_PACK_BYTES {
            return Err(fail(
                413,
                "pack_export_limit",
                "Export exceeds 128 MiB canonical payload; select fewer songs",
            ));
        }
        let folder = format!("songs/{key}");
        folders.push(json!({"folder":folder}));
        archive
            .start_file(format!("{folder}/score.json"), options)
            .map_err(|e| invalid(e.to_string()))?;
        archive
            .write_all(raw.as_bytes())
            .map_err(native_library::io_error)?;
        let metadata = json!({"format":"worldmusichub-song","version":1,"title":loaded.entry.title,"score":"score.json","sources":[],"media":{},"label":loaded.entry.label});
        archive
            .start_file(format!("{folder}/metadata.json"), options)
            .map_err(|e| invalid(e.to_string()))?;
        archive
            .write_all(&serde_json::to_vec_pretty(&metadata).map_err(|e| invalid(e.to_string()))?)
            .map_err(native_library::io_error)?;
    }
    archive
        .start_file("manifest.json", options)
        .map_err(|e| invalid(e.to_string()))?;
    archive
        .write_all(
            &serde_json::to_vec_pretty(
                &json!({"format":"worldmusichub-song-pack","version":1,"songs":folders}),
            )
            .map_err(|e| invalid(e.to_string()))?,
        )
        .map_err(native_library::io_error)?;
    let bytes = archive
        .finish()
        .map_err(|e| invalid(e.to_string()))?
        .into_inner();
    if bytes.len() > MAX_PACK_BYTES {
        return Err(fail(
            413,
            "pack_export_limit",
            "Compressed export exceeds 128 MiB",
        ));
    }
    Ok(crate::response(200, "application/zip", bytes))
}

fn clean_candidates(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    inventory: &Inventory,
    metadata: &[(String, Value)],
    manifest: Option<&(String, Value)>,
) -> Result<Vec<Candidate>> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Manifest {
        format: String,
        version: u32,
        songs: Vec<Folder>,
    }
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Folder {
        folder: String,
    }
    if metadata
        .iter()
        .any(|(_, v)| v["format"] != "worldmusichub-song" || v["version"] != 2)
    {
        return Err(invalid(
            "Clean v2 and legacy/source-only song folders must be separate",
        ));
    }
    let mut wanted = Vec::new();
    let mut used = HashSet::new();
    if let Some((path, value)) = manifest {
        zip_guard::safe_path(path, false).map_err(invalid)?;
        let pack_folder = path
            .rsplit_once('/')
            .map(|(folder, _)| folder)
            .unwrap_or("");
        let manifest: Manifest =
            serde_json::from_value(value.clone()).map_err(|e| invalid(e.to_string()))?;
        if manifest.format != "worldmusichub-song-pack"
            || manifest.version != 2
            || manifest.songs.is_empty()
            || manifest.songs.len() > MAX_SONGS
        {
            return Err(invalid("Invalid clean song-pack manifest"));
        }
        for song in manifest.songs {
            zip_guard::safe_path(&song.folder, false).map_err(invalid)?;
            if !used.insert(song.folder.to_ascii_lowercase()) {
                return Err(invalid("Repeated clean song folder"));
            }
            wanted.push(resolve(
                pack_folder,
                &format!("{}/metadata.json", song.folder),
            )?);
        }
    } else {
        if metadata.len() != 1 {
            return Err(invalid("Multiple clean songs require a v2 manifest"));
        }
        wanted.push(metadata[0].0.clone());
    }
    let folders: Vec<_> = wanted
        .iter()
        .map(|p| p.rsplit_once('/').map(|(folder, _)| folder).unwrap_or(""))
        .collect();
    if folders.iter().enumerate().any(|(i, a)| {
        folders
            .iter()
            .enumerate()
            .any(|(j, b)| i != j && (a.is_empty() || b.starts_with(&format!("{a}/"))))
    }) {
        return Err(invalid("Nested clean song folders are ambiguous"));
    }
    // No raw source, report, sidecar, unlisted song, or hidden extra may ride in
    // a clean transport outside one declared complete package.
    for file in &inventory.files {
        zip_guard::safe_path(&file.path, false).map_err(invalid)?;
        if manifest.is_some_and(|(path, _)| file.path == *path) {
            continue;
        }
        if !folders
            .iter()
            .any(|folder| folder.is_empty() || file.path.starts_with(&format!("{folder}/")))
        {
            return Err(invalid(format!(
                "Undeclared file outside clean song folders: {}",
                file.path
            )));
        }
    }
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|e| invalid(e.to_string()))?;
        if file.is_dir() {
            let directory = file.name().trim_end_matches('/');
            zip_guard::safe_path(directory, true).map_err(invalid)?;
            if !inventory
                .files
                .iter()
                .any(|f| f.path.starts_with(&format!("{directory}/")))
            {
                return Err(invalid(
                    "Empty or undeclared clean ZIP directories are forbidden",
                ));
            }
        }
    }
    let mut out = Vec::new();
    for path in wanted {
        let folder = path
            .rsplit_once('/')
            .map(|(folder, _)| folder)
            .unwrap_or("");
        let prefix = if folder.is_empty() {
            String::new()
        } else {
            format!("{folder}/")
        };
        let parsed = (|| {
            let metadata_bytes = read_zip(archive, &path, clean_package::MAX_METADATA_BYTES)?;
            let score_bytes = read_zip(
                archive,
                &format!("{prefix}score.json"),
                clean_package::MAX_JSON_BYTES,
            )?;
            let files = inventory
                .files
                .iter()
                .filter_map(|file| {
                    file.path
                        .strip_prefix(&prefix)
                        .map(|p| (p.to_string(), (file.bytes, file.sha256.clone())))
                })
                .collect();
            let package = clean_package::parse(&metadata_bytes, &score_bytes, &files)?;
            for media in &package.metadata.media {
                clean_package::verify_media(
                    media,
                    &read_zip(archive, &format!("{prefix}{}", media.path), MAX_ENTRY_BYTES)?,
                )?;
            }
            Ok::<_, LibraryError>(package)
        })();
        match parsed {
            Ok(package) => {
                let mut item = candidate(
                    path,
                    package.metadata.title.clone(),
                    None,
                    Ok(package.index_json().to_string()),
                );
                item.clean = Some(package);
                out.push(item);
            }
            Err(error) => out.push(candidate(path.clone(), path, None, Err(error.error))),
        }
    }
    Ok(out)
}

fn export_clean_pack(library: &NativeLibrary, keys: &[String]) -> Result<http::Response<Vec<u8>>> {
    let mut seen = HashSet::new();
    let mut archive = score_core::clean_pack::Writer::new();
    for key in keys {
        if !seen.insert(key) {
            return Err(invalid("Duplicate clean song selection"));
        }
        let files = clean_package::export_files(library, key)?;
        archive
            .add_song(&format!("songs/{key}"), files)
            .map_err(invalid)?;
    }
    let bytes = archive.finish().map_err(invalid)?;
    zip_guard::preflight(&bytes).map_err(invalid)?;
    Ok(crate::response(200, "application/zip", bytes))
}

#[cfg(test)]
mod recheck_budget_tests {
    use super::*;
    #[test]
    fn retained_midi_rechecks_stop_at_input_and_request_budgets() {
        let mut bytes = RecheckBudget::default();
        for _ in 0..16 {
            bytes
                .reserve(native_library::MAX_SCORE_BYTES as u64)
                .unwrap();
        }
        assert!(bytes.reserve(1).is_err());
        let mut requests = RecheckBudget::default();
        for _ in 0..MAX_SONGS {
            requests.reserve(1).unwrap();
        }
        assert!(requests.reserve(1).is_err());
    }
}
