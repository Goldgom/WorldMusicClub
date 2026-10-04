//! Stateless whole-source clean-song preparation for the built-in authoring UI.
//! An artifact is a candidate, never receiver/notation/scoring acceptance. Draft
//! creation neither writes files nor changes a library, active song or session.
use crate::{
    clean_performance, clean_song,
    midi_events::{self, ChannelMessage, EventKind, RawMidiTimeline},
    Beat,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

#[cfg(test)]
mod tests;
mod vsq;
#[cfg(test)]
mod vsq_tests;

pub const MAX_TITLE_BYTES: usize = 1000;
pub const MAX_SOURCE_NAME_BYTES: usize = 255;
// Portable authoring artifacts must fit the existing native clean receiver.
pub const MAX_PACKAGE_SCORE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_PACKAGE_METADATA_BYTES: usize = 256 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum State {
    StrictNotationCandidate,
    EventOnlyReferenceCandidate,
    VsqAuthoringCandidate,
    Rejected,
}
#[derive(Clone, Debug, Serialize)]
pub struct Diagnostic {
    pub code: String,
    pub message: String,
    pub source_event_id: Option<String>,
    pub track_index: Option<u16>,
    pub action: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct ChannelInventory {
    pub channel: u8,
    pub source_event_count: usize,
    pub key_attacks: usize,
    pub key_releases: usize,
}
#[derive(Clone, Debug, Serialize)]
pub struct TrackInventory {
    pub source_index: u16,
    pub track_id: String,
    pub name: String,
    pub source_event_count: usize,
    pub channels: Vec<ChannelInventory>,
    pub key_attacks: usize,
    pub key_releases: usize,
    pub first_event_id: Option<String>,
    pub last_event_id: Option<String>,
    pub end: Beat,
}
#[derive(Clone, Debug, Serialize)]
pub struct PartInventory {
    pub id: String,
    pub track_id: String,
    pub channel: Option<u8>,
    pub notation_available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vsq: Option<VsqPartInventory>,
}
#[derive(Clone, Debug, Serialize)]
pub struct VsqPartInventory {
    pub name: String,
    pub source_track_index: u16,
    pub notes: usize,
    pub singers: usize,
    pub lyrics: usize,
    pub curves: usize,
    pub curve_points: usize,
    pub mute: bool,
    pub solo: bool,
    pub master_mute: bool,
}
#[derive(Clone, Debug, Serialize)]
pub struct Inventory {
    pub source_tracks: usize,
    pub source_events: usize,
    pub ppq: u16,
    pub key_attacks: usize,
    pub key_releases: usize,
    pub tracks: Vec<TrackInventory>,
    pub parts: Vec<PartInventory>,
}
#[derive(Clone, Debug, Serialize)]
pub struct Package {
    pub metadata_json: String,
    pub score_json: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct Draft {
    pub state: State,
    pub source: clean_song::SourceEvidence,
    pub source_name: String,
    pub title: String,
    pub inventory: Option<Inventory>,
    pub diagnostics: Vec<Diagnostic>,
    pub package: Option<Package>,
    pub draft_sha256: Option<String>,
}
/// Transport options remain separate from raw source bytes in the core API.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub source_base64: String,
    pub source_name: String,
    pub title: String,
}
#[derive(Debug)]
pub struct RequestError {
    pub message: String,
    pub source_limit: bool,
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn diagnostic(code: &str, message: String, action: &str) -> Diagnostic {
    Diagnostic {
        code: code.into(),
        message,
        source_event_id: None,
        track_index: None,
        action: action.into(),
    }
}
fn presentation(value: &str, max: usize, label: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > max || value.chars().any(char::is_control) {
        return Err(format!("{label} must be nonempty, at most {max} UTF-8 bytes, and contain no control characters"));
    }
    Ok(())
}
pub fn prepare_request(request: Request) -> Result<Draft, RequestError> {
    use base64::Engine;
    if request.source_base64.len() > midi_events::MAX_SOURCE_BYTES.div_ceil(3) * 4 {
        return Err(RequestError {
            message: "Original MIDI/VSQ exceeds the 5 MiB source limit".into(),
            source_limit: true,
        });
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&request.source_base64)
        .map_err(|_| RequestError {
            message: "Original MIDI/VSQ must use valid standard Base64".into(),
            source_limit: false,
        })?;
    if bytes.len() > midi_events::MAX_SOURCE_BYTES {
        return Err(RequestError {
            message: "Original MIDI/VSQ exceeds the 5 MiB source limit".into(),
            source_limit: true,
        });
    }
    prepare_midi(&bytes, &request.title, &request.source_name).map_err(|message| RequestError {
        message,
        source_limit: false,
    })
}
/// Recognize framed VSQ project text before the generic MIDI reader, then use
/// the existing complete converter. Other SMF sources take strict notation
/// first, otherwise independent typed events; never partial-song fallback.
pub fn prepare_midi(bytes: &[u8], title: &str, source_name: &str) -> Result<Draft, String> {
    presentation(title, MAX_TITLE_BYTES, "Title")?;
    presentation(source_name, MAX_SOURCE_NAME_BYTES, "Source name")?;
    if bytes.len() > midi_events::MAX_SOURCE_BYTES {
        return Err("Original MIDI/VSQ exceeds the 5 MiB source limit".into());
    }
    let source = clean_song::SourceEvidence {
        format: "midi".into(),
        bytes: bytes.len(),
        sha256: hash(bytes),
    };
    let mut draft = Draft {
        state: State::Rejected,
        source,
        source_name: source_name.to_owned(),
        title: title.to_owned(),
        inventory: None,
        diagnostics: vec![],
        package: None,
        draft_sha256: None,
    };
    if vsq::prepare(bytes, &mut draft)? {
        return Ok(draft);
    }
    let timeline = match midi_events::parse_midi_events(bytes, None) {
        Ok(timeline) => timeline,
        Err(error) => {
            draft.diagnostics.push(diagnostic("source_rejected", error.message, "Keep the original source; export a supported complete format-0/1 PPQ MIDI or resolve the reported source error."));
            return Ok(draft);
        }
    };
    draft.inventory = Some(inventory(&timeline));
    // Parser diagnostics have a fixed vocabulary and bounded occurrence totals.
    for warning in timeline.diagnostics() {
        if warning.code() == midi_events::DiagnosticCode::RawEventsOnly {
            continue;
        }
        draft.diagnostics.push(Diagnostic {
            code: format!("source_{:?}", warning.code()).to_lowercase(), message: warning.message().into(),
            source_event_id: warning.first_event().map(|id| id.stable_id()),
            track_index: warning.first_event().map(|id| id.track_index()),
            action: "Review the source semantics; conversion status and playback admission are independent.".into(),
        });
    }
    let id = format!("midi-clean-{}", draft.source.sha256);
    let strict = clean_song::convert_midi(bytes).and_then(|mut score| {
        score.notation.id = id.clone();
        score.notation.title = title.to_owned();
        let encoded = clean_song::encode_json(&score)?;
        // Compile the exact authoritative bytes; the receiver still decides
        // whether their rendition semantics are supported when opening them.
        clean_song::compile_complete(&clean_song::decode_json(&encoded)?)?;
        Ok((score, encoded))
    });
    let score_bytes = match strict {
        Ok((score, encoded)) => {
            draft.state = State::StrictNotationCandidate;
            draft.inventory.as_mut().expect("parsed inventory").parts = score
                .performance
                .parts
                .iter()
                .map(|part| PartInventory {
                    id: part.id.clone(),
                    track_id: part.track_id.clone(),
                    channel: Some(part.channel),
                    notation_available: true,
                    vsq: None,
                })
                .collect();
            encoded
        }
        Err(strict_error) => {
            draft.diagnostics.push(diagnostic("strict_notation_unavailable", strict_error, "Keep independent source events; do not infer note pairings or claim practice/scoring availability."));
            let performance =
                clean_performance::convert_midi_detailed(bytes, &id, title).and_then(|score| {
                    let encoded = clean_performance::encode_json(&score)?;
                    clean_performance::compile_performance(&encoded)?;
                    Ok((score, encoded))
                });
            match performance {
                Ok((score, encoded)) => {
                    draft.state = State::EventOnlyReferenceCandidate;
                    draft.inventory.as_mut().expect("parsed inventory").parts = score
                        .performance
                        .parts
                        .iter()
                        .map(|part| PartInventory {
                            id: part.id.clone(),
                            track_id: part.track_id.clone(),
                            channel: Some(part.channel),
                            notation_available: false,
                            vsq: None,
                        })
                        .collect();
                    encoded
                }
                Err(error) => {
                    let mut failure = diagnostic("complete_conversion_rejected", error.message, "Resolve this unsupported source meaning in a complete supported source; no tracks or events were discarded and no partial package was produced.");
                    if let Some(origin) = error.origin {
                        failure.track_index = Some(origin.track);
                        failure.source_event_id = Some(format!(
                            "midi:{}:t{}:e{}",
                            draft.source.sha256, origin.track, origin.event
                        ));
                    }
                    draft.diagnostics.push(failure);
                    return Ok(draft);
                }
            }
        }
    };
    let metadata = serde_json::json!({
        "format":"worldmusichub-song", "version":2, "id":id, "title":title,
        "score":{"path":"score.json","bytes":score_bytes.len(),"sha256":hash(&score_bytes)},
        "sources":[draft.source],
        "rights":{"status":"user_supplied_unverified","attribution":"User-supplied MIDI; source rights are unverified","license":null},
        "media":[]
    });
    let package = Package {
        metadata_json: serde_json::to_string_pretty(&metadata).map_err(|e| e.to_string())?,
        score_json: String::from_utf8(score_bytes).map_err(|e| e.to_string())?,
    };
    install_package(&mut draft, package);
    Ok(draft)
}
fn install_package(draft: &mut Draft, package: Package) {
    if reject_package_size(draft, package.score_json.len(), package.metadata_json.len()) {
        return;
    }
    let mut digest = Sha256::new();
    digest.update(b"worldmusichub-clean-draft-v1\0");
    for bytes in [
        package.metadata_json.as_bytes(),
        package.score_json.as_bytes(),
    ] {
        digest.update((bytes.len() as u64).to_be_bytes());
        digest.update(bytes);
    }
    draft.draft_sha256 = Some(format!("{:x}", digest.finalize()));
    draft.package = Some(package);
}
fn reject_package_size(draft: &mut Draft, score_bytes: usize, metadata_bytes: usize) -> bool {
    if score_bytes > MAX_PACKAGE_SCORE_BYTES || metadata_bytes > MAX_PACKAGE_METADATA_BYTES {
        draft.state = State::Rejected;
        draft.diagnostics.push(diagnostic(
            "complete_package_limit",
            "Complete package exceeds the native 16 MiB score or 256 KiB metadata limit".into(),
            "Keep the complete original source; no tracks, notes, or authoring fields were trimmed and no partial package was produced.",
        ));
        return true;
    }
    false
}
impl Draft {
    /// Read-only ZIP generation. No source filename, original bytes, audit,
    /// runtime or inventory is part of the portable package.
    pub fn pack(&self) -> Result<Vec<u8>, String> {
        let package = self
            .package
            .as_ref()
            .ok_or("Rejected conversion has no complete package")?;
        let mut writer = crate::clean_pack::Writer::new();
        writer.add_song(
            &format!("songs/{}-{}", self.source.format, self.source.sha256),
            BTreeMap::from([
                (
                    "metadata.json".into(),
                    package.metadata_json.as_bytes().to_vec(),
                ),
                ("score.json".into(), package.score_json.as_bytes().to_vec()),
            ]),
        )?;
        writer.finish()
    }
}
fn inventory(timeline: &RawMidiTimeline) -> Inventory {
    let mut tracks: Vec<_> = (0..timeline.track_count())
        .map(|source_index| TrackInventory {
            source_index,
            track_id: format!("track-{}", source_index + 1),
            name: format!("Track {}", source_index + 1),
            source_event_count: 0,
            channels: vec![],
            key_attacks: 0,
            key_releases: 0,
            first_event_id: None,
            last_event_id: None,
            end: Beat::ZERO,
        })
        .collect();
    let mut routes: BTreeMap<(u16, u8), ChannelInventory> = BTreeMap::new();
    for event in timeline.events() {
        let track = &mut tracks[usize::from(event.id().track_index())];
        track.source_event_count += 1;
        track.end = event.beat();
        track
            .first_event_id
            .get_or_insert_with(|| event.id().stable_id());
        track.last_event_id = Some(event.id().stable_id());
        match event.kind() {
            EventKind::Channel { channel, message } => {
                let route =
                    routes
                        .entry((track.source_index, *channel))
                        .or_insert(ChannelInventory {
                            channel: *channel,
                            source_event_count: 0,
                            key_attacks: 0,
                            key_releases: 0,
                        });
                route.source_event_count += 1;
                match message {
                    ChannelMessage::NoteOn { velocity, .. } if *velocity > 0 => {
                        route.key_attacks += 1;
                        track.key_attacks += 1;
                    }
                    ChannelMessage::NoteOn { .. } | ChannelMessage::NoteOff { .. } => {
                        route.key_releases += 1;
                        track.key_releases += 1;
                    }
                    _ => {}
                }
            }
            EventKind::Meta { meta_type: 3, data } => {
                if let Ok(name) = std::str::from_utf8(data) {
                    track.name = name.chars().filter(|c| !c.is_control()).take(200).collect();
                }
            }
            _ => {}
        }
    }
    for ((index, _), channel) in routes {
        tracks[usize::from(index)].channels.push(channel);
    }
    Inventory {
        source_tracks: tracks.len(),
        source_events: timeline.events().len(),
        ppq: timeline.ppq(),
        key_attacks: tracks.iter().map(|track| track.key_attacks).sum(),
        key_releases: tracks.iter().map(|track| track.key_releases).sum(),
        tracks,
        parts: vec![],
    }
}
