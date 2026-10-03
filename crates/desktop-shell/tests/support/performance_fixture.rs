//! Entirely authored commands for testing complete-performance consumers.
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn files(volume: bool) -> BTreeMap<String, Vec<u8>> {
    let mut midi = b"MThd\0\0\0\x06\0\x01\0\x0b\0\x03".to_vec();
    for track in 0..11u8 {
        let mut bytes = vec![0, 255, 3, 1, b'A' + track];
        if track == 0 {
            bytes.extend([
                0, 255, 81, 3, 7, 161, 33, 0, 255, 88, 4, 4, 2, 24, 8, 12, 255, 47, 0,
            ]);
        } else {
            let channel = track - 1;
            let key = if channel == 9 { 85 } else { 48 + channel };
            bytes.extend([0, 0xc0 | channel, channel * 8]);
            if volume && track == 1 {
                bytes.extend([0, 0xb0, 7, 80]);
            }
            bytes.extend([
                1,
                0x90 | channel,
                key,
                90,
                1,
                0x90 | channel,
                key,
                70,
                1,
                0x80 | channel,
                key,
                19,
                1,
                0x90 | channel,
                key,
                0,
                8,
                255,
                47,
                0,
            ]);
        }
        midi.extend(b"MTrk");
        midi.extend((bytes.len() as u32).to_be_bytes());
        midi.extend(bytes);
    }
    files_for_source(
        &midi,
        "authored-performance-consumer",
        "Original complete performance consumer fixture",
    )
}

/// Newly authored source for native control-semantic acceptance, not GUI/audio proof.
#[allow(dead_code)] // Also included by the unchanged static-fixture generator.
pub fn controls_source() -> Vec<u8> {
    let mut midi = b"MThd\0\0\0\x06\0\x01\0\x02\0\x03".to_vec();
    let conductor = vec![0, 255, 81, 3, 7, 161, 33, 12, 255, 47, 0];
    let mut controls = vec![0, 0xc0, 40];
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
        (1, [0x90, 60, 90]),
        (0, [0xb0, 64, 63]),
        (1, [0xb0, 64, 64]),
        (0, [0x90, 60, 70]),
        (0, [0xb0, 7, 80]),
        (0, [0xb0, 10, 20]),
        (0, [0xb0, 11, 80]),
        (1, [0x80, 60, 19]),
        (0, [0xb0, 7, 70]),
        (0, [0xb0, 10, 110]),
        (0, [0xb0, 11, 64]),
        (1, [0x90, 60, 0]),
        (1, [0xb0, 64, 127]),
        (1, [0xb0, 64, 0]),
    ] {
        controls.push(delta);
        controls.extend(event);
    }
    controls.extend([6, 255, 47, 0]);
    for track in [conductor, controls] {
        midi.extend(b"MTrk");
        midi.extend((track.len() as u32).to_be_bytes());
        midi.extend(track);
    }
    midi
}

#[allow(dead_code)] // Also included by the unchanged static-fixture generator.
pub fn controls_files() -> BTreeMap<String, Vec<u8>> {
    files_for_source(
        &controls_source(),
        "authored-performance-controls",
        "Original complete controls fixture",
    )
}

fn files_for_source(midi: &[u8], id: &str, title: &str) -> BTreeMap<String, Vec<u8>> {
    let score = score_core::clean_performance::convert_midi(midi, id, title).unwrap();
    let mut raw = score_core::clean_performance::encode_json(&score).unwrap();
    raw.extend(b"\n");
    let rights = json!({"status":"original_authored","attribution":"WMH authored integration fixture","license":"MIT"});
    let media = b"RIFF\x10\x00\x00\x00WAVEfmt data\0\0\0\0".to_vec();
    let metadata = json!({"format":"worldmusichub-song","version":2,"id":score.id,"title":score.title,
        "score":{"path":"score.json","bytes":raw.len(),"sha256":hash(&raw)},"sources":[score.source],"rights":rights,
        "media":[{"id":"authored-stem","role":"stem","path":"media/stem.wav","mime":"audio/wav","bytes":media.len(),"sha256":hash(&media),"rights":rights,"parts":["midi-t2-c1"],"offset_ms":0}]});
    BTreeMap::from([
        (
            "metadata.json".into(),
            serde_json::to_vec_pretty(&metadata).unwrap(),
        ),
        ("score.json".into(), raw),
        ("media/stem.wav".into(), media),
    ])
}
