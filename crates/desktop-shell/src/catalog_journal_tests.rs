//! Authored native integration tests; no default/user/release corpus is opened.
use super::*;
use crate::catalog::{
    Action, Membership, MembershipId, Pack, PackId, PackKind, Request, Seed, Song, SongId,
};
use std::{process::Command, sync::atomic::AtomicU64, time::Instant};

static ROOT_SEQUENCE: AtomicU64 = AtomicU64::new(0);
struct Fixture {
    base: PathBuf,
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let base = std::env::temp_dir().join(format!(
            "wmc-authored-catalog-{}-{}",
            std::process::id(),
            ROOT_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&base).unwrap();
        let root = base.join("library");
        let library = NativeLibrary::open(&root).unwrap();
        fs::write(base.join("outside-sentinel"), b"outside must remain exact").unwrap();
        for (name, bytes) in [
            ("songs/authored.payload", b"authored primary".as_slice()),
            ("backups/authored.payload", b"authored backup"),
            ("source-original", b"retained original source"),
        ] {
            fs::write(library.root.join(name), bytes).unwrap();
        }
        Self { base, root }
    }
    fn library(&self) -> NativeLibrary {
        NativeLibrary::open(&self.root).unwrap()
    }
    fn unchanged(&self) {
        assert_eq!(
            fs::read(self.base.join("outside-sentinel")).unwrap(),
            b"outside must remain exact"
        );
        for (name, bytes) in [
            ("songs/authored.payload", b"authored primary".as_slice()),
            ("backups/authored.payload", b"authored backup"),
            ("source-original", b"retained original source"),
        ] {
            assert_eq!(fs::read(self.root.join(name)).unwrap(), bytes);
        }
    }
    fn boot(&self) -> Loaded {
        initialize(&self.library(), seed(), op(0)).unwrap()
    }
    fn restart(&self, generation: u64, trash: usize) {
        let result = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "catalog_journal::tests::restart_probe",
                "--nocapture",
            ])
            .env("WMC_CATALOG_OWNED_TEST_ROOT", &self.root)
            .env("WMC_CATALOG_EXPECTED_GENERATION", generation.to_string())
            .env("WMC_CATALOG_EXPECTED_TRASH", trash.to_string())
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
        self.unchanged();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.unchanged();
        fs::remove_dir_all(&self.base).unwrap();
    }
}
fn op(n: u32) -> OperationId {
    OperationId::parse(format!("operation-{n:032x}")).unwrap()
}
fn song(n: u32) -> SongId {
    SongId::parse(format!(
        "{}:song-{n:064x}",
        if n.is_multiple_of(2) {
            "clean"
        } else {
            "legacy"
        }
    ))
    .unwrap()
}
fn pack(n: u32) -> PackId {
    PackId::parse(format!("collection-{n:032x}")).unwrap()
}
fn seed() -> Catalog {
    Catalog::from_seed(Seed {
        songs: (1..=3)
            .map(|n| Song {
                id: song(n),
                retained_bytes: 17,
                revision: 0,
                trashed_by: None,
            })
            .collect(),
        packs: (1..=2)
            .map(|n| Pack {
                id: pack(n),
                name: format!("Authored pack {n}"),
                kind: PackKind::Custom,
                source_archive_keys: vec![],
                origin_import_operation_id: None,
                revision: 0,
                trashed_by: None,
            })
            .collect(),
        memberships: (1..=2)
            .flat_map(|p| {
                (1..=3).map(move |s| Membership {
                    id: MembershipId {
                        pack: pack(p),
                        song: song(s),
                    },
                    position: s,
                    added_at_unix_ms: 1,
                    revision: 0,
                })
            })
            .collect(),
        sources: vec![],
        origins: vec![],
    })
    .unwrap()
}
fn plan(current: &Catalog, id: u32, action: Action) -> Preview {
    current
        .preview(Request {
            schema_version: catalog::VERSION,
            operation_id: op(id),
            expected_generation: current.snapshot().generation,
            at_unix_ms: 100 + id as u64,
            action,
        })
        .unwrap()
}
fn trash(current: &Catalog) -> Preview {
    plan(
        current,
        1,
        Action::TrashSongs {
            song_ids: vec![song(1), song(2)],
        },
    )
}
fn injected() -> Error {
    Error::Recovery("authored injected interruption")
}
fn fail_at(target: Boundary, occurrence: usize) -> impl FnMut(Boundary) -> Result<()> {
    let mut seen = 0;
    move |boundary| {
        if boundary == target {
            seen += 1;
            if seen == occurrence {
                return Err(injected());
            }
        }
        Ok(())
    }
}
fn assert_state(f: &Fixture, generation: u64, trash: usize) -> Loaded {
    let current = load(&f.library()).unwrap().unwrap();
    assert_eq!(current.catalog.snapshot().generation, generation);
    assert_eq!(
        current
            .catalog
            .snapshot()
            .inventory
            .songs
            .iter()
            .filter(|s| s.trashed_by.is_some())
            .count(),
        trash
    );
    assert_eq!(
        current.catalog.snapshot().inventory.memberships.len(),
        6 - trash * 2
    );
    f.unchanged();
    current
}
#[test]
fn restart_probe() {
    let Some(root) = std::env::var_os("WMC_CATALOG_OWNED_TEST_ROOT") else {
        return;
    };
    let root = PathBuf::from(root);
    // Only an explicitly supplied freshly authored fixture root can run this path.
    assert_eq!(
        fs::read(root.parent().unwrap().join("outside-sentinel")).unwrap(),
        b"outside must remain exact"
    );
    let current = load(&NativeLibrary::open(&root).unwrap()).unwrap().unwrap();
    assert_eq!(
        current.catalog.snapshot().generation,
        std::env::var("WMC_CATALOG_EXPECTED_GENERATION")
            .unwrap()
            .parse::<u64>()
            .unwrap()
    );
    assert_eq!(
        current
            .catalog
            .snapshot()
            .inventory
            .songs
            .iter()
            .filter(|s| s.trashed_by.is_some())
            .count(),
        std::env::var("WMC_CATALOG_EXPECTED_TRASH")
            .unwrap()
            .parse::<usize>()
            .unwrap()
    );
}
#[test]
fn entire_bulk_trash_recovers_at_every_native_publication_boundary() {
    let mut boundaries = vec![(Boundary::BeforeStage, 1), (Boundary::BeforeStage, 2)];
    for occurrence in [1, 2] {
        for name in FILES {
            boundaries.extend([
                (Boundary::BeforeFileWrite(name), occurrence),
                (Boundary::PartialFileWrite(name), occurrence),
                (Boundary::BeforeFileSync(name), occurrence),
                (Boundary::AfterFileSync(name), occurrence),
            ]);
        }
        boundaries.extend([
            (Boundary::BeforeStageSync, occurrence),
            (Boundary::AfterStageSync, occurrence),
        ]);
    }
    boundaries.push((Boundary::BeforeBackupRename, 1));
    let precommit = boundaries.len();
    boundaries.extend(
        [
            Boundary::AfterBackupRename,
            Boundary::AfterBackupParentSync,
            Boundary::BeforePrimaryRename,
            Boundary::AfterPrimaryRename,
            Boundary::AfterPrimaryParentSync,
            Boundary::BeforeResponse,
        ]
        .into_iter()
        .map(|b| (b, 1)),
    );
    for (index, (boundary, occurrence)) in boundaries.into_iter().enumerate() {
        let f = Fixture::new();
        let initial = f.boot();
        let preview = trash(&initial.catalog);
        let error =
            commit_with(&f.library(), &preview, &mut fail_at(boundary, occurrence)).unwrap_err();
        let committed = index >= precommit;
        assert_eq!(
            error.outcome,
            if committed {
                Outcome::CommitUncertain
            } else {
                Outcome::NotCommitted
            },
            "{boundary:?}/{occurrence}"
        );
        // Fresh executable validates and performs recovery before this process reads.
        f.restart(u64::from(committed), if committed { 2 } else { 0 });
        let before_retry = usage(&f.root).unwrap();
        if boundary != Boundary::BeforeStage || occurrence != 1 {
            assert!(before_retry.stages > 0 || committed);
        }
        let replay = commit(&f.library(), &preview).unwrap();
        assert_eq!(replay.replayed, committed);
        assert_eq!(replay.receipt.preview, preview);
        assert_state(&f, 1, 2);
        f.restart(1, 2);
    }
}
#[test]
fn initialization_markers_never_turn_damage_into_a_fresh_library() {
    for boundary in [
        Boundary::BeforeFormatWrite("catalog-backups"),
        Boundary::AfterFormatSync("catalog-backups"),
        Boundary::BeforeFormatWrite("catalog"),
        Boundary::AfterFormatSync("catalog"),
        Boundary::BeforeRootSync,
        Boundary::AfterRootSync,
        Boundary::BeforeStage,
        Boundary::PartialFileWrite("state.json"),
        Boundary::BeforeBackupRename,
        Boundary::AfterBackupRename,
        Boundary::BeforeResponse,
    ] {
        let f = Fixture::new();
        assert!(load(&f.library()).unwrap().is_none());
        let error =
            initialize_with(&f.library(), seed(), op(0), &mut fail_at(boundary, 1)).unwrap_err();
        let decided = matches!(
            boundary,
            Boundary::AfterBackupRename | Boundary::BeforeResponse
        );
        assert_eq!(
            error.outcome,
            if decided {
                Outcome::CommitUncertain
            } else {
                Outcome::NotCommitted
            }
        );
        let complete_markers = !matches!(
            boundary,
            Boundary::BeforeFormatWrite(_) | Boundary::AfterFormatSync("catalog-backups")
        );
        if !complete_markers {
            assert!(load(&f.library()).is_err());
            assert!(initialize(&f.library(), seed(), op(0)).is_err()); // explicit manual repair, no reset
        } else {
            if !decided {
                assert!(load(&f.library()).is_err());
            }
            initialize(&f.library(), seed(), op(0)).unwrap();
            f.restart(0, 0);
        }
    }
    let f = Fixture::new();
    initialize_with(
        &f.library(),
        seed(),
        op(0),
        &mut fail_at(Boundary::AfterBackupRename, 1),
    )
    .unwrap_err();
    fs::remove_file(f.root.join("catalog/format.json")).unwrap();
    fs::remove_file(f.root.join("catalog-backups/format.json")).unwrap();
    assert!(load(&f.library()).is_err());
    assert_eq!(
        initialize(&f.library(), seed(), op(0)).unwrap_err().outcome,
        Outcome::CommitUncertain
    );
}
#[test]
fn durable_receipt_replay_never_rewinds_later_work() {
    let f = Fixture::new();
    let initial = f.boot();
    let old = trash(&initial.catalog);
    let first = commit(&f.library(), &old).unwrap();
    let rename = plan(
        &first.catalog,
        2,
        Action::RenamePack {
            pack_id: pack(2),
            name: "Newer pack name".into(),
        },
    );
    let later = commit(&f.library(), &rename).unwrap();
    let replay = commit(&f.library(), &old).unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.catalog, later.catalog);
    assert_eq!(lookup(&f.library(), &op(1)).unwrap(), Some(first.receipt));
    let mut forged = old.clone();
    forged.plan_digest = "forged".into();
    let error = commit(&f.library(), &forged).unwrap_err();
    assert_eq!(error.outcome, Outcome::CommitUncertain);
    assert!(matches!(
        error.cause,
        Error::Core(catalog::Error::InvalidPlan)
    ));
    let mut changed = old;
    changed.request.at_unix_ms += 1;
    assert!(matches!(
        commit(&f.library(), &changed).unwrap_err().cause,
        Error::Core(catalog::Error::IdempotencyConflict)
    ));
    let reinitialized = initialize(&f.library(), seed(), op(0)).unwrap();
    assert_eq!(reinitialized.catalog, later.catalog);
    f.restart(2, 2);
}
fn paths(f: &Fixture, area: &str) -> Vec<PathBuf> {
    children(&f.root.join(area).join("commits"), MAX_GENERATIONS).unwrap()
}
#[test]
fn corrupt_latest_conflicts_gaps_and_unknown_versions_stop_without_repair_or_rollback() {
    for corruption in 0..9 {
        let f = Fixture::new();
        let initial = f.boot();
        let first = commit(&f.library(), &trash(&initial.catalog)).unwrap();
        commit(
            &f.library(),
            &plan(
                &first.catalog,
                2,
                Action::RenamePack {
                    pack_id: pack(1),
                    name: "Later".into(),
                },
            ),
        )
        .unwrap();
        let primary = paths(&f, "catalog");
        let backup = paths(&f, "catalog-backups");
        match corruption {
            0 => {
                fs::write(backup[2].join("state.json"), b"corrupt newest").unwrap();
            }
            1 => {
                fs::remove_dir_all(&backup[1]).unwrap();
                fs::remove_dir_all(&primary[1]).unwrap();
            }
            2 => {
                let mut info: Manifest =
                    parse(&fs::read(backup[2].join("manifest.json")).unwrap()).unwrap();
                info.version = 99;
                fs::write(backup[2].join("manifest.json"), json(&info).unwrap()).unwrap();
            }
            3 => {
                fs::write(primary[2].join("receipt.json"), b"conflicting primary").unwrap();
            }
            4 => {
                fs::remove_dir_all(&backup[2]).unwrap();
            }
            5 => {
                fs::remove_file(f.root.join("catalog/format.json")).unwrap();
            }
            6 => {
                fs::write(
                    f.root.join("catalog-backups/format.json"),
                    br#"{"version":99,"genesis_manifest_sha256":"wrong"}"#,
                )
                .unwrap();
            }
            7 => {
                fs::create_dir(
                    f.root
                        .join("catalog-backups/commits/00000000000000000003-operation-not-an-id"),
                )
                .unwrap();
            }
            8 => {
                let other =
                    backup[2]
                        .parent()
                        .unwrap()
                        .join(format!("{:020}-{}", 2, op(99).as_str()));
                fs::create_dir(&other).unwrap();
            }
            _ => unreachable!(),
        }
        // Removing an earlier primary is NOT repaired before a bad latest record is rejected.
        fs::remove_dir_all(&primary[0]).unwrap();
        assert!(load(&f.library()).is_err(), "corruption {corruption}");
        assert!(!primary[0].exists(), "repair must wait for the full chain");
        assert!(initialize(&f.library(), seed(), op(0)).is_err());
        f.unchanged();
    }
}
#[test]
fn recomputed_hashes_cannot_bind_an_unrelated_valid_snapshot_to_a_receipt() {
    let f = Fixture::new();
    let initial = f.boot();
    let first = commit(&f.library(), &trash(&initial.catalog)).unwrap();
    let changed_plan = plan(
        &initial.catalog,
        1,
        Action::TrashSongs {
            song_ids: vec![song(3)],
        },
    );
    let wrong = initial.catalog.apply(&changed_plan).unwrap();
    assert_ne!(wrong.catalog, first.catalog);
    for area in ["catalog", "catalog-backups"] {
        let path = paths(&f, area).pop().unwrap();
        let mut generation = read_generation(&path).unwrap();
        generation.state = json(wrong.catalog.snapshot()).unwrap();
        generation.info.state = file_digest(&generation.state);
        fs::write(path.join("state.json"), &generation.state).unwrap();
        fs::write(path.join("manifest.json"), json(&generation.info).unwrap()).unwrap();
    }
    assert!(load(&f.library()).is_err());
}
#[test]
fn quota_counts_both_copies_and_partial_stages_before_any_publication() {
    let f = Fixture::new();
    let initial = f.boot();
    // Sparse authored staging files exercise the 256 MiB logical quota without
    // consuming scarce test disk or ever deleting preserved stages automatically.
    for n in 0..16 {
        let stage = f
            .root
            .join(".catalog-staging")
            .join(format!("stage-authored-{n}"));
        fs::create_dir(&stage).unwrap();
        let file = fs::File::create(stage.join("state.json")).unwrap();
        file.set_len(catalog::MAX_STATE_BYTES as u64).unwrap();
    }
    assert!(matches!(load(&f.library()), Err(Error::Capacity)));
    let error = commit(&f.library(), &trash(&initial.catalog)).unwrap_err();
    assert_eq!(error.outcome, Outcome::CommitUncertain); // Over-quota history cannot be fully verified.
    assert_eq!(paths(&f, "catalog-backups").len(), 1);
    assert_eq!(
        children(&f.root.join(".catalog-staging"), MAX_COPIES)
            .unwrap()
            .len(),
        16
    );
}
#[test]
fn incomplete_stage_alone_is_not_a_committed_or_managed_catalog() {
    let f = Fixture::new();
    let staged = f.root.join(".catalog-staging/stage-authored-0");
    fs::create_dir_all(&staged).unwrap();
    fs::write(staged.join("state.json"), b"partial").unwrap();
    assert!(load(&f.library()).unwrap().is_none());
    let initialized = f.boot();
    assert_eq!(initialized.preserved_stages, 1);
    assert_eq!(fs::read(staged.join("state.json")).unwrap(), b"partial");
}
#[cfg(unix)]
#[test]
fn symlinked_catalog_nodes_never_touch_outside_sentinel() {
    use std::os::unix::fs::symlink;
    for location in [
        "catalog",
        "catalog-backups",
        ".catalog-staging",
        "catalog/format.json",
        "catalog-backups/commits",
        ".catalog-staging/stage-authored-0",
    ] {
        let f = Fixture::new();
        if location.contains('/') {
            f.boot();
        }
        let target = f.root.join(location);
        if target.is_dir() {
            fs::remove_dir_all(&target).unwrap();
        } else if target.exists() {
            fs::remove_file(&target).unwrap();
        }
        symlink(f.base.join("outside-sentinel"), &target).unwrap();
        assert!(load(&f.library()).is_err(), "{location}");
        f.unchanged();
    }
}
#[test]
fn same_process_handles_share_the_native_gate_and_stale_previews_fail() {
    let f = Fixture::new();
    let initial = f.boot();
    let preview = trash(&initial.catalog);
    let stale = plan(
        &initial.catalog,
        2,
        Action::RenamePack {
            pack_id: pack(1),
            name: "Stale".into(),
        },
    );
    let first = f.library();
    let second = f.library();
    let gate = first.lock().unwrap();
    let handle = std::thread::spawn(move || commit(&second, &preview));
    drop(gate);
    handle.join().unwrap().unwrap();
    assert!(matches!(
        commit(&first, &stale).unwrap_err().cause,
        Error::Core(catalog::Error::Stale)
    ));
    assert_state(&f, 1, 2);
}

#[test]
fn publication_capacity_reserves_both_independent_copies_with_existing_staging() {
    let f = Fixture::new();
    let initial = f.boot();
    let preview = trash(&initial.catalog);
    let applied = initial.catalog.apply(&preview).unwrap();
    let generation = Generation::new(
        applied.catalog,
        Record::Transition {
            receipt: Box::new(applied.receipt),
        },
        Some(initial.manifest_sha256),
    )
    .unwrap();
    let occupied = usage(&f.root).unwrap().bytes;
    // Leave room for one copy, but not for the required independent pair.
    let mut remaining = MAX_TRANSACTION_BYTES - occupied - generation.bytes();
    let mut count = 0;
    while remaining > 0 {
        let stage = f
            .root
            .join(".catalog-staging")
            .join(format!("stage-quota-{count}"));
        fs::create_dir(&stage).unwrap();
        let len = remaining.min(catalog::MAX_STATE_BYTES as u64);
        fs::File::create(stage.join("state.json"))
            .unwrap()
            .set_len(len)
            .unwrap();
        remaining -= len;
        count += 1;
    }
    assert!(load(&f.library()).unwrap().is_some());
    let error = commit(&f.library(), &preview).unwrap_err();
    assert!(matches!(error.cause, Error::Capacity));
    assert_eq!(error.outcome, Outcome::NotCommitted);
    assert_eq!(paths(&f, "catalog-backups").len(), 1);
    assert_eq!(usage(&f.root).unwrap().stages, count);
    f.restart(0, 0);
}

#[test]
fn bounded_nodes_and_sparse_oversized_files_are_rejected() {
    let u = Usage {
        bytes: MAX_TRANSACTION_BYTES,
        copies: MAX_COPIES,
        nodes: MAX_NODES,
        stages: 0,
    };
    assert!(u.check(0, 0).is_ok());
    assert!(u.check(1, 0).is_err());
    assert!(u.check(0, 1).is_err());
    for malformed in 0..3 {
        let f = Fixture::new();
        f.boot();
        let stage = f.root.join(".catalog-staging/stage-malformed");
        fs::create_dir(&stage).unwrap();
        match malformed {
            0 => fs::File::create(stage.join("state.json"))
                .unwrap()
                .set_len(catalog::MAX_STATE_BYTES as u64 + 1)
                .unwrap(),
            1 => fs::create_dir(stage.join("state.json")).unwrap(),
            _ => fs::write(stage.join("unexpected-file"), b"extra").unwrap(),
        }
        assert!(load(&f.library()).is_err());
    }
}

#[test]
fn fresh_process_native_lock_probe() {
    let Some(root) = std::env::var_os("WMC_CATALOG_LOCK_TEST_ROOT") else {
        return;
    };
    let root = PathBuf::from(root);
    assert_eq!(
        fs::read(root.parent().unwrap().join("outside-sentinel")).unwrap(),
        b"outside must remain exact"
    );
    let error = load(&NativeLibrary::open(root).unwrap()).unwrap_err();
    assert!(matches!(
        error,
        Error::Storage(LibraryError {
            code: "library_busy",
            ..
        })
    ));
}
#[test]
fn cross_process_read_uses_the_existing_nonblocking_os_lock() {
    let f = Fixture::new();
    f.boot();
    let library = f.library();
    let _lock = library.lock().unwrap();
    let status = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "catalog_journal::tests::fresh_process_native_lock_probe",
            "--nocapture",
        ])
        .env("WMC_CATALOG_LOCK_TEST_ROOT", &f.root)
        .status()
        .unwrap();
    assert!(status.success());
}

// Opt-in measurement: a maximum-song/pack/membership authored graph. Keep this
// separate from parallel fast tests because each full snapshot is several MiB.
#[test]
#[ignore = "bounded maximum-inventory storage/replay measurement; run explicitly with one test thread"]
fn maximum_inventory_snapshot_growth_and_replay_measurement() {
    let f = Fixture::new();
    let mut inventory = seed().snapshot().inventory.clone();
    inventory.songs = (1..=catalog::MAX_SONGS as u32)
        .map(|n| Song {
            id: song(n),
            retained_bytes: 17,
            revision: 0,
            trashed_by: None,
        })
        .collect();
    inventory.packs = (1..=catalog::MAX_PACKS as u32)
        .map(|n| Pack {
            id: pack(n),
            name: format!("Authored pack {n}"),
            kind: PackKind::Custom,
            source_archive_keys: vec![],
            origin_import_operation_id: None,
            revision: 0,
            trashed_by: None,
        })
        .collect();
    inventory.memberships = (1..=catalog::MAX_PACKS as u32)
        .flat_map(|p| {
            (1..=64).map(move |s| Membership {
                id: MembershipId {
                    pack: pack(p),
                    song: song(s),
                },
                position: s,
                added_at_unix_ms: 1,
                revision: 0,
            })
        })
        .collect();
    assert_eq!(inventory.memberships.len(), catalog::MAX_MEMBERSHIPS);
    let started = Instant::now();
    let mut current = initialize(&f.library(), Catalog::from_seed(inventory).unwrap(), op(0))
        .unwrap()
        .catalog;
    let seed_bytes = json(current.snapshot()).unwrap().len();
    for n in 1..=4 {
        let preview = plan(
            &current,
            n,
            Action::RenamePack {
                pack_id: pack(n),
                name: format!("Authored new name {n}"),
            },
        );
        current = commit(&f.library(), &preview).unwrap().catalog;
    }
    let publish_ms = started.elapsed().as_millis();
    let started = Instant::now();
    let loaded = load(&f.library()).unwrap().unwrap();
    let replay_ms = started.elapsed().as_millis();
    assert_eq!(loaded.catalog, current);
    let usage = usage(&f.root).unwrap();
    let current_bytes = json(current.snapshot()).unwrap().len();
    assert!(usage.bytes < MAX_TRANSACTION_BYTES);
    eprintln!("AUTHORED_MAX_GRAPH songs={} packs={} memberships={} generations=5 seed_bytes={seed_bytes} current_bytes={current_bytes} retained_journal_bytes={} initialization_plus_4_commits_ms={publish_ms} verified_replay_ms={replay_ms}", catalog::MAX_SONGS, catalog::MAX_PACKS, catalog::MAX_MEMBERSHIPS, usage.bytes);
    f.unchanged();
}

#[test]
fn busy_committed_retry_probe() {
    let Some(root) = std::env::var_os("WMC_CATALOG_BUSY_RETRY_ROOT") else {
        return;
    };
    let root = PathBuf::from(root);
    let preview: Preview =
        parse(&fs::read(root.parent().unwrap().join("authored-preview.json")).unwrap()).unwrap();
    let library = NativeLibrary::open(&root).unwrap();
    let error = commit(&library, &preview).unwrap_err();
    assert_eq!(error.outcome, Outcome::CommitUncertain);
    assert!(matches!(
        error.cause,
        Error::Storage(LibraryError {
            code: "library_busy",
            ..
        })
    ));
    assert_eq!(
        initialize(&library, seed(), op(0)).unwrap_err().outcome,
        Outcome::CommitUncertain
    );
}
#[test]
fn busy_retry_cannot_claim_an_already_committed_operation_is_not_committed() {
    let f = Fixture::new();
    let initial = f.boot();
    let preview = trash(&initial.catalog);
    commit(&f.library(), &preview).unwrap();
    fs::write(
        f.base.join("authored-preview.json"),
        json(&preview).unwrap(),
    )
    .unwrap();
    let library = f.library();
    let lock = library.lock().unwrap();
    let status = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "catalog_journal::tests::busy_committed_retry_probe",
            "--nocapture",
        ])
        .env("WMC_CATALOG_BUSY_RETRY_ROOT", &f.root)
        .status()
        .unwrap();
    assert!(status.success());
    drop(lock);
    assert!(commit(&library, &preview).unwrap().replayed);
}

#[test]
fn backup_decision_recovers_with_only_the_original_two_copy_quota() {
    let f = Fixture::new();
    let initial = f.boot();
    let preview = trash(&initial.catalog);
    let applied = initial.catalog.apply(&preview).unwrap();
    let generation = Generation::new(
        applied.catalog,
        Record::Transition {
            receipt: Box::new(applied.receipt),
        },
        Some(initial.manifest_sha256),
    )
    .unwrap();
    let mut remaining =
        MAX_TRANSACTION_BYTES - usage(&f.root).unwrap().bytes - generation.bytes() * 2;
    let mut count = 0;
    while remaining > 0 {
        let stage = f
            .root
            .join(".catalog-staging")
            .join(format!("stage-quota-{count}"));
        fs::create_dir(&stage).unwrap();
        let len = remaining.min(catalog::MAX_STATE_BYTES as u64);
        fs::File::create(stage.join("state.json"))
            .unwrap()
            .set_len(len)
            .unwrap();
        remaining -= len;
        count += 1;
    }
    assert_eq!(
        commit_with(
            &f.library(),
            &preview,
            &mut fail_at(Boundary::AfterBackupRename, 1)
        )
        .unwrap_err()
        .outcome,
        Outcome::CommitUncertain
    );
    assert_eq!(usage(&f.root).unwrap().bytes, MAX_TRANSACTION_BYTES);
    f.restart(1, 2);
    let current = load(&f.library()).unwrap().unwrap();
    assert_eq!(current.preserved_stages, count);
    assert_eq!(usage(&f.root).unwrap().bytes, MAX_TRANSACTION_BYTES);
    assert!(commit(&f.library(), &preview).unwrap().replayed);
}

#[test]
fn restore_is_a_durable_forward_transition_and_keeps_later_pack_edits() {
    let f = Fixture::new();
    let initial = f.boot();
    let first = commit(&f.library(), &trash(&initial.catalog)).unwrap();
    let renamed = commit(
        &f.library(),
        &plan(
            &first.catalog,
            2,
            Action::RenamePack {
                pack_id: pack(1),
                name: "Keep newer name".into(),
            },
        ),
    )
    .unwrap();
    let restore = plan(
        &renamed.catalog,
        3,
        Action::Restore {
            trash_operation_id: op(1),
            entities: vec![
                catalog::Entity::Song(song(1)),
                catalog::Entity::Song(song(2)),
            ],
            memberships: vec![],
        },
    );
    let restored = commit(&f.library(), &restore).unwrap();
    assert_eq!(
        restored.catalog.snapshot().inventory.packs[0].name,
        "Keep newer name"
    );
    assert_eq!(restored.receipt.preview.effects.reclaimed_bytes, 0);
    f.restart(3, 0);
    assert!(commit(&f.library(), &restore).unwrap().replayed);
}
#[test]
fn missing_primary_without_a_matching_stage_is_rebuilt_from_verified_backup() {
    let f = Fixture::new();
    let initial = f.boot();
    commit(&f.library(), &trash(&initial.catalog)).unwrap();
    let primary = paths(&f, "catalog").pop().unwrap();
    fs::remove_dir_all(&primary).unwrap();
    assert_eq!(usage(&f.root).unwrap().stages, 0);
    f.restart(1, 2);
    assert!(primary.is_dir());
    assert_eq!(usage(&f.root).unwrap().stages, 0);
}

#[test]
fn fully_marked_bootstrap_retry_repeats_ancestor_sync_before_publication() {
    let f = Fixture::new();
    assert_eq!(
        initialize_with(
            &f.library(),
            seed(),
            op(0),
            &mut fail_at(Boundary::BeforeRootSync, 1)
        )
        .unwrap_err()
        .outcome,
        Outcome::NotCommitted
    );
    assert!(read_format(&f.root).unwrap().is_some());
    // A second failure at the same hook proves resume did not skip ancestor sync.
    assert_eq!(
        initialize_with(
            &f.library(),
            seed(),
            op(0),
            &mut fail_at(Boundary::BeforeRootSync, 1)
        )
        .unwrap_err()
        .outcome,
        Outcome::NotCommitted
    );
    assert!(paths(&f, "catalog-backups").is_empty());
    initialize(&f.library(), seed(), op(0)).unwrap();
    f.restart(0, 0);
}

#[test]
fn damaged_history_never_turns_a_previously_committed_id_into_not_committed() {
    for erase_earlier_primary_too in [false, true] {
        let f = Fixture::new();
        let initial = f.boot();
        let preview = trash(&initial.catalog);
        let first = commit(&f.library(), &preview).unwrap();
        commit(
            &f.library(),
            &plan(
                &first.catalog,
                2,
                Action::RenamePack {
                    pack_id: pack(1),
                    name: "Later".into(),
                },
            ),
        )
        .unwrap();
        fs::remove_dir_all(&paths(&f, "catalog-backups")[1]).unwrap();
        if erase_earlier_primary_too {
            fs::remove_dir_all(&paths(&f, "catalog")[1]).unwrap();
        }
        assert_eq!(
            commit(&f.library(), &preview).unwrap_err().outcome,
            Outcome::CommitUncertain
        );
    }
    let f = Fixture::new();
    f.boot();
    fs::remove_dir_all(&paths(&f, "catalog-backups")[0]).unwrap();
    assert_eq!(
        initialize(&f.library(), seed(), op(0)).unwrap_err().outcome,
        Outcome::CommitUncertain
    );
}
