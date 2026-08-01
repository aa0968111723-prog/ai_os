mod editors;
mod handoff;
mod menu;
mod models;

use handoff::{
    detect_editors, open_asset, resume_active_handoffs, reveal_asset, stop_handoff, HandoffState,
};
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

fn emit_deep_link(app: &tauri::AppHandle, raw: &str) {
    // 深度連結仍由前端 parseAiosDeepLink 做第二層路由 allowlist；原生層只接受固定 scheme/host。
    if !raw.starts_with("aios://open?") {
        return;
    }
    let _ = app.emit("aios:deep-link", raw.to_string());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // 必須是第一個 plugin：Windows/Linux 的 deep link 會啟動第二個程序，
        // single-instance 收到 argv 後轉送給既有主視窗。
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            for arg in argv {
                emit_deep_link(app, &arg);
            }
        }));
        // 記住主視窗大小／位置（寫入 app 資料目錄，不經 WebView）
        builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .manage(HandoffState::default())
        .invoke_handler(tauri::generate_handler![
            detect_editors,
            open_asset,
            reveal_asset,
            stop_handoff
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
                let menu = menu::build_menu(app)?;
                app.set_menu(menu)?;
                app.on_menu_event(|app, event| {
                    menu::handle_menu_event(app, event.id().as_ref());
                });
            }

            // macOS 及冷啟動：讀取已交給目前程序的 URL。
            if let Some(urls) = app.deep_link().get_current()? {
                for url in urls {
                    emit_deep_link(app.handle(), url.as_str());
                }
            }

            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    emit_deep_link(&handle, url.as_str());
                }
            });

            // 重啟後恢復仍在監看的交接（本機快取還在才恢復）
            resume_active_handoffs(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Aios desktop application");
}
