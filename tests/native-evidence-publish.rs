//! Standalone contract driver: compile the exact production writer with rustc.
//! No application, server, window, retries or alternate publication path.
#[path = "../crates/desktop-shell/src/acceptance_publication.rs"]
mod publication;

fn main() -> std::io::Result<()> {
    let arguments: Vec<_> = std::env::args_os().skip(1).collect();
    if arguments.len() != 3 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "expected owned test directory, filename and payload path",
        ));
    }
    let directory = std::path::Path::new(&arguments[0]);
    let name = arguments[1].to_str().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid test filename")
    })?;
    if name.contains(['/', '\\']) || !name.ends_with(".json") {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "test filename must be a JSON basename",
        ));
    }
    let payload = std::fs::read(&arguments[2])?;
    if payload.is_empty() || payload.len() > 4 * 1024 * 1024 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "test payload exceeds evidence bounds",
        ));
    }
    publication::atomic_json(directory, name, &payload)
}
