//! Disposable whole-song pitch views. Original packages and exact clocks remain
//! authoritative; only this core derives the effective pitches consumed by all
//! practice, notation and playback adapters.
use crate::{
    basic_keys, clean_song,
    fingering_source::FingeringSource,
    practice_source::{hash, PracticeRuntimeReceipt, PracticeSource, PracticeSourceError},
    transposition::{choose_interval, shifted_pitch, WrittenInterval},
    vsq_clean, Beat, Compilation, Key, Note, Pitch, Score,
};
use serde::Serialize;
use std::collections::{BTreeSet, HashMap};

pub const FORMAT: &str = "wmc-pitch-mod";
pub const VERSION: u32 = 1;
pub const RUNTIME_POLICY: &str = "wmc-pitch-mod-v1";
pub type PitchProjectionError = PracticeSourceError;

#[derive(Clone, Debug, Serialize)]
pub struct EffectiveSourcePitch {
    pub source_id: String,
    pub part_id: String,
    pub original_midi: u8,
    pub effective_midi: u8,
    pub percussion: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct PitchProjectionIdentity {
    pub format: String,
    pub version: u32,
    pub semitones: i16,
    pub original_receipt: PracticeRuntimeReceipt,
    pub written_interval: WrittenInterval,
    pub digest: String,
}

/// No Deserialize and no public fields: native adapters must load the complete
/// original source and use its trusted constructor. This is never a saved song.
pub struct PitchProjection {
    original: PracticeSource,
    effective: PracticeSource,
    compilation: Compilation,
    identity: Option<PitchProjectionIdentity>,
    pitches: Vec<EffectiveSourcePitch>,
    fingering: Option<FingeringSource>,
}

fn error(code: &str, message: impl Into<String>) -> PitchProjectionError {
    PitchProjectionError::new(code, message)
}
fn source_error(message: String) -> PitchProjectionError {
    error("pitch_mod_source", message)
}
fn nominal_pitch(key: u8) -> Pitch {
    const STEPS: [&str; 12] = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
    const ALTERS: [i8; 12] = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
    Pitch {
        step: STEPS[usize::from(key % 12)].into(),
        alter: ALTERS[usize::from(key % 12)],
        octave: (key / 12) as i8 - 1,
    }
}

impl PitchProjection {
    pub fn from_canonical(score: &Score, semitones: i16) -> Result<Self, PitchProjectionError> {
        let source = PracticeSource::from_canonical(score)?;
        let fingering = FingeringSource::canonical(score.clone()).map_err(source_error)?;
        Self::build(source, score, semitones, Some(fingering), &[])
    }
    pub fn from_basic(
        score: &basic_keys::CompleteBasicKeys,
        semitones: i16,
    ) -> Result<Self, PitchProjectionError> {
        let source = PracticeSource::from_basic(score)?;
        // Basic's canonical envelope deliberately has no inferred key map.
        // Consider every explicit supported source signature when choosing one
        // written interval, including signatures outside the first display page.
        let keys: Vec<_> = score
            .performance
            .tracks
            .iter()
            .flat_map(|track| &track.events)
            .filter_map(|record| match record.1.as_slice() {
                [255, 0x59, fifths, mode] if (-7..=7).contains(&(*fifths as i8)) && *mode <= 1 => {
                    Some(Key {
                        at: Beat::ZERO,
                        fifths: *fifths as i8,
                        mode: if *mode == 0 { "major" } else { "minor" }.into(),
                    })
                }
                _ => None,
            })
            .collect();
        Self::build(source, &score.notation, semitones, None, &keys)
    }
    pub fn from_vsq(
        score: &vsq_clean::VsqCompleteScore,
        choice: vsq_clean::PracticeChoice,
        semitones: i16,
    ) -> Result<Self, PitchProjectionError> {
        let source = PracticeSource::from_vsq(score, choice)?;
        let fingering = FingeringSource::explicit_vsq(score, choice).map_err(source_error)?;
        Self::build(source, &score.notation, semitones, Some(fingering), &[])
    }
    pub fn from_complete_midi(
        score: &clean_song::CompleteScore,
        semitones: i16,
    ) -> Result<Self, PitchProjectionError> {
        let source = PracticeSource::from_complete_midi(score)?;
        let fingering = FingeringSource::complete_midi(score).map_err(source_error)?;
        Self::build(source, &score.notation, semitones, Some(fingering), &[])
    }
    fn build(
        original: PracticeSource,
        notation: &Score,
        semitones: i16,
        mut fingering: Option<FingeringSource>,
        extra_keys: &[Key],
    ) -> Result<Self, PitchProjectionError> {
        if !(-12..=12).contains(&semitones) {
            return Err(error(
                "pitch_mod_shift",
                "Choose an integer shift from -12 to 12 semitones",
            ));
        }
        let mut inventory = HashMap::new();
        for note in original.timeline().notes.iter() {
            let percussion = original.keyboard_excluded.contains(&note.id);
            for id in &note.source_note_ids {
                if inventory
                    .insert(id.as_str(), (note.midi, percussion))
                    .is_some_and(|previous| previous != (note.midi, percussion))
                {
                    return Err(error("pitch_mod_inventory", "A source note has inconsistent pitch or percussion semantics across occurrences"));
                }
            }
        }
        let mut pitches = Vec::with_capacity(original.source_units().len());
        for unit in original.source_units() {
            let &(midi, percussion) = inventory.get(unit.source_id.as_str()).ok_or_else(|| {
                error(
                    "pitch_mod_inventory",
                    "A source unit has no trusted runtime pitch",
                )
            })?;
            let target = i16::from(midi) + if percussion { 0 } else { semitones };
            if !(0..=127).contains(&target) {
                let mut failure = error("pitch_mod_midi_range", "The whole pitch projection was rejected because a pitched note would leave MIDI 0–127");
                failure.source_ids.push(unit.source_id.clone());
                return Err(failure);
            }
            pitches.push(EffectiveSourcePitch {
                source_id: unit.source_id.clone(),
                part_id: unit.part_id.clone(),
                original_midi: midi,
                effective_midi: target as u8,
                percussion,
            });
        }
        let mut effective_notation = notation.clone();
        let identity = if semitones == 0 {
            None
        } else {
            if !pitches.iter().any(|pitch| !pitch.percussion) {
                return Err(error("pitch_mod_no_pitched_notes", "This source has no pitched notes; its percussion selectors and original source are unchanged"));
            }
            // This temporary spelling inventory is never compiled or admitted as
            // a source. Include native attacks absent from the written envelope
            // so later pages cannot quietly select another written interval.
            let mut spelling = notation.clone();
            spelling.keys.extend_from_slice(extra_keys);
            let written: HashMap<_, _> = notation
                .parts
                .iter()
                .flat_map(|part| &part.notes)
                .filter_map(|note| note.pitch.as_ref().map(|pitch| (note.id.as_str(), pitch)))
                .collect();
            for part in &mut spelling.parts {
                part.notes.clear();
            }
            let first = spelling.parts.first_mut().ok_or_else(|| {
                error("pitch_mod_inventory", "Pitched source has no notation part")
            })?;
            for pitch in pitches.iter().filter(|pitch| !pitch.percussion) {
                first.notes.push(Note {
                    id: pitch.source_id.clone(),
                    at: Beat::ZERO,
                    duration: Beat::new(1, 1),
                    pitch: Some(written.get(pitch.source_id.as_str()).map_or_else(
                        || nominal_pitch(pitch.original_midi),
                        |pitch| (*pitch).clone(),
                    )),
                    voice: "1".into(),
                    staff: 1,
                    velocity: 90,
                    tie_start: false,
                    tie_stop: false,
                });
            }
            let interval = choose_interval(&spelling, semitones)
                .map_err(|message| error("pitch_mod_spelling", message))?;
            project_score(&mut effective_notation, &pitches, semitones, &interval)?;
            let digest = hash(&(FORMAT, VERSION, semitones, original.receipt(), &interval))?;
            Some(PitchProjectionIdentity {
                format: FORMAT.into(),
                version: VERSION,
                semitones,
                original_receipt: original.receipt().clone(),
                written_interval: interval,
                digest,
            })
        };
        let effective = match &identity {
            Some(identity) => original.with_pitch_projection(semitones, &identity.digest)?,
            None => original.clone(),
        };
        let compilation = Compilation {
            score: effective_notation,
            timeline: effective.timeline().clone(),
            diagnostics: original.diagnostics.clone(),
        };
        if let Some(source) = &mut fingering {
            source.compilation = compilation.clone();
        }
        Ok(Self {
            original,
            effective,
            compilation,
            identity,
            pitches,
            fingering,
        })
    }
    /// Only after the native adapter verifies the exact saved package bytes.
    pub fn with_verified_saved_binding(
        mut self,
        digest: &str,
    ) -> Result<Self, PitchProjectionError> {
        self.original = self.original.with_verified_saved_binding(digest)?;
        self.effective = if let Some(identity) = &mut self.identity {
            identity.original_receipt = self.original.receipt().clone();
            identity.digest = hash(&(
                FORMAT,
                VERSION,
                identity.semitones,
                self.original.receipt(),
                &identity.written_interval,
            ))?;
            self.original
                .with_pitch_projection(identity.semitones, &identity.digest)?
        } else {
            self.original.clone()
        };
        Ok(self)
    }
    pub fn source(&self) -> &PracticeSource {
        &self.effective
    }
    pub fn original_receipt(&self) -> &PracticeRuntimeReceipt {
        self.original.receipt()
    }
    pub fn notation(&self) -> &Score {
        &self.compilation.score
    }
    pub fn compilation(&self) -> &Compilation {
        &self.compilation
    }
    pub fn identity(&self) -> Option<&PitchProjectionIdentity> {
        self.identity.as_ref()
    }
    pub fn source_pitches(&self) -> &[EffectiveSourcePitch] {
        &self.pitches
    }
    pub fn into_fingering_source(self) -> Result<FingeringSource, PitchProjectionError> {
        self.fingering.ok_or_else(|| {
            error(
                "pitch_mod_fingering_unavailable",
                "Basic receiver notation does not establish a complete fingering source",
            )
        })
    }
    /// Build a page from the same complete original source, then apply this
    /// projection's single written interval and source-ID pitch mapping.
    pub fn basic_notation_page(
        &self,
        original: &basic_keys::CompleteBasicKeys,
        request: &basic_keys::NotationRequest,
    ) -> Result<basic_keys::NotationPage, PitchProjectionError> {
        let verified = PracticeSource::from_basic(original)?;
        if verified.receipt().source_binding != self.original.receipt().source_binding
            || verified.receipt().runtime_digest != self.original.receipt().runtime_digest
        {
            return Err(error(
                "pitch_mod_source_mismatch",
                "Notation page belongs to another complete source or interpretation",
            ));
        }
        let mut page = basic_keys::notation_page(original, request).map_err(source_error)?;
        let Some(identity) = &self.identity else {
            return Ok(page);
        };
        let pitches: HashMap<_, _> = self
            .pitches
            .iter()
            .map(|pitch| (pitch.source_id.as_str(), pitch))
            .collect();
        let project = |id: &str, key: &mut u8| -> Result<(), PitchProjectionError> {
            let pitch = pitches.get(id).ok_or_else(|| {
                error(
                    "pitch_mod_inventory",
                    "Notation page contains an unknown source pitch",
                )
            })?;
            if *key != pitch.original_midi {
                return Err(error(
                    "pitch_mod_inventory",
                    "Notation pitch disagrees with its complete original source",
                ));
            }
            *key = pitch.effective_midi;
            Ok(())
        };
        for note in &mut page.interpreted_notes {
            project(&note.note_id, &mut note.key)?;
        }
        for note in page
            .onsets
            .iter_mut()
            .chain(&mut page.selectors)
            .chain(&mut page.unresolved)
            .chain(&mut page.instantaneous)
        {
            project(&note.note_id, &mut note.key)?;
        }
        if let Some(score) = &mut page.score {
            project_score(
                score,
                &self.pitches,
                identity.semitones,
                &identity.written_interval,
            )?;
            if page.musicxml.is_some() {
                let incoming: BTreeSet<_> = page
                    .continuations
                    .iter()
                    .filter(|note| note.enters_page)
                    .map(|note| note.note_id.clone())
                    .collect();
                let outgoing: BTreeSet<_> = page
                    .continuations
                    .iter()
                    .filter(|note| note.leaves_page)
                    .map(|note| note.note_id.clone())
                    .collect();
                page.musicxml = Some(
                    crate::musicxml_export::export_musicxml_excerpt(score, &incoming, &outgoing)
                        .map_err(|message| error("pitch_mod_spelling", message))?,
                );
            }
            if !score.keys.is_empty() {
                page.key_origin = "pitch_mod_from_source".into();
            }
        }
        Ok(page)
    }
}

fn project_score(
    score: &mut Score,
    pitches: &[EffectiveSourcePitch],
    semitones: i16,
    interval: &WrittenInterval,
) -> Result<(), PitchProjectionError> {
    let inventory: HashMap<_, _> = pitches
        .iter()
        .map(|pitch| (pitch.source_id.as_str(), pitch))
        .collect();
    for note in score.parts.iter_mut().flat_map(|part| &mut part.notes) {
        let Some(pitch) = &note.pitch else {
            continue;
        };
        let effective = inventory.get(note.id.as_str()).ok_or_else(|| {
            error(
                "pitch_mod_inventory",
                "Written pitch has no complete source identity",
            )
        })?;
        if pitch.midi() != Some(effective.original_midi) {
            return Err(error(
                "pitch_mod_inventory",
                "Written pitch disagrees with its trusted source runtime",
            ));
        }
        if !effective.percussion {
            note.pitch = Some(
                shifted_pitch(pitch, semitones, interval.diatonic_steps).ok_or_else(|| {
                    error(
                        "pitch_mod_spelling",
                        "The selected written interval cannot spell every pitched note",
                    )
                })?,
            );
        }
    }
    for key in &mut score.keys {
        let fifths = i16::from(key.fifths) + i16::from(interval.fifths_delta);
        if !(-7..=7).contains(&fifths) {
            return Err(error(
                "pitch_mod_spelling",
                "The selected written interval would exceed seven key-signature accidentals",
            ));
        }
        key.fifths = fifths as i8;
    }
    Ok(())
}

#[cfg(test)]
#[path = "pitch_projection/tests.rs"]
mod tests;
