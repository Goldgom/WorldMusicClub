//! Bounded standard ZIP inventory; never extracts user paths.
use super::{MAX_ENTRY_BYTES, MAX_EXPANDED_BYTES, MAX_PACK_BYTES, MAX_ZIP_ENTRIES};
use std::collections::HashSet;
fn u16_at(bytes: &[u8], offset: usize) -> std::result::Result<u16, String> {
    let b = bytes
        .get(offset..offset + 2)
        .ok_or("Truncated Song pack ZIP header")?;
    Ok(u16::from_le_bytes([b[0], b[1]]))
}
fn u32_at(bytes: &[u8], offset: usize) -> std::result::Result<u32, String> {
    let b = bytes
        .get(offset..offset + 4)
        .ok_or("Truncated Song pack ZIP header")?;
    Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}
pub(super) fn safe_path(path: &str, directory: bool) -> std::result::Result<(), String> {
    if path.is_empty()
        || path.len() > 1024
        || path.starts_with('/')
        || path.contains(['\\', ':'])
        || path.chars().any(char::is_control)
    {
        return Err("Song pack paths must be short, relative UTF-8 paths without URLs, drive letters, backslashes or control characters".into());
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
        return Err(
            "Song pack paths cannot contain empty, dot or parent-directory components".into(),
        );
    }
    Ok(())
}

fn safe_extras(
    bytes: &[u8],
    start: usize,
    len: usize,
    local_sizes: Option<(u64, u64)>,
) -> std::result::Result<(), String> {
    let end = start.checked_add(len).ok_or("ZIP extra field overflow")?;
    if end > bytes.len() {
        return Err("Truncated ZIP extra fields".into());
    }
    let mut at = start;
    let mut found_zip64 = false;
    while at < end {
        if at + 4 > end {
            return Err("Truncated ZIP extra-field header".into());
        }
        let kind = u16_at(bytes, at)?;
        let size = u16_at(bytes, at + 2)? as usize;
        if kind == 0x7075 {
            return Err("UnicodePath name-transforming extra fields are unsupported".into());
        }
        if kind == 0x0001 {
            if found_zip64 {
                return Err("Duplicate ZIP64 extra fields are unsupported".into());
            }
            found_zip64 = true;
            let Some((expanded, compressed)) = local_sizes else {
                return Err("Central ZIP64 override extra fields are unsupported".into());
            };
            if size != 16 || at + 20 > end {
                return Err("Only exact local ZIP64 size placeholders are supported".into());
            }
            let actual_expanded = u64::from_le_bytes(
                bytes[at + 4..at + 12]
                    .try_into()
                    .map_err(|_| "Truncated ZIP64 size")?,
            );
            let actual_compressed = u64::from_le_bytes(
                bytes[at + 12..at + 20]
                    .try_into()
                    .map_err(|_| "Truncated ZIP64 size")?,
            );
            if actual_expanded != expanded || actual_compressed != compressed {
                return Err("Local ZIP64 sizes disagree with the bounded central directory".into());
            }
        }
        at = at.checked_add(4 + size).ok_or("ZIP extra-field overflow")?;
        if at > end {
            return Err("Truncated ZIP extra-field data".into());
        }
    }
    Ok(())
}

/// Bound directory metadata *before* the ZIP library allocates for entry counts.
/// Central ZIP64, split archives, preambles, ambiguous paths, unsupported compression and
/// overlapping local records are deliberately excluded from this small importer.
pub(super) fn preflight(bytes: &[u8]) -> std::result::Result<usize, String> {
    if bytes.len() > MAX_PACK_BYTES {
        return Err("Song pack exceeds the 128 MiB compressed archive limit".into());
    }
    if !bytes.starts_with(b"PK\x03\x04") {
        return Err("Song pack must be a nonempty standard ZIP archive without a preamble".into());
    }
    let search_start = bytes.len().saturating_sub(65_557);
    let eocd = (search_start..bytes.len().saturating_sub(21))
        .rev()
        .find(|&p| {
            bytes.get(p..p + 4) == Some(b"PK\x05\x06")
                && u16_at(bytes, p + 20).is_ok_and(|n| p + 22 + n as usize == bytes.len())
        })
        .ok_or("Song pack ZIP end record is missing or truncated")?;
    let entries = u16_at(bytes, eocd + 10)? as usize;
    if u16_at(bytes, eocd + 4)? != 0
        || u16_at(bytes, eocd + 6)? != 0
        || u16_at(bytes, eocd + 8)? as usize != entries
    {
        return Err("Split or multi-disk Song pack archives are unsupported".into());
    }
    if entries == 0 || entries > MAX_ZIP_ENTRIES {
        return Err(
            "Song pack must contain 1–4096 ZIP entries; ZIP64 containers are unsupported".into(),
        );
    }
    let directory_size = u32_at(bytes, eocd + 12)? as usize;
    let directory_start = u32_at(bytes, eocd + 16)? as usize;
    if directory_start.checked_add(directory_size) != Some(eocd) {
        return Err(
            "Invalid, extended or ZIP64 Song pack central directory; export an ordinary Song pack archive"
                .into(),
        );
    }
    let mut pos = directory_start;
    let mut total_size = 0_u64;
    let mut names = HashSet::new();
    let mut ranges = Vec::with_capacity(entries);
    for _ in 0..entries {
        if bytes.get(pos..pos.saturating_add(4)) != Some(b"PK\x01\x02") {
            return Err("Invalid Song pack central directory entry".into());
        }
        let flags = u16_at(bytes, pos + 8)?;
        let method = u16_at(bytes, pos + 10)?;
        if flags & 1 != 0 || flags & 0x40 != 0 {
            return Err(
                "Encrypted Song pack files are unsupported; export without a password".into(),
            );
        }
        if !matches!(method, 0 | 8) {
            return Err("Song pack supports only stored or DEFLATE entries".into());
        }
        if u16_at(bytes, pos + 34)? != 0 {
            return Err("Split Song pack archives are unsupported".into());
        }
        let compressed = u32_at(bytes, pos + 20)? as usize;
        let expanded = u32_at(bytes, pos + 24)? as u64;
        total_size = total_size
            .checked_add(expanded)
            .ok_or("Song pack expanded sizes overflow")?;
        if expanded > MAX_ENTRY_BYTES as u64 || total_size > MAX_EXPANDED_BYTES {
            return Err(
                "Song pack exceeds the 64 MiB per-file or 2 GiB total expanded limit".into(),
            );
        }
        let name_len = u16_at(bytes, pos + 28)? as usize;
        let extra_len = u16_at(bytes, pos + 30)? as usize;
        let comment_len = u16_at(bytes, pos + 32)? as usize;
        let next = pos
            .checked_add(46 + name_len + extra_len + comment_len)
            .ok_or("Song pack directory size overflow")?;
        if next > eocd {
            return Err("Truncated Song pack central directory".into());
        }
        safe_extras(bytes, pos + 46 + name_len, extra_len, None)?;
        let name_bytes = &bytes[pos + 46..pos + 46 + name_len];
        let name =
            std::str::from_utf8(name_bytes).map_err(|_| "Song pack entry names must be UTF-8")?;
        let directory = name.ends_with('/');
        safe_path(name, directory)?;
        if !names.insert(name.to_lowercase()) {
            return Err("Duplicate or case-ambiguous Song pack entry paths are unsupported".into());
        }
        let file_type = (u32_at(bytes, pos + 38)? >> 16) & 0o170000;
        if !matches!(file_type, 0 | 0o100000 | 0o040000) {
            return Err("Song pack symbolic links, devices and special files are forbidden".into());
        }
        if (directory || file_type == 0o040000) && expanded != 0 {
            return Err("Song pack directory entries cannot contain data".into());
        }
        let local = u32_at(bytes, pos + 42)? as usize;
        if bytes.get(local..local.saturating_add(4)) != Some(b"PK\x03\x04") {
            return Err("Invalid Song pack local file header".into());
        }
        if u16_at(bytes, local + 6)? != flags || u16_at(bytes, local + 8)? != method {
            return Err("Song pack local and central compression headers disagree".into());
        }
        let local_name_len = u16_at(bytes, local + 26)? as usize;
        let local_extra_len = u16_at(bytes, local + 28)? as usize;
        if bytes.get(local + 30..local + 30 + local_name_len) != Some(name_bytes) {
            return Err("Song pack local and central filenames disagree".into());
        }
        safe_extras(
            bytes,
            local + 30 + local_name_len,
            local_extra_len,
            Some((expanded, compressed as u64)),
        )?;
        let data_end = local
            .checked_add(30 + local_name_len + local_extra_len)
            .and_then(|p| p.checked_add(compressed))
            .ok_or("Song pack file size overflow")?;
        if data_end > directory_start {
            return Err("Song pack file contents overlap the central directory".into());
        }
        ranges.push((local, data_end));
        pos = next;
    }
    if pos != eocd {
        return Err("Song pack entry count does not match its central directory".into());
    }
    ranges.sort_unstable();
    if ranges.windows(2).any(|pair| pair[0].1 > pair[1].0) {
        return Err("Overlapping Song pack file records are forbidden".into());
    }
    Ok(entries)
}
