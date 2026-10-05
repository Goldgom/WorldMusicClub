//! Versioned audio evidence from the canonical compiler, independent of physical
//! input-target grouping. Opaque source identities never become MIDI coordinates.
use crate::{compile, Score};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;

pub const PROFILE: &str = "wmh-canonical-compiled-audio-v1";
pub const POLICY: &str = "wmh-canonical-sine-ms-v1";
pub const MAX_OCCURRENCES: usize = 100_000;
pub const MAX_REFERENCES: usize = 1_000_000;
pub const MAX_ENCODING_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_PROFILE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Occurrence {
    pub id: String,
    pub part_index: u32,
    pub source_indices: Vec<u32>,
    pub midi: u8,
    pub velocity: u8,
    pub start_ms: f64,
    pub duration_ms: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CanonicalAudioProfile {
    pub profile: String,
    pub policy_id: String,
    pub source_fingerprint: String,
    pub compiled_fingerprint: String,
    pub duration_ms: f64,
    pub part_ids: Vec<String>,
    /// Written source order, including rests. References are indices in this table.
    pub source_note_ids: Vec<String>,
    pub source_references: usize,
    pub occurrences: Vec<Occurrence>,
}

/// A portable SHA-256 encoding, not JSON serialization or delimiter joining.
/// Tags: null=0, false=1, true=2, number=3 (finite IEEE754 binary64 LE, -0 -> 0),
/// string=4 (u32 LE UTF-8 byte length), array=5 (u32 length), object=6 (u32 length,
/// keys sorted by UTF-8 bytes and encoded as strings). Domain is a string prefix.
/// Both the byte limit and recursion limit are checked before hash updates.
pub fn fingerprint(domain: &str, value: &Value) -> Result<String, String> {
    struct Encoder {
        hash: Sha256,
        bytes: usize,
    }
    impl Encoder {
        fn put(&mut self, bytes: &[u8]) -> Result<(), String> {
            self.bytes = self.bytes.saturating_add(bytes.len());
            if self.bytes > MAX_ENCODING_BYTES {
                return Err("canonical_audio_budget: fingerprint exceeds 64 MiB".into());
            }
            self.hash.update(bytes);
            Ok(())
        }
        fn len(&mut self, n: usize) -> Result<(), String> {
            self.put(
                &u32::try_from(n)
                    .map_err(|_| "canonical_audio_budget: length")?
                    .to_le_bytes(),
            )
        }
        fn string(&mut self, text: &str) -> Result<(), String> {
            self.put(&[4])?;
            self.len(text.len())?;
            self.put(text.as_bytes())
        }
        fn value(&mut self, value: &Value, depth: usize) -> Result<(), String> {
            if depth > 64 {
                return Err("canonical_audio_budget: nesting exceeds 64".into());
            }
            match value {
                Value::Null => self.put(&[0]),
                Value::Bool(b) => self.put(&[if *b { 2 } else { 1 }]),
                Value::Number(n) => {
                    let n = n
                        .as_f64()
                        .filter(|n| n.is_finite())
                        .ok_or("canonical_audio_invalid: nonfinite number")?;
                    self.put(&[3])?;
                    self.put(&(if n == 0. { 0.0_f64 } else { n }).to_le_bytes())
                }
                Value::String(s) => self.string(s),
                Value::Array(a) => {
                    self.put(&[5])?;
                    self.len(a.len())?;
                    for v in a {
                        self.value(v, depth + 1)?;
                    }
                    Ok(())
                }
                Value::Object(o) => {
                    self.put(&[6])?;
                    self.len(o.len())?;
                    let mut entries: Vec<_> = o.iter().collect();
                    entries.sort_unstable_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
                    for (k, v) in entries {
                        self.string(k)?;
                        self.value(v, depth + 1)?;
                    }
                    Ok(())
                }
            }
        }
    }
    let mut e = Encoder {
        hash: Sha256::new(),
        bytes: 0,
    };
    e.string(domain)?;
    e.value(value, 0)?;
    Ok(format!("{:x}", e.hash.finalize()))
}

pub fn compile_audio_profile(score: Score) -> Result<CanonicalAudioProfile, String> {
    let compiled = compile(score)?;
    let source_fingerprint = fingerprint(
        "wmh-canonical-score-v1",
        &serde_json::to_value(&compiled.score).map_err(|e| e.to_string())?,
    )?;
    let part_ids: Vec<_> = compiled.score.parts.iter().map(|p| p.id.clone()).collect();
    let source_note_ids: Vec<_> = compiled
        .score
        .parts
        .iter()
        .flat_map(|p| p.notes.iter().map(|n| n.id.clone()))
        .collect();
    let parts: HashMap<_, _> = part_ids
        .iter()
        .enumerate()
        .map(|(i, id)| (id.as_str(), i as u32))
        .collect();
    let sources: HashMap<_, _> = source_note_ids
        .iter()
        .enumerate()
        .map(|(i, id)| (id.as_str(), i as u32))
        .collect();
    if compiled.timeline.notes.len() > MAX_OCCURRENCES {
        return Err("canonical_audio_budget: too many occurrences".into());
    }
    let mut source_references = 0_usize;
    let mut occurrences = Vec::with_capacity(compiled.timeline.notes.len());
    for note in &compiled.timeline.notes {
        source_references = source_references.saturating_add(note.source_note_ids.len());
        if source_references > MAX_REFERENCES {
            return Err("canonical_audio_budget: too many source references".into());
        }
        if !note.start_ms.is_finite()
            || note.start_ms < 0.
            || !note.duration_ms.is_finite()
            || note.duration_ms <= 0.
            || note.start_ms + note.duration_ms <= note.start_ms
        {
            return Err("canonical_audio_timing: compiled milliseconds cannot represent a positive audio gate; original score is unchanged".into());
        }
        occurrences.push(Occurrence {
            id: note.id.clone(),
            part_index: parts[note.part_id.as_str()],
            source_indices: note
                .source_note_ids
                .iter()
                .map(|id| sources[id.as_str()])
                .collect(),
            midi: note.midi,
            velocity: note.velocity,
            start_ms: note.start_ms,
            duration_ms: note.duration_ms,
        });
    }
    let mut profile = CanonicalAudioProfile {
        profile: PROFILE.into(),
        policy_id: POLICY.into(),
        source_fingerprint,
        compiled_fingerprint: String::new(),
        duration_ms: compiled.timeline.duration_ms,
        part_ids,
        source_note_ids,
        source_references,
        occurrences,
    };
    // The fingerprint covers every profile field except itself.
    let mut value = serde_json::to_value(&profile).map_err(|e| e.to_string())?;
    value
        .as_object_mut()
        .expect("profile object")
        .remove("compiled_fingerprint");
    profile.compiled_fingerprint = fingerprint(PROFILE, &value)?;
    if serde_json::to_vec(&profile)
        .map_err(|e| e.to_string())?
        .len()
        > MAX_PROFILE_BYTES
    {
        return Err(
            "canonical_audio_budget: profile exceeds 32 MiB; original score is unchanged".into(),
        );
    }
    Ok(profile)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Beat, Note, Part, Pitch, Repeat};
    fn fixture() -> Score {
        let mut score = crate::catalog().remove(0);
        score.id = "练习 🎵|\0".into();
        score.parts = vec![Part {
            id: "人 手 🎹".into(),
            name: "Original human".into(),
            instrument: "piano".into(),
            notes: vec![
                Note {
                    id: "起|\0".into(),
                    at: Beat::ZERO,
                    duration: Beat::new(1, 1),
                    pitch: Some(Pitch {
                        step: "C".into(),
                        alter: 0,
                        octave: 4,
                    }),
                    voice: "声部".into(),
                    staff: 1,
                    velocity: 90,
                    tie_start: true,
                    tie_stop: false,
                },
                Note {
                    id: "续 🎼".into(),
                    at: Beat::new(1, 1),
                    duration: Beat::new(1, 1),
                    pitch: Some(Pitch {
                        step: "C".into(),
                        alter: 0,
                        octave: 4,
                    }),
                    voice: "声部".into(),
                    staff: 1,
                    velocity: 90,
                    tie_start: false,
                    tie_stop: true,
                },
            ],
        }];
        score.measures.clear();
        score.keys.clear();
        score.meters.clear();
        score.source = None;
        score.repeats = vec![Repeat {
            from: Beat::ZERO,
            to: Beat::new(2, 1),
            times: 2,
        }];
        let mut machine = score.parts[0].clone();
        machine.id = "机 器".into();
        for n in &mut machine.notes {
            n.id = format!("机器:{}", n.id);
        }
        score.parts.push(machine);
        score.parts.push(Part {
            id: "空".into(),
            name: "Empty".into(),
            instrument: "piano".into(),
            notes: vec![],
        });
        score
    }
    #[test]
    fn canonical_audio_preserves_utf8_ties_repeats_and_unisons() {
        let source = fixture();
        let unchanged = serde_json::to_value(&source).unwrap();
        let compiled = compile(source.clone()).unwrap();
        let profile = compile_audio_profile(source.clone()).unwrap();
        assert_eq!(serde_json::to_value(source).unwrap(), unchanged);
        assert_eq!(profile.occurrences.len(), 4);
        assert_eq!(profile.source_references, 8);
        assert_eq!(profile.part_ids[2], "空");
        assert_eq!(profile.source_note_ids[1], "续 🎼");
        for (a, b) in profile.occurrences.iter().zip(&compiled.timeline.notes) {
            assert_eq!(a.id, b.id);
            assert_eq!(a.start_ms, b.start_ms);
            assert_eq!(a.duration_ms, b.duration_ms);
            assert_eq!(
                a.source_indices
                    .iter()
                    .map(|i| &profile.source_note_ids[*i as usize])
                    .collect::<Vec<_>>(),
                b.source_note_ids.iter().collect::<Vec<_>>()
            );
        }
        assert_eq!(profile.duration_ms, compiled.timeline.duration_ms);
        let mut changed = fixture();
        changed.tempo[0].bpm *= 1.1;
        let changed = compile_audio_profile(changed).unwrap();
        assert_ne!(changed.source_fingerprint, profile.source_fingerprint);
        assert_ne!(changed.compiled_fingerprint, profile.compiled_fingerprint);
    }
    #[test]
    fn canonical_audio_fingerprint_has_unambiguous_utf8_and_numeric_encoding() {
        let a = serde_json::json!({"a":["x|y","z",1.25,-0.0],"🎼":"声\u{0}部"});
        assert_eq!(
            fingerprint("test", &a).unwrap(),
            "21449e031a49f3a7acfe1b2bbe1f4833711bd49e7bac3bc59623028c5d06d945"
        );
        assert_ne!(
            fingerprint("test", &serde_json::json!(["a|b", "c"])).unwrap(),
            fingerprint("test", &serde_json::json!(["a", "b|c"])).unwrap()
        );
    }
}
