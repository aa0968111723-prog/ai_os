# 計畫：Fal 帳戶餘額顯示 + 個人使用量與餘額顯示

> 狀態：Implemented + 方案 C（即時 TWD 對齊硬上限）  
> 相關：點數帳本 `quota.my` / `quota.consumptionStats`、Fal Platform Billing API、`fxRate` / `falCeiling`  
> 原則：Key 不進前端、Admin 與個人視圖分離、缺 Admin Key 時可降級（fail-open）  
>
> **進度備註（2026-07-31）：** Phase A 於 [#195](https://github.com/aa0968111723-prog/ai_os/pull/195)。**方案 C**：點數可花上限即時對齊 `floor(Fal USD × 即時 USD→TWD)`（1 點 = NT$1）；顯示層並顯 USD + NT$ + 點數上限；守門在 `checkQuota` / `reserveQuota`；不改寫歷史 `cost_ledger`。

## 1. 目標

1. **平台級**：在管理介面顯示 Fal.ai 帳戶真實 credits 餘額（USD）＋即時台幣等值＋可花點數上限。
2. **個人級**：每位登入使用者可清楚看到自己的點數剩餘、今日／本週使用量與額度上限。
3. **方案 C**：系統內點數採 **1 點 = NT$1**；可花上限即時對齊 Fal 台幣等值（硬上限，fail-open）。

## 2. 非目標（本計畫不做）

- **不**把匯率換算結果寫入歷史 `cost_ledger`（只在守門當下讀快取餘額）。
- 不在前端暴露任何 `FAL_KEY` / `FAL_ADMIN_KEY`。
- 扣／退點商業邏輯不變；僅新增 Fal 台幣等值硬上限層。
- 上游 Fal／匯率查詢失敗 → **fail-open**（不擋生成，只靠既有總預算／週額度）。

## 3. 現況

| 能力 | 狀態 |
|------|------|
| `quota.my` | 已有：totalBudget / totalUsed / totalRemaining、週／日額度與使用、組／個人預算剩餘 |
| `quota.usage` | 已有：組長看組內成員用量 |
| `quota.consumptionStats` | 已有：管理／組長消耗監控與異常告警 |
| Fal billing API | 官方：`GET https://api.fal.ai/v1/account/billing?expand=credits` |
| 現有 `FAL_KEY` | 可推論；打 billing 回 **403 authorization_error**（需 **Admin scope** key） |

官方成功回應形狀（摘錄）：

```json
{
  "username": "my-team",
  "credits": {
    "current_balance": 24.5,
    "currency": "USD"
  }
}
```

## 4. API 設計

### 4.1 後端服務 `server/services/falBilling.ts`

- 讀取 `process.env.FAL_ADMIN_KEY ?? process.env.FAL_KEY`
- `GET https://api.fal.ai/v1/account/billing?expand=credits`
- Header：`Authorization: Key <secret>`
- **記憶體快取** 60～120 秒（避免管理頁輪詢打爆）
- 錯誤分類：
  - 未設定 key → `not_configured`
  - 403 → `forbidden`（提示需 Admin Key）
  - 網路／5xx → `upstream_error`
  - 成功 → `{ username, balance, currency, fetchedAt }`

### 4.2 tRPC

| Procedure | 權限 | 說明 |
|-----------|------|------|
| `quota.falAccountBalance` | `adminProcedure`（建議僅 `isSuperAdmin`） | 回傳平台 Fal 餘額（USD + TWD + pointsCap）或結構化錯誤 |
| `quota.my` | 既有 `authedProcedure` | 增 `falPointsCap`；`totalRemaining` 與之取 min |
| `quota.consumptionStats` | 既有 | 管理儀表沿用 |

### 4.3 環境變數

在 `.env.example` 新增：

```bash
# 可選。查 Fal 帳戶 credits 需 Admin scope。
# 未設時後端會嘗試 FAL_KEY；若無權限則 UI 顯示「需 Admin Key」。
# FAL_ADMIN_KEY=
```

Zeabur／部署：僅後端環境注入，永不下發 client。

## 5. UI 設計

### 5.1 管理頁（開發者／超管）

位置：現有「點數與額度」區塊旁新增卡片 **「Fal 帳戶」**：

- 餘額：`$24.50 USD` + `約合 NT$…` + `可花點數上限 … 點`（或錯誤狀態文案）
- 匯率來源標示（live／備援）
- 帳戶：`username`
- 更新時間 +「重新整理」按鈕（尊重快取）
- 並排對照：**系統總預算剩餘（已含 Fal 上限取 min）** vs **Fal 可花上限** vs **Fal credits（USD≈NT$）**
- 短說明：1 點 = NT$1；硬上限即時對齊，不改寫歷史帳本

### 5.2 個人使用量與餘額（全體登入使用者）

強化既有資料源 `quota.my`：

| 區塊 | 內容 |
|------|------|
| 頂欄徽章 | 剩餘點數（週額或總剩餘，既有可微調文案） |
| 帳號選單／個人摘要 | 今日已用、本週已用、週額度、日額度、個人／組預算剩餘 |
| 可選簡易進度條 | `weeklyUsed / weeklyQuota`、`dailyUsed / dailyQuota`（null＝不限則不顯示上限） |

組長以上：管理頁繼續用 `consumptionStats` 看組／成員／專案消耗。

## 6. 實作階段

### Phase A（可先合併，不依賴 Admin Key）

1. `falBilling.ts` + `quota.falAccountBalance`（含 forbidden／not_configured）
2. 管理頁 Fal 卡片（錯誤態完整）
3. 個人側：帳號選單或小面板強化 `quota.my` 展示
4. `.env.example` 說明
5. 單元測試：mock fetch 成功／403／未設定

### Phase B（有 Admin Key 後驗證）

1. Zeabur 設定 `FAL_ADMIN_KEY`
2. 管理頁顯示真實 balance
3. 手動驗收：與 fal.ai dashboard billing 數字一致（允許快取延遲）

## 7. 檔案預估變更

| 路徑 | 變更 |
|------|------|
| `server/services/falBilling.ts` | 新增 |
| `server/services/falBilling.test.ts` | 新增 |
| `server/services/fxRate.ts` / `falCeiling.ts` | 方案 C 匯率與硬上限 |
| `server/routers/quota.ts` | `falAccountBalance` + `my.falPointsCap` |
| `client/src/pages/AdminPage.tsx` | Fal 卡片（USD + NT$ + 點數上限） |
| `.env.example` | `FAL_ADMIN_KEY` |
| 本文件 | 方案 C 政策 |

## 8. 驗收條件

- [x] 超管可呼叫 `quota.falAccountBalance`；一般組員 **FORBIDDEN**
- [x] 無 Admin 權限 key 時 UI 顯示明確提示，**不崩潰、不洩漏 key**
- [x] 有 Admin Key 時顯示 `current_balance` + `currency` + `fetchedAt`（Phase B 部署後對帳）
- [x] 60s 內重複請求走快取（測試或 log 可證明）
- [x] 登入使用者可在個人 UI 看到：今日已用、本週已用、相關剩餘（來自 `quota.my`）
- [x] 前端 bundle／網路面板無任何 Fal secret
- [x] typecheck + 既有 quota／points 相關測試通過
- [x] 方案 C：`checkQuota`／`reserveQuota` 在 Fal 餘額不足時拒絕；上游失敗 fail-open

## 9. 風險與回滾

| 風險 | 緩解 |
|------|------|
| 誤用一般 Key 打 billing | 錯誤碼 `forbidden` + 文件要求 Admin Key |
| 管理頁輪詢過密 | 服務端快取 + 前端手動重新整理為主 |
| 使用者混淆「點」與「USD」 | UI 明確標示 USD／NT$／點數上限與匯率來源 |
| 上游 Fal 短暫故障 | `upstream_error`，fail-open 不擋生成 |

回滾：還原本功能相關 commit 即可；不涉及 migration。

## 10. 方案 C：即時 TWD 對齊硬上限（2026-07-31）

| 元件 | 職責 |
|------|------|
| `server/services/fxRate.ts` | USD→TWD 即時匯率（frankfurter／ECB；失敗回退 31；快取 30 分） |
| `server/services/falCeiling.ts` | `getFalPointsCeiling` / `falCeilingReason`：`pointsCap = floor(usd × rate)` |
| `server/services/points.ts` | `checkQuota` / `reserveQuota` 交易外呼叫 `falCeilingReason`（fail-open） |
| `quota.my` | 回傳 `falPointsCap`；`totalRemaining` 與之取 min（有總預算時） |
| `quota.falAccountBalance` | 回傳 `balance` / `balanceTwd` / `rate` / `pointsCap` |
| 管理頁 Fal 卡 | 並顯 USD + NT$ + 點數上限 |

**政策摘要：** 1 點 = NT$1；單次扣點若超過 Fal 台幣等值上限 → 拒絕並提示儲值；不改寫歷史帳本列。

## 11. 後續可選

- 低餘額告警（Fal balance < 閾值 → 管理通知）
- FOCUS usage report（需更高權限與排程）
- 將平台 Fal 花費與站內 cost_ledger 做週報對帳（僅報表，不自動調帳）
