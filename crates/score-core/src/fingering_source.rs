//! Native fingering input is derived from a validated complete package, never
//! deserialized from a renderer's score, timeline, offsets or cached runtime.
use crate::{clean_song, vsq_clean, Beat, Compilation, Score};

pub struct FingeringSource {
    pub(crate) compilation: Compilation,
    clock: Option<(clean_song::SemanticClock, Beat)>,
}

impl FingeringSource {
    pub(crate) fn canonical(score: Score) -> Result<Self, String> {
        Ok(Self {
            compilation: crate::compile(score)?,
            clock: None,
        })
    }

    pub fn complete_midi(score: &clean_song::CompleteScore) -> Result<Self, String> {
        let runtime = clean_song::compile_complete(score)?;
        Ok(Self {
            compilation: runtime.compilation,
            clock: Some((
                clean_song::SemanticClock::new(&score.performance.events)?,
                Beat::ZERO,
            )),
        })
    }

    pub fn explicit_vsq(
        score: &vsq_clean::VsqCompleteScore,
        choice: vsq_clean::PracticeChoice,
    ) -> Result<Self, String> {
        let (_, compilation) = vsq_clean::compile_practice_with_compilation(score, choice)?;
        let ppq = i64::from(score.authoring.ppq);
        let beat = |tick| {
            i64::try_from(tick)
                .map(|tick| Beat::new(tick, ppq))
                .map_err(|_| "VSQ source tick exceeds the fingering clock bound".to_string())
        };
        let tempos: Vec<_> = score
            .authoring
            .tempo
            .iter()
            .map(|tempo| Ok((beat(tempo.tick)?, tempo.microseconds_per_quarter)))
            .collect::<Result<_, String>>()?;
        Ok(Self {
            compilation,
            clock: Some((
                clean_song::SemanticClock::from_tempos(tempos)?,
                beat(score.authoring.premeasure_ticks)?,
            )),
        })
    }

    pub fn score(&self) -> &Score {
        &self.compilation.score
    }

    pub(crate) fn verify_score(&self, score: &Score) -> Result<(), String> {
        if serde_json::to_value(score).map_err(|e| e.to_string())?
            != serde_json::to_value(self.score()).map_err(|e| e.to_string())?
        {
            return Err("Fingering settings must retain the complete native source score".into());
        }
        Ok(())
    }

    pub(crate) fn at(&self, beat: Beat) -> Result<f64, String> {
        match &self.clock {
            Some((clock, origin)) => clock.relative_milliseconds(beat, *origin),
            None => Ok(crate::TempoIndex::new(&self.compilation.score.tempo).at(beat.value())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instruments::InstrumentProfile;
    use crate::piano_fingering::{plan_piano_fingering_from_source, PianoFingeringRequest};

    #[test]
    fn complete_midi_uses_native_projection_and_exact_phrase_clock() {
        let score = clean_song::decode_json(include_bytes!(
            "../../../tests/fixtures/clean-song-v2/score.json"
        ))
        .unwrap();
        let runtime = clean_song::compile_complete(&score).unwrap();
        let source = FingeringSource::complete_midi(&score).unwrap();
        assert_eq!(
            serde_json::to_value(&source.compilation).unwrap(),
            serde_json::to_value(&runtime.compilation).unwrap()
        );
        for note in &runtime.notes {
            let written = source
                .score()
                .parts
                .iter()
                .flat_map(|p| &p.notes)
                .find(|n| n.id == note.note_id)
                .unwrap();
            assert_eq!(source.at(written.at).unwrap(), note.start_ms);
            assert_eq!(
                source
                    .at(written.at.checked_add(written.duration).unwrap())
                    .unwrap(),
                note.end_ms
            );
        }
        assert!(source.at(Beat::new(-1, 1)).is_err());
    }

    #[test]
    fn explicit_vsq_retains_source_identity_and_rebases_the_native_clock_before_planning() {
        let score = vsq_clean::decode_json(include_bytes!(
            "../../../tests/fixtures/vsq-clean-v1/score.json"
        ))
        .unwrap();
        let before = serde_json::to_value(&score).unwrap();
        let choice = vsq_clean::PracticeChoice::BaseNotesInstrumental;
        let source = FingeringSource::explicit_vsq(&score, choice).unwrap();
        let (runtime, compilation) =
            vsq_clean::compile_practice_with_compilation(&score, choice).unwrap();
        assert_eq!(
            serde_json::to_value(&source.compilation).unwrap(),
            serde_json::to_value(&compilation).unwrap()
        );
        assert_eq!(source.compilation.timeline.notes[0].start_ms, 0.0);
        assert_eq!(
            crate::compile(score.notation.clone())
                .unwrap()
                .timeline
                .notes[0]
                .start_ms,
            2000.0
        );
        for note in &runtime.notes {
            let written = source
                .score()
                .parts
                .iter()
                .flat_map(|p| &p.notes)
                .find(|n| n.id == note.note_id)
                .unwrap();
            assert_eq!(source.at(written.at).unwrap(), note.start_ms);
            assert_eq!(
                source
                    .at(written.at.checked_add(written.duration).unwrap())
                    .unwrap(),
                note.end_ms
            );
        }
        assert!(source
            .at(Beat::ZERO)
            .unwrap_err()
            .contains("practice origin"));
        let mut request = PianoFingeringRequest {
            score: source.score().clone(),
            part_id: None,
            profile: InstrumentProfile::Piano {
                key_count: 88,
                lowest_midi: Some(21),
            },
            left_hand: Default::default(),
            right_hand: Default::default(),
            locks: vec![],
        };
        let plan = plan_piano_fingering_from_source(request.clone(), source).unwrap();
        assert_eq!(plan.status, "ready");
        assert_eq!(plan.targets[0].start_ms, 0.0);
        assert_eq!(
            plan.targets[0].end_ms,
            compilation
                .timeline
                .notes
                .iter()
                .map(|n| n.start_ms + n.duration_ms)
                .fold(0.0, f64::max)
        );
        assert!(plan
            .diagnostics
            .iter()
            .any(|d| d.message.contains("not a global")));
        request.score.id.push_str("-changed");
        assert!(plan_piano_fingering_from_source(
            request,
            FingeringSource::explicit_vsq(&score, choice).unwrap()
        )
        .unwrap_err()
        .contains("native source score"));
        assert_eq!(before, serde_json::to_value(score).unwrap());
    }

    #[test]
    fn constructors_do_not_admit_unvalidated_native_content() {
        let mut score = vsq_clean::decode_json(include_bytes!(
            "../../../tests/fixtures/vsq-clean-v1/score.json"
        ))
        .unwrap();
        score.notation.parts[0].notes[0].id = "fabricated".into();
        assert!(FingeringSource::explicit_vsq(
            &score,
            vsq_clean::PracticeChoice::BaseNotesInstrumental
        )
        .is_err());
        let mut score = clean_song::decode_json(include_bytes!(
            "../../../tests/fixtures/clean-song-v2/score.json"
        ))
        .unwrap();
        score.performance.notes[0].note_id = "fabricated".into();
        assert!(FingeringSource::complete_midi(&score).is_err());
    }
}
