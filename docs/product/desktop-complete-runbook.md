# Aios 電腦版：完成總覽與發布 Runbook

| 欄位 | 內容 |
|------|------|
| 狀態 | **程式面 1–6 波已合入 healing**（2026-08-01） |
| 關聯 PR | #303 #305 #307 #309 #311（關閉，由 #315 涵蓋）#315 |
| 產品規格 | [app-landing-app-00](./app-landing-app-00.md) · [app-landing-app-01-tauri](./app-landing-app-01-tauri.md) |

---

## 1. 已交付能力清單

| 波 | PR | 能力 |
|----|-----|------|
| 1 | #303 | 桌面頂欄／Toc sticky；交接 `percent`／phase；Companion 狀態卡；素材庫選編輯器 |
| 2 | #305 | Launchpad 卡片／列表（≥821）；簡易模式桌面雙欄 |
| 3 | #307 | handoff `active.json` 持久化與重啟恢復；串流下載＋串流 SHA |
| 4 | #309 | 視窗大小位置記憶；原生選單（剪輯連接／快取夾／About／結束） |
| 5 | #311→#315 | `shared/assetLineage` 血緣摘要與版本篩選 UI |
| 6 | #315 | `asset_revisions` 表、上傳雙寫、`listAssetRevisions` |

### 安全邊界（不可放寬）

- Remote capability 僅 `https://ai-os-app.zeabur.app/*`
- Web → 原生僅四命令：`detect_editors`／`open_asset`／`reveal_asset`／`stop_handoff`
- 不傳執行檔路徑、shell、任意本機路徑、下載 URL、Token 給 WebView
- 不掛 `opener:default` 給 remote（選單開快取夾用系統指令）

---

## 2. 使用者怎麼下載安裝包（最簡）

1. 登入網站 → 帳號選單 **「下載電腦版應用程式」**（或開 `/downloads#desktop-app`）  
2. 按 **「下載 Windows／Mac 安裝包」** → 進 GitHub Releases 最新一版  
3. 下載：
   - **Windows**：`.exe`（建議）或 `.msi`  
   - **Mac**：`.dmg`  
4. 安裝後開啟 **Aios**，用與網站相同帳號登入  

若 Releases 尚無檔案：請管理員在 repo 打 tag `desktop-v0.1.0`（或更新號）並等 **Desktop Native** workflow 完成；或 Actions 手動 `workflow_dispatch` 建 artifact。

站內連結預設：`https://github.com/aa0968111723-prog/ai_os/releases/latest`（可用 `VITE_DESKTOP_RELEASES_URL` 覆寫）。

## 3. 部署與本機指令

```bash
# 資料庫（含 0024 asset_revisions）
npm run db:migrate

# 前端／後端
npm run typecheck
npm run test:client -- desktopBridge.test.ts AssetLibrary.desktopCta
npm test -- shared/assetLineage.test.ts

# 桌面原生（需 Rust；完整 GUI 依賴見 Tauri 文件）
npm run desktop:test
npm run desktop:check
npm run desktop:build   # 本機產安裝包
```

CI：`.github/workflows/desktop-native.yml`  
- PR 觸及 `src-tauri/**` 或 desktop 前端路徑 → verify + 內部安裝包 artifact  
- Tag `desktop-v*` → 建包並 **發布到 GitHub Releases**（站內下載連這裡）  
- 手動：Actions → Desktop Native → Run workflow

---

## 3. 公開發布前（簽章／自動更新）— 尚未接程式

**目前刻意不做**：在沒有組織憑證前接入 `tauri-plugin-updater` 會給出無法驗證的更新通道。

### 3.1 需準備的 secrets（GitHub Environment `desktop-release`）

| Secret | 平台 | 用途 |
|--------|------|------|
| `WINDOWS_CERTIFICATE` / `WINDOWS_CERTIFICATE_PASSWORD` | Win | Authenticode |
| `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` | macOS | Developer ID Application |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | macOS | Notarization |
| `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 雙端 | Updater 簽章 |

### 3.2 建議後續 PR（有 secrets 後再開）

1. `tauri-plugin-updater` + `tauri.conf.json` plugins.updater.endpoints  
2. workflow：僅 `tags: desktop-v*` 且 Environment 有 secrets 時正式簽章  
3. 靜態更新 manifest 託管（GitHub Releases 或自家 CDN）  
4. Companion／選單「檢查更新」（可選）

### 3.3 內部測試包現況

- Windows：未簽章 → 可能 SmartScreen  
- macOS：`APPLE_SIGNING_IDENTITY=-` ad-hoc → 不可當公開包  
- 保留 14 天 artifact，供 QA 下載  

---

## 4. 實機驗收清單（QA）

- [ ] 安裝內部包並登入正式站  
- [ ] 素材庫「用外部軟體開啟」→ 改檔儲存 → 新素材出現且原檔保留  
- [ ] 卡片顯示「桌面編輯自…」；`asset_revisions` 有列（migrate 後）  
- [ ] 交接中重開 App → 監看恢復  
- [ ] 選單：桌面剪輯連接、快取資料夾、About  
- [ ] 視窗調大小後重開位置保留  
- [ ] `aios://open?path=%2Fdesktop` 冷／熱啟動  

---

## 5. 完成定義（本 Runbook）

- [x] 波 1–6 程式已合入主開發線（healing）  
- [x] 安全契約文件化  
- [x] 簽章／updater 列為有憑證後的明確後續，不假裝已完成  
- [x] 實機清單可給 QA 直接勾  

**程式面「電腦版完整製作」到此收斂。** 公開商店級發布屬營運／憑證議題，不阻塞內部使用。
