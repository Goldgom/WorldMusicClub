//! Original deterministic transport fixtures, containing no private music.
#![allow(dead_code)]
use serde_json::{json, Value};

pub fn create_request() -> Value {
    let mut score = score_core::catalog().remove(0); // Bundled original exercise.
    score.id = "original-assistance-api-fixture".into();
    score.parts[0].notes.truncate(2);
    score.parts[0].notes[0].id = "machine-note".into();
    score.parts[0].notes[1].id = "human-note".into();
    score.parts[0].notes[0].at = score_core::Beat::ZERO;
    score.parts[0].notes[1].at = score_core::Beat::new(1, 100);
    score.parts[0].notes[0].duration = score_core::Beat::new(1, 1);
    score.parts[0].notes[1].duration = score_core::Beat::new(1, 1);
    score.parts[0].notes[1].pitch = score.parts[0].notes[0].pitch.clone();
    json!({"selected_part_ids":[score.parts[0].id],"score":score,
        "profile":{"kind":"piano","key_count":88,"lowest_midi":null},
        "human_source_note_ids":["human-note"]})
}

pub fn smf(format: u16, division: u16, tracks: &[Vec<u8>]) -> Vec<u8> {
    let mut bytes = b"MThd\0\0\0\x06".to_vec();
    bytes.extend(format.to_be_bytes());
    bytes.extend((tracks.len() as u16).to_be_bytes());
    bytes.extend(division.to_be_bytes());
    for track in tracks {
        bytes.extend(b"MTrk");
        bytes.extend((track.len() as u32).to_be_bytes());
        bytes.extend(track);
    }
    bytes
}

pub fn raw_source() -> Vec<u8> {
    // Original encoding includes tempo, every channel class, running status,
    // opaque text, SysEx, escape, meter and end-of-track. No musical quotation.
    smf(
        0,
        96,
        &[vec![
            0, 0xff, 0x51, 3, 7, 0xa1, 0x20, 0, 0x90, 60, 90, 1, 61, 0, 0, 0x80, 60, 33, 0, 0xa0,
            60, 12, 0, 0xb0, 64, 127, 0, 0xc0, 5, 0, 0xd0, 11, 0, 0xe0, 1, 64, 0, 0xff, 1, 2, 0,
            255, 0, 0xf0, 2, 0x7d, 0xf7, 0, 0xf7, 1, 0xf8, 0, 0xff, 0x58, 4, 4, 2, 24, 8, 0, 0xff,
            0x2f, 0,
        ]],
    )
}

pub fn event_count_source(event_count: usize) -> Vec<u8> {
    let mut track = Vec::with_capacity(event_count * 4);
    for index in 0..event_count - 1 {
        track.extend([1, 0xb0, 1, (index % 128) as u8]);
    }
    track.extend([0, 0xff, 0x2f, 0]);
    smf(0, 96, &[track])
}

pub struct Case {
    pub path: &'static str,
    pub content_type: &'static str,
    pub bytes: Vec<u8>,
    pub status: u16,
}
impl Case {
    fn json(path: &'static str, body: &Value, status: u16) -> Self {
        Self {
            path,
            content_type: "application/json",
            bytes: serde_json::to_vec(body).unwrap(),
            status,
        }
    }
}
pub fn cases() -> Vec<Case> {
    let create = create_request();
    let checked: Value = serde_json::from_slice(
        &practice_server::api_response(
            "/api/assistance/create",
            serde_json::to_vec(&create).unwrap(),
        )
        .body,
    )
    .unwrap();
    let validate = json!({"score":create["score"],"plan":checked["plan"]});
    let mut mismatch = validate.clone();
    mismatch["score"]["title"] = json!("Different original title");
    let mut unknown_id = create.clone();
    unknown_id["human_source_note_ids"] = json!(["absent-source-id"]);
    let mut future = validate.clone();
    future["plan"]["schema_version"] = json!(2);
    let mut unknown_field = create.clone();
    unknown_field["derived_timeline"] = json!({"notes":[]});
    let mut unsupported_midi = raw_source();
    unsupported_midi[9] = 2;
    vec![
        Case::json("/api/assistance/create", &create, 200),
        Case::json("/api/assistance/validate", &validate, 200),
        Case::json("/api/assistance/validate", &mismatch, 400),
        Case::json("/api/assistance/create", &unknown_id, 400),
        Case::json("/api/assistance/validate", &future, 400),
        Case::json("/api/assistance/create", &unknown_field, 400),
        Case {
            path: "/api/assistance/create",
            content_type: "application/json",
            bytes: b"{".to_vec(),
            status: 400,
        },
        Case {
            path: "/api/midi/events",
            content_type: "audio/midi",
            bytes: raw_source(),
            status: 200,
        },
        Case {
            path: "/api/midi/events",
            content_type: "audio/x-midi",
            bytes: unsupported_midi,
            status: 400,
        },
        Case {
            path: "/api/midi/events",
            content_type: "application/octet-stream",
            bytes: b"not MIDI".to_vec(),
            status: 400,
        },
        Case {
            path: "/api/import/midi",
            content_type: "audio/midi",
            bytes: raw_source(),
            status: 400,
        },
        Case::json("/api/compile", &create["score"], 200),
    ]
}
