# Fable 5 執行規格：外部來源選檔／即時查檔 × 動態上下文預算

> **給 Claude Fable 5 / Claude Code 的工作單**  
> 分支建議：`feat/external-source-picker-context-budget`  
> 關聯產品方向：知識與資料匯入、Integrations、planAgentCore 上下文  
> 相關既有文件：`docs/google-drive-private-import-repair.md`、`docs/notion-integration-repair-notes.md`、`docs/Google日曆同步.md`  
> 與 #133／創作代理規格（PR #213）互補：彼處管計畫與決策軌跡；**本文件管外部資料如何進站與進代理**  
> 原則：使用者決定哪些檔案被讀；禁止預設整顆雲端灌進模型；最小可合併階段  
> **禁止**：一次重寫 integrations／knowledge／agentCore；禁止規劃時無確認的全 Drive 掃描入 prompt

---

## 0. 現況基線（已有，勿重做）

| 能力 | 位置 | 說明 |
|------|------|------|
| Google Drive OAuth（`drive.readonly`） | `server/services/integrations.ts` | 個人連線、加密憑證、401 刷新／失效標記 |
| 私人檔匯入政策 | 同上 + `googleDriveImportPolicy` 測試 | 帳戶線索、公開退回政策 |
| Notion 個人 integration | integrations | token 連線與匯入路徑 |
| 外部 API 連接 | integrations | https、SSRF、大小／時間上限 |
| 知識注入預算 | `knowledge.ts`：`INJECT_BUDGET=8000`；`agentCore`：`PLAN_KNOWLEDGE_BUDGET=6000` | **固定常數**，未依模型動態 |
| 規劃上下文 | `buildPlannerContext` + `buildKnowledgeContext` | 站內摘要包；外部須先匯入 |
| 排程 → Google 日曆 | `scheduleCore` / `googleCalendar` | 同步出站內排程，非規劃讀整本日曆 |
| Integrations UI | `client/src/pages/IntegrationsPage.tsx` | 連線狀態；選檔器尚未是主路徑 |

**產品缺口（使用者面）**

1. 主要靠**貼網址**匯入，不像雲端硬碟「選檔」。  
2. 網站帳號 ≠ Google 帳號，錯誤常在匯入失敗才暴露。  
3. 連線後**不會**自動進代理；使用者不清楚「AI 現在看得到什麼」。  
4. 無「僅本次計畫使用、不進庫」選項。  
5. 規劃預算不隨規劃模型檔位調整，長文易 silent 截斷。

---

## 1. 產品原則（強制）

1. **使用者決定範圍**：AI 只讀被明確選中或已匯入且在預算內的內容。  
2. **連接 ≠ 授權 AI 讀全雲端**。  
3. **Hybrid**：  
   - **主路徑 A**：檔案選擇器 → 匯入站內（知識庫／素材／資料庫文件）。  
   - **輔路徑 B**：即時搜尋 → 使用者勾選 → 僅本次或轉存。  
4. **帳號透明**：選檔 UI 永遠顯示目前連結的 Google／Notion 身分。  
5. **可稽核**：代理過程可列出「本次依據來源」（站內 id + 外部檔名），不存 raw CoT。  
6. **預算可見**：截斷時 UI 或規劃結果要能提示，避免拆腳本漏尾段卻無聲。

---

## 2. 階段切分（依序，可多 PR）

### PR-E1：Google 選檔器 + 匯入（使用者主路徑）

**目標**

使用者在「知識與資料」或工作台相關入口，用選檔器多選 Google Drive 檔案並匯入，不必只靠貼網址。

**使用者流程**

1. 若未連結 → 引導至 Integrations 連結 Google（文案說明：代理只讀你選的檔，不是整顆雲端）。  
2. 已連結 → 「從 Google 雲端選檔」→ Google Picker **或** 站內 `files.list` 瀏覽器（二選一，優先官方 Picker 若前端可行）。  
3. 標題／狀態列固定顯示：`目前以 {googleEmail} 瀏覽`。  
4. 多選 → 選目的地：知識庫（可選 kind：腳本／筆記…）／素材庫（若類型適合）。  
5. 進度與逐檔成功／失敗；失敗沿用 private import 錯誤文案（含分享給此帳號、重連）。  
6. 成功後可「查看並用於創作／規劃」。

**技術範圍（建議）**

- 前端：選檔入口元件（知識頁／工作台）；連線狀態與 email 來自既有 integrations API。  
- 後端：若 Picker 回傳 fileId，走既有 Drive 私人拉取＋文字抽取＋寫入 knowledge／assets 管線；**重用** `integrations` 的 token／401 政策，勿複製一套。  
- 權限：僅操作呼叫者自己的連線；組內不可用別人的 Google token。  
- 測試：政策與「未連結／無權限／401」文案；前端關鍵路徑若有測試慣例則補。

**驗收**

- [ ] 已連結使用者可不貼網址完成至少一種檔型匯入（如 Google 文件或 pdf）。  
- [ ] UI 顯示連結中的 Google email。  
- [ ] 未分享給該帳號的私人檔錯誤可理解。  
- [ ] 未連結時 CTA 清楚。

**邊界**：不做即時全盤掃描入規劃；不做 Notion Picker（PR-E3）；不改 Runner 執行語意。

---

### PR-E2：來源可見 +「僅本次／轉存」資料模型（規劃銜接）

**目標**

讓使用者知道代理看了什麼；支援「選了但先不進長期知識庫、只給這次規劃」。

**使用者流程**

1. 規劃前或選檔後：來源清單（站內知識／剛匯入／本次暫存）。  
2. 選項：  
   - **轉存進知識庫**（預設建議，可重複使用）  
   - **僅本次計畫**（TTL 暫存，過期清除或不可被其他 run 看到）  
3. 規劃結果／AgentCard「過程」可列 `contextUsed` 或來源 chips（與 #133 決策軌跡規格對齊欄位名更佳）。

**技術範圍**

- 最小方案：僅本次 = 寫入 knowledge 但標記 `ephemeral`／`sessionId` **或** 規劃 API 接受 `extraSourceIds[]`（已匯入 id）由後端組進 `buildKnowledgeContext` 優先段。  
- 優先把「使用者明確選中的檔」放在知識預算**最前**，降低截斷誤傷。  
- 截斷：規劃回應或 UI 使用 `buildKnowledgeContextWithMeta.truncated`（若規劃路徑尚未接 meta，補上）。

**驗收**

- [ ] 使用者能指出本次規劃用了哪些來源名稱。  
- [ ] 僅本次與轉存行為有文件與測試或手動驗證步驟。  
- [ ] 截斷時有可觀察提示（API 欄位或 UI）。

**邊界**：不實作完整「過程面板」若 #133 PR-2 已排程可只留 API／欄位；避免兩套 UI。

---

### PR-E3：即時查檔（輔路徑，需使用者勾選）

**目標**

「先搜尋我的雲端，再決定納入」——**禁止**搜尋結果自動全進 prompt。

**使用者流程**

1. 「搜尋 Google 雲端」輸入關鍵字（可選資料夾）。  
2. 結果列表：名稱、類型、修改時間、擁有者提示。  
3. 勾選 1～N 檔 → 「納入本次規劃」或「匯入知識庫」。  
4. 納入本次 = 拉取文字／摘要，受**單次字元上限**（建議硬頂，如每檔 8k、合計不超規劃預算的一部分）。

**技術範圍**

- Drive API search／list，token 同個人連線。  
- Rate limit、超時、錯誤文案與 E1 一致。  
- 稽核：可記「誰搜了、選了哪些 fileId」（勿記檔案全文到一般 log）。

**驗收**

- [ ] 未勾選的搜尋結果不得出現在規劃 prompt。  
- [ ] 勾選後有字數／截斷提示。  
- [ ] 未連結／授權失效路徑完整。

**邊界**：不做背景定期爬整碟；不做跨使用者搜尋。

---

### PR-E4：Notion／外部 API 對齊同一心智模型

**目標**

同一套：連接 → 選（頁／表）→ 預覽 → 匯入或僅本次。

**範圍**

- Notion：頁面選擇或搜尋（在既有 token 權限內），匯入沿用 notion import。  
- 外部 API：選已存連接 → 預覽端點／表（若已有）→ 匯入列或文件。  
- UI 文案與 Google 一致：顯示連接名稱、不暗示 AI 已讀全部。

**驗收**

- [ ] 三種來源在 Integrations／知識入口的操作步驟對使用者看起來同類。  
- [ ] SSRF／大小上限等既有守衛不放寬。

---

### PR-E5：動態上下文預算（對應規劃模型檔位）

**目標**

注入量隨**規劃模型檔位**調整，仍有產品硬頂；成本可控。

**建議策略**

```text
依 plannerMode / 實際 model：
  economy  → knowledgeBudget 較低（例如 4_000～6_000）
  balanced → 中（例如 8_000～12_000）
  quality  → 較高（例如 12_000～20_000）
硬頂 MAX_PLAN_KNOWLEDGE_CHARS（例如 24_000）不可超過
輸出預留：不佔用輸入預算計算時的「模型窗口臆測」也可先只做「檔位表」，
不必實作完整 tokenizer 對齊 1M 窗口。
```

**技術範圍**

- `planAgentCore`：依 `plannerMode` 選 budget 再呼叫 `buildKnowledgeContext`。  
- 使用者剛選中的來源優先排序。  
- UI：可選顯示「本次知識約注入 x 字／是否截斷」。  
- 測試：不同 mode 預算不同；硬頂不被突破。

**驗收**

- [ ] quality 可比 economy 注入更多（在有長知識時可測 truncated 差異）。  
- [ ] 仍無「灌滿模型最大 context」。  
- [ ] 文件註解更新：預算是產品檔位，不是模型窗口自動填滿。

**邊界**：不改生成模型（Fal 出圖）的 prompt 預算；只動**規劃**路徑。

---

## 3. 明確不做（Out of scope）

- 規劃／執行時無確認讀取使用者整顆 Google Drive 或 Notion workspace。  
- 用組內他人的 OAuth token。  
- 放寬 SSRF、取消加密憑證、把 refresh token 送前端。  
- 要求模型輸出 raw chain-of-thought。  
- 與 #133 Runner 新 kind 大重構綁死同一 PR。  
- Google 日曆雙向「讀全部行程進規劃」除非另開產品規格（現況是站內排程為準、可同步出）。

---

## 4. Fable 5 工作方式（強制）

```
讀 docs/product/FABLE5-執行規格-外部來源選檔與動態上下文.md。

目標：只實作文件中的 PR-E1（Google 選檔器 + 匯入）。
為什麼：使用者需要「選檔」而不是只貼網址；連接≠整雲端給 AI。

邊界：
- 只做 PR-E1
- 重用 server/services/integrations.ts 的 token 與錯誤政策
- 不實作即時全盤入 prompt
- 不重寫 agentCore 預算（留給 PR-E5）

方法：
1. 先讀 IntegrationsPage、integrations 服務、知識匯入入口、google-drive-private-import-repair.md
2. 短計劃：Picker vs 自建 list 的取捨與檔案路徑
3. 實作
4. 測試與手動驗證步驟寫進 PR 描述
5. 回報變更檔案、證據、剩餘風險
```

完成 E1 後，將提示中的 PR-E1 改為 PR-E2 再跑下一輪。

---

## 5. 完成定義（整包）

- [ ] Google：選檔匯入可用，帳號與權限文案清楚  
- [ ] 使用者可選轉存 vs 僅本次（或等效的 extraSource 優先）  
- [ ] 即時搜尋必須勾選才進上下文  
- [ ] Notion／外部 API 操作心智與 Google 對齊（至少文件＋一條主路徑）  
- [ ] 規劃知識預算依 plannerMode 分檔且有硬頂  
- [ ] 截斷與來源對使用者可見

---

## 6. 與其他規格的關係

| 文件／PR | 關係 |
|---------|------|
| PR #213（#133 創作代理／決策軌跡） | 過程面板與 `contextUsed`／rationale；本規格的「來源 chips」應對齊，勿重複造輪 |
| Issue #133 | 計畫步驟與站內筆記／排程；外部檔進站後才成為計畫的 sourceRefs 候選 |
| google-drive-private-import-repair | E1 必須遵守的錯誤與 token 行為 |

---

## 7. 參考路徑

- `server/services/integrations.ts`
- `server/services/googleDriveImportPolicy.test.ts`（若存在）／相關測試
- `server/routers/knowledge.ts`（`buildKnowledgeContextWithMeta`）
- `server/services/agentCore.ts`（`PLAN_KNOWLEDGE_BUDGET`、`planAgentCore`）
- `client/src/pages/IntegrationsPage.tsx`
- 知識／資料庫相關頁（匯入入口現況）
