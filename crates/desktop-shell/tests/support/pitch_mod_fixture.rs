//! Public, original deterministic input and actual production handler vectors.
#![allow(dead_code)]
use http::Request;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
use worldmusichub_desktop::{
    dispatch_with_library,
    native_library::{clean_package, NativeLibrary, SaveRequest},
    ORIGIN,
};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);
pub const PROJECT: &str = "/api/library/pitch-mod/project";
pub struct Sandbox(pub PathBuf);
impl Sandbox {
    pub fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "wmc-pitch-mod-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    pub fn library(&self) -> NativeLibrary {
        NativeLibrary::open(self.0.join("Scores")).unwrap()
    }
    pub fn bytes(&self) -> BTreeMap<PathBuf, Vec<u8>> {
        fn visit(root: &Path, folder: &Path, output: &mut BTreeMap<PathBuf, Vec<u8>>) {
            for entry in fs::read_dir(folder).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    visit(root, &path, output);
                } else {
                    output.insert(
                        path.strip_prefix(root).unwrap().into(),
                        fs::read(path).unwrap(),
                    );
                }
            }
        }
        let mut output = BTreeMap::new();
        visit(&self.0, &self.0, &mut output);
        output
    }
}
impl Drop for Sandbox {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}
pub fn configuration(semitones: i16) -> Value {
    json!({"format":"wmc-pitch-mod","version":1,"semitones":semitones})
}
pub fn canonical() -> score_core::Score {
    let mut score = score_core::catalog().remove(0);
    score.id = "original-pitch-mod-handler-c4".into();
    score.title = "Original C4 pitch Mod handler exercise".into();
    score.parts.truncate(1);
    score.parts[0].notes.truncate(2);
    for (i, note) in score.parts[0].notes.iter_mut().enumerate() {
        note.id = format!("original-c4-{i}");
        note.at = score_core::Beat::new(i as i64, 1);
        note.duration = score_core::Beat::new(1, 1);
        note.pitch = Some(score_core::Pitch {
            step: "C".into(),
            alter: 0,
            octave: 4,
        });
        note.tie_start = false;
        note.tie_stop = false;
    }
    score
}
pub fn request(library: &NativeLibrary, path: &str, body: &Value) -> http::Response<Vec<u8>> {
    dispatch_with_library(
        Request::builder()
            .method("POST")
            .uri(format!("{ORIGIN}{path}"))
            .header("content-type", "application/json")
            .body(serde_json::to_vec(body).unwrap())
            .unwrap(),
        library,
    )
}
pub fn post(library: &NativeLibrary, path: &str, body: &Value) -> Value {
    let response = request(library, path, body);
    assert_eq!(
        response.status(),
        200,
        "{path}: {}",
        String::from_utf8_lossy(response.body())
    );
    serde_json::from_slice(response.body()).unwrap()
}
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn basic_files() -> BTreeMap<String, Vec<u8>> {
    // Complete-source FIFO has two C4 attacks and overlapping releases, explicit
    // channel-10 percussion, program and controller evidence, and a zero gate.
    let track = vec![
        0, 0xc0, 42, 0, 0xb0, 74, 91, 0, 0x90, 60, 90, 24, 0x90, 60, 80, 24, 0x80, 60, 0, 48, 0x80,
        60, 0, 0, 0x90, 64, 90, 0, 0x80, 64, 0, 0, 0x99, 35, 100, 24, 0x89, 35, 0, 0, 0xb0, 123, 0,
        24, 255, 47, 0,
    ];
    let mut midi = b"MThd\0\0\0\x06\0\x00\0\x01\0\x60MTrk".to_vec();
    midi.extend((track.len() as u32).to_be_bytes());
    midi.extend(track);
    let score =
        score_core::basic_keys::convert_midi(&midi, "Original pitch Mod FIFO and drum exercise")
            .unwrap();
    let mut bytes = score_core::basic_keys::encode_json(&score).unwrap();
    bytes.extend(b"\n \t\n");
    let metadata = json!({"format":"worldmusichub-song","version":2,"id":score.notation.id,"title":score.notation.title,"score":{"path":"score.json","bytes":bytes.len(),"sha256":hash(&bytes)},"sources":[score.source],"rights":{"status":"original_authored","attribution":"Original authored isolated pitch Mod FIFO and percussion commands; CC0-1.0","license":"CC0-1.0"},"media":[]});
    BTreeMap::from([
        ("score.json".into(), bytes),
        (
            "metadata.json".into(),
            serde_json::to_vec(&metadata).unwrap(),
        ),
    ])
}
pub fn vsq_files() -> BTreeMap<String, Vec<u8>> {
    BTreeMap::from([
        (
            "metadata.json".into(),
            include_bytes!("../../../../tests/fixtures/vsq-clean-v1/metadata.json").to_vec(),
        ),
        (
            "score.json".into(),
            include_bytes!("../../../../tests/fixtures/vsq-clean-v1/score.json").to_vec(),
        ),
    ])
}
pub fn save(library: &NativeLibrary, files: &BTreeMap<String, Vec<u8>>, profile: &str) -> Value {
    let inventory = files
        .iter()
        .map(|(path, bytes)| (path.clone(), (bytes.len() as u64, hash(bytes))))
        .collect();
    let package =
        clean_package::parse(&files["metadata.json"], &files["score.json"], &inventory).unwrap();
    let entry = clean_package::save(
        library,
        &package,
        None,
        false,
        &mut |_: &clean_package::Media| panic!("Fixture has no media"),
    )
    .unwrap();
    let (choice, policy) = match profile {
        score_core::basic_keys::PROFILE => (Value::Null, score_core::basic_keys::RENDITION_POLICY),
        score_core::vsq_clean::PROFILE => (
            json!("base_notes_instrumental"),
            score_core::practice_source::VSQ_RUNTIME_POLICY,
        ),
        score_core::clean_song::PROFILE => (Value::Null, score_core::clean_song::PROFILE),
        _ => panic!("Unsupported fixture profile"),
    };
    json!({"key":entry.key,"content_sha256":entry.content_sha256,"profile":profile,"choice":choice,"runtime_policy":policy})
}
pub fn save_canonical(library: &NativeLibrary) -> Value {
    let score_json = serde_json::to_string_pretty(&canonical()).unwrap() + "\n \t\n";
    let entry = library
        .save(SaveRequest {
            score_json,
            label: None,
            allow_conflicting_id: false,
        })
        .unwrap();
    json!({"key":entry.key,"content_sha256":entry.content_sha256,"profile":score_core::practice_source::CANONICAL_PROFILE,"choice":null,"runtime_policy":score_core::practice_source::CANONICAL_RUNTIME_POLICY})
}
pub fn selection(projected: &Value) -> Value {
    let parts: Vec<_> = projected["compilation"]["score"]["parts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|part| part["id"].clone())
        .collect();
    json!({"selected_part_ids":parts,"profile":{"kind":"piano","key_count":88,"lowest_midi":21}})
}
pub fn api(path: &str, request: &Value) -> Value {
    let response = practice_server::api_response(path, serde_json::to_vec(request).unwrap());
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    serde_json::from_slice(&response.body).unwrap()
}
pub fn vectors() -> Value {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let canonical_source = save_canonical(&library);
    let basic = save(&library, &basic_files(), score_core::basic_keys::PROFILE);
    let vsq = save(&library, &vsq_files(), score_core::vsq_clean::PROFILE);
    let mut vectors = serde_json::Map::new();
    for (name, source) in [
        ("canonical", canonical_source),
        ("basic", basic),
        ("vsq", vsq),
    ] {
        let zero = post(
            &library,
            PROJECT,
            &json!({"source":source,"configuration":configuration(0)}),
        );
        let plus2 = post(
            &library,
            PROJECT,
            &json!({"source":source,"configuration":configuration(2)}),
        );
        let mut opened = post(&library, "/api/library/load", &json!({"key":source["key"]}));
        opened["entry"]["saved_at_unix_ms"] = json!(1_700_000_000_000_u64);
        let loaded = library.load(source["key"].as_str().unwrap()).unwrap();
        let mut original = match loaded.clean_package {
            Some(package) => {
                json!({"score":serde_json::from_str::<Value>(&package.score_json).unwrap(),"runtime":package.runtime})
            }
            None => {
                json!({"score":serde_json::from_str::<Value>(loaded.score_json.as_deref().unwrap()).unwrap()})
            }
        };
        original["opened"] = opened;
        if source["profile"] == score_core::vsq_clean::PROFILE {
            original["choice_response"] = post(
                &library,
                "/api/library/runtime",
                &json!({"key":source["key"],"profile":source["profile"],"choice":"base_notes_instrumental"}),
            );
        }
        let assistance = post(
            &library,
            "/api/library/assistance/original",
            &json!({"source":source,"pitch_mod":configuration(2),"selection":selection(&plus2)}),
        );
        let progression = post(
            &library,
            "/api/library/progression/generate",
            &json!({"source":source,"pitch_mod":configuration(2),"selection":selection(&plus2),"layer":"single"}),
        );
        let fingering = if source["profile"] == score_core::vsq_clean::PROFILE {
            post(
                &library,
                "/api/library/fingering/piano",
                &json!({"source":{"key":source["key"],"content_sha256":source["content_sha256"],"profile":source["profile"],"choice":source["choice"]},"pitch_mod":configuration(2),"settings":{"part_id":plus2["compilation"]["score"]["parts"][0]["id"],"profile":{"kind":"piano","key_count":88,"lowest_midi":21}}}),
            )
        } else {
            Value::Null
        };
        vectors.insert(
            name.into(),
            json!({"original":original,"zero":zero,"plus2":plus2,"assistance":assistance,"progression":progression,"fingering":fingering}),
        );
        if source["profile"] == score_core::basic_keys::PROFILE {
            let page_source = json!({"key":source["key"],"content_sha256":source["content_sha256"],"profile":source["profile"]});
            let mut pages = serde_json::Map::new();
            for part in plus2["runtime"]["parts"].as_array().unwrap() {
                let settings = json!({"part_id":part["id"],"rendition_policy_id":score_core::basic_keys::RENDITION_POLICY,"display_meter":{"numerator":4,"denominator":4}});
                let request = json!({"source":page_source,"settings":settings});
                let original = post(&library, "/api/library/basic-keys/notation", &request);
                let zero = post(
                    &library,
                    "/api/library/basic-keys/notation",
                    &json!({"source":page_source,"settings":settings,"pitch_mod":configuration(0)}),
                );
                let plus2 = post(
                    &library,
                    "/api/library/basic-keys/notation",
                    &json!({"source":page_source,"settings":settings,"pitch_mod":configuration(2)}),
                );
                let role = if part["percussion"] == true {
                    "percussion"
                } else {
                    "melodic"
                };
                assert!(pages
                    .insert(
                        role.into(),
                        json!({"request":request,"original":original,"zero":zero,"plus2":plus2})
                    )
                    .is_none());
            }
            vectors.get_mut(name).unwrap()["notation"] = Value::Object(pages);
        }
    }
    let original = canonical();
    let zero = api(
        "/api/pitch-mod/project",
        &json!({"score":original,"configuration":configuration(0)}),
    );
    let plus2 = api(
        "/api/pitch-mod/project",
        &json!({"score":original,"configuration":configuration(2)}),
    );
    let assistance = api(
        "/api/practice-assistance/original",
        &json!({"score":original,"pitch_mod":configuration(2),"selection":selection(&plus2)}),
    );
    let progression = api(
        "/api/practice-progression/generate",
        &json!({"score":original,"pitch_mod":configuration(2),"selection":selection(&plus2),"layer":"single"}),
    );
    let fingering = api(
        "/api/pitch-mod/fingering/piano",
        &json!({"score":original,"configuration":configuration(2),"settings":{"part_id":original.parts[0].id,"profile":{"kind":"piano","key_count":88,"lowest_midi":21}}}),
    );
    vectors.insert("canonical_api".into(),json!({"original":{"score":original},"zero":zero,"plus2":plus2,"assistance":assistance,"progression":progression,"fingering":fingering}));
    // Tempo is a requested edit to the ORIGINAL canonical source. The effective
    // D4 score must never become the next projection's source, which would
    // compound the shift and hide an invalidated runtime proof.
    let mut tempo_original = canonical();
    tempo_original.tempo[0].bpm = 120.0;
    let zero = api(
        "/api/pitch-mod/project",
        &json!({"score":tempo_original,"configuration":configuration(0)}),
    );
    let plus2 = api(
        "/api/pitch-mod/project",
        &json!({"score":tempo_original,"configuration":configuration(2)}),
    );
    let assistance = api(
        "/api/practice-assistance/original",
        &json!({"score":tempo_original,"pitch_mod":configuration(2),"selection":selection(&plus2)}),
    );
    let progression = api(
        "/api/practice-progression/generate",
        &json!({"score":tempo_original,"pitch_mod":configuration(2),"selection":selection(&plus2),"layer":"single"}),
    );
    let fingering = api(
        "/api/pitch-mod/fingering/piano",
        &json!({"score":tempo_original,"configuration":configuration(2),"settings":{"part_id":tempo_original.parts[0].id,"profile":{"kind":"piano","key_count":88,"lowest_midi":21}}}),
    );
    vectors.get_mut("canonical_api").unwrap()["tempo120"] = json!({"original":{"score":tempo_original},"zero":zero,"plus2":plus2,"assistance":assistance,"progression":progression,"fingering":fingering});
    json!({"generator":"crates/desktop-shell/examples/generate_pitch_mod_fixtures.rs","vectors":vectors})
}
