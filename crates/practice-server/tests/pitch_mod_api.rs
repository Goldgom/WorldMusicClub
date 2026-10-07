use practice_server::{api_response, is_song_api_route, MAX_REQUEST_BYTES};
use serde_json::{json, Value};

fn configuration(semitones: i16) -> Value {
    json!({"format":"wmc-pitch-mod","version":1,"semitones":semitones})
}
fn score() -> score_core::Score {
    let mut score = score_core::catalog().remove(0);
    score.parts.truncate(1);
    score.parts[0].notes.truncate(1);
    let note = &mut score.parts[0].notes[0];
    note.pitch = Some(score_core::Pitch {
        step: "C".into(),
        alter: 0,
        octave: 4,
    });
    note.tie_start = false;
    note.tie_stop = false;
    score
}
fn post(path: &str, body: &Value) -> Value {
    let response = api_response(path, serde_json::to_vec(body).unwrap());
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    serde_json::from_slice(&response.body).unwrap()
}
fn reject(path: &str, body: &Value, status: u16) -> Value {
    let response = api_response(path, serde_json::to_vec(body).unwrap());
    assert_eq!(
        response.status,
        status,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    let value: Value = serde_json::from_slice(&response.body).unwrap();
    assert!(value.get("compilation").is_none());
    value
}
#[test]
fn project_original_c4_to_d4_and_keep_source_and_zero_bytes() {
    let score = score();
    let source = serde_json::to_vec(&score).unwrap();
    let zero = post(
        "/api/pitch-mod/project",
        &json!({"score":score,"configuration":configuration(0)}),
    );
    assert_eq!(zero["compilation"], post("/api/compile", &json!(score)));
    assert_eq!(
        zero["audio_profile"],
        post("/api/canonical-audio-profile", &json!(score))
    );
    assert_eq!(zero["identity"], Value::Null);
    let effective = post(
        "/api/pitch-mod/project",
        &json!({"score":score,"configuration":configuration(2)}),
    );
    assert_eq!(effective["compilation"]["timeline"]["notes"][0]["midi"], 62);
    assert_eq!(effective["audio_profile"]["occurrences"][0]["midi"], 62);
    assert_eq!(
        effective["compilation"]["score"]["parts"][0]["notes"][0]["pitch"]["step"],
        "D"
    );
    assert_eq!(effective["source"], zero["source"]);
    assert_ne!(
        effective["receipt"]["runtime_digest"],
        zero["receipt"]["runtime_digest"]
    );
    assert_eq!(serde_json::to_vec(&score).unwrap(), source);
    let selection = json!({"selected_part_ids":[score.parts[0].id],"profile":{"kind":"piano","key_count":88,"lowest_midi":21}});
    for (path, extra) in [
        ("/api/practice-assistance/original", json!({})),
        (
            "/api/practice-progression/generate",
            json!({"layer":"single"}),
        ),
    ] {
        let mut original = json!({"score":score,"selection":selection});
        original
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let bytes = api_response(path, serde_json::to_vec(&original).unwrap());
        assert_eq!(
            bytes.status,
            200,
            "{}",
            String::from_utf8_lossy(&bytes.body)
        );
        let mut zero = original.clone();
        zero["pitch_mod"] = configuration(0);
        assert_eq!(
            api_response(path, serde_json::to_vec(&zero).unwrap()),
            bytes
        );
        let mut shifted = original.clone();
        shifted["pitch_mod"] = configuration(2);
        let shifted = post(path, &shifted);
        assert_eq!(
            shifted["source"],
            serde_json::from_slice::<Value>(&bytes.body).unwrap()["source"]
        );
        let validation = if path.contains("progression") {
            "/api/practice-progression/validate"
        } else {
            "/api/practice-assistance/validate"
        };
        reject(
            validation,
            &json!({"score":score,"plan":shifted["checked"]["plan"]}),
            422,
        );
        assert_eq!(
            post(
                validation,
                &json!({"score":score,"pitch_mod":configuration(2),"plan":shifted["checked"]["plan"]})
            ),
            shifted
        );
    }
}
#[test]
fn strict_configuration_route_and_midi_domain_rejection() {
    let path = "/api/pitch-mod/project";
    let score = score();
    let valid = json!({"score":score,"configuration":configuration(2)});
    for field in [
        "timeline",
        "effective_score",
        "receipt",
        "source_pitches",
        "identity",
    ] {
        let mut injected = valid.clone();
        injected[field] = json!({});
        reject(path, &injected, 400);
    }
    for value in [json!(2.5), json!("2"), json!(null)] {
        let mut request = valid.clone();
        request["configuration"]["semitones"] = value;
        reject(path, &request, 400);
    }
    for configuration in [
        configuration(13),
        json!({"format":"future","version":1,"semitones":2}),
        json!({"format":"wmc-pitch-mod","version":2,"semitones":2}),
    ] {
        reject(
            path,
            &json!({"score":score,"configuration":configuration}),
            422,
        );
    }
    let mut high = score.clone();
    high.parts[0].notes[0].pitch = Some(score_core::Pitch {
        step: "G".into(),
        alter: 0,
        octave: 9,
    });
    assert_eq!(
        reject(
            path,
            &json!({"score":high,"configuration":configuration(1)}),
            422
        )["code"],
        "pitch_mod_midi_range"
    );
    assert_eq!(
        api_response(path, vec![b' '; MAX_REQUEST_BYTES + 1]).status,
        413
    );
    assert!(is_song_api_route(path));
    assert!(!is_song_api_route("/api/pitch-mod/project/extra"));
}
#[test]
fn fingering_is_computed_from_original_and_bound_to_the_effective_receipt() {
    let score = score();
    let settings = json!({"part_id":score.parts[0].id,"profile":{"kind":"piano","key_count":88,"lowest_midi":21}});
    let request = json!({"score":score,"configuration":configuration(2),"settings":settings});
    let shifted = post("/api/pitch-mod/fingering/piano", &request);
    assert_eq!(shifted["receipt"]["runtime_policy"], "wmc-pitch-mod-v1");
    assert_eq!(shifted["pitch_mod"]["semitones"], 2);
    let mut injected = request;
    injected["settings"]["score"] = json!(score);
    reject("/api/pitch-mod/fingering/piano", &injected, 400);
}
