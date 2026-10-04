//! Shared v2 clean ZIP transport writer. Callers supply complete packages already
//! validated by their authoritative profile; no original sources are embedded.
use std::{
    collections::{BTreeMap, BTreeSet},
    io::{Cursor, Write},
};

pub const MAX_PACK_BYTES: usize = 128 * 1024 * 1024;
pub const MAX_EXPANDED_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const MAX_ZIP_ENTRIES: usize = 4096;

/// The same ordering, compression and byte limits as native clean-library export.
/// A failed writer must be discarded; only finish() can return an archive.
pub struct Writer {
    archive: zip::ZipWriter<Cursor<Vec<u8>>>,
    songs: Vec<serde_json::Value>,
    folders: BTreeSet<String>,
    expanded: u64,
    entries: usize,
    failed: bool,
}
impl Default for Writer {
    fn default() -> Self {
        Self::new()
    }
}
impl Writer {
    pub fn new() -> Self {
        Self {
            archive: zip::ZipWriter::new(Cursor::new(Vec::new())),
            songs: vec![],
            folders: BTreeSet::new(),
            expanded: 0,
            entries: 1,
            failed: false,
        }
    }
    pub fn add_song(
        &mut self,
        folder: &str,
        files: BTreeMap<String, Vec<u8>>,
    ) -> Result<(), String> {
        if self.failed {
            return Err("A rejected clean export cannot be resumed".into());
        }
        self.failed = true;
        if !safe_path(folder) || !self.folders.insert(folder.to_owned()) {
            return Err("Invalid or duplicate clean song folder".into());
        }
        if !files.contains_key("metadata.json")
            || !files.contains_key("score.json")
            || files.keys().any(|path| {
                !safe_path(path)
                    || !(matches!(path.as_str(), "metadata.json" | "score.json")
                        || path.starts_with("media/"))
            })
        {
            return Err(
                "Clean export requires two JSON files and only declared media paths".into(),
            );
        }
        self.entries += files.len();
        if self.entries > MAX_ZIP_ENTRIES {
            return Err("Clean export exceeds 4096 files; select fewer songs".into());
        }
        self.songs.push(serde_json::json!({"folder":folder}));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (path, bytes) in files {
            self.expanded += bytes.len() as u64;
            if self.expanded > MAX_EXPANDED_BYTES {
                return Err("Clean export exceeds 2 GiB expanded limit".into());
            }
            self.archive
                .start_file(format!("{folder}/{path}"), options)
                .map_err(|e| e.to_string())?;
            self.archive.write_all(&bytes).map_err(|e| e.to_string())?;
            if self
                .archive
                .get_ref()
                .is_some_and(|writer| writer.get_ref().len() > MAX_PACK_BYTES)
            {
                return Err("Clean export exceeds 128 MiB compressed limit".into());
            }
        }
        self.failed = false;
        Ok(())
    }
    pub fn finish(mut self) -> Result<Vec<u8>, String> {
        if self.failed {
            return Err("A rejected clean export cannot return a partial archive".into());
        }
        if self.songs.is_empty() {
            return Err("Clean export needs at least one complete song".into());
        }
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        self.archive
            .start_file("manifest.json", options)
            .map_err(|e| e.to_string())?;
        self.archive
            .write_all(
                &serde_json::to_vec_pretty(&serde_json::json!({
                    "format":"worldmusichub-song-pack", "version":2, "songs":self.songs
                }))
                .map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
        let bytes = self
            .archive
            .finish()
            .map_err(|e| e.to_string())?
            .into_inner();
        if bytes.len() > MAX_PACK_BYTES {
            return Err("Clean export exceeds 128 MiB compressed limit".into());
        }
        Ok(bytes)
    }
}
fn safe_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 1024
        && !path.contains(['\\', ':'])
        && !path.chars().any(char::is_control)
        && path
            .split('/')
            .all(|part| !part.is_empty() && !matches!(part, "." | ".."))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn files() -> BTreeMap<String, Vec<u8>> {
        BTreeMap::from([
            ("metadata.json".into(), b"original test metadata".to_vec()),
            ("score.json".into(), b"original C E G".to_vec()),
        ])
    }
    #[test]
    fn shared_writer_matches_the_previous_native_export_bytes() {
        // This is the previous native writer's exact entry ordering/options.
        let mut old = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let mut songs = vec![];
        let mut shared = Writer::new();
        for folder in ["songs/first", "songs/second"] {
            let files = files();
            shared.add_song(folder, files.clone()).unwrap();
            songs.push(serde_json::json!({"folder":folder}));
            for (path, bytes) in files {
                old.start_file(format!("{folder}/{path}"), options).unwrap();
                old.write_all(&bytes).unwrap();
            }
        }
        old.start_file("manifest.json", options).unwrap();
        old.write_all(
            &serde_json::to_vec_pretty(
                &serde_json::json!({"format":"worldmusichub-song-pack","version":2,"songs":songs}),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(shared.finish().unwrap(), old.finish().unwrap().into_inner());
    }
    #[test]
    fn failed_limits_and_invalid_files_never_return_partial_archive() {
        for expanded_limit in [false, true] {
            let mut writer = Writer::new();
            writer.add_song("songs/first", files()).unwrap();
            if expanded_limit {
                writer.expanded = MAX_EXPANDED_BYTES;
            } else {
                writer.entries = MAX_ZIP_ENTRIES;
            }
            assert!(writer.add_song("songs/second", files()).is_err());
            assert!(writer.finish().is_err());
        }
        let mut writer = Writer::new();
        let mut files = files();
        files.insert("original.mid".into(), vec![1]);
        assert!(writer.add_song("songs/first", files).is_err());
        assert!(writer.finish().is_err());
        assert!(Writer::new().finish().is_err());
    }
}
