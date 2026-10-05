//! Exact source retention, separate from playable canonical song folders.
use super::{invalid, Report, Result, Source, MAX_PACK_BYTES};
use crate::native_library::{
    check_node, create_directory_tree, digest, fail, io_error, read_bounded, sync_directory,
    write_new, NativeLibrary,
};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
const MAX_ARCHIVES: usize = 128;
const MAX_STORED_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_RETAINED_BYTES: u64 = 3 * 1024 * 1024 * 1024;
const MAX_REPORT_BYTES: usize = 32 * 1024 * 1024;
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
fn key_valid(key: &str) -> bool {
    key.len() == 69
        && key.starts_with("pack-")
        && key[5..]
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn areas(library: &NativeLibrary) -> Result<()> {
    for area in ["imports", "import-backups", ".import-staging"] {
        create_directory_tree(&library.root.join(area))?;
    }
    Ok(())
}
fn children(path: &Path, limit: usize) -> Result<Vec<PathBuf>> {
    check_node(path, true)?;
    let mut paths = Vec::new();
    for entry in fs::read_dir(path).map_err(io_error)? {
        if paths.len() >= limit {
            return Err(fail(
                413,
                "pack_storage_limit",
                "Too many retained import entries; existing files were preserved",
            ));
        }
        paths.push(entry.map_err(io_error)?.path());
    }
    paths.sort();
    Ok(paths)
}
fn retention_usage(library: &NativeLibrary) -> Result<u64> {
    let mut total = 0u64;
    for area in ["imports", "import-backups", ".import-staging"] {
        for folder in children(
            &library.root.join(area),
            if area == ".import-staging" {
                256
            } else {
                MAX_ARCHIVES + 1
            },
        )? {
            for file in children(&folder, 1024)? {
                check_node(&file, false)?;
                total = total
                    .checked_add(fs::metadata(file).map_err(io_error)?.len())
                    .ok_or_else(|| invalid("Retention sizes overflow"))?;
            }
        }
    }
    Ok(total)
}
fn room_for(library: &NativeLibrary, extra: u64) -> Result<()> {
    if retention_usage(library)?
        .checked_add(extra)
        .is_none_or(|n| n > MAX_RETAINED_BYTES)
    {
        return Err(fail(413,"pack_storage_limit","Retained originals, independent backups, receipts and interrupted stages are bounded to 3 GiB; existing data was preserved"));
    }
    Ok(())
}

fn descriptor(folder: &Path, key: &str) -> Result<Source> {
    check_node(folder, true)?;
    let source: Source = serde_json::from_slice(&read_bounded(&folder.join("source.json"), 4096)?)
        .map_err(|e| invalid(e.to_string()))?;
    if source.archive_key != key
        || source.sha256 != key[5..]
        || source.bytes > MAX_PACK_BYTES
        || !source.retained
    {
        return Err(invalid("Retained source identity is inconsistent"));
    }
    Ok(source)
}
fn verify(folder: &Path, key: &str, bytes: &[u8]) -> Result<()> {
    let source = descriptor(folder, key)?;
    let original = read_bounded(&folder.join("source.bin"), MAX_PACK_BYTES)?;
    if original != bytes || original.len() != source.bytes || digest(&original) != source.sha256 {
        return Err(fail(
            422,
            "pack_archive_corrupt",
            "Existing retained original failed its integrity check; nothing was overwritten",
        ));
    }
    Ok(())
}
fn stage(library: &NativeLibrary, report: &Report, bytes: &[u8]) -> Result<PathBuf> {
    let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let folder = library.root.join(".import-staging").join(format!(
        "{}-{}-{sequence}",
        report.source.archive_key,
        std::process::id()
    ));
    fs::create_dir(&folder).map_err(io_error)?;
    write_new(&folder.join("source.bin"), bytes)?;
    let mut source = report.source.clone();
    source.retained = true;
    write_new(
        &folder.join("source.json"),
        &serde_json::to_vec_pretty(&source).map_err(|e| invalid(e.to_string()))?,
    )?;
    write_new(
        &folder.join("inventory.json"),
        &serde_json::to_vec(&report.inventory).map_err(|e| invalid(e.to_string()))?,
    )?;
    sync_directory(&folder)?;
    Ok(folder)
}
pub(super) fn retain(library: &NativeLibrary, report: &Report, bytes: &[u8]) -> Result<()> {
    retain_with_copy_boundary(library, report, bytes, |_| Ok(()))
}

// A private copy-boundary callback lets tests fail deterministically between
// publications, without races, permission assumptions or renderer-controlled IO.
fn retain_with_copy_boundary(
    library: &NativeLibrary,
    report: &Report,
    bytes: &[u8],
    mut after_copy: impl FnMut(&str) -> Result<()>,
) -> Result<()> {
    let _lock = library.lock()?;
    areas(library)?;
    let key = &report.source.archive_key;
    let copies = ["imports", "import-backups"]
        .iter()
        .filter(|area| !library.root.join(area).join(key).exists())
        .count() as u64;
    // Reserve a worst-case receipt before any per-song save begins.
    room_for(
        library,
        copies * (bytes.len() as u64 + MAX_REPORT_BYTES as u64) + 2 * MAX_REPORT_BYTES as u64,
    )?;
    let entries = children(&library.root.join("imports"), MAX_ARCHIVES + 1)?;
    let mut total = 0u64;
    for path in &entries {
        check_node(path, true)?;
        let metadata = fs::symlink_metadata(path.join("source.bin")).map_err(io_error)?;
        check_node(&path.join("source.bin"), false)?;
        total = total
            .checked_add(metadata.len())
            .ok_or_else(|| invalid("Stored sizes overflow"))?;
    }
    let primary = library.root.join("imports").join(key);
    if !primary.exists()
        && (entries.len() >= MAX_ARCHIVES || total + bytes.len() as u64 > MAX_STORED_BYTES)
    {
        return Err(fail(413,"pack_storage_limit","Original-source retention is bounded to 128 archives and 1 GiB plus independent backups"));
    }
    // Publish exact source before any canonical song. A later failure leaves a
    // recoverable original and never makes an unsupported source playable.
    let mut confirmed_copy = false;
    let result = (|| {
        for area in ["import-backups", "imports"] {
            let target = library.root.join(area).join(key);
            match fs::symlink_metadata(&target) {
                Ok(_) => {
                    verify(&target, key, bytes)?;
                    confirmed_copy = true;
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    let stage = stage(library, report, bytes)?;
                    fs::rename(stage, &target).map_err(io_error)?;
                    // Rename has published a complete copy even when the next
                    // parent-directory sync fails or its response is lost.
                    confirmed_copy = true;
                    sync_directory(&library.root.join(area))?;
                }
                Err(e) => return Err(io_error(e)),
            }
            after_copy(area)?;
        }
        Ok(())
    })();
    result.map_err(|error| {
        if confirmed_copy {
            fail(500, "library_commit_uncertain", format!(
                "A complete original-source copy was published or verified, but retention did not finish. No canonical songs were saved by this attempt. Refresh import history before retrying: {}", error.error
            ))
        } else {
            error
        }
    })
}

pub(super) fn receipt(library: &NativeLibrary, report: &Report) -> Result<()> {
    let bytes = serde_json::to_vec(report).map_err(|e| invalid(e.to_string()))?;
    if bytes.len() > MAX_REPORT_BYTES {
        return Err(fail(
            413,
            "pack_report_limit",
            "Original retained, but import report exceeds 32 MiB",
        ));
    }
    let _lock = library.lock()?;
    room_for(library, 2 * bytes.len() as u64)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| invalid(e.to_string()))?
        .as_nanos();
    let name = format!(
        "report-{stamp:032}-{:020}.json",
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    for area in ["import-backups", "imports"] {
        let folder = library.root.join(area).join(&report.source.archive_key);
        check_node(&folder, true)?;
        if children(&folder, 1024)?.len() >= 1023 {
            return Err(fail(
                413,
                "pack_report_limit",
                "Original retained; this archive has reached its import-history limit",
            ));
        }
        let temp = folder.join(format!(".{name}"));
        write_new(&temp, &bytes)?;
        fs::rename(&temp, folder.join(&name)).map_err(io_error)?;
        sync_directory(&folder)?;
    }
    Ok(())
}
fn latest_report(folder: &Path, key: &str) -> Result<Option<Report>> {
    let source = descriptor(folder, key)?;
    let latest = children(folder, 1024)?.into_iter().rfind(|p| {
        p.file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with("report-") && n.ends_with(".json"))
    });
    let report = latest
        .map(|p| {
            read_bounded(&p, MAX_REPORT_BYTES).and_then(|b| {
                serde_json::from_slice::<Report>(&b).map_err(|e| invalid(e.to_string()))
            })
        })
        .transpose()?;
    if report.as_ref().is_some_and(|r| {
        r.source.archive_key != key || r.source.sha256 != source.sha256 || !r.source.retained
    }) {
        return Err(invalid("Import receipt identity is inconsistent"));
    }
    Ok(report)
}
pub(super) fn report(library: &NativeLibrary, key: &str) -> Result<Value> {
    if !key_valid(key) {
        return Err(invalid("Invalid retained archive key"));
    }
    let _lock = library.lock()?;
    serde_json::to_value(
        latest_report(&library.root.join("imports").join(key), key)?.ok_or_else(|| {
            fail(
                404,
                "pack_report_pending",
                "Original source exists but no complete report has been published",
            )
        })?,
    )
    .map_err(|e| invalid(e.to_string()))
}
pub(super) fn history(library: &NativeLibrary, cursor: usize) -> Result<Value> {
    let _lock = library.lock()?;
    areas(library)?;
    let folders = children(&library.root.join("imports"), MAX_ARCHIVES + 1)?;
    let mut imports = Vec::new();
    let mut issues = Vec::new();
    let mut next = cursor;
    let mut total = 0;
    for (i, folder) in folders.iter().enumerate().skip(cursor) {
        let key = folder.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !key_valid(key) {
            issues.push(json!({"code":"pack_unknown_archive","message":"Unrecognized retained import folder preserved"}));
            next = i + 1;
            continue;
        }
        match (|| -> Result<Value> {
            let source = descriptor(folder, key)?;
            let mut report = latest_report(folder, key)?;
            let count = report
                .as_ref()
                .map(|r| r.inventory.files.len())
                .unwrap_or(0);
            if let Some(report) = &mut report {
                report.inventory.files.clear();
            }
            Ok(
                json!({"archive_key":key,"filename":source.filename,"bytes":source.bytes,"sha256":source.sha256,"inventory_files":count,"report":report}),
            )
        })() {
            Ok(row) => {
                let size = serde_json::to_vec(&row)
                    .map_err(|e| invalid(e.to_string()))?
                    .len();
                if !imports.is_empty() && (imports.len() >= 10 || total + size > 16 * 1024 * 1024) {
                    break;
                }
                total += size;
                imports.push(row);
            }
            Err(e) => issues.push(json!({"archive_key":key,"code":e.code,"message":e.error})),
        }
        next = i + 1;
    }
    if cursor == 0 {
        let stages = children(&library.root.join(".import-staging"), 256)?;
        if !stages.is_empty() {
            issues.push(json!({"code":"pack_incomplete_stages","message":format!("{} interrupted original-source stages were preserved and excluded",stages.len())}));
        }
        for backup in children(&library.root.join("import-backups"), MAX_ARCHIVES + 1)? {
            if let Some(key) = backup.file_name().and_then(|n| n.to_str()) {
                if !library.root.join("imports").join(key).exists() {
                    issues.push(json!({"archive_key":key,"code":"pack_backup_only","message":"An independent original-source backup exists; reimport the original to recover its primary record"}));
                }
            }
        }
    }
    Ok(
        json!({"format":"worldmusichub-import-history","version":1,"imports":imports,"issues":issues,"next_cursor":if next<folders.len(){Some(next.to_string())}else{None}}),
    )
}
pub(super) fn export(library: &NativeLibrary, key: &str) -> Result<Vec<u8>> {
    if !key_valid(key) {
        return Err(invalid("Invalid retained archive key"));
    }
    let _lock = library.lock()?;
    let folder = library.root.join("imports").join(key);
    let source = descriptor(&folder, key)?;
    let bytes = read_bounded(&folder.join("source.bin"), MAX_PACK_BYTES)?;
    if bytes.len() != source.bytes || digest(&bytes) != source.sha256 {
        return Err(fail(
            422,
            "pack_archive_corrupt",
            "Retained original checksum mismatch; independent backup was preserved",
        ));
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Sandbox(PathBuf);
    impl Sandbox {
        fn new() -> Self {
            let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let root = std::env::temp_dir().join(format!(
                "wmh-pack-publication-{}-{}-{sequence}",
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

    fn fail_after_backup(area: &str) -> Result<()> {
        if area == "import-backups" {
            Err(io_error(std::io::Error::other(
                "Injected failure after backup and before primary publication",
            )))
        } else {
            Ok(())
        }
    }

    #[test]
    fn published_or_verified_backup_makes_later_failure_uncertain_and_retry_recovers() {
        let sandbox = Sandbox::new();
        let library = NativeLibrary::open(sandbox.0.join("Scores")).unwrap();
        let bytes = serde_json::to_vec(&score_core::catalog().remove(0)).unwrap();
        let plan = super::super::plan("original.json", &bytes).unwrap();
        let key = &plan.report.source.archive_key;
        let backup = library.root.join("import-backups").join(key);
        let primary = library.root.join("imports").join(key);

        // First attempt publishes the backup; second confirms that same valid
        // existing backup. Neither may claim that nothing was retained.
        let mut original_metadata = None;
        for _ in 0..2 {
            let error =
                retain_with_copy_boundary(&library, &plan.report, &bytes, fail_after_backup)
                    .unwrap_err();
            assert_eq!(error.code, "library_commit_uncertain");
            assert_eq!(error.status, 500);
            assert!(error.error.contains("No canonical songs were saved"));
            assert_eq!(fs::read(backup.join("source.bin")).unwrap(), bytes);
            let metadata = fs::read(backup.join("source.json")).unwrap();
            if let Some(expected) = &original_metadata {
                assert_eq!(&metadata, expected);
            }
            original_metadata = Some(metadata);
            assert!(!primary.exists());
            assert!(library.list().unwrap().entries.is_empty());
            let history = history(&library, 0).unwrap();
            assert_eq!(history["issues"][0]["code"], "pack_backup_only");
        }

        let recovered =
            super::super::import(&library, "original.json", &bytes, true, false, None).unwrap();
        assert!(recovered.source.retained);
        assert_eq!(recovered.summary["saved"], 1);
        assert_eq!(fs::read(primary.join("source.bin")).unwrap(), bytes);
        assert_eq!(fs::read(backup.join("source.bin")).unwrap(), bytes);
        assert_eq!(
            fs::read(backup.join("source.json")).unwrap(),
            original_metadata.unwrap()
        );
        assert!(history(&library, 0).unwrap()["issues"]
            .as_array()
            .unwrap()
            .is_empty());
        assert_eq!(export(&library, key).unwrap(), bytes);
        assert_eq!(library.list().unwrap().entries.len(), 1);
    }

    #[test]
    fn failure_before_any_confirmed_copy_keeps_definite_error() {
        let sandbox = Sandbox::new();
        let library = NativeLibrary::open(sandbox.0.join("Scores")).unwrap();
        let bytes = b"{malformed source retained only after successful publication";
        let plan = super::super::plan("source.json", bytes).unwrap();
        fs::write(library.root.join(".import-staging"), b"blocked").unwrap();
        let error = retain(&library, &plan.report, bytes).unwrap_err();
        assert_eq!(error.code, "library_unsafe_path");
        assert!(!library
            .root
            .join("import-backups")
            .join(&plan.report.source.archive_key)
            .exists());
        assert!(!library
            .root
            .join("imports")
            .join(&plan.report.source.archive_key)
            .exists());
        assert!(library.list().unwrap().entries.is_empty());
    }
}

// This reader is deliberately separate from the latest-report history API.
// It never creates import areas or recovers originals and requires the caller's
// existing library lock. Complete receipts in either independent copy are read
// once, all successful retries are unioned, and disagreements are excluded.
#[derive(Default)]
pub(crate) struct ReferenceCounts {
    pub receipts: usize,
    pub source_items: std::collections::BTreeSet<String>,
}
pub(crate) struct ReceiptProjection {
    pub packs: Vec<crate::native_library::pack_groups::Pack>,
    pub references: std::collections::BTreeMap<(String, String), ReferenceCounts>,
    pub issues: Vec<crate::native_library::pack_groups::QueryIssue>,
}

fn optional_children(path: &Path, limit: usize) -> Result<Vec<PathBuf>> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(io_error(error)),
        Ok(_) => children(path, limit),
    }
}
fn receipt_name(name: &str) -> bool {
    name.len() == 65
        && name.starts_with("report-")
        && name.ends_with(".json")
        && name.as_bytes()[7..39].iter().all(u8::is_ascii_digit)
        && name.as_bytes()[39] == b'-'
        && name.as_bytes()[40..60].iter().all(u8::is_ascii_digit)
}
fn hex_digest(hash: &str) -> bool {
    hash.len() == 64
        && hash
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn known_fields(value: &Value, names: &[&str]) -> Result<()> {
    if value
        .as_object()
        .is_none_or(|object| object.keys().any(|key| !names.contains(&key.as_str())))
    {
        return Err(invalid("Unknown or malformed receipt metadata"));
    }
    Ok(())
}
fn parse_projection_report(bytes: &[u8], source: &Source) -> Result<Report> {
    let value = serde_json::from_slice::<super::UniqueMetadata>(bytes)
        .map_err(|e| invalid(format!("Invalid receipt JSON: {e}")))?
        .0;
    known_fields(
        &value,
        &[
            "format",
            "version",
            "mode",
            "source",
            "items",
            "summary",
            "inventory",
            "warnings",
        ],
    )?;
    known_fields(
        &value["source"],
        &["filename", "sha256", "bytes", "retained", "archive_key"],
    )?;
    known_fields(&value["inventory"], &["files", "expanded_bytes"])?;
    if let Some(items) = value["items"].as_array() {
        for item in items {
            known_fields(
                item,
                &[
                    "index",
                    "path",
                    "title",
                    "status",
                    "code",
                    "message",
                    "playable",
                    "clean_package",
                    "derivation",
                    "entry",
                ],
            )?;
        }
    }
    if let Some(files) = value["inventory"]["files"].as_array() {
        for file in files {
            known_fields(file, &["path", "bytes", "sha256"])?;
        }
    }
    let report: Report = serde_json::from_value(value).map_err(|e| invalid(e.to_string()))?;
    if report.format != "worldmusichub-import-report"
        || report.version != 1
        || report.mode != "commit"
        || report.source.archive_key != source.archive_key
        || report.source.sha256 != source.sha256
        || report.source.bytes != source.bytes
        || !report.source.retained
        || report.source.filename.len() > 4096
        || report.items.len() > super::MAX_SONGS
        || report.inventory.files.len() > super::MAX_ZIP_ENTRIES
        || report.inventory.expanded_bytes > super::MAX_EXPANDED_BYTES
    {
        return Err(invalid(
            "Receipt version, committed source identity or bounds are inconsistent",
        ));
    }
    let mut paths = std::collections::BTreeSet::new();
    for file in &report.inventory.files {
        crate::native_library::clean_package::safe_path(&file.path)?;
        if !paths.insert(file.path.as_str())
            || !hex_digest(&file.sha256)
            || file.bytes > super::MAX_ENTRY_BYTES as u64
        {
            return Err(invalid(
                "Receipt inventory identity or bounds are inconsistent",
            ));
        }
    }
    let mut indexes = std::collections::BTreeSet::new();
    let mut item_paths = std::collections::BTreeSet::new();
    for item in &report.items {
        crate::native_library::clean_package::safe_path(&item.path)?;
        if item.index >= super::MAX_SONGS
            || !indexes.insert(item.index)
            || !item_paths.insert(item.path.as_str())
            || !paths.contains(item.path.as_str())
            || !matches!(
                item.status.as_str(),
                "saved" | "duplicate" | "conflict" | "ready" | "error" | "retained_nonplayable"
            )
        {
            return Err(invalid(
                "Receipt item identity, path or status is inconsistent",
            ));
        }
    }
    Ok(report)
}
fn verified_projection_source(
    folder: &Path,
    key: &str,
    scanned_source_bytes: &mut u64,
) -> Result<Source> {
    check_node(folder, true)?;
    let raw = serde_json::from_slice::<super::UniqueMetadata>(&read_bounded(
        &folder.join("source.json"),
        4096,
    )?)
    .map_err(|e| invalid(format!("Invalid retained source metadata: {e}")))?
    .0;
    known_fields(
        &raw,
        &["filename", "sha256", "bytes", "retained", "archive_key"],
    )?;
    let source = descriptor(folder, key)?;
    let original_path = folder.join("source.bin");
    check_node(&original_path, false)?;
    if fs::metadata(&original_path).map_err(io_error)?.len() != source.bytes as u64 {
        return Err(fail(
            422,
            "pack_archive_corrupt",
            "Retained original size disagrees with its validated descriptor",
        ));
    }
    if source.bytes as u64 > (2 * MAX_STORED_BYTES).saturating_sub(*scanned_source_bytes) {
        return Err(fail(413, "library_query_limit", "Retained original verification exceeds 2 GiB across both copies; no incomplete snapshot was published"));
    }
    *scanned_source_bytes += source.bytes as u64;
    if source.filename.len() > 4096 {
        return Err(invalid("Retained filename exceeds metadata bound"));
    }
    let original = read_bounded(&folder.join("source.bin"), MAX_PACK_BYTES)?;
    if original.len() != source.bytes || digest(&original) != source.sha256 {
        return Err(fail(
            422,
            "pack_archive_corrupt",
            "Retained original checksum mismatch; no membership was inferred",
        ));
    }
    Ok(source)
}

pub(crate) fn project_receipts_locked(
    library: &NativeLibrary,
    entries: &[crate::native_library::Entry],
) -> Result<ReceiptProjection> {
    use crate::native_library::pack_groups::{edition_id, Pack, QueryIssue};
    use std::collections::{BTreeMap, BTreeSet};
    const MAX_RECEIPT_SCAN_BYTES: usize = 128 * 1024 * 1024;
    const MAX_PROJECTED_REFERENCES: usize = 16384;
    let mut output = ReceiptProjection {
        packs: Vec::new(),
        references: BTreeMap::new(),
        issues: Vec::new(),
    };
    let mut archive_keys = BTreeSet::new();
    for area in ["imports", "import-backups"] {
        for path in optional_children(&library.root.join(area), MAX_ARCHIVES + 1)? {
            let key = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if key_valid(key) {
                archive_keys.insert(key.to_owned());
            } else {
                output.issues.push(QueryIssue::new(
                    "pack_unknown_archive",
                    "Unrecognized retained import folder preserved and excluded",
                    None,
                    None,
                ));
            }
        }
    }
    if archive_keys.len() > MAX_ARCHIVES {
        return Err(fail(
            413,
            "library_query_limit",
            "More than 128 retained archive identities; projection was not published",
        ));
    }
    let verified: BTreeMap<_, _> = entries
        .iter()
        .map(|entry| {
            (
                edition_id(entry),
                serde_json::to_value(entry).expect("verified entry"),
            )
        })
        .collect();
    let mut scanned_bytes = 0usize;
    let mut scanned_source_bytes = 0u64;
    let mut logical_reference_count = 0usize;
    for key in archive_keys {
        let primary = library.root.join("imports").join(&key);
        let backup = library.root.join("import-backups").join(&key);
        let primary_present = match fs::symlink_metadata(&primary) {
            Ok(_) => true,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(error) => return Err(io_error(error)),
        };
        let source_folder = if primary_present { &primary } else { &backup };
        let source =
            match verified_projection_source(source_folder, &key, &mut scanned_source_bytes) {
                Ok(source) => source,
                Err(error) if error.code == "library_query_limit" => return Err(error),
                Err(error) => {
                    output
                        .issues
                        .push(QueryIssue::new(error.code, error.error, Some(&key), None));
                    continue;
                }
            };
        let pack_id = format!("import-{}", source.sha256);
        let mut pack = Pack {
            pack_id: pack_id.clone(),
            archive_key: key.clone(),
            name: source.filename.clone(),
            source_bytes: source.bytes,
            song_count: 0,
            shared_song_count: 0,
            retained_only_count: 0,
            receipt_count: 0,
            issue_count: 0,
            provenance: "validated_receipts",
        };
        if !primary_present {
            output.issues.push(QueryIssue::new("pack_backup_only","Only an independently verified original backup is present; membership remains unresolved",Some(&key),None));
            pack.provenance = "unresolved";
            output.packs.push(pack);
            continue;
        }
        let backup_valid =
            match verified_projection_source(&backup, &key, &mut scanned_source_bytes) {
                Ok(other) if other.bytes == source.bytes && other.sha256 == source.sha256 => true,
                Ok(_) => {
                    output.issues.push(QueryIssue::new(
                        "pack_backup_invalid",
                        "Retained source copies disagree",
                        Some(&key),
                        None,
                    ));
                    false
                }
                Err(error) if error.code == "library_query_limit" => return Err(error),
                Err(error) => {
                    output.issues.push(QueryIssue::new(
                        "pack_backup_invalid",
                        error.error,
                        Some(&key),
                        None,
                    ));
                    false
                }
            };
        let mut names: BTreeMap<String, (Option<PathBuf>, Option<PathBuf>)> = BTreeMap::new();
        for (folder, is_backup) in [(&primary, false), (&backup, true)] {
            if is_backup && !backup_valid {
                continue;
            }
            for path in children(folder, 1024)? {
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if receipt_name(name) {
                    let pair = names.entry(name.to_owned()).or_default();
                    if is_backup {
                        pair.1 = Some(path);
                    } else {
                        pair.0 = Some(path);
                    }
                } else if name.starts_with("report-") || name.starts_with(".report-") {
                    output.issues.push(QueryIssue::new(
                        "pack_report_invalid_name",
                        "An incomplete or unrecognized receipt was excluded",
                        Some(&key),
                        None,
                    ));
                }
            }
        }
        let mut latest_items: BTreeMap<String, String> = BTreeMap::new();
        let mut linked_paths = BTreeSet::new();
        for (name, (first, second)) in names {
            let read = |path: &Path, scanned_bytes: &mut usize| -> Result<Vec<u8>> {
                check_node(path, false)?;
                let len = fs::metadata(path).map_err(io_error)?.len();
                if len > MAX_REPORT_BYTES as u64
                    || len as usize > MAX_RECEIPT_SCAN_BYTES.saturating_sub(*scanned_bytes)
                {
                    return Err(fail(413,"library_query_limit","All-receipt verification exceeds 128 MiB per refresh; no incomplete snapshot was published"));
                }
                *scanned_bytes += len as usize;
                read_bounded(path, MAX_REPORT_BYTES)
            };
            let parsed = (|| -> Result<Report> {
                let bytes = read(
                    first.as_ref().or(second.as_ref()).expect("receipt copy"),
                    &mut scanned_bytes,
                )?;
                if let (Some(_), Some(backup_receipt)) = (&first, &second) {
                    let other = read(backup_receipt, &mut scanned_bytes)?;
                    if bytes != other {
                        return Err(invalid("Independent copies of this receipt disagree"));
                    }
                }
                parse_projection_report(&bytes, &source)
            })();
            let report = match parsed {
                Ok(report) => report,
                Err(error) if error.code == "library_query_limit" => return Err(error),
                Err(error) => {
                    output.issues.push(QueryIssue::new(
                        "pack_receipt_invalid",
                        format!("Receipt {name}: {}", error.error),
                        Some(&key),
                        None,
                    ));
                    continue;
                }
            };
            if first.is_none() || second.is_none() {
                output.issues.push(QueryIssue::new(
                    "pack_receipt_single_copy",
                    format!("Receipt {name} is present in only one verified source copy"),
                    Some(&key),
                    None,
                ));
            }
            pack.receipt_count += 1;
            for item in report.items {
                latest_items.insert(item.path.clone(), item.status.clone());
                if !matches!(item.status.as_str(), "saved" | "duplicate") {
                    continue;
                }
                let Some(entry) = item.entry else {
                    output.issues.push(QueryIssue::new(
                        "pack_receipt_unresolved",
                        "Successful receipt item has no immutable edition reference",
                        Some(&key),
                        None,
                    ));
                    continue;
                };
                let id = edition_id(&entry);
                if verified.get(&id) != Some(&serde_json::to_value(&entry).expect("receipt entry"))
                {
                    output.issues.push(QueryIssue::new(
                        "pack_receipt_unresolved",
                        "Receipt edition does not match a verified physical song",
                        Some(&key),
                        Some(&entry.key),
                    ));
                    continue;
                }
                linked_paths.insert(item.path.clone());
                let counts = output.references.entry((pack_id.clone(), id)).or_default();
                counts.receipts += 1;
                if counts.source_items.insert(item.path) {
                    logical_reference_count += 1;
                }
                if logical_reference_count > MAX_PROJECTED_REFERENCES {
                    return Err(fail(413, "library_query_limit", "Logical source references exceed 16384; no incomplete projection was published"));
                }
            }
            if output.references.len() > MAX_PROJECTED_REFERENCES
                || latest_items.len() > super::MAX_ZIP_ENTRIES
                || output.issues.len() > 4096
            {
                return Err(fail(
                    413,
                    "library_query_limit",
                    "Receipt projection exceeds its bounded membership or issue capacity",
                ));
            }
        }
        for (path, status) in latest_items {
            if linked_paths.contains(&path) {
                continue;
            }
            if status == "retained_nonplayable" {
                pack.retained_only_count += 1;
            } else {
                output.issues.push(QueryIssue::new(
                    "pack_item_unresolved",
                    format!("Source item {path} remains {status}; no membership was inferred"),
                    Some(&key),
                    None,
                ));
            }
        }
        if pack.receipt_count == 0 {
            pack.provenance = "unresolved";
            output.issues.push(QueryIssue::new(
                "pack_report_pending",
                "Retained original has no validated complete import receipt",
                Some(&key),
                None,
            ));
        }
        output.packs.push(pack);
        if output.issues.len() > 4096 {
            return Err(fail(
                413,
                "library_query_limit",
                "Projection issue count exceeds 4096; no incomplete snapshot was published",
            ));
        }
    }
    if !optional_children(&library.root.join(".import-staging"), 256)?.is_empty() {
        output.issues.push(QueryIssue::new(
            "pack_incomplete_stages",
            "Interrupted original-source stages are preserved and excluded",
            None,
            None,
        ));
    }
    Ok(output)
}
