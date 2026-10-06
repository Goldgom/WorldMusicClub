//! Bounded native product adapter. Physical archives remain immutable; every
//! logical change is a checked transition in the shared catalog journal.
use super::{digest, fail, pack_groups, Entry, Inventory, LibraryError, NativeLibrary, Result};
use crate::{
    catalog::{
        self, Action, Catalog, Entity, OperationId, PackId, Preview, Seed, SongId, SourceId,
    },
    catalog_journal as journal,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

pub const REQUEST_LIMIT: usize = catalog::MAX_STATE_BYTES + 1024 * 1024;
const RESPONSE_LIMIT: usize = 4 * 1024 * 1024;
const FORMAT: &str = "worldmusichub-catalog";
const SYNC_BATCH_SONGS: usize = 32;
const SYNC_BATCH_SOURCES: usize = 32;
fn now() -> Result<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|v| v.as_millis() as u64)
        .map_err(|_| {
            fail(
                500,
                "library_clock",
                "The system clock is before the Unix epoch",
            )
        })
}
fn hash(value: &impl Serialize) -> String {
    digest(&serde_json::to_vec(value).expect("catalog product JSON"))
}
fn catalog_digest(catalog: &Catalog) -> String {
    hash(catalog.snapshot())
}
fn core_error(error: catalog::Error) -> LibraryError {
    let (status, code, message) = match error {
        catalog::Error::Stale => (
            409,
            "catalog_stale",
            "The catalog changed; refresh and review a new exact selection",
        ),
        catalog::Error::IdempotencyConflict => (
            409,
            "catalog_conflict",
            "This operation ID already has a different request; reconcile its existing result",
        ),
        catalog::Error::InvalidPlan => (
            409,
            "catalog_conflict",
            "The frozen preview changed; no replacement selection was applied",
        ),
        catalog::Error::NotFound => (
            404,
            "catalog_not_found",
            "A selected edition, pack, or original operation is not managed; refresh or sync new imports",
        ),
        catalog::Error::InTrash => (
            409,
            "catalog_in_trash",
            "Restore this edition before loading or removing it again",
        ),
        catalog::Error::Conflict => (
            409,
            "catalog_conflict",
            "This selection conflicts with the current catalog",
        ),
        catalog::Error::Limit(_) => (
            413,
            "catalog_capacity",
            "The bounded catalog capacity was reached; existing records were preserved",
        ),
        catalog::Error::Invalid(_) | catalog::Error::UnsupportedVersion => (
            400,
            "catalog_invalid_request",
            "Invalid catalog identity, selection, evidence, or version",
        ),
    };
    fail(status, code, message)
}
fn journal_error(error: journal::Error) -> LibraryError {
    match error {
        journal::Error::Storage(error) => error,
        journal::Error::Core(error) => core_error(error),
        journal::Error::NeverManaged => fail(
            409,
            "catalog_not_initialized",
            "Preview and confirm catalog initialization before managing songs",
        ),
        journal::Error::Capacity => fail(
            413,
            "catalog_capacity",
            "Catalog journal capacity reached; no retained history was discarded",
        ),
        journal::Error::Recovery(message) => fail(
            409,
            "catalog_recovery_required",
            format!(
                "Catalog recovery is required: {message}. Preserve the catalog and catalog-backups folders; do not reset or reinitialize. Retry the saved operation only after recovery."
            ),
        ),
    }
}
pub(crate) fn load_managed_locked(library: &NativeLibrary) -> Result<Option<journal::Loaded>> {
    journal::load_locked(library).map_err(journal_error)
}
pub(crate) fn filter_active_locked(
    library: &NativeLibrary,
    inventory: &mut Inventory,
) -> Result<()> {
    if let Some(loaded) = load_managed_locked(library)? {
        let songs: BTreeMap<_, _> = loaded
            .catalog
            .snapshot()
            .inventory
            .songs
            .iter()
            .map(|s| (s.id.as_str(), s))
            .collect();
        inventory.entries.retain(|entry| {
            songs
                .get(pack_groups::edition_id(entry).as_str())
                .is_none_or(|song| song.trashed_by.is_none())
        });
        for entry in &inventory.entries {
            if !songs.contains_key(pack_groups::edition_id(entry).as_str()) {
                inventory.issues.push(super::Issue{key:Some(entry.key.clone()),code:"catalog_unmanaged_entry".into(),message:"This new edition is active and awaits explicit catalog sync before Trash management".into()});
            }
        }
    }
    Ok(())
}
pub(crate) fn require_active_locked(library: &NativeLibrary, edition: &str) -> Result<()> {
    if let Some(loaded) = load_managed_locked(library)? {
        if loaded
            .catalog
            .snapshot()
            .inventory
            .songs
            .iter()
            .any(|song| song.id.as_str() == edition && song.trashed_by.is_some())
        {
            return Err(fail(
                409,
                "catalog_in_trash",
                "This edition is in Trash. Restore it before loading it again; already admitted media remains usable",
            ));
        }
    }
    Ok(())
}
fn library_id(library: &NativeLibrary) -> Result<String> {
    let canonical = fs::canonicalize(&library.root).map_err(super::io_error)?;
    let text = canonical.to_str().ok_or_else(|| {
        fail(
            422,
            "catalog_invalid_request",
            "Native library identity is not representable as UTF-8",
        )
    })?;
    Ok(format!("library-{}", digest(text.as_bytes())))
}
fn bind(library: &NativeLibrary, requested: &str) -> Result<()> {
    if library_id(library)? != requested {
        return Err(fail(
            409,
            "catalog_conflict",
            "This operation belongs to a different native library",
        ));
    }
    Ok(())
}
fn envelope(library: &NativeLibrary, mut value: Value) -> Result<Value> {
    value["format"] = json!(FORMAT);
    value["version"] = json!(1);
    value["native_only"] = json!(true);
    value["library_id"] = json!(library_id(library)?);
    Ok(value)
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Counts {
    managed_songs: usize,
    active_songs: usize,
    trashed_songs: usize,
    packs: usize,
    memberships: usize,
}
fn counts(catalog: &Catalog) -> Counts {
    let inventory = &catalog.snapshot().inventory;
    let trash = inventory
        .songs
        .iter()
        .filter(|s| s.trashed_by.is_some())
        .count();
    Counts {
        managed_songs: inventory.songs.len(),
        active_songs: inventory.songs.len() - trash,
        trashed_songs: trash,
        packs: inventory.packs.len(),
        memberships: inventory.memberships.len(),
    }
}
fn state(loaded: Option<&journal::Loaded>) -> Value {
    match loaded {
        None => {
            json!({"state":"uninitialized","generation":null,"catalog_digest":null,"counts":null})
        }
        Some(loaded) => {
            json!({"state":"ready","generation":loaded.catalog.snapshot().generation,"catalog_digest":catalog_digest(&loaded.catalog),"counts":counts(&loaded.catalog)})
        }
    }
}
#[cfg(unix)]
fn os_random(bytes: &mut [u8; 16]) -> std::io::Result<()> {
    use std::io::Read;
    fs::File::open("/dev/urandom")?.read_exact(bytes)
}
#[cfg(windows)]
fn os_random(bytes: &mut [u8; 16]) -> std::io::Result<()> {
    #[link(name = "bcrypt")]
    unsafe extern "system" {
        fn BCryptGenRandom(
            algorithm: *mut std::ffi::c_void,
            buffer: *mut u8,
            length: u32,
            flags: u32,
        ) -> i32;
    }
    // System-preferred OS RNG, no provider handle. The writable buffer is exactly
    // 16 bytes and remains borrowed for the duration of this synchronous call.
    let status = unsafe { BCryptGenRandom(std::ptr::null_mut(), bytes.as_mut_ptr(), 16, 2) };
    if status >= 0 {
        Ok(())
    } else {
        Err(std::io::Error::other("Windows system RNG failed"))
    }
}
#[cfg(not(any(unix, windows)))]
fn os_random(_bytes: &mut [u8; 16]) -> std::io::Result<()> {
    Err(std::io::Error::other("Unsupported OS random facility"))
}
fn random_id(prefix: &str, used: &mut BTreeSet<String>) -> Result<String> {
    for _ in 0..16 {
        let mut bytes = [0u8; 16];
        os_random(&mut bytes).map_err(|_| {
            fail(
                503,
                "catalog_random_unavailable",
                "Operating-system randomness is unavailable; no catalog ID was issued",
            )
        })?;
        let id = format!(
            "{prefix}{}",
            bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
        );
        if used.insert(id.clone()) {
            return Ok(id);
        }
    }
    Err(fail(
        503,
        "catalog_random_unavailable",
        "Unable to reserve a unique random catalog ID",
    ))
}
fn operation_id(library: &NativeLibrary, loaded: Option<&journal::Loaded>) -> Result<OperationId> {
    let mut used = BTreeSet::new();
    if let Some(loaded) = loaded {
        for receipt in &loaded.catalog.snapshot().receipts {
            used.insert(receipt.preview.request.operation_id.as_str().to_owned());
        }
        used.insert(
            journal::bootstrap_locked(library)
                .map_err(journal_error)?
                .0
                .as_str()
                .to_owned(),
        );
    }
    OperationId::parse(random_id("operation-", &mut used)?).map_err(core_error)
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Collection {
    source_id: SourceId,
    collection_id: PackId,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct InitializationPreview {
    kind: String,
    library_id: String,
    operation_id: OperationId,
    inventory_digest: String,
    seed_digest: String,
    collections: Vec<Collection>,
    counts: Counts,
    retained_payload_bytes: u64,
    retained_source_bytes: u64,
}
struct Verified {
    entries: Vec<Entry>,
    evidence: crate::song_pack::storage::ReceiptProjection,
    payload_bytes: BTreeMap<String, u64>,
}
fn verified(library: &NativeLibrary) -> Result<Verified> {
    let inventory = library.scan()?;
    let evidence = crate::song_pack::storage::project_receipts_locked(library, &inventory.entries)?;
    if let Some(error) = &evidence.blocking_source_error {
        return Err(fail(
            409,
            "catalog_recovery_required",
            format!(
                "A retained original copy needs recovery before catalog changes: {}. All original evidence was preserved.",
                error.error
            ),
        ));
    }
    let payload_bytes = inventory
        .entries
        .iter()
        .map(|entry| {
            Ok((
                pack_groups::edition_id(entry),
                super::verified_retained_payload_bytes(library, entry)?,
            ))
        })
        .collect::<Result<_>>()?;
    Ok(Verified {
        entries: inventory.entries,
        evidence,
        payload_bytes,
    })
}
fn collections(verified: &Verified, existing: Option<&Catalog>) -> Result<Vec<Collection>> {
    let mut used = BTreeSet::new();
    let mut known = BTreeSet::new();
    if let Some(c) = existing {
        for p in &c.snapshot().inventory.packs {
            used.insert(p.id.as_str().to_owned());
        }
        for s in &c.snapshot().inventory.sources {
            known.insert(s.id.as_str());
        }
    }
    verified
        .evidence
        .packs
        .iter()
        .filter(|p| !known.contains(p.archive_key.as_str()))
        .take(if existing.is_some() {
            SYNC_BATCH_SOURCES
        } else {
            usize::MAX
        })
        .map(|pack| {
            Ok(Collection {
                source_id: SourceId::parse(pack.archive_key.clone()).map_err(core_error)?,
                collection_id: PackId::parse(random_id("collection-", &mut used)?)
                    .map_err(core_error)?,
            })
        })
        .collect()
}
fn seed(verified: &Verified, mapping: &[Collection], existing: Option<&Catalog>) -> Result<Seed> {
    let mut source_packs = BTreeMap::new();
    let mut existing_songs = BTreeSet::new();
    let mut existing_sources = BTreeSet::new();
    if let Some(c) = existing {
        for s in &c.snapshot().inventory.songs {
            existing_songs.insert(s.id.clone());
        }
        for s in &c.snapshot().inventory.sources {
            existing_sources.insert(s.id.clone());
            if let Some(p) = &s.default_imported_pack {
                source_packs.insert(s.id.clone(), p.clone());
            }
        }
    }
    let expected_sources: Vec<_> = verified
        .evidence
        .packs
        .iter()
        .filter(|p| !existing_sources.iter().any(|s| s.as_str() == p.archive_key))
        .take(if existing.is_some() {
            SYNC_BATCH_SOURCES
        } else {
            usize::MAX
        })
        .map(|p| p.archive_key.as_str())
        .collect();
    if mapping
        .iter()
        .map(|m| m.source_id.as_str())
        .collect::<Vec<_>>()
        != expected_sources
    {
        return Err(core_error(catalog::Error::Stale));
    }
    let mut ids = BTreeSet::new();
    for c in mapping {
        if !ids.insert(c.collection_id.clone())
            || source_packs
                .insert(c.source_id.clone(), c.collection_id.clone())
                .is_some()
        {
            return Err(core_error(catalog::Error::Conflict));
        }
    }
    let mut output = Seed {
        songs: vec![],
        packs: vec![],
        memberships: vec![],
        sources: vec![],
        origins: vec![],
    };
    let mut edge_count = 0usize;
    for entry in &verified.entries {
        let id = SongId::parse(pack_groups::edition_id(entry)).map_err(core_error)?;
        if !existing_songs.contains(&id) {
            if existing.is_some() {
                if output.songs.len() >= SYNC_BATCH_SONGS {
                    break;
                }
                let origins: Vec<_> = verified
                    .evidence
                    .origins
                    .iter()
                    .filter(|o| o.song == id)
                    .collect();
                if origins
                    .iter()
                    .any(|o| !source_packs.contains_key(&o.source))
                {
                    continue;
                }
                let packs: BTreeSet<_> = origins
                    .iter()
                    .filter_map(|o| source_packs.get(&o.source))
                    .filter(|p| {
                        !existing.is_some_and(|c| {
                            c.snapshot()
                                .inventory
                                .packs
                                .iter()
                                .any(|known| &known.id == *p && known.trashed_by.is_some())
                        })
                    })
                    .collect();
                if edge_count + packs.len() > catalog::MAX_SELECTION {
                    continue;
                }
                edge_count += packs.len();
            }
            output.songs.push(catalog::Song {
                id,
                retained_bytes: *verified
                    .payload_bytes
                    .get(&pack_groups::edition_id(entry))
                    .expect("verified payload count"),
                revision: 0,
                trashed_by: None,
            });
        }
    }
    for pack in &verified.evidence.packs {
        let source = SourceId::parse(pack.archive_key.clone()).map_err(core_error)?;
        if existing_sources.contains(&source) {
            continue;
        }
        let Some(id) = source_packs.get(&source).cloned() else {
            if existing.is_some() {
                continue;
            }
            return Err(core_error(catalog::Error::Conflict));
        };
        output.sources.push(catalog::Source {
            id: source.clone(),
            retained_bytes: *verified
                .evidence
                .verified_source_bytes
                .get(&pack.archive_key)
                .expect("verified original count"),
            default_imported_pack: Some(id.clone()),
        });
        output.packs.push(catalog::Pack {
            id,
            name: pack.name.clone(),
            kind: catalog::PackKind::Imported,
            source_archive_keys: vec![source],
            origin_import_operation_id: None,
            revision: 0,
            trashed_by: None,
        });
    }
    if output.sources.len() != mapping.len() {
        return Err(core_error(catalog::Error::Conflict));
    }
    let new_songs: BTreeSet<_> = output.songs.iter().map(|s| s.id.clone()).collect();
    let mut edges = BTreeSet::new();
    for origin in &verified.evidence.origins {
        if !new_songs.contains(&origin.song) {
            continue;
        }
        let pack = source_packs
            .get(&origin.source)
            .ok_or_else(|| core_error(catalog::Error::Conflict))?;
        output.origins.push(origin.clone());
        // Do not revive a trashed pack through source discovery.
        if existing.is_some_and(|c| {
            c.snapshot()
                .inventory
                .packs
                .iter()
                .any(|p| p.id == *pack && p.trashed_by.is_some())
        }) {
            continue;
        }
        let id = catalog::MembershipId {
            pack: pack.clone(),
            song: origin.song.clone(),
        };
        if edges.insert(id.clone()) {
            output.memberships.push(catalog::Membership {
                id,
                position: 0,
                added_at_unix_ms: 0,
                revision: 0,
            });
        }
    }
    output.origins.sort();
    output.origins.dedup();
    Ok(output)
}
fn initialize_preview(library: &NativeLibrary) -> Result<Value> {
    let _lock = library.lock()?;
    if load_managed_locked(library)?.is_some() {
        return Err(fail(
            409,
            "catalog_already_initialized",
            "This library is already initialized; refresh its catalog status",
        ));
    }
    let verified = verified(library)?;
    let collections = collections(&verified, None)?;
    let catalog = Catalog::from_seed(seed(&verified, &collections, None)?).map_err(core_error)?;
    let preview = InitializationPreview {
        kind: "initialize".into(),
        library_id: library_id(library)?,
        operation_id: operation_id(library, None)?,
        inventory_digest: hash(&catalog.snapshot().inventory),
        seed_digest: catalog_digest(&catalog),
        collections,
        counts: counts(&catalog),
        retained_payload_bytes: catalog
            .snapshot()
            .inventory
            .songs
            .iter()
            .map(|s| s.retained_bytes)
            .sum(),
        retained_source_bytes: catalog
            .snapshot()
            .inventory
            .sources
            .iter()
            .map(|s| s.retained_bytes)
            .sum(),
    };
    envelope(library, json!({"preview":preview}))
}
fn invalidate(library: &NativeLibrary) -> Result<()> {
    *library
        .process_lock
        .management
        .lock()
        .map_err(|_| fail(500, "library_io", "Metadata cache coordination interrupted"))? = None;
    *library
        .process_lock
        .catalog_product
        .lock()
        .map_err(|_| fail(500, "library_io", "Catalog cache coordination interrupted"))? = None;
    Ok(())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Initialize {
    library_id: String,
    preview: InitializationPreview,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Commit {
    library_id: String,
    preview: Preview,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Operation {
    library_id: String,
    operation_id: OperationId,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Empty {}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Selection {
    library_id: String,
    action: String,
    edition_ids: Vec<SongId>,
    trash_operation_id: Option<OperationId>,
    #[serde(default)]
    collection_id: Option<PackId>,
    #[serde(default)]
    destination_collection_id: Option<PackId>,
    #[serde(default)]
    membership_operation_id: Option<OperationId>,
    #[serde(default)]
    name: Option<String>,
    expected_generation: u64,
    catalog_digest: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Sync {
    library_id: String,
    expected_generation: u64,
    catalog_digest: String,
}
fn freshness(catalog: &Catalog, generation: u64, expected: &str) -> Result<()> {
    if catalog.snapshot().generation != generation || catalog_digest(catalog) != expected {
        return Err(core_error(catalog::Error::Stale));
    }
    Ok(())
}
fn require_physical(catalog: &Catalog, verified: &Verified, ids: &[SongId]) -> Result<()> {
    let physical: BTreeSet<_> = verified
        .entries
        .iter()
        .map(pack_groups::edition_id)
        .collect();
    for id in ids {
        if !catalog
            .snapshot()
            .inventory
            .songs
            .iter()
            .any(|s| s.id == *id)
        {
            return Err(core_error(catalog::Error::NotFound));
        }
        if !physical.contains(id.as_str()) {
            return Err(fail(
                409,
                "catalog_recovery_required",
                "A selected edition has no verified physical payload; recover its retained backup before changing its catalog state",
            ));
        }
    }
    Ok(())
}
fn pack_ref(catalog: &Catalog, id: &PackId) -> Value {
    let pack = catalog
        .snapshot()
        .inventory
        .packs
        .iter()
        .find(|p| p.id == *id)
        .expect("validated pack");
    pack_value(pack)
}
fn pack_value(pack: &catalog::Pack) -> Value {
    json!({"collection_id":pack.id,"kind":pack.kind,"import_pack_id":pack.source_archive_keys.first().map(|s|format!("import-{}",&s.as_str()[5..])),"name":pack.name})
}
fn require_custom(catalog: &Catalog, id: &PackId) -> Result<()> {
    let pack = catalog
        .snapshot()
        .inventory
        .packs
        .iter()
        .find(|pack| pack.id == *id)
        .ok_or_else(|| core_error(catalog::Error::NotFound))?;
    if pack.kind != catalog::PackKind::Custom {
        return Err(fail(
            409,
            "catalog_readonly_pack",
            "Imported source groups are read-only; choose a custom user pack",
        ));
    }
    if pack.trashed_by.is_some() {
        return Err(core_error(catalog::Error::InTrash));
    }
    Ok(())
}
fn membership_undo_status(catalog: &Catalog) -> Value {
    let undone: BTreeSet<_> = catalog
        .snapshot()
        .receipts
        .iter()
        .filter_map(|receipt| {
            if let Action::UndoMemberships {
                membership_operation_id,
            } = &receipt.preview.request.action
            {
                Some(membership_operation_id)
            } else {
                None
            }
        })
        .collect();
    for receipt in catalog.snapshot().receipts.iter().rev() {
        let preview = &receipt.preview;
        let id = &preview.request.operation_id;
        if preview.effects.removed_membership_snapshots.is_empty() || undone.contains(id) {
            continue;
        }
        let (action, source, destination) = match &preview.request.action {
            Action::RemoveMemberships { pack_id, .. } => ("remove_memberships", pack_id, None),
            Action::MoveMemberships {
                from_pack, to_pack, ..
            } => ("move_memberships", from_pack, Some(to_pack)),
            _ => continue,
        };
        let selected: BTreeSet<_> = preview
            .effects
            .removed_memberships
            .iter()
            .chain(&preview.effects.added_memberships)
            .map(|edge| &edge.song)
            .collect();
        return json!({"operation_id":id,"action":action,"selected_count":selected.len(),"source_pack":pack_ref(catalog,source),"destination_pack":destination.map(|pack|pack_ref(catalog,pack)),"can_undo":catalog.can_undo_memberships(id)});
    }
    Value::Null
}
fn summary(catalog: &Catalog, preview: &Preview) -> Value {
    let ids = match &preview.request.action {
        Action::TrashSongs { song_ids }
        | Action::AddMemberships { song_ids, .. }
        | Action::RemoveMemberships { song_ids, .. }
        | Action::MoveMemberships { song_ids, .. } => song_ids.clone(),
        Action::UndoMemberships {
            membership_operation_id,
        } => catalog
            .receipt(membership_operation_id)
            .map(|receipt| {
                receipt
                    .preview
                    .effects
                    .removed_memberships
                    .iter()
                    .chain(&receipt.preview.effects.added_memberships)
                    .map(|edge| edge.song.clone())
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect()
            })
            .unwrap_or_default(),
        Action::Restore { entities, .. } => entities
            .iter()
            .filter_map(|e| {
                if let Entity::Song(id) = e {
                    Some(id.clone())
                } else {
                    None
                }
            })
            .collect(),
        Action::AdoptInventory { inventory } => {
            inventory.songs.iter().map(|s| s.id.clone()).collect()
        }
        _ => vec![],
    };
    let selected: BTreeSet<_> = ids.iter().collect();
    let effects = &preview.effects;
    let edges = match &preview.request.action {
        Action::Restore {
            trash_operation_id, ..
        } => catalog
            .snapshot()
            .trash
            .iter()
            .find(|t| t.operation_id == *trash_operation_id)
            .map(|t| {
                t.memberships
                    .iter()
                    .map(|m| m.membership.id.clone())
                    .collect()
            })
            .unwrap_or_default(),
        Action::AdoptInventory { inventory } => {
            inventory.memberships.iter().map(|m| m.id.clone()).collect()
        }
        _ => catalog
            .snapshot()
            .inventory
            .memberships
            .iter()
            .map(|m| m.id.clone())
            .collect::<Vec<_>>(),
    };
    let shared = ids
        .iter()
        .filter(|song| edges.iter().filter(|m| m.song == **song).count() > 1)
        .count();
    let mut affected = Vec::new();
    for id in &effects.affected_packs {
        let mut row = if catalog
            .snapshot()
            .inventory
            .packs
            .iter()
            .any(|p| p.id == *id)
        {
            pack_ref(catalog, id)
        } else if let Action::AdoptInventory { inventory } = &preview.request.action {
            let p = inventory
                .packs
                .iter()
                .find(|p| p.id == *id)
                .expect("adopted pack");
            pack_value(p)
        } else if let Action::CreatePack { name, .. } = &preview.request.action {
            json!({"collection_id":id,"kind":"custom","import_pack_id":null,"name":name})
        } else {
            json!({"collection_id":id,"import_pack_id":null,"name":""})
        };
        if let Action::RenamePack { pack_id, name } = &preview.request.action {
            if pack_id == id {
                row["name"] = json!(name);
            }
        }
        row["selected_song_count"] = json!(match &preview.request.action {
            Action::AddMemberships { pack_id, song_ids } if pack_id == id => song_ids.len(),
            Action::MoveMemberships {
                to_pack, song_ids, ..
            } if to_pack == id => song_ids.len(),
            _ => edges
                .iter()
                .filter(|m| m.pack == *id && selected.contains(&m.song))
                .count(),
        });
        affected.push(row)
    }
    let mut value = json!({"selected_count":ids.len(),"changed_song_count":effects.trashed_songs.len()+effects.restored_songs.len()+effects.adopted_songs.len(),"created_pack_count":effects.created_packs.len(),"renamed_pack_count":effects.renamed_packs.len(),"added_membership_count":effects.added_memberships.len(),"unchanged_membership_count":effects.noops.iter().filter(|n|n.reason == catalog::NoopReason::AlreadyPresent).count(),"removed_membership_count":effects.removed_memberships.len(),"restored_membership_count":effects.added_memberships.len(),"shared_song_count":shared,"affected_packs":affected,"reclaimed_bytes":0});
    value["noop_membership_count"] = json!(effects
        .noops
        .iter()
        .filter(|noop| matches!(noop.target, catalog::Target::Membership(_)))
        .count());
    // Keep the exact reviewed destination visible even for an all-noop add or rename.
    match &preview.request.action {
        Action::CreatePack { pack_id, name } | Action::RenamePack { pack_id, name } => {
            value["target_pack"] =
                json!({"collection_id":pack_id,"kind":"custom","import_pack_id":null,"name":name});
        }
        Action::AddMemberships { pack_id, .. } => value["target_pack"] = pack_ref(catalog, pack_id),
        Action::RemoveMemberships { pack_id, .. } => {
            value["source_pack"] = pack_ref(catalog, pack_id);
            value["target_pack"] = pack_ref(catalog, pack_id);
            value["destination_pack"] = Value::Null;
        }
        Action::MoveMemberships {
            from_pack, to_pack, ..
        } => {
            value["source_pack"] = pack_ref(catalog, from_pack);
            value["destination_pack"] = pack_ref(catalog, to_pack);
            value["target_pack"] = pack_ref(catalog, to_pack);
        }
        Action::UndoMemberships {
            membership_operation_id,
        } => {
            let original = &catalog
                .receipt(membership_operation_id)
                .expect("validated membership undo")
                .preview;
            value["membership_operation_id"] = json!(membership_operation_id);
            value["selected_edition_ids"] = json!(ids);
            match &original.request.action {
                Action::RemoveMemberships { pack_id, .. } => {
                    value["source_pack"] = pack_ref(catalog, pack_id);
                    value["target_pack"] = pack_ref(catalog, pack_id);
                    value["destination_pack"] = Value::Null;
                }
                Action::MoveMemberships {
                    from_pack, to_pack, ..
                } => {
                    value["source_pack"] = pack_ref(catalog, from_pack);
                    value["destination_pack"] = pack_ref(catalog, to_pack);
                    value["target_pack"] = pack_ref(catalog, from_pack);
                }
                _ => unreachable!("validated membership undo"),
            }
        }
        _ => (),
    }
    if matches!(
        preview.request.action,
        Action::RemoveMemberships { .. } | Action::MoveMemberships { .. }
    ) {
        value["undo_operation_id"] = if effects.removed_membership_snapshots.is_empty() {
            Value::Null
        } else {
            json!(preview.request.operation_id)
        };
    }
    value
}
fn preview(library: &NativeLibrary, request: Selection) -> Result<Value> {
    bind(library, &request.library_id)?;
    if request.edition_ids.len() > catalog::MAX_SELECTION {
        return Err(core_error(catalog::Error::Limit("selection")));
    }
    let _lock = library.lock()?;
    let loaded =
        load_managed_locked(library)?.ok_or_else(|| journal_error(journal::Error::NeverManaged))?;
    freshness(
        &loaded.catalog,
        request.expected_generation,
        &request.catalog_digest,
    )?;
    let verified = verified(library)?;
    require_physical(&loaded.catalog, &verified, &request.edition_ids)?;
    if (request.destination_collection_id.is_some() && request.action != "move_memberships")
        || (request.membership_operation_id.is_some() && request.action != "undo_memberships")
    {
        return Err(core_error(catalog::Error::Invalid(
            "unexpected membership fields",
        )));
    }
    let action = match request.action.as_str() {
        "create_pack"
            if request.edition_ids.is_empty()
                && request.collection_id.is_none()
                && request.trash_operation_id.is_none() =>
        {
            let mut used = loaded
                .catalog
                .snapshot()
                .inventory
                .packs
                .iter()
                .map(|pack| pack.id.as_str().to_owned())
                .collect();
            Action::CreatePack {
                pack_id: PackId::parse(random_id("collection-", &mut used)?).map_err(core_error)?,
                name: request
                    .name
                    .ok_or_else(|| core_error(catalog::Error::Invalid("missing name")))?,
            }
        }
        "rename_pack" if request.edition_ids.is_empty() && request.trash_operation_id.is_none() => {
            Action::RenamePack {
                pack_id: request
                    .collection_id
                    .ok_or_else(|| core_error(catalog::Error::Invalid("missing collection")))?,
                name: request
                    .name
                    .ok_or_else(|| core_error(catalog::Error::Invalid("missing name")))?,
            }
        }
        "add_memberships" if request.name.is_none() && request.trash_operation_id.is_none() => {
            Action::AddMemberships {
                pack_id: request
                    .collection_id
                    .ok_or_else(|| core_error(catalog::Error::Invalid("missing collection")))?,
                song_ids: request.edition_ids,
            }
        }
        "remove_memberships" if request.name.is_none() && request.trash_operation_id.is_none() => {
            Action::RemoveMemberships {
                pack_id: request
                    .collection_id
                    .ok_or_else(|| core_error(catalog::Error::Invalid("missing collection")))?,
                song_ids: request.edition_ids,
            }
        }
        "move_memberships" if request.name.is_none() && request.trash_operation_id.is_none() => {
            Action::MoveMemberships {
                from_pack: request
                    .collection_id
                    .ok_or_else(|| core_error(catalog::Error::Invalid("missing collection")))?,
                to_pack: request
                    .destination_collection_id
                    .ok_or_else(|| core_error(catalog::Error::Invalid("missing destination")))?,
                song_ids: request.edition_ids,
            }
        }
        "undo_memberships"
            if request.edition_ids.is_empty()
                && request.collection_id.is_none()
                && request.name.is_none()
                && request.trash_operation_id.is_none() =>
        {
            Action::UndoMemberships {
                membership_operation_id: request.membership_operation_id.ok_or_else(|| {
                    core_error(catalog::Error::Invalid("missing membership operation"))
                })?,
            }
        }
        "trash_songs"
            if request.trash_operation_id.is_none()
                && request.collection_id.is_none()
                && request.name.is_none() =>
        {
            Action::TrashSongs {
                song_ids: request.edition_ids,
            }
        }
        "restore_songs" if request.collection_id.is_none() && request.name.is_none() => {
            Action::Restore {
                trash_operation_id: request.trash_operation_id.ok_or_else(|| {
                    core_error(catalog::Error::Invalid("missing trash operation"))
                })?,
                entities: request.edition_ids.into_iter().map(Entity::Song).collect(),
                memberships: vec![],
            }
        }
        _ => {
            return Err(core_error(catalog::Error::Invalid(
                "unsupported product action",
            )));
        }
    };
    allowed_action(&loaded.catalog, &verified, &action)?;
    let preview = loaded
        .catalog
        .preview(catalog::Request {
            schema_version: 1,
            operation_id: operation_id(library, Some(&loaded))?,
            expected_generation: request.expected_generation,
            at_unix_ms: now()?,
            action,
        })
        .map_err(core_error)?;
    envelope(
        library,
        json!({"summary":summary(&loaded.catalog,&preview),"preview":preview}),
    )
}
fn sync_preview(library: &NativeLibrary, request: Sync) -> Result<Value> {
    bind(library, &request.library_id)?;
    let _lock = library.lock()?;
    let loaded =
        load_managed_locked(library)?.ok_or_else(|| journal_error(journal::Error::NeverManaged))?;
    freshness(
        &loaded.catalog,
        request.expected_generation,
        &request.catalog_digest,
    )?;
    let verified = verified(library)?;
    let mapping = collections(&verified, Some(&loaded.catalog))?;
    let inventory = seed(&verified, &mapping, Some(&loaded.catalog))?;
    if inventory.songs.is_empty() && inventory.sources.is_empty() {
        return Err(fail(
            409,
            "catalog_conflict",
            "No new verified songs or sources need synchronization",
        ));
    }
    let remaining_song_count = verified
        .entries
        .iter()
        .filter(|entry| {
            !loaded
                .catalog
                .snapshot()
                .inventory
                .songs
                .iter()
                .any(|s| s.id.as_str() == pack_groups::edition_id(entry))
        })
        .count()
        - inventory.songs.len();
    let remaining_source_count = verified
        .evidence
        .packs
        .iter()
        .filter(|pack| {
            !loaded
                .catalog
                .snapshot()
                .inventory
                .sources
                .iter()
                .any(|s| s.id.as_str() == pack.archive_key)
        })
        .count()
        - inventory.sources.len();
    let preview = loaded
        .catalog
        .preview(catalog::Request {
            schema_version: 1,
            operation_id: operation_id(library, Some(&loaded))?,
            expected_generation: request.expected_generation,
            at_unix_ms: now()?,
            action: Action::AdoptInventory { inventory },
        })
        .map_err(core_error)?;
    let mut summary = summary(&loaded.catalog, &preview);
    summary["remaining_song_count"] = json!(remaining_song_count);
    summary["remaining_source_count"] = json!(remaining_source_count);
    envelope(library, json!({"summary":summary,"preview":preview}))
}
fn allowed_action(catalog: &Catalog, verified: &Verified, action: &Action) -> Result<()> {
    match action {
        Action::CreatePack { .. } => Ok(()),
        Action::RenamePack { pack_id, .. } => require_custom(catalog, pack_id),
        Action::AddMemberships { pack_id, song_ids }
        | Action::RemoveMemberships { pack_id, song_ids }
            if !song_ids.is_empty() =>
        {
            require_custom(catalog, pack_id)?;
            require_physical(catalog, verified, song_ids)
        }
        Action::MoveMemberships {
            from_pack,
            to_pack,
            song_ids,
        } if !song_ids.is_empty() => {
            require_custom(catalog, from_pack)?;
            require_custom(catalog, to_pack)?;
            require_physical(catalog, verified, song_ids)
        }
        Action::UndoMemberships {
            membership_operation_id,
        } => {
            let original = catalog
                .receipt(membership_operation_id)
                .ok_or_else(|| core_error(catalog::Error::NotFound))?;
            let ids: Vec<_> = original
                .preview
                .effects
                .removed_memberships
                .iter()
                .chain(&original.preview.effects.added_memberships)
                .map(|edge| edge.song.clone())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect();
            match &original.preview.request.action {
                Action::RemoveMemberships { pack_id, .. } => require_custom(catalog, pack_id)?,
                Action::MoveMemberships {
                    from_pack, to_pack, ..
                } => {
                    require_custom(catalog, from_pack)?;
                    require_custom(catalog, to_pack)?;
                }
                _ => return Err(core_error(catalog::Error::Conflict)),
            }
            require_physical(catalog, verified, &ids)
        }
        Action::TrashSongs { song_ids } if !song_ids.is_empty() => {
            require_physical(catalog, verified, song_ids)
        }
        Action::Restore {
            entities,
            memberships,
            ..
        } if !entities.is_empty() && memberships.is_empty() => {
            let ids: Vec<_> = entities
                .iter()
                .map(|e| match e {
                    Entity::Song(id) => Ok(id.clone()),
                    _ => Err(core_error(catalog::Error::Invalid(
                        "pack restore not exposed",
                    ))),
                })
                .collect::<Result<_>>()?;
            require_physical(catalog, verified, &ids)
        }
        Action::AdoptInventory { inventory } => {
            let mut mapping = Vec::new();
            for source in &inventory.sources {
                mapping.push(Collection {
                    source_id: source.id.clone(),
                    collection_id: source
                        .default_imported_pack
                        .clone()
                        .ok_or_else(|| core_error(catalog::Error::Invalid("source pack")))?,
                });
            }
            if seed(verified, &mapping, Some(catalog))? != *inventory {
                return Err(core_error(catalog::Error::Stale));
            }
            Ok(())
        }
        _ => Err(core_error(catalog::Error::Invalid(
            "unsupported product action",
        ))),
    }
}
fn mutation_error(
    library: &NativeLibrary,
    error: LibraryError,
    id: &OperationId,
    outcome: &str,
) -> Value {
    let mut value = serde_json::to_value(error).expect("error");
    value["operation_id"] = json!(id);
    value["outcome"] = json!(outcome);
    envelope(library, value.clone()).unwrap_or(value)
}
fn commit_response(
    library: &NativeLibrary,
    request: Commit,
) -> std::result::Result<Value, (u16, Value)> {
    let id = request.preview.request.operation_id.clone();
    let mut outcome = "uncertain";
    let result = (|| -> Result<Value> {
        bind(library, &request.library_id)?;
        let _lock = library.lock()?;
        let loaded = load_managed_locked(library)?
            .ok_or_else(|| journal_error(journal::Error::NeverManaged))?;
        let existing = loaded.catalog.receipt(&id);
        if existing.is_none() {
            outcome = "not_committed";
            let verified = verified(library)?;
            allowed_action(&loaded.catalog, &verified, &request.preview.request.action)?;
        } else if existing.is_some_and(|r| r.preview.request != request.preview.request) {
            outcome = "not_committed";
            return Err(core_error(catalog::Error::IdempotencyConflict));
        }
        let committed = journal::commit_locked(library, &request.preview).map_err(|e| {
            outcome = match e.outcome {
                journal::Outcome::NotCommitted => "not_committed",
                journal::Outcome::CommitUncertain => "uncertain",
            };
            journal_error(e.cause)
        })?;
        outcome = "uncertain";
        invalidate(library)?;
        envelope(
            library,
            json!({"outcome":"committed","operation_id":id,"generation":committed.catalog.snapshot().generation,"catalog_digest":catalog_digest(&committed.catalog),"receipt":committed.receipt,"replayed":committed.replayed}),
        )
    })();
    result.map_err(|error| (error.status, mutation_error(library, error, &id, outcome)))
}
fn valid_initialization(catalog: &Catalog, preview: &InitializationPreview) -> bool {
    let mapping: Vec<_> = catalog
        .snapshot()
        .inventory
        .sources
        .iter()
        .filter_map(|s| {
            s.default_imported_pack.as_ref().map(|p| Collection {
                source_id: s.id.clone(),
                collection_id: p.clone(),
            })
        })
        .collect();
    preview.kind == "initialize"
        && mapping == preview.collections
        && hash(&catalog.snapshot().inventory) == preview.inventory_digest
        && catalog_digest(catalog) == preview.seed_digest
        && counts(catalog) == preview.counts
        && catalog
            .snapshot()
            .inventory
            .songs
            .iter()
            .map(|s| s.retained_bytes)
            .sum::<u64>()
            == preview.retained_payload_bytes
        && catalog
            .snapshot()
            .inventory
            .sources
            .iter()
            .map(|s| s.retained_bytes)
            .sum::<u64>()
            == preview.retained_source_bytes
}
fn initialize_response(
    library: &NativeLibrary,
    request: Initialize,
) -> std::result::Result<Value, (u16, Value)> {
    let id = request.preview.operation_id.clone();
    let mut outcome = "uncertain";
    let result = (|| -> Result<Value> {
        bind(library, &request.library_id)?;
        bind(library, &request.preview.library_id)?;
        let _lock = library.lock()?;
        let previous = load_managed_locked(library);
        if let Ok(Some(ref loaded)) = previous {
            let (bootstrap, seed_digest, genesis) =
                journal::bootstrap_locked(library).map_err(journal_error)?;
            if bootstrap != id
                || seed_digest != request.preview.seed_digest
                || !valid_initialization(&genesis, &request.preview)
            {
                outcome = "not_committed";
                return Err(core_error(catalog::Error::IdempotencyConflict));
            }
            let mut value = state(Some(loaded));
            value["outcome"] = json!("committed");
            value["operation_id"] = json!(id);
            value["replayed"] = json!(true);
            return envelope(library, value);
        }
        if previous.is_ok() {
            outcome = "not_committed";
        }
        if request.preview.kind != "initialize" {
            return Err(core_error(catalog::Error::Invalid("initialization kind")));
        }
        let verified = verified(library)?;
        let catalog = Catalog::from_seed(seed(&verified, &request.preview.collections, None)?)
            .map_err(core_error)?;
        if !valid_initialization(&catalog, &request.preview) {
            return Err(core_error(catalog::Error::InvalidPlan));
        }
        let loaded = journal::initialize_locked(library, catalog, id.clone()).map_err(|e| {
            outcome = match e.outcome {
                journal::Outcome::NotCommitted => "not_committed",
                journal::Outcome::CommitUncertain => "uncertain",
            };
            journal_error(e.cause)
        })?;
        outcome = "uncertain";
        invalidate(library)?;
        let mut value = state(Some(&loaded));
        value["outcome"] = json!("committed");
        value["operation_id"] = json!(id);
        value["replayed"] = json!(false);
        envelope(library, value)
    })();
    result.map_err(|error| (error.status, mutation_error(library, error, &id, outcome)))
}
fn operation(library: &NativeLibrary, request: Operation) -> Result<Value> {
    bind(library, &request.library_id)?;
    let _lock = library.lock()?;
    let loaded = load_managed_locked(library)?;
    let mut value = json!({"outcome":"not_committed","operation_id":request.operation_id,"generation":null,"catalog_digest":null,"kind":null,"seed_digest":null,"receipt":null});
    if let Some(loaded) = loaded {
        value["generation"] = json!(loaded.catalog.snapshot().generation);
        value["catalog_digest"] = json!(catalog_digest(&loaded.catalog));
        let (id, seed, _) = journal::bootstrap_locked(library).map_err(journal_error)?;
        if id == request.operation_id {
            value["outcome"] = json!("committed");
            value["kind"] = json!("initialize");
            value["seed_digest"] = json!(seed);
        } else if let Some(receipt) = loaded.catalog.receipt(&request.operation_id) {
            value["outcome"] = json!("committed");
            value["kind"] = json!("transition");
            value["receipt"] = json!(receipt);
        }
    }
    envelope(library, value)
}

#[derive(Debug)]
pub(crate) struct Projection {
    manifest: String,
    catalog_digest: String,
    generation: u64,
    snapshot_id: String,
    verified_at: u64,
    counts: Counts,
    active: Vec<Value>,
    trash: Vec<Value>,
    packs: Vec<Value>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Query {
    view: String,
    #[serde(default)]
    collection_id: Option<PackId>,
    #[serde(default)]
    search: String,
    #[serde(default = "page_limit")]
    limit: usize,
    #[serde(default)]
    cursor: Option<String>,
    #[serde(default)]
    refresh: bool,
}
fn page_limit() -> usize {
    40
}
fn build(library: &NativeLibrary, loaded: &journal::Loaded) -> Result<Projection> {
    let inventory = library.scan()?;
    let catalog = &loaded.catalog;
    let mut entries: BTreeMap<_, _> = inventory
        .entries
        .into_iter()
        .map(|e| (pack_groups::edition_id(&e), e))
        .collect();
    let mut active = Vec::new();
    let mut trash = Vec::new();
    for song in &catalog.snapshot().inventory.songs {
        let entry = entries.remove(song.id.as_str());
        let mut packs = Vec::new();
        if let Some(op) = &song.trashed_by {
            if let Some(record) = catalog
                .snapshot()
                .trash
                .iter()
                .find(|r| r.operation_id == *op)
            {
                for edge in &record.memberships {
                    if edge.membership.id.song == song.id {
                        packs.push(pack_ref(catalog, &edge.membership.id.pack));
                    }
                }
            }
        } else {
            for edge in &catalog.snapshot().inventory.memberships {
                if edge.id.song == song.id {
                    packs.push(pack_ref(catalog, &edge.id.pack));
                }
            }
        }
        let row = song_row(
            song.id.as_str(),
            entry.as_ref(),
            true,
            song.trashed_by.as_ref(),
            packs,
        );
        if song.trashed_by.is_some() {
            trash.push(row)
        } else {
            active.push(row)
        }
    }
    for (id, entry) in entries {
        active.push(song_row(&id, Some(&entry), false, None, vec![]));
    }
    active.sort_by(|a, b| a["edition_id"].as_str().cmp(&b["edition_id"].as_str()));
    trash.sort_by(|a, b| a["edition_id"].as_str().cmp(&b["edition_id"].as_str()));
    let mut packs = Vec::new();
    for pack in &catalog.snapshot().inventory.packs {
        if pack.trashed_by.is_some() {
            continue;
        }
        let mut row = pack_value(pack);
        let members: Vec<_> = active
            .iter()
            .filter(|song| {
                song["packs"]
                    .as_array()
                    .expect("song packs")
                    .iter()
                    .any(|p| p["collection_id"] == row["collection_id"])
            })
            .collect();
        row["active_song_count"] = json!(members.len());
        row["available_song_count"] = json!(members
            .iter()
            .filter(|song| song["physical_available"] == true)
            .count());
        row["shared_song_count"] = json!(members
            .iter()
            .filter(|song| song["pack_count"].as_u64().unwrap_or(0) > 1)
            .count());
        packs.push(row);
    }
    packs.sort_by(|a, b| {
        a["collection_id"]
            .as_str()
            .cmp(&b["collection_id"].as_str())
    });
    let digest = catalog_digest(catalog);
    let snapshot_id = hash(&(&digest, &active, &trash, &packs));
    Ok(Projection {
        manifest: loaded.manifest_sha256.clone(),
        catalog_digest: digest,
        generation: catalog.snapshot().generation,
        snapshot_id,
        verified_at: now()?,
        counts: counts(catalog),
        active,
        trash,
        packs,
    })
}
fn song_row(
    id: &str,
    entry: Option<&Entry>,
    managed: bool,
    trashed: Option<&OperationId>,
    packs: Vec<Value>,
) -> Value {
    let (kind, key) = id.split_once(':').expect("song identity");
    json!({"edition_id":id,"key":key,"storage_kind":kind,"title":entry.map_or("Unavailable retained edition",|e|e.title.as_str()),"composer":entry.map_or("",|e|e.composer.as_str()),"score_id":entry.map_or("",|e|e.score_id.as_str()),"profile":entry.and_then(|e|e.clean_package.as_ref()).and_then(|p|p.profile.as_deref()).unwrap_or("canonical"),"catalog_managed":managed,"physical_available":entry.is_some(),"trashed_by":trashed,"pack_count":packs.len(),"packs":packs})
}
fn query(library: &NativeLibrary, request: Query) -> Result<Value> {
    if !matches!(request.view.as_str(), "active" | "trash" | "packs")
        || (request.view == "packs" && request.collection_id.is_some())
        || !(1..=100).contains(&request.limit)
        || request.search.len() > 256
        || (request.refresh && request.cursor.is_some())
    {
        return Err(core_error(catalog::Error::Invalid("query")));
    }
    let _lock = library.lock()?;
    let loaded =
        load_managed_locked(library)?.ok_or_else(|| journal_error(journal::Error::NeverManaged))?;
    if let Some(id) = &request.collection_id {
        if !loaded
            .catalog
            .snapshot()
            .inventory
            .packs
            .iter()
            .any(|pack| pack.id == *id && pack.trashed_by.is_none())
        {
            return Err(core_error(catalog::Error::NotFound));
        }
    }
    let mut cache = library
        .process_lock
        .catalog_product
        .lock()
        .map_err(|_| fail(500, "library_io", "Catalog cache coordination interrupted"))?;
    let cached = !request.refresh
        && cache
            .as_ref()
            .is_some_and(|c| c.manifest == loaded.manifest_sha256);
    if !cached {
        *cache = None;
        *cache = Some(build(library, &loaded)?)
    }
    let projection = cache.as_ref().expect("built");
    let filter = hash(&(
        &request.view,
        &request.collection_id,
        &request.search,
        request.limit,
    ));
    let offset = if let Some(cursor) = &request.cursor {
        if cursor.len() > 160 {
            return Err(core_error(catalog::Error::Invalid("cursor")));
        }
        let parts: Vec<_> = cursor.split(':').collect();
        if parts.len() != 3 || parts[1] != filter {
            return Err(core_error(catalog::Error::Invalid("cursor filters")));
        }
        if parts[0] != projection.snapshot_id {
            return Err(core_error(catalog::Error::Stale));
        }
        parts[2]
            .parse::<usize>()
            .ok()
            .filter(|n| *n > 0)
            .ok_or_else(|| core_error(catalog::Error::Invalid("cursor offset")))?
    } else {
        0
    };
    let needle = request.search.to_lowercase();
    let source = match request.view.as_str() {
        "active" => &projection.active,
        "trash" => &projection.trash,
        _ => &projection.packs,
    };
    let rows: Vec<_> = source
        .iter()
        .filter(|r| {
            request.collection_id.as_ref().is_none_or(|id| {
                r["packs"]
                    .as_array()
                    .is_some_and(|packs| packs.iter().any(|p| p["collection_id"] == id.as_str()))
            })
        })
        .filter(|r| {
            ["title", "composer", "score_id", "name"]
                .iter()
                .any(|k| r[k].as_str().unwrap_or("").to_lowercase().contains(&needle))
        })
        .collect();
    if offset > rows.len() {
        return Err(core_error(catalog::Error::Invalid("cursor offset")));
    }
    let mut page = Vec::new();
    let mut bytes = 16 * 1024;
    let mut end = offset;
    for row in rows.iter().skip(offset).take(request.limit) {
        let size = serde_json::to_vec(row).expect("row").len();
        if bytes + size > RESPONSE_LIMIT {
            if page.is_empty() {
                return Err(fail(
                    413,
                    "catalog_capacity",
                    "A catalog row exceeds the 4 MiB page bound",
                ));
            }
            break;
        }
        bytes += size;
        page.push(*row);
        end += 1;
    }
    envelope(
        library,
        json!({"view":request.view,"collection_id":request.collection_id,"generation":projection.generation,"catalog_digest":projection.catalog_digest,"snapshot_id":projection.snapshot_id,"freshness":{"kind":"advisory_snapshot","verified_at_unix_ms":projection.verified_at,"cached":cached,"change_detection":"explicit_refresh"},"counts":projection.counts,"total":rows.len(),"next_cursor":if end<rows.len(){Some(format!("{}:{filter}:{end}",projection.snapshot_id))}else{None},"rows":page}),
    )
}
fn decode<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> Result<T> {
    serde_json::from_slice(bytes).map_err(|e| {
        fail(
            400,
            "catalog_invalid_request",
            format!("Invalid bounded catalog request: {e}"),
        )
    })
}
pub fn dispatch(
    library: &NativeLibrary,
    method: &str,
    path: &str,
    bytes: &[u8],
) -> http::Response<Vec<u8>> {
    if bytes.len() > REQUEST_LIMIT {
        return product_error(
            library,
            fail(
                413,
                "catalog_capacity",
                "Catalog request exceeds its bounded transport limit",
            ),
        );
    }
    if method == "POST" && path == "/api/library/catalog/commit" {
        return match decode(bytes) {
            Ok(request) => write_response(commit_response(library, request)),
            Err(error) => product_error(library, error),
        };
    }
    if method == "POST" && path == "/api/library/catalog/initialize" {
        return match decode(bytes) {
            Ok(request) => write_response(initialize_response(library, request)),
            Err(error) => product_error(library, error),
        };
    }
    let result = match (method, path) {
        ("GET", "/api/library/catalog/status") => (|| {
            let _lock = library.lock()?;
            let loaded = load_managed_locked(library)?;
            let mut value = state(loaded.as_ref());
            value["supported_operations"] = json!([
                "initialize",
                "trash_songs",
                "restore_songs",
                "sync_inventory",
                "create_pack",
                "rename_pack",
                "add_memberships",
                "remove_memberships",
                "move_memberships",
                "undo_memberships"
            ]);
            value["membership_undo"] = loaded
                .as_ref()
                .map(|loaded| membership_undo_status(&loaded.catalog))
                .unwrap_or(Value::Null);
            envelope(library, value)
        })(),
        ("POST", "/api/library/catalog/initialize/preview") => {
            decode::<Empty>(bytes).and_then(|_| initialize_preview(library))
        }
        ("POST", "/api/library/catalog/preview") => decode(bytes).and_then(|r| preview(library, r)),
        ("POST", "/api/library/catalog/sync/preview") => {
            decode(bytes).and_then(|r| sync_preview(library, r))
        }
        ("POST", "/api/library/catalog/operation") => {
            decode(bytes).and_then(|r| operation(library, r))
        }
        ("POST", "/api/library/catalog/query") => decode(bytes).and_then(|r| query(library, r)),
        _ => Err(fail(
            405,
            "catalog_invalid_request",
            "Unsupported catalog route or method",
        )),
    };
    match result {
        Ok(value) => write_response(Ok(value)),
        Err(error) => product_error(library, error),
    }
}
fn product_error(library: &NativeLibrary, error: LibraryError) -> http::Response<Vec<u8>> {
    let status = error.status;
    let value = serde_json::to_value(error).expect("catalog error");
    write_response(Err((
        status,
        envelope(library, value.clone()).unwrap_or(value),
    )))
}
fn write_response(result: std::result::Result<Value, (u16, Value)>) -> http::Response<Vec<u8>> {
    let (status, value) = match result {
        Ok(v) => (200, v),
        Err((s, v)) => (s, v),
    };
    crate::response(
        status,
        "application/json; charset=utf-8",
        serde_json::to_vec(&value).expect("catalog response"),
    )
}

#[cfg(test)]
#[path = "catalog_product_tests.rs"]
mod tests;
