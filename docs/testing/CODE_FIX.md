# Codex 修復清單 — AI 助手全維度測試缺陷

> **產生日期**：2026-08-12
> **測試基準**：ai_os @ b1511581 (PR #682 merge)
> **測試方法**：19 位 AI 員工 + CEO 程式碼層稽核
> **總缺陷數**：21 個（已修復 4 個，待修復 17 個）

---

## 修復優先序

| 優先級 | Issues | 說明 |
|---|---|---|
| 🔴 P0 | #660, #661, #662, #663, #664, #665 | 使用者可直接感知的錯誤行為 |
| 🟡 P1 | #667, #669, #670, #671, #672, #673, #675 | 功能缺損或潛在風險 |
| 🟢 P2 | #676, #677, #678, #680 | 輕微 UX 或可觀測性問題 |

## 已修復（無需處理）

| Issue | 說明 | 修復 PR |
|---|---|---|
| #668 | computerRuntime 404 | 已修復（路由對齊） |
| #674 | 成員代號漂移 | 已修復（加 ORDER BY） |
| #679 | LRU O(n²) | PR #681 已 merge |
| #681 | LRU 修復 | 同上 |

---

## 🔴 P0 — 使用者可感知錯誤

### #660 U1：簡單提問誤判為 AGENT 模式
- **檔案**：`shared/assistantExecution.ts:124`
- **問題**：`QUESTION_RE` 缺少讀取型動詞（列出、清單、顯示、查看），導致「幫我列出我目前有哪些專案」中的「列出」未被辨識為提問，被 `ACTION_RE` 吃掉後走 DIRECT_TOOL
- **修復**：在 `QUESTION_RE` 加入 `|列出|清單|顯示|查看|查詢|找出來|有哪些`
- **驗證**：輸入「幫我列出我目前有哪些專案」→ SSE 應回 plan.intent=ASK

### #661 U2：專案清單回覆遺漏部分專案
- **檔案**：`server/routers/globalAssistant.ts`（group_overview 邏輯）
- **問題**：site-ask 列舉專案時回 15/17，漏「D」與「Manus 完整測試專案」
- **修復**：檢查 group_overview 專案列舉是否有隱式分頁/過濾；確認 `projects.list` 與 assistant 查詢用同一資料源無過濾差異
- **驗證**：site-ask 列專案數量 = `projects.list` 回傳數量

### #662 U3：「哪一個專案最舊」排序不正確
- **檔案**：`shared/assistantSemanticResolution.ts`
- **問題**：語意解析對「最舊」的時間排序邏輯可能與預期相反
- **修復**：確認 `resolveAssistantSemantics` 對「最舊/最早/最久」等詞的排序方向正確（ASC by createdAt）
- **驗證**：問「哪一個專案最舊」→ 回覆應為最早建立的專案

### #663 U11：QUESTION_RE 缺少讀取型動詞
- **檔案**：`shared/assistantExecution.ts:124`
- **問題**：同 #660 根源——`QUESTION_RE` 覆蓋不足
- **修復**：與 #660 合併修復，在 `QUESTION_RE` 補入：`列出|清單|顯示|查看|查詢|找出來|有哪些|有幾個|多少`
- **驗證**：「列出所有成員」「有多少個專案」「顯示全部筆記」→ 全部 ASK

### #664 U18：SOURCE_PICKER 無逾時機制
- **檔案**：`server/routers/globalAssistant.ts:856-1024`
- **問題**：SOUR_PICKER 有 TTL 30min (`INTERACTION_TTL_MS`)，但 cancel/「稍後再選」後 `activeGoal` 仍殘留不重置
- **修復**：在 `cancelInteraction` 或等價路徑加入 `activeGoal = null`（或至少清除 `pendingInteraction`）
- **驗證**：觸發 SOURCE_PICKER → cancel → 關掉再開對話框 → activeGoal 應已清除

### #665 U4：連續對話上下文被截斷
- **檔案**：`shared/assistantConversation.ts`、`server/routers/globalAssistant.ts`
- **問題**：history 上限 8 則，跨輪無重用機制。長對話中舊資訊被截斷後無法恢復
- **修復**：考慮摘要機制（超過上限時 LLM 摘要前文）或提高上限至 16-20；或加 RAG 檢索舊輪
- **驗證**：連續 10+ 輪對話後問「我們第一輪聊了什麼」→ 應能回答（非「我不確定」）

---

## 🟡 P1 — 功能缺損

### #667 U5：certification 0/4 → /api/ready 503
- **檔案**：`server/services/agentToolRegistry.ts`、`server/services/agentCapabilityCertification.ts`
- **問題**：4 支 tool 全部 `DECLARED_ONLY`——從未跑過 production_smoke 認證
- **修復**：執行 `agents.certifyPracticalCapability` production_smoke 流程，把 4 支 tool 寫入 `agentCapabilityCertifications`
- **驗證**：`/api/ready` 回 200（certification >= 1）

### #669 U7：AGENT 工作過程步驟顯示統一一律顯示相同文案
- **檔案**：`server/routers/globalAssistant.ts`（onRound 步驟列表）
- **問題**：不同查詢（列專案 vs 排計畫 vs 建任務）的工作過程顯示相同靜態文案
- **修復**：依 `capabilityId` 或 `intent` 動態生成步驟名稱（如「列出所有專案」vs「分析專案進度」vs「建立任務」）
- **驗證**：不同查詢 → 工作過程步驟名稱不同

### #670 U12：extractJsonObject 貪婪 regex 可能合併多個 JSON
- **檔案**：`server/services/assistantCore.ts`
- **問題**：對多個獨立 JSON 物件（非巢狀），貪婪 regex 可能把兩個合法 JSON 合併成一個無效的
- **修復**：加入「第一個完整 JSON 後截斷」邏輯（檢測 top-level `}` 配對後停止）
- **驗證**：LLM 回傳 `{"a":1}\n{"b":2}` → 只取第一個 `{"a":1}`，不合成 `{"a":1}\n{"b":2}`

### #671 U13：特殊字元輸入導致助手行為異常
- **檔案**：`server/routers/globalAssistant.ts`（輸入處理）
- **問題**：使用者輸入含特殊字元（不可見 Unicode、零寬字元、RTL override）時助手行為異常
- **修復**：在 `classifyAssistantRequest` 前 strip 不可見字元（`[​-‏ - ﻿]`），保留 emoji/中日韓文字
- **驗證**：輸入含 zero-width space → 正常處理（不 crash、不誤分類）

### #672 U14：agentCore billing 退款邏輯審查
- **檔案**：`server/services/agentCore.ts:786-865`
- **問題**：安全審查確認**無漏洞**——兩種失敗模式分別處理、供應商用量獨立計價。本 issue 可關閉。
- **修復**：無需修復；關閉 issue 並附安全審查結論
- **驗證**：code review passed

### #673 U19：格式修復只做一次
- **檔案**：`server/services/assistantCore.ts`
- **問題**：LLM 吐壞 JSON 時只嘗試修復一次，第二次仍壞就直接降級純文字——可能讓可修復的 minor error 也被放棄
- **修復**：考慮嘗試 2 次修復（常見模式：修 bracket → 修 trailing comma → 仍壞才降級）
- **驗證**：連續 2 次壞 JSON → 第二次仍嘗試修復 → 仍壞才 fallback

### #675 U21：Google Photos 被封鎖時無替代路徑
- **檔案**：`server/routers/globalAssistant.ts`（遠端來源處理）
- **問題**：Google Photos 被封鎖時只顯示 blocked，無替代匯入路徑提示
- **修復**：在 blocked 訊息中加入替代方案（「你可以從 Google Drive 匯入、或手動上傳到素材庫」）
- **驗證**：問「幫我從 Google 相簿匯入」→ blocked 訊息含替代路徑

---

## 🟢 P2 — 可觀測性與 UX

### #676 U8：/api/health 回 build.sha = null
- **檔案**：`server/services/deploymentIdentity.ts`、`server/index.ts`
- **問題**：`currentDeploymentIdentity` 讀取多個 env var（BUILD_SHA → ZEABUR_GIT_COMMIT → GIT_SHA → …），全部未設時回 null
- **修復**：在 Zeabur deploy 設定中注入 `BUILD_SHA` 環境變數（從 `ZEABUR_GIT_COMMIT` 或 CI 注入）
- **驗證**：`/api/health` → `build.sha` ≠ null

### #677 U9：AI 助手對話框載入時閃爍
- **檔案**：`client/src/components/GlobalAssistantSheet.tsx`
- **問題**：`lazy(() => import(AICreativeCopilot))` + `Suspense fallback` 只有一行「助手載入中…」文字，無骨架/動畫/進度
- **修復**：將 fallback 換成 skeleton（模擬對話框骨架）+ 品牌過渡動畫；或拆分 chunk 降低 lazy 延遲
- **驗證**：首次按 AI 助手球 → 看到骨架動畫（非單行文字），1-2 秒後平滑過渡到對話框

### #678 U10：手機版底部導航 active 狀態無視覺回饋
- **檔案**：`client/src/components/MobileNavigation.tsx`
- **問題**：active 分頁無顏色變化或縮放效果
- **修復**：加入 CSS：active 分頁 primary 上色 + `scale(.92)` 點擊回饋 + `tap-highlight-color: transparent` + `touch-action: manipulation`
- **驗證**：手機點選導航分頁 → active 頁有顏色變化 + 短暫縮放回饋
- **參考**：前端工程師已在 PR #683 測試中加入 CSS 契約驗證，可參考其 test case

### #680 U20b：成員代號截斷未揭露
- **檔案**：`server/routers/globalAssistant.ts`（成員序列化）
- **問題**：成員超過 N 位時截斷，不揭露「另有 N 位未列」
- **修復**：截斷時在最後加入 `另有 N 位未列（限於篇幅）`
- **驗證**：大組別查詢「列出所有成員」→ 截斷處顯示「另有 N 位未列」

---

## 環境性阻塞（非程式碼缺陷）

以下項目因網站 502/瀏覽器執行端離線而無法實測，待環境恢復後補測：

1. **UX 審查（桌面版）**：需瀏覽器實機互動
2. **UX 審查（手機版）**：需手機端實機互動
3. **30+ 情境模擬**：需網站 online 逐項發問
4. **E2E 完整流程 S4/S5**：跨裝置/中斷恢復需真實 UI 切換
5. **跨功能整合未測清單**（10 項，見跨功能整合報告 f63912f8）

---

## 修復順序建議

```
第一波（P0 語意層）：
  #660 + #663（合併：QUESTION_RE 補動詞）
  → #664（SOURCE_PICKER cancel 清 activeGoal）
  → #661（專案列舉完整性）

第二波（P1 功能層）：
  #667（certification 認證）
  → #669（工作過程動態步驟）
  → #670 + #673（JSON 解析強化）
  → #671（特殊字元 strip）
  → #675（blocked 替代路徑）

第三波（P2 UX 層）：
  #677（載入骨架）
  → #678（導航回饋）
  → #676（build.sha）
  → #680（成員截斷提示）
  → 關閉 #672（安全審查確認無漏洞）
```

---

*由 CubeLV CEO 直轄彙整 · 2026-08-12*
*測試動員：19 位 AI 員工 · 安全稽核：CEO 程式碼層全覆蓋*
