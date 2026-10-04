//! Newly authored C/E/G commands for original reference pitch acceptance.
//! Independent of every earlier performance fixture and generator.
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub const FIXTURES: [&str; 3] = [
    "performance-pitch-default2-v2",
    "performance-pitch-proved12-v2",
    "performance-pitch-bound12-v2",
];
pub const SAVED_AT_UNIX_MS: u64 = 1_700_000_000_000;
pub const ATTRIBUTION: &str = "WorldMusicHub original C/E/G pitch acceptance commands, authored under CC0-1.0; source generator: crates/desktop-shell/tests/support/pitch_acceptance_fixture.rs::authored_source; native-output generator: crates/desktop-shell/examples/generate_pitch_acceptance_fixtures.rs; SMF format 1, PPQ 6, tempo 500001 microseconds per quarter, end tick 60; no supplied or third-party music";

pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn track(events: Vec<(u8, Vec<u8>)>) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut previous = 0;
    for (tick, event) in events {
        // Every authored absolute tick and delta fits a one-byte MIDI VLQ.
        assert!(tick >= previous && tick < 128);
        bytes.push(tick - previous);
        bytes.extend(event);
        previous = tick;
    }
    bytes
}

fn bend(value: u16) -> Vec<u8> {
    assert!(value < 16_384);
    vec![0xe0, (value & 127) as u8, (value >> 7) as u8]
}

pub fn authored_source(name: &str) -> Vec<u8> {
    assert!(FIXTURES.contains(&name));
    let conductor = track(vec![
        (0, vec![255, 3, 1, b'C']),
        (0, vec![255, 81, 3, 7, 161, 33]),
        (0, vec![255, 88, 4, 4, 2, 24, 8]),
        (60, vec![255, 47, 0]),
    ]);
    let [c, e, g] = if name == FIXTURES[2] {
        [108, 112, 115]
    } else {
        [60, 64, 67]
    };
    // Program 8 has a declared reference harmonic ratio of three. The high
    // sibling's C108 is legal source MIDI, but its +12 harmonic exceeds 18kHz.
    let mut melody = vec![(0, vec![255, 3, 1, b'M']), (0, vec![0xc0, 8])];
    if name != FIXTURES[0] {
        // One reviewed, contiguous, fully pre-key RPN 0 setup. No unreviewed
        // deselection or later RPN writes are introduced by the fixture.
        for (index, (controller, value)) in [(100, 0), (101, 0), (6, 12), (38, 0)]
            .into_iter()
            .enumerate()
        {
            melody.push((index as u8 + 1, vec![0xb0, controller, value]));
        }
    }
    melody.extend([
        (9, vec![0x90, c, 90]),
        (12, bend(0)),
        (13, bend(1)),
        (15, bend(8191)),
        (16, bend(8192)),
        (18, vec![0x90, e, 80]),
        (20, vec![0xb0, 64, 127]),
        (21, vec![0x80, c, 19]),
        (22, bend(8193)),
        (24, bend(16383)),
        (25, bend(16383)),
        (27, vec![0x90, g, 70]),
        (30, vec![0x80, e, 20]),
        (31, bend(4096)),
        (33, vec![0x80, g, 21]),
        // A generous pedal-held interval permits a real native pause/resume
        // before the final center command and later pedal release.
        (48, bend(8192)),
        (54, vec![0xb0, 64, 0]),
        (60, vec![255, 47, 0]),
    ]);
    let mut midi = b"MThd\0\0\0\x06\0\x01\0\x02\0\x06".to_vec();
    for bytes in [conductor, track(melody)] {
        midi.extend(b"MTrk");
        midi.extend((bytes.len() as u32).to_be_bytes());
        midi.extend(bytes);
    }
    midi
}

pub fn files(name: &str) -> BTreeMap<String, Vec<u8>> {
    let title = match name {
        "performance-pitch-default2-v2" => "Original C E G reference pitch with default range two",
        "performance-pitch-proved12-v2" => {
            "Original C E G reference pitch with proved range twelve"
        }
        "performance-pitch-bound12-v2" => {
            "Original high C E G beyond reference pitch frequency bounds"
        }
        _ => panic!("Unknown authored pitch acceptance fixture"),
    };
    let midi = authored_source(name);
    let score = score_core::clean_performance::convert_midi(&midi, name, title).unwrap();
    let mut raw = score_core::clean_performance::encode_json(&score).unwrap();
    raw.push(b'\n');
    let metadata = json!({
        "format": "worldmusichub-song", "version": 2, "id": score.id, "title": score.title,
        "score": {"path": "score.json", "bytes": raw.len(), "sha256": hash(&raw)},
        "sources": [score.source],
        "rights": {"status": "original_authored", "attribution": ATTRIBUTION, "license": "CC0-1.0"},
        "media": []
    });
    BTreeMap::from([
        (
            "metadata.json".into(),
            serde_json::to_vec_pretty(&metadata).unwrap(),
        ),
        ("score.json".into(), raw),
    ])
}
