//! Original, long-enough acceptance commands. No delivered or private music.
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub const FIXTURES: [&str; 4] = [
    "performance-overlap-v2",
    "performance-controls-v2",
    "performance-controls-rpn12-route-v2",
    "performance-bank-rpn12-route-v2",
];
pub const SAVED_AT_UNIX_MS: u64 = 1_700_000_000_000;
pub const AUTHORED_DEVICE: &str = "WMH Authored Receiver A";

pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn source(tracks: Vec<Vec<u8>>) -> Vec<u8> {
    let mut midi = b"MThd\0\0\0\x06\0\x01".to_vec();
    midi.extend((tracks.len() as u16).to_be_bytes());
    midi.extend([0, 6]); // Six ticks per quarter preserves exact fractional time.
    for track in tracks {
        midi.extend(b"MTrk");
        midi.extend((track.len() as u32).to_be_bytes());
        midi.extend(track);
    }
    midi
}

pub fn authored_source(name: &str) -> Vec<u8> {
    // 500001 microseconds per quarter; 60 ticks means exactly 5000010 us.
    let conductor = vec![
        0, 255, 3, 1, b'A', 0, 255, 81, 3, 7, 161, 33, 0, 255, 88, 4, 4, 2, 24, 8, 60, 255, 47, 0,
    ];
    let mut tracks = vec![conductor];
    match name {
        "performance-overlap-v2" => {
            for channel in 0..10u8 {
                let key = if channel == 9 { 85 } else { 48 + channel };
                tracks.push(vec![
                    0,
                    255,
                    3,
                    1,
                    b'B' + channel,
                    0,
                    0xc0 | channel,
                    channel * 8,
                    3,
                    0x90 | channel,
                    key,
                    90,
                    6,
                    0x90 | channel,
                    key,
                    70,
                    18,
                    0x80 | channel,
                    key,
                    19,
                    6,
                    0x90 | channel,
                    key,
                    0,
                    27,
                    255,
                    47,
                    0,
                ]);
            }
        }
        "performance-controls-v2" => {
            let mut controls = vec![0, 255, 3, 1, b'B', 0, 0xc0, 40];
            for (controller, value) in [
                (0, 0),
                (32, 0),
                (7, 100),
                (10, 64),
                (11, 90),
                (121, 0),
                (64, 0),
                (11, 127),
                (121, 0),
                (64, 0),
            ] {
                controls.extend([0, 0xb0, controller, value]);
            }
            for (delta, event) in [
                (3, [0x90, 60, 90]),
                (0, [0xb0, 64, 63]),
                (6, [0xb0, 64, 64]),
                (0, [0x90, 60, 70]),
                (0, [0xb0, 7, 80]),
                (0, [0xb0, 10, 20]),
                (0, [0xb0, 11, 80]),
                (18, [0x80, 60, 19]),
                (0, [0xb0, 7, 70]),
                (0, [0xb0, 10, 110]),
                (0, [0xb0, 11, 64]),
                (6, [0x90, 60, 0]),
                (3, [0xb0, 64, 127]),
                (12, [0xb0, 64, 0]),
            ] {
                controls.push(delta);
                controls.extend(event);
            }
            controls.extend([12, 255, 47, 0]);
            tracks.push(controls);
        }
        "performance-controls-rpn12-route-v2" | "performance-bank-rpn12-route-v2" => {
            // New original C/E/G only, with an invented logical destination.
            // The negative sibling differs only in its explicit bank value.
            let bank = u8::from(name == "performance-bank-rpn12-route-v2");
            let mut routed = vec![0, 255, 9, AUTHORED_DEVICE.len() as u8];
            routed.extend(AUTHORED_DEVICE.bytes());
            routed.extend([
                0, 255, 3, 1, b'R', 0, 0xb0, 0, bank, 0, 0xb0, 32, 0, 0, 0xc0, 40,
            ]);
            // Retain all eight writes, including repeated selectors/data, at
            // separate exact ticks. No pitch bend or note transposition.
            for (controller, value) in [
                (100, 0),
                (101, 0),
                (100, 0),
                (101, 0),
                (6, 12),
                (6, 12),
                (38, 0),
                (38, 0),
            ] {
                routed.extend([1, 0xb0, controller, value]);
            }
            for (delta, event) in [
                (1, [0x90, 60, 90]),
                (6, [0x90, 64, 80]),
                (6, [0x90, 67, 70]),
                (12, [0x80, 60, 19]),
                (6, [0x80, 64, 20]),
                (6, [0x80, 67, 21]),
            ] {
                routed.push(delta);
                routed.extend(event);
            }
            routed.extend([15, 255, 47, 0]);
            tracks.push(routed);
        }
        _ => panic!("Unknown authored acceptance fixture"),
    }
    source(tracks)
}

pub fn files(name: &str) -> BTreeMap<String, Vec<u8>> {
    let title = match name {
        "performance-overlap-v2" => "Original eleven-track overlap and percussion",
        "performance-controls-v2" => "Original sustained keys and channel controls",
        "performance-controls-rpn12-route-v2" => "Original C E G named receiver and centered RPN12",
        "performance-bank-rpn12-route-v2" => "Original C E G named receiver with unsupported bank",
        _ => panic!("Unknown authored acceptance fixture"),
    };
    let midi = authored_source(name);
    let score = score_core::clean_performance::convert_midi(&midi, name, title).unwrap();
    let mut raw = score_core::clean_performance::encode_json(&score).unwrap();
    raw.push(b'\n');
    let metadata = json!({"format":"worldmusichub-song","version":2,"id":score.id,"title":score.title,
        "score":{"path":"score.json","bytes":raw.len(),"sha256":hash(&raw)},"sources":[score.source],
        "rights":{"status":"original_authored","attribution":"WorldMusicHub original acceptance commands","license":"CC0-1.0"},
        "media":[]});
    BTreeMap::from([
        (
            "metadata.json".into(),
            serde_json::to_vec_pretty(&metadata).unwrap(),
        ),
        ("score.json".into(), raw),
    ])
}
