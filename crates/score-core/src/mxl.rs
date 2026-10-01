//! Strict in-memory MXL container support. Nothing is extracted to the filesystem.
use crate::{import_musicxml, Diagnostic, Score};
use base64::{engine::general_purpose::STANDARD, Engine};
use roxmltree::{Document, ParsingOptions};
use std::collections::HashSet;
use std::io::{Cursor, Read};
use zip::{CompressionMethod, ZipArchive};

const MAX_ARCHIVE: usize = 8 * 1024 * 1024;
const MAX_EXPANDED: u64 = 16 * 1024 * 1024;
const MAX_SCORE: usize = 8 * 1024 * 1024;
const MAX_CONTAINER: usize = 64 * 1024;
const MAX_ENTRIES: usize = 128;
const MAX_RETAINED_SCORE: usize = 8 * 1024 * 1024;
const CONTAINER: &str = "META-INF/container.xml";
const MIMETYPE: &[u8] = b"application/vnd.recordare.musicxml";

fn warning(code: &str, message: impl Into<String>) -> Diagnostic {
    Diagnostic {
        severity: "warning".into(),
        code: code.into(),
        message: message.into(),
        note_id: None,
    }
}
fn u16_at(bytes: &[u8], offset: usize) -> Result<u16, String> {
    let b = bytes
        .get(offset..offset + 2)
        .ok_or("Truncated MXL ZIP header")?;
    Ok(u16::from_le_bytes([b[0], b[1]]))
}
fn u32_at(bytes: &[u8], offset: usize) -> Result<u32, String> {
    let b = bytes
        .get(offset..offset + 4)
        .ok_or("Truncated MXL ZIP header")?;
    Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}
fn safe_path(path: &str, directory: bool) -> Result<(), String> {
    if path.is_empty()
        || path.len() > 1024
        || path.starts_with('/')
        || path.contains(['\\', ':'])
        || path.chars().any(char::is_control)
    {
        return Err("MXL paths must be short, relative UTF-8 paths without URLs, drive letters, backslashes or control characters".into());
    }
    let components = if directory {
        path.strip_suffix('/').unwrap_or(path)
    } else {
        path
    };
    if components
        .split('/')
        .any(|p| p.is_empty() || matches!(p, "." | ".."))
    {
        return Err("MXL paths cannot contain empty, dot or parent-directory components".into());
    }
    Ok(())
}

/// Bound directory metadata *before* the ZIP library allocates for entry counts.
/// ZIP64, split archives, preambles, ambiguous paths, unsupported compression and
/// overlapping local records are deliberately excluded from this small importer.
fn preflight(bytes: &[u8]) -> Result<usize, String> {
    if bytes.len() > MAX_ARCHIVE {
        return Err("MXL exceeds the 8 MiB compressed archive limit".into());
    }
    if !bytes.starts_with(b"PK\x03\x04") {
        return Err("MXL must be a nonempty standard ZIP archive without a preamble".into());
    }
    let search_start = bytes.len().saturating_sub(65_557);
    let eocd = (search_start..bytes.len().saturating_sub(21))
        .rev()
        .find(|&p| {
            bytes.get(p..p + 4) == Some(b"PK\x05\x06")
                && u16_at(bytes, p + 20).is_ok_and(|n| p + 22 + n as usize == bytes.len())
        })
        .ok_or("MXL ZIP end record is missing or truncated")?;
    let entries = u16_at(bytes, eocd + 10)? as usize;
    if u16_at(bytes, eocd + 4)? != 0
        || u16_at(bytes, eocd + 6)? != 0
        || u16_at(bytes, eocd + 8)? as usize != entries
    {
        return Err("Split or multi-disk MXL archives are unsupported".into());
    }
    if entries == 0 || entries > MAX_ENTRIES {
        return Err("MXL must contain 1–128 ZIP entries; ZIP64 containers are unsupported".into());
    }
    let directory_size = u32_at(bytes, eocd + 12)? as usize;
    let directory_start = u32_at(bytes, eocd + 16)? as usize;
    if directory_start.checked_add(directory_size) != Some(eocd) {
        return Err(
            "Invalid, extended or ZIP64 MXL central directory; export an ordinary MXL archive"
                .into(),
        );
    }
    let mut pos = directory_start;
    let mut total_size = 0_u64;
    let mut names = HashSet::new();
    let mut ranges = Vec::with_capacity(entries);
    for _ in 0..entries {
        if bytes.get(pos..pos.saturating_add(4)) != Some(b"PK\x01\x02") {
            return Err("Invalid MXL central directory entry".into());
        }
        let flags = u16_at(bytes, pos + 8)?;
        let method = u16_at(bytes, pos + 10)?;
        if flags & 1 != 0 || flags & 0x40 != 0 {
            return Err("Encrypted MXL files are unsupported; export without a password".into());
        }
        if !matches!(method, 0 | 8) {
            return Err("MXL supports only stored or DEFLATE entries".into());
        }
        if u16_at(bytes, pos + 34)? != 0 {
            return Err("Split MXL archives are unsupported".into());
        }
        let compressed = u32_at(bytes, pos + 20)? as usize;
        let expanded = u32_at(bytes, pos + 24)? as u64;
        total_size = total_size
            .checked_add(expanded)
            .ok_or("MXL expanded sizes overflow")?;
        if expanded > MAX_SCORE as u64 || total_size > MAX_EXPANDED {
            return Err("MXL exceeds the 8 MiB per-file or 16 MiB total expanded limit".into());
        }
        let name_len = u16_at(bytes, pos + 28)? as usize;
        let extra_len = u16_at(bytes, pos + 30)? as usize;
        let comment_len = u16_at(bytes, pos + 32)? as usize;
        let next = pos
            .checked_add(46 + name_len + extra_len + comment_len)
            .ok_or("MXL directory size overflow")?;
        if next > eocd {
            return Err("Truncated MXL central directory".into());
        }
        let name_bytes = &bytes[pos + 46..pos + 46 + name_len];
        let name = std::str::from_utf8(name_bytes).map_err(|_| "MXL entry names must be UTF-8")?;
        let directory = name.ends_with('/');
        safe_path(name, directory)?;
        if !names.insert(name.to_lowercase()) {
            return Err("Duplicate or case-ambiguous MXL entry paths are unsupported".into());
        }
        let file_type = (u32_at(bytes, pos + 38)? >> 16) & 0o170000;
        if !matches!(file_type, 0 | 0o100000 | 0o040000) {
            return Err("MXL symbolic links, devices and special files are forbidden".into());
        }
        if (directory || file_type == 0o040000) && expanded != 0 {
            return Err("MXL directory entries cannot contain data".into());
        }
        let local = u32_at(bytes, pos + 42)? as usize;
        if bytes.get(local..local.saturating_add(4)) != Some(b"PK\x03\x04") {
            return Err("Invalid MXL local file header".into());
        }
        if u16_at(bytes, local + 6)? != flags || u16_at(bytes, local + 8)? != method {
            return Err("MXL local and central compression headers disagree".into());
        }
        let local_name_len = u16_at(bytes, local + 26)? as usize;
        let local_extra_len = u16_at(bytes, local + 28)? as usize;
        if name == "mimetype" && (method != 0 || local_extra_len != 0 || extra_len != 0) {
            return Err("MXL mimetype must be stored without compression or extra fields".into());
        }
        if bytes.get(local + 30..local + 30 + local_name_len) != Some(name_bytes) {
            return Err("MXL local and central filenames disagree".into());
        }
        let data_end = local
            .checked_add(30 + local_name_len + local_extra_len)
            .and_then(|p| p.checked_add(compressed))
            .ok_or("MXL file size overflow")?;
        if data_end > directory_start {
            return Err("MXL file contents overlap the central directory".into());
        }
        ranges.push((local, data_end));
        pos = next;
    }
    if pos != eocd {
        return Err("MXL entry count does not match its central directory".into());
    }
    ranges.sort_unstable();
    if ranges.windows(2).any(|pair| pair[0].1 > pair[1].0) {
        return Err("Overlapping MXL file records are forbidden".into());
    }
    Ok(entries)
}

fn read_entry(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    name: &str,
    limit: usize,
) -> Result<Vec<u8>, String> {
    let file = archive
        .by_name(name)
        .map_err(|e| format!("Cannot read MXL entry {name}: {e}"))?;
    if !file.is_file() || file.is_symlink() || file.encrypted() {
        return Err(format!(
            "MXL entry {name} must be a regular, unencrypted file"
        ));
    }
    if file.size() > limit as u64 {
        return Err(format!("MXL entry {name} exceeds its {limit}-byte limit"));
    }
    let declared = file.size();
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Corrupt MXL entry {name}: {e}"))?;
    if bytes.len() > limit || bytes.len() as u64 != declared {
        return Err(format!(
            "MXL entry {name} has an invalid or excessive expanded size"
        ));
    }
    Ok(bytes)
}

fn rootfile(container: &str) -> Result<(String, usize), String> {
    if container.contains("<!DOCTYPE") || container.contains("<!ENTITY") {
        return Err("MXL container DTD and entity declarations are forbidden".into());
    }
    let doc = Document::parse_with_options(
        container,
        ParsingOptions {
            allow_dtd: false,
            nodes_limit: 4096,
            entity_resolver: None,
        },
    )
    .map_err(|e| format!("Invalid MXL container.xml: {e}"))?;
    if doc.descendants().any(|n| n.is_pi()) {
        return Err("MXL container processing instructions are forbidden".into());
    }
    if doc.descendants().filter(|n| n.is_element()).any(|n| {
        n.tag_name()
            .namespace()
            .is_some_and(|ns| ns != "urn:oasis:names:tc:opendocument:xmlns:container")
    }) {
        return Err("Unsupported MXL container namespace".into());
    }
    let root = doc.root_element();
    if root.tag_name().name() != "container" {
        return Err("META-INF/container.xml must have a <container> root".into());
    }
    let children: Vec<_> = root.children().filter(|n| n.is_element()).collect();
    if children.len() != 1 || children[0].tag_name().name() != "rootfiles" {
        return Err("MXL container requires exactly one <rootfiles> element".into());
    }
    let files: Vec<_> = children[0].children().filter(|n| n.is_element()).collect();
    if files.is_empty()
        || files.len() > MAX_ENTRIES
        || files.iter().any(|n| n.tag_name().name() != "rootfile")
    {
        return Err("MXL container requires 1–128 <rootfile> entries".into());
    }
    let mut paths = HashSet::new();
    for (index, file) in files.iter().enumerate() {
        let path = file
            .attribute("full-path")
            .ok_or("Each MXL rootfile needs a full-path")?;
        safe_path(path, false)?;
        if !paths.insert(path) {
            return Err("Duplicate MXL rootfile references are unsupported".into());
        }
        let is_musicxml = file
            .attribute("media-type")
            .is_none_or(|m| m == "application/vnd.recordare.musicxml+xml");
        if index == 0 && !is_musicxml {
            return Err(
                "The first MXL rootfile must be MusicXML, not a PDF, audio file or other rendition"
                    .into(),
            );
        }
        if index > 0 && is_musicxml {
            return Err(
                "Multiple MusicXML root scores are unsupported; export one score per MXL file"
                    .into(),
            );
        }
        if file.children().any(|n| n.is_element()) {
            return Err("MXL <rootfile> cannot contain nested XML".into());
        }
    }
    Ok((
        files[0].attribute("full-path").unwrap().to_string(),
        files.len() - 1,
    ))
}

/// Read one bounded score from an MXL ZIP container, never extracting files.
/// The caller chooses how to retain the selected XML and the original container.
pub(crate) fn read_mxl_xml(bytes: &[u8]) -> Result<(String, String, Vec<Diagnostic>), String> {
    let expected_entries = preflight(bytes)?;
    let mut archive =
        ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("Invalid MXL ZIP archive: {e}"))?;
    if archive.len() != expected_entries {
        return Err("MXL ZIP contains ambiguous or duplicate entry metadata".into());
    }
    let mut names = HashSet::new();
    let mut file_count = 0;
    for index in 0..archive.len() {
        let file = archive
            .by_index_raw(index)
            .map_err(|e| format!("Invalid MXL entry: {e}"))?;
        safe_path(file.name(), file.is_dir())?;
        if !names.insert(file.name().to_string()) || file.is_symlink() || file.encrypted() {
            return Err("MXL contains duplicate, symbolic-link or encrypted entries".into());
        }
        if !matches!(
            file.compression(),
            CompressionMethod::Stored | CompressionMethod::Deflated
        ) {
            return Err("MXL supports only stored or DEFLATE entries".into());
        }
        if file.is_file() {
            file_count += 1;
        }
    }
    let mut container_warnings = Vec::new();
    if names.contains("mimetype") {
        {
            let file = archive
                .by_name("mimetype")
                .map_err(|e| format!("Invalid MXL mimetype: {e}"))?;
            if file.compression() != CompressionMethod::Stored
                || file.extra_data().is_some_and(|d| !d.is_empty())
            {
                return Err(
                    "MXL mimetype must be stored without compression or extra fields".into(),
                );
            }
        }
        if read_entry(&mut archive, "mimetype", 128)? != MIMETYPE {
            return Err("MXL mimetype content must be application/vnd.recordare.musicxml without whitespace".into());
        }
        if archive.name_for_index(0) != Some("mimetype") {
            container_warnings.push(warning(
                "mxl_mimetype_order",
                "MXL mimetype is not the first entry; the explicit container manifest was used.",
            ));
        }
    } else {
        container_warnings.push(warning("mxl_legacy_container","This older MXL container has no mimetype entry; its explicit container manifest was used."));
    }
    let container_bytes = read_entry(&mut archive, CONTAINER, MAX_CONTAINER)?;
    let container =
        std::str::from_utf8(&container_bytes).map_err(|_| "MXL container.xml must be UTF-8")?;
    let (score_path, alternate_count) = rootfile(container)?;
    if matches!(score_path.as_str(), CONTAINER | "mimetype") {
        return Err("MXL rootfile must point to a score, not container metadata".into());
    }
    let score_bytes = read_entry(&mut archive, &score_path, MAX_SCORE)?;
    let xml = std::str::from_utf8(&score_bytes).map_err(|_| "MXL score must be UTF-8 MusicXML")?;
    container_warnings.push(warning("mxl_source_retained", "The exact selected MusicXML source is retained. The ZIP container, embedded attachments and alternative renditions are not retained in the practice score; keep the original MXL file."));
    let expected_files = 2 + usize::from(names.contains("mimetype"));
    if file_count > expected_files || alternate_count > 0 {
        container_warnings.push(warning("mxl_attachments_ignored","Additional archive files or alternative renditions were not imported. Linked images, linked parts and external resources are unsupported."));
    }
    Ok((xml.to_string(), score_path, container_warnings))
}

pub fn import_mxl(bytes: &[u8]) -> Result<(Score, Vec<Diagnostic>), String> {
    let (xml, score_path, mut container_warnings) = read_mxl_xml(bytes)?;
    let (mut score, mut diagnostics) = import_musicxml(&xml)?;
    // The complete input remains inert. In particular, preserving an attachment
    // does not make it an imported part, displayed page or playable resource.
    let content = serde_json::to_string(&serde_json::json!({
        "version": 1,
        "selected_score_path": score_path,
        "files": {
            "original.mxl": {"encoding": "base64", "bytes": bytes.len(), "content": STANDARD.encode(bytes)},
            "selected.musicxml": {"encoding": "utf-8", "bytes": xml.len(), "content": xml}
        }
    }))
    .map_err(|error| format!("Cannot retain the complete MXL source: {error}"))?;
    for warning in &mut container_warnings {
        if warning.code == "mxl_source_retained" {
            warning.message = "The complete original MXL container and exact selected MusicXML are retained as inert source files. Ancillary files are preserved inside the original archive, but are not interpreted, displayed or played. Save canonical JSON or a library backup to keep the complete archive.".into();
        }
    }
    if let Some(source) = &mut score.source {
        source.format = "worldmusichub-mxl-archive-v1".into();
        source.filename = Some("retained-mxl.json".into());
        source.content = content;
        source
            .import_diagnostics
            .get_or_insert_with(Vec::new)
            .extend(container_warnings.iter().cloned());
    }
    // Full source preservation takes precedence over accepting a score that
    // cannot subsequently be saved or sent through the app's 8 MiB JSON route.
    // The download UI uses compact JSON if indentation would exceed the limit.
    let saved_bytes = serde_json::to_vec(&score)
        .map_err(|error| format!("Cannot serialize the archived MXL score: {error}"))?;
    if saved_bytes.len() > MAX_RETAINED_SCORE {
        return Err("The complete MXL archive plus its selected XML and canonical notes exceeds the 8 MiB saved-score limit. No attachment or source bytes were dropped. Keep the original MXL and import a smaller score, or separately export/import its MusicXML when an archive-preserving copy is not required.".into());
    }
    diagnostics.extend(container_warnings);
    Ok((score, diagnostics))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    const XML: &str = include_str!("../../../tests/fixtures/original-duet.musicxml");
    const MANIFEST: &str = "<container><rootfiles><rootfile full-path='scores/duet.musicxml' media-type='application/vnd.recordare.musicxml+xml'/></rootfiles></container>";
    fn zip_files(files: &[(&str, &[u8])], compression: CompressionMethod) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in files {
            let method = if *name == "mimetype" {
                CompressionMethod::Stored
            } else {
                compression
            };
            writer
                .start_file(
                    *name,
                    SimpleFileOptions::default().compression_method(method),
                )
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }
    fn mxl(manifest: &str, xml: &str) -> Vec<u8> {
        zip_files(
            &[
                ("mimetype", MIMETYPE),
                (CONTAINER, manifest.as_bytes()),
                ("scores/duet.musicxml", xml.as_bytes()),
            ],
            CompressionMethod::Deflated,
        )
    }
    fn position(bytes: &[u8], signature: &[u8]) -> usize {
        bytes
            .windows(signature.len())
            .position(|b| b == signature)
            .unwrap()
    }
    fn patch_u16(bytes: &mut [u8], offset: usize, value: u16) {
        bytes[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
    }
    fn patch_u32(bytes: &mut [u8], offset: usize, value: u32) {
        bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }
    #[test]
    fn imports_deflated_and_stored_scores_without_losing_archive_or_selected_xml() {
        for method in [CompressionMethod::Stored, CompressionMethod::Deflated] {
            let bytes = zip_files(
                &[
                    ("mimetype", MIMETYPE),
                    (CONTAINER, MANIFEST.as_bytes()),
                    ("scores/duet.musicxml", XML.as_bytes()),
                ],
                method,
            );
            let (score, warnings) = import_mxl(&bytes).unwrap();
            assert_eq!(score.parts.len(), 2);
            let source = score.source.as_ref().unwrap();
            assert_eq!(source.format, "worldmusichub-mxl-archive-v1");
            assert_eq!(source.filename.as_deref(), Some("retained-mxl.json"));
            let archive: serde_json::Value = serde_json::from_str(&source.content).unwrap();
            assert_eq!(archive["version"], 1);
            assert_eq!(archive["selected_score_path"], "scores/duet.musicxml");
            assert_eq!(archive["files"]["selected.musicxml"]["content"], XML);
            assert_eq!(archive["files"]["selected.musicxml"]["bytes"], XML.len());
            let original = &archive["files"]["original.mxl"];
            assert_eq!(original["bytes"], bytes.len());
            assert_eq!(
                STANDARD
                    .decode(original["content"].as_str().unwrap())
                    .unwrap(),
                bytes
            );
            assert!(warnings.iter().any(|d| d.code == "mxl_source_retained"));
            assert_eq!(score.provenance.kind, "user_import");
            assert!(score.provenance.license.is_none());
        }
    }
    #[test]
    fn reads_original_mxl_fixture() {
        let bytes = include_bytes!("../../../tests/fixtures/original-duet.mxl");
        let (score, _) = import_mxl(bytes).unwrap();
        let saved = serde_json::to_string(&score).unwrap();
        let reloaded: Score = serde_json::from_str(&saved).unwrap();
        assert_eq!(
            reloaded.source.as_ref().unwrap().content,
            score.source.as_ref().unwrap().content
        );
        let archive: serde_json::Value =
            serde_json::from_str(&reloaded.source.unwrap().content).unwrap();
        assert_eq!(archive["files"]["selected.musicxml"]["content"], XML);
        assert_eq!(
            STANDARD
                .decode(
                    archive["files"]["original.mxl"]["content"]
                        .as_str()
                        .unwrap()
                )
                .unwrap(),
            bytes
        );
        let (direct, _) = import_musicxml(XML).unwrap();
        let mut retained_model = score.clone();
        let mut direct_model = direct.clone();
        retained_model.source = None;
        direct_model.source = None;
        assert_eq!(
            serde_json::to_value(retained_model).unwrap(),
            serde_json::to_value(direct_model).unwrap(),
            "Archive retention leaves every canonical note, rest and musical map unchanged"
        );
        assert_eq!(
            serde_json::to_value(crate::compile(score).unwrap().timeline).unwrap(),
            serde_json::to_value(crate::compile(direct).unwrap().timeline).unwrap()
        );
    }
    #[test]
    fn older_archives_without_mimetype_are_explicitly_marked() {
        let bytes = zip_files(
            &[
                (CONTAINER, MANIFEST.as_bytes()),
                ("scores/duet.musicxml", XML.as_bytes()),
            ],
            CompressionMethod::Stored,
        );
        assert!(import_mxl(&bytes)
            .unwrap()
            .1
            .iter()
            .any(|d| d.code == "mxl_legacy_container"));
    }
    #[test]
    fn rejects_wrong_missing_or_ambiguous_rootfile() {
        for manifest in ["<container/>","<container><rootfiles/></container>","<container><rootfiles><rootfile full-path='missing.xml'/></rootfiles></container>","<container><rootfiles><rootfile full-path='image.pdf' media-type='application/pdf'/></rootfiles></container>","<container><rootfiles><rootfile full-path='scores/duet.musicxml'/><rootfile full-path='other.musicxml'/></rootfiles></container>"] {
            assert!(import_mxl(&mxl(manifest,XML)).is_err(),"{manifest}");
        }
        let bytes = zip_files(
            &[("duet.musicxml", XML.as_bytes())],
            CompressionMethod::Stored,
        );
        assert!(import_mxl(&bytes).is_err());
    }
    #[test]
    fn rejects_unsafe_rootfile_paths_and_entry_paths() {
        for path in [
            "../duet.musicxml",
            "/duet.musicxml",
            "C:/duet.musicxml",
            "https://example.invalid/score.xml",
            "scores\\duet.musicxml",
            "a/./b.xml",
            "a//b.xml",
        ] {
            let manifest = format!(
                "<container><rootfiles><rootfile full-path='{path}'/></rootfiles></container>"
            );
            assert!(import_mxl(&mxl(&manifest, XML)).is_err(), "{path}");
            assert!(
                import_mxl(&zip_files(
                    &[(path, XML.as_bytes())],
                    CompressionMethod::Stored
                ))
                .is_err(),
                "{path}"
            );
        }
    }
    #[test]
    fn rejects_container_entities_processing_and_bad_encoding() {
        for manifest in [
            "<!DOCTYPE container><container/>",
            "<?xml-stylesheet href='https://example.invalid/x'?><container/>",
            "<container xmlns='https://example.invalid'/>",
        ] {
            assert!(import_mxl(&mxl(manifest, XML)).is_err());
        }
        let bytes = zip_files(
            &[
                (CONTAINER, &[0xff]),
                ("scores/duet.musicxml", XML.as_bytes()),
            ],
            CompressionMethod::Stored,
        );
        assert!(import_mxl(&bytes).unwrap_err().contains("UTF-8"));
        let bytes = zip_files(
            &[
                (CONTAINER, MANIFEST.as_bytes()),
                ("scores/duet.musicxml", &[0xff]),
            ],
            CompressionMethod::Stored,
        );
        assert!(import_mxl(&bytes).unwrap_err().contains("UTF-8"));
    }
    #[test]
    fn rejects_truncated_encrypted_zip64_and_multi_disk_archives() {
        let good = mxl(MANIFEST, XML);
        assert!(import_mxl(b"not a zip").is_err());
        for length in [4, good.len() / 2, good.len() - 1] {
            assert!(import_mxl(&good[..length]).is_err());
        }
        let mut encrypted = good.clone();
        let central = position(&encrypted, b"PK\x01\x02");
        patch_u16(&mut encrypted, central + 8, 1);
        assert!(import_mxl(&encrypted).unwrap_err().contains("Encrypted"));
        let mut split = good.clone();
        let end = position(&split, b"PK\x05\x06");
        patch_u16(&mut split, end + 4, 1);
        assert!(import_mxl(&split).unwrap_err().contains("multi-disk"));
        let mut zip64 = good;
        patch_u16(&mut zip64, end + 8, u16::MAX);
        patch_u16(&mut zip64, end + 10, u16::MAX);
        assert!(import_mxl(&zip64).unwrap_err().contains("128"));
    }
    #[test]
    fn rejects_symlinks_duplicate_paths_and_filename_mismatches() {
        let mut links = mxl(MANIFEST, XML);
        let central = position(&links, b"PK\x01\x02");
        patch_u32(&mut links, central + 38, 0o120777_u32 << 16);
        assert!(import_mxl(&links).unwrap_err().contains("symbolic links"));
        let dupes = zip_files(
            &[("A.xml", b"a"), ("a.xml", b"b")],
            CompressionMethod::Stored,
        );
        assert!(import_mxl(&dupes).unwrap_err().contains("case-ambiguous"));
        let mut mismatched = mxl(MANIFEST, XML);
        mismatched[30] = b'X';
        assert!(import_mxl(&mismatched)
            .unwrap_err()
            .contains("filenames disagree"));
    }
    #[test]
    fn rejects_compressed_and_expanded_size_limits() {
        assert!(import_mxl(&vec![0; MAX_ARCHIVE + 1])
            .unwrap_err()
            .contains("8 MiB compressed"));
        let mut bomb = mxl(MANIFEST, XML);
        let central = position(&bomb, b"PK\x01\x02");
        patch_u32(&mut bomb, central + 24, MAX_SCORE as u32 + 1);
        assert!(import_mxl(&bomb).unwrap_err().contains("expanded limit"));
        let mut total_bomb = mxl(MANIFEST, XML);
        let central_headers: Vec<_> = total_bomb
            .windows(4)
            .enumerate()
            .filter_map(|(i, b)| (b == b"PK\x01\x02").then_some(i))
            .collect();
        for header in central_headers {
            patch_u32(&mut total_bomb, header + 24, MAX_SCORE as u32);
        }
        assert!(import_mxl(&total_bomb).unwrap_err().contains("16 MiB"));
        let manifest = " ".repeat(MAX_CONTAINER + 1);
        assert!(import_mxl(&mxl(&manifest, XML))
            .unwrap_err()
            .contains("65536-byte"));
    }
    #[test]
    fn underreported_expanded_sizes_cannot_bypass_bounded_reads() {
        // A highly compressible container claims one byte but inflates beyond
        // the container-specific cap. Both headers lie consistently.
        let oversized = " ".repeat(MAX_CONTAINER + 1);
        let mut bytes = zip_files(
            &[
                (CONTAINER, oversized.as_bytes()),
                ("scores/duet.musicxml", XML.as_bytes()),
            ],
            CompressionMethod::Deflated,
        );
        let central = position(&bytes, b"PK\x01\x02");
        patch_u32(&mut bytes, central + 24, 1);
        patch_u32(&mut bytes, 22, 1);
        assert!(import_mxl(&bytes).is_err());

        let mut normal = zip_files(
            &[
                (CONTAINER, MANIFEST.as_bytes()),
                ("scores/duet.musicxml", XML.as_bytes()),
            ],
            CompressionMethod::Stored,
        );
        let central = position(&normal, b"PK\x01\x02");
        patch_u32(&mut normal, central + 24, 1);
        patch_u32(&mut normal, 22, 1);
        assert!(import_mxl(&normal).is_err());
    }
    #[test]
    fn rejects_excess_entries_before_opening_archive() {
        let names: Vec<_> = (0..129).map(|i| format!("f{i}.xml")).collect();
        let entries: Vec<_> = names.iter().map(|n| (n.as_str(), &b"x"[..])).collect();
        assert!(import_mxl(&zip_files(&entries, CompressionMethod::Stored))
            .unwrap_err()
            .contains("128"));
    }
    #[test]
    fn ignored_alternate_renditions_and_attachments_are_reported() {
        let manifest = MANIFEST.replace(
            "</rootfiles>",
            "<rootfile full-path='preview.pdf' media-type='application/pdf'/></rootfiles>",
        );
        let bytes = zip_files(
            &[
                (CONTAINER, manifest.as_bytes()),
                ("scores/duet.musicxml", XML.as_bytes()),
                ("preview.pdf", b"original placeholder; not opened"),
            ],
            CompressionMethod::Stored,
        );
        let (score, diagnostics) = import_mxl(&bytes).unwrap();
        assert!(diagnostics
            .iter()
            .any(|d| d.code == "mxl_attachments_ignored"));
        let source: serde_json::Value =
            serde_json::from_str(&score.source.unwrap().content).unwrap();
        let retained = STANDARD
            .decode(source["files"]["original.mxl"]["content"].as_str().unwrap())
            .unwrap();
        assert_eq!(retained, bytes);
        let mut archive = ZipArchive::new(Cursor::new(retained.as_slice())).unwrap();
        assert_eq!(
            read_entry(&mut archive, "preview.pdf", 1024).unwrap(),
            b"original placeholder; not opened"
        );
    }
    #[test]
    fn rejects_crc_corruption_and_wrong_mimetype() {
        let mut corrupt = zip_files(
            &[
                (CONTAINER, MANIFEST.as_bytes()),
                ("scores/duet.musicxml", XML.as_bytes()),
            ],
            CompressionMethod::Stored,
        );
        let at = position(&corrupt, b"<container>");
        corrupt[at] = b'X';
        assert!(import_mxl(&corrupt).unwrap_err().contains("Corrupt"));
        let bytes = zip_files(
            &[
                ("mimetype", b"application/zip"),
                (CONTAINER, MANIFEST.as_bytes()),
                ("scores/duet.musicxml", XML.as_bytes()),
            ],
            CompressionMethod::Stored,
        );
        assert!(import_mxl(&bytes).unwrap_err().contains("mimetype content"));
    }
    #[test]
    fn underlying_musicxml_safety_checks_still_apply() {
        assert!(
            import_mxl(&mxl(MANIFEST, "<!DOCTYPE score-partwise><score-partwise/>"))
                .unwrap_err()
                .contains("DTD")
        );
        assert!(import_mxl(&mxl(MANIFEST, "<score-timewise/>"))
            .unwrap_err()
            .contains("score-partwise"));
    }
}
