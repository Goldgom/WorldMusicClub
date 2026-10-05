//! Pure, bounded catalog transitions. This module never opens a library or writes
//! files. A host must verify payloads, issue collision-checked random IDs, and
//! atomically persist the entire returned snapshot before reporting durable success.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

pub const VERSION: u32 = 1;
pub const MAX_SONGS: usize = 1024;
pub const MAX_PACKS: usize = 256;
pub const MAX_MEMBERSHIPS: usize = 16_384;
pub const MAX_SELECTION: usize = 1024;
pub const MAX_HISTORY: usize = 4096;
pub const MAX_STATE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_REQUEST_BYTES: usize = 256 * 1024;
const MAX_SOURCES: usize = 1024;
const MAX_ORIGINS: usize = 16_384;
const MAX_CAPTURED_EDGES: usize = 65_536;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    Invalid(&'static str),
    Limit(&'static str),
    UnsupportedVersion,
    NotFound,
    InTrash,
    Conflict,
    Stale,
    IdempotencyConflict,
    InvalidPlan,
}
pub type Result<T> = std::result::Result<T, Error>;

fn hexadecimal_id(value: &str, prefix: &str, digits: usize) -> bool {
    value.strip_prefix(prefix).is_some_and(|suffix| {
        suffix.len() == digits
            && suffix
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}
macro_rules! identity {
    ($name:ident, $check:expr) => {
        #[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
        #[serde(try_from = "String", into = "String")]
        pub struct $name(String);
        impl $name {
            pub fn parse(value: impl Into<String>) -> Result<Self> {
                let value = value.into();
                if ($check)(&value) {
                    Ok(Self(value))
                } else {
                    Err(Error::Invalid("identity"))
                }
            }
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }
        impl TryFrom<String> for $name {
            type Error = &'static str;
            fn try_from(value: String) -> std::result::Result<Self, Self::Error> {
                Self::parse(value).map_err(|_| "invalid catalog identity")
            }
        }
        impl From<$name> for String {
            fn from(value: $name) -> Self {
                value.0
            }
        }
    };
}
identity!(SongId, |value: &str| {
    ["legacy:", "clean:"].iter().any(|prefix| {
        value
            .strip_prefix(prefix)
            .is_some_and(|key| hexadecimal_id(key, "song-", 64))
    })
});
identity!(PackId, |value: &str| hexadecimal_id(
    value,
    "collection-",
    32
));
identity!(OperationId, |value: &str| hexadecimal_id(
    value,
    "operation-",
    32
));
identity!(SourceId, |value: &str| hexadecimal_id(value, "pack-", 64));

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MembershipId {
    pub pack: PackId,
    pub song: SongId,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "id",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum Entity {
    Song(SongId),
    Pack(PackId),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PackKind {
    Imported,
    Custom,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Song {
    pub id: SongId,
    /// Host-verified retained physical payload/backup bytes; never changed here.
    pub retained_bytes: u64,
    pub revision: u64,
    pub trashed_by: Option<OperationId>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pack {
    pub id: PackId,
    pub name: String,
    pub kind: PackKind,
    pub source_archive_keys: Vec<SourceId>,
    pub origin_import_operation_id: Option<OperationId>,
    pub revision: u64,
    pub trashed_by: Option<OperationId>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Membership {
    pub id: MembershipId,
    pub position: u32,
    pub added_at_unix_ms: u64,
    pub revision: u64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Source {
    pub id: SourceId,
    pub retained_bytes: u64,
    pub default_imported_pack: Option<PackId>,
}
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceType {
    ReceiptDerived,
    VerifiedImport,
}
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Origin {
    pub song: SongId,
    pub source: SourceId,
    pub receipt_filename: String,
    pub item_index: u32,
    pub item_path: String,
    pub evidence_type: EvidenceType,
}

/// A host supplies a verified inventory. Titles, paths and score IDs never select
/// an edition. A source-only archive may have no song origins or memberships.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Seed {
    pub songs: Vec<Song>,
    pub packs: Vec<Pack>,
    pub memberships: Vec<Membership>,
    pub sources: Vec<Source>,
    pub origins: Vec<Origin>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[allow(clippy::large_enum_variant)]
pub enum EntitySnapshot {
    Song(Song),
    Pack(Pack),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CapturedEntity {
    pub entity: Entity,
    pub before_revision: u64,
    pub before: EntitySnapshot,
    pub restored_by: Option<OperationId>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CapturedMembership {
    pub membership: Membership,
    pub restored_by: Option<OperationId>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrashRecord {
    pub operation_id: OperationId,
    pub at_unix_ms: u64,
    pub entities: Vec<CapturedEntity>,
    pub memberships: Vec<CapturedMembership>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub schema_version: u32,
    pub generation: u64,
    pub inventory: Seed,
    pub trash: Vec<TrashRecord>,
    pub receipts: Vec<Receipt>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    CreatePack {
        pack_id: PackId,
        name: String,
    },
    RenamePack {
        pack_id: PackId,
        name: String,
    },
    AddMemberships {
        pack_id: PackId,
        song_ids: Vec<SongId>,
    },
    MoveMemberships {
        from_pack: PackId,
        to_pack: PackId,
        song_ids: Vec<SongId>,
    },
    RemoveMemberships {
        pack_id: PackId,
        song_ids: Vec<SongId>,
    },
    TrashSongs {
        song_ids: Vec<SongId>,
    },
    /// The optional cascade is an explicit list, never a computed selection.
    TrashPack {
        pack_id: PackId,
        exclusive_song_ids: Vec<SongId>,
    },
    /// Captured edges incident to entities reactivated by this transaction are
    /// considered for restoration. Already-restored entities are no-ops; explicit
    /// edge IDs can retry previously blocked edges later.
    Restore {
        trash_operation_id: OperationId,
        entities: Vec<Entity>,
        memberships: Vec<MembershipId>,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub schema_version: u32,
    pub operation_id: OperationId,
    pub expected_generation: u64,
    pub at_unix_ms: u64,
    pub action: Action,
}
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "id",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum Target {
    Entity(Entity),
    Membership(MembershipId),
}
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoopReason {
    AlreadyPresent,
    AlreadyAbsent,
    SamePack,
    UnchangedName,
    AlreadyRestored,
}
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Noop {
    pub target: Target,
    pub reason: NoopReason,
}
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BlockedMembership {
    pub membership: MembershipId,
    pub dependencies: Vec<Entity>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Effects {
    pub created_packs: Vec<PackId>,
    pub renamed_packs: Vec<PackId>,
    pub added_memberships: Vec<MembershipId>,
    pub removed_memberships: Vec<MembershipId>,
    pub trashed_songs: Vec<SongId>,
    pub trashed_packs: Vec<PackId>,
    pub restored_songs: Vec<SongId>,
    pub restored_packs: Vec<PackId>,
    pub noops: Vec<Noop>,
    pub blocked_memberships: Vec<BlockedMembership>,
    pub affected_packs: Vec<PackId>,
    pub newly_unfiled_songs: Vec<SongId>,
    /// Entire physical inventory, including Trash and retained-only sources.
    pub retained_payload_bytes: u64,
    pub retained_source_bytes: u64,
    pub reclaimed_bytes: u64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Preview {
    pub request: Request,
    pub request_digest: String,
    pub base_digest: String,
    pub next_generation: u64,
    pub effects: Effects,
    pub plan_digest: String,
}
/// Evidence of an in-memory transition only. It is NOT a durable commit receipt.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Receipt {
    pub preview: Preview,
}

/// Only validated snapshots can be used for transitions; callers cannot mutate
/// this wrapper. All returned snapshots must still pass host durability checks.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Catalog {
    state: Snapshot,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Applied {
    pub catalog: Catalog,
    pub receipt: Receipt,
    pub replayed: bool,
}

fn digest<T: Serialize>(value: &T) -> String {
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(value).expect("catalog JSON"))
    )
}
fn unique<'a, T: Ord + 'a>(values: impl IntoIterator<Item = &'a T>) -> Result<()> {
    let mut seen = BTreeSet::new();
    for value in values {
        if !seen.insert(value) {
            return Err(Error::Invalid("duplicate identity"));
        }
    }
    Ok(())
}
fn bounded(len: usize, max: usize, label: &'static str) -> Result<()> {
    if len > max {
        Err(Error::Limit(label))
    } else {
        Ok(())
    }
}
fn text_value(value: &str, limit: usize) -> Result<()> {
    if value.trim().is_empty() || value.len() > limit || value.chars().any(char::is_control) {
        Err(Error::Invalid("text"))
    } else {
        Ok(())
    }
}
fn relative_label(value: &str, limit: usize) -> Result<()> {
    text_value(value, limit)?;
    if value.contains(['\\', ':'])
        || value
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(Error::Invalid("source evidence path"));
    }
    Ok(())
}
fn selection<T: Ord>(values: &[T], empty: bool) -> Result<()> {
    bounded(values.len(), MAX_SELECTION, "selection")?;
    if !empty && values.is_empty() {
        return Err(Error::Invalid("empty selection"));
    }
    unique(values)
}
impl Request {
    pub fn from_json(bytes: &[u8]) -> Result<Self> {
        bounded(bytes.len(), MAX_REQUEST_BYTES, "request bytes")?;
        let request: Self =
            serde_json::from_slice(bytes).map_err(|_| Error::Invalid("request JSON"))?;
        request.validate()?;
        Ok(request)
    }
    fn validate(&self) -> Result<()> {
        if self.schema_version != VERSION {
            return Err(Error::UnsupportedVersion);
        }
        bounded(
            serde_json::to_vec(self)
                .map_err(|_| Error::Invalid("request JSON"))?
                .len(),
            MAX_REQUEST_BYTES,
            "request bytes",
        )?;
        match &self.action {
            Action::CreatePack { name, .. } | Action::RenamePack { name, .. } => {
                text_value(name, 256)
            }
            Action::AddMemberships { song_ids, .. }
            | Action::MoveMemberships { song_ids, .. }
            | Action::RemoveMemberships { song_ids, .. }
            | Action::TrashSongs { song_ids } => selection(song_ids, false),
            Action::TrashPack {
                exclusive_song_ids, ..
            } => selection(exclusive_song_ids, true),
            Action::Restore {
                entities,
                memberships,
                ..
            } => {
                selection(entities, true)?;
                selection(memberships, true)?;
                bounded(
                    entities.len() + memberships.len(),
                    MAX_SELECTION,
                    "selection",
                )?;
                if entities.is_empty() && memberships.is_empty() {
                    return Err(Error::Invalid("empty restore"));
                }
                Ok(())
            }
        }
    }
}

impl Catalog {
    pub fn from_seed(seed: Seed) -> Result<Self> {
        Self::from_snapshot(Snapshot {
            schema_version: VERSION,
            generation: 0,
            inventory: seed,
            trash: vec![],
            receipts: vec![],
        })
    }
    pub fn from_json(bytes: &[u8]) -> Result<Self> {
        bounded(bytes.len(), MAX_STATE_BYTES, "state bytes")?;
        Self::from_snapshot(
            serde_json::from_slice(bytes).map_err(|_| Error::Invalid("snapshot JSON"))?,
        )
    }
    pub fn from_snapshot(mut state: Snapshot) -> Result<Self> {
        validate_state(&state)?;
        state.inventory.songs.sort_by(|a, b| a.id.cmp(&b.id));
        state.inventory.packs.sort_by(|a, b| a.id.cmp(&b.id));
        for pack in &mut state.inventory.packs {
            pack.source_archive_keys.sort();
        }
        state.inventory.memberships.sort_by(|a, b| a.id.cmp(&b.id));
        state.inventory.sources.sort_by(|a, b| a.id.cmp(&b.id));
        state.inventory.origins.sort();
        state
            .trash
            .sort_by(|a, b| a.operation_id.cmp(&b.operation_id));
        for record in &mut state.trash {
            record.entities.sort_by(|a, b| a.entity.cmp(&b.entity));
            record
                .memberships
                .sort_by(|a, b| a.membership.id.cmp(&b.membership.id));
        }
        // Receipts remain in generation order: no pruning or history rewrite.
        Ok(Self { state })
    }
    pub fn snapshot(&self) -> &Snapshot {
        &self.state
    }
    pub fn receipt(&self, id: &OperationId) -> Option<&Receipt> {
        self.state
            .receipts
            .iter()
            .find(|receipt| &receipt.preview.request.operation_id == id)
    }
    pub fn preview(&self, request: Request) -> Result<Preview> {
        request.validate()?;
        if let Some(receipt) = self.receipt(&request.operation_id) {
            return if receipt.preview.request == request {
                Ok(receipt.preview.clone())
            } else {
                Err(Error::IdempotencyConflict)
            };
        }
        if request.expected_generation != self.state.generation {
            return Err(Error::Stale);
        }
        bounded(
            self.state.receipts.len() + 1,
            MAX_HISTORY,
            "receipt history",
        )?;
        let next_generation = self
            .state
            .generation
            .checked_add(1)
            .ok_or(Error::Limit("generation"))?;
        let (next, effects) = transition(&self.state, &request, next_generation)?;
        let mut preview = Preview {
            request_digest: digest(&request),
            base_digest: digest(&self.state),
            request,
            next_generation,
            effects,
            plan_digest: String::new(),
        };
        preview.plan_digest = plan_digest(&preview);
        let mut candidate = next;
        candidate.receipts.push(Receipt {
            preview: preview.clone(),
        });
        // Capacity and graph checks precede returning a confirmable preview.
        Self::from_snapshot(candidate)?;
        Ok(preview)
    }
    pub fn apply(&self, preview: &Preview) -> Result<Applied> {
        preview.request.validate()?;
        if let Some(receipt) = self.receipt(&preview.request.operation_id) {
            if receipt.preview.request != preview.request {
                return Err(Error::IdempotencyConflict);
            }
            if &receipt.preview != preview {
                return Err(Error::InvalidPlan);
            }
            return Ok(Applied {
                catalog: self.clone(),
                receipt: receipt.clone(),
                replayed: true,
            });
        }
        let expected = self.preview(preview.request.clone())?;
        if &expected != preview {
            return Err(Error::InvalidPlan);
        }
        let (mut next, _) = transition(&self.state, &preview.request, preview.next_generation)?;
        let receipt = Receipt {
            preview: preview.clone(),
        };
        next.receipts.push(receipt.clone());
        Ok(Applied {
            catalog: Self::from_snapshot(next)?,
            receipt,
            replayed: false,
        })
    }
}
fn plan_digest(preview: &Preview) -> String {
    digest(&(
        &preview.request_digest,
        &preview.base_digest,
        preview.next_generation,
        &preview.effects,
    ))
}
fn song<'a>(state: &'a Snapshot, id: &SongId) -> Result<&'a Song> {
    state
        .inventory
        .songs
        .iter()
        .find(|song| &song.id == id)
        .ok_or(Error::NotFound)
}
fn pack<'a>(state: &'a Snapshot, id: &PackId) -> Result<&'a Pack> {
    state
        .inventory
        .packs
        .iter()
        .find(|pack| &pack.id == id)
        .ok_or(Error::NotFound)
}
fn active_song(state: &Snapshot, id: &SongId) -> Result<()> {
    if song(state, id)?.trashed_by.is_some() {
        Err(Error::InTrash)
    } else {
        Ok(())
    }
}
fn active_pack(state: &Snapshot, id: &PackId) -> Result<()> {
    if pack(state, id)?.trashed_by.is_some() {
        Err(Error::InTrash)
    } else {
        Ok(())
    }
}
fn membership<'a>(state: &'a Snapshot, id: &MembershipId) -> Option<&'a Membership> {
    state
        .inventory
        .memberships
        .iter()
        .find(|edge| &edge.id == id)
}
fn entity_state<'a>(
    state: &'a Snapshot,
    entity: &Entity,
) -> Result<(u64, Option<&'a OperationId>)> {
    match entity {
        Entity::Song(id) => {
            let item = song(state, id)?;
            Ok((item.revision, item.trashed_by.as_ref()))
        }
        Entity::Pack(id) => {
            let item = pack(state, id)?;
            Ok((item.revision, item.trashed_by.as_ref()))
        }
    }
}
fn set_trash(state: &mut Snapshot, entity: &Entity, owner: Option<OperationId>, revision: u64) {
    match entity {
        Entity::Song(id) => {
            let item = state
                .inventory
                .songs
                .iter_mut()
                .find(|song| &song.id == id)
                .expect("validated song");
            item.trashed_by = owner;
            item.revision = revision;
        }
        Entity::Pack(id) => {
            let item = state
                .inventory
                .packs
                .iter_mut()
                .find(|pack| &pack.id == id)
                .expect("validated pack");
            item.trashed_by = owner;
            item.revision = revision;
        }
    }
}
fn add_edge(
    state: &mut Snapshot,
    id: MembershipId,
    request: &Request,
    revision: u64,
    effects: &mut Effects,
) -> Result<()> {
    if membership(state, &id).is_some() {
        effects.noops.push(Noop {
            target: Target::Membership(id),
            reason: NoopReason::AlreadyPresent,
        });
    } else {
        let position = state
            .inventory
            .memberships
            .iter()
            .filter(|edge| edge.id.pack == id.pack)
            .map(|edge| edge.position)
            .max()
            .map(|value| {
                value
                    .checked_add(1)
                    .ok_or(Error::Limit("membership position"))
            })
            .transpose()?
            .unwrap_or(0);
        state.inventory.memberships.push(Membership {
            id: id.clone(),
            position,
            added_at_unix_ms: request.at_unix_ms,
            revision,
        });
        effects.added_memberships.push(id);
    }
    Ok(())
}
fn remove_edge(state: &mut Snapshot, id: &MembershipId, effects: &mut Effects) {
    if let Some(index) = state
        .inventory
        .memberships
        .iter()
        .position(|edge| &edge.id == id)
    {
        state.inventory.memberships.remove(index);
        effects.removed_memberships.push(id.clone());
    } else {
        effects.noops.push(Noop {
            target: Target::Membership(id.clone()),
            reason: NoopReason::AlreadyAbsent,
        });
    }
}
fn is_incident(edge: &MembershipId, entity: &Entity) -> bool {
    match entity {
        Entity::Song(id) => &edge.song == id,
        Entity::Pack(id) => &edge.pack == id,
    }
}
fn trash_entities(
    state: &mut Snapshot,
    entities: Vec<Entity>,
    request: &Request,
    revision: u64,
    effects: &mut Effects,
) -> Result<()> {
    let mut captured = Vec::new();
    for entity in &entities {
        let (before_revision, owner) = entity_state(state, entity)?;
        if owner.is_some() {
            return Err(Error::InTrash);
        }
        let before = match entity {
            Entity::Song(id) => EntitySnapshot::Song(song(state, id)?.clone()),
            Entity::Pack(id) => EntitySnapshot::Pack(pack(state, id)?.clone()),
        };
        captured.push(CapturedEntity {
            entity: entity.clone(),
            before_revision,
            before,
            restored_by: None,
        });
    }
    let edges: Vec<_> = state
        .inventory
        .memberships
        .iter()
        .filter(|edge| entities.iter().any(|entity| is_incident(&edge.id, entity)))
        .cloned()
        .collect();
    bounded(edges.len(), MAX_SELECTION, "affected memberships")?;
    for edge in &edges {
        remove_edge(state, &edge.id, effects);
    }
    for entity in &entities {
        set_trash(state, entity, Some(request.operation_id.clone()), revision);
        match entity {
            Entity::Song(id) => effects.trashed_songs.push(id.clone()),
            Entity::Pack(id) => effects.trashed_packs.push(id.clone()),
        }
    }
    state.trash.push(TrashRecord {
        operation_id: request.operation_id.clone(),
        at_unix_ms: request.at_unix_ms,
        entities: captured,
        memberships: edges
            .into_iter()
            .map(|membership| CapturedMembership {
                membership,
                restored_by: None,
            })
            .collect(),
    });
    Ok(())
}
fn restore(
    state: &mut Snapshot,
    origin: &OperationId,
    entities: &[Entity],
    edges: &[MembershipId],
    request: &Request,
    revision: u64,
    effects: &mut Effects,
) -> Result<()> {
    let index = state
        .trash
        .iter()
        .position(|record| &record.operation_id == origin)
        .ok_or(Error::NotFound)?;
    let mut record = state.trash[index].clone();
    for entity in entities {
        let captured = record
            .entities
            .iter_mut()
            .find(|captured| &captured.entity == entity)
            .ok_or(Error::NotFound)?;
        let (_, owner) = entity_state(state, entity)?;
        if captured.restored_by.is_some() {
            // An older record must never heal a later, independent Trash action.
            if owner.is_some() {
                return Err(Error::Conflict);
            }
            effects.noops.push(Noop {
                target: Target::Entity(entity.clone()),
                reason: NoopReason::AlreadyRestored,
            });
        } else {
            if owner != Some(origin) {
                return Err(Error::Conflict);
            }
            set_trash(state, entity, None, revision);
            captured.restored_by = Some(request.operation_id.clone());
            match entity {
                Entity::Song(id) => effects.restored_songs.push(id.clone()),
                Entity::Pack(id) => effects.restored_packs.push(id.clone()),
            }
        }
    }
    for id in edges {
        if !record
            .memberships
            .iter()
            .any(|captured| &captured.membership.id == id)
        {
            return Err(Error::NotFound);
        }
    }
    let mut considered = 0;
    for captured in &mut record.memberships {
        let id = &captured.membership.id;
        let reactivated =
            effects.restored_songs.contains(&id.song) || effects.restored_packs.contains(&id.pack);
        if !edges.contains(id) && !reactivated {
            continue;
        }
        considered += 1;
        bounded(considered, MAX_SELECTION, "affected memberships")?;
        if captured.restored_by.is_some() {
            effects.noops.push(Noop {
                target: Target::Membership(id.clone()),
                reason: NoopReason::AlreadyRestored,
            });
            continue;
        }
        let mut dependencies = Vec::new();
        if song(state, &id.song)?.trashed_by.is_some() {
            dependencies.push(Entity::Song(id.song.clone()));
        }
        if pack(state, &id.pack)?.trashed_by.is_some() {
            dependencies.push(Entity::Pack(id.pack.clone()));
        }
        if !dependencies.is_empty() {
            dependencies.sort();
            effects.blocked_memberships.push(BlockedMembership {
                membership: id.clone(),
                dependencies,
            });
            continue;
        }
        if membership(state, id).is_some() {
            effects.noops.push(Noop {
                target: Target::Membership(id.clone()),
                reason: NoopReason::AlreadyPresent,
            });
        } else {
            // Preserve captured order for a missing edge; an existing edge is
            // never overwritten, including its newer position and added time.
            let mut edge = captured.membership.clone();
            edge.revision = revision;
            state.inventory.memberships.push(edge);
            effects.added_memberships.push(id.clone());
        }
        captured.restored_by = Some(request.operation_id.clone());
    }
    state.trash[index] = record;
    Ok(())
}
fn transition(before: &Snapshot, request: &Request, revision: u64) -> Result<(Snapshot, Effects)> {
    let mut state = before.clone();
    let mut effects = Effects::default();
    match &request.action {
        Action::CreatePack { pack_id, name } => {
            if state.inventory.packs.iter().any(|pack| &pack.id == pack_id) {
                return Err(Error::Conflict);
            }
            state.inventory.packs.push(Pack {
                id: pack_id.clone(),
                name: name.clone(),
                kind: PackKind::Custom,
                source_archive_keys: vec![],
                origin_import_operation_id: None,
                revision,
                trashed_by: None,
            });
            effects.created_packs.push(pack_id.clone());
        }
        Action::RenamePack { pack_id, name } => {
            active_pack(&state, pack_id)?;
            let target = state
                .inventory
                .packs
                .iter_mut()
                .find(|pack| &pack.id == pack_id)
                .expect("validated pack");
            if &target.name == name {
                effects.noops.push(Noop {
                    target: Target::Entity(Entity::Pack(pack_id.clone())),
                    reason: NoopReason::UnchangedName,
                });
            } else {
                target.name = name.clone();
                target.revision = revision;
                effects.renamed_packs.push(pack_id.clone());
            }
        }
        Action::AddMemberships { pack_id, song_ids }
        | Action::RemoveMemberships { pack_id, song_ids } => {
            active_pack(&state, pack_id)?;
            for id in song_ids {
                active_song(&state, id)?;
            }
            for song in song_ids {
                let id = MembershipId {
                    pack: pack_id.clone(),
                    song: song.clone(),
                };
                if matches!(&request.action, Action::AddMemberships { .. }) {
                    add_edge(&mut state, id, request, revision, &mut effects)?;
                } else {
                    remove_edge(&mut state, &id, &mut effects);
                }
            }
        }
        Action::MoveMemberships {
            from_pack,
            to_pack,
            song_ids,
        } => {
            active_pack(&state, from_pack)?;
            active_pack(&state, to_pack)?;
            for id in song_ids {
                active_song(&state, id)?;
                if membership(
                    &state,
                    &MembershipId {
                        pack: from_pack.clone(),
                        song: id.clone(),
                    },
                )
                .is_none()
                {
                    return Err(Error::NotFound);
                }
            }
            for song in song_ids {
                let source = MembershipId {
                    pack: from_pack.clone(),
                    song: song.clone(),
                };
                if from_pack == to_pack {
                    effects.noops.push(Noop {
                        target: Target::Membership(source),
                        reason: NoopReason::SamePack,
                    });
                } else {
                    add_edge(
                        &mut state,
                        MembershipId {
                            pack: to_pack.clone(),
                            song: song.clone(),
                        },
                        request,
                        revision,
                        &mut effects,
                    )?;
                    remove_edge(&mut state, &source, &mut effects);
                }
            }
        }
        Action::TrashSongs { song_ids } => trash_entities(
            &mut state,
            song_ids.iter().cloned().map(Entity::Song).collect(),
            request,
            revision,
            &mut effects,
        )?,
        Action::TrashPack {
            pack_id,
            exclusive_song_ids,
        } => {
            active_pack(&state, pack_id)?;
            for id in exclusive_song_ids {
                active_song(&state, id)?;
                if membership(
                    &state,
                    &MembershipId {
                        pack: pack_id.clone(),
                        song: id.clone(),
                    },
                )
                .is_none()
                    || state
                        .inventory
                        .memberships
                        .iter()
                        .any(|edge| &edge.id.song == id && &edge.id.pack != pack_id)
                {
                    return Err(Error::Conflict);
                }
            }
            let entities = std::iter::once(Entity::Pack(pack_id.clone()))
                .chain(exclusive_song_ids.iter().cloned().map(Entity::Song))
                .collect();
            trash_entities(&mut state, entities, request, revision, &mut effects)?;
        }
        Action::Restore {
            trash_operation_id,
            entities,
            memberships,
        } => restore(
            &mut state,
            trash_operation_id,
            entities,
            memberships,
            request,
            revision,
            &mut effects,
        )?,
    }
    state.generation = revision;
    finish_effects(before, &state, &mut effects)?;
    for pack in &mut state.inventory.packs {
        if effects.affected_packs.contains(&pack.id) {
            pack.revision = revision;
        }
    }
    Ok((state, effects))
}
fn finish_effects(before: &Snapshot, after: &Snapshot, effects: &mut Effects) -> Result<()> {
    bounded(
        effects.added_memberships.len() + effects.removed_memberships.len(),
        MAX_SELECTION,
        "affected memberships",
    )?;
    let mut affected: BTreeSet<_> = effects
        .created_packs
        .iter()
        .chain(&effects.renamed_packs)
        .chain(&effects.trashed_packs)
        .chain(&effects.restored_packs)
        .cloned()
        .collect();
    affected.extend(
        effects
            .added_memberships
            .iter()
            .chain(&effects.removed_memberships)
            .map(|edge| edge.pack.clone()),
    );
    effects.affected_packs = affected.into_iter().collect();
    effects.newly_unfiled_songs = after
        .inventory
        .songs
        .iter()
        .filter(|song| {
            song.trashed_by.is_none()
                && !after
                    .inventory
                    .memberships
                    .iter()
                    .any(|edge| edge.id.song == song.id)
                && (before
                    .inventory
                    .memberships
                    .iter()
                    .any(|edge| edge.id.song == song.id)
                    || effects.restored_songs.contains(&song.id))
        })
        .map(|song| song.id.clone())
        .collect();
    effects.retained_payload_bytes = after.inventory.songs.iter().try_fold(0u64, |sum, song| {
        sum.checked_add(song.retained_bytes)
            .ok_or(Error::Limit("retained bytes"))
    })?;
    effects.retained_source_bytes =
        after
            .inventory
            .sources
            .iter()
            .try_fold(0u64, |sum, source| {
                sum.checked_add(source.retained_bytes)
                    .ok_or(Error::Limit("retained bytes"))
            })?;
    effects.created_packs.sort();
    effects.renamed_packs.sort();
    effects.added_memberships.sort();
    effects.removed_memberships.sort();
    effects.trashed_songs.sort();
    effects.trashed_packs.sort();
    effects.restored_songs.sort();
    effects.restored_packs.sort();
    effects.noops.sort();
    effects.blocked_memberships.sort();
    effects.newly_unfiled_songs.sort();
    Ok(())
}

fn validate_state(state: &Snapshot) -> Result<()> {
    if state.schema_version != VERSION {
        return Err(Error::UnsupportedVersion);
    }
    let inventory = &state.inventory;
    bounded(inventory.songs.len(), MAX_SONGS, "songs")?;
    bounded(inventory.packs.len(), MAX_PACKS, "packs")?;
    bounded(inventory.memberships.len(), MAX_MEMBERSHIPS, "memberships")?;
    bounded(inventory.sources.len(), MAX_SOURCES, "sources")?;
    bounded(inventory.origins.len(), MAX_ORIGINS, "origins")?;
    bounded(state.trash.len(), MAX_HISTORY, "trash history")?;
    bounded(state.receipts.len(), MAX_HISTORY, "receipt history")?;
    bounded(
        state
            .trash
            .iter()
            .map(|record| record.memberships.len())
            .sum(),
        MAX_CAPTURED_EDGES,
        "captured memberships",
    )?;
    if state.generation != state.receipts.len() as u64 {
        return Err(Error::Invalid("generation history"));
    }
    unique(inventory.songs.iter().map(|song| &song.id))?;
    unique(inventory.packs.iter().map(|pack| &pack.id))?;
    unique(inventory.memberships.iter().map(|edge| &edge.id))?;
    unique(inventory.sources.iter().map(|source| &source.id))?;
    unique(&inventory.origins)?;
    unique(state.trash.iter().map(|record| &record.operation_id))?;
    unique(
        state
            .receipts
            .iter()
            .map(|receipt| &receipt.preview.request.operation_id),
    )?;
    let check_revision = |revision| {
        if revision <= state.generation {
            Ok(())
        } else {
            Err(Error::Invalid("future revision"))
        }
    };
    let check_pack = |item: &Pack| -> Result<()> {
        text_value(&item.name, 256)?;
        bounded(item.source_archive_keys.len(), MAX_SOURCES, "pack sources")?;
        unique(&item.source_archive_keys)?;
        if item.kind == PackKind::Imported && item.source_archive_keys.is_empty() {
            return Err(Error::Invalid("imported pack without source"));
        }
        for id in &item.source_archive_keys {
            if !inventory.sources.iter().any(|source| &source.id == id) {
                return Err(Error::Invalid("missing pack source"));
            }
        }
        check_revision(item.revision)
    };
    for song in &inventory.songs {
        check_revision(song.revision)?;
    }
    for pack in &inventory.packs {
        check_pack(pack)?;
    }
    for source in &inventory.sources {
        if let Some(id) = &source.default_imported_pack {
            let target = pack(state, id)?;
            if target.kind != PackKind::Imported || !target.source_archive_keys.contains(&source.id)
            {
                return Err(Error::Invalid("source origin map"));
            }
        }
    }
    for edge in &inventory.memberships {
        active_song(state, &edge.id.song)?;
        active_pack(state, &edge.id.pack)?;
        check_revision(edge.revision)?;
    }
    for origin in &inventory.origins {
        song(state, &origin.song)?;
        if !inventory
            .sources
            .iter()
            .any(|source| source.id == origin.source)
        {
            return Err(Error::Invalid("missing origin source"));
        }
        relative_label(&origin.receipt_filename, 256)?;
        if origin.receipt_filename.contains('/') {
            return Err(Error::Invalid("receipt filename"));
        }
        relative_label(&origin.item_path, 1024)?;
    }
    let payload_bytes = inventory.songs.iter().try_fold(0u64, |sum, song| {
        sum.checked_add(song.retained_bytes)
            .ok_or(Error::Limit("retained bytes"))
    })?;
    let source_bytes = inventory.sources.iter().try_fold(0u64, |sum, source| {
        sum.checked_add(source.retained_bytes)
            .ok_or(Error::Limit("retained bytes"))
    })?;
    for (index, receipt) in state.receipts.iter().enumerate() {
        let preview = &receipt.preview;
        preview.request.validate()?;
        if preview.request.expected_generation != index as u64
            || preview.next_generation != index as u64 + 1
            || preview.request_digest != digest(&preview.request)
            || preview.plan_digest != plan_digest(preview)
            || !hexadecimal_id(&preview.base_digest, "", 64)
            || preview.effects.reclaimed_bytes != 0
            || preview.effects.retained_payload_bytes != payload_bytes
            || preview.effects.retained_source_bytes != source_bytes
        {
            return Err(Error::Invalid("receipt integrity"));
        }
        match &preview.request.action {
            Action::TrashSongs { .. } | Action::TrashPack { .. } => {
                if !state
                    .trash
                    .iter()
                    .any(|record| record.operation_id == preview.request.operation_id)
                {
                    return Err(Error::Invalid("missing trash history"));
                }
            }
            Action::Restore {
                trash_operation_id, ..
            } if !state
                .trash
                .iter()
                .any(|record| &record.operation_id == trash_operation_id) =>
            {
                return Err(Error::Invalid("missing restore history"));
            }
            _ => {}
        }
        bounded(
            preview.effects.noops.len(),
            MAX_SELECTION * 2,
            "receipt noops",
        )?;
        bounded(
            preview.effects.blocked_memberships.len(),
            MAX_SELECTION,
            "receipt blocked memberships",
        )?;
        // Every referenced effect remains addressable, even after later Trash.
        for id in preview
            .effects
            .created_packs
            .iter()
            .chain(&preview.effects.renamed_packs)
            .chain(&preview.effects.trashed_packs)
            .chain(&preview.effects.restored_packs)
            .chain(&preview.effects.affected_packs)
        {
            pack(state, id)?;
        }
        for id in preview
            .effects
            .trashed_songs
            .iter()
            .chain(&preview.effects.restored_songs)
            .chain(&preview.effects.newly_unfiled_songs)
        {
            song(state, id)?;
        }
        for id in preview
            .effects
            .added_memberships
            .iter()
            .chain(&preview.effects.removed_memberships)
        {
            song(state, &id.song)?;
            pack(state, &id.pack)?;
        }
        bounded(
            preview.effects.added_memberships.len() + preview.effects.removed_memberships.len(),
            MAX_SELECTION,
            "receipt memberships",
        )?;
    }
    // Resolution ownership is derived from receipts in both directions. An
    // erased marker must not make a previously resolved edge restorable again.
    let mut restored_entities = BTreeMap::new();
    let mut restored_edges = BTreeMap::new();
    for receipt in &state.receipts {
        let preview = &receipt.preview;
        if let Action::Restore {
            trash_operation_id, ..
        } = &preview.request.action
        {
            let entities = preview
                .effects
                .restored_songs
                .iter()
                .cloned()
                .map(Entity::Song)
                .chain(
                    preview
                        .effects
                        .restored_packs
                        .iter()
                        .cloned()
                        .map(Entity::Pack),
                );
            for entity in entities {
                if restored_entities
                    .insert(
                        (trash_operation_id.clone(), entity),
                        preview.request.operation_id.clone(),
                    )
                    .is_some()
                {
                    return Err(Error::Invalid("repeated entity resolution"));
                }
            }
            let present = preview.effects.noops.iter().filter_map(|noop| {
                match (&noop.target, &noop.reason) {
                    (Target::Membership(id), NoopReason::AlreadyPresent) => Some(id),
                    _ => None,
                }
            });
            for id in preview.effects.added_memberships.iter().chain(present) {
                if restored_edges
                    .insert(
                        (trash_operation_id.clone(), id.clone()),
                        preview.request.operation_id.clone(),
                    )
                    .is_some()
                {
                    return Err(Error::Invalid("repeated edge resolution"));
                }
            }
        }
    }
    for record in &state.trash {
        let original = state
            .receipts
            .iter()
            .find(|receipt| receipt.preview.request.operation_id == record.operation_id)
            .ok_or(Error::Invalid("missing trash receipt"))?;
        let request = &original.preview.request;
        let expected: BTreeSet<_> = match &request.action {
            Action::TrashSongs { song_ids } => song_ids.iter().cloned().map(Entity::Song).collect(),
            Action::TrashPack {
                pack_id,
                exclusive_song_ids,
            } => std::iter::once(Entity::Pack(pack_id.clone()))
                .chain(exclusive_song_ids.iter().cloned().map(Entity::Song))
                .collect(),
            _ => return Err(Error::Invalid("trash receipt action")),
        };
        bounded(
            record.entities.len(),
            MAX_SELECTION + 1,
            "captured entities",
        )?;
        unique(record.entities.iter().map(|captured| &captured.entity))?;
        unique(
            record
                .memberships
                .iter()
                .map(|captured| &captured.membership.id),
        )?;
        bounded(
            record.memberships.len(),
            MAX_SELECTION,
            "captured memberships",
        )?;
        if record.at_unix_ms != request.at_unix_ms
            || record
                .entities
                .iter()
                .map(|captured| captured.entity.clone())
                .collect::<BTreeSet<_>>()
                != expected
        {
            return Err(Error::Invalid("trash entities"));
        }
        let removed: BTreeSet<_> = original
            .preview
            .effects
            .removed_memberships
            .iter()
            .collect();
        if record
            .memberships
            .iter()
            .map(|captured| &captured.membership.id)
            .collect::<BTreeSet<_>>()
            != removed
        {
            return Err(Error::Invalid("trash memberships"));
        }
        for captured in &record.entities {
            if captured.restored_by
                != restored_entities.remove(&(record.operation_id.clone(), captured.entity.clone()))
            {
                return Err(Error::Invalid("entity resolution history"));
            }
            let (current_revision, owner) = entity_state(state, &captured.entity)?;
            if captured.before_revision > request.expected_generation
                || current_revision < original.preview.next_generation
            {
                return Err(Error::Invalid("trash revision"));
            }
            match (&captured.entity, &captured.before) {
                (Entity::Song(id), EntitySnapshot::Song(before)) if id == &before.id => {
                    if before.revision != captured.before_revision
                        || before.trashed_by.is_some()
                        || before.retained_bytes != song(state, id)?.retained_bytes
                    {
                        return Err(Error::Invalid("captured song"));
                    }
                }
                (Entity::Pack(id), EntitySnapshot::Pack(before)) if id == &before.id => {
                    check_pack(before)?;
                    let current = pack(state, id)?;
                    let same_sources = before.source_archive_keys.iter().collect::<BTreeSet<_>>()
                        == current.source_archive_keys.iter().collect::<BTreeSet<_>>();
                    if before.revision != captured.before_revision
                        || before.trashed_by.is_some()
                        || before.kind != current.kind
                        || !same_sources
                        || before.origin_import_operation_id != current.origin_import_operation_id
                    {
                        return Err(Error::Invalid("captured pack"));
                    }
                }
                _ => return Err(Error::Invalid("captured entity identity")),
            }
            if let Some(restored_by) = &captured.restored_by {
                let restored_revision = validate_restore_receipt(
                    state,
                    record,
                    restored_by,
                    Some(&captured.entity),
                    None,
                )?;
                if current_revision < restored_revision {
                    return Err(Error::Invalid("restore revision"));
                }
            } else if owner != Some(&record.operation_id) {
                return Err(Error::Invalid("missing tombstone"));
            }
        }
        for captured in &record.memberships {
            let edge = &captured.membership;
            if captured.restored_by
                != restored_edges.remove(&(record.operation_id.clone(), edge.id.clone()))
            {
                return Err(Error::Invalid("edge resolution history"));
            }
            song(state, &edge.id.song)?;
            pack(state, &edge.id.pack)?;
            if edge.revision > request.expected_generation
                || !record
                    .entities
                    .iter()
                    .any(|entity| is_incident(&edge.id, &entity.entity))
            {
                return Err(Error::Invalid("captured edge"));
            }
            if let Some(restored_by) = &captured.restored_by {
                validate_restore_receipt(state, record, restored_by, None, Some(&edge.id))?;
            }
        }
    }
    if !restored_entities.is_empty() || !restored_edges.is_empty() {
        return Err(Error::Invalid("uncaptured restore effect"));
    }
    for entity in inventory
        .songs
        .iter()
        .map(|song| Entity::Song(song.id.clone()))
        .chain(
            inventory
                .packs
                .iter()
                .map(|pack| Entity::Pack(pack.id.clone())),
        )
    {
        if let (_, Some(owner)) = entity_state(state, &entity)? {
            if !state.trash.iter().any(|record| {
                &record.operation_id == owner
                    && record
                        .entities
                        .iter()
                        .any(|captured| captured.entity == entity && captured.restored_by.is_none())
            }) {
                return Err(Error::Invalid("orphan tombstone"));
            }
        }
    }
    bounded(
        serde_json::to_vec(state)
            .map_err(|_| Error::Invalid("snapshot JSON"))?
            .len(),
        MAX_STATE_BYTES,
        "state bytes",
    )
}
fn validate_restore_receipt(
    state: &Snapshot,
    record: &TrashRecord,
    restored_by: &OperationId,
    entity: Option<&Entity>,
    edge: Option<&MembershipId>,
) -> Result<u64> {
    let receipt = state
        .receipts
        .iter()
        .find(|receipt| &receipt.preview.request.operation_id == restored_by)
        .ok_or(Error::Invalid("missing restore receipt"))?;
    let original = state
        .receipts
        .iter()
        .find(|receipt| receipt.preview.request.operation_id == record.operation_id)
        .ok_or(Error::Invalid("missing trash receipt"))?;
    if receipt.preview.request.expected_generation < original.preview.next_generation {
        return Err(Error::Invalid("restore before trash"));
    }
    let effects = &receipt.preview.effects;
    let entity_changed = entity.is_none_or(|target| match target {
        Entity::Song(id) => effects.restored_songs.contains(id),
        Entity::Pack(id) => effects.restored_packs.contains(id),
    });
    let edge_resolved = edge.is_none_or(|target| {
        effects.added_memberships.contains(target)
            || effects.noops.iter().any(|noop| {
                noop.target == Target::Membership(target.clone())
                    && noop.reason == NoopReason::AlreadyPresent
            })
    });
    if let Action::Restore {
        trash_operation_id,
        entities,
        memberships,
    } = &receipt.preview.request.action
    {
        if trash_operation_id == &record.operation_id
            && entity_changed
            && edge_resolved
            && entity.is_none_or(|target| entities.contains(target))
            && edge.is_none_or(|target| {
                memberships.contains(target)
                    || entities.iter().any(|entity| is_incident(target, entity))
            })
        {
            return Ok(receipt.preview.next_generation);
        }
    }
    Err(Error::Invalid("restore receipt action"))
}
