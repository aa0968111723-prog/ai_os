# Aios 應用程式落地 APP-01：Tauri 桌面原生工程

| 欄位 | 內容 |
|---|---|
| 狀態 | Native Runtime Candidate |
| 日期 | 2026-07-30 |
| 關聯 | PR #172 PWA 更新基線、PR #179 桌面橋接契約 |
| 平台 | Windows、macOS；Linux 保留開發支援 |

## 本階段完成

本階段建立可編譯的 Tauri 2 原生工程，使 Aios 桌面版可以：

1. 載入正式 Aios 網站並沿用既有登入、權限、專案與素材 API。
2. 註冊 `aios://` 深度連結。
3. 偵測電腦中已安裝的影片、音訊與圖片編輯軟體。
4. 把已授權素材下載到 Aios 管理的本機快取。
5. 用指定軟體或系統預設程式開啟檔案。
6. 監看編輯檔，穩定儲存後自動上傳為新的 Aios 素材。
7. 在 Finder／檔案總管顯示本機檔案。
8. 由 GitHub Actions 驗證 Windows／macOS 並產生內部安裝包。

## 架構

```text
Aios hosted React app
https://ai-os-app.zeabur.app
          │ exact-origin capability
          ▼
Tauri WebView
          ├─ detect_editors
          ├─ open_asset
          ├─ reveal_asset
          └─ stop_handoff
          ▼
Aios-managed local cache
          ├─ Premiere / Resolve / Final Cut / CapCut
          ├─ Audition / Audacity
          ├─ Photoshop / GIMP
          └─ system default application
          ▼
SHA-256 watcher → /api/upload → new Aios asset
```

## 安全邊界

Remote capability 僅允許精確正式來源，並只授權四個自訂命令。網頁端不能傳執行檔路徑、Shell 指令、任意本機路徑、`file://`、任意下載 URL 或 OAuth Token；只能傳 `assetId`、`projectId`、固定用途、原生端回傳的 allowlist `editorId`、安全檔名與 Aios 內部路由。

本機檔案只寫入 `app_local_data_dir/handoffs/<handoffId>/`。下載仍由 Aios API 驗證登入與素材存取權，HttpOnly Session Cookie只在 Rust 原生層使用。

## 軟體偵測

### Windows

- Adobe Premiere Pro
- DaVinci Resolve
- CapCut
- Adobe Audition
- Adobe Photoshop
- 系統預設影片、音訊、圖片與一般程式

### macOS

- Adobe Premiere Pro
- DaVinci Resolve
- Final Cut Pro
- CapCut
- Adobe Audition
- Adobe Photoshop
- 系統預設程式

### Linux 開發支援

- DaVinci Resolve
- Kdenlive
- Shotcut
- Audacity
- GIMP

Windows 掃描限制在 `Program Files`、`Program Files (x86)` 與 `LOCALAPPDATA` 的有限深度；macOS只檢查 `/Applications` 與 `~/Applications`。

## 交接與自動回傳

```text
使用者選擇專案素材與編輯器
→ Rust 取得目前 WebView 登入工作階段
→ GET /api/assets/:id/file
→ 寫入 Aios 本機快取
→ 啟動指定編輯器
→ 每 2 秒計算 SHA-256
→ 內容穩定 4 秒後 POST /api/upload
→ 原始素材保留，新增桌面編輯素材
```

相同內容不重複上傳；失敗時保留本機檔並重試；使用者可停止監看。單檔下載／回傳上限目前為 200MB。

現有 `/api/upload` 尚未持久保存 `sourceAssetId`、`handoffId`、`editorId`，因此目前是「新增編輯素材」，不是完整版本樹。後續需建立正式 asset revision／lineage 資料模型。

## 桌面操作頁

新增 `/desktop`，只在 Tauri 桌面環境的帳號選單顯示。使用者可選專案、素材與已安裝編輯器，啟動交接、查看狀態、在 Finder／檔案總管定位及停止自動回傳。一般瀏覽器進入時只顯示需要桌面版，不會取得本機能力。

### 交接進度事件（前端可畫進度條）

原生以 `aios:desktop-handoff-status` 推送（camelCase），欄位：

| 欄位 | 說明 |
|------|------|
| `handoffId` | 本次交接 id |
| `projectId` / `sourceAssetId` | 可選 |
| `phase` | `downloading`／`downloaded`／`launched`／`watching`／`uploading`／`uploaded`／`error`／`stopped` |
| `message` | 白話狀態 |
| `percent` | 可選 0–100（下載串流約每 5% 更新；完成 100） |

前端 `normalizeHandoffStatusEvent` 容錯後再 `CustomEvent` 給 Companion／素材庫。素材庫在有 bridge 時可選編輯器 id 再開啟（與 Companion 對齊）。

### 交接持久化與串流下載

- 進行中的監看交接寫入 `app_local_data_dir/handoffs/active.json`（只存 id 與相對路徑，不寫可執行檔路徑）。
- App 啟動時 `resume_active_handoffs`：本機檔仍在且有 `projectId` 則恢復 watcher。
- 停止交接會從索引移除；檔案仍保留在 cache。
- 下載改串流寫盤＋進度；SHA-256 串流讀檔（避免大檔整包進 RAM）。上傳仍受 200MB 上限。

## 深度連結

桌面版註冊：

```text
aios://open?path=%2Fp%2F<project-id>%3Ftab%3Dassets
```

Windows／Linux 以 single-instance 把第二次啟動的 URL 交給既有視窗；macOS處理冷啟動與執行中的 URL 事件。前端再次驗證路由，不接受外站或敏感 Token。

## 原生殼體驗（選單／視窗）

- **視窗狀態**：`tauri-plugin-window-state` 記住主視窗大小與位置（寫入 app 資料目錄，不經 WebView）。
- **原生選單**（`src-tauri/src/menu.rs`，不新增 invoke）：
  - 檔案 → 桌面剪輯連接…（`Cmd/Ctrl+Shift+D` → `aios://open?path=%2Fdesktop`）
  - 檔案 → 開啟本機交接快取資料夾（只開 `app_local_data_dir/handoffs`）
  - 檔案 → 結束 Aios
  - 說明 → 關於 Aios（系統 About）
- **不**在 remote capability 掛 `opener:default`，避免正式站 WebView 取得任意開路徑能力。

## 原生安裝包

CI 可產生：

- Windows NSIS `.exe`
- Windows MSI `.msi`
- macOS `.app`
- macOS `.dmg`

目前只屬內部測試包，尚未設定 Windows Code Signing Certificate、Apple Developer ID、macOS notarization 與 **updater signing key**。未簽章 Windows 包可能觸發 SmartScreen；macOS ad-hoc 包不可視為公開發布版本。

**完成總覽與簽章／更新 secrets 清單**見 [desktop-complete-runbook.md](./desktop-complete-runbook.md)（波 1–6 已合入）。

## 驗收

- [x] TypeScript／desktop bridge 測試（CI）
- [x] Windows／macOS cargo test／check（desktop-native workflow）
- [x] Windows NSIS／MSI、macOS app／DMG 內部 artifact（未簽章）
- [ ] 實機偵測剪輯軟體
- [ ] 實機下載有權限素材
- [ ] 實機啟動第三方軟體
- [ ] 儲存後自動新增 Aios 素材（meta + asset_revisions）
- [ ] 原始素材未被覆寫
- [ ] `aios://` 回到指定專案
- [ ] 重啟後 handoff 監看恢復
- [ ] 原生選單／視窗位置

## 後續（營運／憑證，非阻塞內部使用）

1. 公開發布：Authenticode + Developer ID + notarization（secrets 見 runbook §3）
2. `tauri-plugin-updater` + 簽章更新通道（有 TAURI_SIGNING_* 後再開 PR）
3. 上傳 multipart 大檔真正串流（目前仍 200MB 上限整檔讀入上傳）
4. Windows／macOS 正式簽章、notarization與自動更新。
5. 經實機驗證的 EDL、FCPXML、OTIO 等剪輯專案交換。
