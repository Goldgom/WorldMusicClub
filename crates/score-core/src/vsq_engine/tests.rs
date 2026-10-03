use super::*;
use crate::vsq::*;
// Original synthetic fixture shared with the clean adapter tests.
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
    let mut p: VsqProject = serde_json::from_str(
        r##"{
  "profile": "wmh-vsq-dsb301-v1",
  "source_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "ppq": 480,
  "master_track_name": "Original exact-clock test",
  "master_end_tick": 4000,
  "tempo": [
    {
      "tick": 0,
      "event_order": 1,
      "microseconds_per_quarter": 500000
    },
    {
      "tick": 2160,
      "event_order": 3,
      "microseconds_per_quarter": 1000001
    }
  ],
  "meters": [
    {
      "tick": 0,
      "event_order": 2,
      "numerator": 4,
      "denominator_power": 2,
      "clocks_per_click": 24,
      "thirty_seconds_per_quarter": 8
    }
  ],
  "premeasure_bars": 1,
  "premeasure_ticks": 1920,
  "mixer": {
    "master_fader": -3,
    "master_panpot": 2,
    "master_mute": false,
    "output_mode": 0,
    "tracks": [
      {
        "fader": 4,
        "panpot": -9,
        "mute": false,
        "solo": false
      }
    ]
  },
  "tracks": [
    {
      "source_track_index": 1,
      "smf_track_name": "Test track",
      "project_text_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "common": {
        "version": "DSB301",
        "name": "Test voice",
        "color_components": [
          1,
          2,
          3
        ],
        "dynamics_mode": 1,
        "play_mode": 1
      },
      "end_tick": 4000,
      "eos_tick": 4000,
      "singers": [
        {
          "id": "ID#0000",
          "event_order": 0,
          "tick": 0,
          "handle_id": "h#0000",
          "voice": {
            "icon_id": "$07010000",
            "ids": "Synthetic voice",
            "original": 0,
            "caption": "Descriptor only",
            "length": 1,
            "language": 0,
            "program": 7
          }
        }
      ],
      "notes": [
        {
          "id": "ID#0001",
          "event_order": 1,
          "tick": 1920,
          "length_ticks": 801,
          "note_number": 63,
          "dynamics": 79,
          "singer_event_id": "ID#0000",
          "expression": {
            "bend_depth": 8,
            "bend_length": 10,
            "portamento_use": 2,
            "decay_gain_rate": 41,
            "accent": 61
          },
          "lyric_handle_id": "h#0001",
          "lyrics": [
            {
              "index": 0,
              "lyric": "Original あ",
              "phonetic": "a",
              "numeric_fields": [
                {
                  "coefficient": 0,
                  "scale": 6
                },
                {
                  "coefficient": 31,
                  "scale": 0
                },
                {
                  "coefficient": 0,
                  "scale": 0
                }
              ]
            }
          ],
          "vibrato": {
            "handle_id": "h#0002",
            "delay_ticks": 266,
            "icon_id": "$04040001",
            "ids": "Synthetic vibrato",
            "original": 1,
            "caption": "Exact decimal envelopes",
            "length_ticks": 534,
            "depth": {
              "start": 40,
              "points": [
                {
                  "position": {
                    "coefficient": 250000,
                    "scale": 6
                  },
                  "value": 20
                }
              ]
            },
            "rate": {
              "start": 60,
              "points": [
                {
                  "position": {
                    "coefficient": 1,
                    "scale": 0
                  },
                  "value": 0
                }
              ]
            }
          }
        }
      ],
      "curves": [
        {
          "parameter": "PitchBend",
          "points": [
            {
              "tick": 1920,
              "value": -234
            }
          ]
        },
        {
          "parameter": "PitchBendSensitivity",
          "points": [
            {
              "tick": 0,
              "value": 12
            }
          ]
        }
      ],
      "controller_events": []
    }
  ],
  "interpretation_limits": [
    "VoicebankIdentityAndAvailabilityUnverified",
    "PhoneticNumericFieldMeaningsUnverified",
    "VocalExpressionAndPitchInterpolationNotRendered",
    "NrpnDispatchAndPresendNotEvaluated",
    "Resonance255MeaningUnverified",
    "CommonModeAndMixerOutputModeNotInterpreted",
    "SingerHandleMetadataNotAcousticIdentity",
    "EosDoesNotEstablishAcousticTailOrAccompaniment"
  ]
}"##,
    )
    .unwrap();
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

#[test]
fn closed_commands_preserve_omissions_independent_values_and_counts() {
    let p = project();
    let d = normalize_engine_dispatch(&p).unwrap();
    assert_eq!(d.command_count(), 3);
    assert_eq!(d.parameter_field_count(), 26);
    let cs = &d.tracks[0].commands;
    assert_eq!(cs[0].explicit_transport.as_ref().unwrap().delay_ms, Some(0));
    assert!(cs[1].explicit_transport.is_none());
    assert!(cs[2].explicit_transport.is_none());
    let EngineCommandKind::Note { note } = &cs[2].command else {
        panic!()
    };
    assert_eq!(note.duration_ms, 1419);
    let v = note.vibrato.as_ref().unwrap();
    assert_eq!(
        u16::from(v.duration_parameter) + u16::from(v.delay_parameter),
        128
    );
    let json = serde_json::to_string(&d).unwrap();
    assert!(!json.contains("NrpnMsb"));
    assert!(!json.contains("DataEntry"));
    let copy: EngineDispatch = serde_json::from_str(&json).unwrap();
    assert_eq!(d, copy);
    let mut authored = p;
    authored.tracks[0].controller_events.clear();
    copy.validate(&authored).unwrap();
}
#[test]
fn resonance_255_is_preserved_with_explicit_unknown_meaning() {
    let mut p = project();
    append(
        &mut p.tracks[0].controller_events,
        1500,
        0x55,
        &[(2, 0x40, None), (3, 255, None)],
    );
    let d = normalize_engine_dispatch(&p).unwrap();
    assert!(matches!(
        d.tracks[0].commands[3].command,
        EngineCommandKind::VoiceParameter {
            parameter: EngineVoiceParameter::Resonance1Frequency,
            value: 255
        }
    ));
}
#[test]
fn unknown_groups_continuations_and_phonetic_disagreement_hold() {
    let base = project();
    let mut p = base.clone();
    let i = p.tracks[0]
        .controller_events
        .iter()
        .position(|e| e.controller == VsqController::NrpnMsb && e.value == 0x50)
        .unwrap();
    p.tracks[0].controller_events[i].value = 0x51;
    assert!(normalize_engine_dispatch(&p).is_err());
    let mut p = base.clone();
    p.tracks[0].notes[0].lyrics[0].numeric_fields[1].coefficient = 64;
    assert!(normalize_engine_dispatch(&p).is_err());
    let mut p = base;
    p.tracks[0].controller_events.last_mut().unwrap().value = 0;
    assert!(normalize_engine_dispatch(&p).is_err());
}
#[test]
fn json_revalidation_rejects_forged_coverage_and_removed_limits() {
    let p = project();
    let d = normalize_engine_dispatch(&p).unwrap();
    let mut x = d.clone();
    x.interpretation_limits.clear();
    assert!(x.validate(&p).is_err());
    let mut x = d.clone();
    x.source_controller_events -= 1;
    assert!(x.validate(&p).is_err());
    let mut x = d;
    x.tracks[0].commands[2].source_order_last += 1;
    assert!(x.validate(&p).is_err());
}

#[test]
fn available_controller_source_binds_every_named_value_and_coordinate() {
    let p = project();
    let original = normalize_engine_dispatch(&p).unwrap();
    let mut changed = original.clone();
    let EngineCommandKind::Note { note } = &mut changed.tracks[0].commands[2].command else {
        panic!()
    };
    note.duration_ms += 1;
    assert!(changed.validate(&p).is_err());
    let mut changed = original.clone();
    changed.tracks[0].commands[2].tick += 1;
    assert!(changed.validate(&p).is_err());
    let mut changed = original;
    for command in &mut changed.tracks[0].commands {
        command.source_order_first += 1;
        command.source_order_last += 1;
    }
    assert!(changed.validate(&p).is_err());
}
