# Opus 5 完整執行總規：AI 代理 × 外部資料 × MCP 全面化

> **給 Claude Opus 5（雲端／只讀 GitHub）的權威工作單**  
> 本文件為**總索引 + 強制順序 + 全域邊界**。細節以子規格為準，勿與子規格矛盾時自創第三套語意。  
> 子規格：  
> - `docs/product/FABLE5-執行規格-133-創作代理-決策軌跡.md`（PR #213）  
> - `docs/product/FABLE5-執行規格-外部來源選檔與動態上下文.md`（PR #214）  
> - `docs/google-drive-private-import-repair.md`  
> 本 PR **只加總規**；runtime 請開 `feat/agent-system-opus-run`（或同等）實作並另開 PR。

---

## 0. 最終目標（北極星）

創作團隊在站內（與經 MCP 的外部助理）使用**可核准、可稽核、可接外部資料**的 AI 代理：

1. 目標 → 只讀被允許的上下文 → 完整或短版計畫 → 人核准 → 執行 → 產出落在專案。  
2. Google／Notion／外部庫：**使用者選取**後才進站或進本次上下文。  
3. 過程看得見（結構化 rationale／來源／事件），**不是** raw chain-of-thought。  
4. 網頁與 MCP **共用 core**（notesCore、scheduleCore、planAgentCore、integrations）；禁止第二條扣點路徑。  
5. MCP 更全面，但讀多寫嚴；對齊 2026 工具 annotations／意圖分組；MCP Apps／Tasks 為可選增強，不擋主路徑。

**成功體驗**：連 Google → 選檔 → 下目標 → 看懂計畫與依據 → 核准 → 得成品／筆記／待辦；外部 Cursor／Claude 經 MCP 能做對等的讀寫與規劃，且唯讀金鑰不能寫入。

---

## 1. 環境（雲端 GitHub）

- 工作區 = `aa0968111723-prog/ai_os`。  
- clone／fetch 遠端；以 default 分支為準（常見 `claude/healing-migration-ai-os-erewp2`，以實際 HEAD 為準）。  
- 實作分支：`feat/agent-system-opus-run`（不要把大量 runtime 塞進本 docs 分支）。  
- 交付：commit + 指向 default 的 PR；每階段更新 PR 描述（階段編號、路徑、驗證、風險）。  
- 不要假設本機瀏覽器或使用者桌面檔案。

---

## 2. 全域禁止

- 一次平行做完所有階段或單一巨型「全改」PR（可連續跑，但**排隊**）。  
- 重寫 `agentRunner` 狀態機；第二套執行／扣點路徑。  
- Prompt 要求輸出 chain-of-thought／「全部思考過程」。  
- 未確認讀取整顆 Google Drive／Notion workspace。  
- 使用他人 OAuth；放寬 SSRF；憑證原文進前端。  
- 破壞舊 plan JSON、既有 Drive 401 政策、mcpCatalog 與 handler 分叉（**catalog 為單一真相**）。  
- 將 RLS／全站資安大修／備份演練塞進本總規。

---

## 3. 強制總順序（Opus 連續執行）

每階段：短計劃 → 實作 → 測試能跑則跑 → 報告 → **自動進下一階**（僅硬邊界或規格未覆蓋的產品歧義才停）。

### 波次 A — 站內決策與契約（#213）

| 序 | ID | 內容 | 權威細節 |
|----|-----|------|----------|
| 1 | A1 | `rationale`／`contextUsed` schema + 規劃輸出；禁 CoT；舊 JSON 相容 | #213 PR-1 |
| 2 | A2 | AgentCard／PlanMode：過程面板、深連結、outputRefs；來源展示預留共用契約 | #213 PR-2 |

### 波次 B — 外部選檔主路徑（#214）

| 序 | ID | 內容 | 權威細節 |
|----|-----|------|----------|
| 3 | B1 | Google **選檔器 + 匯入**；顯示 Google email；重用 integrations | #214 PR-E1 + drive repair doc |
| 4 | B2 | 來源可見 + 轉存／僅本次（或 extraSource 優先）；截斷可觀察；**與 A2 同一套來源 UI／欄位** | #214 PR-E2 |

### 波次 C — 創作短版與代理完整感（#213）

| 序 | ID | 內容 | 權威細節 |
|----|-----|------|----------|
| 5 | C1 | `playbook.creation.short.v1` + 工作台入口；預設不灌大量 schedule | #213 PR-3 |
| 6 | C2 | 規劃前專案全貌摘要（精簡、可控 token） | #213 PR-4 |

### 波次 D — MCP 全面化（本總規專章，見 §4）

| 序 | ID | 內容 |
|----|-----|------|
| 7 | D1 | `mcpCatalog` + handlers：**annotations**（readOnly／destructive／idempotent／openWorld）對齊既有 read/write；不改變行為 |
| 8 | D2 | **M1**：`add_note`／`append_note`；`update_schedule_item` → notesCore／scheduleCore |
| 9 | D3 | **M2**：`list_tasks`／`create_task`；（若站內已有）`resume_agent` |
| 10 | D4 | **M3**：`list_knowledge`／`get_knowledge`（截斷）、`list_scenes`（唯讀摘要） |
| 11 | D5 | **M4**：`plan_agent` 擴充 `plannerMode`／短版 playbook 旗標 |

### 波次 E — 外部進階與預算（#214）

| 序 | ID | 內容 | 權威細節 |
|----|-----|------|----------|
| 12 | E1 | Google 即時搜尋；**勾選後**才進上下文或匯入 | #214 PR-E3 |
| 13 | E2 | 依 `plannerMode` 動態知識預算 + 硬頂；選中來源優先 | #214 PR-E5 |
| 14 | E3 | schedule／task **effect 冪等**測試 | #213 PR-5 |
| 15 | E4 | Notion／外部 API UX 對齊（選→預覽→匯入／僅本次） | #214 PR-E4 |
| 16 | E5 | **M5**（可選）：`get_integrations_status`；`import_drive_file`（fileId，本人 token）— **禁止**全盤 list 當預設寫入 |

### 波次 F — 可選協定增強（不擋合併主路徑）

| 序 | ID | 內容 |
|----|-----|------|
| 17 | F1 | （可選）長跑與 `agent_run` 對齊 Tasks 風格的進度欄位文件化或薄封裝 |
| 18 | F2 | （可選）MCP Apps：計畫預覽／進度卡——僅當主路徑已穩且工時允許 |

---

## 4. MCP 全面化規格（D 波次細節）

### 4.1 原則

- 所有新工具先寫入 `shared/mcpCatalog.ts`，再實作 `server/services/mcp.ts`（或現有分派處）。  
- **呼叫既有 core**，禁止 MCP 內重複業務 SQL。  
- 寫入 = `access: "write"`；唯讀金鑰必須繼續被擋。  
- 列表／讀取：**截斷**；錯誤繁中、可行動。  
- Annotations 建議對照：  
  - read 工具：`readOnlyHint: true`  
  - 寫入非破壞：`readOnlyHint: false`, `destructiveHint: false`, 能冪等則 `idempotentHint: true`  
  - 放棄／刪除類：`destructiveHint: true`  
  - 觸及 Google／外部網路：`openWorldHint: true`

### 4.2 意圖型（優先於堆 CRUD）

在 primitive 齊全後，若仍有餘力：

- 保持 `get_project_status` 為規劃前首選。  
- `plan_agent` 支援短版，避免外部模型自己拼 15 次 tool call。

### 4.3 明確不做（MCP）

- 預設「搜尋並讀取使用者全部 Drive 檔進入模型」。  
- 刪除資料庫整表、匯出全部私訊、繞過專案／組 ACL。  
- catalog 與專區頁、readOnly 守衛三處文案不一致。

### 4.4 驗收（MCP）

- [ ] `tools/list` 含新工具與 annotations（若協議層可暴露）。  
- [ ] 唯讀 token 呼叫寫入工具被拒。  
- [ ] 筆記／排程寫入與網站 ACL 一致。  
- [ ] 單元或整合測試覆蓋新 handler 主路徑與拒絕路徑。

---

## 5. 與子規格欄位對齊（防兩套 UI）

| 概念 | 統一 |
|------|------|
| 計畫說明 | `summary.rationale`、步驟 `rationale` |
| 用了哪些上下文 | `contextUsed: string[]` 與／或來源 chips（顯示名稱，非強制 UUID） |
| 過程事件 | 既有 `agentEvents`（可驗證事實） |
| 截斷 | `buildKnowledgeContextWithMeta.truncated` 對規劃／UI／MCP 錯誤或欄位可見 |
| 短版創作 | `playbook.creation.short.v1` 與 `plan_agent` 旗標同一語意 |

---

## 6. 現況基線（勿重做）

- `shared/plan.ts`、notesCore／taskCore／scheduleCore、Runner 多 kind、agentEvents  
- 職能 playbook、MCP 既有 30+ 工具（生成、庫、plan/approve/stop、排程讀寫部分、筆記讀、DM…）  
- Google Drive OAuth 與私人匯入修復政策  
- 規劃固定摘要預算（後由 E2 分檔，不是灌滿模型窗口）

---

## 7. 歧義預設

- Google 選檔：Picker 或自建 list，選**較小且能重用 fileId 匯入管線**者。  
- 僅本次：可先「匯入 + 優先進預算／extraSourceIds」；完整 ephemeral TTL 可列後續。  
- A2 與 B2 來源 UI：**只做一套**。  
- F 波次可整波跳過並在總報告註明「未做可選協定增強」。

---

## 8. 每階段報告格式（對使用者／PR）

```
階段: <ID>
變更路徑: ...
驗證: 測試指令或手動步驟
風險: ...
下一階段: <ID>
```

全部完成後附「對照 §0 北極星的總驗收表」。

---

## 9. 給 Opus 5 的啟動指令（可複製）

```
你在雲端，工作區為 GitHub aa0968111723-prog/ai_os。

必讀：
- docs/product/OPUS5-完整執行總規-代理外部資料與MCP.md（本總規，順序與 MCP 以這份為準）
- docs/product/FABLE5-執行規格-133-創作代理-決策軌跡.md
- docs/product/FABLE5-執行規格-外部來源選檔與動態上下文.md
- docs/google-drive-private-import-repair.md

目標：依總規 §3 強制順序，從 A1 連續實作到 E5（F 可選）。
交付：分支 feat/agent-system-opus-run 上的 commits + PR。

邊界：見總規 §2；禁止 CoT 提示；禁止整雲端灌模型；共用 core；mcpCatalog 單一真相。

方法：clone／更新 → 開分支 → 只做 A1 → 報告 → 自動 A2 → …
歧義用總規 §7 預設。

現在開始 A1。
```

---

## 10. 相關 PR／文件

| 項目 | 說明 |
|------|------|
| PR #213 | #133／創作短版／決策軌跡子規格 |
| PR #214 | 外部選檔／動態預算子規格 |
| 本文件 | 總順序 + MCP D 波次 + 雲端 Opus 啟動 |
