# Aios 應用程式落地 APP-00

| 欄位 | 內容 |
|---|---|
| 狀態 | Implementation Baseline |
| 日期 | 2026-07-30 |
| 產品範圍 | Aios Web／PWA，手機、平板、桌面 |

## 現在最應該做什麼

Aios 已經有 manifest、Service Worker、安裝入口、離線殼與跨裝置推播，因此目前最優先的不是直接加入 Capacitor、Tauri，也不是新增不存在的「光球」。

第一優先是把目前 PWA 補成可長期使用、可安全升級、可驗收的正式應用程式，並提前建立未來桌面版與本機剪輯軟體交接的安全契約：

1. 新版不得在使用者編輯途中自動接管與刷新。
2. 新版下載完成後要有清楚的「立即更新」提示。
3. 更新完成後回到原本頁面，不破壞既有深鏈。
4. Aios 內部連結必須能安全轉為桌面版 `aios://` 深度連結。
5. 本機剪輯軟體交接只能透過受控桌面橋接，不讓 Web renderer 傳任意執行檔、shell 參數、本機路徑或下載網址。
6. 手機與桌面必須用真實裝置驗收安裝、登入、通知、檔案匯入及更新。
7. 正式站的 `APP_URL`、Google OAuth callback、Notion／Google Drive 整合必須使用同一個正式來源。

本 PR 完成第 1～5 項的程式基線，並把第 6～7 項列為部署驗收。

## 本 PR 實作

### PWA 安全更新

- Service Worker 更新不再自動 `skipWaiting`。
- 新版完成安裝後先進入 waiting 狀態。
- Aios 顯示「有新版本」提示，由使用者主動按「立即更新」。
- 只有使用者確認更新後，才讓新版 Service Worker 接管並重新載入。
- App 回到前景時主動檢查新版。
- 補上更新條件單元測試。

### 桌面深度連結與外部剪輯交接契約

新增 `client/src/platform/desktopBridge.ts`：

- `buildAiosDeepLink(path)`：把安全內部路由轉成 `aios://open?path=...`。
- `parseAiosDeepLink(url)`：桌面版收到作業系統深度連結後，只允許既有 Aios 路由。
- `openAssetInExternalEditor(request)`：把 Aios 資產交給桌面原生橋接。
- `revealAssetInFolder(request)`：在 Finder／檔案總管顯示桌面快取檔案。
- 一般瀏覽器／PWA 沒有桌面橋接時，回傳清楚的「先下載再用系統開啟」降級訊息。

目前契約支援用途：

```text
system-default
video-editor
audio-editor
image-editor
```

實際程式名稱由桌面端依使用者選擇、作業系統與已安裝軟體決定。不得在 Web 程式硬寫不可靠的第三方私有 protocol。

## 深度連結分成兩種

### 1. 外部世界開啟 Aios

例如桌面通知、瀏覽器、郵件或剪輯交接完成後返回：

```text
aios://open?path=%2Fp%2F<project-id>%3Ftab%3Dassets
```

安全規則：

- 只接受 `aios://open`。
- 只接受 `/`、`/p/:id`、Planner、Databases、Chat、Integrations、Downloads、Help 等現有路由。
- 拒絕外部網址、`//host`、反斜線、控制字元、未知頁面與過短識別碼。
- 深度連結只負責導頁，不攜帶 access token、refresh token、檔案路徑或簽名下載網址。

### 2. Aios 開啟電腦剪輯軟體

純 PWA 無法穩定、跨瀏覽器地直接啟動任意本機剪輯軟體，也無法安全掌握編輯後檔案路徑。正式流程應由未來桌面版原生橋接完成：

```text
Aios 資產 assetId
  → 桌面橋接向 Aios API 請求短效下載授權
  → 下載到 Aios 管理的本機快取資料夾
  → 依用途／使用者偏好選擇已允許的剪輯軟體
  → 由作業系統 Open With 或軟體專屬 adapter 開啟
  → 編輯完成後偵測檔案變更
  → 使用者確認「上傳為新版本」
  → 保留原檔、建立版本紀錄
  → 用 aios:// 深度連結回到專案資產頁
```

## 外部剪輯軟體整合層級

### Level 1：下載／系統預設開啟

適用 Web／PWA 與第一版桌面 App：

- 下載影片、音訊、圖片、字幕或專案素材包。
- 桌面版可使用作業系統預設程式開啟。
- 可在 Finder／檔案總管顯示檔案。

### Level 2：指定用途的已安裝軟體

桌面端維護 allowlist 與使用者偏好：

- 影片剪輯器。
- 音訊編輯器。
- 圖片編輯器。
- 系統預設程式。

Adobe Premiere Pro、DaVinci Resolve、Final Cut Pro、CapCut、Audition、Photoshop 等只能在確認其作業系統與版本支援方式後建立 adapter；沒有正式穩定介面時，使用作業系統 Open With，不猜測或硬寫私有 URL scheme。

### Level 3：剪輯專案交換包

Aios 可輸出一個可攜工作包：

```text
project.json
media-manifest.json
素材檔案
字幕／逐字稿
縮圖
時間軸與分鏡 metadata
checksum.json
```

後續再依目標剪輯器的正式支援，選擇性產生 EDL、FCPXML、AAF、OTIO 或軟體外掛可讀格式。不同軟體支援不一致，因此不可在尚未實測前宣稱完整相容。

### Level 4：雙向回傳與外掛

進階版本可加入：

- 桌面 companion 監看輸出檔案。
- 編輯完成後上傳為新 revision。
- 不覆寫 Aios 原始素材。
- 保存軟體名稱、版本、檔案 checksum、交接時間與操作者。
- 剪輯軟體 Extension／Plugin 直接讀取 Aios 專案與回傳成品。

## 桌面橋接安全界線

Web renderer 只能傳：

```text
assetId
projectId（可選）
editorKind
suggestedName（顯示用）
returnPath（安全內部路由）
```

Web renderer 禁止傳：

```text
executable path
shell command
shell args
file:// URL
任意本機路徑
任意下載 URL
OAuth token
簽名下載 token
```

原生桌面端必須：

- 用 assetId 向後端換取短效、單次或有限用途下載。
- 驗證使用者仍有專案與資產權限。
- 限制副檔名、MIME、大小與下載來源。
- 寫入 Aios 管理的快取目錄，避免任意路徑寫入。
- 軟體啟動使用 allowlist／Open With，不拼接 shell 字串。
- 上傳變更前再次要求使用者確認。
- 原檔唯讀保留，新內容建立 revision。

## 為什麼先做這個

目前 Aios 已可被安裝，但若沒有可控更新流程，使用者可能長期停在舊版，或在輸入提示詞、筆記、專案資料時遇到版本切換。這會直接影響「像真正 App 一樣穩定」的核心感受。

同時，先定義桌面橋接契約，可以避免未來為了「一鍵開剪輯軟體」直接在網頁端加入危險的任意路徑、shell 或私有 protocol。原生包裝不能自行修好更新、草稿與權限問題；它必須建立在這些安全契約上。

## 下一批必須補齊

### APP-01：離線草稿與同步狀態

優先涵蓋：

- AI 創作工作台目標與提示詞草稿。
- Planner 筆記草稿。
- 未送出的表單內容。
- `已儲存在本機／等待同步／同步失敗／已同步` 狀態。
- 登出時清理屬於該帳號的本機敏感草稿。

AI 生成、審核、資料庫寫入仍需連線，不假裝完整離線可用。

### APP-02：真實裝置與正式網域驗收

必測：

- Android Chrome 安裝與獨立視窗。
- iPhone／iPad Safari 加入主畫面。
- Windows Chrome／Edge 安裝。
- macOS Chrome／Safari 使用與通知限制。
- 360、390、768、1280、1440 版面。
- 安裝後登入、Google Drive、Notion、推播深鏈、登出與重新登入。
- 部署新版後出現更新提示，更新後仍停在原路由。

正式來源與 OAuth 應保持一致：

```text
APP_URL=https://ai-os-app.zeabur.app
Google Drive callback=https://ai-os-app.zeabur.app/api/integrations/google-drive/callback
```

切換自有網域時，APP_URL、Google Cloud 授權來源、callback、Web Push 與所有分享連結必須在同一次發布完成，不能混用兩個正式來源。

### APP-03：桌面 companion／Tauri

APP-00～APP-02 通過後，桌面版第一批真正實作：

- 註冊 `aios://` protocol。
- 注入 `window.__AIOS_DESKTOP__` version 1 bridge。
- 受控下載與本機 cache manager。
- 系統 Open With。
- 在 Finder／檔案總管顯示。
- 交接紀錄與新 revision 上傳。
- Windows／macOS 簽章與自動更新。

### APP-04：手機 Capacitor（有原生需求才做）

- 相機、相簿、系統分享。
- 原生推播。
- App Links／Universal Links。
- 檔案選擇與上傳續傳。

原生外殼不得新增另一套業務流程；核心仍共用 Aios React 前端、Zeabur API、權限與資料模型。

## 手機與桌面的正確產品邊界

Aios 沒有獨立光球功能，不新增全域浮動 AI 角色。

手機與桌面都沿用真實功能：

- 作業台
- 專案與 AI 創作工作台
- 筆記排程
- 資料庫
- 私訊與協作
- 整合、通知與帳號

AI 能力存在於專案內的「問 AI／直接生成／製作範本／執行計畫」，不另外建立平行入口。

## APP-00 驗收

- [ ] `npm run typecheck`
- [ ] `npm run test:client -- pwa.test.ts desktopBridge.test.ts`
- [ ] `npm run build`
- [ ] 首次安裝不出現「有新版本」提示
- [ ] 部署新版後，已開啟的舊版顯示更新提示
- [ ] 未按更新時，正在輸入的內容不會被自動刷新
- [ ] 按「立即更新」後只重新載入一次
- [ ] 更新後保留原本的 pathname／query／hash
- [ ] 合法 `/p/:id` 可建立並解析 `aios://open` 深度連結
- [ ] 外部網址、未知路由與 path traversal 深度連結被拒絕
- [ ] 一般瀏覽器呼叫外部編輯器時回傳可理解的降級訊息
- [ ] 桌面橋接不接受 executable、shell args、本機路徑或任意下載 URL
- [ ] Chrome PWA、iOS 主畫面與一般瀏覽器皆不影響登入

## 不在本 PR

- 實際 Tauri／Capacitor 原生工程。
- 偵測使用者安裝了哪些剪輯軟體。
- 真正啟動 Premiere、Resolve、Final Cut、CapCut 等第三方軟體。
- 編輯完成檔案監看與自動回傳。
- App Store／Google Play 上架。
- 完整離線資料庫。
- 公開首頁與 `/dashboard` 路由搬移。
- 全站 UI 改版。
- 光球或新的 AI 角色。
