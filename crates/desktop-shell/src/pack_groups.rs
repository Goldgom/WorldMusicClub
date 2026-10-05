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

fn build(library: &NativeLibrary) -> Result<Projection> {
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
    let mut songs = Vec::new();
    for entry in inventory.entries {
        let id = edition_id(&entry);
        let mut pack_ids = Vec::new();
        let mut names = Vec::new();
        let mut reference_count = 0;
        let mut source_reference_count = 0;
        for (pack_id, count) in by_edition.remove(&id).unwrap_or_default() {
            names.push(PackName {
                pack_id: pack_id.clone(),
                name: pack_names[&pack_id].clone(),
            });
            pack_ids.push(pack_id);
            reference_count += count.receipts;
            source_reference_count += count.source_items.len();
        }
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
    let identity = serde_json::to_vec(&(&packs, &songs, &duplicates, &issues))
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
    let cached = cache.is_some() && !request.refresh;
    if !cached {
        // Do not leave an old snapshot available after a failed explicit scan.
        *cache = None;
        *cache = Some(build(library)?);
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
