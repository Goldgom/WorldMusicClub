//! Reproducible original semantic fixture; never supplied/private music.
use score_core::vsq::*;
use score_core::vsq_clean::*;
use score_core::vsq_engine::normalize_engine_dispatch;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, path::PathBuf};
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
                "note_number":63,"dynamics":0,"singer_event_id":"ID#0000",
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
            (3, 0, None),
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

fn main() {
    let destination = PathBuf::from(std::env::args().nth(1).expect("fixture destination"));
    let padding = match std::env::args().nth(2).as_deref() {
        None => false,
        Some("padding") => true,
        Some(_) => panic!("Only the optional padding variant is supported"),
    };
    let fixture_name = if padding {
        "vsq-clean-v1-padding"
    } else {
        "vsq-clean-v1"
    };
    let mut project = project();
    project.tracks[0].notes[0].lyrics[0].numeric_fields[0].coefficient = 9007199254740993;
    let mut second = project.tracks[0].clone();
    second.source_track_index = 2;
    second.common.name = "Original muted voice".into();
    second.smf_track_name = "Second authored track".into();
    project.tracks.push(second);
    let mut mix = project.mixer.tracks[0].clone();
    mix.mute = true;
    project.mixer.tracks.push(mix);
    if padding {
        project.master_end_tick = 3000;
        for track in &mut project.tracks {
            track.end_tick = 3000;
            track.eos_tick = 3000;
        }
    }
    let engine_dispatch = normalize_engine_dispatch(&project).unwrap();
    let authoring = AuthoringProject::from(&project);
    let notes: Vec<_> = authoring.tracks.iter().flat_map(|t| &t.notes).collect();
    let coverage = Coverage {
        status: CoverageStatus::StructurallyCompleteAuthoringAndNamedDispatch,
        notation: NotationCoverage::AllAuthoredBaseNotes,
        project: ProjectCoverage {
            tracks: authoring.tracks.len(),
            notes: notes.len(),
            singers: authoring.tracks.iter().map(|t| t.singers.len()).sum(),
            lyrics: notes.iter().map(|n| n.lyrics.len()).sum(),
            vibratos: notes.iter().filter(|n| n.vibrato.is_some()).count(),
            envelope_points: notes
                .iter()
                .filter_map(|n| n.vibrato.as_ref())
                .map(|v| v.depth.points.len() + v.rate.points.len())
                .sum(),
            curves: authoring.tracks.iter().map(|t| t.curves.len()).sum(),
            curve_points: authoring
                .tracks
                .iter()
                .flat_map(|t| &t.curves)
                .map(|c| c.points.len())
                .sum(),
            tempo_changes: authoring.tempo.len(),
            meter_changes: authoring.meters.len(),
        },
        named_dispatch: DispatchCoverage {
            tracks: engine_dispatch.tracks.len(),
            commands: engine_dispatch.command_count(),
            parameter_fields: engine_dispatch.parameter_field_count(),
            source_controller_records_accounted: engine_dispatch.source_controller_events,
        },
    };
    let score = VsqCompleteScore {
        format: FORMAT.into(),
        version: 1,
        profile: PROFILE.into(),
        source: SourceEvidence {
            format: "vsq".into(),
            bytes: 1500,
            sha256: project.source_sha256.clone(),
        },
        notation: project
            .canonical_score("Original VSQ native bridge fixture")
            .unwrap(),
        authoring,
        engine_dispatch,
        coverage,
        capabilities: Capabilities {
            whole_vocal_rendering: VocalRendering::Blocked,
            instrumental_practice: InstrumentalPractice::RequiresExplicitBaseNoteChoice,
        },
        interpretation_limits: CLEAN_LIMITS.to_vec(),
    };
    let score_bytes = encode_json(&score).unwrap();
    let mut metadata = package_metadata(&score, &score_bytes).unwrap();
    metadata.rights.status = "original_authored".into();
    metadata.rights.attribution = "Original synthetic semantic test project; source byte count and hashes are synthetic evidence claims, not a bundled original or voicebank".into();
    metadata.rights.license = Some("CC0-1.0".into());
    let metadata_bytes = serde_json::to_vec_pretty(&metadata).unwrap();
    fs::create_dir_all(destination.join(fixture_name)).unwrap();
    fs::write(
        destination.join(fixture_name).join("score.json"),
        &score_bytes,
    )
    .unwrap();
    fs::write(
        destination.join(fixture_name).join("metadata.json"),
        &metadata_bytes,
    )
    .unwrap();
    let files = BTreeMap::from([
        (
            "metadata.json".into(),
            (
                metadata_bytes.len() as u64,
                format!("{:x}", Sha256::digest(&metadata_bytes)),
            ),
        ),
        (
            "score.json".into(),
            (
                score_bytes.len() as u64,
                format!("{:x}", Sha256::digest(&score_bytes)),
            ),
        ),
    ]);
    let package = worldmusichub_desktop::native_library::clean_package::parse(
        &metadata_bytes,
        &score_bytes,
        &files,
    )
    .unwrap();
    let sandbox = std::env::temp_dir().join(format!("wmh-vsq-fixture-{}", std::process::id()));
    let library = worldmusichub_desktop::native_library::NativeLibrary::open(&sandbox).unwrap();
    let entry = worldmusichub_desktop::native_library::clean_package::save(
        &library,
        &package,
        None,
        false,
        |_| unreachable!(),
    )
    .unwrap();
    let loaded = library.load(&entry.key).unwrap();
    fs::write(destination.join(format!("{fixture_name}-native-open.json")), serde_json::to_vec_pretty(&serde_json::json!({"score_json":loaded.score_json,"clean_package":loaded.clean_package})).unwrap()).unwrap();
    let response = worldmusichub_desktop::native_library::dispatch(&library, "POST", "/api/library/runtime", &serde_json::to_vec(&serde_json::json!({"key":entry.key,"profile":PROFILE,"choice":"base_notes_instrumental"})).unwrap());
    assert_eq!(
        response.status(),
        200,
        "{}",
        String::from_utf8_lossy(response.body())
    );
    let runtime: serde_json::Value = serde_json::from_slice(response.body()).unwrap();
    fs::write(
        destination.join(format!("{fixture_name}-runtime.json")),
        serde_json::to_vec_pretty(&runtime).unwrap(),
    )
    .unwrap();
    fs::remove_dir_all(sandbox).unwrap();
}
