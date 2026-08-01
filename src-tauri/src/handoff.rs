use crate::{
    editors::{launch_editor, reveal_in_folder, select_editor},
    models::{
        DesktopBridgeResult, HandoffStatusEvent, OpenAssetRequest, RevealAssetRequest,
        RevisionUploadedEvent,
    },
};
use futures_util::StreamExt;
use reqwest::{
    header::{CONTENT_LENGTH, COOKIE},
    multipart,
    redirect::Policy,
    Client,
};
use serde::{Deserialize, Serialize};
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
use tauri::{Emitter, Manager, WebviewWindow};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncWriteExt},
    sync::RwLock,
    time::sleep,
};
use url::Url;
use uuid::Uuid;

const APP_ORIGIN: &str = "https://ai-os-app.zeabur.app";
const MAX_ASSET_BYTES: u64 = 200 * 1024 * 1024;
const WATCH_INTERVAL: Duration = Duration::from_secs(2);
const STABLE_FOR: Duration = Duration::from_secs(4);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(600);
const INDEX_FILE: &str = "active.json";

#[derive(Clone)]
struct HandoffRecord {
    handoff_id: String,
    asset_id: String,
    project_id: Option<String>,
    editor_id: String,
    local_path: PathBuf,
    stopped: Arc<AtomicBool>,
}

/// 寫入 disk 的交接索引（重啟後恢復監看用）。路徑只允許 app handoffs 目錄下。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PersistedHandoff {
    handoff_id: String,
    asset_id: String,
    project_id: Option<String>,
    editor_id: String,
    /// 相對於 handoffs 根：`{handoffId}/{fileName}`
    rel_path: String,
    /// 上次已上傳（或初始下載）的內容 hash；恢復監看用
    last_hash: Option<String>,
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
    (8..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn optional_valid_id(value: Option<&str>) -> bool {
    value.map(valid_id).unwrap_or(true)
}

fn valid_editor_id(value: Option<&str>) -> bool {
    value
        .map(|value| {
            (2..=64).contains(&value.len())
                && value.bytes().all(|byte| {
                    byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-'
                })
        })
        .unwrap_or(true)
}

fn safe_filename(raw: Option<&str>, asset_id: &str) -> String {
    let fallback = format!("asset-{asset_id}.bin");
    let Some(raw) = raw else { return fallback };
    let trimmed = raw.trim();
    if trimmed.is_empty()
        || trimmed.len() > 180
        || trimmed.chars().any(|character| {
            character.is_control()
                || matches!(character, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
    {
        return fallback;
    }
    trimmed.to_string()
}

/// 只允許 `handoffId/fileName`（無 `..`、無絕對路徑）
fn sanitize_rel_path(rel: &str) -> Option<String> {
    let rel = rel.replace('\\', "/");
    if rel.is_empty() || rel.starts_with('/') || rel.contains("..") {
        return None;
    }
    let mut parts = rel.split('/');
    let id = parts.next()?;
    let name = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    if !valid_id(id) {
        return None;
    }
    if name.is_empty()
        || name.len() > 180
        || name.chars().any(|c| {
            c.is_control() || matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
    {
        return None;
    }
    Some(format!("{id}/{name}"))
}

fn handoffs_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|p| p.join("handoffs"))
        .map_err(|error| format!("找不到桌面資料目錄：{error}"))
}

fn index_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(handoffs_root(app)?.join(INDEX_FILE))
}

async fn load_persisted(app: &tauri::AppHandle) -> Vec<PersistedHandoff> {
    let Ok(path) = index_path(app) else {
        return Vec::new();
    };
    let Ok(bytes) = fs::read(&path).await else {
        return Vec::new();
    };
    serde_json::from_slice::<Vec<PersistedHandoff>>(&bytes)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|entry| {
            let rel = sanitize_rel_path(&entry.rel_path)?;
            if !valid_id(&entry.handoff_id) || !valid_id(&entry.asset_id) {
                return None;
            }
            if !valid_editor_id(Some(&entry.editor_id)) {
                return None;
            }
            if !optional_valid_id(entry.project_id.as_deref()) {
                return None;
            }
            Some(PersistedHandoff {
                rel_path: rel,
                ..entry
            })
        })
        .collect()
}

async fn save_persisted(app: &tauri::AppHandle, entries: &[PersistedHandoff]) {
    let Ok(path) = index_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent).await;
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(entries) {
        let _ = fs::write(path, bytes).await;
    }
}

async fn upsert_persisted(app: &tauri::AppHandle, entry: PersistedHandoff) {
    let mut list = load_persisted(app).await;
    list.retain(|e| e.handoff_id != entry.handoff_id);
    list.push(entry);
    save_persisted(app, &list).await;
}

async fn remove_persisted(app: &tauri::AppHandle, handoff_id: &str) {
    let mut list = load_persisted(app).await;
    let before = list.len();
    list.retain(|e| e.handoff_id != handoff_id);
    if list.len() != before {
        save_persisted(app, &list).await;
    }
}

fn record_to_persisted(record: &HandoffRecord, last_hash: Option<String>) -> Option<PersistedHandoff> {
    let file_name = record.local_path.file_name()?.to_str()?;
    let rel = format!("{}/{}", record.handoff_id, file_name);
    let rel = sanitize_rel_path(&rel)?;
    Some(PersistedHandoff {
        handoff_id: record.handoff_id.clone(),
        asset_id: record.asset_id.clone(),
        project_id: record.project_id.clone(),
        editor_id: record.editor_id.clone(),
        rel_path: rel,
        last_hash,
    })
}

async fn cookie_header(window: &WebviewWindow) -> Result<String, String> {
    // cookies_for_url 會包含 HttpOnly session。只從 async command／背景 task 呼叫，
    // 避免 Tauri 文件所述的 Windows 同步 handler deadlock。
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

/// 串流讀檔算 hash，避免大檔整包進記憶體。
async fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path)
        .await
        .map_err(|error| format!("讀取本機檔案失敗：{error}"))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file
            .read(&mut buf)
            .await
            .map_err(|error| format!("讀取本機檔案失敗：{error}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn emit_status(
    app: &tauri::AppHandle,
    record: &HandoffRecord,
    phase: &str,
    message: impl Into<String>,
) {
    emit_status_pct(app, record, phase, message, None);
}

fn emit_status_pct(
    app: &tauri::AppHandle,
    record: &HandoffRecord,
    phase: &str,
    message: impl Into<String>,
    percent: Option<u8>,
) {
    let _ = app.emit(
        "aios:desktop-handoff-status",
        HandoffStatusEvent::new(
            record.handoff_id.clone(),
            record.project_id.clone(),
            Some(record.asset_id.clone()),
            phase,
            message,
            percent,
        ),
    );
}

/// 串流下載到磁碟，並依 Content-Length 回報 percent（0–99，完成由呼叫端發 100）。
async fn download_asset(
    app: &tauri::AppHandle,
    window: &WebviewWindow,
    record: &HandoffRecord,
    asset_id: &str,
    target: &Path,
) -> Result<(), String> {
    let response = http_client()?
        .get(format!("{APP_ORIGIN}/api/assets/{asset_id}/file"))
        .header(COOKIE, cookie_header(window).await?)
        .send()
        .await
        .map_err(|error| format!("下載素材失敗：{error}"))?;

    match response.status().as_u16() {
        401 => return Err("登入已失效，請重新登入 Aios 桌面版".into()),
        403 => return Err("你沒有這個素材的下載權限".into()),
        _ => {}
    }
    if !response.status().is_success() {
        return Err(format!("下載素材失敗（HTTP {}）", response.status()));
    }
    let total = response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    if total.is_some_and(|size| size > MAX_ASSET_BYTES) {
        return Err("素材超過桌面交接上限 200MB".into());
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|error| format!("建立本機快取資料夾失敗：{error}"))?;
    }
    let mut file = fs::File::create(target)
        .await
        .map_err(|error| format!("寫入本機快取失敗：{error}"))?;

    let mut stream = response.bytes_stream();
    let mut written: u64 = 0;
    let mut last_pct: u8 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("讀取素材內容失敗：{error}"))?;
        written = written.saturating_add(chunk.len() as u64);
        if written > MAX_ASSET_BYTES {
            let _ = fs::remove_file(target).await;
            return Err("素材超過桌面交接上限 200MB".into());
        }
        file.write_all(&chunk)
            .await
            .map_err(|error| format!("寫入本機快取失敗：{error}"))?;
        if let Some(total) = total.filter(|t| *t > 0) {
            let pct = ((written.saturating_mul(100)) / total).min(99) as u8;
            if pct >= last_pct.saturating_add(5) || pct == 99 {
                last_pct = pct;
                emit_status_pct(
                    app,
                    record,
                    "downloading",
                    format!("下載中… {pct}%"),
                    Some(pct),
                );
            }
        }
    }
    file.flush()
        .await
        .map_err(|error| format!("寫入本機快取失敗：{error}"))?;
    Ok(())
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
    let metadata = fs::metadata(&record.local_path)
        .await
        .map_err(|error| format!("讀取編輯檔資訊失敗：{error}"))?;
    if metadata.len() > MAX_ASSET_BYTES {
        return Err("編輯後檔案超過回傳上限 200MB，請改用手動上傳或輸出較小版本".into());
    }

    // 仍一次讀入（上限 200MB）；hash 已改串流。multipart 需要完整 body。
    let bytes = fs::read(&record.local_path)
        .await
        .map_err(|error| format!("讀取編輯後檔案失敗：{error}"))?;
    let file_name = record
        .local_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("desktop-revision.bin")
        .to_string();
    let mime = mime_guess::from_path(&record.local_path)
        .first_or_octet_stream()
        .to_string();
    let title = record
        .local_path
        .file_stem()
        .and_then(|name| name.to_str())
        .map(|stem| format!("{stem}（桌面編輯）"))
        .unwrap_or_else(|| "桌面編輯版本".into());

    let file_part = multipart::Part::bytes(bytes)
        .file_name(file_name)
        .mime_str(&mime)
        .map_err(|error| format!("建立上傳檔案失敗：{error}"))?;
    let form = multipart::Form::new()
        .text("projectId", project_id.to_string())
        .text("title", title)
        .text("sourceAssetId", record.asset_id.clone())
        .text("desktopHandoffId", record.handoff_id.clone())
        .text("editorId", record.editor_id.clone())
        .part("file", file_part);

    emit_status_pct(
        app,
        record,
        "uploading",
        "正在上傳為新素材版本…",
        Some(30),
    );

    let response = http_client()?
        .post(format!("{APP_ORIGIN}/api/upload"))
        .header(COOKIE, cookie_header(&window).await?)
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("回傳 Aios 失敗：{error}"))?;
    let status = response.status();
    let body = response
        .json::<UploadAssetResponse>()
        .await
        .map_err(|error| format!("無法解析 Aios 回傳結果：{error}"))?;
    if !status.is_success() || body.ok == Some(false) {
        return Err(body
            .error
            .unwrap_or_else(|| format!("回傳 Aios 失敗（HTTP {status}）")));
    }
    body.asset
        .ok_or_else(|| "Aios 沒有回傳新素材資料".to_string())
}

fn start_watcher(app: tauri::AppHandle, record: HandoffRecord, initial_hash: String) {
    tauri::async_runtime::spawn(async move {
        let mut uploaded_hash = initial_hash;
        let mut candidate: Option<(String, Instant)> = None;
        emit_status(
            &app,
            &record,
            "watching",
            "正在監看編輯檔案；穩定儲存後會自動回傳新版本",
        );

        loop {
            sleep(WATCH_INTERVAL).await;
            if record.stopped.load(Ordering::Relaxed) {
                emit_status(&app, &record, "stopped", "已停止監看這次桌面交接");
                remove_persisted(&app, &record.handoff_id).await;
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

            emit_status_pct(
                &app,
                &record,
                "uploading",
                "偵測到已儲存的修改，正在上傳為新素材版本…",
                Some(0),
            );
            match upload_revision(&app, &record).await {
                Ok(asset) => {
                    uploaded_hash = current_hash.clone();
                    candidate = None;
                    if let Some(entry) = record_to_persisted(&record, Some(current_hash.clone())) {
                        upsert_persisted(&app, entry).await;
                    }
                    emit_status_pct(
                        &app,
                        &record,
                        "uploaded",
                        "已回傳 Aios，原始素材仍保留",
                        Some(100),
                    );
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
                    emit_status(
                        &app,
                        &record,
                        "error",
                        format!("自動回傳失敗：{message}"),
                    );
                    sleep(Duration::from_secs(8)).await;
                }
            }
        }
    });
}

/// 啟動時從 disk 恢復仍在監看的交接（本機檔還在才恢復）。
pub fn resume_active_handoffs(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let root = match handoffs_root(&app) {
            Ok(p) => p,
            Err(_) => return,
        };
        let entries = load_persisted(&app).await;
        if entries.is_empty() {
            return;
        }
        let mut still_active = Vec::new();
        for entry in entries {
            let local_path = root.join(&entry.rel_path);
            if !local_path.is_file() {
                continue;
            }
            let hash = match entry.last_hash.clone() {
                Some(h) if !h.is_empty() => h,
                _ => match sha256_file(&local_path).await {
                    Ok(h) => h,
                    Err(_) => continue,
                },
            };
            let record = HandoffRecord {
                handoff_id: entry.handoff_id.clone(),
                asset_id: entry.asset_id.clone(),
                project_id: entry.project_id.clone(),
                editor_id: entry.editor_id.clone(),
                local_path: local_path.clone(),
                stopped: Arc::new(AtomicBool::new(false)),
            };
            if record.project_id.is_none() {
                still_active.push(entry);
                continue;
            }
            {
                let mut map = app.state::<HandoffState>().records.write().await;
                map.insert(record.handoff_id.clone(), record.clone());
            }
            still_active.push(PersistedHandoff {
                last_hash: Some(hash.clone()),
                ..entry
            });
            emit_status(
                &app,
                &record,
                "watching",
                "已恢復上次桌面交接監看（重啟後繼續）",
            );
            start_watcher(app.clone(), record, hash);
        }
        save_persisted(&app, &still_active).await;
    });
}

#[tauri::command(rename_all = "camelCase")]
pub async fn detect_editors() -> Vec<crate::models::DetectedEditor> {
    crate::editors::detect_editors()
        .into_iter()
        .filter(|editor| editor.installed)
        .collect()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_asset(
    app: tauri::AppHandle,
    window: WebviewWindow,
    request: OpenAssetRequest,
) -> DesktopBridgeResult {
    if !valid_id(&request.asset_id)
        || !optional_valid_id(request.project_id.as_deref())
        || !valid_editor_id(request.editor_id.as_deref())
    {
        return DesktopBridgeResult::failure(
            "invalid-request",
            "資產、專案或剪輯軟體識別碼格式不正確",
        );
    }

    let Some(editor) = select_editor(request.editor_id.as_deref(), &request.editor_kind) else {
        return DesktopBridgeResult::failure(
            "editor-not-found",
            "找不到符合用途的已安裝剪輯軟體",
        );
    };

    let handoff_id = Uuid::new_v4().to_string();
    let file_name = safe_filename(request.suggested_name.as_deref(), &request.asset_id);
    let root = match handoffs_root(&app) {
        Ok(path) => path.join(&handoff_id),
        Err(message) => return DesktopBridgeResult::failure("download-failed", message),
    };
    let local_path = root.join(&file_name);
    let record = HandoffRecord {
        handoff_id: handoff_id.clone(),
        asset_id: request.asset_id.clone(),
        project_id: request.project_id.clone(),
        editor_id: editor.id.clone(),
        local_path: local_path.clone(),
        stopped: Arc::new(AtomicBool::new(false)),
    };

    emit_status_pct(
        &app,
        &record,
        "downloading",
        "正在下載素材到 Aios 管理的本機快取…",
        Some(0),
    );
    if let Err(message) =
        download_asset(&app, &window, &record, &request.asset_id, &local_path).await
    {
        emit_status_pct(&app, &record, "error", message.clone(), None);
        return DesktopBridgeResult::failure("download-failed", message);
    }
    emit_status_pct(
        &app,
        &record,
        "downloaded",
        "素材已寫入本機快取，正在啟動軟體…",
        Some(100),
    );
    let initial_hash = match sha256_file(&local_path).await {
        Ok(hash) => hash,
        Err(message) => {
            emit_status_pct(&app, &record, "error", message.clone(), None);
            return DesktopBridgeResult::failure("download-failed", message);
        }
    };
    if let Err(message) = launch_editor(&editor, &local_path) {
        emit_status_pct(&app, &record, "error", message.clone(), None);
        return DesktopBridgeResult::failure("launch-failed", message);
    }

    emit_status_pct(
        &app,
        &record,
        "launched",
        format!("已用 {} 開啟", editor.name),
        Some(100),
    );
    app.state::<HandoffState>()
        .records
        .write()
        .await
        .insert(handoff_id.clone(), record.clone());

    if let Some(entry) = record_to_persisted(&record, Some(initial_hash.clone())) {
        upsert_persisted(&app, entry).await;
    }

    if record.project_id.is_some() {
        start_watcher(app, record, initial_hash);
    }

    DesktopBridgeResult::success(
        Some(handoff_id),
        local_path
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::to_string),
    )
}

#[tauri::command(rename_all = "camelCase")]
pub async fn reveal_asset(
    app: tauri::AppHandle,
    request: RevealAssetRequest,
) -> DesktopBridgeResult {
    if !valid_id(&request.asset_id) || !optional_valid_id(request.project_id.as_deref()) {
        return DesktopBridgeResult::failure(
            "invalid-request",
            "資產或專案識別碼格式不正確",
        );
    }
    let state = app.state::<HandoffState>();
    let mem = {
        let records = state.records.read().await;
        records.values().find(|record| {
            let project_matches = request
                .project_id
                .as_deref()
                .map(|project_id| record.project_id.as_deref() == Some(project_id))
                .unwrap_or(true);
            record.asset_id == request.asset_id && project_matches
        }).map(|r| (r.handoff_id.clone(), r.local_path.clone()))
    };

    // 記憶體沒有時查 disk 索引（重啟後尚未恢復或僅下載未監看）
    let (handoff_id, path) = if let Some(pair) = mem {
        pair
    } else {
        let root = handoffs_root(&app).ok();
        let entries = load_persisted(&app).await;
        let found = entries.into_iter().find_map(|e| {
            let project_matches = request
                .project_id
                .as_deref()
                .map(|project_id| e.project_id.as_deref() == Some(project_id))
                .unwrap_or(true);
            if e.asset_id == request.asset_id && project_matches {
                let path = root.as_ref()?.join(&e.rel_path);
                if path.is_file() {
                    return Some((e.handoff_id, path));
                }
            }
            None
        });
        match found {
            Some(pair) => pair,
            None => {
                return DesktopBridgeResult::failure(
                    "download-failed",
                    "這個素材尚未交接到本機；請先選擇剪輯軟體開啟",
                );
            }
        }
    };

    match reveal_in_folder(&path) {
        Ok(()) => DesktopBridgeResult::success(
            Some(handoff_id),
            path.file_name()
                .and_then(|name| name.to_str())
                .map(str::to_string),
        ),
        Err(message) => DesktopBridgeResult::failure("launch-failed", message),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn stop_handoff(
    app: tauri::AppHandle,
    handoff_id: String,
) -> DesktopBridgeResult {
    if !valid_id(&handoff_id) {
        return DesktopBridgeResult::failure(
            "invalid-request",
            "交接識別碼格式不正確",
        );
    }
    let state = app.state::<HandoffState>();
    let mut records = state.records.write().await;
    if let Some(record) = records.remove(&handoff_id) {
        record.stopped.store(true, Ordering::Relaxed);
    }
    drop(records);
    remove_persisted(&app, &handoff_id).await;
    DesktopBridgeResult::success(Some(handoff_id), None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filename_is_sanitized() {
        assert_eq!(safe_filename(Some("edited.mp4"), "asset_1234"), "edited.mp4");
        assert_eq!(
            safe_filename(Some("../../evil.exe"), "asset_1234"),
            "asset-asset_1234.bin"
        );
    }

    #[test]
    fn ids_are_restricted() {
        assert!(valid_id("01234567-89ab-cdef-0123-456789abcdef"));
        assert!(!valid_id("../secret"));
        assert!(!valid_id("tiny"));
    }

    #[test]
    fn rel_path_rejects_traversal() {
        assert!(sanitize_rel_path("abc12345/clip.mp4").is_some());
        assert!(sanitize_rel_path("../etc/passwd").is_none());
        assert!(sanitize_rel_path("abc12345/../../x").is_none());
        assert!(sanitize_rel_path("/abs/path.mp4").is_none());
        assert!(sanitize_rel_path("short/x.mp4").is_none()); // id too short
    }

    #[test]
    fn persisted_json_round_trip() {
        let entry = PersistedHandoff {
            handoff_id: "01234567-89ab-cdef-0123-456789abcdef".into(),
            asset_id: "fedcba98-7654-3210-fedc-ba9876543210".into(),
            project_id: Some("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee".into()),
            editor_id: "capcut".into(),
            rel_path: "01234567-89ab-cdef-0123-456789abcdef/clip.mp4".into(),
            last_hash: Some("abc".into()),
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("handoffId"));
        assert!(json.contains("relPath"));
        let back: PersistedHandoff = serde_json::from_str(&json).unwrap();
        assert_eq!(back, entry);
    }
}
