# Aios 應用程式落地 APP-00

| 欄位 | 內容 |
|---|---|
| 狀態 | Implementation Baseline |
| 日期 | 2026-07-29 |
| 產品範圍 | Aios Web／PWA，手機、平板、桌面 |

## 現在最應該做什麼

Aios 已經有 manifest、Service Worker、安裝入口、離線殼與跨裝置推播，因此目前最優先的不是直接加入 Capacitor、Tauri，也不是新增不存在的「光球」。

第一優先是把目前 PWA 補成可長期使用、可安全升級、可驗收的正式應用程式：

1. 新版不得在使用者編輯途中自動接管與刷新。
2. 新版下載完成後要有清楚的「立即更新」提示。
3. 更新完成後回到原本頁面，不破壞既有深鏈。
4. 手機與桌面必須用真實裝置驗收安裝、登入、通知、檔案匯入及更新。
5. 正式站的 `APP_URL`、Google OAuth callback、Notion／Google Drive 整合必須使用同一個正式來源。

本 PR 完成第 1～3 項的程式基線，並把第 4～5 項列為部署驗收。

## 本 PR 實作

- Service Worker 更新不再自動 `skipWaiting`。
- 新版完成安裝後先進入 waiting 狀態。
- Aios 顯示「有新版本」提示，由使用者主動按「立即更新」。
- 只有使用者確認更新後，才讓新版 Service Worker 接管並重新載入。
- App 回到前景時主動檢查新版。
- 補上更新條件單元測試。

## 為什麼先做這個

目前 Aios 已可被安裝，但若沒有可控更新流程，使用者可能長期停在舊版，或在輸入提示詞、筆記、專案資料時遇到版本切換。這會直接影響「像真正 App 一樣穩定」的核心感受。

原生包裝不能解決這個問題；Capacitor 或 Tauri 只會把同一個未完成的更新與資料安全問題包進原生外殼。

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

### APP-03：原生外殼決策

只有 APP-00～APP-02 通過後，再決定是否需要：

- Android／iOS Capacitor：相機、相簿、系統分享、原生推播、App Links。
- Windows／macOS Tauri：拖曳檔案、系統通知、快捷鍵、自動更新。

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
- [ ] `npm run test:client -- pwa.test.ts`
- [ ] `npm run build`
- [ ] 首次安裝不出現「有新版本」提示
- [ ] 部署新版後，已開啟的舊版顯示更新提示
- [ ] 未按更新時，正在輸入的內容不會被自動刷新
- [ ] 按「立即更新」後只重新載入一次
- [ ] 更新後保留原本的 pathname／query／hash
- [ ] Chrome PWA、iOS 主畫面與一般瀏覽器皆不影響登入

## 不在本 PR

- Capacitor／Tauri 初始化。
- App Store／Google Play 上架。
- 完整離線資料庫。
- 公開首頁與 `/dashboard` 路由搬移。
- 全站 UI 改版。
- 光球或新的 AI 角色。
