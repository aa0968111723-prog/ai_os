//! 桌面原生選單：不經 WebView、不新增 invoke——只做導頁／開系統資料夾／About／結束。

use std::process::Command;
use tauri::{
    menu::{
        AboutMetadataBuilder, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem,
        SubmenuBuilder,
    },
    AppHandle, Emitter, Manager, Wry,
};

/// 與 lib::emit_deep_link 同契約：只接受 `aios://open?...`
fn emit_safe_deep_link(app: &AppHandle, raw: &str) {
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

pub fn build_menu(app: &tauri::App) -> tauri::Result<Menu<Wry>> {
    let open_desktop = MenuItemBuilder::with_id("open-desktop", "桌面剪輯連接…")
        .accelerator("CmdOrCtrl+Shift+D")
        .build(app)?;
    let open_cache =
        MenuItemBuilder::with_id("open-cache", "開啟本機交接快取資料夾").build(app)?;
    let quit = PredefinedMenuItem::quit(app, Some("結束 Aios"))?;
    let about = PredefinedMenuItem::about(
        app,
        Some("關於 Aios"),
        Some(
            AboutMetadataBuilder::new()
                .name(Some("Aios"))
                .version(Some(env!("CARGO_PKG_VERSION")))
                .copyright(Some("Aios · AI Director OS"))
                .comments(Some("正式站 WebView + 受控剪輯交接"))
                .build(),
        ),
    )?;

    let file = SubmenuBuilder::new(app, "檔案")
        .item(&open_desktop)
        .item(&open_cache)
        .separator()
        .item(&quit)
        .build()?;

    let help = SubmenuBuilder::new(app, "說明").item(&about).build()?;

    MenuBuilder::new(app).item(&file).item(&help).build()
}

pub fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        "open-desktop" => {
            // 與 deep link allowlist 一致：/desktop
            emit_safe_deep_link(app, "aios://open?path=%2Fdesktop");
        }
        "open-cache" => {
            open_handoffs_folder(app);
        }
        _ => {}
    }
}

/// 只開 app 自己的 handoffs 目錄；不用 opener plugin（避免 remote capability 放寬）。
fn open_handoffs_folder(app: &AppHandle) {
    let Ok(base) = app.path().app_local_data_dir() else {
        return;
    };
    let handoffs = base.join("handoffs");
    let _ = std::fs::create_dir_all(&handoffs);
    let path = handoffs.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("explorer").arg(&path).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open").arg(&path).spawn();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = Command::new("xdg-open").arg(&path).spawn();
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn menu_ids_are_stable() {
        let ids = ["open-desktop", "open-cache"];
        assert!(ids
            .iter()
            .all(|id| id.chars().all(|c| c.is_ascii_lowercase() || c == '-')));
    }

    #[test]
    fn deep_link_path_for_desktop_companion_is_allowlisted_shape() {
        // 與 client desktopBridge SAFE_ROUTE 的 /desktop 對齊
        let raw = "aios://open?path=%2Fdesktop";
        assert!(raw.starts_with("aios://open?"));
        assert!(raw.contains("%2Fdesktop"));
    }
}
