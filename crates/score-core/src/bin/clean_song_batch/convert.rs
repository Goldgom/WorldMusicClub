//! Orchestration of authoritative core converters; no source-format parser.
use super::{
    digest,
    report::{Issue, ResultRecord, Status},
};
use score_core::{basic_keys, clean_conversion, vsq_clean};
use serde_json::{json, Value};

pub struct Package {
    pub score: Vec<u8>,
    pub metadata: Vec<u8>,
}
pub struct Converted {
    pub record: ResultRecord,
    pub package: Option<Package>,
}
fn diagnostic_issue(diagnostic: &clean_conversion::Diagnostic, path: &str) -> Issue {
    let mut issue = Issue::new(
        &diagnostic.code,
        path,
        &diagnostic.message,
        &diagnostic.action,
    );
    issue.track_index = diagnostic.track_index;
    issue.source_event_id = diagnostic.source_event_id.clone();
    issue
}

fn failure(path: &str, sha: &str, size: u64, code: &str, error: &str) -> Converted {
    Converted { record: ResultRecord::failed(path, Some(sha.into()), Some(size), code, error,
        "Keep the original unchanged. Resolve this generic converter/source limitation and rerun the whole input root into a new output directory; no partial song was exported", 0), package: None }
}
pub fn convert(bytes: &[u8], title: &str, path: &str, sha: &str, size: u64) -> Converted {
    if size > score_core::midi_events::MAX_SOURCE_BYTES as u64 {
        return failure(
            path,
            sha,
            size,
            "source_limit",
            "Source exceeds the 5 MiB MIDI/VSQ input limit",
        );
    }
    // The core probe recognizes framed VSQ authoring even under a .mid suffix.
    // A recognized but invalid VSQ must never fall back to generic MIDI.
    let draft = match clean_conversion::prepare_midi(bytes, title, "batch-source.mid") {
        Ok(draft) => draft,
        Err(error) => return failure(path, sha, size, "source_probe", &error),
    };
    if draft.source.format == "vsq" {
        return convert_vsq(draft, title, path, sha, size);
    }
    drop(draft);
    convert_basic(bytes, title, path, sha, size)
}
fn millis(exact: &Value) -> Option<f64> {
    let numerator = exact.get("numerator")?.as_str()?.parse::<u128>().ok()?;
    let denominator = exact.get("denominator")?.as_u64()?;
    if denominator == 0 {
        return None;
    }
    Some(numerator as f64 / denominator as f64 / 1000.0)
}
fn package_record(sha: &str, package: &Package) -> Value {
    json!({"folder":format!("songs/{sha}"),"score_bytes":package.score.len(),"score_sha256":digest(&package.score),
        "metadata_bytes":package.metadata.len(),"metadata_sha256":digest(&package.metadata),"media":[]})
}
fn basic_failure(
    score: &basic_keys::CompleteBasicKeys,
    title: &str,
    path: &str,
    sha: &str,
    size: u64,
    error: &str,
) -> Converted {
    let mut failed = failure(path, sha, size, "complete_score_validation", error);
    failed.record.title = Some(title.into());
    failed.record.source_format = Some("midi".into());
    failed.record.profile = Some(basic_keys::PROFILE.into());
    failed.record.coverage = json!(score.coverage);
    failed.record.coverage["retained_attacks"] = json!(score.performance.notes.len());
    failed.record.coverage["validation"] = json!("not_published");
    failed.record.tracks = json!(score.performance.tracks.iter().map(|track| json!({"source_index":track.source_index,"name":track.name,"source_events":track.events.len(),"end_tick":track.end_tick})).collect::<Vec<_>>());
    let exact = json!(score.performance.timing.end_relative_microseconds);
    failed.record.duration = json!({"end_tick":score.performance.end_tick,"ppq":score.performance.ppq,"milliseconds":millis(&exact),"exact_microseconds":exact,"basis":"source clock; score validation/publication failed"});
    failed
}
fn convert_basic(bytes: &[u8], title: &str, path: &str, sha: &str, size: u64) -> Converted {
    let score = match basic_keys::convert_midi(bytes, title) {
        Ok(score) => score,
        Err(error) => return failure(path, sha, size, &error.code, &error.message),
    };
    let encoded = match basic_keys::encode_json(&score) {
        Ok(bytes) => bytes,
        Err(error) => return basic_failure(&score, title, path, sha, size, &error),
    };
    if score.source.sha256 != sha || score.source.bytes as u64 != size {
        return failure(
            path,
            sha,
            size,
            "source_identity",
            "Converted score does not match the original source hash and byte count",
        );
    }
    let metadata = json!({"format":"worldmusichub-song","version":2,"id":score.notation.id,"title":score.notation.title,
        "score":{"path":"score.json","bytes":encoded.len(),"sha256":digest(&encoded)},"sources":[score.source],
        "rights":{"status":"user_supplied_unverified","attribution":"User-supplied MIDI; source rights are unverified","license":null},"media":[]});
    let metadata = match serde_json::to_vec_pretty(&metadata) {
        Ok(bytes) => bytes,
        Err(error) => return failure(path, sha, size, "metadata_encoding", &error.to_string()),
    };
    let package = Package {
        score: encoded,
        metadata,
    };
    let c = &score.coverage;
    let retained_attacks = score.performance.notes.len();
    let percussion_parts: std::collections::BTreeSet<_> = score
        .performance
        .parts
        .iter()
        .filter(|part| part.channel == 9)
        .map(|part| part.id.as_str())
        .collect();
    let percussion_positive_duration_keys = score
        .performance
        .notes
        .iter()
        .filter(|note| {
            percussion_parts.contains(note.part_id.as_str())
                && note
                    .end
                    .as_ref()
                    .is_some_and(|end| end.tick > note.start.tick)
        })
        .count();
    let data_complete =
        c.source_events == c.represented_events && c.key_attacks == retained_attacks;
    if !data_complete {
        return failure(
            path,
            sha,
            size,
            "incomplete_coverage",
            "Core validation did not establish complete source-event and key-attack coverage",
        );
    }
    let timing_review = c.unresolved_ends > 0 || !score.performance.timing.relative_clock_available;
    let source_defect = score.performance.timing.invalid_program_events > 0;
    let mut issues = vec![];
    if source_defect {
        issues.push(Issue::new("invalid_program_value_retained", path, &format!("{} source program-change values are outside the standard range and are retained exactly without repair", score.performance.timing.invalid_program_events), "Treat program identity as unresolved; correct the original only if its intended program can be independently established, then rerun the corpus"));
    }
    if c.unresolved_ends > 0 {
        issues.push(Issue::new("unresolved_key_ends", path, &format!("{} attacks have ambiguous or missing explicit key releases; every attack remains in performance.notes", c.unresolved_ends), "Inspect the identified attack/release evidence if exact durations are needed; reruns do not invent pairing or discard these records"));
    }
    if !score.performance.timing.relative_clock_available {
        issues.push(Issue::new("relative_clock_unavailable", path, "The source does not establish one unambiguous elapsed-time clock; original ticks, events and attack coordinates remain available", "Inspect source tempo ordering before requiring elapsed-time practice; no arbitrary tempo was inserted"));
    }
    if c.zero_length_attacks > 0 {
        issues.push(Issue::new("zero_length_keys", path, &format!("{} exactly determined zero-length attacks are retained in performance.notes, outside positive-duration notation", c.zero_length_attacks), "Use the exact key records; do not stretch them into guessed note durations"));
    }
    if c.unmatched_releases > 0 {
        issues.push(Issue::new("unmatched_releases", path, &format!("{} explicit releases have no matching active attack and remain in the source-event layer", c.unmatched_releases), "Review only if the source was expected to contain a corresponding attack; no synthetic attack was added"));
    }
    let exact = serde_json::to_value(&score.performance.timing.end_relative_microseconds)
        .unwrap_or(Value::Null);
    let tracks: Vec<_> = score.performance.tracks.iter().map(|track| {
        let notes: Vec<_> = score.performance.notes.iter().filter(|note| note.attack.track == track.source_index).collect();
        json!({"source_index":track.source_index,"id":track.id,"name":track.name,"source_events":track.events.len(),
            "retained_events":track.events.len(),"end_tick":track.end_tick,"key_attacks":notes.len(),"retained_attacks":notes.len(),
            "determined_ends":notes.iter().filter(|note| note.end.is_some()).count(),
            "unresolved_ends":notes.iter().filter(|note| note.end.is_none()).count(),
            "zero_length_attacks":notes.iter().filter(|note| note.end.as_ref().is_some_and(|end| end.tick == note.start.tick)).count()})
    }).collect();
    let record = ResultRecord {
        source_paths: vec![path.into()],
        source_sha256: Some(sha.into()),
        source_bytes: Some(size),
        source_format: Some("midi".into()),
        title: Some(title.into()),
        profile: Some(basic_keys::PROFILE.into()),
        status: if timing_review || source_defect {
            Status::Review
        } else {
            Status::Complete
        },
        data_complete,
        timing_review,
        source_defect,
        coverage: json!({"source_tracks":c.source_tracks,"source_events":c.source_events,"represented_events":c.represented_events,
            "key_attacks":c.key_attacks,"retained_attacks":retained_attacks,"key_releases":c.key_releases,"determined_ends":c.determined_ends,
            "zero_length_attacks":c.zero_length_attacks,"unresolved_ends":c.unresolved_ends,"unmatched_releases":c.unmatched_releases,"notation_notes":c.notation_notes,
            "unresolved_route_ends":c.unresolved_route_ends,"projected_melodic_targets":c.projected_melodic_targets}),
        practice_coverage: json!({"notation_notes":c.notation_notes,"retained_attacks":retained_attacks,"zero_length_attacks":c.zero_length_attacks,
            "pitched_positive_duration_keys":c.notation_notes.saturating_sub(percussion_positive_duration_keys),
            "percussion_positive_duration_keys":percussion_positive_duration_keys,"receiver_accepted_targets":null,"receiver_verified":false,
            "projected_melodic_targets":c.projected_melodic_targets,
            "unresolved_ends":c.unresolved_ends,"score_projection":score.capabilities.score_projection,
            "interpretation":"Positive-duration MIDI key-number projection; receiver target admission and acoustic/percussion meaning are separate"}),
        tracks: json!(tracks),
        duration: json!({"end_tick":score.performance.end_tick,"ppq":score.performance.ppq,"exact_microseconds":exact,"milliseconds":millis(&exact),
            "basis":"source clock from tick zero through every track end","timing":score.performance.timing}),
        capabilities: json!(score.capabilities),
        package: Some(package_record(sha, &package)),
        issues,
        elapsed_ms: 0,
    };
    Converted {
        record,
        package: Some(package),
    }
}
fn convert_vsq(
    draft: clean_conversion::Draft,
    title: &str,
    path: &str,
    sha: &str,
    size: u64,
) -> Converted {
    let Some(draft_package) = draft.package else {
        let mut result = failure(
            path,
            sha,
            size,
            "vsq_conversion",
            "Recognized VSQ could not be converted completely",
        );
        result.record.source_format = Some("vsq".into());
        result.record.tracks = draft
            .inventory
            .as_ref()
            .map(|i| json!(i.tracks))
            .unwrap_or(Value::Null);
        result
            .record
            .issues
            .extend(draft.diagnostics.iter().map(|d| diagnostic_issue(d, path)));
        return result;
    };
    let score = match vsq_clean::decode_json(draft_package.score_json.as_bytes()) {
        Ok(score) => score,
        Err(error) => return failure(path, sha, size, "vsq_score_validation", &error),
    };
    let package = Package {
        score: draft_package.score_json.into_bytes(),
        metadata: draft_package.metadata_json.into_bytes(),
    };
    if score.source.sha256 != sha || score.source.bytes as u64 != size {
        return failure(
            path,
            sha,
            size,
            "source_identity",
            "Converted VSQ score does not match the original source hash and byte count",
        );
    }
    let Some(inventory) = draft.inventory else {
        return failure(
            path,
            sha,
            size,
            "vsq_inventory",
            "Recognized VSQ has no validated source inventory",
        );
    };
    let mut issues: Vec<_> = draft
        .diagnostics
        .iter()
        .map(|d| diagnostic_issue(d, path))
        .collect();
    // This computes a private, read-only timing diagnostic. It starts no player
    // and makes no runtime choice for the exported authoring package.
    let duration = match vsq_clean::compile_practice(
        &score,
        vsq_clean::PracticeChoice::BaseNotesInstrumental,
    ) {
        Ok(runtime) => {
            json!({"end_tick":runtime.project_end_tick,"ppq":runtime.project_ppq,"origin_tick":runtime.practice_origin_tick,
            "exact_microseconds":runtime.end_microseconds,"milliseconds":runtime.end_ms,"basis":"authored project end relative to premeasure practice origin; acoustic tail unavailable"})
        }
        Err(error) => {
            issues.push(Issue::new("practice_duration_unavailable", path, &error, "The complete authoring package is retained; evaluate the separate receiver timing limit before instrumental practice"));
            json!({"milliseconds":null,"basis":"core practice clock unavailable","error":error})
        }
    };
    let authored = score.coverage.project.notes;
    let tracks: Vec<_> = inventory.tracks.iter().map(|track| {
        let authored_track = score.authoring.tracks.iter().find(|t| t.source_track_index == track.source_index);
        json!({"source_index":track.source_index,"id":track.track_id,"name":track.name,"source_events":track.source_event_count,
            "key_attacks":track.key_attacks,"key_releases":track.key_releases,"end":track.end,
            "authored_attacks":authored_track.map_or(0, |t| t.notes.len()),"retained_authored_attacks":authored_track.map_or(0, |t| t.notes.len())})
    }).collect();
    let record = ResultRecord {
        source_paths: vec![path.into()],
        source_sha256: Some(sha.into()),
        source_bytes: Some(size),
        source_format: Some("vsq".into()),
        title: Some(title.into()),
        profile: Some(vsq_clean::PROFILE.into()),
        status: Status::Complete,
        data_complete: true,
        timing_review: false,
        source_defect: false,
        coverage: json!({"source_tracks":inventory.source_tracks,"source_events":inventory.source_events,"key_attacks":authored,"retained_attacks":authored,
            "attack_basis":"authored VSQ notes; SMF key messages are separately counted","container_key_attacks":inventory.key_attacks,"container_key_releases":inventory.key_releases,
            "determined_ends":authored,"zero_length_attacks":0,"unresolved_ends":0,"notation_notes":authored,"profile_coverage":score.coverage}),
        practice_coverage: json!({"notation_notes":authored,"retained_attacks":authored,"receiver_accepted_targets":null,"receiver_verified":false,"interpretation":"All authored base notes; instrumental practice requires an explicit receiver choice; vocal rendering blocked"}),
        tracks: json!(tracks),
        duration,
        capabilities: json!(score.capabilities),
        package: Some(package_record(sha, &package)),
        issues,
        elapsed_ms: 0,
    };
    Converted {
        record,
        package: Some(package),
    }
}
