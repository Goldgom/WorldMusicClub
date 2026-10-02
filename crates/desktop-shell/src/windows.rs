use std::{path::PathBuf, sync::Arc, time::Duration};
use tauri::{
    webview::{NewWindowResponse, PermissionResponse},
    WebviewUrl, WebviewWindowBuilder,
};
use tokio::{sync::Semaphore, time::timeout};
use worldmusichub_desktop::{admission, allowed_uri, dispatch, error, response};

pub fn run() {
    // This optional, process-owned path is used only by the bounded CI smoke.
    // It is never accepted from score content, a page, or a protocol argument.
    let evidence = std::env::var_os("WMH_DESKTOP_SMOKE_DIR").map(PathBuf::from);
    let report_directory = evidence.clone();
    let admitted = Arc::new(Semaphore::new(16));
    let computations = Arc::new(Semaphore::new(2));
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("wmh", move |context, request, responder| {
            if context.webview_label() != "main" {
                responder.respond(error(403, "Only the main app can request resources"));
                return;
            }
            if let Some(reply) = admission(&request) {
                responder.respond(reply);
                return;
            }
            if request.uri().path() == "/__desktop_smoke/report" {
                let Some(directory) = &report_directory else {
                    responder.respond(error(404, "Not found"));
                    return;
                };
                if request.method() != "POST" || request.body().len() > 16 * 1024 {
                    responder.respond(error(400, "Invalid smoke report"));
                    return;
                }
                let Ok(value) = serde_json::from_slice::<serde_json::Value>(request.body()) else {
                    responder.respond(error(400, "Invalid smoke report"));
                    return;
                };
                if value["version"] != 1 || !value["ok"].is_boolean() {
                    responder.respond(error(400, "Invalid smoke report"));
                    return;
                }
                let result = std::fs::write(directory.join("renderer-report.tmp"), request.body())
                    .and_then(|()| {
                        std::fs::rename(
                            directory.join("renderer-report.tmp"),
                            directory.join("renderer-report.json"),
                        )
                    });
                responder.respond(if result.is_ok() {
                    response(200, "application/json", b"{}".as_slice())
                } else {
                    error(500, "Cannot save smoke evidence")
                });
                return;
            }
            // Static bytes avoid the computation queue; no runtime paths are read.
            if request.method() == "GET" && !request.uri().path().starts_with("/api/") {
                responder.respond(dispatch(request));
                return;
            }
            let Ok(admission_permit) = admitted.clone().try_acquire_owned() else {
                responder.respond(error(503, "The local engine is busy; retry shortly"));
                return;
            };
            let computations = computations.clone();
            tauri::async_runtime::spawn(async move {
                let Ok(Ok(computation_permit)) =
                    timeout(Duration::from_secs(2), computations.acquire_owned()).await
                else {
                    responder.respond(error(503, "The local engine is busy; retry shortly"));
                    return;
                };
                let result = tauri::async_runtime::spawn_blocking(move || {
                    let _admission = admission_permit;
                    let _computation = computation_permit;
                    dispatch(request)
                })
                .await;
                responder
                    .respond(result.unwrap_or_else(|_| error(500, "The score operation failed")));
            });
        })
        .setup(move |app| {
            let mut builder = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::CustomProtocol("wmh://localhost/".parse()?),
            )
            .title("WorldMusicHub · Desktop Proof")
            .inner_size(1280.0, 900.0)
            .min_inner_size(900.0, 640.0)
            .use_https_scheme(true)
            .disable_drag_drop_handler()
            .devtools(false)
            .on_permission_request(|_, _| PermissionResponse::Deny)
            .on_new_window(|_, _| NewWindowResponse::Deny)
            .on_navigation(|url| url.as_str().parse().is_ok_and(|uri| allowed_uri(&uri)));
            if let Some(directory) = &evidence {
                std::fs::create_dir_all(directory)?;
                builder = builder
                    .data_directory(directory.join("webview-profile"))
                    .initialization_script(include_str!("../smoke.js"));
            }
            builder.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("WorldMusicHub native shell failed to start");
}
