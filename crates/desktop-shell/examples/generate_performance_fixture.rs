//! Regenerate wholly authored consumer fixtures. Never accepts user music.
#[path = "../tests/support/performance_fixture.rs"]
mod performance_fixture;
use std::{collections::BTreeMap, fs, path::PathBuf};
use worldmusichub_desktop::native_library::{clean_package, NativeLibrary};
fn main() {
    let destination = PathBuf::from(std::env::args().nth(1).expect("output fixture directory"));
    fs::create_dir_all(&destination).unwrap();
    let files = performance_fixture::files(false);
    let inventory = files
        .iter()
        .map(|(p, b)| (p.clone(), (b.len() as u64, performance_fixture::hash(b))))
        .collect::<BTreeMap<_, _>>();
    let package =
        clean_package::parse(&files["metadata.json"], &files["score.json"], &inventory).unwrap();
    for (path, bytes) in &files {
        let path = destination.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }
    let root = std::env::temp_dir().join(format!(
        "wmh-authored-performance-generator-{}",
        std::process::id()
    ));
    let library = NativeLibrary::open(root.clone()).unwrap();
    let entry = clean_package::save(
        &library,
        &package,
        None,
        false,
        &mut |media: &clean_package::Media| Ok(files[&media.path].clone()),
    )
    .unwrap();
    let mut loaded = library.load(&entry.key).unwrap();
    loaded.entry.saved_at_unix_ms = 1_700_000_000_000;
    fs::write(
        destination.with_file_name("complete-performance-v2-native-open.json"),
        serde_json::to_vec_pretty(&loaded).unwrap(),
    )
    .unwrap();
    fs::remove_dir_all(root).unwrap();
}
