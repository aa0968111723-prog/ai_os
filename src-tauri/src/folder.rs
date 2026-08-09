//! Desktop folder import (Folder Import 2.0, P4).
//!
//! Native side owns the absolute path and nothing else ever sees it. The WebView
//! only receives a `rootId` (an opaque uuid), a display name and **relative**
//! paths — so `C:\Users\Bruce\Desktop\北藝專案` never reaches the server, the
//! database, or an AI prompt.
//!
//! Scanning is intentionally conservative: no symlink following, no hidden
//! files, a hard entry cap, and every skipped file is reported back rather than
//! silently dropped.

use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;
use walkdir::WalkDir;

/// Hard cap per scan. A folder larger than this is still importable — the
/// result is flagged `truncated` so the UI can say so instead of pretending
/// it saw everything.
const MAX_SCAN_ENTRIES: usize = 20_000;
const MAX_SCAN_DEPTH: usize = 24;

/// rootId → absolute path. This map is the only place the absolute path lives.
#[derive(Default)]
pub struct FolderRootState {
    roots: Mutex<HashMap<String, PathBuf>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedFolder {
    pub root_id: String,
    /// Folder name only — never the full path.
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedEntry {
    pub relative_path: String,
    pub filename: String,
    pub parent_path: String,
    pub size: u64,
    /// Epoch milliseconds; `None` when the filesystem does not report it.
    pub last_modified: Option<u64>,
    pub mime: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedEntry {
    pub relative_path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderScan {
    pub root_id: String,
    pub display_name: String,
    pub entries: Vec<ScannedEntry>,
    pub skipped: Vec<SkippedEntry>,
    pub total_bytes: u64,
    /// True when the entry cap was hit — the caller must not claim full coverage.
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "ok")]
pub enum FolderResult<T> {
    #[serde(rename = "true")]
    Ok(T),
    #[serde(rename = "false")]
    Err {
        reason: String,
        message: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRequest {
    pub root_id: String,
}

fn err<T>(reason: &str, message: &str) -> FolderResult<T> {
    FolderResult::Err {
        reason: reason.to_string(),
        message: message.to_string(),
    }
}

/// The last path component, used purely for display.
fn display_name_of(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("匯入資料夾")
        .to_string()
}

/// A relative path is only acceptable when every component is a plain name.
/// `..`, absolute prefixes and non-UTF-8 names are rejected outright.
fn relative_path_of(root: &Path, entry: &Path) -> Option<String> {
    let relative = entry.strip_prefix(root).ok()?;
    let mut parts: Vec<String> = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_str()?.to_string()),
            _ => return None,
        }
    }
    if parts.is_empty() {
        return None;
    }
    let root_name = display_name_of(root);
    let mut full = Vec::with_capacity(parts.len() + 1);
    full.push(root_name);
    full.extend(parts);
    Some(full.join("/"))
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.') || name == "$RECYCLE.BIN" || name == "System Volume Information"
}

/// Open the OS folder picker and remember the chosen root under a fresh id.
/// Only the id and the folder's display name are returned to the WebView.
#[tauri::command]
pub async fn pick_import_folder(
    app: tauri::AppHandle,
    state: State<'_, FolderRootState>,
) -> Result<FolderResult<PickedFolder>, ()> {
    // The native dialog blocks; keep it off the async runtime's worker threads.
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().blocking_pick_folder()
    })
    .await;

    let picked = match picked {
        Ok(value) => value,
        Err(_) => return Ok(err("dialog-failed", "無法開啟資料夾選擇視窗")),
    };
    let Some(file_path) = picked else {
        return Ok(err("cancelled", "沒有選擇資料夾"));
    };
    let Ok(path) = file_path.into_path() else {
        return Ok(err("invalid-path", "這個位置無法作為匯入來源"));
    };
    if !path.is_dir() {
        return Ok(err("invalid-path", "請選擇一個資料夾"));
    }

    let root_id = Uuid::new_v4().to_string();
    let display_name = display_name_of(&path);
    match state.roots.lock() {
        Ok(mut roots) => {
            roots.insert(root_id.clone(), path);
        }
        Err(_) => return Ok(err("state-poisoned", "桌面端狀態異常，請重新啟動 Aios")),
    }
    Ok(FolderResult::Ok(PickedFolder {
        root_id,
        display_name,
    }))
}

/// Walk a previously picked root and return a **relative-path** manifest.
/// Re-scanning the same root is how desktop "manual re-sync" works: the server
/// diffs this manifest against the previous import session.
#[tauri::command]
pub async fn scan_import_folder(
    state: State<'_, FolderRootState>,
    request: ScanRequest,
) -> Result<FolderResult<FolderScan>, ()> {
    let root = match state.roots.lock() {
        Ok(roots) => roots.get(&request.root_id).cloned(),
        Err(_) => return Ok(err("state-poisoned", "桌面端狀態異常，請重新啟動 Aios")),
    };
    let Some(root) = root else {
        return Ok(err("unknown-root", "這個資料夾來源已失效，請重新選擇"));
    };
    if !root.is_dir() {
        return Ok(err("root-missing", "來源資料夾已不存在或無法讀取"));
    }

    let display_name = display_name_of(&root);
    let mut entries: Vec<ScannedEntry> = Vec::new();
    let mut skipped: Vec<SkippedEntry> = Vec::new();
    let mut total_bytes: u64 = 0;
    let mut truncated = false;

    // follow_links(false): a symlink out of the root would leak files the user
    // never chose to import.
    for item in WalkDir::new(&root)
        .max_depth(MAX_SCAN_DEPTH)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            entry
                .file_name()
                .to_str()
                .map(|name| !is_hidden(name))
                .unwrap_or(false)
        })
    {
        let Ok(item) = item else { continue };
        if !item.file_type().is_file() {
            continue;
        }
        if entries.len() >= MAX_SCAN_ENTRIES {
            truncated = true;
            break;
        }
        let Some(relative_path) = relative_path_of(&root, item.path()) else {
            skipped.push(SkippedEntry {
                relative_path: item.file_name().to_string_lossy().to_string(),
                reason: "unsafe_path".to_string(),
            });
            continue;
        };
        let Ok(metadata) = item.metadata() else {
            skipped.push(SkippedEntry {
                relative_path,
                reason: "unreadable".to_string(),
            });
            continue;
        };
        let size = metadata.len();
        if size == 0 {
            skipped.push(SkippedEntry {
                relative_path,
                reason: "empty".to_string(),
            });
            continue;
        }
        let last_modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|delta| delta.as_millis() as u64);
        let (parent_path, filename) = match relative_path.rsplit_once('/') {
            Some((parent, name)) => (parent.to_string(), name.to_string()),
            None => (String::new(), relative_path.clone()),
        };
        total_bytes = total_bytes.saturating_add(size);
        entries.push(ScannedEntry {
            relative_path,
            filename,
            parent_path,
            size,
            last_modified,
            mime: mime_guess::from_path(item.path())
                .first()
                .map(|mime| mime.essence_str().to_string()),
        });
    }

    entries.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(FolderResult::Ok(FolderScan {
        root_id: request.root_id,
        display_name,
        entries,
        skipped,
        total_bytes,
        truncated,
    }))
}

/// Forget a remembered root. Purely local — this never deletes anything that has
/// already been imported into Aios.
#[tauri::command]
pub async fn forget_import_folder(
    state: State<'_, FolderRootState>,
    request: ScanRequest,
) -> Result<FolderResult<bool>, ()> {
    match state.roots.lock() {
        Ok(mut roots) => Ok(FolderResult::Ok(roots.remove(&request.root_id).is_some())),
        Err(_) => Ok(err("state-poisoned", "桌面端狀態異常，請重新啟動 Aios")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_path_keeps_the_folder_structure() {
        let root = Path::new("/tmp/北藝專案");
        let entry = Path::new("/tmp/北藝專案/人物/安倢/2025/IMG001.jpg");
        assert_eq!(
            relative_path_of(root, entry).as_deref(),
            Some("北藝專案/人物/安倢/2025/IMG001.jpg"),
        );
    }

    #[test]
    fn relative_path_rejects_paths_outside_the_root() {
        let root = Path::new("/tmp/北藝專案");
        assert!(relative_path_of(root, Path::new("/tmp/其他/IMG001.jpg")).is_none());
        // The root itself is not an entry.
        assert!(relative_path_of(root, root).is_none());
    }

    #[test]
    fn hidden_and_system_directories_are_skipped() {
        assert!(is_hidden(".git"));
        assert!(is_hidden(".DS_Store"));
        assert!(is_hidden("$RECYCLE.BIN"));
        assert!(!is_hidden("人物"));
    }

    #[test]
    fn display_name_is_the_folder_name_not_the_path() {
        assert_eq!(display_name_of(Path::new("/Users/bruce/Desktop/北藝專案")), "北藝專案");
    }
}
