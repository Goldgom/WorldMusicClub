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
