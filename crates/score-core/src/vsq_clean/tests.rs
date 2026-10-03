use super::*;
use crate::vsq::*;
use crate::vsq_engine::normalize_engine_dispatch;
use serde_json::json;

// Entirely original synthetic data, never supplied songs or voicebank content.
fn append(
    events: &mut Vec<VsqControllerEvent>,
    tick: u64,
    group: u8,
    fields: &[(u8, u8, Option<u8>)],
) {
    let mut push = |controller, value| {
        events.push(VsqControllerEvent {
            tick,
            event_order: events.len() as u32 + 10,
            controller,
            value,
        });
    };
    push(VsqController::NrpnMsb, group);
    for &(field, value, tail) in fields {
        push(VsqController::NrpnLsb, field);
        push(VsqController::DataEntryMsb, value);
        if let Some(value) = tail {
            push(VsqController::DataEntryLsb, value);
        }
    }
}
fn project() -> VsqProject {
    let mut p: VsqProject = serde_json::from_str(r#"{
        "profile": "wmh-vsq-dsb301-v1", "source_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "ppq": 480,
        "master_track_name": "Original exact-clock test", "master_end_tick": 4000,
        "tempo": [{"tick":0,"event_order":1,"microseconds_per_quarter":500000},
            {"tick":2160,"event_order":3,"microseconds_per_quarter":1000001}],
        "meters":[{"tick":0,"event_order":2,"numerator":4,"denominator_power":2,
            "clocks_per_click":24,"thirty_seconds_per_quarter":8}],
        "premeasure_bars":1,"premeasure_ticks":1920,
        "mixer":{"master_fader":-3,"master_panpot":2,"master_mute":false,"output_mode":0,
            "tracks":[{"fader":4,"panpot":-9,"mute":false,"solo":false}]},
        "tracks":[{"source_track_index":1,"smf_track_name":"Test track",
            "project_text_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","common":{"version":"DSB301","name":"Test voice",
                "color_components":[1,2,3],"dynamics_mode":1,"play_mode":1},
            "end_tick":4000,"eos_tick":4000,
            "singers":[{"id":"ID#0000","event_order":0,"tick":0,"handle_id":"h#0000",
                "voice":{"icon_id":"$07010000","ids":"Synthetic voice","original":0,
                    "caption":"Descriptor only","length":1,"language":0,"program":7}}],
            "notes":[{"id":"ID#0001","event_order":1,"tick":1920,"length_ticks":801,
                "note_number":63,"dynamics":79,"singer_event_id":"ID#0000",
                "expression":{"bend_depth":8,"bend_length":10,"portamento_use":2,"decay_gain_rate":41,"accent":61},
                "lyric_handle_id":"h#0001","lyrics":[{"index":0,"lyric":"Original あ","phonetic":"a",
                    "numeric_fields":[{"coefficient":0,"scale":6},{"coefficient":31,"scale":0},{"coefficient":0,"scale":0}]}],
                "vibrato":{"handle_id":"h#0002","delay_ticks":266,"icon_id":"$04040001",
                    "ids":"Synthetic vibrato","original":1,"caption":"Exact decimal envelopes","length_ticks":534,
                    "depth":{"start":40,"points":[{"position":{"coefficient":250000,"scale":6},"value":20}]},
                    "rate":{"start":60,"points":[{"position":{"coefficient":1,"scale":0},"value":0}]}}}],
            "curves":[{"parameter":"PitchBend","points":[{"tick":1920,"value":-234}]},
                {"parameter":"PitchBendSensitivity","points":[{"tick":0,"value":12}]}],
            "controller_events":[]}],
        "interpretation_limits":["VoicebankIdentityAndAvailabilityUnverified","PhoneticNumericFieldMeaningsUnverified",
            "VocalExpressionAndPitchInterpolationNotRendered","NrpnDispatchAndPresendNotEvaluated",
            "Resonance255MeaningUnverified","CommonModeAndMixerOutputModeNotInterpreted",
            "SingerHandleMetadataNotAcousticIdentity","EosDoesNotEstablishAcousticTailOrAccompaniment"]
    }"#).unwrap();
    let events = &mut p.tracks[0].controller_events;
    append(
        events,
        0,
        0x60,
        &[(0, 0, Some(0)), (1, 0, Some(0)), (2, 0, None)],
    );
    append(events, 0, 0x53, &[(2, 7, None)]);
    append(
        events,
        1440,
        0x50,
        &[
            (2, 63, None),
            (3, 79, None),
            (4, 11, Some(11)),
            (5, 3, None),
            (0x0c, 0, Some(0)),
            (0x0d, 2, Some(85)),
            (0x0e, 43, None),
            (0x12, 1, None),
            (0x13, b'a', Some(31)),
            (0x4f, 127, None),
            (0x50, 8, None),
            (0x51, 20, None),
            (0x52, 20, None),
            (0x53, 40, None),
            (0x54, 24, None),
            (0x55, 10, None),
            (0x56, 12, None),
            (0x57, 12, None),
            (0x58, 2, None),
            (0x59, 41, None),
            (0x5a, 61, None),
            (0x7f, 127, None),
        ],
    );
    p
}
fn complete(p: &VsqProject) -> VsqCompleteScore {
    from_decoded(
        p,
        normalize_engine_dispatch(p).unwrap(),
        1500,
        "Original synthetic score",
    )
    .unwrap()
}
#[test]
fn clean_round_trip_preserves_authoring_without_controller_payloads() {
    let p = project();
    let score = complete(&p);
    let bytes = encode_json(&score).unwrap();
    let decoded = decode_json(&bytes).unwrap();
    assert_eq!(decoded.authoring, AuthoringProject::from(&p));
    assert_eq!(decoded.engine_dispatch, score.engine_dispatch);
    assert_eq!(decoded.coverage.project.notes, 1);
    assert_eq!(decoded.coverage.project.singers, 1);
    assert_eq!(decoded.coverage.project.lyrics, 1);
    assert_eq!(decoded.coverage.project.vibratos, 1);
    assert_eq!(decoded.coverage.project.envelope_points, 2);
    assert_eq!(decoded.coverage.project.curve_points, 2);
    assert_eq!(decoded.coverage.named_dispatch.commands, 3);
    assert!(
        decoded.coverage.named_dispatch.parameter_fields
            < decoded
                .coverage
                .named_dispatch
                .source_controller_records_accounted
    );
    let json = String::from_utf8(bytes).unwrap();
    for forbidden in [
        "\"controller_events\":",
        "NrpnMsb",
        "DataEntry",
        "represented_events",
        "base64",
        "[Common]",
    ] {
        assert!(!json.contains(forbidden), "{forbidden}");
    }
    assert!(decoded.notation.source.is_none());
}
#[test]
fn rejects_forged_notation_bindings_coverage_and_omitted_limits() {
    let original = serde_json::to_value(complete(&project())).unwrap();
    let edits = [
        ("/source/sha256", json!("c".repeat(64))),
        ("/profile", json!("wmh-semantic-midi1-v1")),
        ("/notation/id", json!("forged")),
        ("/notation/parts/0/id", json!("forged")),
        ("/notation/parts/0/notes/0/id", json!("forged")),
        ("/notation/parts/0/notes/0/voice", json!("ID#9999")),
        ("/notation/parts/0/notes/0/at/numerator", json!(5)),
        ("/notation/parts/0/notes/0/duration/numerator", json!(266)),
        ("/notation/parts/0/notes/0/pitch/alter", json!(0)),
        ("/notation/parts/0/notes/0/velocity", json!(1)),
        ("/notation/parts/0/notes/0/staff", json!(2)),
        ("/notation/tempo/0/bpm", json!(121)),
        ("/notation/meters/0/numerator", json!(3)),
        ("/notation/measures/0/length/numerator", json!(3)),
        (
            "/notation/source",
            json!({"format":"vsq","filename":null,"content":"hidden"}),
        ),
        ("/coverage/project/notes", json!(0)),
        ("/coverage/named_dispatch/parameter_fields", json!(0)),
        ("/interpretation_limits", json!([])),
        ("/engine_dispatch/interpretation_limits", json!([])),
        ("/authoring/interpretation_limits", json!([])),
        ("/authoring/premeasure_ticks", json!(0)),
        ("/engine_dispatch/tracks/0/source_track_index", json!(2)),
    ];
    for (pointer, value) in edits {
        let mut altered = original.clone();
        *altered.pointer_mut(pointer).unwrap() = value;
        assert!(
            decode_json(&serde_json::to_vec(&altered).unwrap()).is_err(),
            "accepted {pointer}"
        );
    }
    for pointer in [
        "",
        "/authoring/tracks/0",
        "/authoring/tracks/0/notes/0",
        "/engine_dispatch/tracks/0/commands/0",
    ] {
        let mut altered = original.clone();
        altered
            .pointer_mut(pointer)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("controller_events".into(), json!([]));
        assert!(
            decode_json(&serde_json::to_vec(&altered).unwrap()).is_err(),
            "accepted extra field {pointer}"
        );
    }
}
#[test]
fn exact_practice_spans_tempo_changes_without_erasing_project_origin() {
    let score = complete(&project());
    let runtime = compile_practice(&score, PracticeChoice::BaseNotesInstrumental).unwrap();
    assert_eq!(runtime.practice_origin_tick, 1920);
    assert_eq!(
        runtime.practice_origin_project_microseconds.numerator,
        "2000000"
    );
    assert_eq!(runtime.practice_origin_project_microseconds.denominator, 1);
    let note = &runtime.notes[0];
    assert_eq!(note.project_start_tick, 1920);
    assert_eq!(note.project_end_tick, 2721);
    assert_eq!(note.start_microseconds.numerator, "0");
    assert_eq!(note.end_microseconds.numerator, "227000187");
    assert_eq!(note.end_microseconds.denominator, 160);
    assert!((note.end_ms - 1418.75116875).abs() < 1e-9);
    assert_eq!(note.key, 63);
    assert_eq!(note.dynamics, 79);
    assert_eq!(note.singer_event_id, "ID#0000");
    assert_eq!(runtime.parts[0].singer_descriptors[0].voice.program, 7);
    assert!(compile_vocal(&score)
        .unwrap_err()
        .contains("Whole-vocal rendering is blocked"));
    let serialized = serde_json::to_string(&runtime).unwrap();
    assert!(!serialized.contains("\"channel\""));
    assert!(!serialized.contains("gm_program"));
}

#[test]
fn simultaneous_notes_keep_event_list_order_with_nonlexical_ids() {
    let mut p = project();
    let track = &mut p.tracks[0];
    track.notes[0].id = "ID#0002".into();
    let mut second = track.notes[0].clone();
    second.id = "ID#0001".into();
    second.event_order = 2;
    second.lyric_handle_id = "h#0003".into();
    second.vibrato.as_mut().unwrap().handle_id = "h#0004".into();
    track.notes.push(second);

    let note_packet_start = track
        .controller_events
        .iter()
        .position(|event| event.controller == VsqController::NrpnMsb && event.value == 0x50)
        .unwrap();
    let packet = track.controller_events[note_packet_start..].to_vec();
    let first_order = track.controller_events.last().unwrap().event_order + 1;
    for (offset, mut event) in packet.into_iter().enumerate() {
        event.event_order = first_order + offset as u32;
        track.controller_events.push(event);
    }

    let score = complete(&p);
    let restored = decode_json(&encode_json(&score).unwrap()).unwrap();
    let runtime = compile_practice(&restored, PracticeChoice::BaseNotesInstrumental).unwrap();
    assert_eq!(runtime.notes.len(), 2);
    assert_eq!(
        runtime.notes[0].project_start_tick,
        runtime.notes[1].project_start_tick
    );
    assert_eq!(
        runtime.notes[0].source_track_index,
        runtime.notes[1].source_track_index
    );
    let ids: Vec<_> = runtime
        .notes
        .iter()
        .map(|note| note.authored_note_id.as_str())
        .collect();
    assert_eq!(ids, ["ID#0002", "ID#0001"]);
    assert_eq!(runtime.notes[0].note_id, "vsq-t1-ID#0002");
    assert_eq!(runtime.notes[1].note_id, "vsq-t1-ID#0001");
}
#[test]
fn mute_solo_and_master_mute_retain_every_note_and_track() {
    let mut p = project();
    let mut second = p.tracks[0].clone();
    second.source_track_index = 2;
    second.common.name = "Second synthetic voice".into();
    p.tracks.push(second);
    p.mixer.tracks[0].solo = true;
    p.mixer.tracks.push(VsqMixerTrack {
        fader: 9,
        panpot: 12,
        mute: false,
        solo: false,
    });
    let runtime = compile_practice(&complete(&p), PracticeChoice::BaseNotesInstrumental).unwrap();
    assert_eq!(runtime.notes.len(), 2);
    assert_eq!(runtime.parts.len(), 2);
    assert!(runtime.notes[0].audible);
    assert!(!runtime.notes[1].audible);
    assert_eq!(runtime.parts[1].mix.fader, 9);
    p.mixer.tracks[0].mute = true;
    let runtime = compile_practice(&complete(&p), PracticeChoice::BaseNotesInstrumental).unwrap();
    assert!(runtime.notes.iter().all(|n| !n.audible));
    p.mixer.tracks[0].mute = false;
    p.mixer.master_mute = true;
    let runtime = compile_practice(&complete(&p), PracticeChoice::BaseNotesInstrumental).unwrap();
    assert_eq!(runtime.notes.len(), 2);
    assert!(runtime.notes.iter().all(|n| !n.audible));
    assert!(runtime.master_mix.mute);
}
#[test]
fn package_metadata_binds_exact_bytes_and_preserves_unverified_rights() {
    use sha2::{Digest, Sha256};
    let score = complete(&project());
    let bytes = encode_json(&score).unwrap();
    let metadata = package_metadata(&score, &bytes).unwrap();
    assert_eq!(
        metadata.score.sha256,
        format!("{:x}", Sha256::digest(&bytes))
    );
    assert_eq!(metadata.score.bytes, bytes.len());
    assert_eq!(metadata.score.path, "score.json");
    assert_eq!(metadata.sources, vec![score.source.clone()]);
    assert_eq!(metadata.rights.status, "user_supplied_unverified");
    assert!(metadata.rights.license.is_none());
    assert!(metadata.media.is_empty());
    let mut other = score.clone();
    other.notation.title = "Different title".into();
    assert!(package_metadata(&other, &bytes).is_err());
}
#[test]
fn practice_scheduler_rejects_long_empty_tail_without_losing_clean_data() {
    let mut p = project();
    p.master_end_tick = 50_000_000;
    let score = complete(&p);
    validate(&score).unwrap();
    assert!(
        compile_practice(&score, PracticeChoice::BaseNotesInstrumental)
            .unwrap_err()
            .contains("24-hour")
    );
}
#[test]
fn stored_producer_version_is_not_replaced_by_reader_version() {
    let mut score = complete(&project());
    score
        .notation
        .format_metadata
        .as_mut()
        .unwrap()
        .producer_version = "earlier-compatible-producer".into();
    let encoded = encode_json(&score).unwrap();
    let restored = decode_json(&encoded).unwrap();
    assert_eq!(
        restored.notation.format_metadata.unwrap().producer_version,
        "earlier-compatible-producer"
    );
}

#[test]
fn every_singer_interval_and_later_meter_change_remains_bound() {
    let mut p = project();
    let track = &mut p.tracks[0];
    let mut singer = track.singers[0].clone();
    singer.id = "ID#0002".into();
    singer.handle_id = "h#0003".into();
    singer.event_order = 2;
    singer.tick = 3000;
    singer.voice.program = 3;
    track.singers.push(singer);
    let mut note = track.notes[0].clone();
    note.id = "ID#0003".into();
    note.lyric_handle_id = "h#0004".into();
    note.event_order = 3;
    note.tick = 3360;
    note.length_ticks = 240;
    note.note_number = 67;
    note.singer_event_id = "ID#0002".into();
    note.vibrato = None;
    track.notes.push(note);
    append(&mut track.controller_events, 2520, 0x60, &[(2, 0, None)]);
    append(&mut track.controller_events, 2520, 0x53, &[(2, 3, None)]);
    append(
        &mut track.controller_events,
        2880,
        0x50,
        &[
            (2, 67, None),
            (3, 79, None),
            (4, 3, Some(116)),
            (5, 3, None),
            (0x12, 1, None),
            (0x13, b'a', Some(31)),
            (0x4f, 127, None),
            (0x50, 8, None),
            (0x51, 20, None),
            (0x52, 20, None),
            (0x53, 40, None),
            (0x54, 24, None),
            (0x55, 10, None),
            (0x56, 12, None),
            (0x57, 12, None),
            (0x58, 2, None),
            (0x59, 41, None),
            (0x5a, 61, None),
            (0x7f, 127, None),
        ],
    );
    let mut meter = p.meters[0].clone();
    meter.tick = 3840;
    meter.event_order = 4;
    meter.numerator = 3;
    p.meters.push(meter);
    let score = complete(&p);
    let runtime = compile_practice(&score, PracticeChoice::BaseNotesInstrumental).unwrap();
    assert_eq!(runtime.notes.len(), 2);
    assert_eq!(runtime.notes[1].singer_event_id, "ID#0002");
    assert_eq!(runtime.parts[0].singer_descriptors.len(), 2);
    assert_eq!(runtime.parts[0].singer_descriptors[1].voice.program, 3);
    assert_eq!(score.coverage.project.singers, 2);
    assert_eq!(score.coverage.project.meter_changes, 2);
    assert_eq!(score.notation.meters[1].numerator, 3);
    assert!(score.notation.meters[1]
        .at
        .equivalent(crate::Beat::new(8, 1)));
}

fn vlq(mut value: u32) -> Vec<u8> {
    let mut bytes = vec![(value & 127) as u8];
    value >>= 7;
    while value > 0 {
        bytes.push((value & 127) as u8 | 128);
        value >>= 7;
    }
    bytes.reverse();
    bytes
}
fn meta(delta: u32, kind: u8, data: &[u8]) -> Vec<u8> {
    let mut bytes = vlq(delta);
    bytes.extend([255, kind]);
    bytes.extend(vlq(data.len() as u32));
    bytes.extend_from_slice(data);
    bytes
}
fn original_smf() -> Vec<u8> {
    let text = "[Common]\nVersion=DSB301\nName=Original converter test\nColor=1,2,3\nDynamicsMode=1\nPlayMode=1\n[Master]\nPreMeasure=1\n[Mixer]\nMasterFeder=-3\nMasterPanpot=2\nMasterMute=0\nOutputMode=0\nTracks=1\nFeder0=4\nPanpot0=-9\nMute0=0\nSolo0=0\n[EventList]\n0=ID#0000\n1920=ID#0001\n4000=EOS\n[ID#0000]\nType=Singer\nIconHandle=h#0000\n[ID#0001]\nType=Anote\nLength=801\nNote#=63\nDynamics=79\nPMBendDepth=8\nPMBendLength=10\nPMbPortamentoUse=2\nDEMdecGainRate=41\nDEMaccent=61\nLyricHandle=h#0001\nVibratoHandle=h#0002\nVibratoDelay=266\n[h#0000]\nIconID=$07010000\nIDS=Synthetic voice\nOriginal=0\nCaption=Descriptor only\nLength=1\nLanguage=0\nProgram=7\n[h#0001]\nL0=\"Original a\",\"a\",0.000000,31,0\n[h#0002]\nIconID=$04040001\nIDS=Synthetic vibrato\nOriginal=1\nCaption=Exact envelopes\nLength=534\nStartDepth=40\nDepthBPNum=1\nDepthBPX=0.250000\nDepthBPY=20\nStartRate=60\nRateBPNum=1\nRateBPX=1.000000\nRateBPY=0\n[PitchBendBPList]\n1920=-234\n[PitchBendSensBPList]\n0=12\n";
    let mut master = meta(0, 3, b"Original converter master");
    master.extend(meta(0, 0x51, &[7, 0xa1, 0x20]));
    master.extend(meta(0, 0x58, &[4, 2, 24, 8]));
    master.extend(meta(2160, 0x51, &[15, 0x42, 0x41]));
    master.extend(meta(1840, 0x2f, &[]));
    let mut track = meta(0, 3, b"Original converter test");
    track.extend(meta(0, 1, format!("DM:0000:{text}").as_bytes()));
    let mut previous_tick = 0;
    for event in project().tracks.remove(0).controller_events {
        track.extend(vlq((event.tick - previous_tick) as u32));
        previous_tick = event.tick;
        let controller = match event.controller {
            VsqController::NrpnMsb => 99,
            VsqController::NrpnLsb => 98,
            VsqController::DataEntryMsb => 6,
            VsqController::DataEntryLsb => 38,
        };
        track.extend([0xb0, controller, event.value]);
    }
    track.extend(meta((4000 - previous_tick) as u32, 0x2f, &[]));
    let mut bytes = b"MThd\0\0\0\x06\0\x01\0\x02\x01\xe0".to_vec();
    for data in [master, track] {
        bytes.extend_from_slice(b"MTrk");
        bytes.extend_from_slice(&(data.len() as u32).to_be_bytes());
        bytes.extend(data);
    }
    bytes
}
#[test]
fn converts_original_smf_directly_to_source_free_package_data() {
    use sha2::{Digest, Sha256};
    let original = original_smf();
    let score = convert_vsq(&original, "Original converter test").unwrap();
    assert_eq!(score.source.bytes, original.len());
    assert_eq!(
        score.source.sha256,
        format!("{:x}", Sha256::digest(&original))
    );
    assert_eq!(score.coverage.project.notes, 1);
    assert_eq!(score.coverage.project.envelope_points, 2);
    let clean = encode_json(&score).unwrap();
    let metadata = package_metadata(&score, &clean).unwrap();
    assert_eq!(metadata.sources[0].format, "vsq");
    assert!(metadata.media.is_empty());
    let runtime = compile_practice(
        &decode_json(&clean).unwrap(),
        PracticeChoice::BaseNotesInstrumental,
    )
    .unwrap();
    assert_eq!(runtime.notes[0].end_microseconds.numerator, "227000187");
    assert!(convert_vsq(&[0], "Invalid source").is_err());
}
