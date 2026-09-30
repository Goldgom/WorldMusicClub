use std::{env, fs, path::PathBuf};
fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("../../web");
    println!("cargo:rerun-if-changed={}", root.display());
    let mut entries = Vec::new();
    fn visit(root: &std::path::Path, dir: &std::path::Path, output: &mut Vec<(String, PathBuf)>) {
        for entry in fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            if path.is_dir() {
                visit(root, &path, output);
            } else {
                output.push((
                    format!(
                        "/{}",
                        path.strip_prefix(root)
                            .unwrap()
                            .to_string_lossy()
                            .replace('\\', "/")
                    ),
                    path,
                ));
            }
        }
    }
    visit(&root, &root, &mut entries);
    entries.sort();
    let mut code =
        String::from("fn web_asset(path: &str) -> Option<&'static [u8]> { match path {\n");
    for (url, path) in entries {
        code += &format!(
            "{:?} => Some(include_bytes!({:?})),\n",
            url,
            fs::canonicalize(path).unwrap()
        );
    }
    code += "_ => None } }\n";
    fs::write(
        PathBuf::from(env::var("OUT_DIR").unwrap()).join("web_assets.rs"),
        code,
    )
    .unwrap();
}
