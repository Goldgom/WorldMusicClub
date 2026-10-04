//! Atomic evidence publication shared by the host and the Windows contract.
use std::path::Path;

pub fn atomic_json(directory: &Path, name: &str, bytes: &[u8]) -> std::io::Result<()> {
    // Finish and close the sibling before publishing it. Readers must open the
    // immutable snapshot with delete-sharing on Windows so replacement can
    // overlap a read without exposing partial JSON or a sharing violation.
    let temporary = directory.join(format!("{name}.tmp"));
    std::fs::write(&temporary, bytes)?;
    std::fs::rename(temporary, directory.join(name))
}
