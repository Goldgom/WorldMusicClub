//! User-pack product tests only touch the original owned Fixture from the parent.
use super::*;

fn pack_request(
    library: &NativeLibrary,
    action: &str,
    pack: Value,
    name: Value,
    ids: Vec<Value>,
) -> Value {
    let status = ok(library, "status", json!({}));
    json!({"library_id":status["library_id"],"action":action,"edition_ids":ids,"trash_operation_id":null,"collection_id":pack,"name":name,"expected_generation":status["generation"],"catalog_digest":status["catalog_digest"]})
}
fn pack_plan(
    library: &NativeLibrary,
    action: &str,
    pack: Value,
    name: Value,
    ids: Vec<Value>,
) -> Value {
    ok(
        library,
        "preview",
        pack_request(library, action, pack, name, ids),
    )
}
fn create(library: &NativeLibrary, name: &str) -> Value {
    let preview = pack_plan(library, "create_pack", Value::Null, json!(name), vec![]);
    assert_eq!(preview["summary"]["created_pack_count"], 1);
    assert_eq!(preview["summary"]["changed_song_count"], 0);
    assert_eq!(preview["summary"]["affected_packs"][0]["kind"], "custom");
    assert!(preview["summary"]["affected_packs"][0]["import_pack_id"].is_null());
    ok(library, "commit", commit_body(&preview));
    preview["preview"]["request"]["action"]["pack_id"].clone()
}
fn in_pack(library: &NativeLibrary, view: &str, pack: &Value) -> Value {
    ok(
        library,
        "query",
        json!({"view":view,"collection_id":pack,"refresh":true,"limit":100}),
    )
}

#[test]
fn user_packs_share_exact_editions_preserve_empty_packs_and_recover_after_restart() {
    NATIVE_CALLS.with(|calls| calls.borrow_mut().clear());
    let f = Fixture::new();
    let library = f.library();
    let source = zip(vec![
        ("first.json", score("original-shared")),
        ("second.json", score("original-other")),
    ]);
    song_pack::import(&library, "original-source.zip", &source, true, false, None).unwrap();
    let clean = song_pack::import(
        &library,
        "original-clean.zip",
        &clean_pack(),
        true,
        false,
        None,
    )
    .unwrap();
    let clean_key = &clean.items[0].entry.as_ref().unwrap().key;
    let loaded_media = library
        .load(clean_key)
        .unwrap()
        .clean_package
        .unwrap()
        .media
        .remove(0);
    let media_before =
        super::super::super::clean_package::asset(&library, clean_key, &loaded_media.handle)
            .unwrap();
    let before = files(&f.root);
    init(&library);
    let original = list(&library, "active");
    let selected: Vec<_> = original["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|song| song["score_id"] == "original-shared" || song["storage_kind"] == "clean")
        .map(|song| song["edition_id"].clone())
        .collect();
    assert_eq!(selected.len(), 2);
    let first = create(&library, "我的练习曲包");
    let empty = create(&library, "Empty user pack");
    assert_ne!(first, empty);
    let empty_rows = in_pack(&library, "active", &empty);
    assert_eq!(empty_rows["total"], 0);
    let packs = list(&library, "packs");
    let empty_row = packs["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["collection_id"] == empty)
        .unwrap();
    assert_eq!(empty_row["active_song_count"], 0);
    assert_eq!(empty_row["available_song_count"], 0);
    assert_eq!(empty_row["shared_song_count"], 0);
    let add = pack_plan(
        &library,
        "add_memberships",
        first.clone(),
        Value::Null,
        selected.clone(),
    );
    assert_eq!(add["summary"]["selected_count"], 2);
    assert_eq!(add["summary"]["added_membership_count"], 2);
    assert_eq!(add["summary"]["changed_song_count"], 0);
    assert_eq!(add["summary"]["unchanged_membership_count"], 0);
    assert_eq!(
        add["summary"]["affected_packs"][0]["selected_song_count"],
        2
    );
    assert_eq!(add["summary"]["target_pack"]["name"], "我的练习曲包");
    ok(&library, "commit", commit_body(&add));
    let members = in_pack(&library, "active", &first);
    assert_eq!(members["total"], 2);
    assert!(members["rows"]
        .as_array()
        .unwrap()
        .iter()
        .all(|row| row["pack_count"] == 2));
    let saved_edges = journal::load(&library)
        .unwrap()
        .unwrap()
        .catalog
        .snapshot()
        .inventory
        .memberships
        .clone();
    let duplicate = pack_plan(
        &library,
        "add_memberships",
        first.clone(),
        Value::Null,
        selected.clone(),
    );
    assert_eq!(duplicate["summary"]["added_membership_count"], 0);
    assert_eq!(duplicate["summary"]["unchanged_membership_count"], 2);
    assert_eq!(duplicate["summary"]["target_pack"]["collection_id"], first);
    assert_eq!(duplicate["summary"]["target_pack"]["name"], "我的练习曲包");
    assert_eq!(duplicate["preview"]["effects"]["affected_packs"], json!([]));
    ok(&library, "commit", commit_body(&duplicate));
    assert_eq!(
        journal::load(&library)
            .unwrap()
            .unwrap()
            .catalog
            .snapshot()
            .inventory
            .memberships,
        saved_edges
    );
    let rename = pack_plan(
        &library,
        "rename_pack",
        first.clone(),
        json!("整理后的曲包"),
        vec![],
    );
    assert_eq!(
        rename["summary"]["affected_packs"][0]["name"],
        "整理后的曲包"
    );
    ok(&library, "commit", commit_body(&rename));
    f.restart("check", 5, 0);
    // Simulate a lost reply: read durable operation ID after a fresh process has loaded it.
    let receipt = ok(
        &library,
        "operation",
        json!({"library_id":add["library_id"],"operation_id":add["preview"]["request"]["operation_id"]}),
    );
    assert_eq!(receipt["outcome"], "committed");
    assert_eq!(receipt["receipt"]["preview"], add["preview"]);
    let replay = ok(&library, "commit", commit_body(&add));
    assert_eq!(replay["replayed"], true);
    assert_eq!(replay["generation"], 5);
    assert_eq!(
        in_pack(&library, "active", &first)["rows"][0]["packs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["collection_id"] == first)
            .unwrap()["name"],
        "整理后的曲包"
    );
    // Global Trash still captures both imported and custom edges; restore in a new process.
    let trash = plan(&library, "trash_songs", selected.clone(), Value::Null);
    assert_eq!(trash["summary"]["removed_membership_count"], 4);
    ok(&library, "commit", commit_body(&trash));
    assert_eq!(in_pack(&library, "active", &first)["total"], 0);
    assert_eq!(in_pack(&library, "trash", &first)["total"], 2);
    let restore = plan(
        &library,
        "restore_songs",
        selected,
        trash["preview"]["request"]["operation_id"].clone(),
    );
    fs::write(
        f.base.join("owned-request.json"),
        serde_json::to_vec(&commit_body(&restore)).unwrap(),
    )
    .unwrap();
    f.restart("restore", 7, 0);
    assert_eq!(in_pack(&library, "active", &first)["total"], 2);
    assert_eq!(in_pack(&library, "active", &empty)["total"], 0);
    assert_eq!(
        super::super::super::clean_package::asset(&library, clean_key, &loaded_media.handle)
            .unwrap(),
        media_before
    );
    assert_eq!(files(&f.root), before);
    assert_originals(&f.root, &before);
    if let Some(path) = std::env::var_os("WMC_USER_PACK_CONTRACT_OUT") {
        fs::write(
            path,
            serde_json::to_vec_pretty(
                &json!({"native_calls":NATIVE_CALLS.with(|calls|calls.borrow().clone())}),
            )
            .unwrap(),
        )
        .unwrap();
    }
}

#[test]
fn user_pack_admission_rejects_imported_targets_edited_and_stale_plans_and_unbounded_names() {
    let f = Fixture::new();
    let library = f.library();
    song_pack::import(
        &library,
        "original.json",
        &score("original-rejections"),
        true,
        false,
        None,
    )
    .unwrap();
    init(&library);
    let row = list(&library, "active")["rows"][0].clone();
    let imported = row["packs"][0]["collection_id"].clone();
    let id = row["edition_id"].clone();
    for (action, name, ids) in [
        ("rename_pack", json!("Forbidden"), vec![]),
        ("add_memberships", Value::Null, vec![id.clone()]),
    ] {
        let result = call(
            &library,
            "/api/library/catalog/preview",
            pack_request(&library, action, imported.clone(), name, ids),
        );
        assert_eq!(result.1["code"], "catalog_readonly_pack");
    }
    for name in [
        " ".to_owned(),
        "x".repeat(257),
        "曲".repeat(86),
        "line\nbreak".to_owned(),
    ] {
        assert_eq!(
            call(
                &library,
                "/api/library/catalog/preview",
                pack_request(&library, "create_pack", Value::Null, json!(name), vec![])
            )
            .1["code"],
            "catalog_invalid_request"
        );
    }
    let pack = create(&library, &"曲".repeat(85));
    let add = pack_plan(
        &library,
        "add_memberships",
        pack.clone(),
        Value::Null,
        vec![id.clone()],
    );
    let mut changed = commit_body(&add);
    changed["preview"]["request"]["action"]["pack_id"] = imported.clone();
    assert_eq!(
        call(&library, "/api/library/catalog/commit", changed).1["code"],
        "catalog_readonly_pack"
    );
    let rename = pack_plan(
        &library,
        "rename_pack",
        pack.clone(),
        json!("Exact new name"),
        vec![],
    );
    let mut changed = commit_body(&rename);
    changed["preview"]["request"]["action"]["name"] = json!("Edited after review");
    assert_eq!(
        call(&library, "/api/library/catalog/commit", changed).1["outcome"],
        "not_committed"
    );
    ok(&library, "commit", commit_body(&rename));
    assert_eq!(
        call(&library, "/api/library/catalog/commit", commit_body(&add)).1["code"],
        "catalog_stale"
    );
    assert_eq!(in_pack(&library, "active", &pack)["total"], 0);
    let duplicated = call(
        &library,
        "/api/library/catalog/preview",
        pack_request(
            &library,
            "add_memberships",
            pack.clone(),
            Value::Null,
            vec![id.clone(), id.clone()],
        ),
    );
    assert_eq!(duplicated.1["code"], "catalog_invalid_request");
    let excessive: Vec<_> = (0..1025)
        .map(|i| json!(format!("legacy:song-{i:064x}")))
        .collect();
    assert!(
        call(
            &library,
            "/api/library/catalog/preview",
            pack_request(
                &library,
                "add_memberships",
                pack.clone(),
                Value::Null,
                excessive
            )
        )
        .0 >= 400
    );
    for action in ["move_memberships", "trash_pack", "permanent_delete", "undo"] {
        assert_eq!(
            call(
                &library,
                "/api/library/catalog/preview",
                pack_request(
                    &library,
                    action,
                    pack.clone(),
                    Value::Null,
                    vec![id.clone()]
                )
            )
            .1["code"],
            "catalog_invalid_request"
        );
    }
    let page = ok(&library, "query", json!({"view":"packs","limit":1}));
    assert!(page["next_cursor"].is_string());
    assert_eq!(
        call(
            &library,
            "/api/library/catalog/query",
            json!({"view":"packs","limit":1,"search":"different","cursor":page["next_cursor"]})
        )
        .0,
        400
    );
    assert_eq!(
        call(
            &library,
            "/api/library/catalog/query",
            json!({"view":"packs","collection_id":pack})
        )
        .0,
        400
    );
    let pending = pack_plan(
        &library,
        "rename_pack",
        pack.clone(),
        json!("Cancelled preview"),
        vec![],
    );
    assert_eq!(
        ok(
            &library,
            "operation",
            json!({"library_id":pending["library_id"],"operation_id":pending["preview"]["request"]["operation_id"]})
        )["outcome"],
        "not_committed"
    );
    f.restart("check", 2, 0);
}

fn membership_request(
    library: &NativeLibrary,
    action: &str,
    source: Value,
    destination: Value,
    ids: Vec<Value>,
    operation: Value,
) -> Value {
    let mut request = pack_request(library, action, source, Value::Null, ids);
    request["destination_collection_id"] = destination;
    request["membership_operation_id"] = operation;
    request
}
fn membership_plan(
    library: &NativeLibrary,
    action: &str,
    source: Value,
    destination: Value,
    ids: Vec<Value>,
    operation: Value,
) -> Value {
    ok(
        library,
        "preview",
        membership_request(library, action, source, destination, ids, operation),
    )
}
fn edge_rows(library: &NativeLibrary) -> Vec<catalog::Membership> {
    journal::load(library)
        .unwrap()
        .unwrap()
        .catalog
        .snapshot()
        .inventory
        .memberships
        .clone()
}

#[test]
fn membership_move_and_undo_survive_restart_preserve_duplicate_destination_and_later_edits() {
    NATIVE_CALLS.with(|calls| calls.borrow_mut().clear());
    let f = Fixture::new();
    let library = f.library();
    song_pack::import(
        &library,
        "authored-memberships.zip",
        &zip(vec![
            ("first.json", score("original-membership-first")),
            ("second.json", score("original-membership-second")),
            ("later.json", score("original-membership-later")),
        ]),
        true,
        false,
        None,
    )
    .unwrap();
    fs::write(
        f.root.join("authored-practice-history"),
        b"Keep all practice history",
    )
    .unwrap();
    init(&library);
    let rows = list(&library, "active")["rows"].as_array().unwrap().clone();
    let ids: Vec<_> = rows
        .iter()
        .filter(|row| row["score_id"] != "original-membership-later")
        .map(|row| row["edition_id"].clone())
        .collect();
    let later_id = rows
        .iter()
        .find(|row| row["score_id"] == "original-membership-later")
        .unwrap()["edition_id"]
        .clone();
    let source = create(&library, "Original source pack");
    let destination = create(&library, "Destination pack");
    let other = create(&library, "Other references");
    for (pack, selection) in [
        (source.clone(), ids.clone()),
        (destination.clone(), vec![ids[0].clone()]),
        (other, ids.clone()),
    ] {
        let add = pack_plan(&library, "add_memberships", pack, Value::Null, selection);
        ok(&library, "commit", commit_body(&add));
    }
    let original_edges = edge_rows(&library);
    let original_files = files(&f.root);
    let moved = membership_plan(
        &library,
        "move_memberships",
        source.clone(),
        destination.clone(),
        ids.clone(),
        Value::Null,
    );
    assert_eq!(moved["summary"]["selected_count"], 2);
    assert_eq!(moved["summary"]["removed_membership_count"], 2);
    assert_eq!(moved["summary"]["added_membership_count"], 1);
    assert_eq!(moved["summary"]["unchanged_membership_count"], 1);
    assert_eq!(moved["summary"]["shared_song_count"], 2);
    assert_eq!(moved["summary"]["source_pack"]["collection_id"], source);
    assert_eq!(
        moved["summary"]["destination_pack"]["collection_id"],
        destination
    );
    assert_eq!(
        moved["preview"]["effects"]["removed_membership_snapshots"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let operation = moved["preview"]["request"]["operation_id"].clone();
    assert_eq!(moved["summary"]["undo_operation_id"], operation);
    ok(&library, "commit", commit_body(&moved));
    f.restart("check", 7, 0);
    let status = ok(&library, "status", json!({}));
    assert_eq!(status["membership_undo"]["operation_id"], operation);
    assert_eq!(status["membership_undo"]["can_undo"], true);
    assert_eq!(in_pack(&library, "active", &source)["total"], 0);
    assert_eq!(in_pack(&library, "active", &destination)["total"], 2);
    assert_eq!(
        ok(
            &library,
            "operation",
            json!({"library_id":status["library_id"],"operation_id":operation})
        )["receipt"]["preview"],
        moved["preview"]
    );
    let rename = pack_plan(
        &library,
        "rename_pack",
        source.clone(),
        json!("Keep later name"),
        vec![],
    );
    ok(&library, "commit", commit_body(&rename));
    let add = pack_plan(
        &library,
        "add_memberships",
        destination.clone(),
        Value::Null,
        vec![later_id.clone()],
    );
    ok(&library, "commit", commit_body(&add));
    f.restart("check", 9, 0);
    let status = ok(&library, "status", json!({}));
    assert_eq!(status["membership_undo"]["operation_id"], operation);
    assert_eq!(status["membership_undo"]["can_undo"], true);
    let undo = membership_plan(
        &library,
        "undo_memberships",
        Value::Null,
        Value::Null,
        vec![],
        operation.clone(),
    );
    assert_eq!(undo["summary"]["selected_count"], 2);
    assert_eq!(
        undo["summary"]["selected_edition_ids"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(undo["summary"]["target_pack"]["name"], "Keep later name");
    assert_eq!(undo["summary"]["removed_membership_count"], 1);
    fs::write(
        f.base.join("owned-request.json"),
        serde_json::to_vec(&commit_body(&undo)).unwrap(),
    )
    .unwrap();
    f.restart("restore", 10, 0);
    let final_edges = edge_rows(&library);
    for before in &original_edges {
        let after = final_edges
            .iter()
            .find(|edge| edge.id == before.id)
            .unwrap();
        assert_eq!(after.position, before.position);
        assert_eq!(after.added_at_unix_ms, before.added_at_unix_ms);
        if before.id.pack.as_str() == source.as_str().unwrap() {
            assert_eq!(after.revision, 10);
        } else {
            assert_eq!(after, before);
        }
    }
    assert_eq!(final_edges.len(), original_edges.len() + 1);
    assert_eq!(in_pack(&library, "active", &source)["total"], 2);
    let destination_rows = in_pack(&library, "active", &destination);
    assert_eq!(destination_rows["total"], 2);
    assert!(destination_rows["rows"]
        .as_array()
        .unwrap()
        .iter()
        .any(|row| row["edition_id"] == later_id));
    assert!(ok(&library, "status", json!({}))["membership_undo"].is_null());
    assert_eq!(ok(&library, "commit", commit_body(&undo))["replayed"], true);
    assert_eq!(
        ok(&library, "commit", commit_body(&moved))["generation"],
        10
    );
    assert_eq!(files(&f.root), original_files);
    assert_originals(&f.root, &original_files);
    assert_eq!(
        call(
            &library,
            "/api/library/catalog/preview",
            membership_request(
                &library,
                "undo_memberships",
                Value::Null,
                Value::Null,
                vec![],
                operation
            )
        )
        .1["code"],
        "catalog_conflict"
    );
    if let Some(path) = std::env::var_os("WMC_MEMBERSHIP_PACK_CONTRACT_OUT") {
        fs::write(
            path,
            serde_json::to_vec_pretty(
                &json!({"native_calls":NATIVE_CALLS.with(|calls|calls.borrow().clone())}),
            )
            .unwrap(),
        )
        .unwrap();
    }
}

#[test]
fn membership_admission_and_noops_reject_missing_imported_duplicate_stale_and_edited_selection() {
    let f = Fixture::new();
    let library = f.library();
    song_pack::import(
        &library,
        "original-member.json",
        &score("original-member"),
        true,
        false,
        None,
    )
    .unwrap();
    init(&library);
    let row = list(&library, "active")["rows"][0].clone();
    let id = row["edition_id"].clone();
    let imported = row["packs"][0]["collection_id"].clone();
    let source = create(&library, "Source");
    let destination = create(&library, "Destination");
    let absent = membership_plan(
        &library,
        "remove_memberships",
        source.clone(),
        Value::Null,
        vec![id.clone()],
        Value::Null,
    );
    assert_eq!(absent["summary"]["noop_membership_count"], 1);
    assert!(absent["summary"]["undo_operation_id"].is_null());
    ok(&library, "commit", commit_body(&absent));
    assert!(ok(&library, "status", json!({}))["membership_undo"].is_null());
    let add = pack_plan(
        &library,
        "add_memberships",
        source.clone(),
        Value::Null,
        vec![id.clone()],
    );
    ok(&library, "commit", commit_body(&add));
    let same = membership_plan(
        &library,
        "move_memberships",
        source.clone(),
        source.clone(),
        vec![id.clone()],
        Value::Null,
    );
    assert_eq!(
        same["preview"]["effects"]["noops"][0]["reason"],
        "same_pack"
    );
    ok(&library, "commit", commit_body(&same));
    assert!(ok(&library, "status", json!({}))["membership_undo"].is_null());
    for (action, from, to, selection, code) in [
        (
            "remove_memberships",
            imported.clone(),
            Value::Null,
            vec![id.clone()],
            "catalog_readonly_pack",
        ),
        (
            "move_memberships",
            imported.clone(),
            destination.clone(),
            vec![id.clone()],
            "catalog_readonly_pack",
        ),
        (
            "move_memberships",
            source.clone(),
            imported,
            vec![id.clone()],
            "catalog_readonly_pack",
        ),
        (
            "move_memberships",
            source.clone(),
            Value::Null,
            vec![id.clone()],
            "catalog_invalid_request",
        ),
        (
            "move_memberships",
            source.clone(),
            json!(format!("collection-{:032x}", 999)),
            vec![id.clone()],
            "catalog_not_found",
        ),
        (
            "move_memberships",
            destination.clone(),
            source.clone(),
            vec![id.clone()],
            "catalog_not_found",
        ),
        (
            "remove_memberships",
            source.clone(),
            Value::Null,
            vec![id.clone(), id.clone()],
            "catalog_invalid_request",
        ),
        (
            "move_memberships",
            source.clone(),
            destination.clone(),
            vec![id.clone(), id.clone()],
            "catalog_invalid_request",
        ),
    ] {
        assert_eq!(
            call(
                &library,
                "/api/library/catalog/preview",
                membership_request(&library, action, from, to, selection, Value::Null)
            )
            .1["code"],
            code
        );
    }
    let moved = membership_plan(
        &library,
        "move_memberships",
        source.clone(),
        destination.clone(),
        vec![id.clone()],
        Value::Null,
    );
    let mut edited = commit_body(&moved);
    edited["preview"]["effects"]["removed_membership_snapshots"][0]["position"] = json!(999);
    assert_eq!(
        call(&library, "/api/library/catalog/commit", edited).1["code"],
        "catalog_conflict"
    );
    let rename = pack_plan(
        &library,
        "rename_pack",
        destination.clone(),
        json!("Later"),
        vec![],
    );
    ok(&library, "commit", commit_body(&rename));
    assert_eq!(
        call(&library, "/api/library/catalog/commit", commit_body(&moved)).1["code"],
        "catalog_stale"
    );
    assert_eq!(in_pack(&library, "active", &source)["total"], 1);
    assert_eq!(in_pack(&library, "active", &destination)["total"], 0);
    let removed = membership_plan(
        &library,
        "remove_memberships",
        source.clone(),
        Value::Null,
        vec![id.clone()],
        Value::Null,
    );
    ok(&library, "commit", commit_body(&removed));
    let undo = membership_plan(
        &library,
        "undo_memberships",
        Value::Null,
        Value::Null,
        vec![],
        removed["summary"]["undo_operation_id"].clone(),
    );
    ok(&library, "commit", commit_body(&undo));
    assert_eq!(in_pack(&library, "active", &source)["total"], 1);
    let moved = membership_plan(
        &library,
        "move_memberships",
        source.clone(),
        destination,
        vec![id.clone()],
        Value::Null,
    );
    ok(&library, "commit", commit_body(&moved));
    let add_back = pack_plan(
        &library,
        "add_memberships",
        source.clone(),
        Value::Null,
        vec![id],
    );
    ok(&library, "commit", commit_body(&add_back));
    assert_eq!(
        ok(&library, "status", json!({}))["membership_undo"]["can_undo"],
        false
    );
    assert_eq!(
        call(
            &library,
            "/api/library/catalog/preview",
            membership_request(
                &library,
                "undo_memberships",
                Value::Null,
                Value::Null,
                vec![],
                moved["summary"]["undo_operation_id"].clone()
            )
        )
        .1["code"],
        "catalog_conflict"
    );
    let mut conflict = commit_body(&moved);
    conflict["preview"]["request"]["action"]["from_pack"] = source;
    conflict["preview"]["request"]["at_unix_ms"] = json!(0);
    assert_eq!(
        call(&library, "/api/library/catalog/commit", conflict).1["code"],
        "catalog_conflict"
    );
}

#[test]
fn user_pack_counts_missing_payloads_and_sync_preserve_existing_organization() {
    let f = Fixture::new();
    let library = f.library();
    let original = score("original-sync");
    let report =
        song_pack::import(&library, "original.json", &original, true, false, None).unwrap();
    init(&library);
    let row = list(&library, "active")["rows"][0].clone();
    let id = row["edition_id"].clone();
    let pack = create(&library, "Keep organization");
    let add = pack_plan(
        &library,
        "add_memberships",
        pack.clone(),
        Value::Null,
        vec![id.clone()],
    );
    ok(&library, "commit", commit_body(&add));
    let reimport =
        song_pack::import(&library, "reimport.json", &original, true, false, None).unwrap();
    assert_eq!(reimport.summary["duplicate"], 1);
    song_pack::import(
        &library,
        "new.json",
        &score("original-new"),
        true,
        false,
        None,
    )
    .unwrap();
    let status = ok(&library, "status", json!({}));
    let sync = ok(
        &library,
        "sync/preview",
        json!({"library_id":status["library_id"],"expected_generation":status["generation"],"catalog_digest":status["catalog_digest"]}),
    );
    ok(&library, "commit", commit_body(&sync));
    assert_eq!(in_pack(&library, "active", &pack)["total"], 1);
    let before = files(&f.root);
    let key = &report.items[0].entry.as_ref().unwrap().key;
    let path = f.root.join("songs").join(key).join("score.json");
    assert!(path.is_file());
    let saved = fs::read(&path).unwrap();
    fs::rename(&path, f.base.join("retained-unavailable-score.json")).unwrap();
    let missing = in_pack(&library, "active", &pack);
    assert_eq!(missing["rows"][0]["physical_available"], false);
    let packs = list(&library, "packs");
    let own = packs["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["collection_id"] == pack)
        .unwrap();
    assert_eq!(own["active_song_count"], 1);
    assert_eq!(own["available_song_count"], 0);
    let blocked = call(
        &library,
        "/api/library/catalog/preview",
        pack_request(
            &library,
            "add_memberships",
            pack.clone(),
            Value::Null,
            vec![id],
        ),
    );
    assert_eq!(blocked.1["code"], "catalog_recovery_required");
    assert_eq!(ok(&library, "status", json!({}))["generation"], 3);
    fs::write(&path, saved).unwrap();
    assert_eq!(files(&f.root), before);
    f.restart("check", 3, 0);
}
