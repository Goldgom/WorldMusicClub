//! Reproduce both original acceptance fixtures through the actual native library.
#[path = "../tests/support/performance_acceptance_fixture.rs"]
mod fixture;
use std::{collections::BTreeMap, fs, path::PathBuf};
use worldmusichub_desktop::native_library::{clean_package, NativeLibrary};

fn main() {
    let destination = PathBuf::from(std::env::args().nth(1).expect("output fixture directory"));
    fs::create_dir_all(&destination).unwrap();
    let root = std::env::temp_dir().join(format!(
        "wmh-authored-performance-acceptance-generator-{}",
        std::process::id()
    ));
    fs::create_dir(&root).expect("fresh native generation root");
    let library = NativeLibrary::open(root.join("Scores")).unwrap();
    for name in fixture::FIXTURES {
        let files = fixture::files(name);
        let inventory = files
            .iter()
            .map(|(path, bytes)| (path.clone(), (bytes.len() as u64, fixture::hash(bytes))))
            .collect::<BTreeMap<_, _>>();
        let package =
            clean_package::parse(&files["metadata.json"], &files["score.json"], &inventory)
                .unwrap();
        fs::create_dir_all(destination.join(name)).unwrap();
        for (path, bytes) in &files {
            fs::write(destination.join(name).join(path), bytes).unwrap();
        }
        let entry = clean_package::save(
            &library,
            &package,
            None,
            false,
            &mut |_media: &clean_package::Media| {
                panic!("Acceptance fixtures intentionally have no media")
            },
        )
        .unwrap();
        let mut loaded = library.load(&entry.key).unwrap();
        loaded.entry.saved_at_unix_ms = fixture::SAVED_AT_UNIX_MS;
        assert!(loaded.score_json.is_none());
        fs::write(
            destination.join(format!("{name}-native-open.json")),
            serde_json::to_vec_pretty(&loaded).unwrap(),
        )
        .unwrap();
    }
    assert_eq!(library.list().unwrap().entries.len(), 2);
    drop(library);
    fs::remove_dir_all(root).unwrap();
}
