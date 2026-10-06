use std::{
    env, fs, io,
    path::{Path, PathBuf},
};
mod build_source;
#[derive(Clone, Copy)]
struct Limits {
    files: usize,
    depth: usize,
    file_bytes: u64,
    total_bytes: u64,
}
const LIMITS: Limits = Limits {
    files: 4096,
    depth: 16,
    file_bytes: 16 * 1024 * 1024,
    total_bytes: 64 * 1024 * 1024,
};
fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}
fn collect_assets(root: &Path, limits: Limits) -> io::Result<Vec<(String, PathBuf)>> {
    let root_meta = fs::symlink_metadata(root)?;
    if root_meta.file_type().is_symlink() || !root_meta.is_dir() {
        return Err(invalid(
            "web asset root must be a real directory, not a symbolic link",
        ));
    }
    let root = fs::canonicalize(root)?;
    let mut result = vec![];
    let mut bytes = 0;
    fn visit(
        root: &Path,
        dir: &Path,
        depth: usize,
        limits: Limits,
        bytes: &mut u64,
        output: &mut Vec<(String, PathBuf)>,
    ) -> io::Result<()> {
        if depth > limits.depth {
            return Err(invalid("web assets exceed the directory-depth limit"));
        }
        for entry in fs::read_dir(dir)? {
            let path = entry?.path();
            let metadata = fs::symlink_metadata(&path)?;
            if metadata.file_type().is_symlink() {
                return Err(invalid(format!(
                    "Symbolic links are not allowed in web assets: {}",
                    path.display()
                )));
            }
            let canonical = fs::canonicalize(&path)?;
            if !canonical.starts_with(root) {
                return Err(invalid("web asset escaped its canonical root"));
            }
            if metadata.is_dir() {
                visit(root, &canonical, depth + 1, limits, bytes, output)?;
            } else if metadata.is_file() {
                if output.len() >= limits.files
                    || metadata.len() > limits.file_bytes
                    || metadata.len() > limits.total_bytes.saturating_sub(*bytes)
                {
                    return Err(invalid("web assets exceed file-count or byte limits"));
                }
                *bytes += metadata.len();
                let relative = canonical
                    .strip_prefix(root)
                    .map_err(|_| invalid("invalid asset root"))?;
                let mut segments = vec![];
                for part in relative.components() {
                    let name = part
                        .as_os_str()
                        .to_str()
                        .ok_or_else(|| invalid("asset paths must be UTF-8"))?;
                    if name.chars().any(char::is_control) || name.contains('\\') {
                        return Err(invalid(
                            "asset paths contain unsupported control or separator characters",
                        ));
                    }
                    segments.push(name);
                }
                output.push((format!("/{}", segments.join("/")), canonical));
            } else {
                return Err(invalid("web assets must be regular files or directories"));
            }
        }
        Ok(())
    }
    visit(&root, &root, 0, limits, &mut bytes, &mut result)?;
    result.sort();
    Ok(result)
}
fn main() {
    let workspace = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("../..");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    build_source::emit(&workspace, &out, &env::var("TARGET").unwrap())
        .expect("build identity generation failed");
    let root = workspace.join("web");
    println!("cargo:rerun-if-changed={}", root.display());
    let entries =
        collect_assets(&root, LIMITS).expect("WorldMusicClub web asset validation failed");
    let mut code =
        String::from("fn web_asset(path: &str) -> Option<&'static [u8]> { match path {\n");
    for (url, path) in entries {
        code += &format!("{:?} => Some(include_bytes!({:?})),\n", url, path);
    }
    code += "_ => None } }\n";
    build_source::write_if_changed(&out.join("web_assets.rs"), code.as_bytes()).unwrap();
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            Self::at(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
            )
        }
        fn at(timestamp: u128) -> Self {
            let path = env::temp_dir().join(format!(
                "wmh-assets-{}-{}-{}",
                std::process::id(),
                timestamp,
                NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn fixtures_created_at_the_same_clock_tick_are_independent() {
        let first = Temp::at(42);
        fs::write(first.0.join("fixture.txt"), "first").unwrap();
        let second = Temp::at(42);
        fs::write(second.0.join("fixture.txt"), "second").unwrap();
        assert_ne!(first.0, second.0);
        assert_eq!(fs::read(first.0.join("fixture.txt")).unwrap(), b"first");
        drop(second);
        assert_eq!(fs::read(first.0.join("fixture.txt")).unwrap(), b"first");
    }
    #[test]
    fn nested_regular_assets_are_embedded_under_exact_relative_routes() {
        let t = Temp::new();
        fs::write(t.0.join("index.html"), "page").unwrap();
        fs::create_dir(t.0.join("vendor")).unwrap();
        fs::write(t.0.join("vendor/runtime.js"), "code").unwrap();
        let files = collect_assets(&t.0, LIMITS).unwrap();
        assert_eq!(
            files.iter().map(|x| x.0.as_str()).collect::<Vec<_>>(),
            vec!["/index.html", "/vendor/runtime.js"]
        );
    }
    #[test]
    fn count_bytes_and_depth_are_bounded() {
        let t = Temp::new();
        fs::write(t.0.join("a"), "1234").unwrap();
        fs::write(t.0.join("b"), "1234").unwrap();
        assert!(collect_assets(&t.0, Limits { files: 1, ..LIMITS }).is_err());
        assert!(collect_assets(
            &t.0,
            Limits {
                total_bytes: 7,
                ..LIMITS
            }
        )
        .is_err());
        assert!(collect_assets(
            &t.0,
            Limits {
                file_bytes: 3,
                ..LIMITS
            }
        )
        .is_err());
        fs::create_dir(t.0.join("nested")).unwrap();
        assert!(collect_assets(&t.0, Limits { depth: 0, ..LIMITS }).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn symlink_files_directories_and_cycles_are_rejected() {
        use std::os::unix::fs::symlink;
        let outside = Temp::new();
        fs::write(outside.0.join("secret-marker"), "do not embed").unwrap();
        let t = Temp::new();
        symlink(outside.0.join("secret-marker"), t.0.join("leak.txt")).unwrap();
        assert!(collect_assets(&t.0, LIMITS)
            .unwrap_err()
            .to_string()
            .contains("Symbolic"));
        fs::remove_file(t.0.join("leak.txt")).unwrap();
        symlink(&t.0, t.0.join("cycle")).unwrap();
        assert!(collect_assets(&t.0, LIMITS).is_err());
        assert!(collect_assets(&t.0.join("cycle"), LIMITS).is_err());
    }
}
