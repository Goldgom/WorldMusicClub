//! Build-time Git facts. No source paths, Git errors, or mutable release files
//! are embedded. An exported source tree never borrows its parent repo's HEAD.
use std::{
    fs,
    io::{self, Read},
    path::Path,
    process::{Command, Stdio},
};

const MAX_GIT_OUTPUT: u64 = 64 * 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, PartialEq, Eq)]
pub struct SourceIdentity {
    pub sha: Option<String>,
    pub tree: Option<String>,
    pub count: Option<u64>,
    pub status: &'static str,
    pub error: Option<&'static str>,
}

fn unknown(error: &'static str) -> SourceIdentity {
    SourceIdentity {
        sha: None,
        tree: None,
        count: None,
        status: "unavailable",
        error: Some(error),
    }
}

fn git(root: &Path, args: &[&str]) -> Result<Vec<u8>, &'static str> {
    let mut command = Command::new("git");
    // Do not let a caller's relocated Git context label this workspace.
    for (name, _) in std::env::vars_os() {
        if name
            .to_str()
            .is_some_and(|name| name.to_ascii_uppercase().starts_with("GIT_"))
        {
            command.env_remove(name);
        }
    }
    let mut child = command
        .arg("--no-optional-locks")
        .arg("--no-replace-objects")
        .arg("-c")
        .arg("core.fsmonitor=false")
        .arg("-C")
        .arg(root)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "git_unavailable")?;
    let mut bytes = Vec::new();
    let result = child
        .stdout
        .take()
        .ok_or("git_command_failed")?
        .take(MAX_GIT_OUTPUT + 1)
        .read_to_end(&mut bytes);
    if result.is_err() || bytes.len() as u64 > MAX_GIT_OUTPUT {
        let _ = child.kill();
        let _ = child.wait();
        return Err("git_output_limit");
    }
    if !child.wait().map_err(|_| "git_command_failed")?.success() {
        return Err("git_command_failed");
    }
    Ok(bytes)
}

fn git_text(root: &Path, args: &[&str]) -> Result<String, &'static str> {
    String::from_utf8(git(root, args)?)
        .map(|text| text.trim().to_owned())
        .map_err(|_| "git_invalid_output")
}

fn object_id(value: &str) -> bool {
    matches!(value.len(), 40 | 64)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub fn collect(root: &Path) -> SourceIdentity {
    if !root.join(".git").exists() {
        return unknown("git_metadata_missing");
    }
    collect_git(root).unwrap_or_else(unknown)
}

fn collect_git(root: &Path) -> Result<SourceIdentity, &'static str> {
    let actual_root = git_text(root, &["rev-parse", "--show-toplevel"])?;
    if fs::canonicalize(root).ok() != fs::canonicalize(actual_root).ok()
        || fs::canonicalize(root).is_err()
    {
        return Err("git_root_mismatch");
    }
    let grafts = git_text(root, &["rev-parse", "--git-path", "info/grafts"])?;
    let grafts = Path::new(&grafts);
    let grafts = if grafts.is_absolute() {
        grafts.to_owned()
    } else {
        root.join(grafts)
    };
    if fs::metadata(grafts).is_ok_and(|metadata| metadata.len() != 0) {
        return Err("git_grafts_present");
    }
    // Git status deliberately skips these entries. Do not report clean source
    // when index flags can conceal bytes the compiler will actually consume.
    let entries = git(root, &["ls-files", "-v", "-z"])?;
    if entries.split(|byte| *byte == 0).any(|entry| {
        entry
            .first()
            .is_some_and(|tag| tag.is_ascii_lowercase() || *tag == b'S')
    }) {
        return Err("git_hidden_index_entries");
    }
    let sha = git_text(root, &["rev-parse", "--verify", "HEAD"])?;
    let tree = git_text(root, &["rev-parse", "--verify", &format!("{sha}^{{tree}}")])?;
    if !object_id(&sha) || !object_id(&tree) {
        return Err("git_invalid_output");
    }
    let shallow = git_text(root, &["rev-parse", "--is-shallow-repository"])?;
    let (count, error) = match shallow.as_str() {
        "true" => (None, Some("shallow_history")),
        "false" => {
            let count = git_text(root, &["rev-list", "--count", &sha])?
                .parse::<u64>()
                .ok()
                .filter(|count| *count > 0 && *count <= MAX_SAFE_INTEGER)
                .ok_or("git_invalid_count")?;
            (Some(count), None)
        }
        _ => return Err("git_invalid_output"),
    };
    let status = match git(
        root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=normal"],
    ) {
        Ok(bytes) if bytes.is_empty() => "clean",
        Ok(_) | Err("git_output_limit") => "dirty",
        Err(error) => return Err(error),
    };
    if git_text(root, &["rev-parse", "--verify", "HEAD"])? != sha {
        return Err("git_head_changed");
    }
    Ok(SourceIdentity {
        sha: Some(sha),
        tree: Some(tree),
        count,
        status,
        error,
    })
}

pub fn generated(source: &SourceIdentity, target: &str) -> String {
    format!(
        "pub const SOURCE_SHA: Option<&str> = {:?};\npub const SOURCE_TREE: Option<&str> = {:?};\npub const SOURCE_COMMIT_COUNT: Option<u64> = {:?};\npub const SOURCE_STATUS: &str = {:?};\npub const SOURCE_ERROR: Option<&str> = {:?};\npub const BUILD_TARGET: &str = {:?};\n",
        source.sha.as_deref(), source.tree.as_deref(), source.count,
        source.status, source.error, target,
    )
}

pub fn write_if_changed(path: &Path, bytes: &[u8]) -> io::Result<bool> {
    if fs::read(path).ok().as_deref() == Some(bytes) {
        return Ok(false);
    }
    fs::write(path, bytes)?;
    Ok(true)
}

pub fn emit(root: &Path, out: &Path, target: &str) -> io::Result<()> {
    // Cargo otherwise misses HEAD-only commits and changes in sibling crates.
    // A deliberately absent input reruns this small collector on every build;
    // unchanged generated constants retain their file modification time.
    // Cargo still invokes this crate's rustc after a build-script rerun. This
    // intentionally trades incremental build work for fresh provenance.
    let recheck = out.join("source-identity-always-recheck");
    if recheck.exists() {
        fs::remove_file(&recheck)?;
    }
    println!("cargo:rerun-if-changed={}", recheck.display());
    write_if_changed(
        &out.join("build_identity.rs"),
        generated(&collect(root), target).as_bytes(),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };
    static NEXT: AtomicU64 = AtomicU64::new(0);

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "wmc-build-source-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
        fn run(&self, args: &[&str]) -> String {
            let output = Command::new("git")
                .arg("-C")
                .arg(&self.0)
                .args(args)
                .output()
                .unwrap();
            assert!(output.status.success(), "git failed: {:?}", args);
            String::from_utf8(output.stdout).unwrap().trim().to_owned()
        }
        fn repo() -> Self {
            let fixture = Self::new();
            fixture.run(&["-c", "init.templateDir=", "init", "-q"]);
            fixture.run(&["config", "user.name", "Original diagnostic fixture"]);
            fixture.run(&["config", "user.email", "fixture@example.invalid"]);
            fixture.run(&["config", "commit.gpgSign", "false"]);
            fixture.run(&["config", "core.hooksPath", ".git/no-hooks"]);
            fs::write(fixture.0.join("fixture.txt"), "original source\n").unwrap();
            fixture.run(&["add", "."]);
            fixture.run(&["commit", "-qm", "Original fixture"]);
            fixture
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn exported_source_cannot_borrow_parent_git_or_build_info() {
        let outer = Fixture::repo();
        let exported = outer.0.join("exported");
        fs::create_dir(&exported).unwrap();
        fs::write(
            exported.join("BUILD-INFO.json"),
            "{\"source_sha\":\"pretend\",\"count\":545}",
        )
        .unwrap();
        assert_eq!(collect(&exported), unknown("git_metadata_missing"));
        let plain = Fixture::new();
        assert_eq!(collect(&plain.0), unknown("git_metadata_missing"));
    }

    #[test]
    fn commit_dirty_untracked_restore_and_shallow_are_truthful() {
        let fixture = Fixture::repo();
        let initial = collect(&fixture.0);
        assert_eq!(initial.status, "clean");
        assert_eq!(initial.count, Some(1));
        fixture.run(&["commit", "--allow-empty", "-qm", "HEAD-only change"]);
        let committed = collect(&fixture.0);
        assert_ne!(initial.sha, committed.sha);
        assert_eq!(initial.tree, committed.tree);
        assert_eq!(committed.count, Some(2));
        fs::write(fixture.0.join("fixture.txt"), "changed source\n").unwrap();
        assert_eq!(collect(&fixture.0).status, "dirty");
        fixture.run(&["restore", "fixture.txt"]);
        assert_eq!(collect(&fixture.0), committed);
        fs::write(fixture.0.join("untracked.rs"), "original extra source").unwrap();
        assert_eq!(collect(&fixture.0).status, "dirty");
        fs::remove_file(fixture.0.join("untracked.rs")).unwrap();
        assert_eq!(collect(&fixture.0), committed);
        fs::write(
            fixture.0.join(".git/shallow"),
            format!("{}\n", committed.sha.unwrap()),
        )
        .unwrap();
        let shallow = collect(&fixture.0);
        assert_eq!(shallow.status, "clean");
        assert_eq!(shallow.count, None);
        assert_eq!(shallow.error, Some("shallow_history"));
    }

    #[test]
    fn fake_nested_git_location_is_rejected() {
        let outer = Fixture::repo();
        let nested = outer.0.join("nested");
        fs::create_dir(&nested).unwrap();
        fs::write(nested.join(".git"), "gitdir: ../.git\n").unwrap();
        // Explicit worktree settings must not turn outer HEAD into nested source.
        outer.run(&["config", "core.worktree", outer.0.to_str().unwrap()]);
        assert_eq!(collect(&nested), unknown("git_root_mismatch"));
    }

    #[test]
    fn identical_generated_identity_preserves_output_file() {
        let fixture = Fixture::new();
        let output = fixture.0.join("identity.rs");
        let value = generated(&unknown("git_metadata_missing"), "original-test-target");
        assert!(write_if_changed(&output, value.as_bytes()).unwrap());
        let modified = fs::metadata(&output).unwrap().modified().unwrap();
        assert!(!write_if_changed(&output, value.as_bytes()).unwrap());
        assert_eq!(fs::metadata(&output).unwrap().modified().unwrap(), modified);
        assert!(value.contains("SOURCE_SHA: Option<&str> = None"));
        assert!(value.contains("SOURCE_COMMIT_COUNT: Option<u64> = None"));
    }

    #[test]
    fn replacement_refs_do_not_relabel_the_real_head_tree_or_count() {
        let fixture = Fixture::repo();
        let first = collect(&fixture.0);
        fs::write(fixture.0.join("fixture.txt"), "second original commit\n").unwrap();
        fixture.run(&["commit", "-qam", "Second fixture"]);
        let second = collect(&fixture.0);
        fixture.run(&[
            "replace",
            second.sha.as_ref().unwrap(),
            first.sha.as_ref().unwrap(),
        ]);
        assert_eq!(collect(&fixture.0), second);
    }

    #[test]
    fn hidden_index_flags_and_grafts_are_not_clean_provenance() {
        let fixture = Fixture::repo();
        fixture.run(&["update-index", "--assume-unchanged", "fixture.txt"]);
        fs::write(fixture.0.join("fixture.txt"), "hidden mutation\n").unwrap();
        assert_eq!(collect(&fixture.0), unknown("git_hidden_index_entries"));
        fixture.run(&["update-index", "--no-assume-unchanged", "fixture.txt"]);
        fixture.run(&["update-index", "--skip-worktree", "fixture.txt"]);
        assert_eq!(collect(&fixture.0), unknown("git_hidden_index_entries"));
        fixture.run(&["update-index", "--no-skip-worktree", "fixture.txt"]);
        fs::create_dir_all(fixture.0.join(".git/info")).unwrap();
        fs::write(fixture.0.join(".git/info/grafts"), "unsupported rewrite\n").unwrap();
        assert_eq!(collect(&fixture.0), unknown("git_grafts_present"));
    }
}
