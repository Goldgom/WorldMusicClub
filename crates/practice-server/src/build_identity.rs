//! Explicit, read-only diagnostics. The digest is a cached disk-file snapshot
//! at the OS-reported executable path, never a claim about loaded memory bytes.
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

mod compiled {
    include!(concat!(env!("OUT_DIR"), "/build_identity.rs"));
}

pub const ROUTE: &str = "/api/diagnostics/build";
const MAX_EXECUTABLE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_PATH_CHARS: usize = 4096;
static EXECUTABLE: OnceLock<ExecutableSnapshot> = OnceLock::new();

#[derive(Clone, Debug, Serialize)]
struct ExecutableIdentity {
    executable_path: Option<String>,
    executable_sha256: Option<String>,
    executable_bytes: Option<u64>,
    executable_hash_status: &'static str,
    executable_error: Option<&'static str>,
    executable_checked_at_unix_ms: Option<u64>,
    executable_hash_scope: &'static str,
    executable_cache: &'static str,
}

impl ExecutableIdentity {
    fn new() -> Self {
        Self {
            executable_path: None,
            executable_sha256: None,
            executable_bytes: None,
            executable_hash_status: "unavailable",
            executable_error: None,
            executable_checked_at_unix_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .ok()
                .and_then(|duration| u64::try_from(duration.as_millis()).ok()),
            executable_hash_scope: "current_executable_path_file",
            executable_cache: "once_per_process",
        }
    }

    fn fail(&mut self, status: &'static str, error: &'static str) {
        self.executable_sha256 = None;
        self.executable_hash_status = status;
        self.executable_error = Some(error);
    }
}

#[derive(Debug, PartialEq, Eq)]
struct FileIdentity {
    bytes: u64,
    modified: SystemTime,
    created: Option<SystemTime>,
    #[cfg(unix)]
    inode: (u64, u64, i64, i64),
    #[cfg(windows)]
    windows: windows_identity::Identity,
}

#[cfg(windows)]
mod windows_identity {
    use std::{ffi::c_void, fs::File, mem::size_of, os::windows::io::AsRawHandle};

    #[repr(C)]
    #[derive(Default)]
    struct FileIdInfo {
        volume: u64,
        id: [u8; 16],
    }
    #[repr(C)]
    #[derive(Default)]
    struct FileBasicInfo {
        creation: i64,
        access: i64,
        write: i64,
        change: i64,
        attributes: u32,
    }
    #[derive(Debug, PartialEq, Eq)]
    pub(super) struct Identity {
        volume: u64,
        id: [u8; 16],
        change: i64,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetFileInformationByHandleEx(
            handle: *mut c_void,
            class: i32,
            buffer: *mut c_void,
            size: u32,
        ) -> i32;
    }

    pub(super) fn get(file: &File) -> Result<Identity, &'static str> {
        let mut id = FileIdInfo::default();
        let mut basic = FileBasicInfo::default();
        // FILE_ID_INFO (class 18) and FILE_BASIC_INFO (class 0), documented at:
        // https://learn.microsoft.com/windows/win32/api/winbase/nf-winbase-getfileinformationbyhandleex
        // The borrowed live File owns the handle, and each repr(C) buffer has
        // the SDK layout/size. Failed or unsupported queries remain unknown.
        let succeeded = unsafe {
            GetFileInformationByHandleEx(
                file.as_raw_handle(),
                18,
                (&mut id as *mut FileIdInfo).cast(),
                size_of::<FileIdInfo>() as u32,
            ) != 0
                && GetFileInformationByHandleEx(
                    file.as_raw_handle(),
                    0,
                    (&mut basic as *mut FileBasicInfo).cast(),
                    size_of::<FileBasicInfo>() as u32,
                ) != 0
        };
        if !succeeded {
            return Err("executable_file_identity_unavailable");
        }
        Ok(Identity {
            volume: id.volume,
            id: id.id,
            change: basic.change,
        })
    }
}

fn file_identity(file: &File) -> Result<FileIdentity, &'static str> {
    let metadata = file
        .metadata()
        .map_err(|_| "executable_metadata_unavailable")?;
    if !metadata.is_file() {
        return Err("executable_not_regular_file");
    }
    Ok(FileIdentity {
        bytes: metadata.len(),
        modified: metadata
            .modified()
            .map_err(|_| "executable_metadata_unavailable")?,
        created: metadata.created().ok(),
        #[cfg(unix)]
        inode: {
            use std::os::unix::fs::MetadataExt;
            (
                metadata.dev(),
                metadata.ino(),
                metadata.ctime(),
                metadata.ctime_nsec(),
            )
        },
        #[cfg(windows)]
        windows: windows_identity::get(file)?,
    })
}

fn open_executable(path: &Path) -> Result<File, &'static str> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "executable_open_failed")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("executable_not_regular_file");
    }
    File::open(path).map_err(|_| "executable_open_failed")
}

fn path_identity(path: &Path) -> Result<FileIdentity, &'static str> {
    file_identity(&open_executable(path)?)
}

fn hash_reader(reader: impl Read, limit: u64) -> Result<(String, u64), &'static str> {
    let mut bounded = reader.take(limit + 1);
    let mut digest = Sha256::new();
    let mut bytes = 0;
    let mut buffer = [0; 64 * 1024];
    loop {
        let count = bounded
            .read(&mut buffer)
            .map_err(|_| "executable_read_failed")?;
        if count == 0 {
            break;
        }
        bytes += count as u64;
        if bytes > limit {
            return Err("executable_too_large");
        }
        digest.update(&buffer[..count]);
    }
    Ok((format!("{:x}", digest.finalize()), bytes))
}

struct ExecutableSnapshot {
    identity: ExecutableIdentity,
    path: Option<PathBuf>,
    file: Option<FileIdentity>,
}

impl ExecutableSnapshot {
    fn collect() -> Self {
        Self::at_path(
            std::env::current_exe().map_err(|_| "executable_path_unavailable"),
            MAX_EXECUTABLE_BYTES,
        )
    }

    fn at_path(path: Result<PathBuf, &'static str>, limit: u64) -> Self {
        Self::at_path_with_hash(path, limit, |file, limit| hash_reader(file, limit))
    }

    fn at_path_with_hash(
        path: Result<PathBuf, &'static str>,
        limit: u64,
        hash: impl FnOnce(&File, u64) -> Result<(String, u64), &'static str>,
    ) -> Self {
        let mut snapshot = Self {
            identity: ExecutableIdentity::new(),
            path: None,
            file: None,
        };
        if let Err(error) = snapshot.read(path, limit, hash) {
            snapshot.identity.fail(
                match error {
                    "executable_too_large" => "too_large",
                    "executable_changed" => "changed",
                    _ => "unavailable",
                },
                error,
            );
        }
        snapshot
    }

    fn read(
        &mut self,
        path: Result<PathBuf, &'static str>,
        limit: u64,
        hash: impl FnOnce(&File, u64) -> Result<(String, u64), &'static str>,
    ) -> Result<(), &'static str> {
        let path = path?;
        let text = path
            .to_str()
            .filter(|text| {
                text.chars().count() <= MAX_PATH_CHARS && !text.chars().any(char::is_control)
            })
            .ok_or("executable_path_invalid")?;
        self.identity.executable_path = Some(text.to_owned());
        self.path = Some(path.clone());
        let file = open_executable(&path)?;
        let before = file_identity(&file)?;
        if path_identity(&path).ok().as_ref() != Some(&before) {
            return Err("executable_changed");
        }
        self.identity.executable_bytes =
            (before.bytes <= 9_007_199_254_740_991).then_some(before.bytes);
        let bytes_before = before.bytes;
        self.file = Some(before);
        if bytes_before > limit {
            return Err("executable_too_large");
        }
        let result = hash(&file, limit);
        let after = file_identity(&file).map_err(|_| "executable_changed")?;
        if self.file.as_ref() != Some(&after) || path_identity(&path).ok().as_ref() != Some(&after)
        {
            return Err("executable_changed");
        }
        let (hash, bytes) = result?;
        if bytes != after.bytes {
            return Err("executable_changed");
        }
        self.identity.executable_sha256 = Some(hash);
        self.identity.executable_hash_status = "ok";
        Ok(())
    }

    fn checked(&self, current_path: Result<PathBuf, &'static str>) -> ExecutableIdentity {
        let mut identity = self.identity.clone();
        if self.path.is_some() && self.path.as_ref() != current_path.as_ref().ok() {
            identity.fail("changed", "executable_changed");
            identity.executable_path = None;
            identity.executable_bytes = None;
            return identity;
        }
        if let (Some(path), Some(expected)) = (&self.path, &self.file) {
            if current_path.as_ref().ok() != Some(path)
                || path_identity(path).ok().as_ref() != Some(expected)
            {
                identity.fail("changed", "executable_changed");
                // These describe the old snapshot and must not pass as current.
                identity.executable_bytes = None;
            }
        }
        identity
    }
}

fn cached_executable(
    cache: &OnceLock<ExecutableSnapshot>,
    collect: impl FnOnce() -> ExecutableSnapshot,
    current_path: Result<PathBuf, &'static str>,
) -> ExecutableIdentity {
    cache.get_or_init(collect).checked(current_path)
}

/// The adapters call this only for the explicit GET endpoint, never for health,
/// parsing, playback, or audio requests. No caller supplies a filesystem path.
pub fn diagnostics(transport: &'static str) -> Value {
    let executable = cached_executable(
        &EXECUTABLE,
        ExecutableSnapshot::collect,
        std::env::current_exe().map_err(|_| "executable_path_unavailable"),
    );
    let mut native = serde_json::to_value(executable).expect("fixed diagnostic structure");
    let fields = native.as_object_mut().expect("diagnostic object");
    fields.insert("transport".into(), json!(transport));
    fields.insert("process_id".into(), json!(std::process::id()));
    fields.insert("os".into(), json!(std::env::consts::OS));
    fields.insert("arch".into(), json!(std::env::consts::ARCH));
    json!({
        "schema_version": 1,
        "compiled": {
            "package_version": env!("CARGO_PKG_VERSION"),
            "source_sha": compiled::SOURCE_SHA,
            "source_tree": compiled::SOURCE_TREE,
            "source_commit_count": compiled::SOURCE_COMMIT_COUNT,
            "source_status": compiled::SOURCE_STATUS,
            "source_error": compiled::SOURCE_ERROR,
            "target": compiled::BUILD_TARGET,
        },
        "native": native,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{self, Cursor},
        sync::atomic::{AtomicU64, AtomicUsize, Ordering},
    };
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "wmc-executable-snapshot-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> PathBuf {
            self.0.join("original-fixture.bin")
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn hash_is_known_sha256_and_reads_at_most_the_bound_plus_one() {
        assert_eq!(
            hash_reader(Cursor::new(b"abc"), 3).unwrap(),
            (
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad".into(),
                3
            )
        );
        let mut reader = Cursor::new(vec![1; 4096]);
        assert_eq!(hash_reader(&mut reader, 16), Err("executable_too_large"));
        assert_eq!(reader.position(), 17);
        struct Broken;
        impl Read for Broken {
            fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
                Err(io::Error::other("private detail not exposed"))
            }
        }
        assert_eq!(hash_reader(Broken, 16), Err("executable_read_failed"));
    }

    #[test]
    fn changed_or_removed_disk_file_never_reports_cached_hash_as_current() {
        let fixture = Fixture::new();
        fs::write(fixture.path(), b"original bytes").unwrap();
        let snapshot = ExecutableSnapshot::at_path(Ok(fixture.path()), 1024);
        assert_eq!(
            snapshot.checked(Ok(fixture.path())).executable_hash_status,
            "ok"
        );
        fs::write(fixture.path(), b"changed bytes with different length").unwrap();
        let changed = snapshot.checked(Ok(fixture.path()));
        assert_eq!(changed.executable_hash_status, "changed");
        assert_eq!(changed.executable_sha256, None);
        assert_eq!(changed.executable_bytes, None);
        fs::remove_file(fixture.path()).unwrap();
        assert_eq!(
            snapshot.checked(Ok(fixture.path())).executable_hash_status,
            "changed"
        );
        assert_eq!(
            snapshot
                .checked(Ok(fixture.0.join("moved.bin")))
                .executable_hash_status,
            "changed"
        );
        assert_eq!(
            snapshot
                .checked(Ok(fixture.0.join("moved.bin")))
                .executable_path,
            None
        );
        assert_eq!(
            snapshot
                .checked(Err("executable_path_unavailable"))
                .executable_path,
            None
        );
    }

    #[test]
    fn unavailable_oversize_and_invalid_paths_remain_visible() {
        let fixture = Fixture::new();
        let missing = ExecutableSnapshot::at_path(Ok(fixture.path()), 16);
        assert_eq!(
            missing.identity.executable_error,
            Some("executable_open_failed")
        );
        fs::write(fixture.path(), b"original bytes").unwrap();
        let large = ExecutableSnapshot::at_path(Ok(fixture.path()), 4);
        assert_eq!(large.identity.executable_hash_status, "too_large");
        assert_eq!(large.identity.executable_sha256, None);
        assert_eq!(large.identity.executable_bytes, Some(14));
        let invalid = ExecutableSnapshot::at_path(Ok(PathBuf::from("private\npath")), 16);
        assert_eq!(invalid.identity.executable_path, None);
        assert_eq!(
            invalid.identity.executable_error,
            Some("executable_path_invalid")
        );
        let invalid_checked = invalid.checked(Ok(PathBuf::from("private\npath")));
        assert_eq!(invalid_checked.executable_hash_status, "unavailable");
        assert_eq!(
            invalid_checked.executable_error,
            Some("executable_path_invalid")
        );
        let unavailable = ExecutableSnapshot::at_path(Err("executable_path_unavailable"), 16);
        assert_eq!(unavailable.identity.executable_hash_status, "unavailable");
        assert_eq!(unavailable.identity.executable_path, None);
    }

    #[test]
    fn process_cache_collects_once_including_errors_without_rehashing() {
        let cache = OnceLock::new();
        let collections = AtomicUsize::new(0);
        for _ in 0..3 {
            let value = cached_executable(
                &cache,
                || {
                    collections.fetch_add(1, Ordering::SeqCst);
                    ExecutableSnapshot::at_path(Err("executable_path_unavailable"), 16)
                },
                Err("executable_path_unavailable"),
            );
            assert_eq!(value.executable_error, Some("executable_path_unavailable"));
        }
        assert_eq!(collections.load(Ordering::SeqCst), 1);
        let fixture = Fixture::new();
        fs::write(fixture.path(), b"original bytes").unwrap();
        let cache = OnceLock::new();
        let collections = AtomicUsize::new(0);
        for request in 0..3 {
            if request == 2 {
                fs::write(fixture.path(), b"changed size").unwrap();
            }
            let value = cached_executable(
                &cache,
                || {
                    collections.fetch_add(1, Ordering::SeqCst);
                    ExecutableSnapshot::at_path(Ok(fixture.path()), 1024)
                },
                Ok(fixture.path()),
            );
            assert_eq!(
                value.executable_hash_status,
                if request == 2 { "changed" } else { "ok" }
            );
        }
        assert_eq!(collections.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn changes_during_first_hash_are_rejected() {
        let fixture = Fixture::new();
        fs::write(fixture.path(), b"original bytes").unwrap();
        let snapshot =
            ExecutableSnapshot::at_path_with_hash(Ok(fixture.path()), 1024, |file, limit| {
                let digest = hash_reader(file, limit)?;
                fs::write(fixture.path(), b"changed after read").unwrap();
                Ok(digest)
            });
        assert_eq!(snapshot.identity.executable_hash_status, "changed");
        assert_eq!(snapshot.identity.executable_sha256, None);
    }

    #[test]
    fn replacement_with_same_size_and_modified_time_invalidates_snapshot() {
        let fixture = Fixture::new();
        fs::write(fixture.path(), b"original bytes").unwrap();
        let modified = fs::metadata(fixture.path()).unwrap().modified().unwrap();
        let snapshot = ExecutableSnapshot::at_path(Ok(fixture.path()), 1024);
        let replacement = fixture.0.join("replacement.bin");
        fs::write(&replacement, b"replaced bytes").unwrap();
        File::options()
            .write(true)
            .open(&replacement)
            .unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(modified))
            .unwrap();
        fs::remove_file(fixture.path()).unwrap();
        fs::rename(replacement, fixture.path()).unwrap();
        assert_eq!(fs::metadata(fixture.path()).unwrap().len(), 14);
        assert_eq!(
            fs::metadata(fixture.path()).unwrap().modified().unwrap(),
            modified
        );
        let checked = snapshot.checked(Ok(fixture.path()));
        assert_eq!(checked.executable_hash_status, "changed");
        assert_eq!(checked.executable_sha256, None);
    }

    #[test]
    fn directories_are_rejected_before_opening() {
        let fixture = Fixture::new();
        let snapshot = ExecutableSnapshot::at_path(Ok(fixture.0.clone()), 1024);
        assert_eq!(snapshot.identity.executable_hash_status, "unavailable");
        assert_eq!(
            snapshot.identity.executable_error,
            Some("executable_not_regular_file")
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_not_followed_for_executable_snapshots() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        fs::write(fixture.path(), b"original bytes").unwrap();
        let link = fixture.0.join("executable-link");
        symlink(fixture.path(), &link).unwrap();
        let snapshot = ExecutableSnapshot::at_path(Ok(link), 1024);
        assert_eq!(snapshot.identity.executable_hash_status, "unavailable");
        assert_eq!(
            snapshot.identity.executable_error,
            Some("executable_not_regular_file")
        );
    }
}
