//! Small deterministic musical fixtures; these are preservation checks, not
//! random parser input or resource/throughput tests.
use score_core::{
    compile, export_jianpu, export_musicxml, import_jianpu, import_musicxml, Beat,
    ExportedMusicXml, Key, Measure, Meter, Note, Pitch, Repeat, Score, Source, Tempo,
};

fn fraction(beat: Beat) -> (i64, i64) {
    let (mut a, mut b) = (beat.numerator.unsigned_abs(), beat.denominator as u64);
    while b != 0 {
        (a, b) = (b, a % b);
    }
    let divisor = a.max(1) as i64;
    (beat.numerator / divisor, beat.denominator / divisor)
}

type WrittenEvent = (
    usize,
    (i64, i64),
    (i64, i64),
    Option<(String, i8, i8)>,
    String,
    u8,
    u8,
    bool,
    bool,
);

fn written_events(score: &Score, voice_map: Option<&ExportedMusicXml>) -> Vec<WrittenEvent> {
    let mut result = vec![];
    for (part_index, part) in score.parts.iter().enumerate() {
        for note in &part.notes {
            let voice = if let Some(map) = voice_map {
                let original_part = map
                    .part_id_map
                    .iter()
                    .find(|(_, xml_id)| *xml_id == &part.id)
                    .unwrap()
                    .0;
                map.voice_id_map
                    .iter()
                    .find(|lane| {
                        &lane.part_id == original_part
                            && lane.staff == note.staff
                            && lane.xml_voice == note.voice
                    })
                    .unwrap()
                    .voice
                    .clone()
            } else {
                note.voice.clone()
            };
            result.push((
                part_index,
                fraction(note.at),
                fraction(note.duration),
                note.pitch
                    .as_ref()
                    .map(|pitch| (pitch.step.clone(), pitch.alter, pitch.octave)),
                voice,
                note.staff,
                note.velocity,
                note.tie_start,
                note.tie_stop,
            ));
        }
    }
    result.sort();
    result
}

fn assert_maps(original: &Score, imported: &Score) {
    assert_eq!(
        original
            .tempo
            .iter()
            .map(|t| (fraction(t.at), t.bpm.to_bits()))
            .collect::<Vec<_>>(),
        imported
            .tempo
            .iter()
            .map(|t| (fraction(t.at), t.bpm.to_bits()))
            .collect::<Vec<_>>()
    );
    assert_eq!(
        original
            .keys
            .iter()
            .map(|k| (fraction(k.at), k.fifths, &k.mode))
            .collect::<Vec<_>>(),
        imported
            .keys
            .iter()
            .map(|k| (fraction(k.at), k.fifths, &k.mode))
            .collect::<Vec<_>>()
    );
    assert_eq!(
        original
            .meters
            .iter()
            .map(|m| (fraction(m.at), m.numerator, m.denominator))
            .collect::<Vec<_>>(),
        imported
            .meters
            .iter()
            .map(|m| (fraction(m.at), m.numerator, m.denominator))
            .collect::<Vec<_>>()
    );
    assert_eq!(
        original
            .measures
            .iter()
            .map(|m| (m.number, fraction(m.at), fraction(m.length)))
            .collect::<Vec<_>>(),
        imported
            .measures
            .iter()
            .map(|m| (m.number, fraction(m.at), fraction(m.length)))
            .collect::<Vec<_>>()
    );
}

#[test]
fn generated_polyphonic_musicxml_preserves_written_events_maps_and_performance() {
    let base = score_core::catalog_score("first-steps").unwrap();
    let mut seed = 1977_u32;
    for case in 0..96 {
        let mut score = base.clone();
        score.parts[0].id = format!("original part {case}");
        score.parts[0].notes.clear();
        score.measures = (0..2)
            .map(|index| Measure {
                number: index + 1,
                at: Beat::new(i64::from(index) * 4, 1),
                length: Beat::new(4, 1),
            })
            .collect();
        score.tempo = vec![
            Tempo {
                at: Beat::ZERO,
                bpm: 97.5,
            },
            Tempo {
                at: Beat::new(7, 12),
                bpm: 38.5,
            },
            Tempo {
                at: Beat::new(17, 12),
                bpm: 58.25 + f64::from(case),
            },
        ];
        score.keys[0].fifths = (case % 15) as i8 - 7;
        score.keys.push(Key {
            at: Beat::new(5, 12),
            fifths: 7 - (case % 15) as i8,
            mode: if case % 2 == 0 { "minor" } else { "major" }.into(),
        });
        score.meters.push(Meter {
            at: Beat::new(5, 2),
            numerator: 3,
            denominator: 8,
        });
        if case % 2 == 0 {
            score.repeats.push(Repeat {
                from: Beat::ZERO,
                to: Beat::new(4, 1),
                times: 2,
            });
        }
        score.source = Some(Source {
            format: "original-test-text".into(),
            filename: Some("original.txt".into()),
            content: format!("Original generated fixture {case}\r\n音符"),
            import_diagnostics: None,
        });
        for index in 0..16 {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let rest = index % 5 == 0;
            let staff = if index % 3 == 0 { 2 } else { 1 };
            score.parts[0].notes.push(Note {
                id: format!("case-{case}-note-{index}"),
                at: Beat::new(i64::from(seed % 19), 12),
                duration: Beat::new([1, 2, 3, 4, 6, 8][(seed / 19 % 6) as usize], 12),
                pitch: (!rest).then(|| Pitch {
                    step: ["C", "D", "E", "F", "G", "A", "B"][(seed / 114 % 7) as usize].into(),
                    alter: (seed / 798 % 5) as i8 - 2,
                    octave: if staff == 2 { 3 } else { 4 },
                }),
                voice: ["upper", "01", "1", "bass & lead"][(seed / 3990 % 4) as usize].into(),
                staff,
                velocity: if rest { 0 } else { (seed % 128) as u8 },
                tie_start: false,
                tie_stop: false,
            });
        }
        if case % 3 == 0 {
            for (index, (at, duration)) in [
                (Beat::new(5, 2), Beat::new(1, 3)),
                (Beat::new(34, 12), Beat::new(5, 6)),
            ]
            .into_iter()
            .enumerate()
            {
                score.parts[0].notes.push(Note {
                    id: format!("case-{case}-tied-{index}"),
                    at,
                    duration,
                    pitch: Some(Pitch {
                        step: "G".into(),
                        alter: (case % 5) as i8 - 2,
                        octave: 4,
                    }),
                    voice: "tied voice".into(),
                    staff: 1,
                    velocity: if index == 0 { 110 } else { 64 },
                    tie_start: index == 0,
                    tie_stop: index == 1,
                });
            }
        }
        if case % 4 == 0 {
            let mut bass = score.parts[0].clone();
            bass.id = format!("second original part {case}");
            for note in &mut bass.notes {
                note.id = format!("second-{}", note.id);
                if let Some(pitch) = &mut note.pitch {
                    pitch.octave -= 1;
                }
            }
            score.parts.push(bass);
        }
        let before = serde_json::to_string(&score).unwrap();
        let exported =
            export_musicxml(&score).unwrap_or_else(|error| panic!("case {case}: {error}"));
        let (imported, _) =
            import_musicxml(&exported.xml).unwrap_or_else(|error| panic!("case {case}: {error}"));
        assert_eq!(
            written_events(&score, None),
            written_events(&imported, Some(&exported)),
            "case {case}"
        );
        assert_maps(&score, &imported);
        let original_timeline = compile(score.clone()).unwrap().timeline;
        let imported_timeline = compile(imported).unwrap().timeline;
        assert_eq!(original_timeline.notes.len(), imported_timeline.notes.len());
        let mut original_events = original_timeline
            .notes
            .iter()
            .map(|n| {
                (
                    n.midi,
                    n.start_ms.to_bits(),
                    n.duration_ms.to_bits(),
                    n.staff,
                    n.velocity,
                )
            })
            .collect::<Vec<_>>();
        let mut imported_events = imported_timeline
            .notes
            .iter()
            .map(|n| {
                (
                    n.midi,
                    n.start_ms.to_bits(),
                    n.duration_ms.to_bits(),
                    n.staff,
                    n.velocity,
                )
            })
            .collect::<Vec<_>>();
        original_events.sort();
        imported_events.sort();
        assert_eq!(original_events, imported_events, "performance case {case}");
        assert_eq!(
            original_timeline.duration_ms.to_bits(),
            imported_timeline.duration_ms.to_bits()
        );
        assert_eq!(serde_json::to_string(&score).unwrap(), before);
    }
}

#[test]
fn generated_numbered_melodies_preserve_spelling_rests_and_exact_rhythm() {
    let major_tonics = [
        "Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#",
    ];
    let minor_tonics = [
        "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "D#", "A#",
    ];
    let rhythms = [
        ["1/1", "1/1", "1/1", "1/1"],
        ["1/3", "2/3", "1/1", "2/1"],
        ["1/2", "3/2", "1/2", "3/2"],
        ["1/6", "5/6", "1/1", "2/1"],
    ];
    for case in 0..60 {
        let (mode, tonic) = if case % 30 < 15 {
            ("major", major_tonics[case % 15])
        } else {
            ("minor", minor_tonics[case % 15])
        };
        let mut text = format!(
            "format=worldmusichub-jianpu-text-v1\n1={tonic}4\nmode={mode}\ntempo=97.5\nmeter=4/4\n"
        );
        for index in 0..16 {
            let duration = rhythms[(case + index / 4) % rhythms.len()][index % 4];
            let token = if index % 5 == 0 {
                "0".into()
            } else {
                format!(
                    "{}{}{}",
                    ["", "#", "b"][(case + index) % 3],
                    index % 7 + 1,
                    ["", "'", ","][(case + index / 2) % 3]
                )
            };
            text.push_str(&format!("{token}:{duration} "));
        }
        let (score, _) =
            import_jianpu(&text).unwrap_or_else(|error| panic!("case {case}: {error}"));
        let before = serde_json::to_string(&score).unwrap();
        let exported = export_jianpu(&score).unwrap_or_else(|error| panic!("case {case}: {error}"));
        let (imported, _) =
            import_jianpu(&exported.text).unwrap_or_else(|error| panic!("case {case}: {error}"));
        assert_eq!(
            written_events(&score, None),
            written_events(&imported, None),
            "case {case}"
        );
        assert_maps(&score, &imported);
        assert_eq!(exported.note_map.len(), 16);
        assert_eq!(serde_json::to_string(&score).unwrap(), before);
        assert_eq!(score.source.unwrap().content, text);
        assert_eq!(imported.source.unwrap().content, exported.text);
    }
}
