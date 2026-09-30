//! Explain an arrangement's compatibility without transposing or discarding source notes.
use crate::{Diagnostic, Timeline};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum InstrumentProfile {
    Piano {
        key_count: u8,
        lowest_midi: Option<u8>,
    },
    Guitar {
        tuning: Vec<u8>,
        frets: u8,
        capo: u8,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct FretPosition {
    pub string: u8,
    pub fret: u8,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct NoteOptions {
    pub note_id: String,
    pub midi: u8,
    pub playable: bool,
    pub positions: Vec<FretPosition>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct InstrumentReport {
    pub lowest_midi: u8,
    pub highest_midi: u8,
    pub note_options: Vec<NoteOptions>,
    pub diagnostics: Vec<Diagnostic>,
    pub changed_source_notes: bool,
}
pub fn analyze_instrument(
    timeline: &Timeline,
    profile: &InstrumentProfile,
) -> Result<InstrumentReport, String> {
    if timeline.notes.len() > 100_000 {
        return Err("Instrument analysis exceeds 100,000 notes".into());
    }
    if timeline.notes.iter().any(|n| {
        n.id.len() > 128
            || n.midi > 127
            || !n.start_ms.is_finite()
            || n.start_ms < 0.
            || !n.duration_ms.is_finite()
            || n.duration_ms <= 0.
    }) {
        return Err("Invalid instrument timeline".into());
    }
    let (low, high) = match profile {
        InstrumentProfile::Piano {
            key_count,
            lowest_midi,
        } => {
            if !(12..=128).contains(key_count) {
                return Err("Piano key count must be 12–128".into());
            }
            let start = lowest_midi.unwrap_or(match key_count {
                49 | 61 => 36,
                76 => 28,
                88 => 21,
                _ => 60_u8.saturating_sub(key_count / 2),
            });
            let end = u16::from(start) + u16::from(*key_count) - 1;
            if end > 127 {
                return Err("Keyboard range exceeds MIDI pitch 127; lower the starting key".into());
            }
            (start, end as u8)
        }
        InstrumentProfile::Guitar {
            tuning,
            frets,
            capo,
        } => {
            if !(1..=12).contains(&tuning.len())
                || *frets > 36
                || *capo > *frets
                || tuning
                    .iter()
                    .any(|m| u16::from(*m) + u16::from(*frets) > 127)
            {
                return Err("Guitar requires 1–12 strings, 0–36 frets, a capo within the fret range, and MIDI-safe tuning".into());
            }
            (
                *tuning.iter().min().unwrap() + capo,
                *tuning.iter().max().unwrap() + frets,
            )
        }
    };
    let mut note_options = Vec::with_capacity(timeline.notes.len());
    let mut diagnostics = vec![];
    let mut out_count = 0;
    let mut onset_groups: HashMap<u64, Vec<usize>> = HashMap::new();
    for note in &timeline.notes {
        let positions = match profile {
            InstrumentProfile::Guitar {
                tuning,
                frets,
                capo,
            } => tuning
                .iter()
                .enumerate()
                .filter_map(|(i, open)| {
                    let relative = note.midi.checked_sub(open + capo)?;
                    (relative <= frets - capo).then_some(FretPosition {
                        string: i as u8 + 1,
                        fret: relative,
                    })
                })
                .collect(),
            _ => vec![],
        };
        let playable = match profile {
            InstrumentProfile::Piano { .. } => (low..=high).contains(&note.midi),
            InstrumentProfile::Guitar { .. } => !positions.is_empty(),
        };
        if !playable {
            out_count += 1;
        }
        onset_groups
            .entry(note.start_ms.max(0.).to_bits())
            .or_default()
            .push(note_options.len());
        note_options.push(NoteOptions {
            note_id: note.id.clone(),
            midi: note.midi,
            playable,
            positions,
        });
    }
    if out_count > 0 {
        diagnostics.push(Diagnostic::warning("instrument_range",format!("{out_count} notes cannot be played in this instrument range. No notes were transposed or removed; change the range, tuning, part selection or arrangement."),None));
    }
    if let InstrumentProfile::Guitar { tuning, .. } = profile {
        let mut impossible = 0;
        for indices in onset_groups.values() {
            // Exact simultaneous onsets only. Sustained overlaps and finger reach remain advisory.
            if indices.len() > tuning.len()
                || !can_assign_strings(indices, &note_options, tuning.len())
            {
                impossible += 1;
            }
        }
        if impossible > 0 {
            diagnostics.push(Diagnostic::warning("guitar_string_conflict",format!("{impossible} simultaneous note groups cannot be assigned to distinct strings in this tuning. A guitar arrangement is required."),None));
        }
        diagnostics.push(Diagnostic::warning("guitar_fingering_advisory","Fret positions are pitch-compatible candidates, not a validated fingering. Hand reach, barre technique, sustained overlaps and reading order require review.",None));
    }
    Ok(InstrumentReport {
        lowest_midi: low,
        highest_midi: high,
        note_options,
        diagnostics,
        changed_source_notes: false,
    })
}
fn can_assign_strings(indices: &[usize], options: &[NoteOptions], strings: usize) -> bool {
    if indices.len() > strings {
        return false;
    }
    // Bounded bipartite matching (at most 12 strings) avoids combinatorial fingering search.
    fn assign(
        note: usize,
        options: &[NoteOptions],
        seen: &mut BTreeSet<u8>,
        assigned: &mut [Option<usize>],
    ) -> bool {
        for position in &options[note].positions {
            if !seen.insert(position.string) {
                continue;
            }
            let i = usize::from(position.string - 1);
            if assigned[i].is_none() || assign(assigned[i].unwrap(), options, seen, assigned) {
                assigned[i] = Some(note);
                return true;
            }
        }
        false
    }
    let mut assigned = vec![None; strings];
    indices
        .iter()
        .all(|i| assign(*i, options, &mut BTreeSet::new(), &mut assigned))
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{catalog, compile};
    #[test]
    fn piano_presets_and_custom_key_counts_have_exact_ranges() {
        let t = compile(catalog().remove(0)).unwrap().timeline;
        for (count, expected) in [
            (49, (36, 84)),
            (61, (36, 96)),
            (76, (28, 103)),
            (88, (21, 108)),
        ] {
            let r = analyze_instrument(
                &t,
                &InstrumentProfile::Piano {
                    key_count: count,
                    lowest_midi: None,
                },
            )
            .unwrap();
            assert_eq!((r.lowest_midi, r.highest_midi), expected);
            assert!(!r.changed_source_notes);
        }
        let r = analyze_instrument(
            &t,
            &InstrumentProfile::Piano {
                key_count: 25,
                lowest_midi: Some(60),
            },
        )
        .unwrap();
        assert_eq!(r.highest_midi, 84);
    }
    #[test]
    fn invalid_ranges_and_tunings_are_rejected() {
        let t = compile(catalog().remove(0)).unwrap().timeline;
        assert!(analyze_instrument(
            &t,
            &InstrumentProfile::Piano {
                key_count: 88,
                lowest_midi: Some(60)
            }
        )
        .is_err());
        assert!(analyze_instrument(
            &t,
            &InstrumentProfile::Guitar {
                tuning: vec![],
                frets: 12,
                capo: 0
            }
        )
        .is_err());
    }
    #[test]
    fn guitar_positions_respect_capo_and_have_string_conflict_diagnostics() {
        let mut t = compile(catalog().remove(0)).unwrap().timeline;
        t.notes.truncate(2);
        for n in &mut t.notes {
            n.midi = 42;
            n.start_ms = 0.;
        }
        let r = analyze_instrument(
            &t,
            &InstrumentProfile::Guitar {
                tuning: vec![64, 59, 55, 50, 45, 40],
                frets: 12,
                capo: 2,
            },
        )
        .unwrap();
        assert_eq!(r.note_options[0].positions[0].string, 6);
        assert_eq!(r.note_options[0].positions[0].fret, 0);
        assert!(r
            .diagnostics
            .iter()
            .any(|d| d.code == "guitar_string_conflict"));
    }
    #[test]
    fn out_of_range_notes_remain_in_report() {
        let t = compile(catalog().remove(0)).unwrap().timeline;
        let r = analyze_instrument(
            &t,
            &InstrumentProfile::Piano {
                key_count: 12,
                lowest_midi: Some(21),
            },
        )
        .unwrap();
        assert_eq!(r.note_options.len(), t.notes.len());
        assert!(r.note_options.iter().all(|n| !n.playable));
    }
}
