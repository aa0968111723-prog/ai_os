# Aios 應用程式落地 APP-01：Tauri 桌面原生工程

| 欄位 | 內容 |
|---|---|
| 狀態 | Native Runtime Candidate |
| 日期 | 2026-07-30 |
| 關聯 | PR #172 PWA 更新基線、PR #179 桌面橋接契約 |
| 平台 | Windows、macOS；Linux 保留開發支援 |

## 1. 本階段完成什麼

本階段不再只是規格或空介面，而是建立可編譯的 Tauri 2 原生工程，讓 Aios 桌面版可以：

1. 載入正式 Aios 網站並沿用既有登入、權限、專案與素材 API。
2. 註冊 `aios://` 深度連結並把使用者帶回安全的 Aios 內部頁面。
3. 偵測電腦中已安裝的影片、音訊與圖片編輯軟體。
4. 把已授權的 Aios 素材下載到 Aios 管理的本機快取。
5. 真正以指定軟體或系統預設程式開啟本機檔案。
6. 監看編輯檔案，偵測穩定儲存後自動上傳為新的 Aios 素材。
7. 在 Finder／檔案總管顯示交接檔案。
8. 由 GitHub Actions 在 Windows 與 macOS 執行 Rust／TypeScript 驗證，並按需產生原生安裝包。

## 2. 架構

```text
Aios hosted React app
https://ai-os-app.zeabur.app
          │
          │ exact-origin remote capability
          ▼
Tauri WebView
          │
          ├─ detect_editors
          ├─ open_asset
          ├─ reveal_asset
          └─ stop_handoff
          │
          ▼
Aios-managed local cache
          │
          ├─ Premiere Pro / Resolve / Final Cut / CapCut
          ├─ Audition / Audacity
          ├─ Photoshop / GIMP
          └─ system default application
          │
          ▼
SHA-256 watcher → /api/upload → new Aios asset
```

核心 React 前端、Zeabur API、資料庫與權限模型維持同一套，不建立第二套桌面業務系統。

## 3. 遠端 WebView 的安全邊界

桌面視窗載入：

```text
https://ai-os-app.zeabur.app
```

但原生能力不是對所有網站開放。`remote-main` capability 僅允許精確正式來源，且只授權四個自訂命令：

```text
detect_editors
open_asset
reveal_asset
stop_handoff
```

網頁端不能傳：

- 執行檔路徑。
- Shell 指令或參數。
- 任意本機路徑。
- `file://` URL。
- 任意下載 URL。
- OAuth Token、Refresh Token 或簽名下載 Token。

網頁端只能傳：

- `assetId`。
- `projectId`。
- 固定用途 `editorKind`。
- 原生端偵測後回傳的 allowlist `editorId`。
- 安全檔名建議。
- Aios 內部返回路由。

原生端再依自己的 allowlist 決定實際程式，避免遠端 renderer 變成任意命令執行入口。

## 4. 已安裝軟體偵測

### Windows

第一批偵測：

- Adobe Premiere Pro。
- DaVinci Resolve。
- CapCut。
- Adobe Audition。
- Adobe Photoshop。
- 系統預設影片、音訊、圖片與一般程式。

偵測範圍限制在 `Program Files`、`Program Files (x86)` 與 `LOCALAPPDATA` 的有限深度，不遞迴掃描整顆磁碟。

### macOS

第一批偵測：

- Adobe Premiere Pro。
- DaVinci Resolve。
- Final Cut Pro。
- CapCut。
- Adobe Audition。
- Adobe Photoshop。
- 系統預設程式。

偵測 `/Applications` 與使用者 `~/Applications` 中的 `.app` bundle。

### Linux 開發支援

- DaVinci Resolve。
- Kdenlive。
- Shotcut。
- Audacity。
- GIMP。
- 系統預設程式。

## 5. 真正啟動第三方軟體

交接流程：

```text
使用者選擇專案素材與已安裝軟體
  → Rust 以 WebView 的 HttpOnly session cookie 驗證目前登入
  → GET /api/assets/:id/file
  → 寫入 app_local_data_dir/handoffs/<handoffId>/
  → 以 opener 或受控 macOS open -a 啟動
  → 回傳 handoffId
```

正式下載仍由 Aios 後端檢查登入、組別及素材存取權。桌面端不使用永久 API Key，也不把 Session Cookie暴露給 React 程式。

## 6. 編輯檔監看與自動回傳

第一版採安全且跨平台的內容雜湊監看：

- 每 2 秒檢查一次。
- 對檔案計算 SHA-256。
- 內容連續穩定 4 秒才視為完成一次儲存。
- 與最近成功上傳的雜湊相同時不重複上傳。
- 上傳失敗保留本機檔與待回傳狀態，稍後再嘗試。
- 使用者可按「停止自動回傳」。

回傳使用現有：

```text
POST /api/upload
```

因此目前行為是：

```text
原始素材保留
＋編輯後檔案新增為另一筆素材
```

### 尚未完成的正式 revision 關聯

現有資料表尚未持久保存：

```text
新素材是由哪個 sourceAssetId 編輯而來
handoffId
editorId
剪輯軟體版本
本機 checksum
```

桌面端已帶上相關 multipart metadata，但目前 `/api/upload` 會忽略額外欄位。後續應另開資料模型 PR，建立正式 `asset_revisions` 或素材 lineage 欄位；在此之前不得把「新增素材」宣稱為完整版本歷史。

## 7. 桌面操作頁

已新增已登入頁面：

```text
/desktop
```

只在 Tauri 桌面環境的帳號選單顯示入口。頁面可以：

- 選擇專案。
- 選擇素材。
- 查看符合素材類型的已安裝軟體。
- 用外部軟體開啟並開始監看。
- 在 Finder／檔案總管顯示。
- 停止自動回傳。
- 接收下載、啟動、監看、上傳成功與失敗狀態。

一般瀏覽器直接進入 `/desktop` 時，只顯示「需要 Aios 桌面版」，不會嘗試啟動本機程式。

## 8. 深度連結

桌面版註冊：

```text
aios://
```

範例：

```text
aios://open?path=%2Fp%2F<project-id>%3Ftab%3Dassets
```

Windows／Linux 使用 single-instance 把第二次啟動的 URL 傳回既有主視窗；macOS 同時處理冷啟動與執行中的 `open-url` 事件。

前端仍會再次驗證路由，只允許既有 Aios 頁面，不接受外站 URL、任意路徑或敏感 Token。

## 9. 原生安裝包

### Windows

CI 設定可產生：

- NSIS `.exe` 安裝程式。
- MSI `.msi` 安裝程式。

### macOS

CI 設定可產生：

- `.app` Bundle。
- `.dmg` 安裝映像。

### 目前簽章狀態

目前工作流可建立**內部測試用**安裝包；尚未設定：

- Windows Code Signing Certificate。
- Apple Developer ID Application 憑證。
- Apple notarization 帳號／API Key。
- 正式下載頁與更新簽章。

因此未簽章 Windows 安裝程式可能觸發 SmartScreen，macOS 內部測試 DMG 使用 ad-hoc 簽章，不能視為可公開發布版本。正式對外發佈前，必須加入簽章、notarization 與供應鏈驗證。

## 10. GitHub Actions

PR 會在：

```text
windows-latest
macos-14
```

執行：

- `npm ci`。
- TypeScript typecheck。
- `desktopBridge.test.ts`。
- `cargo test`。
- `cargo check`。

手動 Workflow Dispatch 或 `desktop-v*` Tag 才建立安裝包，避免每個小 PR 都花費完整原生打包時間。

## 11. 本階段驗收

- [ ] TypeScript typecheck 通過。
- [ ] 前端桌面橋接測試通過。
- [ ] Windows Cargo test／check 通過。
- [ ] macOS Cargo test／check 通過。
- [ ] Windows 偵測至少一套實機剪輯軟體或系統預設程式。
- [ ] macOS 偵測至少一套實機剪輯軟體或系統預設程式。
- [ ] 能下載有權限的 Aios 素材。
- [ ] 無權限素材被 Aios API 拒絕。
- [ ] 能真正啟動目標軟體。
- [ ] 儲存修改後自動新增 Aios 素材。
- [ ] 原始素材未被覆寫。
- [ ] 停止監看後不再自動上傳。
- [ ] `aios://` 能回到原專案。
- [ ] Workflow Dispatch 產生 Windows 與 macOS 安裝 Artifact。

## 12. 下一階段

### APP-01.1：素材 revision 資料模型

- `asset_revisions` 或素材 lineage schema。
- source asset／revision number／editor／checksum／操作者／時間。
- 專案資產頁顯示版本樹與還原。

### APP-01.2：桌面快取與續傳

- 下載續傳與 Range。
- 大檔案串流，不一次讀入記憶體。
- 快取容量與清理策略。
- App 重啟後恢復未完成 handoff。

### APP-01.3：正式簽章與發布

- Windows 憑證簽章。
- macOS Developer ID、hardened runtime、notarization。
- 正式 Release Artifact、checksum 與更新簽章。
- 安裝／升級／回退文件。

### APP-01.4：剪輯專案交換

- 素材包。
- 字幕／逐字稿。
- 分鏡／時間軸 metadata。
- EDL、FCPXML、OTIO 等經實機驗證的交換格式。
