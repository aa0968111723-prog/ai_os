use crate::{
    editors::{launch_editor, reveal_in_folder, select_editor},
    models::{
        DesktopBridgeResult, HandoffStatusEvent, OpenAssetRequest, RevealAssetRequest,
        RevisionUploadedEvent,
    },
};
use reqwest::{
    header::{COOKIE, CONTENT_LENGTH},
    multipart,
    redirect::Policy,
    Client,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, State, WebviewWindow};
use tokio::{fs, sync::RwLock, time::sleep};
use url::Url;
use uuid::Uuid;

const APP_ORIGIN: &str = "https://ai-os-app.zeabur.app";
const MAX_ASSET_BYTES: u64 = 200 * 1024 * 1024;
const WATCH_INTERVAL: Duration = Duration::from_secs(2);
const STABLE_FOR: Duration = Duration::from_secs(4);
const SAFE_ID_MIN: usize = 8;

#[derive(Clone)]
struct HandoffRecord {
    handoff_id: String,
    asset_id: String,
    project_id: Option<String>,
    editor_id: String,
    local_path: PathBuf,
    stopped: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct HandoffState {
    records: Arc<RwLock<HashMap<String, HandoffRecord>>>,
}

#[derive(Debug, Deserialize)]
struct UploadAssetResponse {
    ok: Option<bool>,
    asset: Option<UploadedAsset>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UploadedAsset {
    id: String,
    title: Option<String>,
}

fn valid_id(value: &str) -> bool {
    value.len() >= SAFE_ID_MIN
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn safe_filename(raw: Option<&str>, asset_id: &str) -> String {
    let fallback = format!("asset-{asset_id}.bin");
    let Some(raw) = raw else { return fallback };
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 180 {
        return fallback;
    }
    if trimmed.chars().any(|c| c.is_control() || matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|')) {
        return fallback;
    }
    trimmed.to_string()
}

async fn cookie_header(window: &WebviewWindow) -> Result<String, String> {
    // cookies_for_url 可讀到 HttpOnly session；此函式只從 async command／背景 task 呼叫，
    // 避免 Tauri 文件提到的 Windows 同步 handler deadlock。
    let url = Url::parse(APP_ORIGIN).map_err(|err| format!("正式站網址設定錯誤：{err}"))?;
    let cookies = window
        .cookies_for_url(url)
        .map_err(|err| format!("無法取得登入工作階段：{err}"))?;
    let value = cookies
        .iter()
        .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
        .collect::<Vec<_>>()
        .join("; ");
    if value.is_empty() {
        return Err("Aios 桌面版尚未登入，請先在主視窗完成登入".into());
    }
    Ok(value)
}

fn client() -> Result<Client, String> {
    Client::builder()
        .redirect(Policy::limited(2))
        .timeout(Duration::from_secs(90))
        .user_agent("AiosDesktop/0.1")
        .build()
        .map_err(|err| format!("無法初始化桌面下載器：{err}"))
}

async fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path)
        .await
        .map_err(|err| format!("讀取本機檔案失敗：{err}"))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn emit_status(app: &tauri::AppHandle, record: &HandoffRecord, phase: &str, message: impl Into<String>) {
    let _ = app.emit(
        "aios:desktop-handoff-status",
        HandoffStatusEvent {
            handoff_id: record.handoff_id.clone(),
            project_id: record.project_id.clone(),
            source_asset_id: Some(record.asset_id.clone()),
            phase: phase.to_string(),
            message: message.into(),
        },
    );
}

async fn download_asset(
    window: &WebviewWindow,
    asset_id: &str,
    target: &Path,
) -> Result<(), String> {
    let cookie = cookie_header(window).await?;
    let url = format!("{APP_ORIGIN}/api/assets/{asset_id}/file");
    let response = client()?
        .get(url)
        .header(COOKIE, cookie)
        .send()
        .await
        .map_err(|err| format!("下載素材失敗：{err}"))?;

    if response.status().as_u16() == 401 {
        return Err("登入已失效，請重新登入 Aios 桌面版".into());
    }
    if response.status().as_u16() == 403 {
        return Err("你沒有這個素材的下載權限".into());
    }
    if !response.status().is_success() {
        return Err(format!("下載素材失敗（HTTP {}）", response.status()));
    }

    if let Some(size) = response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
    {
        if size > MAX_ASSET_BYTES {
            return Err("素材超過桌面交接上限 200MB".into());
        }
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|err| format!("讀取素材內容失敗：{err}"))?;
    if bytes.len() as u64 > MAX_ASSET_BYTES {
        return Err("素材超過桌面交接上限 200MB".into());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|err| format!("建立本機快取資料夾失敗：{err}"))?;
    }
    fs::write(target, bytes)
        .await
        .map_err(|err| format!("寫入本機快取失敗：{err}"))
}

async fn upload_revision(
    app: &tauri::AppHandle,
    record: &HandoffRecord,
) -> Result<UploadedAsset, String> {
    let project_id = record
        .project_id
        .as_deref()
        .ok_or_else(|| "沒有 projectId，無法自動回傳成專案新版本".to_string())?;
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到 Aios 主視窗".to_string())?;
    let cookie = cookie_header(&window).await?;
    let metadata = fs::metadata(&record.local_path)
        .await
        .map_err(|err| format!("讀取編輯檔資訊失敗：{err}"))?;
    if metadata.len() > MAX_ASSET_BYTES {
        return Err("編輯後檔案超過回傳上限 200MB，請改用手動上傳或輸出較小版本".into());
    }

    let bytes = fs::read(&record.local_path)
        .await
        .map_err(|err| format!("讀取編輯後檔案失敗：{err}"))?;
    let file_name = record
        .local_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("desktop-revision.bin")
        .to_string();
    let mime = mime_guess::from_path(&record.local_path)
        .first_or_octet_stream()
        .to_string();
    let title = record
        .local_path
        .file_stem()
        .and_then(|n| n.to_str())
        .map(|stem| format!("{stem}（桌面編輯）"))
        .unwrap_or_else(|| "桌面編輯版本".into());

    let part = multipart::Part::bytes(bytes)
        .file_name(file_name)
        .mime_str(&mime)
        .map_err(|err| format!("建立上傳檔案失敗：{err}"))?;
    let form = multipart::Form::new()
        .text("projectId", project_id.to_string())
        .text("title", title)
        .text("sourceAssetId", record.asset_id.clone())
        .text("desktopHandoffId", record.handoff_id.clone())
        .text("editorId", record.editor_id.clone())
        .part("file", part);

    let response = client()?
        .post(format!("{APP_ORIGIN}/api/upload"))
        .header(COOKIE, cookie)
        .multipart(form)
        .send()
        .await
        .map_err(|err| format!("回傳 Aios 失敗：{err}"))?;
    let status = response.status();
    let body = response
        .json::<UploadAssetResponse>()
        .await
        .map_err(|err| format!("無法解析 Aios 回傳結果：{err}"))?;

    if !status.is_success() || body.ok == Some(false) {
        return Err(body
            .error
            .unwrap_or_else(|| format!("回傳 Aios 失敗（HTTP {status}）")));
    }
    body.asset.ok_or_else(|| "Aios 沒有回傳新素材資料".into())
}

fn start_watcher(app: tauri::AppHandle, record: HandoffRecord, initial_hash: String) {
    tauri::async_runtime::spawn(async move {
        let mut uploaded_hash = initial_hash;
        let mut candidate: Option<(String, Instant)> = None;

        emit_status(&app, &record, "watching", "正在監看編輯檔案；穩定儲存後會自動回傳新版本");

        loop {
            sleep(WATCH_INTERVAL).await;
            if record.stopped.load(Ordering::Relaxed) {
                emit_status(&app, &record, "stopped", "已停止監看這次桌面交接");
                break;
            }

            let current_hash = match sha256_file(&record.local_path).await {
                Ok(hash) => hash,
                Err(message) => {
                    emit_status(&app, &record, "error", message);
                    continue;
                }
            };

            if current_hash == uploaded_hash {
                candidate = None;
                continue;
            }

            let stable = match &candidate {
                Some((hash, since)) if hash == &current_hash => since.elapsed() >= STABLE_FOR,
                _ => {
                    candidate = Some((current_hash.clone(), Instant::now()));
                    false
                }
            };
            if !stable {
                continue;
            }

            emit_status(&app, &record, "uploading", "偵測到已儲存的修改，正在上傳為新版本…");
            match upload_revision(&app, &record).await {
                Ok(asset) => {
                    uploaded_hash = current_hash;
                    candidate = None;
                    emit_status(&app, &record, "uploaded", "已回傳 Aios，原始素材仍保留");
                    if let Some(project_id) = record.project_id.clone() {
                        let _ = app.emit(
                            "aios:asset-revision-uploaded",
                            RevisionUploadedEvent {
                                handoff_id: record.handoff_id.clone(),
                                project_id,
                                source_asset_id: record.asset_id.clone(),
                                uploaded_asset_id: Some(asset.id),
                                editor_id: Some(record.editor_id.clone()),
                                title: asset.title,
                            },
                        );
                    }
                }
                Err(message) => {
                    // 保留 candidate；下一輪仍是同一 hash 時會重試，網路恢復後可自癒。
                    emit_status(&app, &record, "error", format!("自動回傳失敗：{message}"));
                    sleep(Duration::from_secs(8)).await;
                }
            }
        }
    });
}

#[tauri::command]
pub async fn detect_editors() -> Vec<crate::models::DetectedEditor> {
    crate::editors::detect_editors()
        .into_iter()
        .filter(|editor| editor.installed)
        .collect()
}

#[tauri::command]
pub async fn open_asset(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: State<'_, HandoffState>,
    request: OpenAssetRequest,
) -> DesktopBridgeResult {
    if !valid_id(&request.asset_id)
        || request.project_id.as_deref().is_some_and(|id| !valid_id(id))
        || request.editor_id.as_deref().is_some_and(|id| {
            id.len() < 2
                || id.len() > 64
                || !id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
    {
        return DesktopBridgeResult::failure("invalid-request", "資產、專案或剪輯軟體識別碼格式不正確");
    }

    let Some(editor) = select_editor(request.editor_id.as_deref(), &request.editor_kind) else {
        return DesktopBridgeResult::failure("editor-not-found", "找不到符合用途的已安裝剪輯軟體");
    };

    let handoff_id = Uuid::new_v4().to_string();
    let file_name = safe_filename(request.suggested_name.as_deref(), &request.asset_id);
    let root = match app.path().app_local_data_dir() {
        Ok(path) => path.join("handoffs").join(&handoff_id),
        Err(err) => return DesktopBridgeResult::failure("download-failed", format!("找不到桌面資料目錄：{err}")),
    };
    let local_path = root.join(file_name);

    let placeholder = HandoffRecord {
        handoff_id: handoff_id.clone(),
        asset_id: request.asset_id.clone(),
        project_id: request.project_id.clone(),
        editor_id: editor.id.clone(),
        local_path: local_path.clone(),
        stopped: Arc::new(AtomicBool::new(false)),
    };
    emit_status(&app, &placeholder, "downloaded", "正在下載素材到 Aios 管理的本機快取…");

    if let Err(message) = download_asset(&window, &request.asset_id, &local_path).await {
        return DesktopBridgeResult::failure("download-failed", message);
    }
    let initial_hash = match sha256_file(&local_path).await {
        Ok(hash) => hash,
        Err(message) => return DesktopBridgeResult::failure("download-failed", message),
    };
    if let Err(message) = launch_editor(&editor, &local_path) {
        return DesktopBridgeResult::failure("launch-failed", message);
    }

    emit_status(&app, &placeholder, "launched", format!("已用 {} 開啟", editor.name));
    state.records.write().await.insert(handoff_id.clone(), placeholder.clone());
    if placeholder.project_id.is_some() {
        start_watcher(app, placeholder.clone(), initial_hash);
    }

    DesktopBridgeResult::success(
        Some(handoff_id),
        local_path.file_name().and_then(|n| n.to_str()).map(str::to_string),
    )
}

#[tauri::command]
pub async fn reveal_asset(
    state: State<'_, HandoffState>,
    request: RevealAssetRequest,
) -> DesktopBridgeResult {
    if !valid_id(&request.asset_id) || request.project_id.as_deref().is_some_and(|id| !valid_id(id)) {
        return DesktopBridgeResult::failure("invalid-request", "資產或專案識別碼格式不正確");
    }
    let records = state.records.read().await;
    let Some(record) = records.values().rev().find(|record| {
        record.asset_id == request.asset_id
            && request.project_id.as_deref().is_none_or(|id| record.project_id.as_deref() == Some(id))
    }) else {
        return DesktopBridgeResult::failure("download-failed", "這個素材尚未交接到本機；請先選擇剪輯軟體開啟");
    };
    match reveal_in_folder(&record.local_path) {
        Ok(()) => DesktopBridgeResult::success(Some(record.handoff_id.clone()), record.local_path.file_name().and_then(|n| n.to_str()).map(str::to_string)),
        Err(message) => DesktopBridgeResult::failure("launch-failed", message),
    }
}

#[tauri::command]
pub async fn stop_handoff(
    state: State<'_, HandoffState>,
    handoff_id: String,
) -> DesktopBridgeResult {
    if !valid_id(&handoff_id) {
        return DesktopBridgeResult::failure("invalid-request", "交接識別碼格式不正確");
    }
    let mut records = state.records.write().await;
    let Some(record) = records.remove(&handoff_id) else {
        return DesktopBridgeResult::failure("invalid-request", "找不到這次桌面交接");
    };
    record.stopped.store(true, Ordering::Relaxed);
    DesktopBridgeResult::success(Some(handoff_id), None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filename_is_sanitized() {
        assert_eq!(safe_filename(Some("edited.mp4"), "asset_1234"), "edited.mp4");
        assert_eq!(safe_filename(Some("../../evil.exe"), "asset_1234"), "asset-asset_1234.bin");
    }

    #[test]
    fn ids_are_restricted() {
        assert!(valid_id("01234567-89ab-cdef-0123-456789abcdef"));
        assert!(!valid_id("../secret"));
        assert!(!valid_id("tiny"));
    }
}
