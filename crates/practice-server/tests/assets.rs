// Exercise build-time asset security rules on both native CI platforms.
#[allow(dead_code)]
#[path = "../build.rs"]
mod asset_builder;

#[test]
fn exact_playback_clock_module_is_embedded_with_its_app_import() {
    let module = practice_server::asset("/playback-clock-view.js").unwrap();
    assert_eq!(
        module,
        include_bytes!("../../../web/playback-clock-view.js")
    );
    let app = std::str::from_utf8(practice_server::asset("/app.js").unwrap()).unwrap();
    assert!(app.contains("from './playback-clock-view.js'"));
}

#[test]
fn song_mod_and_sound_modules_are_embedded_with_exact_source_bytes() {
    for (path, bytes) in [
        (
            "/song-mod.js",
            include_bytes!("../../../web/song-mod.js").as_slice(),
        ),
        (
            "/song-mod-view.js",
            include_bytes!("../../../web/song-mod-view.js").as_slice(),
        ),
        (
            "/part-instrument-policy.js",
            include_bytes!("../../../web/part-instrument-policy.js").as_slice(),
        ),
        (
            "/canonical-audio-plan.js",
            include_bytes!("../../../web/canonical-audio-plan.js").as_slice(),
        ),
        (
            "/canonical-audio-core.js",
            include_bytes!("../../../web/canonical-audio-core.js").as_slice(),
        ),
        (
            "/basic-key-audio-plan.js",
            include_bytes!("../../../web/basic-key-audio-plan.js").as_slice(),
        ),
        (
            "/basic-key-audio-core.js",
            include_bytes!("../../../web/basic-key-audio-core.js").as_slice(),
        ),
        (
            "/vsq-audio-plan.js",
            include_bytes!("../../../web/vsq-audio-plan.js").as_slice(),
        ),
        (
            "/vsq-practice-player.js",
            include_bytes!("../../../web/vsq-practice-player.js").as_slice(),
        ),
    ] {
        assert_eq!(practice_server::asset(path).unwrap(), bytes, "{path}");
    }
    let app = std::str::from_utf8(practice_server::asset("/app.js").unwrap()).unwrap();
    assert!(app.contains("from './song-mod.js'"));
    assert!(app.contains("from './song-mod-view.js'"));
    let view = std::str::from_utf8(practice_server::asset("/song-mod-view.js").unwrap()).unwrap();
    assert!(view.contains("from './part-instrument-policy.js'"));
}

#[test]
fn skin_runtime_dependencies_are_embedded_with_exact_source_bytes() {
    for (path, bytes) in [
        (
            "/skin-format.js",
            include_bytes!("../../../web/skin-format.js").as_slice(),
        ),
        (
            "/skin-runtime.js",
            include_bytes!("../../../web/skin-runtime.js").as_slice(),
        ),
        (
            "/skin-settings.js",
            include_bytes!("../../../web/skin-settings.js").as_slice(),
        ),
        (
            "/skin-storage.js",
            include_bytes!("../../../web/skin-storage.js").as_slice(),
        ),
        (
            "/skin-settings.css",
            include_bytes!("../../../web/skin-settings.css").as_slice(),
        ),
    ] {
        assert_eq!(practice_server::asset(path).unwrap(), bytes, "{path}");
    }
    let app = std::str::from_utf8(practice_server::asset("/app.js").unwrap()).unwrap();
    assert!(app.contains("from './skin-runtime.js'"));
    assert!(app.contains("from './skin-settings.js'"));
    let html = std::str::from_utf8(practice_server::asset("/index.html").unwrap()).unwrap();
    assert!(html.contains("skin-settings.css"));
}
