use std::{path::PathBuf, sync::Arc, time::Duration};
use tauri::{
    webview::{DownloadEvent, NewWindowResponse, PermissionResponse},
    WebviewUrl, WebviewWindowBuilder,
};
use tokio::{sync::Semaphore, time::timeout};
use worldmusichub_desktop::{admission, allowed_uri, dispatch, error, operation_error, response};

pub fn run() {
    // This optional, process-owned path is used only by the bounded CI smoke.
    // It is never accepted from score content, a page, or a protocol argument.
    let evidence = std::env::var_os("WMH_DESKTOP_SMOKE_DIR").map(PathBuf::from);
    let acceptance = std::env::var("WMH_DESKTOP_ACCEPTANCE_PHASE")
        .ok()
        .map(|phase| {
            let directory = evidence
                .clone()
                .expect("Acceptance requires an evidence directory");
            Arc::new(
                worldmusichub_desktop::acceptance::Acceptance::new(directory, &phase)
                    .expect("Invalid acceptance configuration"),
            )
        });
    let protocol_acceptance = acceptance.clone();
    let report_directory = evidence.clone();
    let admitted = Arc::new(Semaphore::new(16));
    let computations = Arc::new(Semaphore::new(2));
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("wmh", move |context, request, responder| {
            if context.webview_label() != "main" {
                responder.respond(operation_error(
                    request.uri().path(),
                    403,
                    "forbidden_origin",
                    "Only the main app can request resources",
                ));
                return;
            }
            if let Some(reply) = admission(&request) {
                responder.respond(reply);
                return;
            }
            let trace = protocol_acceptance.clone();
            let trace_path = request.uri().path().to_owned();
            if let Some(acceptance) = &trace {
                acceptance.trace_request("received", &trace_path, None);
            }
            let respond = move |reply: http::Response<Vec<u8>>| {
                let status = reply.status().as_u16();
                responder.respond(reply);
                if let Some(acceptance) = &trace {
                    acceptance.trace_request("reply-submitted", &trace_path, Some(status));
                }
            };
            if let Some(acceptance) = &protocol_acceptance {
                if let Some(reply) = acceptance.handle(&request) {
                    respond(reply);
                    return;
                }
            }
            if request.uri().path() == "/__desktop_smoke/report" {
                let Some(directory) = &report_directory else {
                    respond(error(404, "Not found"));
                    return;
                };
                if request.method() != "POST" || request.body().len() > 64 * 1024 {
                    respond(error(400, "Invalid smoke report"));
                    return;
                }
                let Ok(value) = serde_json::from_slice::<serde_json::Value>(request.body()) else {
                    respond(error(400, "Invalid smoke report"));
                    return;
                };
                if value["version"] != 1 || !value["ok"].is_boolean() {
                    respond(error(400, "Invalid smoke report"));
                    return;
                }
                let name = protocol_acceptance
                    .as_ref()
                    .map(|acceptance| acceptance.report_name())
                    .unwrap_or_else(|| "renderer-report.json".into());
                let result = worldmusichub_desktop::acceptance::atomic_json(
                    directory,
                    &name,
                    request.body(),
                );
                respond(if result.is_ok() {
                    response(200, "application/json", b"{}".as_slice())
                } else {
                    error(500, "Cannot save smoke evidence")
                });
                return;
            }
            // Static bytes avoid the computation queue; no runtime paths are read.
            if request.method() == "GET" && !request.uri().path().starts_with("/api/") {
                respond(dispatch(request));
                return;
            }
            let operation_path = request.uri().path().to_owned();
            let Ok(admission_permit) = admitted.clone().try_acquire_owned() else {
                respond(operation_error(
                    &operation_path,
                    503,
                    "engine_busy",
                    "The local engine is busy; retry shortly",
                ));
                return;
            };
            let computations = computations.clone();
            tauri::async_runtime::spawn(async move {
                let Ok(Ok(computation_permit)) =
                    timeout(Duration::from_secs(2), computations.acquire_owned()).await
                else {
                    respond(operation_error(
                        &operation_path,
                        503,
                        "engine_busy",
                        "The local engine is busy; retry shortly",
                    ));
                    return;
                };
                let result = tauri::async_runtime::spawn_blocking(move || {
                    let _admission = admission_permit;
                    let _computation = computation_permit;
                    dispatch(request)
                })
                .await;
                respond(result.unwrap_or_else(|_| {
                    operation_error(
                        &operation_path,
                        500,
                        "engine_operation_failed",
                        "The score operation failed",
                    )
                }));
            });
        })
        .setup(move |app| {
            let mut builder = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::CustomProtocol("wmh://localhost/".parse()?),
            )
            .title("WorldMusicHub")
            .inner_size(1280.0, 900.0)
            .min_inner_size(900.0, 640.0)
            // Keep bottom transport controls inside the actual monitor work
            // area, including the title bar and taskbar, on initial launch.
            .prevent_overflow()
            .center()
            .use_https_scheme(true)
            .disable_drag_drop_handler()
            .devtools(false)
            .on_permission_request(|_, _| PermissionResponse::Deny)
            .on_new_window(|_, _| NewWindowResponse::Deny)
            .on_navigation(|url| url.as_str().parse().is_ok_and(|uri| allowed_uri(&uri)));
            if let Some(directory) = &evidence {
                std::fs::create_dir_all(directory)?;
                builder = builder.data_directory(directory.join("webview-profile"));
                if let Some(acceptance) = &acceptance {
                    builder = builder.initialization_script(acceptance.script());
                    let acceptance = acceptance.clone();
                    builder = builder.on_download(move |_, event| {
                        match event {
                            DownloadEvent::Requested { url, destination } => {
                                if !url.as_str().starts_with("blob:https://wmh.localhost/") {
                                    return false;
                                }
                                let name = destination
                                    .file_name()
                                    .and_then(|name| name.to_str())
                                    .unwrap_or("download.json");
                                let Some(path) = acceptance.download(name) else {
                                    return false;
                                };
                                *destination = path;
                            }
                            DownloadEvent::Finished { path, success, .. } => {
                                acceptance.downloaded(path.as_deref(), success)
                            }
                            _ => {}
                        }
                        true
                    });
                } else {
                    builder = builder.initialization_script(include_str!("../smoke.js"));
                }
            }
            builder.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("WorldMusicHub native shell failed to start");
}
