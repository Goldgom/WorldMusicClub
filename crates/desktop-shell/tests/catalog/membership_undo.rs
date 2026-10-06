//! Original in-memory fixtures; no physical library or imported assets.
use super::*;

fn undo(id: u32) -> Action {
    Action::UndoMemberships {
        membership_operation_id: operation_id(id),
    }
}
fn member(catalog: &Catalog, id: MembershipId) -> Membership {
    catalog
        .snapshot()
        .inventory
        .memberships
        .iter()
        .find(|edge| edge.id == id)
        .unwrap()
        .clone()
}

#[test]
fn membership_move_undo_preserves_shared_edges_metadata_and_unrelated_later_work() {
    let mut original = seed();
    original.memberships.extend([
        Membership {
            id: edge(2, 2),
            position: 19,
            added_at_unix_ms: 91,
            revision: 0,
        },
        Membership {
            id: edge(3, 1),
            position: 23,
            added_at_unix_ms: 92,
            revision: 0,
        },
    ]);
    let initial = Catalog::from_seed(original).unwrap();
    let moved = execute(
        &initial,
        1,
        Action::MoveMemberships {
            from_pack: pack_id(2),
            to_pack: pack_id(3),
            song_ids: vec![song_id(1), song_id(2)],
        },
    );
    assert_eq!(
        moved.receipt.preview.effects.added_memberships,
        vec![edge(3, 2)]
    );
    assert_eq!(
        moved
            .receipt
            .preview
            .effects
            .removed_membership_snapshots
            .len(),
        2
    );
    assert_eq!(
        moved.receipt.preview.effects.noops[0].reason,
        NoopReason::AlreadyPresent
    );
    assert_eq!(
        member(&moved.catalog, edge(3, 1)),
        member(&initial, edge(3, 1))
    );
    let renamed = execute(
        &moved.catalog,
        2,
        Action::RenamePack {
            pack_id: pack_id(2),
            name: "Keep this later name".into(),
        },
    )
    .catalog;
    let later = execute(
        &renamed,
        3,
        Action::AddMemberships {
            pack_id: pack_id(3),
            song_ids: vec![clean_id(1)],
        },
    )
    .catalog;
    let reloaded = Catalog::from_json(&serde_json::to_vec(later.snapshot()).unwrap()).unwrap();
    assert!(reloaded.can_undo_memberships(&operation_id(1)));
    let restored = execute(&reloaded, 4, undo(1));
    assert!(!has_edge(&restored.catalog, &edge(3, 2)));
    for id in [edge(1, 1), edge(1, 2), edge(3, 1)] {
        assert_eq!(member(&restored.catalog, id.clone()), member(&initial, id));
    }
    for id in [edge(2, 1), edge(2, 2)] {
        let before = member(&initial, id.clone());
        let after = member(&restored.catalog, id);
        assert_eq!(after.position, before.position);
        assert_eq!(after.added_at_unix_ms, before.added_at_unix_ms);
        assert_eq!(after.revision, 4);
    }
    assert!(has_edge(
        &restored.catalog,
        &MembershipId {
            pack: pack_id(3),
            song: clean_id(1)
        }
    ));
    assert_eq!(
        restored
            .catalog
            .snapshot()
            .inventory
            .packs
            .iter()
            .find(|p| p.id == pack_id(2))
            .unwrap()
            .name,
        "Keep this later name"
    );
    assert_eq!(
        restored.catalog.snapshot().inventory.origins,
        initial.snapshot().inventory.origins
    );
    assert_eq!(
        restored.catalog.snapshot().inventory.sources,
        initial.snapshot().inventory.sources
    );
    assert_eq!(restored.receipt.preview.effects.reclaimed_bytes, 0);
    assert!(!restored.catalog.can_undo_memberships(&operation_id(1)));
    assert_eq!(
        restored
            .catalog
            .preview(request(&restored.catalog, 5, undo(1))),
        Err(Error::Conflict)
    );
    assert!(
        restored
            .catalog
            .apply(&restored.receipt.preview)
            .unwrap()
            .replayed
    );
    assert!(
        restored
            .catalog
            .apply(&moved.receipt.preview)
            .unwrap()
            .replayed
    );
}

#[test]
fn membership_undo_blocks_edited_edges_even_after_remove_readd_or_trash_restore() {
    let moved = execute(
        &catalog(),
        1,
        Action::MoveMemberships {
            from_pack: pack_id(2),
            to_pack: pack_id(3),
            song_ids: vec![song_id(1)],
        },
    )
    .catalog;
    for touched in [pack_id(2), pack_id(3)] {
        let changed = if touched == pack_id(2) {
            execute(
                &moved,
                2,
                Action::AddMemberships {
                    pack_id: touched,
                    song_ids: vec![song_id(1)],
                },
            )
            .catalog
        } else {
            let removed = execute(
                &moved,
                2,
                Action::RemoveMemberships {
                    pack_id: touched.clone(),
                    song_ids: vec![song_id(1)],
                },
            )
            .catalog;
            execute(
                &removed,
                3,
                Action::AddMemberships {
                    pack_id: touched,
                    song_ids: vec![song_id(1)],
                },
            )
            .catalog
        };
        assert!(!changed.can_undo_memberships(&operation_id(1)));
        assert_eq!(
            changed.preview(request(&changed, 9, undo(1))),
            Err(Error::Conflict)
        );
    }
    let trashed = execute(
        &moved,
        2,
        Action::TrashSongs {
            song_ids: vec![song_id(1)],
        },
    )
    .catalog;
    let restored = execute(
        &trashed,
        3,
        restore_action(2, vec![Entity::Song(song_id(1))], vec![]),
    )
    .catalog;
    assert!(!restored.can_undo_memberships(&operation_id(1)));
    assert_eq!(
        restored.preview(request(&restored, 9, undo(1))),
        Err(Error::Conflict)
    );
}

#[test]
fn membership_undo_does_not_recreate_an_unchanged_destination_removed_later() {
    let mut original = seed();
    original.memberships.push(Membership {
        id: edge(3, 1),
        position: 27,
        added_at_unix_ms: 81,
        revision: 0,
    });
    let initial = Catalog::from_seed(original).unwrap();
    let moved = execute(
        &initial,
        1,
        Action::MoveMemberships {
            from_pack: pack_id(2),
            to_pack: pack_id(3),
            song_ids: vec![song_id(1)],
        },
    )
    .catalog;
    let later = execute(
        &moved,
        2,
        Action::RemoveMemberships {
            pack_id: pack_id(3),
            song_ids: vec![song_id(1)],
        },
    )
    .catalog;
    assert!(later.can_undo_memberships(&operation_id(1)));
    let restored = execute(&later, 3, undo(1)).catalog;
    assert!(has_edge(&restored, &edge(2, 1)));
    assert!(!has_edge(&restored, &edge(3, 1)));
    assert_eq!(member(&restored, edge(1, 1)), member(&initial, edge(1, 1)));
}

#[test]
fn membership_remove_noops_and_same_pack_moves_do_not_offer_false_undo() {
    let initial = catalog();
    let removed = execute(
        &initial,
        1,
        Action::RemoveMemberships {
            pack_id: pack_id(2),
            song_ids: vec![song_id(1), song_id(2)],
        },
    );
    assert_eq!(
        removed.receipt.preview.effects.removed_memberships,
        vec![edge(2, 1)]
    );
    assert_eq!(
        removed.receipt.preview.effects.noops[0].reason,
        NoopReason::AlreadyAbsent
    );
    let restored = execute(&removed.catalog, 2, undo(1));
    assert!(has_edge(&restored.catalog, &edge(2, 1)));
    assert!(!has_edge(&restored.catalog, &edge(2, 2)));
    let same = execute(
        &initial,
        1,
        Action::MoveMemberships {
            from_pack: pack_id(2),
            to_pack: pack_id(2),
            song_ids: vec![song_id(1)],
        },
    );
    assert_eq!(
        same.receipt.preview.effects.noops[0].reason,
        NoopReason::SamePack
    );
    assert!(same
        .receipt
        .preview
        .effects
        .removed_membership_snapshots
        .is_empty());
    assert!(!same.catalog.can_undo_memberships(&operation_id(1)));
    let absent = execute(
        &initial,
        1,
        Action::RemoveMemberships {
            pack_id: pack_id(3),
            song_ids: vec![song_id(1)],
        },
    );
    assert!(!absent.catalog.can_undo_memberships(&operation_id(1)));
    assert_eq!(
        absent.catalog.preview(request(&absent.catalog, 2, undo(1))),
        Err(Error::Conflict)
    );
}

#[test]
fn membership_undo_rechecks_preview_and_keeps_previous_product_receipts_byte_compatible() {
    let initial = catalog();
    let created = execute(
        &initial,
        1,
        Action::CreatePack {
            pack_id: pack_id(4),
            name: "Unchanged old receipt".into(),
        },
    );
    let serialized = serde_json::to_value(&created.receipt).unwrap();
    assert!(serialized["preview"]["effects"]
        .get("removed_membership_snapshots")
        .is_none());
    let removed = execute(
        &created.catalog,
        2,
        Action::RemoveMemberships {
            pack_id: pack_id(2),
            song_ids: vec![song_id(1)],
        },
    );
    let preview = removed
        .catalog
        .preview(request(&removed.catalog, 3, undo(2)))
        .unwrap();
    let mut edited = preview.clone();
    edited.effects.added_memberships.clear();
    assert_eq!(removed.catalog.apply(&edited), Err(Error::InvalidPlan));
    let later = execute(
        &removed.catalog,
        4,
        Action::RenamePack {
            pack_id: pack_id(3),
            name: "Unrelated".into(),
        },
    )
    .catalog;
    assert_eq!(later.apply(&preview), Err(Error::Stale));
    assert!(later.can_undo_memberships(&operation_id(2)));
    let mut changed_id = preview.request.clone();
    changed_id.operation_id = operation_id(2);
    assert_eq!(later.preview(changed_id), Err(Error::IdempotencyConflict));
}
