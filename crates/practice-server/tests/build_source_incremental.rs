//! Dependency-free Cargo probe: never launches the app, a server, or a GUI.
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "wmc-cargo-provenance-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        Self(root)
    }
    fn git(&self, args: &[&str]) -> String {
        let output = Command::new("git")
            .arg("-C")
            .arg(&self.0)
            .args(args)
            .output()
            .unwrap();
        assert!(output.status.success(), "fixture git {:?} failed", args);
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    }
    fn build(&self) -> (String, std::time::SystemTime, String) {
        let output = Command::new(std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into()))
            .args(["check", "--offline", "--locked", "-vv", "-j1"])
            .current_dir(&self.0)
            .env("CARGO_TARGET_DIR", self.0.join("target"))
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "fixture cargo check failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let generated = fs::read_dir(self.0.join("target/debug/build"))
            .unwrap()
            .map(|entry| entry.unwrap().path().join("out/build_identity.rs"))
            .find(|path| path.is_file())
            .expect("generated identity");
        (
            fs::read_to_string(&generated).unwrap(),
            fs::metadata(generated).unwrap().modified().unwrap(),
            String::from_utf8(output.stderr).unwrap(),
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn incremental_cargo_refreshes_head_dirty_untracked_restore_and_export() {
    let fixture = Fixture::new();
    fs::write(fixture.0.join("Cargo.toml"), "[package]\nname = \"original-identity-fixture\"\nversion = \"0.0.0\"\nedition = \"2021\"\n[lib]\npath = \"lib.rs\"\n").unwrap();
    fs::write(
        fixture.0.join("Cargo.lock"),
        "version = 4\n[[package]]\nname = \"original-identity-fixture\"\nversion = \"0.0.0\"\n",
    )
    .unwrap();
    fs::write(fixture.0.join(".gitignore"), "/target/\n").unwrap();
    fs::write(
        fixture.0.join("lib.rs"),
        "include!(concat!(env!(\"OUT_DIR\"), \"/build_identity.rs\"));\n",
    )
    .unwrap();
    fs::copy(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("build_source.rs"),
        fixture.0.join("build_source.rs"),
    )
    .unwrap();
    fs::write(fixture.0.join("build.rs"), "mod build_source; fn main() { build_source::emit(std::path::Path::new(&std::env::var(\"CARGO_MANIFEST_DIR\").unwrap()), std::path::Path::new(&std::env::var(\"OUT_DIR\").unwrap()), &std::env::var(\"TARGET\").unwrap()).unwrap(); }\n").unwrap();
    fixture.git(&["-c", "init.templateDir=", "init", "-q"]);
    fixture.git(&["config", "user.name", "Original identity fixture"]);
    fixture.git(&["config", "user.email", "fixture@example.invalid"]);
    fixture.git(&["config", "commit.gpgSign", "false"]);
    fixture.git(&["config", "core.hooksPath", ".git/no-hooks"]);
    fixture.git(&["add", "."]);
    fixture.git(&["commit", "-qm", "Original source"]);
    let (first, modified, _) = fixture.build();
    assert!(first.contains(&fixture.git(&["rev-parse", "HEAD"])));
    assert!(first.contains("SOURCE_STATUS: &str = \"clean\""));
    assert!(first.contains("SOURCE_COMMIT_COUNT: Option<u64> = Some(1)"));
    let (same, same_modified, second_log) = fixture.build();
    assert_eq!(same, first);
    assert_eq!(same_modified, modified);
    // Cargo may still invoke rustc after rerunning a build script; retaining
    // output mtime avoids needless generated-file changes, not all Cargo work.
    eprintln!("unchanged fixture Cargo output:\n{second_log}");
    fixture.git(&["commit", "--allow-empty", "-qm", "HEAD-only change"]);
    let (committed, _, _) = fixture.build();
    assert!(committed.contains(&fixture.git(&["rev-parse", "HEAD"])));
    assert!(committed.contains("SOURCE_COMMIT_COUNT: Option<u64> = Some(2)"));
    assert_ne!(committed, first);
    fs::write(
        fixture.0.join("lib.rs"),
        "pub const CHANGED: bool = true;\n",
    )
    .unwrap();
    assert!(fixture
        .build()
        .0
        .contains("SOURCE_STATUS: &str = \"dirty\""));
    fixture.git(&["restore", "lib.rs"]);
    assert_eq!(fixture.build().0, committed);
    fs::write(
        fixture.0.join("untracked-source.rs"),
        "original untracked fixture",
    )
    .unwrap();
    assert!(fixture
        .build()
        .0
        .contains("SOURCE_STATUS: &str = \"dirty\""));
    fs::remove_file(fixture.0.join("untracked-source.rs")).unwrap();
    assert_eq!(fixture.build().0, committed);
    fs::remove_dir_all(fixture.0.join(".git")).unwrap();
    let exported = fixture.build().0;
    assert!(exported.contains("SOURCE_SHA: Option<&str> = None"));
    assert!(exported.contains("SOURCE_COMMIT_COUNT: Option<u64> = None"));
    assert!(exported.contains("SOURCE_ERROR: Option<&str> = Some(\"git_metadata_missing\")"));
}
