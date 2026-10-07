//! Independent original mechanical fixtures. Counts alone do not prove nesting:
//! verify complete source ownership, occurrence membership and physical identity.
use score_core::practice_progression::{
    self, CheckedPracticeProgression, PracticeProgressionPlan, ProgressionLayer,
};
use score_core::{
    assistance::NoteOwner,
    automatic_assistance::{
        self, AssistanceSelection, AutomaticSettings, CheckedPracticeAssistance,
    },
    instruments::InstrumentProfile,
    practice_source::PracticeSource,
    Beat, Note, Part, Pitch, Provenance, Repeat, Score, Tempo,
};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

fn note(id: &str, at: Beat, duration: Beat, midi: u8) -> Note {
    let (step, alter) = [
        ("C", 0),
        ("C", 1),
        ("D", 0),
        ("D", 1),
        ("E", 0),
        ("F", 0),
        ("F", 1),
        ("G", 0),
        ("G", 1),
        ("A", 0),
        ("A", 1),
        ("B", 0),
    ][usize::from(midi % 12)];
    Note {
        id: id.into(),
        at,
        duration,
        pitch: Some(Pitch {
            step: step.into(),
            alter,
            octave: (midi / 12) as i8 - 1,
        }),
        voice: "1".into(),
        staff: 1,
        velocity: 90,
        tie_start: false,
        tie_stop: false,
    }
}

fn ms(value: u32) -> Beat {
    Beat::new(i64::from(value), 500)
}

fn score(notes: Vec<Note>) -> Score {
    Score {
        format_metadata: None,
        version: 1,
        id: "original-progression-contract".into(),
        title: "Original progression contract fixture".into(),
        composer: "Mechanical test".into(),
        provenance: Provenance {
            kind: "original_exercise".into(),
            attribution: "Original mechanical fixture; no song transcription".into(),
            source_url: None,
            license: Some("CC0-1.0".into()),
        },
        parts: vec![Part {
            id: "piano".into(),
            name: "Piano".into(),
            instrument: "piano".into(),
            notes,
        }],
        tempo: vec![Tempo {
            at: Beat::ZERO,
            bpm: 120.0,
        }],
        meters: vec![],
        keys: vec![],
        measures: vec![],
        repeats: vec![],
        source: None,
    }
}

fn scope(source: &PracticeSource) -> AssistanceSelection {
    AssistanceSelection {
        selected_part_ids: source.part_ids().to_vec(),
        profile: InstrumentProfile::Piano {
            key_count: 88,
            lowest_midi: Some(21),
        },
    }
}

fn profiles() -> [AutomaticSettings; 3] {
    [(1, 500, 1, 0), (2, 250, 3, 7), (4, 125, 6, 12)].map(|(targets, interval, keys, span)| {
        AutomaticSettings {
            algorithm_id: automatic_assistance::ALGORITHM_ID.into(),
            max_targets_per_onset: targets,
            min_onset_interval_ms: interval,
            max_simultaneous_keys: keys,
            max_held_span_semitones: span,
        }
    })
}

fn bytes(value: &impl Serialize) -> Vec<u8> {
    serde_json::to_vec(value).unwrap()
}
fn json(value: &impl Serialize) -> serde_json::Value {
    serde_json::to_value(value).unwrap()
}
fn ids(values: &[String]) -> BTreeSet<&str> {
    values.iter().map(String::as_str).collect()
}

fn human_occurrences(checked: &CheckedPracticeAssistance) -> BTreeSet<&str> {
    checked
        .human_targets
        .groups
        .iter()
        .flat_map(|group| group.source_occurrence_ids.iter().map(String::as_str))
        .collect()
}

/// Every selected physical attack is reconstructed from the complete source,
/// including its representative, gate, velocity, part IDs and written segments.
fn assert_partition(
    source: &PracticeSource,
    checked: &CheckedPracticeAssistance,
    progression: bool,
) {
    let original: BTreeMap<_, _> = source
        .timeline()
        .notes
        .iter()
        .map(|n| (n.id.as_str(), n))
        .collect();
    let machines = ids(&checked.machine_occurrence_ids);
    let mut humans = BTreeSet::new();
    let owners: BTreeMap<_, _> = checked
        .source_ownership
        .iter()
        .map(|u| (u.source_id.as_str(), u))
        .collect();
    let human_units = ids(&checked.plan.human_source_ids);
    let selected = ids(&checked.plan.selection.selected_part_ids);
    assert_eq!(original.len(), source.timeline().notes.len());
    assert_eq!(machines.len(), checked.machine_occurrence_ids.len());
    assert_eq!(owners.len(), source.source_units().len());
    assert_eq!(owners.len(), checked.source_ownership.len());
    for unit in source.source_units() {
        let owner = owners[unit.source_id.as_str()];
        assert_eq!(owner.part_id, unit.part_id);
        assert_eq!(
            owner.in_selected_scope,
            selected.contains(unit.part_id.as_str())
        );
        assert_eq!(
            owner.owner == NoteOwner::Human,
            human_units.contains(unit.source_id.as_str())
        );
        assert!(!human_units.contains(unit.source_id.as_str()) || owner.in_selected_scope);
    }
    assert_eq!(
        checked.human_targets.groups.len(),
        checked.human_targets.timeline.notes.len()
    );
    for (group, target) in checked
        .human_targets
        .groups
        .iter()
        .zip(&checked.human_targets.timeline.notes)
    {
        let members: Vec<_> = group
            .source_occurrence_ids
            .iter()
            .map(|id| original[id.as_str()])
            .collect();
        assert!(!members.is_empty());
        assert_eq!(group.target_id, target.id);
        assert_eq!(target.id, members[0].id);
        let mut written = vec![];
        let mut parts = BTreeSet::new();
        for member in &members {
            assert!(
                humans.insert(member.id.as_str()),
                "duplicate human occurrence"
            );
            assert!(!machines.contains(member.id.as_str()));
            assert_eq!(member.midi, target.midi);
            assert_eq!(member.start_ms.to_bits(), target.start_ms.to_bits());
            written.extend(member.source_note_ids.iter().cloned());
            parts.insert(member.part_id.as_str());
        }
        assert_eq!(group.source_note_ids, written);
        assert_eq!(ids(&group.part_ids), parts);
        let mut expected = members[0].clone();
        expected.duration_ms = members.iter().map(|n| n.duration_ms).fold(0.0, f64::max);
        expected.velocity = members.iter().map(|n| n.velocity).max().unwrap();
        expected.source_note_ids = written;
        assert_eq!(bytes(target), bytes(&expected));
    }
    assert_eq!(
        humans.union(&machines).copied().collect::<BTreeSet<_>>(),
        original.keys().copied().collect()
    );
    for occurrence in original.values() {
        let human = humans.contains(occurrence.id.as_str());
        assert!(occurrence
            .source_note_ids
            .iter()
            .all(|id| human_units.contains(id.as_str()) == human));
        // Even an unselected part's exact unison joins the same full-source atom.
        for other in original.values().filter(|other| {
            other.midi == occurrence.midi
                && other.start_ms.to_bits() == occurrence.start_ms.to_bits()
        }) {
            assert_eq!(humans.contains(other.id.as_str()), human);
        }
    }
    let c = &checked.coverage;
    assert_eq!(c.source_unit_count, owners.len());
    assert_eq!(
        c.selected_source_unit_count,
        owners.values().filter(|u| u.in_selected_scope).count()
    );
    assert_eq!(c.human_source_unit_count, human_units.len());
    assert_eq!(
        c.machine_source_unit_count,
        owners.len() - human_units.len()
    );
    assert_eq!(c.occurrence_count, original.len());
    assert_eq!(c.human_occurrence_count, humans.len());
    assert_eq!(c.machine_occurrence_count, machines.len());
    assert_eq!(c.human_target_count, checked.human_targets.groups.len());
    assert_eq!(checked.human_targets.source_note_count, humans.len());
    assert_eq!(checked.human_targets.target_count, c.human_target_count);
    assert_eq!(
        c.selected_target_count,
        c.human_target_count + c.machine_selected_target_count
    );
    assert_eq!(
        checked.human_targets.timeline.duration_ms.to_bits(),
        source.timeline().duration_ms.to_bits()
    );
    assert_eq!(&checked.receipt, source.receipt());
    let mut rechecked = automatic_assistance::validate(source, &checked.plan).unwrap();
    if progression {
        // Progression exposes a precise cross-scope explanation while legacy
        // Explicit v1 retains its old generic reason. All ownership and plan
        // bytes remain identical; only this independently derived label differs.
        for reason in &mut rechecked.exclusion_reasons {
            if reason
                .source_ids
                .iter()
                .any(|id| !owners[id.as_str()].in_selected_scope)
            {
                reason.code = "cross_scope_physical_group".into();
            }
        }
    }
    assert_eq!(bytes(checked), bytes(&rechecked));
}

fn assert_limits(checked: &CheckedPracticeAssistance, limits: &AutomaticSettings) {
    let notes = &checked.human_targets.timeline.notes;
    let mut previous = None;
    for note in notes {
        assert!(
            notes
                .iter()
                .filter(|n| n.start_ms.to_bits() == note.start_ms.to_bits())
                .count()
                <= usize::from(limits.max_targets_per_onset)
        );
        if let Some(prior) = previous {
            if note.start_ms != prior {
                assert!(note.start_ms - prior >= f64::from(limits.min_onset_interval_ms));
            }
        }
        previous = Some(note.start_ms);
        let keys: BTreeSet<_> = notes
            .iter()
            .filter(|n| n.start_ms <= note.start_ms && n.start_ms + n.duration_ms > note.start_ms)
            .map(|n| n.midi)
            .collect();
        assert!(keys.len() <= usize::from(limits.max_simultaneous_keys));
        assert!(keys.last().unwrap() - keys.first().unwrap() <= limits.max_held_span_semitones);
    }
}

fn counterexample(interval: u32) -> Score {
    score(vec![
        note("opening", Beat::ZERO, ms(5), 60),
        note(
            "newly-accepted-hold",
            ms(interval / 2),
            ms(4 * interval),
            60,
        ),
        note("later-1", ms(interval), ms(5), 84),
        note("later-2", ms(2 * interval), ms(5), 84),
        note("later-3", ms(3 * interval), ms(5), 84),
    ])
}

fn tied_repeated_unisons() -> Score {
    let mut a = note("tie-a", Beat::ZERO, Beat::new(1, 3), 60);
    a.tie_start = true;
    let mut b = note("tie-b", Beat::new(1, 3), Beat::new(1, 3), 60);
    b.tie_start = true;
    b.tie_stop = true;
    let mut c = note("tie-c", Beat::new(2, 3), Beat::new(1, 3), 60);
    c.tie_stop = true;
    let mut fixture = score(vec![
        a,
        b,
        c,
        note("third", Beat::ZERO, Beat::new(1, 1), 64),
        note("fifth", Beat::ZERO, Beat::new(1, 1), 67),
        note("octave", Beat::ZERO, Beat::new(1, 1), 72),
        note("after-release", Beat::new(1, 1), Beat::new(1, 3), 76),
    ]);
    for (id, duration, velocity) in [
        ("unison-short", Beat::new(1, 2), 110),
        ("unison-long", Beat::new(1, 1), 70),
    ] {
        let mut n = note(id, Beat::ZERO, duration, 60);
        n.velocity = velocity;
        fixture.parts.push(Part {
            id: id.into(),
            name: id.into(),
            instrument: "piano".into(),
            notes: vec![n],
        });
    }
    fixture.measures.push(score_core::Measure {
        number: 1,
        at: Beat::ZERO,
        length: Beat::new(2, 1),
    });
    fixture.repeats.push(Repeat {
        from: Beat::ZERO,
        to: Beat::new(2, 1),
        times: 3,
    });
    fixture
}

fn generated_fixture(seed: u32) -> Score {
    // Deterministic mechanical cases exercise rate/hold conflicts, chords,
    // overlapping same keys, parts, exact fractional clocks and repeats.
    let mut state = u64::from(seed) + 1;
    let mut next = || {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
        (state >> 32) as u32
    };
    let mut fixture = score(vec![]);
    fixture.id = format!("original-progression-generated-{seed}");
    for part in 0..3 {
        let mut notes = vec![];
        for i in 0..18 {
            let onset = (next() % 32) * 125;
            let duration = [5, 125, 250, 500, 1000][(next() % 5) as usize];
            let midi = 48 + (next() % 37) as u8;
            notes.push(note(
                &format!("p{part}-n{i}"),
                ms(onset),
                ms(duration),
                midi,
            ));
        }
        // Cross-part physical atom exists even when random notes do not collide.
        notes.push(note(
            &format!("p{part}-shared"),
            Beat::ZERO,
            ms(250 + part * 125),
            60,
        ));
        if part == 0 {
            fixture.parts[0].notes = notes;
        } else {
            fixture.parts.push(Part {
                id: format!("part-{part}"),
                name: "Mechanical".into(),
                instrument: "piano".into(),
                notes,
            });
        }
    }
    if seed.is_multiple_of(3) {
        fixture.tempo = vec![
            Tempo {
                at: Beat::ZERO,
                bpm: 96.0,
            },
            Tempo {
                at: Beat::new(7, 3),
                bpm: 144.0,
            },
        ];
    }
    if seed.is_multiple_of(4) {
        fixture.measures.push(score_core::Measure {
            number: 1,
            at: Beat::ZERO,
            length: Beat::new(12, 1),
        });
        fixture.repeats.push(Repeat {
            from: Beat::ZERO,
            to: Beat::new(12, 1),
            times: 2,
        });
    }
    fixture
}

#[test]
fn legacy_widening_still_replaces_four_targets_with_two() {
    for pair in profiles().windows(2) {
        let source =
            PracticeSource::from_canonical(&counterexample(pair[0].min_onset_interval_ms)).unwrap();
        let narrow = automatic_assistance::generate(&source, &scope(&source), &pair[0]).unwrap();
        let wide = automatic_assistance::generate(&source, &scope(&source), &pair[1]).unwrap();
        assert_eq!(
            narrow.plan.human_source_ids,
            ["later-1", "later-2", "later-3", "opening"]
        );
        assert_eq!(
            wide.plan.human_source_ids,
            ["newly-accepted-hold", "opening"]
        );
        assert_eq!(narrow.coverage.human_target_count, 4);
        assert_eq!(wide.coverage.human_target_count, 2);
        assert!(!ids(&narrow.plan.human_source_ids).is_subset(&ids(&wide.plan.human_source_ids)));
        assert!(!ids(&wide.plan.human_source_ids).is_subset(&ids(&narrow.plan.human_source_ids)));
        for (checked, settings) in [(&narrow, &pair[0]), (&wide, &pair[1])] {
            assert_partition(&source, checked, false);
            assert_limits(checked, settings);
        }
    }
}

/// Optional export is an audit artifact, never a repository golden update.
/// Capture once on the accepted base and compare complete bytes after changes.
#[test]
fn legacy_original_and_generated_outputs_are_deterministic() {
    let mut sources: Vec<(String, PracticeSource)> = score_core::catalog()
        .iter()
        .map(|fixture| {
            (
                fixture.id.clone(),
                PracticeSource::from_canonical(fixture).unwrap(),
            )
        })
        .collect();
    let canonical: Score = serde_json::from_slice(include_bytes!(
        "../../../tests/fixtures/canonical-audio-source.json"
    ))
    .unwrap();
    sources.push((
        "canonical-audio-source".into(),
        PracticeSource::from_canonical(&canonical).unwrap(),
    ));
    sources.push((
        "tied-repeated-unisons".into(),
        PracticeSource::from_canonical(&tied_repeated_unisons()).unwrap(),
    ));
    for seed in 0..40 {
        sources.push((
            format!("generated-{seed}"),
            PracticeSource::from_canonical(&generated_fixture(seed)).unwrap(),
        ));
    }
    for interval in [250, 500] {
        sources.push((
            format!("widening-{interval}"),
            PracticeSource::from_canonical(&counterexample(interval)).unwrap(),
        ));
    }
    let basic = score_core::basic_keys::convert_midi(
        include_bytes!("../../../tests/fixtures/midi-original-ppq.mid"),
        "Original PPQ fixture",
    )
    .unwrap();
    sources.push((
        "basic-original-ppq".into(),
        PracticeSource::from_basic(&basic).unwrap(),
    ));
    let vsq = score_core::vsq_clean::decode_json(include_bytes!(
        "../../../tests/fixtures/vsq-clean-v1/score.json"
    ))
    .unwrap();
    sources.push((
        "vsq-original".into(),
        PracticeSource::from_vsq(
            &vsq,
            score_core::vsq_clean::PracticeChoice::BaseNotesInstrumental,
        )
        .unwrap(),
    ));
    let semantic = score_core::clean_song::decode_json(include_bytes!(
        "../../../tests/fixtures/clean-song-v2/score.json"
    ))
    .unwrap();
    sources.push((
        "complete-midi-original".into(),
        PracticeSource::from_complete_midi(&semantic).unwrap(),
    ));
    let mut records = vec![];
    for (name, source) in sources {
        let full = scope(&source);
        let mut selections = vec![full.clone()];
        if full.selected_part_ids.len() > 1 {
            let mut partial = full;
            partial.selected_part_ids.truncate(1);
            selections.push(partial);
        }
        for (selection_index, selection) in selections.iter().enumerate() {
            for (profile_index, settings) in profiles().iter().enumerate() {
                let first = automatic_assistance::generate(&source, selection, settings);
                let second = automatic_assistance::generate(&source, selection, settings);
                assert_eq!(bytes(&first), bytes(&second));
                if let Ok(checked) = &first {
                    assert_partition(&source, checked, false);
                }
                records.push((
                    format!("{name}/scope-{selection_index}/config-{profile_index}"),
                    first,
                ));
            }
        }
    }
    let encoded = bytes(&records);
    if let Ok(path) = std::env::var("WMC_LEGACY_AUDIT_OUTPUT") {
        std::fs::write(path, &encoded).unwrap();
    }
    eprintln!(
        "Legacy audit: {} complete checked outputs, {} bytes",
        records.len(),
        encoded.len()
    );
}

const LAYERS: [ProgressionLayer; 3] = [
    ProgressionLayer::Single,
    ProgressionLayer::Balanced,
    ProgressionLayer::Dense,
];

fn hierarchy(
    source: &PracticeSource,
    selection: &AssistanceSelection,
) -> Vec<CheckedPracticeProgression> {
    let before = bytes(source.timeline());
    let output: Vec<_> = LAYERS
        .into_iter()
        .map(|layer| practice_progression::generate(source, selection, layer).unwrap())
        .collect();
    for (index, checked) in output.iter().enumerate() {
        assert_eq!(checked.plan.layer, LAYERS[index]);
        assert_eq!(checked.layers.len(), 3);
        assert_eq!(bytes(&checked.layers), bytes(&output[0].layers));
        assert_eq!(
            checked.plan.selection_digest,
            output[0].plan.selection_digest
        );
        assert_eq!(checked.plan.scheme_digest, output[0].plan.scheme_digest);
        assert_eq!(
            checked.plan.hierarchy_digest,
            output[0].plan.hierarchy_digest
        );
        assert_eq!(&checked.plan.receipt, source.receipt());
        assert_eq!(
            checked.assistance.plan.mode,
            automatic_assistance::AssistanceMode::Explicit
        );
        assert_partition(source, &checked.assistance, true);
        assert_limits(&checked.assistance, &profiles()[index]);
        assert_eq!(
            bytes(checked),
            bytes(&practice_progression::validate(source, &checked.plan).unwrap())
        );
        assert!(bytes(checked).len() <= practice_progression::MAX_RESPONSE_BYTES);
        for (layer_index, summary) in checked.layers.iter().enumerate() {
            let actual = &output[layer_index].assistance;
            let constraints = &profiles()[layer_index];
            assert_eq!(summary.layer, LAYERS[layer_index]);
            assert_eq!(
                summary.constraints.max_targets_per_onset,
                constraints.max_targets_per_onset
            );
            assert_eq!(
                summary.constraints.min_onset_interval_ms,
                constraints.min_onset_interval_ms
            );
            assert_eq!(
                summary.constraints.max_simultaneous_keys,
                constraints.max_simultaneous_keys
            );
            assert_eq!(
                summary.constraints.max_held_span_semitones,
                constraints.max_held_span_semitones
            );
            assert_eq!(
                summary.human_source_unit_count,
                actual.plan.human_source_ids.len()
            );
            assert_eq!(
                summary.human_occurrence_count,
                human_occurrences(actual).len()
            );
            assert_eq!(
                summary.human_target_count,
                actual.human_targets.groups.len()
            );
            assert_eq!(summary.scored_mode_allowed, actual.scored_mode_allowed);
            assert_eq!(summary.scored_mode_allowed, summary.human_target_count > 0);
            assert_eq!(
                summary.equals_previous_layer,
                layer_index != 0
                    && actual.plan.human_source_ids
                        == output[layer_index - 1].assistance.plan.human_source_ids
            );
        }
        if index > 0 {
            let prior = &output[index - 1].assistance;
            let current = &checked.assistance;
            assert!(
                ids(&prior.plan.human_source_ids).is_subset(&ids(&current.plan.human_source_ids))
            );
            assert!(human_occurrences(prior).is_subset(&human_occurrences(current)));
            assert!(
                ids(&current.machine_occurrence_ids).is_subset(&ids(&prior.machine_occurrence_ids))
            );
            let current_targets: BTreeMap<_, _> = current
                .human_targets
                .groups
                .iter()
                .zip(&current.human_targets.timeline.notes)
                .map(|(group, note)| (group.target_id.as_str(), bytes(&(group, note))))
                .collect();
            for (group, note) in prior
                .human_targets
                .groups
                .iter()
                .zip(&prior.human_targets.timeline.notes)
            {
                assert_eq!(
                    current_targets[group.target_id.as_str()],
                    bytes(&(group, note)),
                    "retained physical target changed identity, source members, clock or gate"
                );
            }
            assert_ne!(checked.plan.plan_digest, output[index - 1].plan.plan_digest);
        }
    }
    assert_eq!(bytes(source.timeline()), before);
    output
}

#[test]
fn widest_first_removes_legacy_counterexample_without_claiming_optimality() {
    for interval in [250, 500] {
        let fixture = counterexample(interval);
        let source = PracticeSource::from_canonical(&fixture).unwrap();
        let checked = hierarchy(&source, &scope(&source));
        assert_eq!(checked[0].assistance.plan.human_source_ids, ["opening"]);
        assert_eq!(
            checked[2].assistance.plan.human_source_ids,
            ["newly-accepted-hold", "opening"]
        );
        assert_eq!(checked[0].assistance.coverage.human_target_count, 1);
        assert_eq!(checked[2].assistance.coverage.human_target_count, 2);
        // Deliberately fewer strict targets than independent v1. Nesting is a
        // constraint, never a claim of maximizing retained notes or skill grade.
        let legacy =
            automatic_assistance::generate(&source, &scope(&source), &profiles()[0]).unwrap();
        assert!(
            checked[0].assistance.coverage.human_target_count < legacy.coverage.human_target_count
        );
        for layer in &checked {
            assert!(layer
                .assistance
                .diagnostics
                .iter()
                .any(|d| d.message.contains("not a skill grade")
                    && d.message.contains("musical optimum")));
        }
    }
}

#[test]
fn full_source_atoms_preserve_ties_repeated_visits_and_transitive_cross_part_unisons() {
    let fixture = tied_repeated_unisons();
    let before = bytes(&fixture);
    let source = PracticeSource::from_canonical(&fixture).unwrap();
    let checked = hierarchy(&source, &scope(&source));
    assert_eq!(
        checked
            .iter()
            .map(|c| c.assistance.coverage.human_target_count)
            .collect::<Vec<_>>(),
        [6, 9, 15]
    );
    assert_eq!(source.source_units().len(), 9);
    assert_eq!(source.timeline().notes.len(), 21);
    for result in &checked {
        let groups: Vec<_> = result
            .assistance
            .human_targets
            .groups
            .iter()
            .filter(|g| g.source_note_ids.contains(&"tie-a".into()))
            .collect();
        assert_eq!(groups.len(), 3);
        for group in groups {
            assert_eq!(
                ids(&group.source_note_ids),
                BTreeSet::from(["tie-a", "tie-b", "tie-c", "unison-long", "unison-short"])
            );
            assert_eq!(group.source_occurrence_ids.len(), 3);
        }
    }
    let mut partial = scope(&source);
    partial.selected_part_ids = vec!["piano".into(), "unison-short".into()];
    let partial_layers = hierarchy(&source, &partial);
    for layer in partial_layers {
        for id in ["tie-a", "tie-b", "tie-c", "unison-short", "unison-long"] {
            assert!(!layer.assistance.plan.human_source_ids.contains(&id.into()));
        }
        let tied_occurrences: Vec<_> = source
            .timeline()
            .notes
            .iter()
            .filter(|n| {
                n.source_note_ids
                    .iter()
                    .any(|id| id == "tie-a" || id.starts_with("unison-"))
            })
            .collect();
        assert_eq!(tied_occurrences.len(), 9);
        assert!(tied_occurrences
            .iter()
            .all(|n| layer.assistance.machine_occurrence_ids.contains(&n.id)));
    }
    assert_eq!(bytes(&fixture), before);
}

#[test]
fn all_layers_use_exact_fractional_tempo_density_and_half_open_held_gates() {
    for index in 0..3 {
        let interval = profiles()[index].min_onset_interval_ms;
        // At 96 bpm one quarter is exactly 625ms. The later tempo segment is
        // 160 bpm, exactly 375ms/quarter. No epsilon may admit the early note.
        for early in [false, true] {
            let mut fixture = score(vec![
                note("first", Beat::ZERO, Beat::new(1, 625), 60),
                note(
                    "boundary-probe",
                    Beat::new(i64::from(interval) * 1600 - i64::from(early), 1_000_000),
                    Beat::new(1, 1_000_000),
                    60,
                ),
                note("after-change", Beat::new(2, 1), Beat::new(1, 375), 60),
                note(
                    "second-boundary",
                    Beat::new(2 * 375 + i64::from(interval), 375),
                    Beat::new(1, 375),
                    60,
                ),
            ]);
            fixture.tempo = vec![
                Tempo {
                    at: Beat::ZERO,
                    bpm: 96.0,
                },
                Tempo {
                    at: Beat::new(2, 1),
                    bpm: 160.0,
                },
            ];
            let source = PracticeSource::from_canonical(&fixture).unwrap();
            let all = hierarchy(&source, &scope(&source));
            let chosen = &all[index].assistance;
            assert_eq!(
                chosen
                    .plan
                    .human_source_ids
                    .contains(&"boundary-probe".into()),
                !early
            );
            assert!(chosen
                .plan
                .human_source_ids
                .contains(&"second-boundary".into()));
        }
        let held_fixture = score(vec![
            note("held", Beat::ZERO, ms(interval), 60),
            note("released-jump", ms(interval), ms(5), 96),
        ]);
        let held = PracticeSource::from_canonical(&held_fixture).unwrap();
        let held_layers = hierarchy(&held, &scope(&held));
        assert_eq!(
            held_layers[index].assistance.plan.human_source_ids,
            ["held", "released-jump"]
        );
        let overlap_fixture = score(vec![
            note(
                "held",
                Beat::ZERO,
                Beat::new(i64::from(interval) * 2000 + 1, 1_000_000),
                60,
            ),
            note("overlap-jump", ms(interval), ms(5), 96),
        ]);
        let overlap = PracticeSource::from_canonical(&overlap_fixture).unwrap();
        let overlap_layers = hierarchy(&overlap, &scope(&overlap));
        assert!(overlap_layers
            .iter()
            .all(|c| c.assistance.plan.human_source_ids == ["held"]));
    }
}

#[test]
fn range_empty_and_equal_layers_preserve_machine_complements_and_disable_empty_scoring() {
    for only_outside in [false, true] {
        let mut notes = vec![
            note("below", Beat::ZERO, ms(50), 59),
            note("above", ms(2000), ms(50), 72),
        ];
        if !only_outside {
            notes.extend([
                note("lowest", ms(500), ms(50), 60),
                note("highest", ms(1000), ms(50), 71),
            ]);
        }
        let source = PracticeSource::from_canonical(&score(notes)).unwrap();
        let mut selection = scope(&source);
        selection.profile = InstrumentProfile::Piano {
            key_count: 12,
            lowest_midi: Some(60),
        };
        let checked = hierarchy(&source, &selection);
        for layer in checked {
            assert_eq!(layer.assistance.machine_occurrence_ids, ["above", "below"]);
            assert_eq!(
                layer.assistance.plan.human_source_ids,
                if only_outside {
                    vec![]
                } else {
                    vec!["highest", "lowest"]
                }
            );
            assert_eq!(layer.assistance.scored_mode_allowed, !only_outside);
            assert!(!layer.layers[0].equals_previous_layer);
            assert!(layer.layers[1..]
                .iter()
                .all(|summary| summary.equals_previous_layer));
        }
        let original = automatic_assistance::original(&source, &selection).unwrap();
        assert_eq!(
            original.coverage.human_source_unit_count,
            source.source_units().len()
        );
    }
    let source =
        PracticeSource::from_canonical(&score(vec![note("one", Beat::ZERO, ms(100), 60)])).unwrap();
    for profile in [
        InstrumentProfile::Piano {
            key_count: 11,
            lowest_midi: Some(60),
        },
        InstrumentProfile::Piano {
            key_count: 88,
            lowest_midi: Some(60),
        },
        InstrumentProfile::Guitar {
            tuning: vec![40, 45, 50, 55, 59, 64],
            frets: 20,
            capo: 0,
        },
    ] {
        let selection = AssistanceSelection {
            selected_part_ids: source.part_ids().to_vec(),
            profile,
        };
        assert!(
            practice_progression::generate(&source, &selection, ProgressionLayer::Single).is_err()
        );
    }
}

#[test]
fn empty_written_parts_and_empty_sources_are_valid_zero_target_layers() {
    let mut fixture = score(vec![note("machine", Beat::ZERO, ms(100), 60)]);
    fixture.parts.push(Part {
        id: "empty-part".into(),
        name: "Empty written part".into(),
        instrument: "piano".into(),
        notes: vec![],
    });
    let source = PracticeSource::from_canonical(&fixture).unwrap();
    let mut selection = scope(&source);
    selection.selected_part_ids = vec!["empty-part".into()];
    for result in hierarchy(&source, &selection) {
        assert_eq!(result.assistance.machine_occurrence_ids, ["machine"]);
        assert_eq!(result.assistance.coverage.selected_source_unit_count, 0);
        assert!(!result.assistance.scored_mode_allowed);
    }
    let source = PracticeSource::from_canonical(&score(vec![])).unwrap();
    for result in hierarchy(&source, &scope(&source)) {
        assert!(result.assistance.machine_occurrence_ids.is_empty());
        assert!(result.assistance.plan.human_source_ids.is_empty());
        assert!(!result.assistance.scored_mode_allowed);
    }
}

#[test]
fn source_profile_selection_and_chosen_layer_are_bound_to_deterministic_proofs() {
    let fixture = tied_repeated_unisons();
    let source = PracticeSource::from_canonical(&fixture).unwrap();
    let first =
        practice_progression::generate(&source, &scope(&source), ProgressionLayer::Single).unwrap();
    let mut reordered = scope(&source);
    reordered.selected_part_ids.reverse();
    assert_eq!(
        bytes(&first),
        bytes(
            &practice_progression::generate(&source, &reordered, ProgressionLayer::Single).unwrap()
        )
    );
    for field in [
        "selection_digest",
        "scheme_digest",
        "hierarchy_digest",
        "plan_digest",
    ] {
        let mut changed = json(&first.plan);
        changed[field] = "0".repeat(64).into();
        let changed: PracticeProgressionPlan = serde_json::from_value(changed).unwrap();
        assert_eq!(
            practice_progression::validate(&source, &changed)
                .unwrap_err()
                .code,
            "progression_plan_mismatch"
        );
    }
    for field in ["format", "algorithm_id", "scheme_id"] {
        let mut changed = json(&first.plan);
        changed[field] = "unsupported".into();
        let changed: PracticeProgressionPlan = serde_json::from_value(changed).unwrap();
        assert_eq!(
            practice_progression::validate(&source, &changed)
                .unwrap_err()
                .code,
            "progression_plan_version"
        );
    }
    for field in ["schema_version", "planner_revision", "revision"] {
        let mut changed = json(&first.plan);
        changed[field] = 2.into();
        let changed: PracticeProgressionPlan = serde_json::from_value(changed).unwrap();
        assert_eq!(
            practice_progression::validate(&source, &changed)
                .unwrap_err()
                .code,
            "progression_plan_version"
        );
    }
    let mut edited_layer = first.plan.clone();
    edited_layer.layer = ProgressionLayer::Dense;
    assert_eq!(
        practice_progression::validate(&source, &edited_layer)
            .unwrap_err()
            .code,
        "progression_plan_mismatch"
    );
    for field in ["source_profile", "runtime_policy", "runtime_digest"] {
        let mut changed = json(&first.plan);
        changed["receipt"][field] = "changed".into();
        let changed: PracticeProgressionPlan = serde_json::from_value(changed).unwrap();
        assert_eq!(
            practice_progression::validate(&source, &changed)
                .unwrap_err()
                .code,
            "progression_source_mismatch"
        );
    }
    // This is the real digest of an original fixture's serialized bytes, not a
    // caller-supplied saved-package claim copied into an unverified receipt.
    use sha2::{Digest, Sha256};
    let saved_digest = format!("{:x}", Sha256::digest(bytes(&fixture)));
    let saved_source = source
        .clone()
        .with_verified_saved_binding(&saved_digest)
        .unwrap();
    assert_eq!(
        practice_progression::validate(&saved_source, &first.plan)
            .unwrap_err()
            .code,
        "progression_source_mismatch"
    );
    let saved_result = practice_progression::generate(
        &saved_source,
        &scope(&saved_source),
        ProgressionLayer::Single,
    )
    .unwrap();
    assert_ne!(
        saved_result.plan.hierarchy_digest,
        first.plan.hierarchy_digest
    );
    assert_eq!(
        saved_result.plan.receipt.saved_package_sha256.as_deref(),
        Some(saved_digest.as_str())
    );
    let mut profile = scope(&source);
    profile.profile = InstrumentProfile::Piano {
        key_count: 61,
        lowest_midi: Some(36),
    };
    let profile_result =
        practice_progression::generate(&source, &profile, ProgressionLayer::Single).unwrap();
    assert_eq!(
        first.assistance.plan.human_source_ids,
        profile_result.assistance.plan.human_source_ids
    );
    assert_ne!(
        first.plan.selection_digest,
        profile_result.plan.selection_digest
    );
    assert_ne!(
        first.plan.hierarchy_digest,
        profile_result.plan.hierarchy_digest
    );
    assert_eq!(first.plan.scheme_digest, profile_result.plan.scheme_digest);
    let mut edited_profile = first.plan.clone();
    edited_profile.selection = profile;
    assert_eq!(
        practice_progression::validate(&source, &edited_profile)
            .unwrap_err()
            .code,
        "progression_plan_mismatch"
    );
    let mut partial = scope(&source);
    partial.selected_part_ids.truncate(1);
    let partial_result =
        practice_progression::generate(&source, &partial, ProgressionLayer::Single).unwrap();
    assert_ne!(
        first.plan.selection_digest,
        partial_result.plan.selection_digest
    );
    assert_ne!(
        first.plan.hierarchy_digest,
        partial_result.plan.hierarchy_digest
    );
    let mut edited_selection = first.plan.clone();
    edited_selection.selection = partial;
    assert_eq!(
        practice_progression::validate(&source, &edited_selection)
            .unwrap_err()
            .code,
        "progression_plan_mismatch"
    );
    let mut changed_clock = fixture.clone();
    changed_clock.tempo[0].bpm = 121.0;
    let changed_clock = PracticeSource::from_canonical(&changed_clock).unwrap();
    assert_ne!(bytes(source.timeline()), bytes(changed_clock.timeline()));
    assert_eq!(
        practice_progression::validate(&changed_clock, &first.plan)
            .unwrap_err()
            .code,
        "progression_source_mismatch"
    );
    let mut changed_source = fixture;
    changed_source.title.push_str(" changed metadata");
    let changed_source = PracticeSource::from_canonical(&changed_source).unwrap();
    assert_eq!(bytes(source.timeline()), bytes(changed_source.timeline()));
    assert_eq!(
        practice_progression::validate(&changed_source, &first.plan)
            .unwrap_err()
            .code,
        "progression_source_mismatch"
    );
    let changed = practice_progression::generate(
        &changed_source,
        &scope(&changed_source),
        ProgressionLayer::Single,
    )
    .unwrap();
    assert_ne!(first.plan.selection_digest, changed.plan.selection_digest);
    assert_ne!(first.plan.hierarchy_digest, changed.plan.hierarchy_digest);
    let mut missing = scope(&source);
    missing.selected_part_ids = vec!["missing".into()];
    assert!(practice_progression::generate(&source, &missing, ProgressionLayer::Single).is_err());
    let mut duplicate = scope(&source);
    duplicate
        .selected_part_ids
        .push(duplicate.selected_part_ids[0].clone());
    assert!(practice_progression::generate(&source, &duplicate, ProgressionLayer::Single).is_err());
    let mut empty = scope(&source);
    empty.selected_part_ids.clear();
    assert!(practice_progression::generate(&source, &empty, ProgressionLayer::Single).is_err());
}

#[test]
fn caller_summaries_masks_and_checked_results_are_never_accepted_as_a_proof() {
    let source = PracticeSource::from_canonical(&tied_repeated_unisons()).unwrap();
    let original =
        practice_progression::generate(&source, &scope(&source), ProgressionLayer::Single).unwrap();
    let mut forged = json(&original);
    forged["layers"][0]["human_target_count"] = 999.into();
    forged["assistance"]["plan"]["human_source_ids"] = serde_json::json!(["third", "octave"]);
    assert!(serde_json::from_value::<PracticeProgressionPlan>(forged.clone()).is_err());
    for (field, value) in [
        ("layers", forged["layers"].clone()),
        ("assistance", forged["assistance"].clone()),
        ("human_source_ids", serde_json::json!(["third"])),
        ("eligible_source_ids", serde_json::json!(["third"])),
        (
            "constraints",
            serde_json::json!({"max_targets_per_onset": 32}),
        ),
    ] {
        let mut plan = json(&original.plan);
        plan[field] = value;
        assert!(
            serde_json::from_value::<PracticeProgressionPlan>(plan).is_err(),
            "unchecked {field} was accepted"
        );
    }
    // Only the independent plan is submitted; every caller-side changed summary
    // is discarded and replaced by the complete trusted rebuild.
    let proof: PracticeProgressionPlan = serde_json::from_value(forged["plan"].clone()).unwrap();
    assert_eq!(
        bytes(&practice_progression::validate(&source, &proof).unwrap()),
        bytes(&original)
    );
    assert!(
        serde_json::from_value::<PracticeProgressionPlan>(json(&original.assistance.plan)).is_err()
    );
}

fn basic_source(events: &[u8]) -> PracticeSource {
    let mut midi = b"MThd\0\0\0\x06\0\0\0\x01\0\x60MTrk".to_vec();
    let mut track = events.to_vec();
    track.extend([0, 255, 47, 0]);
    midi.extend((track.len() as u32).to_be_bytes());
    midi.extend(track);
    let basic = score_core::basic_keys::convert_midi(
        &midi,
        "Original progression native mechanical exercise",
    )
    .unwrap();
    PracticeSource::from_basic(&basic).unwrap()
}

#[test]
fn native_fifo_percussion_and_explicit_interpretation_remain_complete() {
    let source = basic_source(&[
        0, 0x90, 60, 90, 24, 0x90, 60, 91, 24, 0x80, 60, 0, 24, 0x80, 60, 0, 24, 0x90, 64, 90, 0,
        0x99, 64, 95, 24, 0x80, 64, 0, 0, 0x89, 64, 0,
    ]);
    assert_eq!(source.timeline().notes.len(), 4);
    assert_eq!(source.timeline().notes[0].start_ms, 0.0);
    assert_eq!(source.timeline().notes[0].duration_ms, 250.0);
    assert_eq!(source.timeline().notes[1].start_ms, 125.0);
    assert_eq!(source.timeline().notes[1].duration_ms, 250.0);
    let native = hierarchy(&source, &scope(&source));
    for layer in native {
        assert!(source
            .timeline()
            .notes
            .iter()
            .filter(|n| n.midi == 64)
            .all(|n| layer.assistance.machine_occurrence_ids.contains(&n.id)));
    }
    let vsq = score_core::vsq_clean::decode_json(include_bytes!(
        "../../../tests/fixtures/vsq-clean-v1/score.json"
    ))
    .unwrap();
    let source = PracticeSource::from_vsq(
        &vsq,
        score_core::vsq_clean::PracticeChoice::BaseNotesInstrumental,
    )
    .unwrap();
    assert_eq!(source.timeline().notes[0].start_ms, 0.0);
    assert_eq!(
        source.receipt().choice,
        Some(score_core::vsq_clean::PracticeChoice::BaseNotesInstrumental)
    );
    hierarchy(&source, &scope(&source));
    let semantic = score_core::clean_song::decode_json(include_bytes!(
        "../../../tests/fixtures/clean-song-v2/score.json"
    ))
    .unwrap();
    let source = PracticeSource::from_complete_midi(&semantic).unwrap();
    hierarchy(&source, &scope(&source));
}

#[test]
fn generated_cases_check_exact_membership_and_identity_in_every_real_layer() {
    for seed in 0..40 {
        let fixture = generated_fixture(seed);
        let original = bytes(&fixture);
        let source = PracticeSource::from_canonical(&fixture).unwrap();
        hierarchy(&source, &scope(&source));
        if seed.is_multiple_of(5) {
            let mut selection = scope(&source);
            selection.selected_part_ids.truncate(2);
            hierarchy(&source, &selection);
        }
        assert_eq!(bytes(&fixture), original);
    }
}

#[test]
fn work_and_complete_response_budgets_return_errors_without_partial_hierarchies() {
    // Widest spacing is exactly 125ms, so all sustained repeated attacks enter
    // the active set and exercise the actual shared finite work budget.
    let crowded = score(
        (0..3300)
            .map(|i| {
                note(
                    &format!("held-{i}"),
                    Beat::new(i, 4),
                    Beat::new(1000, 1),
                    60,
                )
            })
            .collect(),
    );
    let source = PracticeSource::from_canonical(&crowded).unwrap();
    for layer in LAYERS {
        let result = practice_progression::generate(&source, &scope(&source), layer);
        let error = result.unwrap_err();
        assert_eq!(error.code, "progression_work_limit");
        assert!(error.message.contains("no partial"));
    }
    assert_eq!(source.timeline().notes.len(), 3300);
    // Long legal source IDs make the complete checked result exceed the wire
    // budget even though source admission and linear selector work are valid.
    let large = score(
        (0..20_000)
            .map(|i| {
                note(
                    &format!("n{i:05}{}", "x".repeat(110)),
                    Beat::new(i, 1),
                    Beat::new(1, 1),
                    60,
                )
            })
            .collect(),
    );
    let source = PracticeSource::from_canonical(&large).unwrap();
    assert_eq!(source.source_units().len(), 20_000);
    let result = practice_progression::generate(&source, &scope(&source), ProgressionLayer::Single);
    let error = result.unwrap_err();
    assert!(matches!(
        error.code.as_str(),
        "assistance_response_limit" | "progression_response_limit"
    ));
    assert_eq!(source.timeline().notes.len(), 20_000);
    assert_eq!(source.source_units().len(), 20_000);
}
