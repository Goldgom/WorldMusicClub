//! Bounded SMF SMPTE-origin semantics, independent of the PPQ tempo clock.
//! No nonzero timecode conversion or external device synchronization is inferred.
use crate::Beat;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrameRate {
    Fps24,
    Fps25,
    DropFrame30,
    Fps30,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Timecode {
    pub frame_rate: FrameRate,
    pub hours: u8,
    pub minutes: u8,
    pub seconds: u8,
    pub frames: u8,
    pub fractional_frames: u8,
}
impl Timecode {
    pub(crate) fn decode(data: &[u8]) -> Result<Self, String> {
        let [hour, minutes, seconds, frames, fractional_frames] = data else {
            return Err("Malformed SMPTE offset payload length".into());
        };
        let frame_rate = match (hour >> 5) & 3 {
            0 => FrameRate::Fps24,
            1 => FrameRate::Fps25,
            2 => FrameRate::DropFrame30,
            _ => FrameRate::Fps30,
        };
        let frame_limit = match frame_rate {
            FrameRate::Fps24 => 24,
            FrameRate::Fps25 => 25,
            _ => 30,
        };
        if hour & 0x80 != 0
            || hour & 31 > 23
            || *minutes > 59
            || *seconds > 59
            || *frames >= frame_limit
            || *fractional_frames > 99
        {
            return Err("Malformed SMPTE offset timecode fields".into());
        }
        let result = Self {
            frame_rate,
            hours: hour & 31,
            minutes: *minutes,
            seconds: *seconds,
            frames: *frames,
            fractional_frames: *fractional_frames,
        };
        result.validate_zero()?;
        Ok(result)
    }
    pub(crate) fn validate_zero(&self) -> Result<(), String> {
        if self.hours != 0
            || self.minutes != 0
            || self.seconds != 0
            || self.frames != 0
            || self.fractional_frames != 0
        {
            return Err("Only a zero SMPTE absolute-time offset is supported".into());
        }
        Ok(())
    }
}
/// State is observed in source-coordinate order. Only first-track channel
/// messages affect placement; another track has no defined same-tick ordering.
#[derive(Default)]
pub(crate) struct Placement {
    seen: bool,
    first_track_channel_seen: bool,
}
impl Placement {
    pub(crate) fn channel(&mut self, track: u16) {
        self.first_track_channel_seen |= track == 0;
    }
    pub(crate) fn offset(
        &mut self,
        timecode: &Timecode,
        track: u16,
        at: Beat,
    ) -> Result<(), String> {
        timecode.validate_zero()?;
        if self.seen
            || track != 0
            || !at.valid()
            || !at.equivalent(Beat::ZERO)
            || self.first_track_channel_seen
        {
            return Err(
                "SMPTE offset must occur once on track zero at tick zero before channel messages"
                    .into(),
            );
        }
        self.seen = true;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{clean_performance as typed, clean_song as strict};
    // Independently authored, small events only; no supplied source music.
    fn smf(tracks: &[Vec<(u8, Vec<u8>)>], division: u16) -> Vec<u8> {
        let mut bytes = b"MThd\0\0\0\x06".to_vec();
        bytes.extend_from_slice(&(if tracks.len() == 1 { 0u16 } else { 1 }).to_be_bytes());
        bytes.extend_from_slice(&(tracks.len() as u16).to_be_bytes());
        bytes.extend_from_slice(&division.to_be_bytes());
        for events in tracks {
            let mut track = vec![];
            for (delta, data) in events {
                track.push(*delta);
                track.extend(data);
            }
            bytes.extend_from_slice(b"MTrk");
            bytes.extend_from_slice(&(track.len() as u32).to_be_bytes());
            bytes.extend(track);
        }
        bytes
    }
    fn offset(hour: u8) -> Vec<u8> {
        vec![255, 84, 5, hour, 0, 0, 0, 0]
    }
    fn end() -> (u8, Vec<u8>) {
        (0, vec![255, 47, 0])
    }
    fn notes() -> Vec<(u8, Vec<u8>)> {
        vec![
            (0, vec![0xc0, 0]),
            (1, vec![0x90, 60, 90]),
            (2, vec![0x80, 60, 0]),
            end(),
        ]
    }
    fn convert(bytes: &[u8]) -> Result<typed::CompletePerformance, String> {
        typed::convert_midi(bytes, "timecode-test", "Original offset exercise")
    }
    fn reject_all(bytes: &[u8]) {
        assert!(
            crate::import_midi(bytes).is_err(),
            "canonical importer accepted"
        );
        assert!(
            strict::convert_midi(bytes).is_err(),
            "strict converter accepted"
        );
        assert!(convert(bytes).is_err(), "typed converter accepted");
    }
    #[test]
    fn preserves_all_four_rate_identities_zero_clock_and_every_coordinate() {
        for (hour, rate) in [
            (0, FrameRate::Fps24),
            (32, FrameRate::Fps25),
            (64, FrameRate::DropFrame30),
            (96, FrameRate::Fps30),
        ] {
            for format_one in [false, true] {
                let mut first = vec![(0, vec![255, 3, 1, b'A']), (0, offset(hour))];
                let tracks = if format_one {
                    first.push(end());
                    vec![first, notes()]
                } else {
                    first.extend(notes());
                    vec![first]
                };
                let bytes = smf(&tracks, 3);
                let source = crate::midi_events::parse_midi_events(&bytes, None).unwrap();
                let performance = convert(&bytes).unwrap();
                let encoded = typed::encode_json(&performance).unwrap();
                let runtime = typed::compile_performance(&encoded).unwrap();
                assert!(matches!(performance.performance.events[1].command,
                    typed::Command::SmpteOffset { timecode } if timecode.frame_rate == rate));
                assert_eq!(
                    encoded,
                    typed::encode_json(&typed::decode_json(&encoded).unwrap()).unwrap()
                );
                assert_eq!(runtime.events.len(), source.events().len());
                for (actual, original) in runtime.events.iter().zip(source.events()) {
                    assert_eq!(actual.event_id, original.id().stable_id());
                    assert_eq!(
                        actual.exact_microseconds.numerator,
                        original
                            .relative_microseconds()
                            .unwrap()
                            .numerator()
                            .to_string()
                    );
                    assert_eq!(
                        actual.exact_microseconds.denominator,
                        u64::from(original.relative_microseconds().unwrap().denominator())
                    );
                }
                let score = strict::convert_midi(&bytes).unwrap();
                assert!(matches!(score.performance.events[1].command,
                    strict::Command::SmpteOffset { timecode } if timecode.frame_rate == rate));
                assert_eq!(score.coverage.source_events, source.events().len());
                assert_eq!(score.coverage.represented_events, source.events().len());
                let json = strict::encode_json(&score).unwrap();
                let loaded = strict::decode_json(&json).unwrap();
                assert_eq!(json, strict::encode_json(&loaded).unwrap());
                let runtime = strict::compile_complete(&loaded).unwrap();
                assert_eq!(runtime.duration_microseconds.numerator, "500000");
                assert_eq!(runtime.duration_microseconds.denominator, 1);
                assert_eq!(runtime.notes.len(), 1);
                assert!(!String::from_utf8(json).unwrap().contains("source_range"));
            }
        }
    }
    #[test]
    fn rejects_nonzero_malformed_conflicting_and_misplaced_offsets() {
        let mut invalid = vec![
            vec![255, 84, 4, 0, 0, 0, 0],
            vec![255, 84, 6, 0, 0, 0, 0, 0, 0],
        ];
        for (field, value) in [
            (0, 128),
            (0, 24),
            (1, 60),
            (2, 60),
            (3, 24),
            (4, 100),
            (0, 1),
            (1, 1),
            (2, 1),
            (3, 1),
            (4, 1),
        ] {
            let mut data = offset(0);
            data[3 + field] = value;
            invalid.push(data);
        }
        for data in invalid {
            reject_all(&smf(&[vec![(0, data), end()], notes()], 3));
        }
        for header in [
            vec![(1, offset(0)), end()],
            vec![(0, offset(0)), (0, offset(0)), end()],
            vec![(0, offset(0)), (0, offset(96)), end()],
            vec![(0, vec![0xc1, 1]), (0, offset(0)), end()],
        ] {
            reject_all(&smf(&[header, notes()], 3));
        }
        let mut second = vec![(0, offset(0))];
        second.extend(notes());
        reject_all(&smf(&[vec![end()], second], 3));
        for division in [0x8001, 0xe301, 0xe801, 0] {
            reject_all(&smf(&[vec![(0, offset(0)), end()], notes()], division));
        }
    }
    #[test]
    fn offset_never_licenses_routing_tuning_unknown_controls_or_ambiguous_notation() {
        for command in [
            vec![255, 32, 1, 0],
            vec![255, 33, 1, 0],
            vec![0xb0, 1, 20],
            vec![0xf0, 1, 0xf7],
        ] {
            let mut first = vec![(0, offset(96)), (0, command)];
            first.extend(notes());
            let bytes = smf(&[first], 3);
            assert!(strict::convert_midi(&bytes).is_err());
            assert!(convert(&bytes).is_err());
        }
        // Retained pitch bend is now separately admitted by the event-only
        // profile; a zero timecode origin still cannot license strict notation.
        let mut first = vec![(0, offset(96)), (0, vec![0xe0, 0, 64])];
        first.extend(notes());
        let bytes = smf(&[first], 3);
        assert!(strict::convert_midi(&bytes).is_err());
        assert!(convert(&bytes).unwrap().notation.is_none());
        let bytes = smf(
            &[vec![
                (0, offset(96)),
                (0, vec![0x90, 60, 80]),
                (1, vec![0x90, 60, 70]),
                (1, vec![0x80, 60, 0]),
                (1, vec![0x80, 60, 0]),
                end(),
            ]],
            3,
        );
        assert!(strict::convert_midi(&bytes).is_err());
        let score = convert(&bytes).unwrap();
        assert!(score.notation.is_none());
        assert_eq!(score.coverage.targets.represented_attacks, 0);
    }
    #[test]
    fn reload_revalidates_named_fields_position_and_duplicates_in_both_profiles() {
        let bytes = smf(
            &[
                vec![(0, offset(96)), (0, vec![255, 1, 1, b'A']), end()],
                notes(),
            ],
            3,
        );
        let typed = serde_json::to_value(convert(&bytes).unwrap()).unwrap();
        let strict = serde_json::to_value(strict::convert_midi(&bytes).unwrap()).unwrap();
        for original in [&typed, &strict] {
            let check = |value: &serde_json::Value| {
                let json = serde_json::to_vec(value).unwrap();
                if original["version"] == 2 {
                    assert!(typed::decode_json(&json).is_err());
                } else {
                    assert!(strict::decode_json(&json).is_err());
                }
            };
            for field in ["hours", "minutes", "seconds", "frames", "fractional_frames"] {
                let mut changed = original.clone();
                changed["performance"]["events"][0]["command"]["timecode"][field] = 1.into();
                check(&changed);
            }
            let mut changed = original.clone();
            changed["performance"]["events"][0]["command"]["timecode"]["frame_rate"] =
                "unknown".into();
            check(&changed);
            let mut changed = original.clone();
            changed["performance"]["events"][0]["command"]["timecode"]["raw_bytes"] =
                serde_json::json!([96, 0, 0, 0, 0]);
            check(&changed);
            let mut changed = original.clone();
            changed["performance"]["events"][1]["command"] =
                changed["performance"]["events"][0]["command"].clone();
            check(&changed);
            let mut changed = original.clone();
            changed["performance"]["events"][0]["at"]["numerator"] = 1.into();
            check(&changed);
        }
        // Fixed source-coordinate coverage must not conceal an earlier note.
        let bytes = smf(
            &[vec![
                (0, vec![0x90, 60, 80]),
                (0, vec![255, 1, 1, b'A']),
                (3, vec![0x80, 60, 0]),
                end(),
            ]],
            3,
        );
        let command = typed["performance"]["events"][0]["command"].clone();
        let mut score = serde_json::to_value(strict::convert_midi(&bytes).unwrap()).unwrap();
        score["performance"]["events"][0]["command"] = command.clone();
        assert!(strict::decode_json(&serde_json::to_vec(&score).unwrap()).is_err());
        let mut score = serde_json::to_value(convert(&bytes).unwrap()).unwrap();
        score["performance"]["events"][1]["command"] = command;
        assert!(typed::decode_json(&serde_json::to_vec(&score).unwrap()).is_err());
    }
}
