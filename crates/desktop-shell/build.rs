fn main() {
    #[cfg(all(windows, feature = "windows-shell"))]
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        tauri_build::build();
    }
}
