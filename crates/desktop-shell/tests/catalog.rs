//! Authored metadata only. These tests never open a library or touch song files.
use worldmusichub_desktop::catalog::*;

fn song_id(n: u32) -> SongId {
    SongId::parse(format!("legacy:song-{n:064x}")).unwrap()
}
fn clean_id(n: u32) -> SongId {
    SongId::parse(format!("clean:song-{n:064x}")).unwrap()
}
fn pack_id(n: u32) -> PackId {
    PackId::parse(format!("collection-{n:032x}")).unwrap()
}
fn operation_id(n: u32) -> OperationId {
    OperationId::parse(format!("operation-{n:032x}")).unwrap()
}
fn source_id(n: u32) -> SourceId {
    SourceId::parse(format!("pack-{n:064x}")).unwrap()
}
fn edge(pack: u32, song: u32) -> MembershipId {
    MembershipId {
        pack: pack_id(pack),
        song: song_id(song),
    }
}
fn custom_pack(n: u32) -> Pack {
    Pack {
        id: pack_id(n),
        name: format!("Authored pack {n}"),
        kind: PackKind::Custom,
        source_archive_keys: vec![],
        origin_import_operation_id: None,
        revision: 0,
        trashed_by: None,
    }
}
fn seed() -> Seed {
    let mut imported = custom_pack(1);
    imported.kind = PackKind::Imported;
    imported.source_archive_keys = vec![source_id(1)];
    Seed {
        songs: vec![song_id(1), song_id(2), clean_id(1)]
            .into_iter()
            .map(|id| Song {
                id,
                retained_bytes: 101,
                revision: 0,
                trashed_by: None,
            })
            .collect(),
        packs: vec![imported, custom_pack(2), custom_pack(3)],
        memberships: vec![edge(1, 1), edge(2, 1), edge(1, 2)]
            .into_iter()
            .enumerate()
            .map(|(position, id)| Membership {
                id,
                position: position as u32,
                added_at_unix_ms: 100,
                revision: 0,
            })
            .collect(),
        sources: vec![
            Source {
                id: source_id(1),
                retained_bytes: 97,
                default_imported_pack: Some(pack_id(1)),
            },
            Source {
                id: source_id(2),
                retained_bytes: 59,
                default_imported_pack: None,
            },
        ],
        origins: vec![Origin {
            song: song_id(1),
            source: source_id(1),
            receipt_filename: "receipt-authored.json".into(),
            item_index: 0,
            item_path: "scores/original.exercise.json".into(),
            item_kind: OriginItemKind::RelativePath,
            evidence_type: EvidenceType::ReceiptDerived,
        }],
    }
}
fn catalog() -> Catalog {
    Catalog::from_seed(seed()).unwrap()
}
fn request(catalog: &Catalog, op: u32, action: Action) -> Request {
    Request {
        schema_version: VERSION,
        operation_id: operation_id(op),
        expected_generation: catalog.snapshot().generation,
        at_unix_ms: 200 + op as u64,
        action,
    }
}
fn execute(catalog: &Catalog, op: u32, action: Action) -> Applied {
    let preview = catalog.preview(request(catalog, op, action)).unwrap();
    catalog.apply(&preview).unwrap()
}
fn has_edge(catalog: &Catalog, id: &MembershipId) -> bool {
    catalog
        .snapshot()
        .inventory
        .memberships
        .iter()
        .any(|edge| &edge.id == id)
}
fn is_trashed(catalog: &Catalog, id: &SongId) -> bool {
    catalog
        .snapshot()
        .inventory
        .songs
        .iter()
        .find(|song| &song.id == id)
        .unwrap()
        .trashed_by
        .is_some()
}
fn restore_action(op: u32, entities: Vec<Entity>, memberships: Vec<MembershipId>) -> Action {
    Action::Restore {
        trash_operation_id: operation_id(op),
        entities,
        memberships,
    }
}

fn new_inventory_song(n: u32) -> Seed {
    Seed {
        songs: vec![Song {
            id: song_id(n),
            retained_bytes: 71,
            revision: 0,
            trashed_by: None,
        }],
        packs: vec![],
        memberships: vec![Membership {
            id: edge(1, n),
            position: 7,
            added_at_unix_ms: 123,
            revision: 0,
        }],
        sources: vec![],
        origins: vec![Origin {
            song: song_id(n),
            source: source_id(1),
            receipt_filename: "receipt-adopted.json".into(),
            item_index: n,
            item_path: format!("scores/authored-{n}.json"),
            item_kind: OriginItemKind::RelativePath,
            evidence_type: EvidenceType::VerifiedImport,
        }],
    }
}

#[test]
fn adoption_adds_new_song_to_existing_pack_without_rewriting_history() {
    let removed = execute(
        &catalog(),
        1,
        Action::RemoveMemberships {
            pack_id: pack_id(1),
            song_ids: vec![song_id(1)],
        },
    )
    .catalog;
    let start = execute(
        &removed,
        2,
        Action::TrashSongs {
            song_ids: vec![song_id(2)],
        },
    )
    .catalog;
    let old_receipts = serde_json::to_vec(&start.snapshot().receipts).unwrap();
    let delta = new_inventory_song(4);
    let adopted = execute(
        &start,
        3,
        Action::AdoptInventory {
            inventory: delta.clone(),
        },
    );
    let state = adopted.catalog.snapshot();
    assert_eq!(
        adopted.receipt.preview.effects.adopted_songs,
        vec![song_id(4)]
    );
    assert!(adopted.receipt.preview.effects.adopted_packs.is_empty());
    assert!(adopted.receipt.preview.effects.adopted_sources.is_empty());
    assert_eq!(
        adopted.receipt.preview.effects.added_memberships,
        vec![edge(1, 4)]
    );
    assert_eq!(
        adopted.receipt.preview.effects.affected_packs,
        vec![pack_id(1)]
    );
    assert_eq!(adopted.receipt.preview.effects.retained_payload_bytes, 374);
    assert_eq!(adopted.receipt.preview.effects.retained_source_bytes, 156);
    assert_eq!(adopted.receipt.preview.effects.reclaimed_bytes, 0);
    assert_eq!(state.inventory.packs, start.snapshot().inventory.packs);
    assert_eq!(state.inventory.sources, start.snapshot().inventory.sources);
    assert_eq!(state.trash, start.snapshot().trash);
    assert_eq!(
        serde_json::to_vec(&state.receipts[..2]).unwrap(),
        old_receipts
    );
    for original in &start.snapshot().inventory.songs {
        assert!(state.inventory.songs.contains(original));
    }
    for original in &start.snapshot().inventory.memberships {
        assert!(state.inventory.memberships.contains(original));
    }
    for original in &start.snapshot().inventory.origins {
        assert!(state.inventory.origins.contains(original));
    }
    assert!(state.inventory.origins.contains(&delta.origins[0]));
    assert!(!has_edge(&adopted.catalog, &edge(1, 1)));
    assert!(is_trashed(&adopted.catalog, &song_id(2)));
    let edge = state
        .inventory
        .memberships
        .iter()
        .find(|edge| edge.id == delta.memberships[0].id)
        .unwrap();
    assert_eq!(
        (edge.position, edge.added_at_unix_ms, edge.revision),
        (7, 123, 3)
    );
    assert_eq!(
        Catalog::from_json(&serde_json::to_vec(state).unwrap()).unwrap(),
        adopted.catalog
    );
}

#[test]
fn adoption_rejects_old_song_edges_origins_and_all_identity_collisions_atomically() {
    let start = execute(
        &catalog(),
        1,
        Action::RemoveMemberships {
            pack_id: pack_id(1),
            song_ids: vec![song_id(1)],
        },
    )
    .catalog;
    let frozen = start.clone();
    let mut old_edge = new_inventory_song(4);
    old_edge.memberships[0].id.song = song_id(1);
    let mut old_origin = new_inventory_song(4);
    old_origin.origins[0].song = song_id(1);
    for delta in [old_edge, old_origin] {
        assert_eq!(
            start.preview(request(
                &start,
                2,
                Action::AdoptInventory { inventory: delta }
            )),
            Err(Error::Invalid("inventory evidence without new song"))
        );
    }
    let mut song_collision = new_inventory_song(1);
    song_collision.songs[0].retained_bytes = 999;
    let mut pack_collision = new_inventory_song(4);
    pack_collision.packs.push(custom_pack(1));
    let mut source_collision = new_inventory_song(4);
    source_collision.sources.push(Source {
        id: source_id(1),
        retained_bytes: 999,
        default_imported_pack: None,
    });
    for delta in [song_collision, pack_collision, source_collision] {
        assert_eq!(
            start.preview(request(
                &start,
                2,
                Action::AdoptInventory { inventory: delta }
            )),
            Err(Error::Conflict)
        );
    }
    assert_eq!(start, frozen);
    assert!(!has_edge(&start, &edge(1, 1)));
}

#[test]
fn adoption_accepts_source_only_imported_pack_and_retains_earlier_byte_receipts() {
    let first = execute(
        &catalog(),
        1,
        Action::AdoptInventory {
            inventory: new_inventory_song(4),
        },
    );
    let mut pack = custom_pack(4);
    pack.kind = PackKind::Imported;
    pack.source_archive_keys = vec![source_id(3)];
    let source = Source {
        id: source_id(3),
        retained_bytes: 43,
        default_imported_pack: Some(pack_id(4)),
    };
    let delta = Seed {
        songs: vec![],
        packs: vec![pack],
        memberships: vec![],
        sources: vec![source.clone()],
        origins: vec![],
    };
    let adopted = execute(
        &first.catalog,
        2,
        Action::AdoptInventory { inventory: delta },
    );
    assert_eq!(
        adopted.receipt.preview.effects.adopted_packs,
        vec![pack_id(4)]
    );
    assert_eq!(
        adopted.receipt.preview.effects.adopted_sources,
        vec![source_id(3)]
    );
    assert_eq!(
        adopted.receipt.preview.effects.affected_packs,
        vec![pack_id(4)]
    );
    assert_eq!(adopted.receipt.preview.effects.retained_payload_bytes, 374);
    assert_eq!(adopted.receipt.preview.effects.retained_source_bytes, 199);
    assert_eq!(adopted.catalog.snapshot().receipts[0], first.receipt);
    assert!(adopted
        .catalog
        .snapshot()
        .inventory
        .sources
        .contains(&source));
    assert_eq!(
        Catalog::from_snapshot(adopted.catalog.snapshot().clone()).unwrap(),
        adopted.catalog
    );
    let trashed = execute(
        &adopted.catalog,
        3,
        Action::TrashPack {
            pack_id: pack_id(4),
            exclusive_song_ids: vec![],
        },
    );
    let restored = execute(
        &trashed.catalog,
        4,
        restore_action(3, vec![Entity::Pack(pack_id(4))], vec![]),
    );
    assert_eq!(restored.receipt.preview.effects.retained_source_bytes, 199);
}

#[test]
fn adopted_song_uses_normal_trash_restore_and_exact_idempotency() {
    let start = catalog();
    let body = request(
        &start,
        1,
        Action::AdoptInventory {
            inventory: new_inventory_song(4),
        },
    );
    assert_eq!(
        Request::from_json(&serde_json::to_vec(&body).unwrap()).unwrap(),
        body
    );
    let preview = start.preview(body.clone()).unwrap();
    let adopted = start.apply(&preview).unwrap();
    let trashed = execute(
        &adopted.catalog,
        2,
        Action::TrashSongs {
            song_ids: vec![song_id(4)],
        },
    );
    assert!(is_trashed(&trashed.catalog, &song_id(4)));
    assert!(!has_edge(&trashed.catalog, &edge(1, 4)));
    let restored = execute(
        &trashed.catalog,
        3,
        restore_action(2, vec![Entity::Song(song_id(4))], vec![]),
    );
    assert!(!is_trashed(&restored.catalog, &song_id(4)));
    assert!(has_edge(&restored.catalog, &edge(1, 4)));
    let reloaded =
        Catalog::from_json(&serde_json::to_vec(restored.catalog.snapshot()).unwrap()).unwrap();
    assert_eq!(reloaded.preview(body.clone()).unwrap(), preview);
    let replay = reloaded.apply(&preview).unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.catalog, reloaded);
    let mut changed = body;
    changed.at_unix_ms += 1;
    assert_eq!(reloaded.preview(changed), Err(Error::IdempotencyConflict));
    let competing = execute(
        &start,
        4,
        Action::RenamePack {
            pack_id: pack_id(1),
            name: "Renamed".into(),
        },
    );
    assert_eq!(competing.catalog.apply(&preview), Err(Error::Stale));
    let mut edited = preview.clone();
    edited.effects.adopted_songs.clear();
    assert_eq!(start.apply(&edited), Err(Error::InvalidPlan));
    assert_eq!(reloaded.apply(&edited), Err(Error::InvalidPlan));
}

#[test]
fn adoption_checks_new_history_complete_graph_and_trashed_destinations() {
    let start = catalog();
    let mut revision = new_inventory_song(4);
    revision.songs[0].revision = 1;
    let mut tombstone = new_inventory_song(4);
    tombstone.songs[0].trashed_by = Some(operation_id(9));
    for delta in [revision, tombstone] {
        assert_eq!(
            start.preview(request(
                &start,
                1,
                Action::AdoptInventory { inventory: delta }
            )),
            Err(Error::Invalid("inventory adoption history"))
        );
    }
    let mut missing_source = new_inventory_song(4);
    missing_source.origins[0].source = source_id(99);
    assert_eq!(
        start.preview(request(
            &start,
            1,
            Action::AdoptInventory {
                inventory: missing_source
            }
        )),
        Err(Error::Invalid("missing origin source"))
    );
    let mut missing_pack = new_inventory_song(4);
    missing_pack.memberships[0].id.pack = pack_id(99);
    assert_eq!(
        start.preview(request(
            &start,
            1,
            Action::AdoptInventory {
                inventory: missing_pack
            }
        )),
        Err(Error::NotFound)
    );
    let trashed = execute(
        &start,
        1,
        Action::TrashPack {
            pack_id: pack_id(1),
            exclusive_song_ids: vec![],
        },
    )
    .catalog;
    assert_eq!(
        trashed.preview(request(
            &trashed,
            2,
            Action::AdoptInventory {
                inventory: new_inventory_song(4)
            }
        )),
        Err(Error::InTrash)
    );
    let mut collision = new_inventory_song(4);
    collision.packs.push(
        start
            .snapshot()
            .inventory
            .packs
            .iter()
            .find(|pack| pack.id == pack_id(1))
            .unwrap()
            .clone(),
    );
    assert_eq!(
        trashed.preview(request(
            &trashed,
            2,
            Action::AdoptInventory {
                inventory: collision
            }
        )),
        Err(Error::Conflict)
    );
}

#[test]
fn adoption_cannot_exceed_candidate_capacity_or_retained_byte_bounds() {
    let mut full = seed();
    full.songs.extend((4..=MAX_SONGS as u32).map(|n| Song {
        id: song_id(n),
        retained_bytes: 0,
        revision: 0,
        trashed_by: None,
    }));
    let start = Catalog::from_seed(full).unwrap();
    assert_eq!(
        start.preview(request(
            &start,
            1,
            Action::AdoptInventory {
                inventory: new_inventory_song(MAX_SONGS as u32 + 1)
            }
        )),
        Err(Error::Limit("songs"))
    );
    let start = catalog();
    let mut overflow = new_inventory_song(4);
    overflow.songs[0].retained_bytes = u64::MAX;
    assert_eq!(
        start.preview(request(
            &start,
            1,
            Action::AdoptInventory {
                inventory: overflow
            }
        )),
        Err(Error::Limit("retained bytes"))
    );
    let mut duplicate = new_inventory_song(4);
    duplicate.songs.push(duplicate.songs[0].clone());
    assert_eq!(
        start.preview(request(
            &start,
            1,
            Action::AdoptInventory {
                inventory: duplicate
            }
        )),
        Err(Error::Invalid("duplicate identity"))
    );
    assert_eq!(start.snapshot().generation, 0);
}

#[test]
fn old_effects_json_round_trips_without_new_empty_fields() {
    let legacy = concat!(
        "{\"created_packs\":[],\"renamed_packs\":[],\"added_memberships\":[],\"removed_memberships\":[],",
        "\"trashed_songs\":[],\"trashed_packs\":[],\"restored_songs\":[],\"restored_packs\":[],",
        "\"noops\":[],\"blocked_memberships\":[],\"affected_packs\":[],\"newly_unfiled_songs\":[],",
        "\"retained_payload_bytes\":0,\"retained_source_bytes\":0,\"reclaimed_bytes\":0}"
    );
    let effects: Effects = serde_json::from_str(legacy).unwrap();
    assert_eq!(effects, Effects::default());
    assert_eq!(serde_json::to_string(&effects).unwrap(), legacy);
    let adopted = execute(
        &catalog(),
        1,
        Action::AdoptInventory {
            inventory: new_inventory_song(4),
        },
    );
    let mut corrupt = adopted.catalog.snapshot().clone();
    corrupt
        .inventory
        .songs
        .iter_mut()
        .find(|song| song.id == song_id(4))
        .unwrap()
        .retained_bytes += 1;
    assert!(Catalog::from_snapshot(corrupt).is_err());
    let mut corrupt = adopted.catalog.snapshot().clone();
    corrupt
        .inventory
        .origins
        .retain(|origin| origin.song != song_id(4));
    assert_eq!(
        Catalog::from_snapshot(corrupt),
        Err(Error::Invalid("adopted origin history"))
    );
}

#[test]
fn historical_origins_default_to_relative_paths_without_changing_json_bytes() {
    let legacy = format!(
        r#"{{"song":"{}","source":"{}","receipt_filename":"receipt-authored.json","item_index":0,"item_path":"scores/original.exercise.json","evidence_type":"receipt_derived"}}"#,
        song_id(1).as_str(),
        source_id(1).as_str()
    );
    let origin: Origin = serde_json::from_str(&legacy).unwrap();
    assert_eq!(origin.item_kind, OriginItemKind::RelativePath);
    assert_eq!(origin, seed().origins[0]);
    assert_eq!(serde_json::to_string(&origin).unwrap(), legacy);
    let old_history = execute(
        &catalog(),
        1,
        Action::TrashSongs {
            song_ids: vec![song_id(1)],
        },
    )
    .catalog;
    let bytes = serde_json::to_vec(old_history.snapshot()).unwrap();
    assert!(!String::from_utf8(bytes.clone())
        .unwrap()
        .contains("\"item_kind\""));
    let reloaded = Catalog::from_json(&bytes).unwrap();
    assert_eq!(serde_json::to_vec(reloaded.snapshot()).unwrap(), bytes);
}

#[test]
fn inert_origin_labels_preserve_upload_spelling_through_adoption_and_trash() {
    for label in [
        r"C:\uploads\take:one.json",
        r"album:one\score.mxl#entries/0",
        "../upload label",
        "/upload label",
        " ",
    ] {
        let mut delta = new_inventory_song(4);
        delta.origins[0].item_path = label.into();
        delta.origins[0].item_kind = OriginItemKind::InertLabel;
        let adopted = execute(
            &catalog(),
            1,
            Action::AdoptInventory {
                inventory: delta.clone(),
            },
        );
        assert!(adopted
            .catalog
            .snapshot()
            .inventory
            .origins
            .contains(&delta.origins[0]));
        let encoded = serde_json::to_value(&delta.origins[0]).unwrap();
        assert_eq!(encoded["item_kind"], "inert_label");
        assert_eq!(encoded["item_path"], label);
        let trashed = execute(
            &adopted.catalog,
            2,
            Action::TrashSongs {
                song_ids: vec![song_id(4)],
            },
        );
        let restored = execute(
            &trashed.catalog,
            3,
            restore_action(2, vec![Entity::Song(song_id(4))], vec![]),
        );
        let reloaded =
            Catalog::from_json(&serde_json::to_vec(restored.catalog.snapshot()).unwrap()).unwrap();
        assert!(reloaded
            .snapshot()
            .inventory
            .origins
            .contains(&delta.origins[0]));
    }
}

#[test]
fn origin_item_kinds_use_bounded_utf8_bytes_and_keep_relative_path_rules() {
    for kind in [OriginItemKind::RelativePath, OriginItemKind::InertLabel] {
        for label in [
            "x".repeat(MAX_ORIGIN_ITEM_BYTES),
            "é".repeat(MAX_ORIGIN_ITEM_BYTES / 2),
            format!("{}#entries/1023", "x".repeat(1024)),
        ] {
            let mut authored = seed();
            authored.origins[0].item_kind = kind.clone();
            authored.origins[0].item_path = label;
            assert!(Catalog::from_seed(authored).is_ok());
        }
        for label in [
            "x".repeat(MAX_ORIGIN_ITEM_BYTES + 1),
            "é".repeat(MAX_ORIGIN_ITEM_BYTES / 2 + 1),
        ] {
            let mut delta = new_inventory_song(4);
            delta.origins[0].item_kind = kind.clone();
            delta.origins[0].item_path = label.clone();
            let start = catalog();
            assert!(start
                .preview(request(
                    &start,
                    1,
                    Action::AdoptInventory { inventory: delta }
                ))
                .is_err());
            let mut authored = seed();
            authored.origins[0].item_kind = kind.clone();
            authored.origins[0].item_path = label;
            assert!(Catalog::from_seed(authored).is_err());
        }
    }
    for label in ["", "bad\nlabel", "bad\rlabel", "bad\tlabel", "bad\0label"] {
        let mut delta = new_inventory_song(4);
        delta.origins[0].item_kind = OriginItemKind::InertLabel;
        delta.origins[0].item_path = label.into();
        let start = catalog();
        assert_eq!(
            start.preview(request(
                &start,
                1,
                Action::AdoptInventory { inventory: delta }
            )),
            Err(Error::Invalid("source evidence label"))
        );
    }
    for label in [
        r"take:one\score",
        "../score",
        "/score",
        "scores//score",
        r"scores\score",
        ".",
        "..",
    ] {
        let mut authored = seed();
        authored.origins[0].item_path = label.into();
        assert_eq!(
            Catalog::from_seed(authored),
            Err(Error::Invalid("source evidence path"))
        );
    }
}

#[test]
fn adoption_request_limit_accepts_dense_immutable_evidence_for_one_new_song() {
    let start = catalog();
    let mut delta = new_inventory_song(4);
    let origin = delta.origins[0].clone();
    delta.origins = (0..512)
        .map(|index| {
            let mut item = origin.clone();
            item.receipt_filename = format!("receipt-{index:04}.json");
            item.item_path = format!("scores/{}.json", "x".repeat(1024));
            item
        })
        .collect();
    let body = request(&start, 1, Action::AdoptInventory { inventory: delta });
    let bytes = serde_json::to_vec(&body).unwrap();
    assert!(bytes.len() > MAX_REQUEST_BYTES);
    assert!(bytes.len() < MAX_ADOPTION_REQUEST_BYTES);
    assert_eq!(Request::from_json(&bytes).unwrap(), body);
    let preview = start.preview(body).unwrap();
    let adopted = start.apply(&preview).unwrap();
    assert_eq!(adopted.catalog.snapshot().inventory.origins.len(), 513);
    let snapshot_bytes = serde_json::to_vec(adopted.catalog.snapshot()).unwrap();
    assert!(snapshot_bytes.len() < MAX_STATE_BYTES);
    let reloaded = Catalog::from_json(&snapshot_bytes).unwrap();
    assert!(reloaded.apply(&preview).unwrap().replayed);
}

#[test]
fn ordinary_requests_keep_original_byte_cap_and_digest() {
    let start = catalog();
    let body = request(
        &start,
        1,
        Action::TrashSongs {
            song_ids: vec![song_id(1)],
        },
    );
    let preview = start.preview(body.clone()).unwrap();
    // Frozen digest of the existing, unchanged v1 request JSON.
    assert_eq!(
        preview.request_digest,
        "5c7b318d4b5ef24121f1e213a40a6624099e52587f1a4acdf1209c3997e07c83"
    );
    let mut padded = serde_json::to_vec(&body).unwrap();
    padded.resize(MAX_REQUEST_BYTES, b' ');
    assert_eq!(Request::from_json(&padded).unwrap(), body);
    padded.push(b' ');
    assert_eq!(
        Request::from_json(&padded),
        Err(Error::Limit("request bytes"))
    );
    let oversized = request(
        &start,
        2,
        Action::RenamePack {
            pack_id: pack_id(1),
            name: "x".repeat(MAX_REQUEST_BYTES),
        },
    );
    assert_eq!(
        Request::from_json(&serde_json::to_vec(&oversized).unwrap()),
        Err(Error::Limit("request bytes"))
    );
    assert_eq!(start.preview(oversized), Err(Error::Limit("request bytes")));
}

#[test]
fn adoption_request_outer_and_typed_bounds_reject_oversized_bodies() {
    assert_eq!(MAX_ADOPTION_REQUEST_BYTES, MAX_STATE_BYTES);
    let start = catalog();
    let mut delta = new_inventory_song(4);
    delta.origins[0].item_path = "x".repeat(MAX_ADOPTION_REQUEST_BYTES);
    let body = request(&start, 1, Action::AdoptInventory { inventory: delta });
    let bytes = serde_json::to_vec(&body).unwrap();
    assert!(bytes.len() > MAX_ADOPTION_REQUEST_BYTES);
    assert_eq!(
        Request::from_json(&bytes),
        Err(Error::Limit("request bytes"))
    );
    assert_eq!(start.preview(body), Err(Error::Limit("request bytes")));
    assert_eq!(start.snapshot().generation, 0);
}

#[test]
fn imported_pack_names_preserve_exact_bounded_upload_labels() {
    for name in [
        " ".to_owned(),
        r"C:\uploads\name:take.json".to_owned(),
        "x".repeat(1024),
        "é".repeat(512),
    ] {
        let mut authored = seed();
        authored.packs[0].name = name.clone();
        let seeded = Catalog::from_seed(authored).unwrap();
        assert_eq!(seeded.snapshot().inventory.packs[0].name, name);
        let mut delta = new_inventory_song(4);
        let mut imported = custom_pack(4);
        imported.name = name.clone();
        imported.kind = PackKind::Imported;
        imported.source_archive_keys = vec![source_id(3)];
        delta.packs.push(imported);
        delta.sources.push(Source {
            id: source_id(3),
            retained_bytes: 11,
            default_imported_pack: Some(pack_id(4)),
        });
        let adopted = execute(&catalog(), 1, Action::AdoptInventory { inventory: delta });
        let reloaded =
            Catalog::from_json(&serde_json::to_vec(adopted.catalog.snapshot()).unwrap()).unwrap();
        assert_eq!(
            reloaded
                .snapshot()
                .inventory
                .packs
                .iter()
                .find(|pack| pack.id == pack_id(4))
                .unwrap()
                .name,
            name
        );
    }
}

#[test]
fn imported_label_bounds_do_not_relax_custom_or_mutated_pack_names() {
    for name in [
        String::new(),
        "x".repeat(1025),
        "é".repeat(513),
        "bad\nname".into(),
        "bad\0name".into(),
    ] {
        let mut authored = seed();
        authored.packs[0].name = name;
        assert_eq!(Catalog::from_seed(authored), Err(Error::Invalid("text")));
    }
    for name in [" ".to_owned(), "x".repeat(257), "é".repeat(129)] {
        let mut authored = seed();
        authored.packs[1].name = name.clone();
        assert_eq!(Catalog::from_seed(authored), Err(Error::Invalid("text")));
        let start = catalog();
        assert_eq!(
            start.preview(request(
                &start,
                1,
                Action::CreatePack {
                    pack_id: pack_id(99),
                    name: name.clone()
                }
            )),
            Err(Error::Invalid("text"))
        );
        assert_eq!(
            start.preview(request(
                &start,
                1,
                Action::RenamePack {
                    pack_id: pack_id(1),
                    name
                }
            )),
            Err(Error::Invalid("text"))
        );
    }
    let start = catalog();
    assert!(start
        .preview(request(
            &start,
            1,
            Action::CreatePack {
                pack_id: pack_id(99),
                name: "x".repeat(256)
            }
        ))
        .is_ok());
    assert!(start
        .preview(request(
            &start,
            1,
            Action::RenamePack {
                pack_id: pack_id(1),
                name: "x".repeat(256)
            }
        ))
        .is_ok());
}

#[test]
fn remove_shared_and_last_memberships_retains_identity_and_provenance() {
    let start = catalog();
    let first = execute(
        &start,
        1,
        Action::RemoveMemberships {
            pack_id: pack_id(1),
            song_ids: vec![song_id(1)],
        },
    );
    assert!(!has_edge(&first.catalog, &edge(1, 1)));
    assert!(has_edge(&first.catalog, &edge(2, 1)));
    assert!(!is_trashed(&first.catalog, &song_id(1)));
    assert!(first.receipt.preview.effects.newly_unfiled_songs.is_empty());
    let last = execute(
        &first.catalog,
        2,
        Action::RemoveMemberships {
            pack_id: pack_id(2),
            song_ids: vec![song_id(1)],
        },
    );
    assert_eq!(
        last.receipt.preview.effects.newly_unfiled_songs,
        vec![song_id(1)]
    );
    assert_eq!(
        last.catalog.snapshot().inventory.songs,
        start.snapshot().inventory.songs
    );
    assert_eq!(
        last.catalog.snapshot().inventory.sources,
        start.snapshot().inventory.sources
    );
    assert_eq!(
        last.catalog.snapshot().inventory.origins,
        start.snapshot().inventory.origins
    );
    assert_eq!(last.receipt.preview.effects.retained_payload_bytes, 303);
    assert_eq!(last.receipt.preview.effects.retained_source_bytes, 156);
    assert_eq!(last.receipt.preview.effects.reclaimed_bytes, 0);
}

#[test]
fn move_is_atomic_and_keeps_existing_destination_metadata() {
    let start = catalog();
    let original = start
        .snapshot()
        .inventory
        .memberships
        .iter()
        .find(|item| item.id == edge(2, 1))
        .unwrap()
        .clone();
    let moved = execute(
        &start,
        1,
        Action::MoveMemberships {
            from_pack: pack_id(1),
            to_pack: pack_id(2),
            song_ids: vec![song_id(1)],
        },
    );
    assert!(!has_edge(&moved.catalog, &edge(1, 1)));
    assert_eq!(
        moved
            .catalog
            .snapshot()
            .inventory
            .memberships
            .iter()
            .find(|item| item.id == edge(2, 1))
            .unwrap(),
        &original
    );
    assert!(moved.receipt.preview.effects.added_memberships.is_empty());
    assert_eq!(
        moved.receipt.preview.effects.noops[0].reason,
        NoopReason::AlreadyPresent
    );
    let same = execute(
        &moved.catalog,
        2,
        Action::MoveMemberships {
            from_pack: pack_id(2),
            to_pack: pack_id(2),
            song_ids: vec![song_id(1)],
        },
    );
    assert_eq!(
        same.catalog.snapshot().inventory,
        moved.catalog.snapshot().inventory
    );
    assert_eq!(
        same.receipt.preview.effects.noops[0].reason,
        NoopReason::SamePack
    );
    // Missing second source cannot leave the first song moved.
    let frozen = moved.catalog.clone();
    assert_eq!(
        moved.catalog.preview(request(
            &moved.catalog,
            3,
            Action::MoveMemberships {
                from_pack: pack_id(2),
                to_pack: pack_id(3),
                song_ids: vec![song_id(1), song_id(2)]
            }
        )),
        Err(Error::NotFound)
    );
    assert_eq!(moved.catalog, frozen);
}

#[test]
fn song_trash_uses_explicit_storage_qualified_ids_and_captures_all_shared_edges() {
    let start = catalog();
    let result = execute(
        &start,
        1,
        Action::TrashSongs {
            song_ids: vec![song_id(1)],
        },
    );
    assert!(is_trashed(&result.catalog, &song_id(1)));
    assert!(!is_trashed(&result.catalog, &clean_id(1)));
    assert!(!is_trashed(&result.catalog, &song_id(2)));
    assert_eq!(
        result.receipt.preview.effects.removed_memberships,
        vec![edge(1, 1), edge(2, 1)]
    );
    assert_eq!(
        result.receipt.preview.effects.affected_packs,
        vec![pack_id(1), pack_id(2)]
    );
    assert_eq!(result.catalog.snapshot().inventory.memberships.len(), 1);
    let record = &result.catalog.snapshot().trash[0];
    assert_eq!(record.entities[0].before_revision, 0);
    assert_eq!(record.memberships.len(), 2);
    assert_eq!(
        result.catalog.snapshot().inventory.origins,
        start.snapshot().inventory.origins
    );
    assert_eq!(
        result.catalog.snapshot().inventory.sources,
        start.snapshot().inventory.sources
    );
    assert_eq!(result.receipt.preview.effects.retained_payload_bytes, 303);
    assert_eq!(result.receipt.preview.effects.reclaimed_bytes, 0);
    assert_eq!(
        result.catalog.preview(request(
            &result.catalog,
            2,
            Action::AddMemberships {
                pack_id: pack_id(3),
                song_ids: vec![song_id(1)]
            }
        )),
        Err(Error::InTrash)
    );
}

#[test]
fn pack_trash_has_no_implicit_cascade_and_explicit_cascade_rejects_shared_songs() {
    let start = catalog();
    assert_eq!(
        start.preview(request(
            &start,
            1,
            Action::TrashPack {
                pack_id: pack_id(1),
                exclusive_song_ids: vec![song_id(1)]
            }
        )),
        Err(Error::Conflict)
    );
    let plain = execute(
        &start,
        2,
        Action::TrashPack {
            pack_id: pack_id(1),
            exclusive_song_ids: vec![],
        },
    );
    assert!(plain
        .catalog
        .snapshot()
        .inventory
        .songs
        .iter()
        .all(|song| song.trashed_by.is_none()));
    assert!(has_edge(&plain.catalog, &edge(2, 1)));
    assert_eq!(
        plain.receipt.preview.effects.newly_unfiled_songs,
        vec![song_id(2)]
    );
    let cascade = execute(
        &start,
        3,
        Action::TrashPack {
            pack_id: pack_id(1),
            exclusive_song_ids: vec![song_id(2)],
        },
    );
    assert!(!is_trashed(&cascade.catalog, &song_id(1)));
    assert!(is_trashed(&cascade.catalog, &song_id(2)));
    assert!(has_edge(&cascade.catalog, &edge(2, 1)));
    assert_eq!(
        cascade.receipt.preview.effects.trashed_songs,
        vec![song_id(2)]
    );
    assert_eq!(cascade.catalog.snapshot().trash[0].entities.len(), 2);
}

#[test]
fn restore_is_forward_and_never_restores_independently_trashed_pack() {
    let a = execute(
        &catalog(),
        1,
        Action::TrashSongs {
            song_ids: vec![song_id(1)],
        },
    )
    .catalog;
    let b = execute(
        &a,
        2,
        Action::TrashPack {
            pack_id: pack_id(1),
            exclusive_song_ids: vec![],
        },
    )
    .catalog;
    let c = execute(
        &b,
        3,
        Action::RenamePack {
            pack_id: pack_id(2),
            name: "New name / 新曲包".into(),
        },
    )
    .catalog;
    let restored = execute(
        &c,
        4,
        restore_action(1, vec![Entity::Song(song_id(1))], vec![]),
    );
    assert_eq!(restored.catalog.snapshot().generation, 4);
    assert!(!is_trashed(&restored.catalog, &song_id(1)));
    assert!(has_edge(&restored.catalog, &edge(2, 1)));
    assert!(!has_edge(&restored.catalog, &edge(1, 1)));
    assert_eq!(
        restored.receipt.preview.effects.blocked_memberships,
        vec![BlockedMembership {
            membership: edge(1, 1),
            dependencies: vec![Entity::Pack(pack_id(1))]
        }]
    );
    let packs = &restored.catalog.snapshot().inventory.packs;
    assert_eq!(
        packs
            .iter()
            .find(|pack| pack.id == pack_id(2))
            .unwrap()
            .name,
        "New name / 新曲包"
    );
    assert!(packs
        .iter()
        .find(|pack| pack.id == pack_id(1))
        .unwrap()
        .trashed_by
        .is_some());
    let pack_restored = execute(
        &restored.catalog,
        5,
        restore_action(2, vec![Entity::Pack(pack_id(1))], vec![]),
    )
    .catalog;
    assert!(!has_edge(&pack_restored, &edge(1, 1))); // This edge belongs to song Trash.
    let edge_restored = execute(
        &pack_restored,
        6,
        restore_action(1, vec![], vec![edge(1, 1)]),
    );
    assert!(has_edge(&edge_restored.catalog, &edge(1, 1)));
}

#[test]
fn restore_pack_leaves_separately_trashed_song_blocked_until_explicit_restore() {
    let a = execute(
        &catalog(),
        1,
        Action::TrashPack {
            pack_id: pack_id(1),
            exclusive_song_ids: vec![],
        },
    )
    .catalog;
    let b = execute(
        &a,
        2,
        Action::TrashSongs {
            song_ids: vec![song_id(2)],
        },
    )
    .catalog;
    let c = execute(
        &b,
        3,
        restore_action(1, vec![Entity::Pack(pack_id(1))], vec![]),
    );
    assert!(has_edge(&c.catalog, &edge(1, 1)));
    assert!(!has_edge(&c.catalog, &edge(1, 2)));
    assert!(is_trashed(&c.catalog, &song_id(2)));
    assert_eq!(
        c.receipt.preview.effects.blocked_memberships[0].dependencies,
        vec![Entity::Song(song_id(2))]
    );
    let d = execute(
        &c.catalog,
        4,
        restore_action(2, vec![Entity::Song(song_id(2))], vec![]),
    )
    .catalog;
    let e = execute(
        &d,
        5,
        Action::AddMemberships {
            pack_id: pack_id(1),
            song_ids: vec![song_id(2)],
        },
    )
    .catalog;
    let existing = e
        .snapshot()
        .inventory
        .memberships
        .iter()
        .find(|item| item.id == edge(1, 2))
        .unwrap()
        .clone();
    let f = execute(&e, 6, restore_action(1, vec![], vec![edge(1, 2)]));
    assert_eq!(
        f.catalog
            .snapshot()
            .inventory
            .memberships
            .iter()
            .find(|item| item.id == edge(1, 2))
            .unwrap(),
        &existing
    );
    assert_eq!(
        f.receipt.preview.effects.noops[0].reason,
        NoopReason::AlreadyPresent
    );
}

#[test]
fn resolved_restore_cannot_reinsert_manually_removed_edges_or_heal_newer_trash() {
    let a = execute(
        &catalog(),
        1,
        Action::TrashSongs {
            song_ids: vec![song_id(1)],
        },
    )
    .catalog;
    let b = execute(
        &a,
        2,
        restore_action(1, vec![Entity::Song(song_id(1))], vec![]),
    )
    .catalog;
    let c = execute(
        &b,
        3,
        Action::RemoveMemberships {
            pack_id: pack_id(1),
            song_ids: vec![song_id(1)],
        },
    )
    .catalog;
    let d = execute(
        &c,
        4,
        restore_action(1, vec![Entity::Song(song_id(1))], vec![edge(1, 1)]),
    )
    .catalog;
    assert!(!has_edge(&d, &edge(1, 1)));
    let e = execute(
        &d,
        5,
        Action::TrashSongs {
            song_ids: vec![song_id(1)],
        },
    )
    .catalog;
    assert_eq!(
        e.preview(request(
            &e,
            6,
            restore_action(1, vec![Entity::Song(song_id(1))], vec![])
        )),
        Err(Error::Conflict)
    );
    assert!(is_trashed(&e, &song_id(1)));
}

#[test]
fn retries_survive_serialization_and_return_original_receipt_without_rewinding() {
    let start = catalog();
    let original = start
        .preview(request(
            &start,
            1,
            Action::TrashSongs {
                song_ids: vec![song_id(1)],
            },
        ))
        .unwrap();
    let a = start.apply(&original).unwrap();
    let b = execute(
        &a.catalog,
        2,
        Action::RenamePack {
            pack_id: pack_id(3),
            name: "Later rename".into(),
        },
    )
    .catalog;
    let reopened = Catalog::from_json(&serde_json::to_vec(b.snapshot()).unwrap()).unwrap();
    assert_eq!(reopened, b);
    let replayed = reopened.apply(&original).unwrap();
    assert!(replayed.replayed);
    assert_eq!(replayed.receipt, a.receipt);
    assert_eq!(replayed.catalog, reopened);
    assert_eq!(
        reopened.preview(original.request.clone()).unwrap(),
        original
    );
    let mut changed = original.clone();
    changed.request.action = Action::TrashSongs {
        song_ids: vec![song_id(2)],
    };
    assert_eq!(reopened.apply(&changed), Err(Error::IdempotencyConflict));
    assert_eq!(
        reopened.preview(changed.request),
        Err(Error::IdempotencyConflict)
    );
    let mut forged = original;
    forged.effects.reclaimed_bytes = 303;
    assert_eq!(reopened.apply(&forged), Err(Error::InvalidPlan));
}

#[test]
fn preview_binds_exact_body_generation_snapshot_and_effects() {
    let start = catalog();
    let plan = start
        .preview(request(
            &start,
            1,
            Action::TrashPack {
                pack_id: pack_id(1),
                exclusive_song_ids: vec![song_id(2)],
            },
        ))
        .unwrap();
    assert_eq!(start.preview(plan.request.clone()).unwrap(), plan);
    let changed = execute(
        &start,
        2,
        Action::AddMemberships {
            pack_id: pack_id(3),
            song_ids: vec![song_id(2)],
        },
    )
    .catalog;
    assert_eq!(changed.apply(&plan), Err(Error::Stale));
    let mut other_seed = seed();
    other_seed.memberships.pop();
    let other = Catalog::from_seed(other_seed).unwrap();
    let simple_plan = start
        .preview(request(
            &start,
            3,
            Action::RenamePack {
                pack_id: pack_id(3),
                name: "Renamed".into(),
            },
        ))
        .unwrap();
    assert_eq!(other.apply(&simple_plan), Err(Error::InvalidPlan));
    let mut altered_effects = simple_plan;
    altered_effects.effects.affected_packs.clear();
    assert_eq!(start.apply(&altered_effects), Err(Error::InvalidPlan));
    assert_eq!(start.snapshot().generation, 0);
}

#[test]
fn pack_creation_rename_and_add_do_not_rewrite_import_evidence() {
    let start = catalog();
    let a = execute(
        &start,
        1,
        Action::CreatePack {
            pack_id: pack_id(99),
            name: "新建 / Original".into(),
        },
    )
    .catalog;
    let b = execute(
        &a,
        2,
        Action::RenamePack {
            pack_id: pack_id(1),
            name: "Renamed imported pack".into(),
        },
    )
    .catalog;
    let c = execute(
        &b,
        3,
        Action::AddMemberships {
            pack_id: pack_id(99),
            song_ids: vec![song_id(1), clean_id(1)],
        },
    );
    assert_eq!(
        c.catalog.snapshot().inventory.origins,
        start.snapshot().inventory.origins
    );
    assert_eq!(
        c.catalog.snapshot().inventory.sources,
        start.snapshot().inventory.sources
    );
    assert_eq!(
        c.catalog.snapshot().inventory.songs,
        start.snapshot().inventory.songs
    );
    assert_eq!(c.receipt.preview.effects.added_memberships.len(), 2);
    assert_eq!(
        c.catalog.preview(request(
            &c.catalog,
            4,
            Action::CreatePack {
                pack_id: pack_id(99),
                name: "Collision".into()
            }
        )),
        Err(Error::Conflict)
    );
    let noop = execute(
        &c.catalog,
        5,
        Action::AddMemberships {
            pack_id: pack_id(99),
            song_ids: vec![song_id(1)],
        },
    );
    assert!(noop.receipt.preview.effects.added_memberships.is_empty());
    assert_eq!(
        noop.receipt.preview.effects.noops[0].reason,
        NoopReason::AlreadyPresent
    );
}

#[test]
fn malformed_unknown_duplicate_and_unbounded_input_is_rejected() {
    for id in [
        "song-abc",
        "legacy:song-../../x",
        "bundled:song-000",
        "clean:song-ABC",
        "legacy:song-",
    ] {
        assert!(SongId::parse(id).is_err());
    }
    assert!(PackId::parse("../../collection-00000000000000000000000000000001").is_err());
    let start = catalog();
    for ids in [vec![], vec![song_id(1), song_id(1)]] {
        assert!(start
            .preview(request(&start, 1, Action::TrashSongs { song_ids: ids }))
            .is_err());
    }
    let oversized = (0..=MAX_SELECTION).map(|n| song_id(n as u32)).collect();
    assert_eq!(
        start.preview(request(
            &start,
            1,
            Action::TrashSongs {
                song_ids: oversized
            }
        )),
        Err(Error::Limit("selection"))
    );
    let valid = request(
        &start,
        1,
        Action::TrashSongs {
            song_ids: vec![song_id(1)],
        },
    );
    let mut value = serde_json::to_value(&valid).unwrap();
    value["action"]["path"] = "../private-library".into();
    assert!(Request::from_json(&serde_json::to_vec(&value).unwrap()).is_err());
    value = serde_json::to_value(&valid).unwrap();
    value["schema_version"] = 2.into();
    assert_eq!(
        Request::from_json(&serde_json::to_vec(&value).unwrap()),
        Err(Error::UnsupportedVersion)
    );
    assert_eq!(
        Catalog::from_json(&vec![b' '; MAX_STATE_BYTES + 1]),
        Err(Error::Limit("state bytes"))
    );
    let mut duplicate = seed();
    duplicate.songs.push(duplicate.songs[0].clone());
    assert!(Catalog::from_seed(duplicate).is_err());
    let mut duplicate = seed();
    duplicate.memberships.push(duplicate.memberships[0].clone());
    assert!(Catalog::from_seed(duplicate).is_err());
    let mut malformed = seed();
    malformed.origins[0].item_path = "../song.json".into();
    assert!(Catalog::from_seed(malformed).is_err());
    let mut too_many = seed();
    too_many.songs = (0..=MAX_SONGS)
        .map(|n| Song {
            id: song_id(n as u32),
            retained_bytes: 0,
            revision: 0,
            trashed_by: None,
        })
        .collect();
    assert_eq!(Catalog::from_seed(too_many), Err(Error::Limit("songs")));
}

#[test]
fn affected_edge_limit_is_checked_before_returning_a_plan() {
    let mut authored = Seed {
        songs: vec![],
        packs: vec![],
        memberships: vec![],
        sources: vec![],
        origins: vec![],
    };
    for s in 0..5 {
        authored.songs.push(Song {
            id: song_id(s),
            retained_bytes: 1,
            revision: 0,
            trashed_by: None,
        });
    }
    for p in 0..256 {
        authored.packs.push(custom_pack(p));
        for s in 0..5 {
            authored.memberships.push(Membership {
                id: edge(p, s),
                position: s,
                added_at_unix_ms: 0,
                revision: 0,
            });
        }
    }
    let start = Catalog::from_seed(authored).unwrap();
    let before = start.clone();
    assert_eq!(
        start.preview(request(
            &start,
            1,
            Action::TrashSongs {
                song_ids: (0..5).map(song_id).collect()
            }
        )),
        Err(Error::Limit("affected memberships"))
    );
    assert_eq!(start, before);
    let valid = execute(
        &start,
        2,
        Action::TrashSongs {
            song_ids: (0..4).map(song_id).collect(),
        },
    );
    assert_eq!(
        valid.receipt.preview.effects.removed_memberships.len(),
        MAX_SELECTION
    );
    assert_eq!(valid.catalog.snapshot().inventory.memberships.len(), 256);
}

#[test]
fn corrupt_snapshot_cannot_silently_reset_trash_or_receipts() {
    let start = execute(
        &catalog(),
        1,
        Action::TrashSongs {
            song_ids: vec![song_id(1)],
        },
    )
    .catalog;
    let mut corrupt = start.snapshot().clone();
    corrupt.trash.clear();
    assert!(Catalog::from_snapshot(corrupt).is_err());
    let mut corrupt = start.snapshot().clone();
    corrupt.receipts.clear();
    assert!(Catalog::from_snapshot(corrupt).is_err());
    let mut corrupt = start.snapshot().clone();
    corrupt
        .inventory
        .songs
        .iter_mut()
        .find(|song| song.id == song_id(1))
        .unwrap()
        .trashed_by = None;
    assert!(Catalog::from_snapshot(corrupt).is_err());
    let mut corrupt = start.snapshot().clone();
    corrupt.trash[0].memberships[0].membership.id.song = clean_id(1);
    assert!(Catalog::from_snapshot(corrupt).is_err());
    let mut corrupt = start.snapshot().clone();
    corrupt.receipts[0].preview.effects.reclaimed_bytes = 999;
    assert!(Catalog::from_snapshot(corrupt).is_err());
    let mut corrupt = start.snapshot().clone();
    corrupt.schema_version = 99;
    assert_eq!(
        Catalog::from_snapshot(corrupt),
        Err(Error::UnsupportedVersion)
    );
}

#[test]
fn seed_order_does_not_change_plan_or_result() {
    let first = catalog();
    let mut reordered = seed();
    reordered.songs.reverse();
    reordered.packs.reverse();
    reordered.memberships.reverse();
    reordered.sources.reverse();
    reordered.origins.reverse();
    let second = Catalog::from_seed(reordered).unwrap();
    let request = request(
        &first,
        1,
        Action::TrashSongs {
            song_ids: vec![song_id(2), song_id(1)],
        },
    );
    assert_eq!(
        first.preview(request.clone()).unwrap(),
        second.preview(request).unwrap()
    );
}

#[test]
fn selected_restore_is_atomic_and_leaves_unselected_entities_in_trash() {
    let start = execute(
        &catalog(),
        1,
        Action::TrashSongs {
            song_ids: vec![song_id(1), song_id(2)],
        },
    )
    .catalog;
    let frozen = start.clone();
    assert_eq!(
        start.preview(request(
            &start,
            2,
            restore_action(1, vec![Entity::Song(song_id(2))], vec![edge(3, 2)])
        )),
        Err(Error::NotFound)
    );
    assert_eq!(start, frozen);
    let restored = execute(
        &start,
        3,
        restore_action(1, vec![Entity::Song(song_id(2))], vec![]),
    );
    assert!(is_trashed(&restored.catalog, &song_id(1)));
    assert!(!is_trashed(&restored.catalog, &song_id(2)));
    assert!(has_edge(&restored.catalog, &edge(1, 2)));
    assert!(!has_edge(&restored.catalog, &edge(1, 1)));
    assert!(!has_edge(&restored.catalog, &edge(2, 1)));
    assert_eq!(
        restored.receipt.preview.effects.restored_songs,
        vec![song_id(2)]
    );
    let all_restored = execute(
        &restored.catalog,
        4,
        restore_action(1, vec![Entity::Song(song_id(1))], vec![]),
    )
    .catalog;
    let mut removed_history = all_restored.snapshot().clone();
    removed_history.trash.clear();
    assert!(Catalog::from_snapshot(removed_history).is_err());
}

#[test]
fn state_capacity_and_byte_overflow_reject_whole_transition() {
    let mut authored = seed();
    authored
        .packs
        .extend((4..=MAX_PACKS as u32).map(custom_pack));
    let start = Catalog::from_seed(authored).unwrap();
    assert_eq!(
        start.preview(request(
            &start,
            1,
            Action::CreatePack {
                pack_id: pack_id(257),
                name: "Excess".into()
            }
        )),
        Err(Error::Limit("packs"))
    );
    assert_eq!(start.snapshot().generation, 0);
    let mut overflow = seed();
    overflow.songs[0].retained_bytes = u64::MAX;
    assert_eq!(
        Catalog::from_seed(overflow),
        Err(Error::Limit("retained bytes"))
    );
    let mut missing_dependency = seed();
    missing_dependency
        .packs
        .retain(|pack| pack.id != pack_id(2));
    assert_eq!(Catalog::from_seed(missing_dependency), Err(Error::NotFound));
}

#[test]
fn blocked_dependencies_cannot_be_marked_resolved_without_effect_evidence() {
    let a = execute(
        &catalog(),
        1,
        Action::TrashPack {
            pack_id: pack_id(1),
            exclusive_song_ids: vec![],
        },
    )
    .catalog;
    let b = execute(
        &a,
        2,
        Action::TrashSongs {
            song_ids: vec![song_id(2)],
        },
    )
    .catalog;
    let c = execute(
        &b,
        3,
        restore_action(1, vec![Entity::Pack(pack_id(1))], vec![]),
    )
    .catalog;
    let mut corrupt = c.snapshot().clone();
    let record = corrupt
        .trash
        .iter_mut()
        .find(|record| record.operation_id == operation_id(1))
        .unwrap();
    record
        .memberships
        .iter_mut()
        .find(|item| item.membership.id == edge(1, 2))
        .unwrap()
        .restored_by = Some(operation_id(3));
    assert!(Catalog::from_snapshot(corrupt).is_err());
    let mut corrupt = c.snapshot().clone();
    corrupt
        .inventory
        .packs
        .iter_mut()
        .find(|pack| pack.id == pack_id(1))
        .unwrap()
        .revision = 1;
    assert!(Catalog::from_snapshot(corrupt).is_err());
}

#[test]
fn erased_edge_restore_marker_cannot_resurrect_a_later_removal() {
    let a = execute(
        &catalog(),
        1,
        Action::TrashSongs {
            song_ids: vec![song_id(1)],
        },
    )
    .catalog;
    let b = execute(
        &a,
        2,
        restore_action(1, vec![Entity::Song(song_id(1))], vec![]),
    )
    .catalog;
    let c = execute(
        &b,
        3,
        Action::RemoveMemberships {
            pack_id: pack_id(1),
            song_ids: vec![song_id(1)],
        },
    )
    .catalog;
    let mut erased = c.snapshot().clone();
    erased.trash[0]
        .memberships
        .iter_mut()
        .find(|captured| captured.membership.id == edge(1, 1))
        .unwrap()
        .restored_by = None;
    assert!(Catalog::from_snapshot(erased).is_err());
}

#[test]
fn repeating_entity_restore_does_not_retry_previously_blocked_edges_after_newer_removal() {
    let a = execute(
        &catalog(),
        1,
        Action::TrashPack {
            pack_id: pack_id(1),
            exclusive_song_ids: vec![],
        },
    )
    .catalog;
    let b = execute(
        &a,
        2,
        Action::TrashSongs {
            song_ids: vec![song_id(2)],
        },
    )
    .catalog;
    let c = execute(
        &b,
        3,
        restore_action(1, vec![Entity::Pack(pack_id(1))], vec![]),
    )
    .catalog;
    let d = execute(
        &c,
        4,
        restore_action(2, vec![Entity::Song(song_id(2))], vec![]),
    )
    .catalog;
    let e = execute(
        &d,
        5,
        Action::AddMemberships {
            pack_id: pack_id(1),
            song_ids: vec![song_id(2)],
        },
    )
    .catalog;
    let f = execute(
        &e,
        6,
        Action::RemoveMemberships {
            pack_id: pack_id(1),
            song_ids: vec![song_id(2)],
        },
    )
    .catalog;
    let g = execute(
        &f,
        7,
        restore_action(1, vec![Entity::Pack(pack_id(1))], vec![]),
    );
    assert!(!has_edge(&g.catalog, &edge(1, 2)));
    assert!(g.receipt.preview.effects.added_memberships.is_empty());
    assert_eq!(g.catalog.snapshot().inventory, f.snapshot().inventory);
    let explicit = execute(&g.catalog, 8, restore_action(1, vec![], vec![edge(1, 2)]));
    assert!(has_edge(&explicit.catalog, &edge(1, 2)));
}

#[test]
fn duplicate_json_fields_are_rejected_before_graph_validation() {
    let start = catalog();
    let req = request(
        &start,
        1,
        Action::TrashSongs {
            song_ids: vec![song_id(1)],
        },
    );
    let encoded = serde_json::to_string(&req).unwrap();
    let operation = format!("\"operation_id\":\"{}\"", operation_id(1).as_str());
    let duplicates = [
        encoded.replacen(&operation, &format!("{operation},{operation}"), 1),
        encoded.replacen(
            "\"type\":\"trash_songs\"",
            "\"type\":\"trash_songs\",\"type\":\"trash_songs\"",
            1,
        ),
        encoded.replacen("\"song_ids\":", "\"song_ids\":[],\"song_ids\":", 1),
    ];
    for duplicate in duplicates {
        assert!(Request::from_json(duplicate.as_bytes()).is_err());
    }
    let encoded = serde_json::to_string(start.snapshot()).unwrap();
    assert!(Catalog::from_json(
        encoded
            .replacen(
                "\"schema_version\":1",
                "\"schema_version\":1,\"schema_version\":1",
                1
            )
            .as_bytes()
    )
    .is_err());
    let id = format!("\"id\":\"{}\"", song_id(1).as_str());
    assert!(
        Catalog::from_json(encoded.replacen(&id, &format!("{id},{id}"), 1).as_bytes()).is_err()
    );
}
