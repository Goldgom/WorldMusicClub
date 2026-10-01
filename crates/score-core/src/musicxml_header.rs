//! Recognize two fixed, external-only declarations; never parse or resolve a DTD.
use std::borrow::Cow;

const MAX_PROLOG_BYTES: usize = 64 * 1024;
const DECLARATION_ERROR: &str = "Only the standard external-only MusicXML 3.1 or 4.0 score-partwise PUBLIC DOCTYPE is supported. Internal subsets, entity declarations and other DTDs are not allowed; export self-contained MusicXML.";

pub(super) struct PreparedXml<'a> {
    pub xml: Cow<'a, str>,
    pub header_version: Option<&'static str>,
}

fn xml_space(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\r' | b'\n')
}

struct Prolog<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl Prolog<'_> {
    fn token(&mut self, token: &[u8]) -> Result<(), String> {
        if !self.bytes[self.at..].starts_with(token) {
            return Err(DECLARATION_ERROR.into());
        }
        self.at += token.len();
        Ok(())
    }
    fn space(&mut self) {
        while self.bytes.get(self.at).is_some_and(|b| xml_space(*b)) {
            self.at += 1;
        }
    }
    fn required_space(&mut self) -> Result<(), String> {
        let before = self.at;
        self.space();
        if before == self.at {
            return Err(DECLARATION_ERROR.into());
        }
        Ok(())
    }
    fn through(&mut self, terminator: &[u8]) -> Result<(), String> {
        let length = self.bytes[self.at..]
            .windows(terminator.len())
            .position(|window| window == terminator)
            .ok_or("MusicXML standard header must have a complete prolog within 64 KiB")?;
        self.at += length + terminator.len();
        Ok(())
    }
    fn quoted(&mut self) -> Result<&[u8], String> {
        let quote = *self.bytes.get(self.at).ok_or(DECLARATION_ERROR)?;
        if !matches!(quote, b'\'' | b'"') {
            return Err(DECLARATION_ERROR.into());
        }
        self.at += 1;
        let start = self.at;
        self.through(&[quote])?;
        Ok(&self.bytes[start..self.at - 1])
    }
}

/// Headerless input follows the existing strict path. A recognized declaration
/// is replaced only in the parsing projection by equal-length XML whitespace,
/// retaining line endings and offsets for parser diagnostics. The caller keeps
/// and hashes the original input, never this projection.
pub(super) fn prepare(xml: &str) -> Result<PreparedXml<'_>, String> {
    if xml.contains("<!ENTITY") {
        return Err(DECLARATION_ERROR.into());
    }
    if !xml.contains("<!DOCTYPE") {
        return Ok(PreparedXml {
            xml: Cow::Borrowed(xml),
            header_version: None,
        });
    }
    if xml.matches("<!DOCTYPE").count() != 1 {
        return Err("Repeated MusicXML DOCTYPE declarations are not allowed".into());
    }
    let mut prolog = Prolog {
        bytes: &xml.as_bytes()[..xml.len().min(MAX_PROLOG_BYTES)],
        at: usize::from(xml.starts_with('\u{feff}')) * 3,
    };
    // Leave declaration/comment well-formedness to the ordinary XML parser.
    // They remain untouched, and cannot conceal a declaration we will remove.
    if prolog.bytes[prolog.at..].starts_with(b"<?xml")
        && prolog
            .bytes
            .get(prolog.at + 5)
            .is_some_and(|b| xml_space(*b))
    {
        prolog.through(b"?>")?;
    }
    loop {
        prolog.space();
        if !prolog.bytes[prolog.at..].starts_with(b"<!--") {
            break;
        }
        prolog.through(b"-->")?;
    }
    let start = prolog.at;
    prolog.token(b"<!DOCTYPE")?;
    prolog.required_space()?;
    prolog.token(b"score-partwise")?;
    prolog.required_space()?;
    prolog.token(b"PUBLIC")?;
    prolog.required_space()?;
    let version = match prolog.quoted()? {
        b"-//Recordare//DTD MusicXML 3.1 Partwise//EN" => "3.1",
        b"-//Recordare//DTD MusicXML 4.0 Partwise//EN" => "4.0",
        _ => return Err(DECLARATION_ERROR.into()),
    };
    prolog.required_space()?;
    if prolog.quoted()? != b"http://www.musicxml.org/dtds/partwise.dtd" {
        return Err(DECLARATION_ERROR.into());
    }
    prolog.space();
    prolog.token(b">")?;
    let end = prolog.at;
    let mut projection = String::with_capacity(xml.len());
    projection.push_str(&xml[..start]);
    for byte in &xml.as_bytes()[start..end] {
        projection.push(if xml_space(*byte) { *byte as char } else { ' ' });
    }
    projection.push_str(&xml[end..]);
    Ok(PreparedXml {
        xml: Cow::Owned(projection),
        header_version: Some(version),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{compile, import_musicxml, Score};

    const DUET: &str = include_str!("../../../tests/fixtures/original-duet.musicxml");
    const HEADER_DUET: &str =
        include_str!("../../../tests/fixtures/original-duet-standard-header.musicxml");
    const HEADER: &str = "<!DOCTYPE score-partwise PUBLIC \"-//Recordare//DTD MusicXML 4.0 Partwise//EN\" \"http://www.musicxml.org/dtds/partwise.dtd\">";

    fn with_header(header: &str) -> String {
        DUET.replacen("<score-partwise", &format!("{header}\n<score-partwise"), 1)
    }

    // Only source-derived IDs and retained source observations differ. Compare
    // the entire remaining canonical score, preserving order and multiplicity.
    fn align_source_ids(mut score: Score, target: &Score) -> Score {
        let prefix = score.id.clone();
        for note in score.parts.iter_mut().flat_map(|part| &mut part.notes) {
            let suffix = note.id.strip_prefix(&prefix).unwrap();
            note.id = format!("{}{suffix}", target.id);
        }
        score.id = target.id.clone();
        score.source = target.source.clone();
        score
    }

    fn assert_same_music(actual: &Score, expected: &Score) {
        let aligned = align_source_ids(actual.clone(), expected);
        assert_eq!(
            serde_json::to_value(&aligned).unwrap(),
            serde_json::to_value(expected).unwrap(),
            "Every written event, exact beat, spelling, rest, lane, velocity, tie and map must agree"
        );
        assert_eq!(
            serde_json::to_value(compile(aligned).unwrap().timeline).unwrap(),
            serde_json::to_value(compile(expected.clone()).unwrap().timeline).unwrap(),
            "Every sounding occurrence and tied source-note reference must agree"
        );
    }

    #[test]
    fn licensed_raw_d768_matches_its_unchanged_import_copy_for_every_event() {
        let edition = crate::catalog_score("cc0-schubert-wandrers-nachtlied-d768").unwrap();
        let envelope: serde_json::Value =
            serde_json::from_str(&edition.source.unwrap().content).unwrap();
        let raw = envelope["files"]["converter.musicxml"]["content"]
            .as_str()
            .unwrap();
        let baseline = envelope["files"]["import.musicxml"]["content"]
            .as_str()
            .unwrap();
        assert_eq!(raw.len(), 139_136);
        assert_eq!(baseline.len(), 139_014);
        let (actual, warnings) = import_musicxml(raw).unwrap();
        let expected = import_musicxml(baseline).unwrap().0;
        assert_eq!(actual.id, "musicxml-4261e08918bda6bc");
        assert_eq!(expected.id, "musicxml-b4a21780de18c357");
        assert_eq!(
            actual.source.as_ref().unwrap().content.as_bytes(),
            raw.as_bytes()
        );
        assert_eq!(
            actual.parts.iter().map(|p| p.notes.len()).sum::<usize>(),
            334
        );
        assert_eq!(compile(actual.clone()).unwrap().timeline.notes.len(), 321);
        assert_same_music(&actual, &expected);
        assert_eq!(
            warnings
                .iter()
                .filter(|d| d.code == "musicxml_header_normalized")
                .count(),
            1
        );
    }

    #[test]
    fn standard_headers_preserve_source_and_durable_observations_through_recompile() {
        let expected = import_musicxml(DUET).unwrap().0;
        assert_eq!(expected.id, "musicxml-839174b091308f1f");
        for raw in [
            with_header(HEADER),
            HEADER_DUET.to_string(),
            HEADER_DUET.replace("4.0", "3.1"),
            with_header(HEADER).replace(
                "\"http://www.musicxml.org/dtds/partwise.dtd\"",
                "'http://www.musicxml.org/dtds/partwise.dtd'",
            ),
        ] {
            let (mut score, warnings) = import_musicxml(&raw).unwrap();
            assert_ne!(score.id, expected.id);
            assert_same_music(&score, &expected);
            let original_source = serde_json::to_value(score.source.as_ref().unwrap()).unwrap();
            assert_eq!(
                original_source["content"].as_str().unwrap().as_bytes(),
                raw.as_bytes()
            );
            let notice = warnings
                .iter()
                .find(|d| d.code == "musicxml_header_normalized")
                .unwrap();
            assert!(notice.message.contains("No DTD was loaded or validated"));
            assert!(notice
                .message
                .contains("defaults and attribute-type normalization"));
            for _ in 0..3 {
                score = serde_json::from_slice(&serde_json::to_vec(&score).unwrap()).unwrap();
                let compilation = compile(score).unwrap();
                let notices: Vec<_> = compilation
                    .diagnostics
                    .iter()
                    .filter(|d| d.code == notice.code)
                    .collect();
                assert_eq!(notices.len(), 1);
                assert_eq!(
                    notices[0].message,
                    format!("Retained import observation: {}", notice.message)
                );
                score = compilation.score;
                assert_eq!(
                    serde_json::to_value(score.source.as_ref().unwrap()).unwrap(),
                    original_source
                );
            }
        }
    }

    #[test]
    fn parsing_projection_preserves_offsets_and_only_omits_the_declaration() {
        assert!(HEADER_DUET.starts_with('\u{feff}'));
        assert!(HEADER_DUET.contains("\r\n"));
        let prepared = prepare(HEADER_DUET).unwrap();
        assert_eq!(prepared.header_version, Some("4.0"));
        assert_eq!(prepared.xml.len(), HEADER_DUET.len());
        let start = HEADER_DUET.find("<!DOCTYPE").unwrap();
        let end = start + HEADER_DUET[start..].find('>').unwrap() + 1;
        assert_eq!(&prepared.xml[..start], &HEADER_DUET[..start]);
        assert_eq!(&prepared.xml[end..], &HEADER_DUET[end..]);
        for (original, parsed) in HEADER_DUET.bytes().zip(prepared.xml.bytes()) {
            if xml_space(original) {
                assert_eq!(parsed, original);
            }
        }
        assert!(matches!(prepare(DUET).unwrap().xml, Cow::Borrowed(_)));
        let malformed = HEADER_DUET.replace("</work-title>", "</wrong-title>");
        let error = import_musicxml(&malformed).unwrap_err();
        let line = malformed[..malformed.find("</wrong-title>").unwrap()]
            .bytes()
            .filter(|b| *b == b'\n')
            .count()
            + 1;
        assert!(error.contains(&format!("{line}:")), "{error}");
    }

    #[test]
    fn declaration_grammar_and_explicit_matching_versions_stay_narrow() {
        for header in [
            HEADER.replace("4.0", "4.0.3"),
            HEADER.replace("4.0", "3.0"),
            HEADER.replace("score-partwise", "score-timewise"),
            HEADER.replace("PUBLIC", "SYSTEM"),
            "<!DOCTYPE score-partwise SYSTEM 'http://www.musicxml.org/dtds/partwise.dtd'>".into(),
            HEADER.replace("http://", "https://"),
            HEADER.replace("PUBLIC ", "PUBLIC"),
            HEADER.replace("score-partwise PUBLIC", "score-partwisePUBLIC"),
            HEADER.replace(
                "\"http://www.musicxml.org/dtds/partwise.dtd\"",
                "'http://www.musicxml.org/dtds/partwise.dtd\"",
            ),
            HEADER.replace('>', " []>"),
            HEADER.replace('>', " [<!ENTITY accent 'é'>]>"),
            format!("{HEADER}\n{HEADER}"),
            format!("<!--{HEADER}-->"),
        ] {
            assert!(import_musicxml(&with_header(&header)).is_err(), "{header}");
        }
        for xml in [
            with_header(HEADER).replace("<score-partwise version=\"4.0\">", "<score-partwise>"),
            with_header(HEADER).replace("<score-partwise version=\"4.0\">", "<score-partwise version='3.1'>"),
            with_header(HEADER).replace("<score-partwise version=\"4.0\">", "<score-partwise version='4.0.3'>"),
            with_header(HEADER).replace("<score-partwise version=\"4.0\">", "<score-timewise version='4.0'>").replace("</score-partwise>", "</score-timewise>"),
            with_header(HEADER).replace("<score-partwise version=\"4.0\">", "<m:score-partwise xmlns:m='http://www.musicxml.org/ns/musicxml' version='4.0'>").replace("</score-partwise>", "</m:score-partwise>"),
            format!("{DUET}\n{HEADER}"),
        ] {
            assert!(import_musicxml(&xml).is_err());
        }
        // Explicit-version checks apply only to the newly admitted header path.
        for version in ["", " version='4.0.3'", " version='3.1'"] {
            assert!(import_musicxml(&DUET.replace(" version=\"4.0\"", version)).is_ok());
        }
    }

    #[test]
    fn dtd_named_entities_are_refused_and_xml_builtin_references_still_work() {
        for entity in ["&eacute;", "&nbsp;", "&custom;"] {
            let xml = with_header(HEADER).replace("Small Exact Duet", entity);
            assert!(import_musicxml(&xml)
                .unwrap_err()
                .contains("unknown entity"));
        }
        let xml = with_header(HEADER).replace("Small Exact Duet", "Élan &amp; &#233; &#xE9;");
        let score = import_musicxml(&xml).unwrap().0;
        assert_eq!(score.title, "Élan & é é");
        assert_eq!(score.source.unwrap().content, xml);
    }

    #[test]
    fn standard_header_does_not_change_supported_repeat_defaults() {
        let original = include_str!("../../../tests/fixtures/original-repeat.musicxml");
        let raw = original.replace(" location=\"right\"", "").replacen(
            "<score-partwise",
            &format!("{HEADER}\n<score-partwise"),
            1,
        );
        assert_same_music(
            &import_musicxml(&raw).unwrap().0,
            &import_musicxml(original).unwrap().0,
        );
    }
}
