//! Advisory, read-only grouping of verified immutable editions and import receipts.
//! The cache is shared by handles for one root. Only an explicit refresh hashes
//! payloads; existing authoritative list/load/export checks remain unchanged.
use super::{digest, fail, Entry, NativeLibrary, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::time::{SystemTime, UNIX_EPOCH};

pub const REQUEST_LIMIT: usize = 4096;
const RESPONSE_LIMIT: usize = 4 * 1024 * 1024;

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Query {
    pub view: String,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub pack_id: Option<String>,
    #[serde(default)]
    pub unfiled: bool,
    #[serde(default)]
    pub duplicate_kind: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: usize,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub refresh: bool,
}
fn default_limit() -> usize {
    40
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct QueryIssue {
    pub issue_id: String,
    pub code: String,
    pub message: String,
    pub archive_key: Option<String>,
    pub song_key: Option<String>,
}
impl QueryIssue {
    pub(crate) fn new(
        code: impl Into<String>,
        message: impl Into<String>,
        archive_key: Option<&str>,
        song_key: Option<&str>,
    ) -> Self {
        let (code, message) = (code.into(), message.into());
        let identity =
            serde_json::to_vec(&(&code, &message, archive_key, song_key)).expect("issue identity");
        Self {
            issue_id: format!("issue-{}", digest(&identity)),
            code,
            message,
            archive_key: archive_key.map(str::to_owned),
            song_key: song_key
                .filter(|key| super::valid_key(key))
                .map(str::to_owned),
        }
    }
}
#[derive(Clone, Debug, Serialize)]
pub(crate) struct Pack {
    pub pack_id: String,
    pub archive_key: String,
    pub name: String,
    pub song_count: usize,
    pub shared_song_count: usize,
    pub retained_only_count: usize,
    pub receipt_count: usize,
    pub issue_count: usize,
    pub source_bytes: usize,
    pub provenance: &'static str,
}
#[derive(Clone, Debug, Serialize)]
struct PackName {
    pack_id: String,
    name: String,
}
#[derive(Clone, Debug, Serialize)]
struct Song {
    edition_id: String,
    key: String,
    storage_kind: &'static str,
    content_sha256: String,
    score_id: String,
    title: String,
    composer: String,
    profile: String,
    pack_ids: Vec<String>,
    packs: Vec<PackName>,
    pack_count: usize,
    receipt_reference_count: usize,
    source_reference_count: usize,
}
#[derive(Clone, Debug, Serialize)]
struct Duplicate {
    group_id: String,
    kind: &'static str,
    evidence_type: &'static str,
    r#match: String,
    edition_count: usize,
    pack_count: usize,
    reference_count: usize,
    editions: Vec<Song>,
}
#[derive(Debug)]
pub(crate) struct Projection {
    snapshot_id: String,
    catalog_manifest_sha256: Option<String>,
    verified_at_unix_ms: u64,
    packs: Vec<Pack>,
    songs: Vec<Song>,
    duplicates: Vec<Duplicate>,
    issues: Vec<QueryIssue>,
    summary: Value,
}

pub(crate) fn edition_id(entry: &Entry) -> String {
    format!("{}:{}", storage_kind(entry), entry.key)
}
fn storage_kind(entry: &Entry) -> &'static str {
    if entry.clean_package.is_some() {
        "clean"
    } else {
        "legacy"
    }
}
fn normalized(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
fn invalid(message: &str) -> super::LibraryError {
    fail(400, "library_invalid_request", message)
}
fn stale() -> super::LibraryError {
    fail(
        409,
        "library_snapshot_stale",
        "This metadata snapshot changed; refresh and restart pagination",
    )
}

impl Query {
    fn validate(&self) -> Result<()> {
        if !matches!(
            self.view.as_str(),
            "packs" | "songs" | "duplicates" | "issues"
        ) || !(1..=100).contains(&self.limit)
            || self.search.len() > 256
            || self.pack_id.as_ref().is_some_and(|id| {
                id.len() != 71
                    || !id.starts_with("import-")
                    || !id[7..]
                        .bytes()
                        .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            })
            || self
                .duplicate_kind
                .as_deref()
                .is_some_and(|kind| !matches!(kind, "exact_content" | "same_id" | "same_title"))
            || (self.refresh && self.cursor.is_some())
            || (self.pack_id.is_some() && self.unfiled)
            || (self.pack_id.is_some() && !matches!(self.view.as_str(), "songs" | "issues"))
            || (self.unfiled && self.view != "songs")
            || (self.duplicate_kind.is_some() && self.view != "duplicates")
        {
            return Err(invalid(
                "Invalid metadata view, filter, limit or refresh cursor",
            ));
        }
        Ok(())
    }
    fn filter_id(&self) -> String {
        digest(
            &serde_json::to_vec(&(
                &self.view,
                &self.search,
                &self.pack_id,
                self.unfiled,
                &self.duplicate_kind,
                self.limit,
            ))
            .expect("query identity"),
        )
    }
}

fn build(
    library: &NativeLibrary,
    managed: Option<&crate::catalog_journal::Loaded>,
) -> Result<Projection> {
    // Caller already holds the library lock. Do not call public list or history.
    let inventory = library.scan()?;
    if inventory.entries.len() > super::MAX_ENTRIES {
        return Err(fail(
            413,
            "library_query_limit",
            "Verified metadata inventory exceeds the 1024-edition query limit",
        ));
    }
    let mut issues: Vec<_> = inventory
        .issues
        .into_iter()
        .map(|issue| QueryIssue::new(issue.code, issue.message, None, issue.key.as_deref()))
        .collect();
    let evidence = crate::song_pack::storage::project_receipts_locked(library, &inventory.entries)?;
    issues.extend(evidence.issues);
    let mut packs = evidence.packs;
    let pack_names: BTreeMap<_, _> = packs
        .iter()
        .map(|pack| (pack.pack_id.clone(), pack.name.clone()))
        .collect();
    let mut by_edition: BTreeMap<
        String,
        Vec<(String, crate::song_pack::storage::ReferenceCounts)>,
    > = BTreeMap::new();
    for ((pack_id, edition), counts) in evidence.references {
        by_edition
            .entry(edition)
            .or_default()
            .push((pack_id, counts));
    }
    let catalog = managed.map(|loaded| &loaded.catalog.snapshot().inventory);
    let managed_songs: BTreeMap<_, _> = catalog
        .into_iter()
        .flat_map(|catalog| &catalog.songs)
        .map(|song| (song.id.as_str(), song))
        .collect();
    // Query v1 retains its import-<sha256> identities. Catalog collections are
    // mapped only through immutable archive keys; receipt scans never recreate
    // a removed edge or add a post-bootstrap edition to the managed graph.
    let mut active_pack_sources = BTreeMap::new();
    let mut managed_memberships: BTreeMap<&str, BTreeSet<String>> = BTreeMap::new();
    if let Some(catalog) = catalog {
        for pack in &catalog.packs {
            if pack.trashed_by.is_none() {
                active_pack_sources.insert(pack.id.as_str(), &pack.source_archive_keys);
            }
        }
        for edge in &catalog.memberships {
            if let Some(sources) = active_pack_sources.get(edge.id.pack.as_str()) {
                let memberships = managed_memberships
                    .entry(edge.id.song.as_str())
                    .or_default();
                for source in *sources {
                    let import_id = format!("import-{}", &source.as_str()[5..]);
                    if pack_names.contains_key(&import_id) {
                        memberships.insert(import_id);
                    }
                }
            }
        }
    }
    let mut songs = Vec::new();
    for entry in inventory.entries {
        let id = edition_id(&entry);
        if managed_songs
            .get(id.as_str())
            .is_some_and(|song| song.trashed_by.is_some())
        {
            continue;
        }
        if catalog.is_some() && !managed_songs.contains_key(id.as_str()) {
            issues.push(QueryIssue::new(
                "catalog_unmanaged_entry",
                "This retained edition was added after catalog initialization and remains active but unfiled in this view; catalog management requires explicit enrollment",
                None,
                Some(&entry.key),
            ));
        }
        let mut receipt_pack_ids = Vec::new();
        let mut reference_count = 0;
        let mut source_reference_count = 0;
        for (pack_id, count) in by_edition.remove(&id).unwrap_or_default() {
            receipt_pack_ids.push(pack_id);
            reference_count += count.receipts;
            source_reference_count += count.source_items.len();
        }
        let pack_ids: Vec<_> = if catalog.is_some() {
            managed_memberships
                .remove(id.as_str())
                .unwrap_or_default()
                .into_iter()
                .collect()
        } else {
            receipt_pack_ids
        };
        let names = pack_ids
            .iter()
            .map(|pack_id| PackName {
                pack_id: pack_id.clone(),
                name: pack_names[pack_id].clone(),
            })
            .collect();
        songs.push(Song {
            edition_id: id,
            key: entry.key.clone(),
            storage_kind: storage_kind(&entry),
            content_sha256: entry.content_sha256.clone(),
            score_id: entry.score_id,
            title: entry.title,
            composer: entry.composer,
            profile: entry
                .clean_package
                .as_ref()
                .and_then(|summary| summary.profile.clone())
                .unwrap_or_else(|| "canonical".into()),
            pack_count: pack_ids.len(),
            pack_ids,
            packs: names,
            receipt_reference_count: reference_count,
            source_reference_count,
        });
    }
    songs.sort_by(|a, b| a.edition_id.cmp(&b.edition_id));
    let mut pack_counts: BTreeMap<&str, (usize, usize)> = BTreeMap::new();
    for song in &songs {
        for id in &song.pack_ids {
            let counts = pack_counts.entry(id).or_default();
            counts.0 += 1;
            counts.1 += usize::from(song.pack_count > 1);
        }
    }
    for pack in &mut packs {
        let counts = pack_counts
            .get(pack.pack_id.as_str())
            .copied()
            .unwrap_or_default();
        pack.song_count = counts.0;
        pack.shared_song_count = counts.1;
    }
    let mut duplicates = Vec::new();
    for kind in ["exact_content", "same_id", "same_title"] {
        let mut groups: BTreeMap<String, Vec<Song>> = BTreeMap::new();
        for song in &songs {
            let identity = match kind {
                "exact_content" => format!("{}:{}", song.storage_kind, song.content_sha256),
                "same_id" => song.score_id.clone(),
                _ => normalized(&song.title),
            };
            if !identity.is_empty() {
                groups.entry(identity).or_default().push(song.clone());
            }
        }
        for (identity, editions) in groups {
            let reference_count = editions
                .iter()
                .map(|song| song.source_reference_count)
                .sum();
            if editions.len() < 2 && !(kind == "exact_content" && reference_count > 1) {
                continue;
            }
            let pack_ids: BTreeSet<_> = editions.iter().flat_map(|song| &song.pack_ids).collect();
            duplicates.push(Duplicate {
                group_id: format!("{kind}:{}", digest(identity.as_bytes())),
                kind,
                evidence_type: if kind != "exact_content" {
                    "distinct_editions"
                } else if editions.len() > 1 {
                    "multiple_editions"
                } else if pack_ids.len() > 1 {
                    "shared_edition"
                } else {
                    "repeated_source_item"
                },
                r#match: identity,
                edition_count: editions.len(),
                pack_count: pack_ids.len(),
                reference_count,
                editions,
            });
        }
    }
    duplicates.sort_by(|a, b| a.group_id.cmp(&b.group_id));
    issues.sort_by(|a, b| a.issue_id.cmp(&b.issue_id));
    issues.dedup_by(|a, b| a.issue_id == b.issue_id);
    if issues.len() > 4096 {
        return Err(fail(
            413,
            "library_query_limit",
            "Combined metadata issues exceed 4096; no incomplete snapshot was published",
        ));
    }
    for pack in &mut packs {
        pack.issue_count = issues
            .iter()
            .filter(|issue| issue.archive_key.as_ref() == Some(&pack.archive_key))
            .count();
    }
    let summary = json!({"packs":packs.len(), "songs":songs.len(), "memberships":songs.iter().map(|s| s.pack_count).sum::<usize>(), "shared_songs":songs.iter().filter(|s|s.pack_count>1).count(), "unfiled_songs":songs.iter().filter(|s|s.pack_count==0).count(), "duplicate_groups":duplicates.len(), "issues":issues.len()});
    let catalog_manifest_sha256 = managed.map(|loaded| loaded.manifest_sha256.clone());
    let identity = serde_json::to_vec(&(
        &catalog_manifest_sha256,
        &packs,
        &songs,
        &duplicates,
        &issues,
    ))
    .map_err(|e| invalid(&e.to_string()))?;
    if identity.len() > 32 * 1024 * 1024 {
        return Err(fail(
            413,
            "library_query_limit",
            "Projected metadata exceeds the 32 MiB cache limit",
        ));
    }
    let snapshot_id = digest(&identity);
    Ok(Projection {
        snapshot_id,
        catalog_manifest_sha256,
        verified_at_unix_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| invalid(&e.to_string()))?
            .as_millis() as u64,
        packs,
        songs,
        duplicates,
        issues,
        summary,
    })
}

pub fn query(library: &NativeLibrary, request: Query) -> Result<Value> {
    request.validate()?;
    let _lock = library.lock()?;
    let mut cache = library.process_lock.management.lock().map_err(|_| {
        fail(
            500,
            "library_io",
            "Metadata snapshot coordination was interrupted",
        )
    })?;
    // Verify the managed head before serving any cached active list. Another
    // process can Trash a song without touching this process's advisory cache.
    let managed = match crate::catalog_product::load_managed_locked(library) {
        Ok(managed) => managed,
        Err(error) => {
            *cache = None;
            return Err(error);
        }
    };
    let manifest = managed.as_ref().map(|loaded| &loaded.manifest_sha256);
    let cached = cache
        .as_ref()
        .is_some_and(|snapshot| snapshot.catalog_manifest_sha256.as_ref() == manifest)
        && !request.refresh;
    if !cached {
        // Do not leave an old snapshot available after a failed explicit scan.
        *cache = None;
        *cache = Some(build(library, managed.as_ref())?);
    }
    let snapshot = cache.as_ref().expect("built snapshot");
    let filter_id = request.filter_id();
    let offset = if let Some(cursor) = &request.cursor {
        if cursor.len() > 160 {
            return Err(fail(
                400,
                "library_invalid_cursor",
                "Invalid metadata cursor",
            ));
        }
        let pieces: Vec<_> = cursor.split(':').collect();
        if pieces.len() != 3 || pieces[0].len() != 64 || pieces[1] != filter_id {
            return Err(fail(
                400,
                "library_invalid_cursor",
                "Cursor does not match these query filters",
            ));
        }
        if pieces[0] != snapshot.snapshot_id {
            return Err(stale());
        }
        let offset = pieces[2].parse::<usize>().map_err(|_| {
            fail(
                400,
                "library_invalid_cursor",
                "Invalid metadata cursor offset",
            )
        })?;
        if offset == 0 {
            return Err(fail(
                400,
                "library_invalid_cursor",
                "Invalid metadata cursor offset",
            ));
        }
        offset
    } else {
        0
    };
    let needle = normalized(&request.search);
    let contains = |text: &str| normalized(text).contains(&needle);
    let mut rows = Vec::new();
    match request.view.as_str() {
        "packs" => {
            for pack in &snapshot.packs {
                if contains(&pack.name) {
                    rows.push(json!(pack));
                }
            }
        }
        "songs" => {
            for song in &snapshot.songs {
                if (request
                    .pack_id
                    .as_ref()
                    .is_none_or(|id| song.pack_ids.contains(id)))
                    && (!request.unfiled || song.pack_count == 0)
                    && (contains(&song.title)
                        || contains(&song.composer)
                        || contains(&song.score_id))
                {
                    rows.push(json!(song));
                }
            }
        }
        "duplicates" => {
            for group in &snapshot.duplicates {
                if request
                    .duplicate_kind
                    .as_deref()
                    .is_none_or(|kind| kind == group.kind)
                    && (contains(&group.r#match)
                        || group
                            .editions
                            .iter()
                            .any(|song| contains(&song.title) || contains(&song.score_id)))
                {
                    rows.push(json!(group));
                }
            }
        }
        "issues" => {
            for issue in &snapshot.issues {
                let matches_pack = request.pack_id.as_ref().is_none_or(|id| {
                    issue.archive_key.as_deref() == Some(format!("pack-{}", &id[7..]).as_str())
                });
                if matches_pack && (contains(&issue.message) || contains(&issue.code)) {
                    rows.push(json!(issue));
                }
            }
        }
        _ => unreachable!(),
    }
    let total = rows.len();
    if offset > total {
        return Err(fail(
            400,
            "library_invalid_cursor",
            "Metadata cursor is outside the result set",
        ));
    }
    let (page, next) = page_rows(rows, offset, request.limit)?;
    Ok(
        json!({"format":"worldmusichub-library-management","version":1,"view":request.view,"read_only":true,"native_only":true,"snapshot_id":snapshot.snapshot_id,
        "freshness":{"kind":"advisory_snapshot","verified_at_unix_ms":snapshot.verified_at_unix_ms,"cached":cached,"change_detection":"explicit_refresh","song_integrity":"verified_at_snapshot"},
        "summary":snapshot.summary,"total":total,"rows":page,"next_cursor":if next<total {Some(format!("{}:{filter_id}:{next}",snapshot.snapshot_id))} else {None}}),
    )
}

fn page_rows(rows: Vec<Value>, offset: usize, limit: usize) -> Result<(Vec<Value>, usize)> {
    let mut page = Vec::new();
    let mut bytes = 0;
    for row in rows.into_iter().skip(offset).take(limit) {
        let size = serde_json::to_vec(&row)
            .map_err(|e| invalid(&e.to_string()))?
            .len();
        if size > RESPONSE_LIMIT - 16384 {
            return Err(fail(
                413,
                "library_query_limit",
                "One complete metadata row exceeds 4 MiB; inspect matching editions through the paged songs view",
            ));
        }
        if !page.is_empty() && bytes + size > RESPONSE_LIMIT - 16384 {
            break;
        }
        bytes += size;
        page.push(row);
    }
    let next = offset + page.len();
    Ok((page, next))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{catalog, catalog_journal, song_pack};
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    static NEXT: AtomicU64 = AtomicU64::new(0);

    struct OriginalLibrary {
        parent: PathBuf,
        library: NativeLibrary,
    }
    impl OriginalLibrary {
        fn new() -> Self {
            let parent = std::env::temp_dir().join(format!(
                "wmh-ORIGINAL-catalog-query-{}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                NEXT.fetch_add(1, Ordering::Relaxed),
            ));
            fs::create_dir(&parent).unwrap();
            fs::write(
                parent.join("outside-sentinel"),
                b"ORIGINAL outside sentinel",
            )
            .unwrap();
            let library = NativeLibrary::open(parent.join("library")).unwrap();
            Self { parent, library }
        }
    }
    impl Drop for OriginalLibrary {
        fn drop(&mut self) {
            assert_eq!(
                fs::read(self.parent.join("outside-sentinel")).unwrap(),
                b"ORIGINAL outside sentinel"
            );
            fs::remove_dir_all(&self.parent).unwrap();
        }
    }
    fn original_score(id: &str) -> Vec<u8> {
        let (mut score, _) = score_core::import_jianpu("1=C4\nmeter=4/4\n1 2 3 0 |").unwrap();
        score.id = id.into();
        score.title = format!("ORIGINAL authored {id}");
        serde_json::to_vec(&score).unwrap()
    }
    fn songs(library: &NativeLibrary, refresh: bool) -> Value {
        query(
            library,
            serde_json::from_value(json!({"view":"songs", "refresh":refresh})).unwrap(),
        )
        .unwrap()
    }
    fn operation(number: usize) -> catalog::OperationId {
        catalog::OperationId::parse(format!("operation-{number:032x}")).unwrap()
    }
    fn commit_action(library: &NativeLibrary, number: usize, action: catalog::Action) {
        let loaded = catalog_journal::load(library).unwrap().unwrap();
        let preview = loaded
            .catalog
            .preview(catalog::Request {
                schema_version: catalog::VERSION,
                operation_id: operation(number),
                expected_generation: loaded.catalog.snapshot().generation,
                at_unix_ms: number as u64,
                action,
            })
            .unwrap();
        catalog_journal::commit(library, &preview).unwrap();
    }
    fn initialize_original(library: &NativeLibrary) -> (catalog::SongId, catalog::PackId) {
        let seed = {
            let _lock = library.lock().unwrap();
            let inventory = library.scan().unwrap();
            let evidence =
                song_pack::storage::project_receipts_locked(library, &inventory.entries).unwrap();
            assert_eq!(inventory.entries.len(), 1);
            assert_eq!(evidence.packs.len(), 1);
            let song = catalog::SongId::parse(edition_id(&inventory.entries[0])).unwrap();
            let source = catalog::SourceId::parse(evidence.packs[0].archive_key.clone()).unwrap();
            let pack = catalog::PackId::parse(format!("collection-{:032x}", 1)).unwrap();
            catalog::Seed {
                songs: vec![catalog::Song {
                    id: song.clone(),
                    retained_bytes: super::super::verified_retained_payload_bytes(
                        library,
                        &inventory.entries[0],
                    )
                    .unwrap(),
                    revision: 0,
                    trashed_by: None,
                }],
                packs: vec![catalog::Pack {
                    id: pack.clone(),
                    name: "ORIGINAL imported collection".into(),
                    kind: catalog::PackKind::Imported,
                    source_archive_keys: vec![source.clone()],
                    origin_import_operation_id: None,
                    revision: 0,
                    trashed_by: None,
                }],
                memberships: vec![catalog::Membership {
                    id: catalog::MembershipId {
                        pack: pack.clone(),
                        song,
                    },
                    position: 0,
                    added_at_unix_ms: 0,
                    revision: 0,
                }],
                sources: vec![catalog::Source {
                    id: source,
                    retained_bytes: evidence.verified_source_bytes[&evidence.packs[0].archive_key],
                    default_imported_pack: Some(pack),
                }],
                origins: evidence.origins,
            }
        };
        let song = seed.songs[0].id.clone();
        let pack = seed.packs[0].id.clone();
        catalog_journal::initialize(
            library,
            catalog::Catalog::from_seed(seed).unwrap(),
            operation(100),
        )
        .unwrap();
        (song, pack)
    }

    #[test]
    fn catalog_head_controls_cached_v1_membership_trash_and_reimport() {
        let fixture = OriginalLibrary::new();
        let library = &fixture.library;
        let bytes = original_score("first");
        let first =
            song_pack::import(library, "ORIGINAL-first.json", &bytes, true, false, None).unwrap();
        song_pack::import(library, "ORIGINAL-renamed.json", &bytes, true, false, None).unwrap();
        let entry = first.items[0].entry.as_ref().unwrap();
        let key = &entry.key;
        let retained_files: Vec<_> = [
            library.root.join("songs").join(key).join("score.json"),
            library.root.join("backups").join(key).join("score.json"),
            library
                .root
                .join("imports")
                .join(&first.source.archive_key)
                .join("source.bin"),
            library
                .root
                .join("import-backups")
                .join(&first.source.archive_key)
                .join("source.bin"),
        ]
        .into_iter()
        .map(|path| {
            let bytes = fs::read(&path).unwrap();
            (path, bytes)
        })
        .collect();
        assert_eq!(songs(library, false)["rows"][0]["pack_count"], 1);
        let (song, pack) = initialize_original(library);
        let initialized = catalog_journal::load(library).unwrap().unwrap();
        let origins = &initialized.catalog.snapshot().inventory.origins;
        assert_eq!(origins.len(), 2, "retry evidence must remain distinct");
        assert_eq!(
            origins
                .iter()
                .map(|origin| origin.item_path.as_str())
                .collect::<BTreeSet<_>>(),
            BTreeSet::from(["ORIGINAL-first.json", "ORIGINAL-renamed.json"])
        );
        assert_ne!(origins[0].receipt_filename, origins[1].receipt_filename);
        for origin in origins {
            assert_eq!(origin.song, song);
            assert_eq!(origin.source.as_str(), first.source.archive_key);
            assert_eq!(origin.item_index, 0);
            let receipt: Value = serde_json::from_slice(
                &fs::read(
                    library
                        .root
                        .join("imports")
                        .join(origin.source.as_str())
                        .join(&origin.receipt_filename),
                )
                .unwrap(),
            )
            .unwrap();
            assert_eq!(
                receipt["items"][origin.item_index as usize]["path"],
                origin.item_path
            );
        }
        assert_eq!(songs(library, false)["freshness"]["cached"], false);
        commit_action(
            library,
            1,
            catalog::Action::RemoveMemberships {
                pack_id: pack,
                song_ids: vec![song.clone()],
            },
        );
        let other_handle = NativeLibrary::open(&library.root).unwrap();
        let removed = songs(&other_handle, false);
        assert_eq!(removed["freshness"]["cached"], false);
        assert_eq!(removed["rows"][0]["pack_count"], 0);
        assert_eq!(removed["rows"][0]["receipt_reference_count"], 2);
        assert_eq!(
            song_pack::import(library, "ORIGINAL-retry.json", &bytes, true, false, None)
                .unwrap()
                .summary["duplicate"],
            1
        );
        let refreshed = songs(library, true);
        assert_eq!(
            refreshed["rows"][0]["pack_count"], 0,
            "receipt scans must not restore an edge"
        );
        assert_eq!(refreshed["rows"][0]["receipt_reference_count"], 3);
        commit_action(
            library,
            2,
            catalog::Action::TrashSongs {
                song_ids: vec![song.clone()],
            },
        );
        assert_eq!(
            songs(&other_handle, false)["total"],
            0,
            "a cached query cannot expose a newly trashed song"
        );
        assert!(library.list().unwrap().entries.is_empty());
        assert!(library.load(key).is_err());
        assert_eq!(
            song_pack::import(
                library,
                "ORIGINAL-trashed-retry.json",
                &bytes,
                true,
                false,
                None
            )
            .unwrap()
            .summary["duplicate"],
            1
        );
        assert!(library.list().unwrap().entries.is_empty());
        assert_eq!(library.physical_inventory().unwrap().entries.len(), 1);
        let new = song_pack::import(
            library,
            "ORIGINAL-new.json",
            &original_score("second"),
            true,
            false,
            None,
        )
        .unwrap();
        assert_eq!(new.summary["saved"], 1);
        let unmanaged = songs(library, true);
        assert_eq!(unmanaged["total"], 1);
        assert_eq!(unmanaged["rows"][0]["pack_count"], 0);
        assert_eq!(unmanaged["rows"][0]["receipt_reference_count"], 1);
        assert!(library
            .list()
            .unwrap()
            .issues
            .iter()
            .any(|issue| issue.code == "catalog_unmanaged_entry"));
        library
            .load(&new.items[0].entry.as_ref().unwrap().key)
            .unwrap();
        let loaded = catalog_journal::load(library).unwrap().unwrap();
        assert_eq!(loaded.catalog.snapshot().generation, 2);
        assert_eq!(loaded.catalog.snapshot().inventory.songs.len(), 1);
        assert_eq!(&loaded.catalog.snapshot().inventory.origins, origins);
        commit_action(
            library,
            3,
            catalog::Action::Restore {
                trash_operation_id: operation(2),
                entities: vec![catalog::Entity::Song(song)],
                memberships: vec![],
            },
        );
        assert_eq!(songs(library, false)["total"], 2);
        library.load(key).unwrap();
        assert_eq!(songs(library, false)["summary"]["memberships"], 0);
        for (path, bytes) in retained_files {
            assert_eq!(fs::read(path).unwrap(), bytes);
        }
    }

    #[test]
    fn retained_byte_projection_counts_verified_copies_without_metadata_or_stages() {
        let fixture = OriginalLibrary::new();
        let library = &fixture.library;
        let bytes = original_score("payload-counts");
        let report =
            song_pack::import(library, "ORIGINAL-payload.json", &bytes, true, false, None).unwrap();
        let entry = report.items[0].entry.as_ref().unwrap();
        assert!(entry.retained_source.is_some());
        let expected_one =
            entry.score_bytes as u64 + entry.retained_source.as_ref().unwrap().bytes as u64;
        let _lock = library.lock().unwrap();
        assert_eq!(
            super::super::verified_retained_payload_bytes(library, entry).unwrap(),
            expected_one * 2
        );
        let backup = library.root.join("backups").join(&entry.key);
        let retained_backup = fixture.parent.join("ORIGINAL-preserved-score-backup");
        fs::rename(&backup, &retained_backup).unwrap();
        assert_eq!(
            super::super::verified_retained_payload_bytes(library, entry).unwrap(),
            expected_one
        );
        fs::rename(&retained_backup, &backup).unwrap();
        let backup_score = backup.join("score.json");
        let preserved_score = fs::read(&backup_score).unwrap();
        fs::write(&backup_score, b"ORIGINAL corrupted fixture copy").unwrap();
        assert!(super::super::verified_retained_payload_bytes(library, entry).is_err());
        fs::write(&backup_score, &preserved_score).unwrap();
        let entries = [entry.clone()];
        let projection = song_pack::storage::project_receipts_locked(library, &entries).unwrap();
        assert_eq!(
            projection.verified_source_bytes[&report.source.archive_key],
            bytes.len() as u64 * 2
        );
        let backup_source = library
            .root
            .join("import-backups")
            .join(&report.source.archive_key);
        let retained_source = fixture.parent.join("ORIGINAL-preserved-source-backup");
        fs::rename(&backup_source, &retained_source).unwrap();
        let projection = song_pack::storage::project_receipts_locked(library, &entries).unwrap();
        assert_eq!(
            projection.verified_source_bytes[&report.source.archive_key],
            bytes.len() as u64
        );
        fs::rename(&retained_source, &backup_source).unwrap();
        let primary_source = library
            .root
            .join("imports")
            .join(&report.source.archive_key);
        fs::rename(&primary_source, &retained_source).unwrap();
        let projection = song_pack::storage::project_receipts_locked(library, &entries).unwrap();
        assert_eq!(
            projection.verified_source_bytes[&report.source.archive_key],
            bytes.len() as u64
        );
        assert_eq!(projection.packs.len(), 1);
        assert_eq!(projection.packs[0].provenance, "unresolved");
        assert!(projection.origins.is_empty());
        fs::rename(&retained_source, &primary_source).unwrap();
        assert_eq!(fs::read(primary_source.join("source.bin")).unwrap(), bytes);
        assert_eq!(
            super::super::verified_retained_payload_bytes(library, entry).unwrap(),
            expected_one * 2
        );
    }

    #[test]
    fn initialization_waits_for_the_final_import_receipt_and_captures_membership() {
        use std::sync::mpsc;
        use std::time::{Duration, Instant};
        let fixture = OriginalLibrary::new();
        let library = &fixture.library;
        let bytes = original_score("import-lock-boundary");
        let other = NativeLibrary::open(&library.root).unwrap();
        let (saved_tx, saved_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let (finished_tx, finished_rx) = mpsc::channel();
        std::thread::scope(|scope| {
            let importing = scope.spawn(|| {
                song_pack::import_with_receipt_boundary(
                    library,
                    "ORIGINAL-import-lock.json",
                    &bytes,
                    move || {
                        saved_tx.send(()).unwrap();
                        release_rx.recv_timeout(Duration::from_secs(10)).unwrap();
                        Ok(())
                    },
                )
            });
            saved_rx.recv_timeout(Duration::from_secs(10)).unwrap();
            let initializing = scope.spawn(move || {
                let response = crate::catalog_product::dispatch(
                    &other,
                    "POST",
                    "/api/library/catalog/initialize/preview",
                    b"{}",
                );
                finished_tx.send(()).unwrap();
                response
            });
            let deadline = Instant::now() + Duration::from_secs(10);
            while library.process_lock.waiting.load(Ordering::SeqCst) == 0
                && Instant::now() < deadline
            {
                std::thread::yield_now();
            }
            let waiting = library.process_lock.waiting.load(Ordering::SeqCst) > 0;
            let completed_early = finished_rx.try_recv().is_ok();
            release_tx.send(()).unwrap();
            assert!(
                waiting,
                "catalog initialization never reached the existing native gate"
            );
            assert!(
                !completed_early,
                "catalog initialization crossed an unfinished import"
            );
            let imported = importing.join().unwrap().unwrap();
            assert_eq!(imported.summary["saved"], 1);
            let response = initializing.join().unwrap();
            assert_eq!(
                response.status(),
                200,
                "{}",
                String::from_utf8_lossy(response.body())
            );
            let preview: Value = serde_json::from_slice(response.body()).unwrap();
            assert_eq!(preview["preview"]["counts"]["managed_songs"], 1);
            assert_eq!(preview["preview"]["counts"]["memberships"], 1);
            let _lock = library.lock().unwrap();
            let inventory = library.scan().unwrap();
            let evidence =
                song_pack::storage::project_receipts_locked(library, &inventory.entries).unwrap();
            assert_eq!(evidence.origins.len(), 1);
            assert_eq!(evidence.references.len(), 1);
        });
    }

    fn original_clean_zip() -> Vec<u8> {
        use std::io::{Cursor, Write};
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in [
            (
                "metadata.json",
                include_bytes!("../../../tests/fixtures/clean-song-v2/metadata.json").as_slice(),
            ),
            (
                "score.json",
                include_bytes!("../../../tests/fixtures/clean-song-v2/score.json").as_slice(),
            ),
        ] {
            zip.start_file(
                name,
                zip::write::SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Stored),
            )
            .unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    fn owned_tree(root: &std::path::Path) -> BTreeMap<PathBuf, Option<Vec<u8>>> {
        fn visit(
            root: &std::path::Path,
            current: &std::path::Path,
            files: &mut BTreeMap<PathBuf, Option<Vec<u8>>>,
        ) {
            for item in fs::read_dir(current).unwrap() {
                let path = item.unwrap().path();
                let metadata = fs::symlink_metadata(&path).unwrap();
                assert!(!metadata.file_type().is_symlink());
                let relative = path.strip_prefix(root).unwrap().to_owned();
                if metadata.is_dir() {
                    files.insert(relative, None);
                    visit(root, &path, files);
                } else {
                    files.insert(relative, Some(fs::read(path).unwrap()));
                }
            }
        }
        let mut files = BTreeMap::new();
        visit(root, root, &mut files);
        files
    }

    #[test]
    fn marked_initialization_blocks_clean_import_before_source_publication() {
        let fixture = OriginalLibrary::new();
        let library = &fixture.library;
        let clean = original_clean_zip();
        let clean_preview =
            song_pack::import(library, "ORIGINAL-clean.zip", &clean, false, false, None).unwrap();
        assert_eq!(clean_preview.summary["ready"], 1);
        assert!(clean_preview.items[0].clean_package.is_some());
        let original = original_score("marked-init-existing");
        let report = song_pack::import(
            library,
            "ORIGINAL-existing.json",
            &original,
            true,
            false,
            None,
        )
        .unwrap();
        initialize_original(library);
        for area in ["catalog", "catalog-backups"] {
            let generation = fs::read_dir(library.root.join(area).join("commits"))
                .unwrap()
                .next()
                .unwrap()
                .unwrap()
                .path();
            fs::rename(
                generation,
                fixture
                    .parent
                    .join(format!("ORIGINAL-preserved-{area}-genesis")),
            )
            .unwrap();
        }
        let before = owned_tree(&fixture.parent);
        let error = song_pack::import(library, "ORIGINAL-clean.zip", &clean, true, false, None)
            .unwrap_err();
        assert_eq!(error.code, "catalog_recovery_required");
        assert!(song_pack::storage::retain(library, &report, &original).is_err());
        assert!(song_pack::storage::receipt(library, &report).is_err());
        assert!(!library
            .root
            .join("imports")
            .join(&clean_preview.source.archive_key)
            .exists());
        assert!(!library
            .root
            .join("import-backups")
            .join(&clean_preview.source.archive_key)
            .exists());
        assert_eq!(
            owned_tree(&fixture.parent),
            before,
            "blocked import changed preserved files or directories"
        );
    }

    #[test]
    fn damaged_managed_head_cannot_serve_an_active_cached_query_or_import() {
        let fixture = OriginalLibrary::new();
        let library = &fixture.library;
        let bytes = original_score("damaged-head");
        let report =
            song_pack::import(library, "ORIGINAL.json", &bytes, true, false, None).unwrap();
        initialize_original(library);
        assert_eq!(songs(library, false)["total"], 1);
        let commit = fs::read_dir(library.root.join("catalog-backups/commits"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        fs::write(
            commit.join("manifest.json"),
            b"ORIGINAL deliberately corrupt test manifest",
        )
        .unwrap();
        assert!(query(
            library,
            serde_json::from_value(json!({"view":"songs"})).unwrap()
        )
        .is_err());
        assert!(library.list().is_err());
        assert!(library
            .load(&report.items[0].entry.as_ref().unwrap().key)
            .is_err());
        assert!(
            song_pack::import(library, "ORIGINAL-retry.json", &bytes, true, false, None).is_err()
        );
        assert_eq!(
            fs::read(
                library
                    .root
                    .join("imports")
                    .join(report.source.archive_key)
                    .join("source.bin")
            )
            .unwrap(),
            bytes
        );
    }

    #[test]
    fn nested_duplicate_members_are_bounded_without_silent_truncation() {
        let rows = vec![
            json!({"group_id":"original-large-title-group", "editions": vec!["a".repeat(1024 * 1024); 5]}),
        ];
        let error = page_rows(rows, 0, 40).unwrap_err();
        assert_eq!(error.status, 413);
        assert_eq!(error.code, "library_query_limit");
        assert!(error.error.contains("paged songs"));
    }
    #[test]
    fn byte_limited_pages_preserve_complete_nested_rows_and_next_offset() {
        let rows = vec![
            json!({"edition_id":"original-a", "packs":["a".repeat(2 * 1024 * 1024)]}),
            json!({"edition_id":"original-b", "packs":["b".repeat(2 * 1024 * 1024)]}),
        ];
        let (page, next) = page_rows(rows.clone(), 0, 40).unwrap();
        assert_eq!(page, vec![rows[0].clone()]);
        assert_eq!(next, 1);
        let (last, end) = page_rows(rows.clone(), next, 40).unwrap();
        assert_eq!(last, vec![rows[1].clone()]);
        assert_eq!(end, 2);
    }
}
