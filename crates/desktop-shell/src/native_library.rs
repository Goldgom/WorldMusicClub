//! Native, append-only score archives. Browser input never supplies a path.
//!
//! Each published song and its independent backup contains the exact submitted
//! canonical JSON, metadata, and an inert copy of the retained source payload.
//! The folders are the index; losing a cache cannot lose the library inventory.
#[path = "clean_package.rs"]
pub mod clean_package;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, MutexGuard, OnceLock, Weak,
    },
    time::{SystemTime, UNIX_EPOCH},
};

pub const MAX_SCORE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_LIBRARY_BYTES: usize = 256 * 1024 * 1024;
pub const MAX_ENTRIES: usize = 1024;
const MAX_METADATA_BYTES: usize = 64 * 1024;
const MAX_DIRECTORY_ITEMS: usize = 4096;
const VERSION: u32 = 1;
static STAGE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static PROCESS_LOCKS: OnceLock<Mutex<HashMap<PathBuf, Weak<ProcessLock>>>> = OnceLock::new();

#[derive(Debug, Default)]
struct ProcessLock {
    mutex: Mutex<()>,
    #[cfg(test)]
    waiting: std::sync::atomic::AtomicUsize,
}

fn process_lock(root: &Path) -> Result<Arc<ProcessLock>> {
    // Keep display/storage paths unchanged. Canonical identity lets independently
    // opened handles for the same verified directory share one process gate.
    let identity = fs::canonicalize(root).map_err(io_error)?;
    let mut locks = PROCESS_LOCKS
        .get_or_init(Mutex::default)
        .lock()
        .map_err(|_| {
            fail(
                500,
                "library_io",
                "Native storage coordination was interrupted; restart the app to recover",
            )
        })?;
    // No stale-root growth: the registry owns weak references only.
    locks.retain(|_, value| value.strong_count() != 0);
    if let Some(lock) = locks.get(&identity).and_then(Weak::upgrade) {
        return Ok(lock);
    }
    let lock = Arc::new(ProcessLock::default());
    locks.insert(identity, Arc::downgrade(&lock));
    Ok(lock)
}

#[derive(Clone, Debug, Serialize)]
pub struct LibraryError {
    pub code: &'static str,
    pub error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub existing: Option<Box<Entry>>,
    #[serde(skip)]
    pub status: u16,
}
type Result<T> = std::result::Result<T, LibraryError>;

pub(crate) fn fail(status: u16, code: &'static str, message: impl Into<String>) -> LibraryError {
    LibraryError {
        code,
        error: message.into(),
        existing: None,
        status,
    }
}
pub(crate) fn io_error(error: std::io::Error) -> LibraryError {
    fail(
        500,
        "library_io",
        format!("Native score storage failed: {error}"),
    )
}
fn corrupt(message: impl Into<String>) -> LibraryError {
    fail(422, "library_corrupt_entry", message)
}
pub(crate) fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RetainedSource {
    pub format: String,
    pub filename: Option<String>,
    pub bytes: usize,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    pub library_format_version: u32,
    /// Immutable archive revision. V1 deliberately has no replacement endpoint.
    pub revision: u32,
    pub key: String,
    pub content_sha256: String,
    pub score_sha256: String,
    pub score_bytes: usize,
    pub score_id: String,
    pub title: String,
    pub composer: String,
    pub label: String,
    pub saved_at_unix_ms: u64,
    pub provenance: score_core::Provenance,
    pub retained_source: Option<RetainedSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clean_package: Option<clean_package::Summary>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SaveRequest {
    /// JSON text, not a reserialized engine result: preserve it byte for byte.
    pub score_json: String,
    #[serde(default)]
    pub label: Option<String>,
    /// Explicitly keep another edition with the same score.id. Never overwrite.
    #[serde(default)]
    pub allow_conflicting_id: bool,
}

#[derive(Debug, Serialize)]
pub struct Issue {
    pub key: Option<String>,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct Inventory {
    pub storage: &'static str,
    pub library_format_version: u32,
    pub directory: String,
    pub entries: Vec<Entry>,
    /// Damaged/unsupported entries and interrupted stages are never hidden.
    pub issues: Vec<Issue>,
}

#[derive(Debug, Serialize)]
pub struct LoadedScore {
    pub entry: Entry,
    pub score_json: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clean_package: Option<clean_package::OpenPackage>,
}

#[derive(Debug)]
pub struct NativeLibrary {
    pub(crate) root: PathBuf,
    process_lock: Arc<ProcessLock>,
}

pub(crate) struct LibraryLock<'a> {
    file: File,
    // Released only after Drop explicitly unlocks the file, so another local
    // worker cannot race the OS unlock with its own nonblocking file acquisition.
    _process: MutexGuard<'a, ()>,
}
impl Drop for LibraryLock<'_> {
    fn drop(&mut self) {
        // Explicit unlock also releases an open-file-description lock when a
        // concurrently spawned child briefly inherits the descriptor before
        // exec closes it. Closing our descriptor alone can leave that lock held.
        let _ = self.file.unlock();
    }
}

/// This is process configuration, never a protocol request argument. No fallback
/// to the executable directory, current directory, or temporary storage.
pub fn default_directory() -> Result<PathBuf> {
    #[cfg(windows)]
    let root = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    #[cfg(target_os = "macos")]
    let root = std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join("Library/Application Support"));
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let root = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")));
    match root {
        Some(root) if root.is_absolute() => Ok(root.join("WorldMusicHub").join("Scores")),
        _ => Err(fail(
            503,
            "library_directory_unavailable",
            "The operating-system application data directory is unavailable",
        )),
    }
}

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_type().is_symlink() || metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    metadata.file_type().is_symlink()
}

pub(crate) fn check_node(path: &Path, directory: bool) -> Result<()> {
    let metadata = fs::symlink_metadata(path).map_err(io_error)?;
    if is_link(&metadata)
        || (directory && !metadata.is_dir())
        || (!directory && !metadata.is_file())
    {
        return Err(fail(
            422,
            "library_unsafe_path",
            "Library paths must be ordinary directories and files, without links or reparse points",
        ));
    }
    Ok(())
}

pub(crate) fn create_directory_tree(path: &Path) -> Result<()> {
    if !path.is_absolute() {
        return Err(fail(
            400,
            "library_unsafe_path",
            "The native library requires an absolute application-owned directory",
        ));
    }
    let mut current = PathBuf::new();
    for component in path.components() {
        if matches!(component, Component::ParentDir | Component::CurDir) {
            return Err(fail(
                400,
                "library_unsafe_path",
                "Relative path components are forbidden",
            ));
        }
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(_) => check_node(&current, true)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if let Err(error) = fs::create_dir(&current) {
                    if error.kind() != std::io::ErrorKind::AlreadyExists {
                        return Err(io_error(error));
                    }
                }
                check_node(&current, true)?;
            }
            Err(error) => return Err(io_error(error)),
        }
    }
    Ok(())
}

fn valid_key(key: &str) -> bool {
    key.len() == 69
        && key.starts_with("song-")
        && key[5..]
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub(crate) fn read_bounded(path: &Path, limit: usize) -> Result<Vec<u8>> {
    check_node(path, false)?;
    let file = File::open(path).map_err(io_error)?;
    let metadata = file.metadata().map_err(io_error)?;
    if metadata.len() > limit as u64 {
        return Err(corrupt("An archived file exceeds its size limit"));
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() > limit {
        return Err(corrupt("An archived file exceeds its size limit"));
    }
    Ok(bytes)
}

pub(crate) fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(io_error)?;
    file.write_all(bytes).map_err(io_error)?;
    file.sync_all().map_err(io_error)
}

pub(crate) fn sync_directory(path: &Path) -> Result<()> {
    // std does not expose a portable durable directory flush on Windows. Files
    // are flushed there; recovery covers process interruption, not power loss.
    #[cfg(unix)]
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(io_error)?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

pub(crate) fn checked_score(score_json: &str) -> Result<(score_core::Score, String)> {
    if score_json.len() > MAX_SCORE_BYTES {
        return Err(fail(
            413,
            "library_score_limit",
            "Canonical score JSON exceeds 8 MiB; no source was discarded",
        ));
    }
    let score: score_core::Score = serde_json::from_str(score_json).map_err(|error| {
        fail(
            400,
            "library_invalid_score",
            format!("Invalid or unsupported canonical score: {error}"),
        )
    })?;
    score_core::compile(score.clone())
        .map_err(|error| fail(400, "library_invalid_score", error))?;
    let identity = digest(&serde_json::to_vec(&score).map_err(|error| corrupt(error.to_string()))?);
    Ok((score, identity))
}

impl NativeLibrary {
    pub fn open_default() -> Result<Self> {
        Self::open(default_directory()?)
    }

    /// Native-host/test entry point only; no renderer endpoint accepts this path.
    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref().to_path_buf();
        create_directory_tree(&root)?;
        for name in ["songs", "backups", ".staging"] {
            create_directory_tree(&root.join(name))?;
        }
        let process_lock = process_lock(&root)?;
        Ok(Self { root, process_lock })
    }

    pub(crate) fn lock(&self) -> Result<LibraryLock<'_>> {
        // Windows invokes library operations on its bounded blocking-worker pool.
        // Queue legitimate local readers/writers here; never wait on an external
        // process's file lock or spin/retry an operation that may have committed.
        #[cfg(test)]
        self.process_lock.waiting.fetch_add(1, Ordering::SeqCst);
        let process = self.process_lock.mutex.lock();
        #[cfg(test)]
        self.process_lock.waiting.fetch_sub(1, Ordering::SeqCst);
        let process = process.map_err(|_| {
            fail(
                500,
                "library_io",
                "A native storage operation was interrupted; restart the app to recover",
            )
        })?;
        check_node(&self.root, true)?;
        for name in ["songs", "backups", ".staging"] {
            check_node(&self.root.join(name), true)?;
        }
        let path = self.root.join(".library.lock");
        match fs::symlink_metadata(&path) {
            Ok(_) => check_node(&path, false)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(io_error(error)),
        }
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path)
            .map_err(io_error)?;
        file.try_lock().map_err(|error| {
            fail(
                503,
                "library_busy",
                format!("The library is in use; retry shortly: {error}"),
            )
        })?;
        Ok(LibraryLock {
            file,
            _process: process,
        })
    }

    fn children(&self, directory: &str) -> Result<Vec<PathBuf>> {
        let mut paths = Vec::new();
        for entry in fs::read_dir(self.root.join(directory)).map_err(io_error)? {
            if paths.len() >= MAX_DIRECTORY_ITEMS {
                return Err(fail(
                    413,
                    "library_directory_limit",
                    "Too many directory entries to scan safely; existing files were preserved",
                ));
            }
            paths.push(entry.map_err(io_error)?.path());
        }
        paths.sort();
        Ok(paths)
    }

    fn load_folder(&self, folder: &Path, key: &str) -> Result<LoadedScore> {
        check_node(folder, true)?;
        let metadata = read_bounded(&folder.join("metadata.json"), MAX_METADATA_BYTES)?;
        let entry: Entry = serde_json::from_slice(&metadata)
            .map_err(|error| corrupt(format!("Invalid archive metadata: {error}")))?;
        if entry.library_format_version != VERSION
            || entry.revision != 1
            || entry.clean_package.is_some()
        {
            return Err(fail(
                422,
                "library_unsupported_version",
                "This archive requires a different library version; keep all files unchanged",
            ));
        }
        if entry.key != key || !valid_key(key) || entry.label.len() > 1024 {
            return Err(corrupt("Archive identity or label is invalid"));
        }
        let bytes = read_bounded(&folder.join("score.json"), MAX_SCORE_BYTES)?;
        if entry.score_bytes != bytes.len() || entry.score_sha256 != digest(&bytes) {
            return Err(corrupt(
                "The complete canonical score checksum or size does not match its metadata",
            ));
        }
        let score_json = String::from_utf8(bytes)
            .map_err(|_| corrupt("Archived canonical JSON is not UTF-8"))?;
        let (score, identity) = checked_score(&score_json).map_err(|error| corrupt(error.error))?;
        if entry.content_sha256 != identity
            || key != format!("song-{identity}")
            || entry.score_id != score.id
            || entry.title != score.title
            || entry.composer != score.composer
            || serde_json::to_value(&entry.provenance).ok()
                != serde_json::to_value(&score.provenance).ok()
        {
            return Err(corrupt(
                "Metadata does not describe the archived canonical score",
            ));
        }
        match (&entry.retained_source, &score.source) {
            (Some(retained), Some(source)) => {
                let payload = read_bounded(&folder.join("source.payload"), MAX_SCORE_BYTES)?;
                if payload != source.content.as_bytes()
                    || retained.bytes != payload.len()
                    || retained.sha256 != digest(&payload)
                    || retained.format != source.format
                    || retained.filename != source.filename
                {
                    return Err(corrupt(
                        "The retained source payload does not match the canonical source",
                    ));
                }
            }
            (None, None) => (),
            _ => {
                return Err(corrupt(
                    "The retained source descriptor is missing or unexpected",
                ))
            }
        }
        Ok(LoadedScore {
            entry,
            score_json,
            clean_package: None,
        })
    }

    fn stage(&self, loaded: &LoadedScore) -> Result<PathBuf> {
        let mut folder = None;
        for _ in 0..32 {
            let sequence = STAGE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let candidate = self.root.join(".staging").join(format!(
                "{}-{}-{sequence}",
                loaded.entry.key,
                std::process::id()
            ));
            match fs::create_dir(&candidate) {
                Ok(()) => {
                    folder = Some(candidate);
                    break;
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(io_error(error)),
            }
        }
        let folder = folder.ok_or_else(|| {
            fail(
                503,
                "library_stage_conflict",
                "Cannot allocate a new save stage; no existing files were changed",
            )
        })?;
        write_new(&folder.join("score.json"), loaded.score_json.as_bytes())?;
        let score: score_core::Score =
            serde_json::from_str(&loaded.score_json).map_err(|error| corrupt(error.to_string()))?;
        if let Some(source) = score.source {
            write_new(&folder.join("source.payload"), source.content.as_bytes())?;
        }
        let metadata =
            serde_json::to_vec_pretty(&loaded.entry).map_err(|error| corrupt(error.to_string()))?;
        if metadata.len() > MAX_METADATA_BYTES {
            return Err(corrupt("Archive metadata exceeds its size limit"));
        }
        // Metadata is the last file. No incomplete stage is a published song.
        write_new(&folder.join("metadata.json"), &metadata)?;
        sync_directory(&folder)?;
        Ok(folder)
    }

    fn publish(&self, staged: &Path, area: &str, key: &str) -> Result<()> {
        let destination = self.root.join(area).join(key);
        match fs::symlink_metadata(&destination) {
            Ok(_) => {
                return Err(fail(
                    409,
                    "library_path_conflict",
                    "The destination already exists; it was not overwritten",
                ))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(io_error(error)),
        }
        fs::rename(staged, destination).map_err(io_error)?;
        sync_directory(&self.root.join(area))
    }

    fn scan(&self) -> Result<Inventory> {
        let mut inventory = Inventory {
            storage: "native-filesystem",
            library_format_version: VERSION,
            directory: self.root.to_string_lossy().into_owned(),
            entries: Vec::new(),
            issues: Vec::new(),
        };
        for path in self.children("songs")? {
            let key = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("");
            if !valid_key(key) {
                inventory.issues.push(Issue {
                    key: None,
                    code: "library_unrecognized_entry".into(),
                    message: "An unrecognized song folder was preserved and excluded".into(),
                });
                continue;
            }
            match self.load_folder(&path, key) {
                Ok(loaded) => inventory.entries.push(loaded.entry),
                Err(error) => inventory.issues.push(Issue {
                    key: Some(key.into()),
                    code: error.code.into(),
                    message: error.error,
                }),
            }
        }
        // A backup committed before a interrupted primary rename is recoverable.
        // A damaged existing primary is NEVER silently overwritten by a backup.
        for path in self.children("backups")? {
            let key = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("");
            if !valid_key(key) {
                inventory.issues.push(Issue {
                    key: None,
                    code: "library_unrecognized_backup".into(),
                    message: "An unrecognized backup folder was preserved and excluded".into(),
                });
                continue;
            }
            match fs::symlink_metadata(self.root.join("songs").join(key)) {
                Ok(_) => {
                    if let Err(error) = self.load_folder(&path, key) {
                        inventory.issues.push(Issue {
                            key: Some(key.into()),
                            code: "library_backup_invalid".into(),
                            message: error.error,
                        });
                    }
                    continue;
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                Err(error) => return Err(io_error(error)),
            }
            match self.load_folder(&path, key).and_then(|loaded| {
                if inventory.entries.len() >= MAX_ENTRIES
                    || inventory
                        .entries
                        .iter()
                        .map(|entry| entry.score_bytes)
                        .sum::<usize>()
                        + loaded.entry.score_bytes
                        > MAX_LIBRARY_BYTES
                {
                    return Err(fail(
                        413,
                        "library_capacity",
                        "Recovery would exceed the library capacity; the backup was preserved",
                    ));
                }
                let stage = self.stage(&loaded)?;
                self.publish(&stage, "songs", key)?;
                Ok(loaded.entry)
            }) {
                Ok(entry) => {
                    inventory.entries.push(entry);
                    inventory.issues.push(Issue {
                        key: Some(key.into()),
                        code: "library_recovered_backup".into(),
                        message:
                            "Recovered a missing song folder from its complete verified backup"
                                .into(),
                    });
                }
                Err(error) => inventory.issues.push(Issue {
                    key: Some(key.into()),
                    code: "library_recovery_failed".into(),
                    message: error.error,
                }),
            }
        }
        for entry in &inventory.entries {
            if matches!(fs::symlink_metadata(self.root.join("backups").join(&entry.key)), Err(error) if error.kind() == std::io::ErrorKind::NotFound)
            {
                inventory.issues.push(Issue { key: Some(entry.key.clone()), code: "library_backup_missing".into(), message: "The independent backup folder is missing; export this score to preserve another copy".into() });
            }
        }
        let stages = self.children(".staging")?;
        if !stages.is_empty() {
            inventory.issues.push(Issue {
                key: None,
                code: "library_incomplete_stages".into(),
                message: format!(
                    "{} interrupted save stage(s) were preserved and excluded from the song list",
                    stages.len()
                ),
            });
        }
        clean_package::scan(self, &mut inventory)?;
        inventory.entries.sort_by(|a, b| a.key.cmp(&b.key));
        Ok(inventory)
    }

    pub fn list(&self) -> Result<Inventory> {
        let _lock = self.lock()?;
        self.scan()
    }

    pub fn save(&self, request: SaveRequest) -> Result<Entry> {
        let (score, content_sha256) = checked_score(&request.score_json)?;
        let label = request.label.unwrap_or_else(|| score.title.clone());
        if label.trim().is_empty() || label.len() > 1024 {
            return Err(fail(
                400,
                "library_invalid_label",
                "A label must contain 1–1024 UTF-8 bytes",
            ));
        }
        let _lock = self.lock()?;
        let inventory = self.scan()?;
        let key = format!("song-{content_sha256}");
        if let Some(existing) = inventory.entries.iter().find(|entry| entry.key == key) {
            let mut error = fail(
                409,
                "library_duplicate",
                "This exact canonical score and retained source are already saved",
            );
            error.existing = Some(Box::new(existing.clone()));
            return Err(error);
        }
        if !request.allow_conflicting_id {
            if let Some(existing) = inventory
                .entries
                .iter()
                .find(|entry| entry.score_id == score.id)
            {
                let mut error = fail(409, "library_id_conflict", "A different score with this score.id is already saved; explicitly save another edition to keep both");
                error.existing = Some(Box::new(existing.clone()));
                return Err(error);
            }
        }
        if inventory.entries.len() >= MAX_ENTRIES
            || inventory
                .entries
                .iter()
                .map(|entry| entry.score_bytes)
                .sum::<usize>()
                + request.score_json.len()
                > MAX_LIBRARY_BYTES
        {
            return Err(fail(413, "library_capacity", "The library limit is 1024 songs and 256 MiB of canonical JSON; no existing song was changed"));
        }
        for area in ["songs", "backups"] {
            match fs::symlink_metadata(self.root.join(area).join(&key)) {
                Ok(_) => return Err(fail(409, "library_path_conflict", "An existing archive occupies this content key; it was preserved without overwrite")),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                Err(error) => return Err(io_error(error)),
            }
        }
        let retained_source = score.source.as_ref().map(|source| RetainedSource {
            format: source.format.clone(),
            filename: source.filename.clone(),
            bytes: source.content.len(),
            sha256: digest(source.content.as_bytes()),
        });
        let entry = Entry {
            library_format_version: VERSION,
            revision: 1,
            key: key.clone(),
            content_sha256,
            score_sha256: digest(request.score_json.as_bytes()),
            score_bytes: request.score_json.len(),
            score_id: score.id,
            title: score.title,
            composer: score.composer,
            label,
            saved_at_unix_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|_| {
                    fail(
                        500,
                        "library_clock",
                        "The system clock is before the Unix epoch",
                    )
                })?
                .as_millis()
                .try_into()
                .map_err(|_| {
                    fail(
                        500,
                        "library_clock",
                        "The system clock is outside the supported range",
                    )
                })?,
            provenance: score.provenance,
            retained_source,
            clean_package: None,
        };
        let loaded = LoadedScore {
            entry: entry.clone(),
            score_json: request.score_json,
            clean_package: None,
        };
        // All payloads are synced before either directory becomes visible.
        let primary_stage = self.stage(&loaded)?;
        let backup_stage = self.stage(&loaded)?;
        if let Err(error) = self.publish(&backup_stage, "backups", &key) {
            if fs::symlink_metadata(self.root.join("backups").join(&key)).is_ok() {
                return Err(fail(500, "library_commit_uncertain", format!("Backup publication may have completed. Refresh the library to confirm or recover the save: {}", error.error)));
            }
            return Err(error);
        }
        if let Err(error) = self.publish(&primary_stage, "songs", &key) {
            return Err(fail(500, "library_commit_uncertain", format!("A complete backup exists, but primary publication failed. Refresh the library to recover or confirm this save: {}", error.error)));
        }
        Ok(entry)
    }

    pub fn load(&self, key: &str) -> Result<LoadedScore> {
        if !valid_key(key) {
            return Err(fail(
                400,
                "library_invalid_key",
                "A library key must be song- followed by 64 lowercase hexadecimal digits",
            ));
        }
        let _lock = self.lock()?;
        if let Some(loaded) = clean_package::load(self, key)? {
            return Ok(loaded);
        }
        let folder = self.root.join("songs").join(key);
        match fs::symlink_metadata(&folder) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(fail(
                    404,
                    "library_not_found",
                    "Saved score not found; refresh the library to check recovery",
                ))
            }
            Err(error) => return Err(io_error(error)),
            Ok(_) => (),
        }
        self.load_folder(&folder, key)
    }
}

pub fn is_library_route(path: &str) -> bool {
    path.starts_with("/api/library/")
}

pub fn error_response(error: LibraryError) -> http::Response<Vec<u8>> {
    crate::response(
        error.status,
        "application/json; charset=utf-8",
        serde_json::to_vec(&error).expect("library error JSON"),
    )
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct KeyRequest {
    key: String,
}

fn decode<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> Result<T> {
    serde_json::from_slice(bytes).map_err(|error| {
        fail(
            400,
            "library_invalid_request",
            format!("Invalid native library request: {error}"),
        )
    })
}

pub fn dispatch(
    library: &NativeLibrary,
    method: &str,
    path: &str,
    bytes: &[u8],
) -> http::Response<Vec<u8>> {
    if method == "POST" && path == "/api/library/asset" {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct AssetRequest {
            key: String,
            handle: String,
        }
        return match decode::<AssetRequest>(bytes)
            .and_then(|r| clean_package::asset(library, &r.key, &r.handle))
        {
            Ok((mime, bytes)) => crate::response(200, &mime, bytes),
            Err(error) => error_response(error),
        };
    }
    let result = match (method, path) {
        ("GET", "/api/library/list") => library.list().and_then(|inventory| serde_json::to_value(inventory).map_err(|error| corrupt(error.to_string()))),
        ("POST", "/api/library/save") => decode(bytes).and_then(|request| library.save(request)).and_then(|entry| serde_json::to_value(entry).map_err(|error| corrupt(error.to_string()))),
        ("POST", "/api/library/load" | "/api/library/export") => decode::<KeyRequest>(bytes).and_then(|request| library.load(&request.key)).and_then(|loaded| {
            if path.ends_with("/export") && loaded.clean_package.is_some() {
                Err(fail(409, "library_clean_export_required", "Use clean song-pack export to preserve the complete semantic score and every runtime asset"))
            } else if path.ends_with("/export") {
                Ok(serde_json::json!({"format":"worldmusichub-native-score-backup", "version":1, "entry":loaded.entry, "score_json":loaded.score_json}))
            } else {
                serde_json::to_value(loaded).map_err(|e| corrupt(e.to_string()))
            }
        }),
        (_, "/api/library/list" | "/api/library/save" | "/api/library/load" | "/api/library/export" | "/api/library/asset") => Err(fail(405, "library_method_not_allowed", "Unsupported method for this library operation")),
        _ => Err(fail(404, "library_unknown_route", "Unknown native library operation")),
    };
    match result {
        Ok(value) => {
            let bytes = serde_json::to_vec(&value).expect("library JSON");
            if bytes.len() > 32 * 1024 * 1024 {
                error_response(fail(
                    413,
                    "library_response_limit",
                    "Complete native library response exceeds 32 MiB",
                ))
            } else {
                crate::response(200, "application/json; charset=utf-8", bytes)
            }
        }
        Err(error) => error_response(error),
    }
}

#[cfg(test)]
mod concurrency_tests {
    use super::*;
    use http::Request;
    use serde_json::{json, Value};
    use std::{
        sync::{mpsc, Barrier},
        thread,
        time::{Duration, Instant},
    };

    struct Sandbox(PathBuf);
    impl Sandbox {
        fn new() -> Self {
            let sequence = STAGE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let root = std::env::temp_dir().join(format!(
                "wmh-native-queue-{}-{}-{sequence}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
    }
    impl Drop for Sandbox {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    fn authored_score(id: &str) -> String {
        let mut score = score_core::catalog().remove(0);
        score.id = id.into();
        serde_json::to_string(&score).unwrap()
    }

    fn request(method: &str, path: &str, body: Vec<u8>) -> Request<Vec<u8>> {
        Request::builder()
            .method(method)
            .uri(format!("{}{path}", crate::ORIGIN))
            .header("content-type", "application/json")
            .header("x-wmh-filename", "original.json")
            .body(body)
            .unwrap()
    }

    #[test]
    fn startup_read_preview_save_and_history_queue_across_handles_and_clones() {
        let sandbox = Sandbox::new();
        let root = sandbox.0.join("Scores");
        let library = Arc::new(NativeLibrary::open(&root).unwrap());
        let second = Arc::new(NativeLibrary::open(&root).unwrap());
        assert!(Arc::ptr_eq(&library.process_lock, &second.process_lock));
        let unrelated = NativeLibrary::open(sandbox.0.join("OtherScores")).unwrap();
        assert!(!Arc::ptr_eq(&library.process_lock, &unrelated.process_lock));

        let imported = authored_score("queued-import");
        let saved = authored_score("queued-save");
        let another = authored_score("queued-next-preview");
        let expected_scores = HashMap::from([
            ("queued-import", imported.clone()),
            ("queued-save", saved.clone()),
        ]);
        let cases = vec![
            (library.clone(), request("GET", "/api/library/list", vec![])),
            (
                second.clone(),
                request(
                    "POST",
                    "/api/library/import/preview",
                    imported.as_bytes().to_vec(),
                ),
            ),
            (
                library.clone(),
                request(
                    "POST",
                    "/api/library/save",
                    serde_json::to_vec(&json!({"score_json":saved})).unwrap(),
                ),
            ),
            (
                second.clone(),
                request("GET", "/api/library/imports", vec![]),
            ),
            (
                library.clone(),
                request("POST", "/api/library/import/preview", another.into_bytes()),
            ),
            (
                second.clone(),
                request(
                    "POST",
                    "/api/library/import/commit",
                    imported.as_bytes().to_vec(),
                ),
            ),
        ];
        let count = cases.len();
        let start = Arc::new(Barrier::new(count + 1));
        let (completed, completion) = mpsc::channel();
        let held = library.lock().unwrap();
        // A held root does not block another configured native library.
        assert!(unrelated.list().unwrap().entries.is_empty());
        let handles: Vec<_> = cases
            .into_iter()
            .enumerate()
            .map(|(index, (handle, request))| {
                let start = start.clone();
                let completed = completed.clone();
                let root = root.clone();
                thread::spawn(move || {
                    start.wait();
                    // Include initialization racing immediate first-use requests.
                    let opened = (index == 5).then(|| NativeLibrary::open(root).unwrap());
                    let response =
                        crate::dispatch_with_library(request, opened.as_ref().unwrap_or(&handle));
                    completed.send(index).unwrap();
                    (
                        response.status().as_u16(),
                        serde_json::from_slice::<Value>(response.body()).unwrap(),
                    )
                })
            })
            .collect();
        start.wait();
        let deadline = Instant::now() + Duration::from_secs(5);
        while library.process_lock.waiting.load(Ordering::SeqCst) != count
            && Instant::now() < deadline
        {
            thread::yield_now();
        }
        // Unlike a sequential or merely barrier-started test, this observes all
        // six threads inside acquisition while the first lock is still held.
        let waiting = library.process_lock.waiting.load(Ordering::SeqCst);
        let premature = completion.try_recv().ok();
        drop(held);
        let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        assert_eq!(
            waiting, count,
            "Every real request must reach the held process gate"
        );
        assert!(
            premature.is_none(),
            "No request should return self-contention as library_busy"
        );
        for (status, body) in &results {
            assert_eq!(*status, 200, "{body}");
        }
        assert_eq!(results[5].1["summary"]["saved"], 1);
        assert_eq!(library.list().unwrap().entries.len(), 2);
        let history =
            crate::dispatch_with_library(request("GET", "/api/library/imports", vec![]), &library);
        let history: Value = serde_json::from_slice(history.body()).unwrap();
        assert_eq!(history["imports"].as_array().unwrap().len(), 1);
        assert!(history["issues"].as_array().unwrap().is_empty());

        // Rapid subsequent selections remain usable after the queued activity.
        for _ in 0..3 {
            let response = crate::dispatch_with_library(
                request(
                    "POST",
                    "/api/library/import/preview",
                    imported.as_bytes().to_vec(),
                ),
                &second,
            );
            assert_eq!(response.status(), 200);
            let body: Value = serde_json::from_slice(response.body()).unwrap();
            assert_eq!(body["summary"]["duplicate"], 1);
        }
        let reopened = NativeLibrary::open(root).unwrap();
        let entries = reopened.list().unwrap().entries;
        assert_eq!(entries.len(), 2);
        for entry in entries {
            assert_eq!(
                reopened.load(&entry.key).unwrap().score_json,
                expected_scores[entry.score_id.as_str()]
            );
        }
    }

    #[test]
    fn registry_does_not_keep_unused_library_roots_alive() {
        let sandbox = Sandbox::new();
        let root = sandbox.0.join("TransientScores");
        let weak = {
            let library = NativeLibrary::open(&root).unwrap();
            Arc::downgrade(&library.process_lock)
        };
        assert!(weak.upgrade().is_none());
        let _next = NativeLibrary::open(sandbox.0.join("NextScores")).unwrap();
        let identity = fs::canonicalize(root).unwrap();
        assert!(!PROCESS_LOCKS
            .get()
            .unwrap()
            .lock()
            .unwrap()
            .contains_key(&identity));
    }

    #[test]
    fn cross_process_busy_probe() {
        let Some(root) = std::env::var_os("WMH_NATIVE_QUEUE_BUSY_ROOT") else {
            return;
        };
        let library = NativeLibrary::open(root).unwrap();
        let error = library.list().unwrap_err();
        assert_eq!(error.status, 503);
        assert_eq!(error.code, "library_busy");
    }

    #[test]
    fn another_process_still_gets_retryable_busy_without_waiting_on_the_gate() {
        let sandbox = Sandbox::new();
        let root = sandbox.0.join("Scores");
        let library = NativeLibrary::open(&root).unwrap();
        let held = library.lock().unwrap();
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "native_library::concurrency_tests::cross_process_busy_probe",
                "--nocapture",
            ])
            .env("WMH_NATIVE_QUEUE_BUSY_ROOT", &root)
            .status()
            .unwrap();
        drop(held);
        assert!(status.success());
        assert!(library.list().unwrap().entries.is_empty());
    }
}
