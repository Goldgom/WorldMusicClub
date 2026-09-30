//! Strict, local importer for WorldMusicHub's own numbered-notation text v1.
//! This is not a parser for arbitrary printed Jianpu or other text dialects.

use crate::{
    Beat, Diagnostic, Key, Measure, Meter, Note, Part, Pitch, Provenance, Score, Source, Tempo,
};
use std::cmp::Ordering;

const FORMAT: &str = "worldmusichub-jianpu-text-v1";
const MAX_SOURCE_BYTES: usize = 1024 * 1024;
const MAX_NOTES: usize = 100_000;
const MAX_MEASURES: usize = 100_000;
const STEPS: [&str; 7] = ["C", "D", "E", "F", "G", "A", "B"];
const NATURALS: [i16; 7] = [0, 2, 4, 5, 7, 9, 11];

#[derive(Default)]
struct Headers {
    format: Option<String>,
    title: Option<String>,
    composer: Option<String>,
    tonic: Option<String>,
    mode: Option<String>,
    tempo: Option<String>,
    meter: Option<String>,
}

impl Headers {
    fn read(&mut self, line: &str) -> Result<(), String> {
        let (name, value) = line
            .split_once('=')
            .ok_or("A header requires name=value on its own line")?;
        let (name, value) = (name.trim(), value.trim());
        let target = match name {
            "format" => &mut self.format,
            "title" => &mut self.title,
            "composer" => &mut self.composer,
            "1" => &mut self.tonic,
            "mode" => &mut self.mode,
            "tempo" => &mut self.tempo,
            "meter" => &mut self.meter,
            "pickup" => {
                return Err("Pickup measures are unsupported in text v1; use MusicXML for an anacrusis, or explicitly write the preceding rests when appropriate".into())
            }
            _ => {
                return Err(format!(
                    "Unsupported header '{}'; supported headers are format, title, composer, 1, mode, tempo and meter",
                    excerpt(name)
                ))
            }
        };
        if target.is_some() {
            return Err(format!("Duplicate {name}= header"));
        }
        if value.is_empty() {
            return Err(format!("The {name}= header cannot be empty"));
        }
        let limit = match name {
            "title" => 1000,
            "composer" => 1024,
            _ => 64,
        };
        if value.len() > limit {
            return Err(format!("The {name}= header exceeds its {limit}-byte limit"));
        }
        *target = Some(value.into());
        Ok(())
    }
}

struct Tonality {
    step: usize,
    octave: i16,
    midi: i16,
    fifths: i8,
    minor: bool,
}

fn excerpt(value: &str) -> String {
    let mut short: String = value.chars().take(64).collect();
    if value.chars().count() > 64 {
        short.push('…');
    }
    short
}

fn rational(numerator: i128, denominator: i128) -> Result<Beat, String> {
    if denominator <= 0 {
        return Err("A duration requires a positive denominator".into());
    }
    let divisor = crate::gcd(numerator.unsigned_abs(), denominator as u128) as i128;
    let beat = Beat::new(
        i64::try_from(numerator / divisor).map_err(|_| "Musical time is too large")?,
        i64::try_from(denominator / divisor).map_err(|_| "Musical time is too precise")?,
    );
    if !beat.valid() {
        return Err("Musical time exceeds exact rational limits: reduced numerator 1,000,000,000 or denominator 1,000,000".into());
    }
    Ok(beat)
}

fn add(left: Beat, right: Beat) -> Result<Beat, String> {
    left.checked_add(right).ok_or_else(|| {
        "Accumulated musical time exceeds the supported exact rational limits".into()
    })
}

fn positive_integer(value: &str, maximum: i64, label: &str) -> Result<i64, String> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(format!("Invalid {label}: expected a positive whole number"));
    }
    value
        .parse::<i64>()
        .ok()
        .filter(|number| (1..=maximum).contains(number))
        .ok_or_else(|| format!("Invalid {label}: expected 1–{maximum}"))
}

fn parse_duration(value: &str) -> Result<Beat, String> {
    let (numerator, denominator) = value
        .split_once('/')
        .ok_or("A duration must be :n/d in quarter-note beats, for example :1/2 or :1/3")?;
    rational(
        positive_integer(numerator, 1_000_000_000, "duration numerator")? as i128,
        positive_integer(denominator, 1_000_000, "duration denominator")? as i128,
    )
}

fn parse_tempo(value: &str) -> Result<f64, String> {
    let mut pieces = value.split('.');
    let whole = pieces.next().unwrap_or("");
    let fraction = pieces.next();
    if whole.is_empty()
        || !whole.bytes().all(|byte| byte.is_ascii_digit())
        || fraction.is_some_and(|part| {
            part.is_empty() || part.len() > 3 || !part.bytes().all(|byte| byte.is_ascii_digit())
        })
        || pieces.next().is_some()
    {
        return Err("tempo= requires 10–600 quarter-note BPM, with at most three decimal places; exponent notation is unsupported".into());
    }
    value
        .parse::<f64>()
        .ok()
        .filter(|bpm| bpm.is_finite() && (10.0..=600.0).contains(bpm))
        .ok_or_else(|| "tempo= must be 10–600 quarter-note BPM".into())
}

fn parse_meter(value: &str) -> Result<(u16, u16, Beat), String> {
    let (numerator, denominator) = value
        .split_once('/')
        .ok_or("meter= requires a time signature such as 4/4 or 6/8")?;
    let numerator = positive_integer(numerator, 64, "meter numerator")? as u16;
    let denominator = positive_integer(denominator, 64, "meter denominator")? as u16;
    if !denominator.is_power_of_two() {
        return Err("The meter denominator must be 1, 2, 4, 8, 16, 32 or 64".into());
    }
    Ok((
        numerator,
        denominator,
        rational(numerator as i128 * 4, denominator as i128)?,
    ))
}

fn parse_tonality(tonic: &str, mode: &str) -> Result<Tonality, String> {
    let minor = match mode {
        "major" => false,
        "minor" => true,
        _ => return Err("mode= supports only major or natural minor (write mode=minor); degree 1 is the tonic in both modes".into()),
    };
    if !tonic.is_ascii() || tonic.len() < 2 {
        return Err(
            "1= requires an uppercase tonic and scientific octave, such as C4, F#4 or Bb3".into(),
        );
    }
    let bytes = tonic.as_bytes();
    let step = STEPS
        .iter()
        .position(|name| name.as_bytes()[0] == bytes[0])
        .ok_or("1= requires a tonic letter A–G, optional # or b, and octave −1 through 9")?;
    let (alter, split) = match bytes.get(1) {
        Some(b'#') => (1, 2),
        Some(b'b') => (-1, 2),
        _ => (0, 1),
    };
    let octave_text = &tonic[split..];
    if octave_text != "-1"
        && !(octave_text.len() == 1 && octave_text.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err("The tonic octave must be −1 through 9, for example 1=C4".into());
    }
    let octave: i16 = octave_text.parse().map_err(|_| "Invalid tonic octave")?;
    let spelling = &tonic[..split];
    let circle = if minor {
        [
            "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "D#", "A#",
        ]
    } else {
        [
            "Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#",
        ]
    };
    let fifths = circle
        .iter()
        .position(|candidate| *candidate == spelling)
        .map(|index| index as i8 - 7)
        .ok_or("This tonic/mode needs more than seven key-signature accidentals; use an enharmonic tonic or MusicXML")?;
    let midi = (octave + 1) * 12 + NATURALS[step] + alter;
    if !(0..=127).contains(&midi) {
        return Err("The tonic is outside the supported MIDI pitch range 0–127".into());
    }
    Ok(Tonality {
        step,
        octave,
        midi,
        fifths,
        minor,
    })
}

fn parse_note(token: &str, tonality: &Tonality) -> Result<(Option<Pitch>, Beat), String> {
    if !token.is_ascii() || token.len() > 128 {
        return Err("Note tokens must use the documented ASCII syntax and be at most 128 bytes; convert printed dots/underlines, lyrics or other dialects explicitly".into());
    }
    let (token, dotted) = token
        .strip_suffix('.')
        .map_or((token, false), |undotted| (undotted, true));
    let (written_pitch, duration) = match token.split_once(':') {
        Some((pitch, duration)) => (pitch, parse_duration(duration)?),
        None => (token, Beat::new(1, 1)),
    };
    let duration = if dotted {
        rational(
            duration.numerator as i128 * 3,
            duration.denominator as i128 * 2,
        )?
    } else {
        duration
    };
    let bytes = written_pitch.as_bytes();
    let (accidental, start) = match bytes.first() {
        Some(b'#') => (1, 1),
        Some(b'b') => (-1, 1),
        _ => (0, 0),
    };
    let degree = bytes
        .get(start)
        .copied()
        .filter(|byte| (b'0'..=b'7').contains(byte))
        .ok_or("Expected a single degree 1–7 or rest 0; lyrics, chords, repeats, polyphony and other notation are unsupported (use MusicXML)")?
        - b'0';
    let suffix = &bytes[start + 1..];
    if suffix.len() > 10
        || !(suffix.iter().all(|byte| *byte == b'\'') || suffix.iter().all(|byte| *byte == b','))
    {
        return Err("After one degree, use only apostrophes for upper octaves OR commas for lower octaves, then an optional :n/d and one final duration dot; separate notes and | with whitespace".into());
    }
    if degree == 0 {
        if accidental != 0 || !suffix.is_empty() {
            return Err("Rest 0 cannot have an accidental or octave marks".into());
        }
        return Ok((None, duration));
    }
    let shift = if suffix.first() == Some(&b',') {
        -(suffix.len() as i16)
    } else {
        suffix.len() as i16
    };
    let scale = if tonality.minor {
        [0, 2, 3, 5, 7, 8, 10]
    } else {
        [0, 2, 4, 5, 7, 9, 11]
    };
    let degree = degree as usize - 1;
    let letter_index = tonality.step + degree;
    let step = letter_index % 7;
    let octave = tonality.octave + (letter_index / 7) as i16 + shift;
    let midi = tonality.midi + scale[degree] + shift * 12 + accidental;
    let alter = midi - ((octave + 1) * 12 + NATURALS[step]);
    if !(0..=127).contains(&midi) || !(-2..=2).contains(&alter) {
        return Err("This note is outside MIDI pitches 0–127 or requires an unsupported triple accidental; change the octave/key or use MusicXML".into());
    }
    Ok((
        Some(Pitch {
            step: STEPS[step].into(),
            alter: alter as i8,
            octave: i8::try_from(octave).map_err(|_| "Note octave is out of range")?,
        }),
        duration,
    ))
}

fn measures(total: Beat, measure_length: Beat) -> Result<Vec<Measure>, String> {
    let numerator = total.numerator as i128 * measure_length.denominator as i128;
    let denominator = total.denominator as i128 * measure_length.numerator as i128;
    let count = numerator / denominator + i128::from(numerator % denominator != 0);
    if count > MAX_MEASURES as i128 {
        return Err(
            "Score exceeds the 100,000-measure limit; shorten the score or its durations".into(),
        );
    }
    let mut output = Vec::with_capacity(count as usize);
    let mut at = Beat::ZERO;
    while at.compare(total) == Ordering::Less {
        let remaining = rational(
            total.numerator as i128 * at.denominator as i128
                - at.numerator as i128 * total.denominator as i128,
            total.denominator as i128 * at.denominator as i128,
        )?;
        let length = if remaining.compare(measure_length) == Ordering::Less {
            remaining
        } else {
            measure_length
        };
        output.push(Measure {
            number: output.len() as u32 + 1,
            at,
            length,
        });
        at = add(at, length)?;
    }
    Ok(output)
}

/// Import the documented, monophonic `worldmusichub-jianpu-text-v1` dialect.
/// Original UTF-8 source is retained exactly. Unsupported notation is an error.
pub fn import_jianpu(text: &str) -> Result<(Score, Vec<Diagnostic>), String> {
    if text.len() > MAX_SOURCE_BYTES {
        return Err("Numbered-notation text exceeds the 1 MiB import limit".into());
    }
    if text
        .chars()
        .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err("Numbered-notation text contains unsupported control characters".into());
    }
    let mut headers = Headers::default();
    let mut body = Vec::new();
    for (index, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with(';') {
            continue;
        }
        let line_number = index + 1;
        if line.contains('=') {
            if !body.is_empty() {
                return Err(format!("Line {line_number}: headers must precede all notes; mid-score key, mode, tempo and meter changes are unsupported in text v1"));
            }
            headers
                .read(line)
                .map_err(|error| format!("Line {line_number}: {error}"))?;
        } else {
            body.push((line_number, line));
        }
    }
    if let Some(format) = &headers.format {
        if format != FORMAT {
            return Err(format!(
                "Unsupported numbered-notation format; use format={FORMAT}"
            ));
        }
    }
    let tonality = parse_tonality(
        headers.tonic.as_deref().unwrap_or("C4"),
        headers.mode.as_deref().unwrap_or("major"),
    )?;
    let bpm = parse_tempo(headers.tempo.as_deref().unwrap_or("90"))?;
    let (numerator, denominator, measure_length) =
        parse_meter(headers.meter.as_deref().unwrap_or("4/4"))?;
    let mut defaults = Vec::new();
    if headers.tonic.is_none() {
        defaults.push("1=C4 (middle-C tonic)");
    }
    if headers.mode.is_none() {
        defaults.push("mode=major");
    }
    if headers.tempo.is_none() {
        defaults.push("tempo=90 quarter-note BPM");
    }
    if headers.meter.is_none() {
        defaults.push("meter=4/4");
    }
    let mut diagnostics = Vec::new();
    if !defaults.is_empty() {
        diagnostics.push(Diagnostic::warning(
            "jianpu_defaults",
            format!(
                "Omitted headers use these defaults: {}",
                defaults.join("; ")
            ),
            None,
        ));
    }
    let mut notes: Vec<Note> = Vec::new();
    let mut cursor = Beat::ZERO;
    let mut last_bar = None;
    for (line_number, line) in body {
        for (index, token) in line.split_whitespace().enumerate() {
            let context = |error: String| {
                format!(
                    "Line {line_number}, token {} ('{}'): {error}",
                    index + 1,
                    excerpt(token)
                )
            };
            if token == "|" {
                if cursor.equivalent(Beat::ZERO)
                    || last_bar.is_some_and(|at: Beat| at.equivalent(cursor))
                {
                    return Err(context("Leading and duplicate barlines are unsupported; put | only after a completed measure".into()));
                }
                let multiple = cursor.numerator as i128 * measure_length.denominator as i128;
                let unit = cursor.denominator as i128 * measure_length.numerator as i128;
                if multiple % unit != 0 {
                    return Err(context(format!("Barline is at beat {}/{}, not a {numerator}/{denominator} measure boundary; correct durations or remove a final incomplete barline. Pickup measures are unsupported", cursor.numerator, cursor.denominator)));
                }
                last_bar = Some(cursor);
            } else if token == "-" {
                let previous = notes.last_mut().ok_or_else(|| {
                    context("A standalone - must follow a note or rest to extend it by one quarter-note beat".into())
                })?;
                previous.duration = add(previous.duration, Beat::new(1, 1)).map_err(&context)?;
                cursor = add(cursor, Beat::new(1, 1)).map_err(context)?;
            } else {
                if notes.len() >= MAX_NOTES {
                    return Err(context(
                        "Score exceeds the 100,000-note/rest import limit".into(),
                    ));
                }
                let (pitch, duration) = parse_note(token, &tonality).map_err(&context)?;
                notes.push(Note {
                    id: format!("jianpu-note-{}", notes.len() + 1),
                    at: cursor,
                    duration,
                    velocity: if pitch.is_some() { 90 } else { 0 },
                    pitch,
                    voice: "1".into(),
                    staff: 1,
                    tie_start: false,
                    tie_stop: false,
                });
                cursor = add(cursor, duration).map_err(context)?;
            }
        }
    }
    if notes.is_empty() {
        return Err(
            "No notes or rests found; add whitespace-separated degrees 1–7 or rest 0".into(),
        );
    }
    let measures = measures(cursor, measure_length)?;
    if measures
        .last()
        .is_some_and(|measure| !measure.length.equivalent(measure_length))
    {
        diagnostics.push(Diagnostic::warning(
            "jianpu_partial_final_measure",
            "The final measure is incomplete and retained at its exact length; no padding rests or pickup interpretation were added",
            None,
        ));
    }
    let score = Score {
        version: 1,
        id: "jianpu-import".into(),
        title: headers
            .title
            .unwrap_or_else(|| "Imported numbered notation".into()),
        composer: headers.composer.unwrap_or_else(|| "Unknown".into()),
        provenance: Provenance {
            kind: "user_import".into(),
            attribution: "User-supplied WorldMusicHub numbered-notation text; ownership and usage rights are not verified".into(),
            source_url: None,
            license: None,
        },
        parts: vec![Part {
            id: "jianpu-part-1".into(),
            name: "Melody".into(),
            instrument: "piano".into(),
            notes,
        }],
        tempo: vec![Tempo { at: Beat::ZERO, bpm }],
        meters: vec![Meter {
            at: Beat::ZERO,
            numerator,
            denominator,
        }],
        keys: vec![Key {
            at: Beat::ZERO,
            fifths: tonality.fifths,
            mode: if tonality.minor { "minor" } else { "major" }.into(),
        }],
        measures,
        repeats: Vec::new(),
        source: Some(Source {
            format: FORMAT.into(),
            filename: None,
            content: text.into(),
        }),
    };
    crate::validate(&score)?;
    Ok((score, diagnostics))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pitches(score: &Score) -> Vec<Option<u8>> {
        score.parts[0]
            .notes
            .iter()
            .map(|note| note.pitch.as_ref().and_then(Pitch::midi))
            .collect()
    }

    #[test]
    fn original_fixture_compiles_with_exact_bars_and_retained_source() {
        let source = include_str!("../../../tests/fixtures/jianpu-original-steps.jianpu");
        let (score, diagnostics) = import_jianpu(source).unwrap();
        assert!(diagnostics.is_empty());
        assert_eq!(score.parts[0].notes.len(), 13);
        assert_eq!(score.measures.len(), 4);
        assert!(score
            .measures
            .iter()
            .all(|measure| measure.length.equivalent(Beat::new(3, 1))));
        assert_eq!(score.source.as_ref().unwrap().content, source);
        let compiled = crate::compile(score).unwrap();
        assert_eq!(compiled.timeline.notes.len(), 11);
        assert_eq!(compiled.timeline.duration_ms, 7500.0);
    }

    #[test]
    fn original_exercise_preserves_headers_source_and_rights() {
        let source = "format=worldmusichub-jianpu-text-v1\r\ntitle=小步 · Original steps\r\ncomposer=Test author\r\n1=D4\r\nmode=major\r\ntempo=120.5\r\nmeter=4/4\r\n1 2 3 0 |\r\n";
        let (score, diagnostics) = import_jianpu(source).unwrap();
        assert!(diagnostics.is_empty());
        assert_eq!(score.title, "小步 · Original steps");
        assert_eq!(score.composer, "Test author");
        assert_eq!(pitches(&score), vec![Some(62), Some(64), Some(66), None]);
        assert_eq!(score.tempo[0].bpm, 120.5);
        assert_eq!(score.keys[0].fifths, 2);
        assert_eq!(score.parts[0].notes[2].pitch.as_ref().unwrap().step, "F");
        assert_eq!(score.parts[0].notes[2].pitch.as_ref().unwrap().alter, 1);
        assert_eq!(score.provenance.kind, "user_import");
        assert!(score.provenance.license.is_none());
        assert_eq!(score.source.as_ref().unwrap().format, FORMAT);
        assert_eq!(score.source.as_ref().unwrap().content, source);
        let json = serde_json::to_string(&score).unwrap();
        let restored: Score = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.source.unwrap().content, source);
        assert_eq!(crate::compile(score).unwrap().timeline.notes.len(), 3);
    }

    #[test]
    fn defaults_are_disclosed_and_note_ids_are_bounded() {
        let (score, diagnostics) = import_jianpu("1 2 3 4 |").unwrap();
        let warning = diagnostics
            .iter()
            .find(|item| item.code == "jianpu_defaults")
            .unwrap();
        for default in ["1=C4", "mode=major", "tempo=90", "meter=4/4"] {
            assert!(warning.message.contains(default));
        }
        assert_eq!(score.keys[0].fifths, 0);
        assert!(score.parts[0].notes.iter().all(|note| note.id.len() <= 128));
    }

    #[test]
    fn octaves_accidentals_rests_and_single_dots_have_exact_meaning() {
        let (score, _) = import_jianpu("1, #1 b2 1' 0:1/2. 3.").unwrap();
        assert_eq!(
            pitches(&score),
            vec![Some(48), Some(61), Some(61), Some(72), None, Some(64)]
        );
        assert!(score.parts[0].notes[4].duration.equivalent(Beat::new(3, 4)));
        assert!(score.parts[0].notes[5].duration.equivalent(Beat::new(3, 2)));
        assert_eq!(score.parts[0].notes[4].velocity, 0);
    }

    #[test]
    fn triplet_fractions_and_extensions_do_not_round_or_retrigger() {
        let (score, _) = import_jianpu("1:1/3 2:1/3 3:1/3 - 0 - |").unwrap();
        let notes = &score.parts[0].notes;
        assert_eq!(notes.len(), 4);
        assert!(notes[2].at.equivalent(Beat::new(2, 3)));
        assert!(notes[2].duration.equivalent(Beat::new(4, 3)));
        assert!(notes[3].at.equivalent(Beat::new(2, 1)));
        assert!(notes[3].duration.equivalent(Beat::new(2, 1)));
        let compiled = crate::compile(score).unwrap();
        assert_eq!(compiled.timeline.notes.len(), 3);
        assert!((compiled.timeline.duration_ms - 8000.0 / 3.0).abs() < 0.000001);
    }

    #[test]
    fn sustain_can_cross_a_checked_bar_without_losing_original_tokens() {
        let text = "1 - - - | - - - - |";
        let (score, _) = import_jianpu(text).unwrap();
        assert_eq!(score.parts[0].notes.len(), 1);
        assert!(score.parts[0].notes[0].duration.equivalent(Beat::new(8, 1)));
        assert_eq!(score.measures.len(), 2);
        assert_eq!(score.source.unwrap().content, text);
    }

    #[test]
    fn flat_tonic_and_letter_octave_wrap_keep_correct_spelling() {
        let (score, _) = import_jianpu("1=Bb3\n1 2 3 4 5 6 7 1'").unwrap();
        assert_eq!(
            pitches(&score),
            vec![
                Some(58),
                Some(60),
                Some(62),
                Some(63),
                Some(65),
                Some(67),
                Some(69),
                Some(70)
            ]
        );
        let notes = &score.parts[0].notes;
        assert_eq!(notes[0].pitch.as_ref().unwrap().step, "B");
        assert_eq!(notes[0].pitch.as_ref().unwrap().alter, -1);
        assert_eq!(notes[0].pitch.as_ref().unwrap().octave, 3);
        assert_eq!(notes[1].pitch.as_ref().unwrap().step, "C");
        assert_eq!(notes[1].pitch.as_ref().unwrap().octave, 4);
        assert_eq!(notes[3].pitch.as_ref().unwrap().step, "E");
        assert_eq!(notes[3].pitch.as_ref().unwrap().alter, -1);
        assert_eq!(score.keys[0].fifths, -2);
    }

    #[test]
    fn natural_minor_uses_tonic_one_and_correct_key_signature() {
        let (score, _) = import_jianpu("mode=minor\n1=F#3\n1 2 3 4 5 6 #7 1'").unwrap();
        assert_eq!(
            pitches(&score),
            vec![
                Some(54),
                Some(56),
                Some(57),
                Some(59),
                Some(61),
                Some(62),
                Some(65),
                Some(66)
            ]
        );
        assert_eq!(score.keys[0].mode, "minor");
        assert_eq!(score.keys[0].fifths, 3);
        let raised_seventh = score.parts[0].notes[6].pitch.as_ref().unwrap();
        assert_eq!(raised_seventh.step, "E");
        assert_eq!(raised_seventh.alter, 1);
        let (minor, _) = import_jianpu("mode=minor\n1").unwrap();
        assert_eq!(minor.keys[0].fifths, -3);
    }

    #[test]
    fn extreme_key_spellings_and_relative_accidentals_are_exact() {
        let (score, _) = import_jianpu("1=C#4\n1 #3 7 b4").unwrap();
        assert_eq!(score.keys[0].fifths, 7);
        assert_eq!(
            pitches(&score),
            vec![Some(61), Some(66), Some(72), Some(65)]
        );
        let second = score.parts[0].notes[1].pitch.as_ref().unwrap();
        assert_eq!(second.step, "E");
        assert_eq!(second.alter, 2);
        assert_eq!(score.parts[0].notes[2].pitch.as_ref().unwrap().step, "B");
        let (flat, _) = import_jianpu("1=Cb4\n1 b4").unwrap();
        assert_eq!(flat.keys[0].fifths, -7);
        assert_eq!(pitches(&flat), vec![Some(59), Some(63)]);
        assert_eq!(flat.parts[0].notes[1].pitch.as_ref().unwrap().alter, -2);
    }

    #[test]
    fn bars_are_optional_checks_and_final_fragment_is_not_padded() {
        let (score, diagnostics) = import_jianpu("meter=6/8\n1 2 3 | 4:1/2").unwrap();
        assert_eq!(score.measures.len(), 2);
        assert!(score.measures[0].length.equivalent(Beat::new(3, 1)));
        assert!(score.measures[1].length.equivalent(Beat::new(1, 2)));
        assert!(diagnostics
            .iter()
            .any(|item| item.code == "jianpu_partial_final_measure"));
        assert_eq!(
            import_jianpu("1 2 3 4 5 6 7 1' |")
                .unwrap()
                .0
                .measures
                .len(),
            2
        );
        assert!(import_jianpu("1 2 3 |")
            .unwrap_err()
            .contains("measure boundary"));
        assert!(import_jianpu("| 1 2 3 4 |")
            .unwrap_err()
            .contains("Leading"));
        assert!(import_jianpu("1:4/1 | |")
            .unwrap_err()
            .contains("duplicate"));
        assert!(import_jianpu("pickup=1/1\n1 |")
            .unwrap_err()
            .contains("Pickup"));
    }

    #[test]
    fn unsupported_notation_is_rejected_instead_of_silently_dropped() {
        for token in [
            "lyrics", "[135]", "(123)", "1_", "1~", "1|2", "1,\"", "1',", "1..", "1:1/2..", "8",
            "♯1", "1̇", "0'", "#0", "||", ":|", "1-", "-:1/2", "#", "", "\n",
        ] {
            assert!(
                import_jianpu(token).is_err(),
                "accepted unsupported {token:?}"
            );
        }
        let error = import_jianpu("title=Original\n1 2 la").unwrap_err();
        assert!(error.contains("Line 2, token 3"));
        assert!(error.contains("lyrics"));
        assert!(import_jianpu("1 2\nlyrics=words").is_err());
    }

    #[test]
    fn malformed_duplicate_and_midscore_headers_are_rejected() {
        for text in [
            "format=jianpu\n1",
            "tempo=90\ntempo=100\n1",
            "title=\n1",
            "1=C\n1",
            "1=c4\n1",
            "1=C+4\n1",
            "1=C10\n1",
            "1=C♯4\n1",
            "1=D#4\n1",
            "mode=dorian\n1",
            "meter=3/3\n1",
            "meter=0/4\n1",
            "meter=4/128\n1",
            "tempo=NaN\n1",
            "tempo=1e2\n1",
            "tempo=90.1234\n1",
            "tempo=90.\n1",
            "tempo=9\n1",
            "tempo=601\n1",
            "1\ntempo=90",
            "voice=2\n1",
            "title=Just a header",
        ] {
            assert!(import_jianpu(text).is_err(), "accepted malformed {text:?}");
        }
    }

    #[test]
    fn rational_limits_invalid_fractions_and_pitch_bounds_are_enforced() {
        for text in [
            "1:0/1",
            "1:1/0",
            "1:-1/2",
            "1:1",
            "1:1/2/3",
            "1:1/1000001",
            "1:1000000001/1",
            "1:1/999998.",
            "1:1/999983 2:1/999979",
            "1=C-1\n1,",
            "1=G9\n2",
            "1=Cb-1\n1",
            "1'''''''''''",
            "-",
        ] {
            assert!(
                import_jianpu(text).is_err(),
                "accepted out-of-range {text:?}"
            );
        }
        assert_eq!(
            pitches(&import_jianpu("1=C-1\n1").unwrap().0),
            vec![Some(0)]
        );
        assert_eq!(
            pitches(&import_jianpu("1=G9\n1").unwrap().0),
            vec![Some(127)]
        );
    }

    #[test]
    fn bounded_inputs_and_corruption_fail_without_panics() {
        assert!(import_jianpu(&"1 ".repeat(MAX_SOURCE_BYTES / 2 + 1))
            .unwrap_err()
            .contains("1 MiB"));
        assert!(import_jianpu(&"1 ".repeat(MAX_NOTES + 1))
            .unwrap_err()
            .contains("100,000-note"));
        assert!(import_jianpu("1:1000000000/1")
            .unwrap_err()
            .contains("100,000-measure"));
        assert!(import_jianpu(&format!("title={}\n1", "x".repeat(1001)))
            .unwrap_err()
            .contains("1000-byte"));
        for text in [
            "\0",
            "1\u{0008}",
            "\u{feff}1",
            "你好",
            "🎵",
            "1:🦀/2",
            "1=🎵\n1",
            "1=\n1",
        ] {
            assert!(std::panic::catch_unwind(|| import_jianpu(text))
                .unwrap()
                .is_err());
        }
    }

    #[test]
    fn all_supported_keys_preserve_their_diatonic_scale_and_roundtrip() {
        for (mode, tonics) in [
            (
                "major",
                [
                    "Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#",
                    "C#",
                ],
            ),
            (
                "minor",
                [
                    "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "D#",
                    "A#",
                ],
            ),
        ] {
            for (index, tonic) in tonics.iter().enumerate() {
                let text = format!("1={tonic}4\nmode={mode}\n1 2 3 4 5 6 7 1'");
                let (score, _) = import_jianpu(&text).unwrap();
                assert_eq!(score.keys[0].fifths, index as i8 - 7);
                let values = pitches(&score);
                let root = values[0].unwrap();
                let offsets = if mode == "major" {
                    [0, 2, 4, 5, 7, 9, 11, 12]
                } else {
                    [0, 2, 3, 5, 7, 8, 10, 12]
                };
                assert_eq!(
                    values,
                    offsets
                        .iter()
                        .map(|offset| Some(root + offset))
                        .collect::<Vec<_>>()
                );
                let restored: Score =
                    serde_json::from_str(&serde_json::to_string(&score).unwrap()).unwrap();
                assert_eq!(restored.source.as_ref().unwrap().content, text);
                let reparsed = import_jianpu(&restored.source.unwrap().content).unwrap().0;
                assert_eq!(
                    serde_json::to_value(reparsed).unwrap(),
                    serde_json::to_value(score).unwrap()
                );
            }
        }
    }
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ExportedJianpu {
    pub text: String,
    pub diagnostics: Vec<Diagnostic>,
    /// One entry per exported token. None identifies an explicit rest filling a written gap.
    pub note_map: Vec<Option<String>>,
}
/// Export the bounded text dialect only when it can represent every note in order.
pub fn export_jianpu(score: &Score) -> Result<ExportedJianpu, String> {
    crate::validate(score)?;
    if score.parts.len() != 1
        || score.tempo.len() != 1
        || score.keys.len() != 1
        || score.meters.len() != 1
        || !score.repeats.is_empty()
    {
        return Err("Numbered-text export requires one part and constant tempo/key/meter without repeats; use JSON or MusicXML for the complete score".into());
    }
    let part = &score.parts[0];
    if part.notes.is_empty() {
        return Err("There are no notes or rests to export".into());
    }
    let lane = (&part.notes[0].voice, part.notes[0].staff);
    if part
        .notes
        .iter()
        .any(|n| (&n.voice, n.staff) != lane || n.tie_start || n.tie_stop)
    {
        return Err("Numbered-text v1 cannot preserve multiple voices/staves or written ties; use MusicXML or JSON".into());
    }
    let key = &score.keys[0];
    let meter = &score.meters[0];
    if !key.at.equivalent(Beat::ZERO) || !meter.at.equivalent(Beat::ZERO) {
        return Err("Key and meter must begin at beat zero for numbered-text export".into());
    }
    let circle = match key.mode.as_str() {
        "major" => [
            "Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#",
        ],
        "minor" => [
            "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "D#", "A#",
        ],
        _ => return Err("Numbered-text export supports major and natural-minor keys only".into()),
    };
    let tonic = format!("{}4", circle[(key.fifths + 7) as usize]);
    let tonality = parse_tonality(&tonic, &key.mode)?;
    let tempo = format!("{:.3}", score.tempo[0].bpm);
    if parse_tempo(&tempo)? != score.tempo[0].bpm {
        return Err(
            "Tempo needs more than three decimal places; use MusicXML to avoid rounding it".into(),
        );
    }
    let (_, _, measure_length) =
        parse_meter(&format!("{}/{}", meter.numerator, meter.denominator))?;
    let mut notes: Vec<_> = part.notes.iter().collect();
    notes.sort_by(|a, b| a.at.compare(b.at).then(a.id.cmp(&b.id)));
    let mut total = notes
        .iter()
        .map(|n| n.at.checked_add(n.duration).expect("validated"))
        .max_by(|a, b| a.compare(*b))
        .unwrap();
    for measure in &score.measures {
        let end = measure.at.checked_add(measure.length).expect("validated");
        if end.compare(total).is_gt() {
            total = end;
        }
    }
    let inferred = measures(total, measure_length)?;
    if !score.measures.is_empty()
        && (inferred.len() != score.measures.len()
            || inferred
                .iter()
                .zip(&score.measures)
                .any(|(a, b)| !a.at.equivalent(b.at) || !a.length.equivalent(b.length)))
    {
        return Err("Pickup, irregular or nonsequential measures cannot be represented in numbered-text v1; use MusicXML".into());
    }
    let mut diagnostics=vec![Diagnostic::warning("jianpu_export_scope","Numbered text preserves this melody's spelled pitches and exact note/rest durations. It does not preserve canonical IDs, instrument setup, original source bytes, expressive velocities or engraving; keep JSON/MusicXML as the full score archive. Rights are retained as comments, not independently verified.",None)];
    let title = score.title.split_whitespace().collect::<Vec<_>>().join(" ");
    let composer = score
        .composer
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let title = if title.is_empty() {
        "Untitled".into()
    } else {
        title
    };
    let composer = if composer.is_empty() {
        "Unknown".into()
    } else {
        composer
    };
    if title != score.title || composer != score.composer {
        diagnostics.push(Diagnostic::warning("jianpu_export_labels","Multiline/empty title or composer labels were normalized for single-line headers; original labels remain in JSON.",None));
    }
    let mut text=format!("format={FORMAT}\ntitle={title}\ncomposer={composer}\n1={tonic}\nmode={}\ntempo={tempo}\nmeter={}/{}\n",key.mode,meter.numerator,meter.denominator);
    for (label, value) in [
        ("Attribution", Some(score.provenance.attribution.as_str())),
        ("License", score.provenance.license.as_deref()),
        ("Source URL", score.provenance.source_url.as_deref()),
    ] {
        if let Some(value) = value {
            for line in value.lines() {
                text.push_str(&format!("; {label}: {line}\n"));
            }
        }
    }
    let mut tokens = vec![];
    let mut mapping = vec![];
    let mut cursor = Beat::ZERO;
    let mut gaps = 0;
    let difference = |end: Beat, start: Beat| {
        rational(
            end.numerator as i128 * start.denominator as i128
                - start.numerator as i128 * end.denominator as i128,
            end.denominator as i128 * start.denominator as i128,
        )
    };
    for note in notes {
        if note.at.compare(cursor).is_lt() {
            return Err("Overlapping notes/chords cannot be flattened into monophonic numbered text; use MusicXML".into());
        }
        if note.at.compare(cursor).is_gt() {
            let gap = difference(note.at, cursor)?;
            tokens.push(format!("0:{}/{}", gap.numerator, gap.denominator));
            mapping.push(None);
            gaps += 1;
        }
        let token = if let Some(pitch) = &note.pitch {
            let step = STEPS
                .iter()
                .position(|s| *s == pitch.step)
                .expect("validated");
            let degree = (step + 7 - tonality.step) % 7;
            let base_octave = tonality.octave + ((tonality.step + degree) / 7) as i16;
            let shift = i16::from(pitch.octave) - base_octave;
            let suffix = if shift < 0 {
                ",".repeat((-shift) as usize)
            } else {
                "'".repeat(shift as usize)
            };
            let natural = format!("{}{suffix}", degree + 1);
            let scale = if tonality.minor {
                [0, 2, 3, 5, 7, 8, 10]
            } else {
                [0, 2, 4, 5, 7, 9, 11]
            };
            let base_midi = tonality.midi + scale[degree] + shift * 12;
            let delta = i16::from(pitch.midi().expect("validated")) - base_midi;
            let accidental=match delta{-1=>"b",0=>"",1=>"#",_=>return Err(format!("Note {} requires an unsupported multi-semitone degree accidental in text v1; use MusicXML",note.id))};
            format!("{accidental}{natural}")
        } else {
            "0".into()
        };
        tokens.push(format!(
            "{token}:{}/{}",
            note.duration.numerator, note.duration.denominator
        ));
        mapping.push(Some(note.id.clone()));
        cursor = note.at.checked_add(note.duration).expect("validated");
    }
    if total.compare(cursor).is_gt() {
        let gap = difference(total, cursor)?;
        tokens.push(format!("0:{}/{}", gap.numerator, gap.denominator));
        mapping.push(None);
        gaps += 1;
    }
    if mapping.len() > MAX_NOTES {
        return Err("Explicit gap rests exceed the numbered-text token limit".into());
    }
    if gaps > 0 {
        diagnostics.push(Diagnostic::warning("jianpu_export_gap_rests",format!("{gaps} explicit rests preserve gaps and trailing measure time; no pitched note was removed or shifted."),None));
    }
    for line in tokens.chunks(8) {
        text.push_str(&line.join(" "));
        text.push('\n');
    }
    if text.len() > MAX_SOURCE_BYTES {
        return Err("Numbered-text export exceeds the 1 MiB dialect limit".into());
    }
    // Run the public reader before offering a download; preserve spelling/timing, not token aesthetics.
    let (roundtrip, _) = import_jianpu(&text)?;
    if roundtrip.parts[0].notes.len() != mapping.len() {
        return Err("Numbered-text roundtrip did not preserve all exported tokens".into());
    }
    let source_notes: std::collections::HashMap<_, _> = part
        .notes
        .iter()
        .map(|note| (note.id.as_str(), note))
        .collect();
    for (written, source_id) in roundtrip.parts[0].notes.iter().zip(&mapping) {
        if let Some(id) = source_id {
            let original = source_notes[id.as_str()];
            let same_pitch = match (&written.pitch, &original.pitch) {
                (None, None) => true,
                (Some(a), Some(b)) => {
                    a.step == b.step && a.alter == b.alter && a.octave == b.octave
                }
                _ => false,
            };
            if !same_pitch
                || !written.at.equivalent(original.at)
                || !written.duration.equivalent(original.duration)
            {
                return Err(format!(
                    "Numbered-text verification changed note {}; use MusicXML or JSON",
                    id
                ));
            }
        }
    }
    Ok(ExportedJianpu {
        text,
        diagnostics,
        note_map: mapping,
    })
}

#[cfg(test)]
mod export_tests {
    use super::*;
    #[test]
    fn exact_melody_roundtrip_preserves_spelling_triplets_rests_and_source_rights() {
        let (mut score, _) = import_jianpu("1=D4\nmode=major\n1:1/3 #3:2/3 0:1/2 7,:3/2").unwrap();
        score.provenance.attribution =
            "An original study\n; never an authorization to upload".into();
        score.provenance.license = Some("CC0-1.0".into());
        let exported = export_jianpu(&score).unwrap();
        let (again, _) = import_jianpu(&exported.text).unwrap();
        assert_eq!(again.parts[0].notes.len(), score.parts[0].notes.len());
        for (a, b) in again.parts[0].notes.iter().zip(&score.parts[0].notes) {
            assert_eq!(
                serde_json::to_value(&a.pitch).unwrap(),
                serde_json::to_value(&b.pitch).unwrap()
            );
            assert!(a.at.equivalent(b.at));
            assert!(a.duration.equivalent(b.duration));
        }
        assert!(exported.text.contains("; License: CC0-1.0"));
        assert_eq!(exported.note_map.len(), 4);
    }
    #[test]
    fn sparse_melody_gets_explicit_gap_rests_without_moving_notes() {
        let mut score = crate::catalog().remove(0);
        score.parts[0].notes.truncate(2);
        score.parts[0].notes[0].at = Beat::new(1, 2);
        score.parts[0].notes[0].duration = Beat::new(1, 2);
        let exported = export_jianpu(&score).unwrap();
        let again = crate::compile(import_jianpu(&exported.text).unwrap().0).unwrap();
        let original = crate::compile(score).unwrap();
        assert_eq!(again.timeline.notes.len(), original.timeline.notes.len());
        for (a, b) in again.timeline.notes.iter().zip(&original.timeline.notes) {
            assert_eq!(a.midi, b.midi);
            assert!((a.start_ms - b.start_ms).abs() < 1e-8);
            assert!((a.duration_ms - b.duration_ms).abs() < 1e-8);
        }
        assert!((again.timeline.duration_ms - original.timeline.duration_ms).abs() < 1e-8);
        assert!(exported.note_map.contains(&None));
    }
    #[test]
    fn polyphony_ties_repeats_and_pickups_are_not_silently_flattened() {
        let base = crate::catalog().remove(0);
        let mut score = base.clone();
        score.parts[0].notes[1].at = Beat::ZERO;
        assert!(export_jianpu(&score).unwrap_err().contains("Overlapping"));
        let mut score = base.clone();
        score.parts[0].notes[0].tie_start = true;
        assert!(export_jianpu(&score).unwrap_err().contains("ties"));
        let mut score = base.clone();
        score.repeats.push(crate::Repeat {
            from: Beat::ZERO,
            to: Beat::new(4, 1),
            times: 2,
        });
        assert!(export_jianpu(&score).is_err());
        let mut score = base;
        score.measures[0].length = Beat::new(1, 1);
        assert!(export_jianpu(&score).is_err());
    }
    #[test]
    fn extreme_valid_midi_pitch_can_use_an_accidental_from_out_of_range_base_degree() {
        let (score, _) = import_jianpu("1=G#4\nmode=minor\nb1''''':1/1").unwrap();
        assert_eq!(
            score.parts[0].notes[0].pitch.as_ref().unwrap().midi(),
            Some(127)
        );
        let result = export_jianpu(&score).unwrap();
        assert!(result.text.contains("b1''''':1/1"));
    }
    #[test]
    fn export_does_not_silently_round_fine_tempo() {
        let mut score = crate::catalog().remove(0);
        score.tempo[0].bpm = 90.000_000_000_04;
        assert!(export_jianpu(&score).unwrap_err().contains("rounding"));
    }
    #[test]
    fn header_comments_do_not_become_score_tokens_or_metadata_commands() {
        let (score, _) =
            import_jianpu("; title=ignored\ntitle=Actual\n; license unknown\n1\n; tempo=600\n2")
                .unwrap();
        assert_eq!(score.title, "Actual");
        assert_eq!(score.parts[0].notes.len(), 2);
        assert_eq!(score.tempo[0].bpm, 90.);
    }
}
