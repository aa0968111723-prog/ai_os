use crate::{editors::reveal_in_folder, models::DesktopBridgeResult};
use futures_util::StreamExt;
use reqwest::{
    header::{CONTENT_LENGTH, COOKIE},
    redirect::Policy,
    Client,
};
use serde::Deserialize;
use std::{path::{Path, PathBuf}, time::Duration};
use tauri::{Manager, WebviewWindow};
use tokio::{fs, io::AsyncWriteExt};
use url::Url;

const APP_ORIGIN: &str = "https://ai-os-app.zeabur.app";
const MAX_PACKAGE_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(1_800);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterializeEditingPackageRequest {
    pub package_id: String,
    pub editing_session_id: String,
    pub file_name: String,
}

fn valid_id(value: &str) -> bool {
    (8..=128).contains(&value.len())
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn safe_zip_name(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty()
        || trimmed.len() > 180
        || !trimmed.to_ascii_lowercase().ends_with(".zip")
        || trimmed.chars().any(|character| {
            character.is_control()
                || matches!(character, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
    {
        return None;
    }
    Some(trimmed.to_string())
}

fn packages_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("editing-packages"))
        .map_err(|error| format!("找不到桌面資料目錄：{error}"))
}

async fn cookie_header(window: &WebviewWindow) -> Result<String, String> {
    let url = Url::parse(APP_ORIGIN).map_err(|error| format!("正式站網址設定錯誤：{error}"))?;
    let cookies = window
        .cookies_for_url(url)
        .map_err(|error| format!("無法取得登入工作階段：{error}"))?;
    let header = cookies
        .iter()
        .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
        .collect::<Vec<_>>()
        .join("; ");
    if header.is_empty() {
        return Err("Aios 桌面版尚未登入，請先在主視窗完成登入".into());
    }
    Ok(header)
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .redirect(Policy::limited(2))
        .timeout(DOWNLOAD_TIMEOUT)
        .user_agent("AiosDesktop/0.1")
        .build()
        .map_err(|error| format!("無法初始化桌面連線：{error}"))
}

async fn download_package(window: &WebviewWindow, package_id: &str, target: &Path) -> Result<(), String> {
    let response = http_client()?
        .get(format!("{APP_ORIGIN}/api/editing-packages/{package_id}/download"))
        .header(COOKIE, cookie_header(window).await?)
        .send()
        .await
        .map_err(|error| format!("下載交接包失敗：{error}"))?;

    match response.status().as_u16() {
        401 => return Err("登入已失效，請重新登入 Aios 桌面版".into()),
        403 => return Err("你沒有這個交接包的下載權限".into()),
        404 => return Err("找不到交接包".into()),
        410 => return Err("交接包已過期或撤銷，請先在 Aios 重新準備".into()),
        _ => {}
    }
    if !response.status().is_success() {
        return Err(format!("下載交接包失敗（HTTP {}）", response.status()));
    }
    if response.headers().get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .is_some_and(|size| size > MAX_PACKAGE_BYTES)
    {
        return Err("交接包超過桌面下載上限 4GB".into());
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).await
            .map_err(|error| format!("建立本機交接資料夾失敗：{error}"))?;
    }
    let mut file = fs::File::create(target).await
        .map_err(|error| format!("建立本機交接包失敗：{error}"))?;
    let mut stream = response.bytes_stream();
    let mut written = 0_u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("讀取交接包失敗：{error}"))?;
        written = written.saturating_add(chunk.len() as u64);
        if written > MAX_PACKAGE_BYTES {
            drop(file);
            let _ = fs::remove_file(target).await;
            return Err("交接包超過桌面下載上限 4GB".into());
        }
        file.write_all(&chunk).await
            .map_err(|error| format!("寫入本機交接包失敗：{error}"))?;
    }
    file.flush().await.map_err(|error| format!("寫入本機交接包失敗：{error}"))?;
    Ok(())
}

/// Download a server-authorized ZIP into Aios-owned local storage and reveal it.
/// The renderer cannot supply a URL or an arbitrary local path.
#[tauri::command(rename_all = "camelCase")]
pub async fn materialize_editing_package(
    app: tauri::AppHandle,
    window: WebviewWindow,
    request: MaterializeEditingPackageRequest,
) -> DesktopBridgeResult {
    if !valid_id(&request.package_id) || !valid_id(&request.editing_session_id) {
        return DesktopBridgeResult::failure("invalid-request", "交接包或工作階段識別碼格式不正確");
    }
    let Some(file_name) = safe_zip_name(&request.file_name) else {
        return DesktopBridgeResult::failure("invalid-request", "交接包檔名格式不正確");
    };
    let target = match packages_root(&app) {
        Ok(root) => root.join(&request.editing_session_id).join(&file_name),
        Err(message) => return DesktopBridgeResult::failure("download-failed", message),
    };
    let partial = target.with_extension("zip.part");
    if let Err(message) = download_package(&window, &request.package_id, &partial).await {
        let _ = fs::remove_file(&partial).await;
        return DesktopBridgeResult::failure("download-failed", message);
    }
    if fs::try_exists(&target).await.unwrap_or(false) {
        if let Err(error) = fs::remove_file(&target).await {
            let _ = fs::remove_file(&partial).await;
            return DesktopBridgeResult::failure("download-failed", format!("無法更新舊交接包：{error}"));
        }
    }
    if let Err(error) = fs::rename(&partial, &target).await {
        let _ = fs::remove_file(&partial).await;
        return DesktopBridgeResult::failure("download-failed", format!("完成交接包下載失敗：{error}"));
    }
    match reveal_in_folder(&target) {
        Ok(()) => DesktopBridgeResult::success(Some(request.editing_session_id), Some(file_name)),
        Err(message) => DesktopBridgeResult::failure("launch-failed", message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_safe_zip_names() {
        assert_eq!(safe_zip_name("Aios_Project.zip"), Some("Aios_Project.zip".into()));
        assert_eq!(safe_zip_name("../project.zip"), None);
        assert_eq!(safe_zip_name("project.mov"), None);
    }
}
