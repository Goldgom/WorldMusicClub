#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(all(windows, feature = "windows-shell"))]
mod windows;

#[cfg(all(windows, feature = "windows-shell"))]
fn main() {
    windows::run();
}

#[cfg(not(all(windows, feature = "windows-shell")))]
fn main() {
    eprintln!("This native-shell proof targets Windows only; no GUI or server was started.");
    std::process::exit(2);
}
