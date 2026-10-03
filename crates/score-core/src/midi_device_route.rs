//! MIDI RP-019 DeviceName is a logical output route, not descriptive metadata.
//! This profile resolves only one completely named device with track-local channels.
use crate::{clean_song::Coordinate, Beat};
use std::collections::{BTreeMap, BTreeSet};

/// WMH label bounds, not an RP-019 encoding requirement. A DeviceName is a
/// literal logical identifier, retaining the existing plain-text payload guards.
pub(crate) fn valid_name(name: &str) -> bool {
    valid_structural_text(name) && !name.trim().is_empty() && !name.chars().any(char::is_control)
}
/// Preserve the existing structural allowance for textual line breaks/tabs.
/// Such labels remain unresolved by valid_name and cannot select a receiver.
pub(crate) fn valid_structural_text(name: &str) -> bool {
    name.len() <= 4096
        && !name
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
        && !name
            .lines()
            .any(|line| line.trim_start().starts_with("DM:"))
        && !name
            .split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '+' | '/' | '='))
            .any(|word| word.len() > 256)
}

#[derive(Default)]
pub(crate) struct Evidence {
    names: BTreeMap<u16, Vec<(Coordinate, Beat, String)>>,
    first_addressed: BTreeMap<u16, u32>,
    channel_tracks: BTreeSet<u16>,
    owners: BTreeMap<u8, BTreeSet<u16>>,
    other_routing: bool,
}
impl Evidence {
    pub(crate) fn device_name(&mut self, origin: Coordinate, at: Beat, name: &str) {
        self.names
            .entry(origin.track)
            .or_default()
            .push((origin, at, name.into()));
    }
    /// ProgramName must follow DeviceName even when no channel command precedes it.
    pub(crate) fn program_name(&mut self, origin: Coordinate) {
        self.first_addressed
            .entry(origin.track)
            .and_modify(|value| *value = (*value).min(origin.event))
            .or_insert(origin.event);
    }
    pub(crate) fn channel(&mut self, origin: Coordinate, channel: u8) {
        self.program_name(origin);
        self.channel_tracks.insert(origin.track);
        self.owners.entry(channel).or_default().insert(origin.track);
    }
    pub(crate) fn other_routing(&mut self) {
        self.other_routing = true;
    }
    pub(crate) fn resolve(&self) -> Result<Option<String>, String> {
        if self.names.is_empty() {
            return Ok(None);
        }
        if self.other_routing || self.owners.values().any(|tracks| tracks.len() != 1) {
            return Err("DeviceName routing requires one source track per channel and no other routing mechanism".into());
        }
        let mut selected: Option<&str> = None;
        for (&track, names) in &self.names {
            if names.len() != 1 {
                return Err("DeviceName routing requires exactly one name per named track; repeats and changes are unresolved".into());
            }
            let (origin, at, name) = &names[0];
            if !valid_name(name)
                || !at.valid()
                || !at.equivalent(Beat::ZERO)
                || self
                    .first_addressed
                    .get(&track)
                    .is_some_and(|first| origin.event >= *first)
            {
                return Err("DeviceName routing requires a bounded nonblank control-free name at zero before channel messages and ProgramName".into());
            }
            if selected.is_some_and(|value| value != name) {
                return Err(
                    "Multiple logical DeviceName outputs require an explicit per-device mapping"
                        .into(),
                );
            }
            selected = Some(name);
        }
        if self
            .channel_tracks
            .iter()
            .any(|track| !self.names.contains_key(track))
        {
            return Err("Mixed named and unnamed/default DeviceName routes are unresolved".into());
        }
        Ok(selected.map(str::to_owned))
    }
}
