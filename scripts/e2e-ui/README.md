# UI 實測腳本（Playwright，真實瀏覽器操作）

與 `scripts/e2e-*.py`（API 層）互補：這裡用真實瀏覽器走完整使用者旅程。

| 腳本 | 覆蓋 |
|---|---|
| `golden-path.mjs` | 黃金路徑：登入→建案→世界觀→知識庫→拆分鏡→逐格生成/配音→送審→通過→粗剪預覽→下載交付→AI 代理 |
| `verify-workbench.mjs` | 工作台三幕結構、摘要條、選項就地新增、跨卡跳轉 |
| `verify-deep.mjs` | 世界觀進階編輯、導演存分鏡、勾選持久化、逐格模型、彈窗注入 |
| `verify-agent.mjs` | AI 代理全生命週期（規劃→核准→背景執行→放棄） |
| `audit-routes.mjs` | 全路由 × 360／390／768／1280／1440 基線；確認登入、輸出 manifest，任一失敗即非 0 |
| `audit-breakpoints.mjs` | **MOB-04**：關鍵頁 × 同上 viewport 水平溢出斷言；可選登入 + `/p/:id`；fail-closed |
| `verify-phone-ai-first.mjs` | **#766**：`<768px` 手機殼層、平板/桌機不外洩、首頁與開專案的 JS/API 預算 |
| `verify-phone-action-first.mjs` | **Phone v2**：上下文補完、工作卡只反映真實狀態（不得假結果／假百分比）、卡片不拉工作台、桌面零外洩 |

## 安裝與啟動

需先起伺服器；`E2E_MOCK=1` 為假生成、帶真金鑰為真實生成。

```bash
npm ci
npx playwright install chromium
E2E_UI_BASE=http://127.0.0.1:3210 node scripts/e2e-ui/golden-path.mjs
```

既有旅程腳本的截圖與下載產物落在 `E2E_UI_OUT`（預設 `./e2e-ui-out`）。

## 全路由 UI/UX 基線

`audit-routes.mjs` 不使用假預設帳密；缺少帳密、登入失敗、路由被導向、水平溢出、手機觸控目標小於 44px、
serious／critical 無障礙缺陷、console error 或任一 viewport 截圖失敗，都會以非 0 結束。公開 `/`、`/login`
會在登入前驗證；登入後從 `/dashboard` 起完整巡覽受保護路由。

```bash
TARGET_URL=https://ai-os-app.zeabur.app \
TEST_EMAIL='你的測試帳號' \
TEST_PW='你的測試密碼' \
TEST_ROLE='creator' \
TEST_PROJECT_ID='可讀的專案 UUID' \
TEST_PEER_ID='可私訊的使用者 UUID' \
OUT_DIR='./docs/uiux-audit/screenshots/creator' \
node scripts/e2e-ui/audit-routes.mjs
```

輸出：

- 各路由／viewport 截圖
- 1280px 路由文字快照
- `audit-manifest.json`：角色、帳號、實際 URL、viewport、標題、成功／失敗

若未提供 `TEST_PROJECT_ID` 或 `TEST_PEER_ID`，腳本會明確警告，不能把核心專案頁或一對一私訊宣稱為已驗收。

## 斷點水平溢出（MOB-04）

`audit-breakpoints.mjs` 比全路由 audit 輕：固定 viewport 集合，對 `/`（與可選 `/p/:id`）斷言無水平溢出。設了 `TEST_PROJECT_ID` 卻缺 `TEST_EMAIL`／`TEST_PW` 時 **fail-closed**（非 0）。詳見 [`docs/uiux-audit/mobile-baseline.md`](../../docs/uiux-audit/mobile-baseline.md)。

```bash
# 僅公開 /
TARGET_URL=http://127.0.0.1:3000 node scripts/e2e-ui/audit-breakpoints.mjs

# 含工作台
TARGET_URL=http://127.0.0.1:3000 \
TEST_EMAIL='…' TEST_PW='…' TEST_PROJECT_ID='…' \
node scripts/e2e-ui/audit-breakpoints.mjs

# 只要 assert
SKIP_SCREENSHOTS=1 TARGET_URL=http://127.0.0.1:3000 node scripts/e2e-ui/audit-breakpoints.mjs
```

正式站測試帳號請使用專用低權限帳號；不要把密碼、Token 或真實使用者資料提交到 Git。
