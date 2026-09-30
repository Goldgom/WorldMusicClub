//! Explicit reversible octave copies. Never fold, drop or rewrite an original note.
use crate::{
    compile,
    instruments::{analyze_instrument, InstrumentProfile, InstrumentReport},
    targets::plan_targets,
    validate, Compilation, Score, Source,
};
use serde::{Deserialize, Serialize};

const FORMAT: &str = "octave-adaptation";
const MAX_COPY_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OctaveOperation {
    /// None shifts every part; Some shifts this entire part, including every tied segment.
    pub part_id: Option<String>,
    pub octaves: i8,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PreservedOriginal {
    version: u8,
    operation: OctaveOperation,
    original: Score,
}

#[derive(Clone, Debug, Serialize)]
pub struct AdaptationPreview {
    pub compilation: Compilation,
    pub operation: OctaveOperation,
    pub changed_note_count: usize,
    pub original_preserved: bool,
    pub instrument_report: InstrumentReport,
    pub scored_mode_allowed: bool,
}

fn shifted_copy(original: &Score, operation: &OctaveOperation) -> Result<(Score, usize), String> {
    validate(original)?;
    if original.source.as_ref().is_some_and(|s| s.format == FORMAT) {
        return Err(
            "Restore the preserved original before making another octave adaptation".into(),
        );
    }
    if operation.octaves == 0 || !(-8..=8).contains(&operation.octaves) {
        return Err("Choose a nonzero octave shift between -8 and 8".into());
    }
    if operation
        .part_id
        .as_ref()
        .is_some_and(|id| !original.parts.iter().any(|p| &p.id == id))
    {
        return Err("The selected adaptation part does not exist".into());
    }
    let mut score = original.clone();
    let mut changed = 0;
    for part in &mut score.parts {
        if operation.part_id.as_ref().is_some_and(|id| id != &part.id) {
            continue;
        }
        for note in &mut part.notes {
            if let Some(pitch) = &mut note.pitch {
                pitch.octave = pitch
                    .octave
                    .checked_add(operation.octaves)
                    .ok_or("Octave shift exceeds the supported pitch representation")?;
                if pitch.midi().is_none() {
                    return Err(format!(
                        "Octave shift takes note {} outside MIDI 0–127; no notes were changed",
                        note.id
                    ));
                }
                changed += 1;
            }
        }
    }
    if changed == 0 {
        return Err("The selected scope has no pitched notes to adapt".into());
    }
    let scope = operation.part_id.as_ref().map_or_else(
        || "all".to_string(),
        |id| {
            format!(
                "part{}",
                original.parts.iter().position(|p| &p.id == id).unwrap() + 1
            )
        },
    );
    score.id = format!("{}:octave:{}:{:+}", original.id, scope, operation.octaves);
    score.title = format!("{} [octave {:+}]", original.title, operation.octaves);
    score.source = Some(Source {
        format: FORMAT.into(),
        filename: None,
        content: serde_json::to_string(&PreservedOriginal {
            version: 1,
            operation: operation.clone(),
            original: original.clone(),
        })
        .map_err(|e| e.to_string())?,
    });
    validate(&score)?;
    // A copy must remain usable by the same JSON import/save boundary. Never omit the
    // original to squeeze a large derivative under the bound.
    if serde_json::to_vec(&score).map_err(|e| e.to_string())?.len() > MAX_COPY_BYTES {
        return Err(
            "The reversible copy exceeds 8 MiB; keep the original and use a smaller score fragment"
                .into(),
        );
    }
    Ok((score, changed))
}

/// Stateless preview only. A caller must obtain explicit confirmation before activating/saving it.
pub fn preview_octaves(
    original: &Score,
    operation: OctaveOperation,
    profile: &InstrumentProfile,
) -> Result<AdaptationPreview, String> {
    let (score, changed_note_count) = shifted_copy(original, &operation)?;
    let mut compilation = compile(score)?;
    compilation.diagnostics.push(crate::Diagnostic::warning(
        "explicit_octave_adaptation",
        "This is an explicitly shifted copy. The original score/source is preserved in its adaptation record. Pitch range checks do not certify fingering, sustained overlaps or permission to adapt the work.",
        None,
    ));
    let mut selected = compilation.timeline.clone();
    if let Some(id) = &operation.part_id {
        selected.notes.retain(|n| &n.part_id == id);
    }
    let instrument_report = analyze_instrument(&selected, profile)?;
    let scored_mode_allowed = plan_targets(&selected, profile)?.playable;
    Ok(AdaptationPreview {
        compilation,
        operation,
        changed_note_count,
        original_preserved: true,
        instrument_report,
        scored_mode_allowed,
    })
}

/// Refuse to discard later edits. The supplied derivative must exactly match the recorded operation.
pub fn restore_original(derivative: &Score) -> Result<Compilation, String> {
    validate(derivative)?;
    let source = derivative
        .source
        .as_ref()
        .filter(|s| s.format == FORMAT)
        .ok_or("This score has no preserved octave-adaptation original")?;
    let envelope: PreservedOriginal = serde_json::from_str(&source.content)
        .map_err(|e| format!("Invalid preserved adaptation: {e}"))?;
    if envelope.version != 1 {
        return Err("Unsupported adaptation record version".into());
    }
    let (expected, _) = shifted_copy(&envelope.original, &envelope.operation)?;
    if serde_json::to_value(&expected).map_err(|e| e.to_string())?
        != serde_json::to_value(derivative).map_err(|e| e.to_string())?
    {
        return Err("This adapted copy contains later edits; export/save those edits before restoring from its original record".into());
    }
    compile(envelope.original)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{catalog, Beat};
    fn piano() -> InstrumentProfile {
        InstrumentProfile::Piano {
            key_count: 61,
            lowest_midi: None,
        }
    }
    fn operation(octaves: i8) -> OctaveOperation {
        OctaveOperation {
            part_id: None,
            octaves,
        }
    }
    fn json(score: &Score) -> serde_json::Value {
        serde_json::to_value(score).unwrap()
    }

    #[test]
    fn preserves_every_note_and_exact_original_source_and_roundtrips() {
        let mut score = catalog().remove(0);
        score.source = Some(Source {
            format: "musicxml".into(),
            filename: Some("original.xml".into()),
            content: "\u{feff}<xml> 原始 \r\n</xml>".into(),
        });
        score.parts[0].notes[0].pitch.as_mut().unwrap().alter = 2;
        let before = json(&score);
        let preview = preview_octaves(&score, operation(1), &piano()).unwrap();
        assert_eq!(preview.changed_note_count, 15);
        assert!(preview.scored_mode_allowed);
        assert_eq!(json(&score), before);
        let shifted = &preview.compilation.score;
        for (old, new) in score.parts[0].notes.iter().zip(&shifted.parts[0].notes) {
            let mut expected = old.clone();
            if let Some(pitch) = &mut expected.pitch {
                pitch.octave += 1;
            }
            assert_eq!(
                serde_json::to_value(expected).unwrap(),
                serde_json::to_value(new).unwrap()
            );
        }
        assert_eq!(json(&restore_original(shifted).unwrap().score), before);
        assert_eq!(
            serde_json::to_value(&shifted.provenance).unwrap(),
            serde_json::to_value(&score.provenance).unwrap()
        );
    }
    #[test]
    fn selected_part_does_not_change_other_parts_or_score_timing() {
        let mut score = catalog().remove(0);
        let mut other = score.parts[0].clone();
        other.id = "other".into();
        for note in &mut other.notes {
            note.id = format!("other-{}", note.id);
        }
        score.parts.push(other.clone());
        let result = preview_octaves(
            &score,
            OctaveOperation {
                part_id: Some("piano".into()),
                octaves: -1,
            },
            &piano(),
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(&result.compilation.score.parts[1]).unwrap(),
            serde_json::to_value(other).unwrap()
        );
        assert_eq!(result.instrument_report.note_options.len(), 15);
        assert_eq!(
            result.compilation.timeline.duration_ms,
            compile(score.clone()).unwrap().timeline.duration_ms
        );
        assert_eq!(
            json(&restore_original(&result.compilation.score).unwrap().score),
            json(&score)
        );
    }
    #[test]
    fn preserves_tied_spelling_repeats_and_rational_offsets() {
        let mut score = catalog().remove(0);
        score.parts[0].notes.truncate(2);
        score.parts[0].notes[0].duration = Beat::new(1, 3);
        score.parts[0].notes[0].tie_start = true;
        score.parts[0].notes[1].at = Beat::new(1, 3);
        score.parts[0].notes[1].duration = Beat::new(2, 3);
        score.parts[0].notes[1].pitch = score.parts[0].notes[0].pitch.clone();
        score.parts[0].notes[1].tie_stop = true;
        score.repeats.push(crate::Repeat {
            from: Beat::ZERO,
            to: Beat::new(4, 1),
            times: 2,
        });
        let baseline = compile(score.clone()).unwrap();
        let result = preview_octaves(&score, operation(1), &piano()).unwrap();
        assert_eq!(result.changed_note_count, 2);
        for (old, new) in baseline
            .timeline
            .notes
            .iter()
            .zip(&result.compilation.timeline.notes)
        {
            assert_eq!(new.midi, old.midi + 12);
            assert_eq!(new.start_ms, old.start_ms);
            assert_eq!(new.duration_ms, old.duration_ms);
            assert_eq!(new.source_note_ids, old.source_note_ids);
        }
        assert_eq!(
            json(&restore_original(&result.compilation.score).unwrap().score),
            json(&score)
        );
    }
    #[test]
    fn range_conflicts_remain_visible_without_dropping_notes() {
        let score = catalog().remove(0);
        let result = preview_octaves(&score, operation(4), &piano()).unwrap();
        assert!(!result.scored_mode_allowed);
        assert!(result
            .instrument_report
            .diagnostics
            .iter()
            .any(|d| d.code == "instrument_range"));
        assert_eq!(result.compilation.timeline.notes.len(), 15);
        assert!(preview_octaves(&score, operation(8), &piano()).is_err());
    }
    #[test]
    fn refuses_unknown_empty_scope_noop_nesting_and_later_edit_loss() {
        let score = catalog().remove(0);
        assert!(preview_octaves(&score, operation(0), &piano()).is_err());
        assert!(preview_octaves(
            &score,
            OctaveOperation {
                part_id: Some("missing".into()),
                octaves: 1
            },
            &piano()
        )
        .is_err());
        let mut rest_only = score.clone();
        rest_only.parts[0].notes.retain(|n| n.pitch.is_none());
        assert!(preview_octaves(&rest_only, operation(1), &piano()).is_err());
        let mut adapted = preview_octaves(&score, operation(1), &piano())
            .unwrap()
            .compilation
            .score;
        assert!(preview_octaves(&adapted, operation(1), &piano()).is_err());
        adapted.title.push_str(" edited");
        assert!(restore_original(&adapted)
            .unwrap_err()
            .contains("later edits"));
        assert!(restore_original(&score).is_err());
    }
    #[test]
    fn refuses_large_reversible_copy_instead_of_omitting_original() {
        let mut score = catalog().remove(0);
        score.source = Some(Source {
            format: "original".into(),
            filename: None,
            content: "\"".repeat(3 * 1024 * 1024),
        });
        assert!(preview_octaves(&score, operation(1), &piano()).is_err());
    }
}
