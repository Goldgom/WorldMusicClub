//! Review bridge for separately produced engine output. No engine execution or network access.
use crate::{compile, import_musicxml, Compilation, Diagnostic, Score, Source};
use base64::Engine;
use serde::{Deserialize, Serialize};

const VERSION: &str = "5.11.0";
const MAX_PACKAGE_BYTES: usize = 8 * 1024 * 1024;
const HEADER: &str = "<!DOCTYPE score-partwise PUBLIC \"-//Recordare//DTD MusicXML 4.0.3 Partwise//EN\" \"http://www.musicxml.org/dtds/partwise.dtd\">";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputFormat {
    Musicxml,
    Mxl,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OriginalImageFormat {
    Png,
    Jpeg,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OriginalImage {
    pub format: OriginalImageFormat,
    pub filename: Option<String>,
    pub base64: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AudiverisInput {
    pub engine_version: String,
    pub output_format: OutputFormat,
    /// UTF-8 XML, or base64 of the complete MXL. No executable/arguments/paths are accepted.
    pub output_content: String,
    #[serde(default)]
    pub original_image: Option<OriginalImage>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewConfirmation {
    pub notes_and_rests: bool,
    pub rhythm_and_voices: bool,
    pub ties_and_navigation: bool,
    pub key_and_meter: bool,
    pub tempo: bool,
    pub source_rights: bool,
}
impl ReviewConfirmation {
    fn complete(&self) -> bool {
        self.notes_and_rests
            && self.rhythm_and_voices
            && self.ties_and_navigation
            && self.key_and_meter
            && self.tempo
            && self.source_rights
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ReviewRecord {
    version: u8,
    input: AudiverisInput,
    normalizations: Vec<String>,
    confirmation: Option<ReviewConfirmation>,
}

#[derive(Debug, Serialize)]
pub struct ExternalOmrDraft {
    pub score: Score,
    pub requires_review: bool,
    pub confidence: Option<f64>,
    pub normalizations: Vec<String>,
    pub diagnostics: Vec<Diagnostic>,
}

fn unpack(input: &AudiverisInput) -> Result<(String, Vec<Diagnostic>), String> {
    if input.engine_version != VERSION {
        return Err(
            "The optional review bridge currently supports declared Audiveris 5.11.0 output only"
                .into(),
        );
    }
    if input.output_content.len() > MAX_PACKAGE_BYTES {
        return Err("OMR output exceeds the 8 MiB limit".into());
    }
    match input.output_format {
        OutputFormat::Musicxml => Ok((input.output_content.clone(), vec![])),
        OutputFormat::Mxl => {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&input.output_content)
                .map_err(|_| "OMR MXL content must be standard base64")?;
            let (xml, _, mut warnings) = crate::mxl::read_mxl_xml(&bytes)?;
            // This bridge preserves the complete container, unlike ordinary import_mxl.
            warnings.retain(|w| w.code != "mxl_source_retained");
            Ok((xml, warnings))
        }
    }
}

fn record_source(score: &mut Score, record: &ReviewRecord, reviewed: bool) -> Result<(), String> {
    score.source = Some(Source {
        import_diagnostics: score
            .source
            .as_ref()
            .and_then(|source| source.import_diagnostics.clone()),
        format: if reviewed {
            "external-omr-reviewed"
        } else {
            "external-omr-draft"
        }
        .into(),
        filename: None,
        content: serde_json::to_string(record).map_err(|e| e.to_string())?,
    });
    crate::validate(score)?;
    if serde_json::to_vec(score).map_err(|e| e.to_string())?.len() > MAX_PACKAGE_BYTES {
        return Err(
            "The retained OMR review package exceeds 8 MiB; use a smaller original fragment".into(),
        );
    }
    Ok(())
}

/// Returns a gated draft, never a playable compilation or an automatic confidence claim.
pub fn prepare_audiveris(input: AudiverisInput) -> Result<ExternalOmrDraft, String> {
    if serde_json::to_vec(&input).map_err(|e| e.to_string())?.len() > MAX_PACKAGE_BYTES {
        return Err("Combined engine output and original image exceed 8 MiB".into());
    }
    if let Some(image) = &input.original_image {
        if image
            .filename
            .as_ref()
            .is_some_and(|name| name.len() > 1024)
        {
            return Err("Original image filename exceeds 1024 bytes".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&image.base64)
            .map_err(|_| "Original image must be standard base64")?;
        let (_, format) = crate::omr::decode_bounded_image(&bytes)?;
        let expected = match image.format {
            OriginalImageFormat::Png => image::ImageFormat::Png,
            OriginalImageFormat::Jpeg => image::ImageFormat::Jpeg,
        };
        if format != expected {
            return Err("Original image format does not match its bytes".into());
        }
    }
    let (raw_xml, mut diagnostics) = unpack(&input)?;
    let mut normalizations: Vec<String> = vec![];
    let xml = if raw_xml.contains(HEADER) {
        if raw_xml.matches(HEADER).count() != 1 {
            return Err("Ambiguous repeated vendor header".into());
        }
        normalizations.push("Removed exactly the declared Audiveris 5.11.0 / ProxyMusic 4.0.3 external DOCTYPE header from the parsed copy. Original output bytes are retained; no DTD or external resource was resolved.".into());
        raw_xml.replacen(HEADER, "", 1)
    } else {
        raw_xml.clone()
    };
    // The ordinary importer still rejects any other DTD/entity declaration or unsupported XML.
    let (mut score, warnings) = import_musicxml(&xml)?;
    let doc = roxmltree::Document::parse_with_options(
        &xml,
        roxmltree::ParsingOptions {
            allow_dtd: false,
            nodes_limit: 1_000_000,
            entity_resolver: None,
        },
    )
    .map_err(|e| format!("Invalid normalized OMR XML: {e}"))?;
    if !doc
        .descendants()
        .any(|n| n.has_tag_name("software") && n.text() == Some("Audiveris 5.11.0"))
    {
        return Err(
            "The output does not declare the supported Audiveris 5.11.0 software version".into(),
        );
    }
    // Validate musical compilation before tagging the result as deliberately unplayable.
    compile(score.clone())?;
    diagnostics.extend(warnings);
    diagnostics.push(Diagnostic::warning("external_omr_unreviewed", "Recognition may contain missing or misplaced notes, rhythm, voices, ties, key and tempo. Check all against the original image; engine exit success is not musical acceptance. Confidence is unknown.", None));
    if !normalizations.is_empty() {
        diagnostics.push(Diagnostic::warning(
            "external_omr_header_normalized",
            normalizations[0].clone(),
            None,
        ));
    }
    if let Some(source) = &mut score.source {
        source.import_diagnostics = Some(
            diagnostics
                .iter()
                .filter(|d| d.code != "external_omr_unreviewed")
                .cloned()
                .collect(),
        );
    }
    let record = ReviewRecord {
        version: 1,
        input,
        normalizations: normalizations.clone(),
        confirmation: None,
    };
    record_source(&mut score, &record, false)?;
    Ok(ExternalOmrDraft {
        score,
        requires_review: true,
        confidence: None,
        normalizations,
        diagnostics,
    })
}

/// A caller supplies the fully edited canonical draft plus freshly completed review attestations.
/// These are user assertions, not an automatic claim of correctness or legal clearance.
pub fn confirm_review(
    mut edited: Score,
    confirmation: ReviewConfirmation,
) -> Result<Compilation, String> {
    if !confirmation.complete() {
        return Err("Confirm every review category after checking the original source, including tempo and rights".into());
    }
    crate::validate(&edited)?;
    let source = edited
        .source
        .as_ref()
        .filter(|s| s.format == "external-omr-draft")
        .ok_or("Only an unreviewed external OMR draft can be confirmed")?;
    let mut record: ReviewRecord = serde_json::from_str(&source.content)
        .map_err(|e| format!("Invalid retained OMR record: {e}"))?;
    if record.version != 1 || record.confirmation.is_some() {
        return Err("Unsupported or already-confirmed OMR record".into());
    }
    let original = prepare_audiveris(record.input.clone())?;
    if record.normalizations != original.normalizations {
        return Err("OMR normalization record does not match its retained source".into());
    }
    if let Some(source) = &mut edited.source {
        source.import_diagnostics = original
            .score
            .source
            .as_ref()
            .and_then(|source| source.import_diagnostics.clone());
    }
    record.confirmation = Some(confirmation);
    edited.provenance.kind = "user_reviewed_external_omr".into();
    record_source(&mut edited, &record, true)?;
    let mut compilation = compile(edited)?;
    compilation.diagnostics.push(Diagnostic::warning("external_omr_user_reviewed", "This score carries explicit user review attestations and retained engine output. That is not independently verified recognition accuracy, confidence, source rights or instrument playability. Keep the original image with the JSON backup; image retention is present only if it was explicitly supplied.", None));
    Ok(compilation)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    fn xml() -> String {
        crate::export_musicxml(&crate::catalog().remove(0))
            .unwrap()
            .xml
            .replace(
                "<encoding>",
                "<encoding><software>Audiveris 5.11.0</software>",
            )
    }
    fn input() -> AudiverisInput {
        AudiverisInput {
            engine_version: VERSION.into(),
            output_format: OutputFormat::Musicxml,
            output_content: xml(),
            original_image: None,
        }
    }
    fn confirmation() -> ReviewConfirmation {
        ReviewConfirmation {
            notes_and_rests: true,
            rhythm_and_voices: true,
            ties_and_navigation: true,
            key_and_meter: true,
            tempo: true,
            source_rights: true,
        }
    }
    #[test]
    fn self_contained_output_stays_unplayable_until_explicit_review() {
        let mut draft = prepare_audiveris(input()).unwrap();
        assert!(draft.requires_review);
        assert!(draft.confidence.is_none());
        assert!(compile(draft.score.clone()).unwrap_err().contains("review"));
        assert!(crate::adaptation::preview_octaves(
            &draft.score,
            crate::adaptation::OctaveOperation {
                part_id: None,
                octaves: 1
            },
            &crate::instruments::InstrumentProfile::Piano {
                key_count: 61,
                lowest_midi: None
            }
        )
        .is_err());
        let mut incomplete = confirmation();
        incomplete.tempo = false;
        assert!(confirm_review(draft.score.clone(), incomplete).is_err());
        draft.score.tempo[0].bpm = 90.;
        draft.score.parts[0].notes[0].pitch.as_mut().unwrap().alter = 2;
        let checked = confirm_review(draft.score, confirmation()).unwrap();
        assert_eq!(checked.timeline.notes[0].midi, 62);
        assert_eq!(checked.score.tempo[0].bpm, 90.);
        assert_eq!(
            checked.score.source.as_ref().unwrap().format,
            "external-omr-reviewed"
        );
        let record: ReviewRecord =
            serde_json::from_str(&checked.score.source.unwrap().content).unwrap();
        assert_eq!(record.input.output_content, xml());
        assert!(record.confirmation.unwrap().complete());
    }
    #[test]
    fn exact_vendor_header_is_disclosed_and_raw_xml_is_retained() {
        let mut input = input();
        input.output_content = input.output_content.replacen(
            "<score-partwise",
            &format!("{HEADER}\n<score-partwise"),
            1,
        );
        assert!(import_musicxml(&input.output_content).is_err());
        let raw = input.output_content.clone();
        let draft = prepare_audiveris(input).unwrap();
        assert_eq!(draft.normalizations.len(), 1);
        let record: ReviewRecord =
            serde_json::from_str(&draft.score.source.unwrap().content).unwrap();
        assert_eq!(record.input.output_content, raw);
    }
    #[test]
    fn complete_mxl_is_retained_without_extracting_files() {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (path, content) in [
            (
                "META-INF/container.xml",
                "<container><rootfiles><rootfile full-path='score.xml'/></rootfiles></container>"
                    .to_string(),
            ),
            ("score.xml", xml()),
        ] {
            writer
                .start_file(path, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(content.as_bytes()).unwrap();
        }
        let bytes = writer.finish().unwrap().into_inner();
        let input = AudiverisInput {
            engine_version: VERSION.into(),
            output_format: OutputFormat::Mxl,
            output_content: base64::engine::general_purpose::STANDARD.encode(&bytes),
            original_image: None,
        };
        let checked =
            confirm_review(prepare_audiveris(input).unwrap().score, confirmation()).unwrap();
        let record: ReviewRecord =
            serde_json::from_str(&checked.score.source.unwrap().content).unwrap();
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(record.input.output_content)
                .unwrap(),
            bytes
        );
    }
    #[test]
    fn attached_original_image_is_retained_byte_exact_with_the_engine_output() {
        let bytes = include_bytes!("../../../tests/fixtures/omr-original-scale.png");
        let mut input = input();
        input.original_image = Some(OriginalImage {
            format: OriginalImageFormat::Png,
            filename: Some("original.png".into()),
            base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        });
        let checked =
            confirm_review(prepare_audiveris(input).unwrap().score, confirmation()).unwrap();
        let record: ReviewRecord =
            serde_json::from_str(&checked.score.source.unwrap().content).unwrap();
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(record.input.original_image.unwrap().base64)
                .unwrap(),
            bytes
        );
    }
    #[test]
    fn actual_original_engine_outputs_require_and_preserve_explicit_musical_correction() {
        let cases = [
            (
                include_str!("../../../tests/fixtures/audiveris-original-melody.musicxml"),
                crate::catalog().remove(0),
                false,
            ),
            (
                include_str!("../../../tests/fixtures/audiveris-original-duet.musicxml"),
                import_musicxml(include_str!(
                    "../../../tests/fixtures/original-duet.musicxml"
                ))
                .unwrap()
                .0,
                true,
            ),
        ];
        for (xml, expected, duet) in cases {
            let mut draft = prepare_audiveris(AudiverisInput {
                engine_version: VERSION.into(),
                output_format: OutputFormat::Musicxml,
                output_content: xml.into(),
                original_image: None,
            })
            .unwrap();
            assert!(draft.requires_review);
            assert!(draft.confidence.is_none());
            assert_eq!(draft.normalizations.len(), 1);
            if !duet {
                assert_eq!(draft.score.tempo[0].bpm, 120.);
                assert_eq!(expected.tempo[0].bpm, 90.);
            }
            // Known original-fixture corrections, deliberately not performed by the importer.
            draft.score.tempo = expected.tempo.clone();
            draft.score.keys = expected.keys.clone();
            if duet {
                for note in &mut draft.score.parts[0].notes {
                    if note.at.equivalent(crate::Beat::new(2, 1)) {
                        note.at = crate::Beat::new(3, 1);
                    }
                    if note.staff == 2 {
                        note.voice = "2".into();
                    } else if note.voice == "2" {
                        note.voice = "1".into();
                    }
                }
            }
            let checked = confirm_review(draft.score, confirmation()).unwrap();
            fn written(score: &Score) -> Vec<Vec<String>> {
                score
                    .parts
                    .iter()
                    .map(|part| {
                        let mut notes: Vec<_> = part
                            .notes
                            .iter()
                            .map(|n| {
                                serde_json::json!([
                                    n.at,
                                    n.duration,
                                    n.pitch,
                                    n.voice,
                                    n.staff,
                                    n.tie_start,
                                    n.tie_stop
                                ])
                                .to_string()
                            })
                            .collect();
                        notes.sort();
                        notes
                    })
                    .collect()
            }
            assert_eq!(written(&checked.score), written(&expected));
            let expected = compile(expected).unwrap();
            let timing = |c: &Compilation| {
                let mut notes: Vec<_> = c
                    .timeline
                    .notes
                    .iter()
                    .map(|n| (n.midi, n.start_ms.to_bits(), n.duration_ms.to_bits()))
                    .collect();
                notes.sort();
                notes
            };
            assert_eq!(timing(&checked), timing(&expected));
            let record: ReviewRecord =
                serde_json::from_str(&checked.score.source.unwrap().content).unwrap();
            assert_eq!(record.input.output_content, xml);
        }
    }
    #[test]
    fn unsupported_versions_and_unrelated_exports_are_not_claimed_as_audiveris() {
        let mut old = input();
        old.engine_version = "5.10.0".into();
        assert!(prepare_audiveris(old).is_err());
        let mut unrelated = input();
        unrelated.output_content = unrelated
            .output_content
            .replace("Audiveris 5.11.0", "Another editor");
        assert!(prepare_audiveris(unrelated).is_err());
    }
}
