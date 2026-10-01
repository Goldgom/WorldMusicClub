//! Whole-score semitone copies with a consistent written interval and exact restoration.
use crate::{
    compile,
    instruments::{analyze_instrument, InstrumentProfile, InstrumentReport},
    targets::plan_targets,
    validate, Compilation, Diagnostic, Pitch, Score, Source,
};
use serde::{Deserialize, Serialize};

pub const FORMAT: &str = "semitone-transposition";
const NATURAL: [i16; 7] = [0, 2, 4, 5, 7, 9, 11];
const STEPS: [&str; 7] = ["C", "D", "E", "F", "G", "A", "B"];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TranspositionOperation {
    pub semitones: i16,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct WrittenInterval {
    pub diatonic_steps: i16,
    pub fifths_delta: i8,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PreservedOriginal {
    version: u8,
    operation: TranspositionOperation,
    original: Score,
}

#[derive(Debug, Serialize)]
pub struct TranspositionPreview {
    pub compilation: Compilation,
    pub operation: TranspositionOperation,
    pub written_interval: WrittenInterval,
    pub changed_note_count: usize,
    pub original_preserved: bool,
    pub instrument_report: InstrumentReport,
    pub scored_mode_allowed: bool,
}

fn shifted_pitch(pitch: &Pitch, semitones: i16, steps: i16) -> Option<Pitch> {
    let target = i16::from(pitch.midi()?) + semitones;
    if !(0..=127).contains(&target) {
        return None;
    }
    let index = STEPS.iter().position(|step| *step == pitch.step)? as i16;
    let position = i16::from(pitch.octave) * 7 + index + steps;
    let octave = position.div_euclid(7);
    let next = position.rem_euclid(7) as usize;
    let alter = target - ((octave + 1) * 12 + NATURAL[next]);
    if !(-2..=2).contains(&alter) {
        return None;
    }
    Some(Pitch {
        step: STEPS[next].into(),
        alter: alter as i8,
        octave: i8::try_from(octave).ok()?,
    })
}

/// Version1's deterministic policy is part of the restoration contract: minimize
/// total key-signature accidentals, then written-note accidentals, then fifth distance.
fn choose_interval(original: &Score, semitones: i16) -> Result<WrittenInterval, String> {
    let mut candidates = Vec::new();
    for delta in -42i16..=42 {
        if (7 * delta).rem_euclid(12) != semitones.rem_euclid(12) {
            continue;
        }
        // Octave transposition keeps exact pitch spelling and signatures.
        if semitones.rem_euclid(12) == 0 && delta != 0 {
            continue;
        }
        if original
            .keys
            .iter()
            .any(|key| !(-7..=7).contains(&(i16::from(key.fifths) + delta)))
        {
            continue;
        }
        let degree = (4 * delta).rem_euclid(7);
        let octaves = (semitones - NATURAL[degree as usize] + 6).div_euclid(12);
        let steps = octaves * 7 + degree;
        let mut accidental_cost = 0usize;
        let mut possible = true;
        for pitch in original
            .parts
            .iter()
            .flat_map(|part| &part.notes)
            .filter_map(|note| note.pitch.as_ref())
        {
            if let Some(copy) = shifted_pitch(pitch, semitones, steps) {
                accidental_cost += usize::from(copy.alter.unsigned_abs());
            } else {
                possible = false;
                break;
            }
        }
        if !possible {
            continue;
        }
        let signature_cost: usize = original
            .keys
            .iter()
            .map(|key| (i16::from(key.fifths) + delta).unsigned_abs() as usize)
            .sum();
        candidates.push((
            (signature_cost, accidental_cost, delta.unsigned_abs(), delta),
            WrittenInterval {
                diatonic_steps: steps,
                fifths_delta: delta as i8,
            },
        ));
    }
    candidates.sort_by_key(|candidate| candidate.0);
    candidates.into_iter().next().map(|candidate|candidate.1).ok_or_else(||
        "No single written interval can preserve this shift within seven-signature accidentals and double-accidental note spelling. No notes were changed; use a different shift or an explicitly respelled score.".into())
}

fn transposed_copy(
    original: &Score,
    operation: &TranspositionOperation,
) -> Result<(Score, usize, WrittenInterval), String> {
    validate(original)?;
    if operation.semitones == 0 || !(-127..=127).contains(&operation.semitones) {
        return Err("Choose a nonzero whole-number semitone shift from -127 to 127".into());
    }
    if let Some(source) = &original.source {
        if source.format == "external-omr-draft" {
            return Err("Review external OMR output before transposition".into());
        }
        if source.format == FORMAT || source.format == "octave-adaptation" {
            return Err("Restore the preserved original before making another pitch copy".into());
        }
    }
    let mut changed = 0;
    for note in original.parts.iter().flat_map(|part| &part.notes) {
        if let Some(pitch) = &note.pitch {
            let target = i16::from(pitch.midi().expect("validated")) + operation.semitones;
            if !(0..=127).contains(&target) {
                return Err(format!(
                    "Transposition takes note {} outside MIDI 0–127; no notes were changed",
                    note.id
                ));
            }
            changed += 1;
        }
    }
    if changed == 0 {
        return Err("The score has no pitched notes to transpose".into());
    }
    let interval = choose_interval(original, operation.semitones)?;
    let mut score = original.clone();
    for note in score.parts.iter_mut().flat_map(|part| &mut part.notes) {
        if let Some(pitch) = &note.pitch {
            note.pitch = Some(
                shifted_pitch(pitch, operation.semitones, interval.diatonic_steps)
                    .expect("checked candidate"),
            );
        }
    }
    for key in &mut score.keys {
        key.fifths += interval.fifths_delta;
    }
    score.id = format!("{}:semitones:{:+}", original.id, operation.semitones);
    score.title = format!("{} [{:+} semitones]", original.title, operation.semitones);
    let mut observations = original
        .source
        .as_ref()
        .and_then(|source| source.import_diagnostics.clone())
        .unwrap_or_default();
    observations.push(Diagnostic::warning("explicit_semitone_transposition",
        format!("Whole-score copy shifted {:+} semitones with one consistent written interval. Original notes and source remain in the reversible record. Display and playback use the shifted pitches; no MIDI hardware transpose command is sent. Range checks do not certify fingering or permission to adapt.",operation.semitones),None));
    score.source = Some(Source {
        format: FORMAT.into(),
        filename: None,
        content: serde_json::to_string(&PreservedOriginal {
            version: 1,
            operation: operation.clone(),
            original: original.clone(),
        })
        .map_err(|error| error.to_string())?,
        import_diagnostics: Some(observations),
    });
    validate(&score)?;
    if serde_json::to_vec(&score)
        .map_err(|error| error.to_string())?
        .len()
        > 8 * 1024 * 1024
    {
        return Err("The reversible transposition exceeds 8 MiB. Keep the complete original and use a smaller score fragment.".into());
    }
    Ok((score, changed, interval))
}

pub fn preview_transposition(
    original: &Score,
    operation: TranspositionOperation,
    profile: &InstrumentProfile,
) -> Result<TranspositionPreview, String> {
    let (score, changed_note_count, written_interval) = transposed_copy(original, &operation)?;
    let compilation = compile(score)?;
    let instrument_report = analyze_instrument(&compilation.timeline, profile)?;
    let scored_mode_allowed = plan_targets(&compilation.timeline, profile)?.playable;
    Ok(TranspositionPreview {
        compilation,
        operation,
        written_interval,
        changed_note_count,
        original_preserved: true,
        instrument_report,
        scored_mode_allowed,
    })
}

pub fn restore_original(copy: &Score) -> Result<Compilation, String> {
    validate(copy)?;
    let source = copy
        .source
        .as_ref()
        .filter(|source| source.format == FORMAT)
        .ok_or("This score has no preserved semitone-transposition original")?;
    let envelope: PreservedOriginal = serde_json::from_str(&source.content)
        .map_err(|error| format!("Cannot read preserved transposition record: {error}"))?;
    if envelope.version != 1 {
        return Err("This transposition record requires a newer app version".into());
    }
    let (expected, _, _) = transposed_copy(&envelope.original, &envelope.operation)?;
    if serde_json::to_value(expected).map_err(|error| error.to_string())?
        != serde_json::to_value(copy).map_err(|error| error.to_string())?
    {
        return Err("This transposed copy contains later edits. Save/export those edits before restoring its original record.".into());
    }
    compile(envelope.original)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{catalog, Beat, Key};
    fn profile() -> InstrumentProfile {
        InstrumentProfile::Piano {
            key_count: 61,
            lowest_midi: None,
        }
    }
    fn operation(semitones: i16) -> TranspositionOperation {
        TranspositionOperation { semitones }
    }
    fn json(score: &Score) -> serde_json::Value {
        serde_json::to_value(score).unwrap()
    }

    #[test]
    fn major_second_preserves_diatonic_function_and_complete_original() {
        let mut original = catalog().remove(0);
        original.source = Some(Source {
            format: "musicxml".into(),
            filename: Some("原稿.musicxml".into()),
            content: "\u{feff}<score>原始\r\n</score>".into(),
            import_diagnostics: Some(vec![Diagnostic::warning(
                "source_expression",
                "Expression retained only in original",
                None,
            )]),
        });
        let before = json(&original);
        let preview = preview_transposition(&original, operation(2), &profile()).unwrap();
        assert_eq!(json(&original), before);
        assert_eq!(
            preview.written_interval,
            WrittenInterval {
                diatonic_steps: 1,
                fifths_delta: 2
            }
        );
        assert_eq!(preview.compilation.score.keys[0].fifths, 2);
        let mut expected = original.clone();
        expected.id = preview.compilation.score.id.clone();
        expected.title = preview.compilation.score.title.clone();
        expected.source = preview.compilation.score.source.clone();
        for part in &mut expected.parts {
            for note in &mut part.notes {
                if let Some(pitch) = &note.pitch {
                    note.pitch = shifted_pitch(pitch, 2, 1);
                }
            }
        }
        for key in &mut expected.keys {
            key.fifths += 2;
        }
        assert_eq!(json(&preview.compilation.score), json(&expected));
        assert_eq!(
            json(&restore_original(&preview.compilation.score).unwrap().score),
            before
        );
        assert!(preview
            .compilation
            .diagnostics
            .iter()
            .any(|d| d.code == "source_expression"));
        let reopened = compile(preview.compilation.score.clone()).unwrap();
        assert!(reopened
            .diagnostics
            .iter()
            .any(|d| d.code == "explicit_semitone_transposition"));
    }

    #[test]
    fn every_semitone_keeps_exact_sounding_offset_and_time_for_the_original_exercise() {
        let original = catalog().remove(0);
        let baseline = compile(original.clone()).unwrap();
        for semitones in -12..=12 {
            if semitones == 0 {
                continue;
            }
            let preview =
                preview_transposition(&original, operation(semitones), &profile()).unwrap();
            assert_eq!(
                baseline.timeline.notes.len(),
                preview.compilation.timeline.notes.len()
            );
            assert_eq!(
                baseline.timeline.duration_ms,
                preview.compilation.timeline.duration_ms
            );
            for (before, after) in baseline
                .timeline
                .notes
                .iter()
                .zip(&preview.compilation.timeline.notes)
            {
                assert_eq!(i16::from(after.midi), i16::from(before.midi) + semitones);
                let mut expected = serde_json::to_value(before).unwrap();
                expected["midi"] = serde_json::json!(after.midi);
                assert_eq!(serde_json::to_value(after).unwrap(), expected);
            }
            assert_eq!(
                json(&restore_original(&preview.compilation.score).unwrap().score),
                json(&original)
            );
        }
    }

    #[test]
    fn octave_multiple_preserves_spelling_and_signature_even_when_enharmonic_keys_are_simpler() {
        let mut original = catalog().remove(0);
        original.keys[0].fifths = -7;
        original.parts[0].notes[0].pitch = Some(Pitch {
            step: "C".into(),
            alter: -1,
            octave: 4,
        });
        let preview = preview_transposition(&original, operation(12), &profile()).unwrap();
        assert_eq!(
            preview.written_interval,
            WrittenInterval {
                diatonic_steps: 7,
                fifths_delta: 0
            }
        );
        for (before, after) in original.parts[0]
            .notes
            .iter()
            .zip(&preview.compilation.score.parts[0].notes)
        {
            if let Some(pitch) = &before.pitch {
                let copied = after.pitch.as_ref().unwrap();
                assert_eq!(copied.step, pitch.step);
                assert_eq!(copied.alter, pitch.alter);
                assert_eq!(copied.octave, pitch.octave + 1);
            }
        }
        assert_eq!(preview.compilation.score.keys[0].fifths, -7);
    }

    #[test]
    fn key_changes_keep_one_written_interval_and_unspecified_mode() {
        let mut original = catalog().remove(0);
        original.keys[0].mode = "unknown".into();
        original.keys.push(Key {
            at: Beat::new(4, 1),
            fifths: 1,
            mode: "minor".into(),
        });
        let preview = preview_transposition(&original, operation(1), &profile()).unwrap();
        assert_eq!(preview.written_interval.fifths_delta, -5);
        for (before, after) in original.keys.iter().zip(&preview.compilation.score.keys) {
            assert_eq!(after.fifths, before.fifths - 5);
            assert_eq!(after.mode, before.mode);
            assert_eq!(
                serde_json::to_value(after.at).unwrap(),
                serde_json::to_value(before.at).unwrap()
            );
        }
        original.keys[0].fifths = -7;
        original.keys[1].fifths = 7;
        assert!(preview_transposition(&original, operation(1), &profile())
            .unwrap_err()
            .contains("single written interval"));
    }

    #[test]
    fn tied_multivoice_complete_edition_retains_all_written_and_sounding_events() {
        let original = crate::catalog_score("cc0-beethoven-gottes-macht-op48-5").unwrap();
        let baseline = compile(original.clone()).unwrap();
        let preview = preview_transposition(&original, operation(-1), &profile()).unwrap();
        assert_eq!(preview.changed_note_count, 204);
        assert_eq!(preview.compilation.timeline.notes.len(), 198);
        assert_eq!(
            preview
                .compilation
                .score
                .parts
                .iter()
                .map(|part| part.notes.len())
                .sum::<usize>(),
            226
        );
        for (before, after) in baseline
            .timeline
            .notes
            .iter()
            .zip(&preview.compilation.timeline.notes)
        {
            assert_eq!(after.midi, before.midi - 1);
            assert_eq!(before.source_note_ids, after.source_note_ids);
            assert_eq!(before.duration_ms, after.duration_ms);
            assert_eq!(before.start_ms, after.start_ms);
        }
        assert_eq!(
            json(&restore_original(&preview.compilation.score).unwrap().score),
            json(&original)
        );
        assert!(
            !preview.scored_mode_allowed,
            "Out-of-range bass notes remain in the full target plan"
        );
    }

    #[test]
    fn bounds_zero_drafts_and_nested_copies_fail_without_mutating_sources() {
        let original = catalog().remove(0);
        let before = json(&original);
        for semitones in [0, -128, 128] {
            assert!(preview_transposition(&original, operation(semitones), &profile()).is_err());
        }
        let copy = preview_transposition(&original, operation(2), &profile())
            .unwrap()
            .compilation
            .score;
        assert!(preview_transposition(&copy, operation(2), &profile())
            .unwrap_err()
            .contains("Restore"));
        assert!(crate::adaptation::preview_octaves(
            &copy,
            crate::adaptation::OctaveOperation {
                part_id: None,
                octaves: 1
            },
            &profile()
        )
        .is_err());
        let mut edge = original.clone();
        edge.parts[0].notes[0].pitch = Some(Pitch {
            step: "C".into(),
            alter: 0,
            octave: -1,
        });
        let edge_before = json(&edge);
        assert!(preview_transposition(&edge, operation(-1), &profile())
            .unwrap_err()
            .contains("outside MIDI"));
        assert_eq!(json(&edge), edge_before);
        let mut draft = original.clone();
        draft.source = Some(Source {
            format: "external-omr-draft".into(),
            filename: None,
            content: "original draft".into(),
            import_diagnostics: None,
        });
        assert!(preview_transposition(&draft, operation(1), &profile())
            .unwrap_err()
            .contains("Review"));
        assert_eq!(json(&original), before);
    }

    #[test]
    fn restoration_refuses_later_edits_and_newer_records() {
        let original = catalog().remove(0);
        let preview = preview_transposition(&original, operation(2), &profile()).unwrap();
        let mut copy = preview.compilation.score.clone();
        copy.parts[0].notes[0].velocity = 10;
        assert!(restore_original(&copy).unwrap_err().contains("later edits"));
        let mut copy = preview.compilation.score;
        let source = copy.source.as_mut().unwrap();
        let mut envelope: serde_json::Value = serde_json::from_str(&source.content).unwrap();
        envelope["version"] = 2.into();
        source.content = serde_json::to_string(&envelope).unwrap();
        assert!(restore_original(&copy).unwrap_err().contains("newer app"));
    }

    #[test]
    fn rational_rests_tempo_changes_and_repeat_occurrences_stay_exact() {
        let mut original = catalog().remove(0);
        original.parts[0].notes.truncate(4);
        original.measures.truncate(1);
        original.parts[0].notes[0].duration = Beat::new(1, 2);
        let mut rest = original.parts[0].notes[0].clone();
        rest.id = "fractional-rest".into();
        rest.at = Beat::new(1, 2);
        rest.pitch = None;
        original.parts[0].notes.push(rest);
        original.tempo.push(crate::Tempo {
            at: Beat::new(2, 1),
            bpm: 123.5,
        });
        original.repeats.push(crate::Repeat {
            from: Beat::ZERO,
            to: Beat::new(4, 1),
            times: 3,
        });
        let baseline = compile(original.clone()).unwrap();
        let preview = preview_transposition(&original, operation(-2), &profile()).unwrap();
        assert_eq!(preview.changed_note_count, 4);
        assert_eq!(preview.compilation.timeline.notes.len(), 12);
        for (before, after) in baseline
            .timeline
            .notes
            .iter()
            .zip(&preview.compilation.timeline.notes)
        {
            let mut expected = serde_json::to_value(before).unwrap();
            expected["midi"] = serde_json::json!(before.midi - 2);
            assert_eq!(serde_json::to_value(after).unwrap(), expected);
        }
        let before = json(&original);
        let after = json(&preview.compilation.score);
        for field in ["tempo", "meters", "measures", "repeats"] {
            assert_eq!(after[field], before[field]);
        }
        assert_eq!(
            after["parts"][0]["notes"][4],
            before["parts"][0]["notes"][4]
        );
        assert_eq!(
            json(&restore_original(&preview.compilation.score).unwrap().score),
            before
        );
    }

    #[test]
    fn required_triple_accidentals_are_refused_without_respelling_individual_notes() {
        let mut original = catalog().remove(0);
        original.parts[0].notes.truncate(14);
        for (index, note) in original.parts[0].notes.iter_mut().enumerate() {
            note.pitch = Some(Pitch {
                step: STEPS[index / 2].into(),
                alter: if index % 2 == 0 { -2 } else { 2 },
                octave: 4,
            });
        }
        let before = json(&original);
        validate(&original).unwrap();
        let error = preview_transposition(&original, operation(1), &profile()).unwrap_err();
        assert!(error.contains("single written interval"));
        assert_eq!(json(&original), before);
    }

    #[test]
    fn scores_without_signatures_consider_all_seven_written_degree_choices() {
        let mut original = catalog().remove(0);
        original.keys.clear();
        original.parts[0].notes.truncate(1);
        original.measures.truncate(1);
        original.parts[0].notes[0].pitch = Some(Pitch {
            step: "C".into(),
            alter: -2,
            octave: 4,
        });
        let preview = preview_transposition(&original, operation(-11), &profile()).unwrap();
        let pitch = preview.compilation.score.parts[0].notes[0]
            .pitch
            .as_ref()
            .unwrap();
        assert_eq!((&*pitch.step, pitch.alter, pitch.octave), ("B", 0, 2));
        assert_eq!(
            preview.written_interval,
            WrittenInterval {
                diatonic_steps: -8,
                fifths_delta: 19
            }
        );
        assert!(preview.compilation.score.keys.is_empty());
    }

    #[test]
    fn frozen_version_one_copy_restores_without_regenerating_its_record() {
        let copy: Score = serde_json::from_str(include_str!(
            "../../../tests/fixtures/first-steps-transposed-v1.json"
        ))
        .unwrap();
        let envelope: PreservedOriginal =
            serde_json::from_str(&copy.source.as_ref().unwrap().content).unwrap();
        assert_eq!(envelope.version, 1);
        assert_eq!(envelope.operation.semitones, 2);
        let source = envelope.original.source.as_ref().unwrap();
        assert!(source.content.starts_with('\u{feff}'));
        assert!(source.content.contains("\r\n"));
        let restored = restore_original(&copy).unwrap();
        assert_eq!(json(&restored.score), json(&envelope.original));
        assert_eq!(restored.timeline.notes.len(), 15);
    }
}
