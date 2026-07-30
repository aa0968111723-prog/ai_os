# Mobile baseline（MOB-04）

360 / 390 手機斷點的驗收條件與回歸方式。對應產品斷點表：Phone **S ≤ 560px**（`@media (max-width: 560px)`）。

## Pass conditions（必過）

| 條件 | 說明 |
|------|------|
| **水平溢出 = 0** | 各 viewport 載入後 `document.documentElement.scrollWidth ≤ clientWidth + 1`（body 一併檢查）。容差 +1px 與 `audit-routes.mjs` 一致。 |
| **MOB-03 工作台 tabs 2×2** | 在 ≤560px，`.creation-mode-tabs` 為 `grid-template-columns: 1fr 1fr`（四模式 2×2），`.creation-mode-tab` `min-height ≥ 64px`。 |
| **長任務可離開文案** | 生成確認與進行中列須明示可離開／完成推播（見下）。 |

### Viewport 集合

| 名稱 | 寬 × 高 | 角色 |
|------|---------|------|
| S-360 | 360 × 800 | 小手機下限 |
| S-390 | 390 × 844 | 常見 iPhone 邏輯寬 |
| M-768 | 768 × 1024 | 平板直向 |
| L-1280 | 1280 × 800 | 桌面 |
| XL-1440 | 1440 × 900 | 寬桌面 |

S-360 / S-390 為本文件的「手機 baseline」；腳本對五檔皆做溢出斷言。

## MOB-03 CSS 契約（`client/src/styles.css`）

預設（寬螢幕）四欄：

```css
.creation-mode-tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
```

≤920px 先收成兩欄；**≤560px（S）強制 2×2 + 拇指高度**（MOB-03 註解區，取 styles 檔案中最後一個 `@media (max-width: 560px)` 區塊）：

```css
/* MOB-03：S 手機強制 2×2 工作台模式格（拇指可點，min-height ≥64） */
.creation-mode-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  /* … overflow: visible; 不橫滑 … */
}
.creation-mode-tab {
  min-height: 64px;
}
```

根層防橫向捲動（全站）：

```css
html { overflow-x: clip; }
body { overflow-x: clip; }
```

純單元契約（不需伺服器）：

```bash
npx vitest run client/src/features/creation-workbench/__tests__/mob03LongTaskCopy.test.ts
# 或
npm run test:client -- client/src/features/creation-workbench/__tests__/mob03LongTaskCopy.test.ts
```

## 長任務 leave copy 期望

| 位置 | 期望字串（契約） |
|------|------------------|
| 直接生成確認面板（`DirectGenerateMode.tsx`） | `可關閉此頁，完成會推播到已連結裝置` |
| 進行中／佇列生成列（`GenerationList.tsx`） | `背景執行中，可離開`（`queued` / `running`） |

背景 runner 不綁前端 cookie 生命週期；完成後推播到已連結裝置——文案必須讓使用者敢離開頁面。

## 如何跑斷點溢出腳本

需本機（或可達的）前端 BASE；**不依賴**腳本內假帳密。

```bash
# 僅公開頁 `/`（無需帳密）
TARGET_URL=http://127.0.0.1:3000 \
  node scripts/e2e-ui/audit-breakpoints.mjs

# 含工作台 /p/:id（fail-closed：缺帳密即非 0）
TARGET_URL=http://127.0.0.1:3000 \
TEST_EMAIL='你的測試帳號' \
TEST_PW='你的測試密碼' \
TEST_PROJECT_ID='可讀的專案 UUID' \
  node scripts/e2e-ui/audit-breakpoints.mjs

# 略過截圖、只要 assert + console
SKIP_SCREENSHOTS=1 TARGET_URL=http://127.0.0.1:3000 \
  node scripts/e2e-ui/audit-breakpoints.mjs
```

亦可用 `E2E_UI_BASE` 代替 `TARGET_URL`。截圖與 `breakpoint-audit-manifest.json` 預設寫入 `docs/uiux-audit/screenshots/breakpoints/`（`OUT_DIR` 可覆寫）。

### 環境變數

| 變數 | 必要？ | 說明 |
|------|--------|------|
| `TARGET_URL` / `E2E_UI_BASE` | 否 | 預設 `http://localhost:3000` |
| `TEST_EMAIL` / `TEST_PW` | 有 `TEST_PROJECT_ID` 時必填 | 登入；缺則 fail-closed |
| `TEST_PROJECT_ID` | 否 | 有則巡覽 `/p/:id` |
| `OUT_DIR` | 否 | 截圖／manifest 目錄 |
| `SKIP_SCREENSHOTS` | 否 | `1` / `true` 時不截圖 |

### 與全路由 audit 的關係

- `audit-breakpoints.mjs`：**輕量**斷點 × 關鍵頁溢出斷言（MOB-04）。
- `audit-routes.mjs`：全路由 × 溢出 + 觸控 44px + a11y + console（較重）。

兩者皆以非 0 表示失敗；CI 若無常駐伺服器／測試帳密，至少應跑 `mob03LongTaskCopy` 純契約；完整斷點腳本在有 BASE（及可選帳密）的環境執行。

## 限制

- 腳本需要可連線的 `TARGET_URL`（本機 dev 或部署預覽）；**不**在無伺服器的 unit CI 內強制跑 Playwright。
- 未設 `TEST_PROJECT_ID` 時只驗公開 `/`，工作台 2×2 的**視覺**需靠 CSS 契約測試 + 有專案 fixture 時的 e2e。
- 正式站請用專用低權限帳號；勿把密碼提交進 Git。
