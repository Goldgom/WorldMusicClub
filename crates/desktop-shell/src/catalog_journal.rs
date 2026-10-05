//! Host-only experimental catalog persistence. No route, scan, import or migration
//! calls this module. IDs and verified seed/payload availability are host duties.
//! A verified independent backup is the commit decision; incomplete stages are
//! retained. Unix directory sync gives the existing native durability guarantees;
//! Windows inherits process-crash recovery, not a power-loss directory guarantee.
use crate::{
    catalog::{self, Catalog, OperationId, Preview, Receipt},
    native_library::{
        check_node, create_directory_tree, digest, io_error, read_bounded, sync_directory,
        write_new, LibraryError, NativeLibrary,
    },
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

pub const FORMAT_VERSION: u32 = 1;
pub const MAX_TRANSACTION_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_GENERATIONS: usize = 4096;
const MAX_COPIES: usize = MAX_GENERATIONS * 2;
const MAX_NODES: usize = MAX_COPIES * 4 + 8;
const MAX_RECEIPT_BYTES: usize = catalog::MAX_STATE_BYTES;
const MAX_MANIFEST_BYTES: usize = 4096;
const AREAS: [&str; 3] = ["catalog", "catalog-backups", ".catalog-staging"];
const FILES: [&str; 3] = ["state.json", "receipt.json", "manifest.json"];
static STAGE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

type Result<T> = std::result::Result<T, Error>;
#[derive(Debug)]
pub enum Error {
    Storage(LibraryError),
    Core(catalog::Error),
    Recovery(&'static str),
    Capacity,
    NeverManaged,
}
impl From<LibraryError> for Error {
    fn from(error: LibraryError) -> Self {
        Self::Storage(error)
    }
}
impl From<catalog::Error> for Error {
    fn from(error: catalog::Error) -> Self {
        Self::Core(error)
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    /// No decision for this body is known. A Recovery cause still requires
    /// repair; this outcome alone does not promise an immediately usable retry.
    NotCommitted,
    /// Query/retry this exact operation ID. Publication may already be durable.
    CommitUncertain,
}
#[derive(Debug)]
pub struct CommitError {
    pub outcome: Outcome,
    pub operation_id: OperationId,
    pub cause: Error,
}
#[derive(Debug)]
pub struct Loaded {
    pub catalog: Catalog,
    pub manifest_sha256: String,
    pub recovered_primary_generations: usize,
    pub preserved_stages: usize,
}
#[derive(Debug)]
pub struct Committed {
    pub catalog: Catalog,
    pub receipt: Receipt,
    pub replayed: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Format {
    version: u32,
    genesis_manifest_sha256: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct FileDigest {
    bytes: u64,
    sha256: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    version: u32,
    generation: u64,
    operation_id: OperationId,
    previous_manifest_sha256: Option<String>,
    state: FileDigest,
    receipt: FileDigest,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields, rename_all = "snake_case")]
enum Record {
    Bootstrap {
        operation_id: OperationId,
        state_sha256: String,
    },
    Transition {
        receipt: Box<Receipt>,
    },
}
struct Generation {
    state: Vec<u8>,
    receipt: Vec<u8>,
    manifest: Vec<u8>,
    info: Manifest,
    catalog: Catalog,
    record: Record,
}
impl Generation {
    fn new(catalog: Catalog, record: Record, previous: Option<String>) -> Result<Self> {
        let state = json(catalog.snapshot())?;
        let receipt = json(&record)?;
        let operation_id = match &record {
            Record::Bootstrap { operation_id, .. } => operation_id.clone(),
            Record::Transition { receipt } => receipt.preview.request.operation_id.clone(),
        };
        let info = Manifest {
            version: FORMAT_VERSION,
            generation: catalog.snapshot().generation,
            operation_id,
            previous_manifest_sha256: previous,
            state: file_digest(&state),
            receipt: file_digest(&receipt),
        };
        let manifest = json(&info)?;
        if state.len() > catalog::MAX_STATE_BYTES
            || receipt.len() > MAX_RECEIPT_BYTES
            || manifest.len() > MAX_MANIFEST_BYTES
        {
            return Err(Error::Capacity);
        }
        Ok(Self {
            state,
            receipt,
            manifest,
            info,
            catalog,
            record,
        })
    }
    fn name(&self) -> String {
        format!(
            "{:020}-{}",
            self.info.generation,
            self.info.operation_id.as_str()
        )
    }
    fn bytes(&self) -> u64 {
        (self.state.len() + self.receipt.len() + self.manifest.len()) as u64
    }
    fn hash(&self) -> String {
        digest(&self.manifest)
    }
}
fn json(value: &impl Serialize) -> Result<Vec<u8>> {
    serde_json::to_vec(value).map_err(|_| Error::Recovery("Catalog JSON serialization failed"))
}
fn file_digest(bytes: &[u8]) -> FileDigest {
    FileDigest {
        bytes: bytes.len() as u64,
        sha256: digest(bytes),
    }
}
fn parse<T: for<'a> Deserialize<'a>>(bytes: &[u8]) -> Result<T> {
    serde_json::from_slice(bytes).map_err(|_| Error::Recovery("Malformed catalog JSON"))
}
fn exists(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(io_error(error).into()),
    }
}
fn children(path: &Path, limit: usize) -> Result<Vec<PathBuf>> {
    check_node(path, true)?;
    let mut result = Vec::new();
    for entry in fs::read_dir(path).map_err(io_error)? {
        if result.len() >= limit {
            return Err(Error::Capacity);
        }
        result.push(entry.map_err(io_error)?.path());
    }
    result.sort();
    Ok(result)
}
fn filename(path: &Path) -> Result<&str> {
    path.file_name()
        .and_then(|name| name.to_str())
        .ok_or(Error::Recovery("Non-UTF8 catalog path"))
}
fn generation_number(path: &Path) -> Result<u64> {
    let name = filename(path)?;
    let (number, operation) = name
        .split_once('-')
        .ok_or(Error::Recovery("Malformed generation name"))?;
    let generation: u64 = number
        .parse()
        .map_err(|_| Error::Recovery("Malformed generation number"))?;
    if number.len() != 20
        || format!("{generation:020}") != number
        || OperationId::parse(operation).is_err()
    {
        return Err(Error::Recovery("Malformed generation identity"));
    }
    Ok(generation)
}
#[derive(Default)]
struct Usage {
    bytes: u64,
    nodes: usize,
    copies: usize,
    stages: usize,
}
impl Usage {
    fn file(&mut self, path: &Path, bound: usize) -> Result<()> {
        check_node(path, false)?;
        let len = fs::symlink_metadata(path).map_err(io_error)?.len();
        if len > bound as u64 {
            return Err(Error::Capacity);
        }
        self.bytes = self.bytes.checked_add(len).ok_or(Error::Capacity)?;
        self.nodes += 1;
        self.check(0, 0)
    }
    fn check(&self, bytes: u64, copies: usize) -> Result<()> {
        if self
            .bytes
            .checked_add(bytes)
            .is_none_or(|total| total > MAX_TRANSACTION_BYTES)
            || self.copies + copies > MAX_COPIES
            || self.nodes + copies * 4 > MAX_NODES
        {
            Err(Error::Capacity)
        } else {
            Ok(())
        }
    }
}
// Fixed-depth inventory covers both copies AND every incomplete stage. No links,
// unknown children, unbounded traversal, or uncounted oversized sparse files.
fn usage(root: &Path) -> Result<Usage> {
    let mut usage = Usage::default();
    for area in AREAS {
        let path = root.join(area);
        if !exists(&path)? {
            continue;
        }
        usage.nodes += 1;
        if area == ".catalog-staging" {
            for stage in children(&path, MAX_COPIES)? {
                let name = filename(&stage)?;
                if !name.starts_with("stage-")
                    || name.len() > 128
                    || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                {
                    return Err(Error::Recovery("Malformed stage name"));
                }
                inventory_copy(&stage, &mut usage)?;
                usage.stages += 1;
            }
        } else {
            for child in children(&path, 2)? {
                match filename(&child)? {
                    "format.json" => usage.file(&child, MAX_MANIFEST_BYTES)?,
                    "commits" => {
                        usage.nodes += 1;
                        for commit in children(&child, MAX_GENERATIONS)? {
                            generation_number(&commit)?;
                            inventory_copy(&commit, &mut usage)?;
                        }
                    }
                    _ => return Err(Error::Recovery("Unknown catalog node")),
                }
            }
        }
    }
    usage.check(0, 0)?;
    Ok(usage)
}
fn inventory_copy(path: &Path, usage: &mut Usage) -> Result<()> {
    usage.copies += 1;
    usage.nodes += 1;
    usage.check(0, 0)?;
    for file in children(path, 3)? {
        let bound = match filename(&file)? {
            "state.json" => catalog::MAX_STATE_BYTES,
            "receipt.json" => MAX_RECEIPT_BYTES,
            "manifest.json" => MAX_MANIFEST_BYTES,
            _ => return Err(Error::Recovery("Unknown generation file")),
        };
        usage.file(&file, bound)?;
    }
    Ok(())
}
fn read_generation(path: &Path) -> Result<Generation> {
    check_node(path, true)?;
    if children(path, 3)?.len() != 3 {
        return Err(Error::Recovery("Incomplete committed generation"));
    }
    let manifest = read_bounded(&path.join("manifest.json"), MAX_MANIFEST_BYTES)?;
    let info: Manifest = parse(&manifest)?;
    if info.version != FORMAT_VERSION {
        return Err(Error::Recovery("Unsupported catalog storage version"));
    }
    let state = read_bounded(&path.join("state.json"), catalog::MAX_STATE_BYTES)?;
    let receipt = read_bounded(&path.join("receipt.json"), MAX_RECEIPT_BYTES)?;
    if file_digest(&state) != info.state || file_digest(&receipt) != info.receipt {
        return Err(Error::Recovery("Catalog generation hash mismatch"));
    }
    let catalog = Catalog::from_json(&state)?;
    let record: Record = parse(&receipt)?;
    // Require the exact canonical bytes produced by the core, not a normalized
    // interpretation of edited persisted data.
    if json(catalog.snapshot())? != state
        || json(&record)? != receipt
        || json(&info)? != manifest
        || catalog.snapshot().generation != info.generation
    {
        return Err(Error::Recovery("Catalog generation is not canonical"));
    }
    Ok(Generation {
        state,
        receipt,
        manifest,
        info,
        catalog,
        record,
    })
}
fn read_format(root: &Path) -> Result<Option<Format>> {
    let primary = root.join("catalog");
    let backup = root.join("catalog-backups");
    if !exists(&primary)? && !exists(&backup)? {
        return Ok(None);
    }
    // Missing either marker is damage/incomplete bootstrap, never fresh seed.
    let p = read_bounded(&primary.join("format.json"), MAX_MANIFEST_BYTES)?;
    let b = read_bounded(&backup.join("format.json"), MAX_MANIFEST_BYTES)?;
    if p != b {
        return Err(Error::Recovery("Conflicting catalog format markers"));
    }
    let format: Format = parse(&p)?;
    if format.version != FORMAT_VERSION || json(&format)? != p {
        return Err(Error::Recovery("Unsupported or malformed catalog format"));
    }
    Ok(Some(format))
}
fn commit_paths(root: &Path, area: &str) -> Result<BTreeMap<u64, PathBuf>> {
    let mut result = BTreeMap::new();
    for path in children(&root.join(area).join("commits"), MAX_GENERATIONS)? {
        let generation = generation_number(&path)?;
        if result.insert(generation, path).is_some() {
            return Err(Error::Recovery("Conflicting same-generation directories"));
        }
    }
    Ok(result)
}
fn verify_transition(
    current: &Generation,
    previous: Option<&Generation>,
    format: &Format,
) -> Result<()> {
    match (&current.record, previous) {
        (
            Record::Bootstrap {
                operation_id,
                state_sha256,
            },
            None,
        ) => {
            if current.info.generation != 0
                || current.info.previous_manifest_sha256.is_some()
                || operation_id != &current.info.operation_id
                || state_sha256 != &current.info.state.sha256
                || current.hash() != format.genesis_manifest_sha256
                || Catalog::from_seed(current.catalog.snapshot().inventory.clone())?
                    != current.catalog
            {
                return Err(Error::Recovery("Invalid catalog genesis"));
            }
        }
        (Record::Transition { receipt }, Some(previous)) => {
            if current.info.previous_manifest_sha256.as_deref() != Some(previous.hash().as_str())
                || current.info.operation_id != receipt.preview.request.operation_id
                || current.info.generation != previous.info.generation + 1
            {
                return Err(Error::Recovery("Catalog chain discontinuity"));
            }
            let applied = previous.catalog.apply(&receipt.preview)?;
            if applied.replayed
                || applied.catalog != current.catalog
                || applied.receipt != **receipt
            {
                return Err(Error::Recovery(
                    "Snapshot does not match catalog transition receipt",
                ));
            }
        }
        _ => return Err(Error::Recovery("Invalid catalog record order")),
    }
    Ok(())
}

/// Returns None only when neither catalog area exists. Stages alone are never
/// commits. Verifies the entire chain before recovering any missing primaries.
/// Never reads, changes, scans or validates song/source payloads.
pub fn load(library: &NativeLibrary) -> Result<Option<Loaded>> {
    let _lock = library.lock()?;
    load_locked(library)
}
fn load_locked(library: &NativeLibrary) -> Result<Option<Loaded>> {
    let root = &library.root;
    let mut usage = usage(root)?;
    let Some(format) = read_format(root)? else {
        return Ok(None);
    };
    let primary = commit_paths(root, "catalog")?;
    let backup = commit_paths(root, "catalog-backups")?;
    if backup.is_empty() {
        return Err(Error::Recovery("Managed catalog has no committed genesis"));
    }
    if primary
        .keys()
        .any(|generation| !backup.contains_key(generation))
    {
        return Err(Error::Recovery(
            "Primary generation lacks its commit-decision backup",
        ));
    }
    let mut previous: Option<Generation> = None;
    let mut missing = Vec::new();
    let mut seen_operations = BTreeSet::new();
    for (expected, (number, path)) in backup.iter().enumerate() {
        if *number != expected as u64 {
            return Err(Error::Recovery("Catalog generation gap"));
        }
        let generation = read_generation(path)?;
        if generation.name() != filename(path)?
            || !seen_operations.insert(generation.info.operation_id.clone())
        {
            return Err(Error::Recovery(
                "Catalog generation operation identity mismatch",
            ));
        }
        verify_transition(&generation, previous.as_ref(), &format)?;
        if let Some(path) = primary.get(number) {
            let other = read_generation(path)?;
            if filename(path)? != generation.name()
                || other.manifest != generation.manifest
                || other.state != generation.state
                || other.receipt != generation.receipt
            {
                return Err(Error::Recovery("Conflicting primary and backup generation"));
            }
        } else {
            missing.push((path.clone(), generation.bytes(), generation.hash()));
        }
        previous = Some(generation);
    }
    // A backup-first interruption usually leaves its complete primary stage.
    // Reuse only an independently verified exact match AFTER the entire chain
    // validates. This is repair of a committed decision, never stage promotion.
    // It avoids needing a third generation copy at the admitted quota boundary.
    let mut reusable = BTreeMap::new();
    if !missing.is_empty() && exists(&root.join(".catalog-staging"))? {
        let wanted: BTreeSet<_> = missing.iter().map(|(_, _, hash)| hash.as_str()).collect();
        for path in children(&root.join(".catalog-staging"), MAX_COPIES)? {
            if let Ok(candidate) = read_generation(&path) {
                let hash = candidate.hash();
                if wanted.contains(hash.as_str()) {
                    reusable.entry(hash).or_insert(path);
                }
            }
        }
    }
    let mut recovery_bytes = 0u64;
    let mut recovery_copies = 0;
    for (_, bytes, hash) in &missing {
        if !reusable.contains_key(hash) {
            recovery_bytes = recovery_bytes.checked_add(*bytes).ok_or(Error::Capacity)?;
            recovery_copies += 1;
        }
    }
    usage.check(recovery_bytes, recovery_copies)?;
    if !missing.is_empty() {
        create_directory_tree(&root.join(".catalog-staging"))?;
        sync_directory(root)?;
    }
    // No partial repair can hide bad newest history. Unmatched/incomplete stages
    // remain preserved and counted, even if their operation was never committed.
    for (path, _, hash) in &missing {
        let generation = read_generation(path)?;
        let staged = if let Some(path) = reusable.remove(hash) {
            let candidate = read_generation(&path)?;
            if candidate.state != generation.state
                || candidate.receipt != generation.receipt
                || candidate.manifest != generation.manifest
            {
                return Err(Error::Recovery(
                    "Recovery stage no longer matches committed backup",
                ));
            }
            // Matching visible bytes may come from an interrupted old write.
            // Flush every file and the stage before consuming it for recovery.
            for name in FILES {
                check_node(&path.join(name), false)?;
                OpenOptions::new()
                    .read(true)
                    .write(true)
                    .open(path.join(name))
                    .map_err(io_error)?
                    .sync_all()
                    .map_err(io_error)?;
            }
            sync_directory(&path)?;
            usage.stages -= 1;
            path
        } else {
            stage(root, &generation, &mut |_| Ok(()))?
        };
        let destination = root.join("catalog/commits").join(generation.name());
        fs::rename(staged, destination).map_err(io_error)?;
        sync_directory(&root.join("catalog/commits"))?;
        sync_directory(&root.join(".catalog-staging"))?;
    }
    let current = previous.ok_or(Error::Recovery("Missing catalog genesis"))?;
    Ok(Some(Loaded {
        manifest_sha256: current.hash(),
        catalog: current.catalog,
        recovered_primary_generations: missing.len(),
        preserved_stages: usage.stages,
    }))
}

/// Durable transition-operation lookup after lost responses or later operations.
/// Bootstrap IDs are not core receipts: resolve those by identical `initialize`.
pub fn lookup(library: &NativeLibrary, id: &OperationId) -> Result<Option<Receipt>> {
    Ok(load(library)?.and_then(|loaded| loaded.catalog.receipt(id).cloned()))
}

// Private boundaries support deterministic authored native I/O failure tests.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Boundary {
    BeforeFormatWrite(&'static str),
    AfterFormatSync(&'static str),
    BeforeRootSync,
    AfterRootSync,
    BeforeStage,
    BeforeFileWrite(&'static str),
    PartialFileWrite(&'static str),
    BeforeFileSync(&'static str),
    AfterFileSync(&'static str),
    BeforeStageSync,
    AfterStageSync,
    BeforeBackupRename,
    AfterBackupRename,
    AfterBackupParentSync,
    BeforePrimaryRename,
    AfterPrimaryRename,
    AfterPrimaryParentSync,
    BeforeResponse,
}
type Hook<'a> = dyn FnMut(Boundary) -> Result<()> + 'a;
fn stage(root: &Path, generation: &Generation, hook: &mut Hook<'_>) -> Result<PathBuf> {
    hook(Boundary::BeforeStage)?;
    let parent = root.join(".catalog-staging");
    let mut folder = None;
    for _ in 0..32 {
        let sequence = STAGE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!(
            "stage-{}-{}-{sequence}",
            generation.info.operation_id.as_str(),
            std::process::id()
        ));
        match fs::create_dir(&candidate) {
            Ok(()) => {
                folder = Some(candidate);
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(io_error(error).into()),
        }
    }
    let folder = folder.ok_or(Error::Recovery("Cannot allocate catalog stage"))?;
    for (name, bytes) in
        FILES
            .into_iter()
            .zip([&generation.state, &generation.receipt, &generation.manifest])
    {
        hook(Boundary::BeforeFileWrite(name))?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(folder.join(name))
            .map_err(io_error)?;
        let midpoint = bytes.len() / 2;
        file.write_all(&bytes[..midpoint]).map_err(io_error)?;
        hook(Boundary::PartialFileWrite(name))?;
        file.write_all(&bytes[midpoint..]).map_err(io_error)?;
        hook(Boundary::BeforeFileSync(name))?;
        file.sync_all().map_err(io_error)?;
        hook(Boundary::AfterFileSync(name))?;
    }
    hook(Boundary::BeforeStageSync)?;
    sync_directory(&folder)?;
    sync_directory(&parent)?;
    hook(Boundary::AfterStageSync)?;
    let verified = read_generation(&folder)?;
    if verified.manifest != generation.manifest {
        return Err(Error::Recovery("Staged catalog verification failed"));
    }
    Ok(folder)
}
fn publish(
    root: &Path,
    generation: &Generation,
    hook: &mut Hook<'_>,
    decided: &mut bool,
) -> Result<()> {
    let usage = usage(root)?;
    usage.check(generation.bytes().checked_mul(2).ok_or(Error::Capacity)?, 2)?;
    if generation.info.generation >= MAX_GENERATIONS as u64 {
        return Err(Error::Capacity);
    }
    let primary = stage(root, generation, hook)?;
    let backup = stage(root, generation, hook)?;
    let backup_parent = root.join("catalog-backups/commits");
    let primary_parent = root.join("catalog/commits");
    let backup_target = backup_parent.join(generation.name());
    let primary_target = primary_parent.join(generation.name());
    if exists(&backup_target)? || exists(&primary_target)? {
        return Err(Error::Recovery("Generation target already exists"));
    }
    hook(Boundary::BeforeBackupRename)?;
    fs::rename(backup, &backup_target).map_err(io_error)?;
    // From this point even a failed sync/read/response may have committed. Never
    // classify an error after rename as safely retryable with a fresh ID.
    *decided = true;
    hook(Boundary::AfterBackupRename)?;
    sync_directory(&backup_parent)?;
    sync_directory(&root.join(".catalog-staging"))?;
    hook(Boundary::AfterBackupParentSync)?;
    let verified = read_generation(&backup_target)?;
    if verified.manifest != generation.manifest {
        return Err(Error::Recovery("Published backup verification failed"));
    }
    hook(Boundary::BeforePrimaryRename)?;
    fs::rename(primary, &primary_target).map_err(io_error)?;
    hook(Boundary::AfterPrimaryRename)?;
    sync_directory(&primary_parent)?;
    sync_directory(&root.join(".catalog-staging"))?;
    hook(Boundary::AfterPrimaryParentSync)?;
    hook(Boundary::BeforeResponse)
}
fn commit_error(id: &OperationId, decided: bool, cause: Error) -> CommitError {
    CommitError {
        operation_id: id.clone(),
        outcome: if decided {
            Outcome::CommitUncertain
        } else {
            Outcome::NotCommitted
        },
        cause,
    }
}

/// Explicit bootstrap from host-verified inventory, not a migration. Repeating the
/// identical seed/ID resumes a fully marked precommit bootstrap or returns the
/// current later state. Damaged/missing markers are never repaired by reseeding.
pub fn initialize(
    library: &NativeLibrary,
    seed: Catalog,
    id: OperationId,
) -> std::result::Result<Loaded, CommitError> {
    initialize_with(library, seed, id, &mut |_| Ok(()))
}
fn initialize_with(
    library: &NativeLibrary,
    seed: Catalog,
    id: OperationId,
    hook: &mut Hook<'_>,
) -> std::result::Result<Loaded, CommitError> {
    // Until the native gate permits a verified lookup, an earlier call of this
    // operation may already have committed. Lock failure cannot prove absence.
    let mut decided = true;
    let result = (|| {
        let _lock = library.lock()?;
        if Catalog::from_seed(seed.snapshot().inventory.clone())? != seed {
            return Err(Error::Recovery(
                "Bootstrap requires generation-zero verified seed",
            ));
        }
        let generation = Generation::new(
            seed,
            Record::Bootstrap {
                operation_id: id.clone(),
                state_sha256: String::new(),
            },
            None,
        )?;
        let generation = Generation::new(
            generation.catalog,
            Record::Bootstrap {
                operation_id: id.clone(),
                state_sha256: generation.info.state.sha256,
            },
            None,
        )?;
        let format = Format {
            version: FORMAT_VERSION,
            genesis_manifest_sha256: generation.hash(),
        };
        let marker = json(&format)?;
        let root = &library.root;
        let existing_usage = usage(root)?;
        match read_format(root)? {
            Some(existing) => {
                if existing != format {
                    return Err(Error::Recovery("Bootstrap identity/seed conflict"));
                }
                if !commit_paths(root, "catalog-backups")?.is_empty() {
                    // The initialization decision is already visible even if load
                    // subsequently discovers damage; preserve uncertain outcome.
                    decided = true;
                    return load_locked(library)?.ok_or(Error::NeverManaged);
                }
                if !commit_paths(root, "catalog")?.is_empty() {
                    return Err(Error::Recovery("Bootstrap primary without backup"));
                }
                decided = false; // Both verified commit areas are empty.
            }
            None => {
                decided = false; // Neither managed catalog area exists.
                existing_usage.check(
                    generation.bytes().checked_mul(2).ok_or(Error::Capacity)?
                        + (marker.len() * 2) as u64,
                    2,
                )?;
                for area in AREAS {
                    create_directory_tree(&root.join(area))?;
                }
                for area in ["catalog-backups", "catalog"] {
                    let path = root.join(area);
                    create_directory_tree(&path.join("commits"))?;
                    hook(Boundary::BeforeFormatWrite(area))?;
                    write_new(&path.join("format.json"), &marker)?;
                    sync_directory(&path.join("commits"))?;
                    sync_directory(&path)?;
                    hook(Boundary::AfterFormatSync(area))?;
                }
            }
        }
        // Repeat ancestor and marker flushes on a fully marked precommit retry:
        // the earlier call may have failed before its first root-directory sync.
        for area in ["catalog-backups", "catalog"] {
            let path = root.join(area);
            check_node(&path.join("format.json"), false)?;
            OpenOptions::new()
                .read(true)
                .write(true)
                .open(path.join("format.json"))
                .map_err(io_error)?
                .sync_all()
                .map_err(io_error)?;
            sync_directory(&path.join("commits"))?;
            sync_directory(&path)?;
        }
        create_directory_tree(&root.join(".catalog-staging"))?;
        sync_directory(&root.join(".catalog-staging"))?;
        hook(Boundary::BeforeRootSync)?;
        sync_directory(root)?;
        hook(Boundary::AfterRootSync)?;
        publish(root, &generation, hook, &mut decided)?;
        Ok(Loaded {
            catalog: generation.catalog,
            manifest_sha256: format.genesis_manifest_sha256,
            recovered_primary_generations: 0,
            preserved_stages: existing_usage.stages,
        })
    })();
    result.map_err(|cause| commit_error(&id, decided, cause))
}

/// Applies and publishes exactly the frozen core preview under the native lock.
/// Same ID/body returns its recorded receipt without rewinding subsequent work.
pub fn commit(
    library: &NativeLibrary,
    preview: &Preview,
) -> std::result::Result<Committed, CommitError> {
    commit_with(library, preview, &mut |_| Ok(()))
}
fn commit_with(
    library: &NativeLibrary,
    preview: &Preview,
    hook: &mut Hook<'_>,
) -> std::result::Result<Committed, CommitError> {
    // Until the native gate permits a verified lookup, an earlier call of this
    // operation may already have committed. Lock failure cannot prove absence.
    let mut decided = true;
    let id = &preview.request.operation_id;
    let result = (|| {
        let _lock = library.lock()?;
        let Some(current) = load_locked(library)? else {
            decided = false;
            return Err(Error::NeverManaged);
        };
        decided = current
            .catalog
            .receipt(id)
            .is_some_and(|receipt| receipt.preview.request == preview.request);
        let applied = current.catalog.apply(preview)?;
        if applied.replayed {
            return Ok(Committed {
                catalog: applied.catalog,
                receipt: applied.receipt,
                replayed: true,
            });
        }
        // The bootstrap ID is reserved too, despite not being a core receipt.
        let genesis = commit_paths(&library.root, "catalog-backups")?
            .remove(&0)
            .ok_or(Error::Recovery("Missing genesis"))?;
        if read_generation(&genesis)?.info.operation_id == *id {
            return Err(Error::Core(catalog::Error::IdempotencyConflict));
        }
        let generation = Generation::new(
            applied.catalog,
            Record::Transition {
                receipt: Box::new(applied.receipt.clone()),
            },
            Some(current.manifest_sha256),
        )?;
        publish(&library.root, &generation, hook, &mut decided)?;
        Ok(Committed {
            catalog: generation.catalog,
            receipt: applied.receipt,
            replayed: false,
        })
    })();
    result.map_err(|cause| commit_error(id, decided, cause))
}

#[cfg(test)]
#[path = "catalog_journal_tests.rs"]
mod tests;
