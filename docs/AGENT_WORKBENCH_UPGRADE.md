# AI 代理工作台升級方案

> 目標：讓站內助手從「會聊天的提示詞玩具」變成**能呼叫專案工具、過程看得懂、手機上用得順**的專業代理。
>
> 撰寫日期：2026-08-07　　適用 repo：`/home/user/ai_os`
> 本文所有 `file:line` 已於撰寫當下實際讀碼查證（非憑記憶）。開源候選只列通過對抗式查證者。

---

## 0. 本方案的四條紅線（不得破壞的既有正確決定）

這四點是既有架構做對的事，升級方案一律沿用、只加強不削弱：

1. **花點數／改資料的動作，一律要使用者確認。** AI 只能「提議」，執行權永遠在 `runAction`。本方案不引入任何「模型核准後自動執行」的框架。
2. **不揭露模型隱藏推理，但工具呼叫可以完整揭露。** `client/src/components/AssistantTrace.tsx:5-8` 的註解是對的；`sanitizeAiTracePayload`（`server/services/aiTrace.ts:37-91`）遮蔽 `reasoning/thinking/cot` 鍵的行為保留。新事件協定的 `REASONING_*` **只承載供應商主動揭露的摘要**，站內不生成、不補寫。
3. **不畫假的生成結果示意圖。** `MechanicsDiagram.tsx` 檔頭的自我約束保留。本方案的視覺化只畫**真實發生過的事**（工具名、參數、耗時、點數、狀態），不畫模型內部權重、不畫想像的中間結果。
4. **手機優先是硬性條件。** 390px 直立手機可用是驗收條件，不是加分項。

---

## 1. 核心診斷

### D1（型別層）`AskStreamEvent = { phase, text }` 是整條鏈的瓶頸，不是 UI 問題

`server/routers/assistant.ts:420` 把串流事件定義成兩個欄位。後果是連鎖的：工具真名在 `:714` 被 `LOOKUP_LABEL` 中文標籤蓋掉（`:453`），args、輪次、每工具耗時、token 全部不出伺服器；前端 `AssistantTrace.tsx:10-13` 因此只能對中文字串做比對，`AiTraceHistory` 只能印 `#{sequence} {summary}` 加一坨 JSON。

**根因判定：這是型別貧乏，不是畫面沒做。** 在型別加寬之前，任何視覺化工作都無資料可吃——這決定了工作包的順序（事件協定必須先於視覺化）。

### D2（工具層）站內助手被鎖在 5 個工具，而系統自己有 71 個

`assistant.ts:222` 的 `z.enum` 寫死 5 個唯讀工具；`shared/mcpCatalog.ts` 實測 **33 唯讀 + 38 寫入 = 71 個**。同一個系統裡，外接 Claude 透過 MCP 拿得到 `get_project_status`、`list_tasks`、`list_knowledge`、`get_agent_insights`，站內助手全部拿不到——**站內助手明顯比外接客戶端笨**。

而且有一個一行程式碼的物理阻擋：`server/services/mcp.ts:657` 的 `async function callTool` **沒有 export**（`TOOLS` 在 `:108` 有 export，`callTool` 沒有）。任何「共用工具層」的工作第一步就會撞到這裡。

### D3（供應層）沒有原生 function calling 是自找的技術債，不是供應商限制

`server/services/nvidia-nim.ts:118-124` 的 request body 只有 `model/messages/temperature/max_tokens(+logprobs)`，沒有 `tools`。所以 `assistant.ts:702-708` 只能用貪婪 regex `raw.match(/\{[\s\S]*\}/)` 撈 JSON 再 `JSON.parse`。

**但預設模型是 `meta/llama-3.1-70b-instruct`**（`nvidia-nim.ts:23` 對照 `:36`），而 NIM 端點是 OpenAI 相容的 `/v1/chat/completions`——Llama 3.1 本來就支援原生 tool calling。**能力一直都在，只是沒接。** 目前的代價是：JSON 壞掉／幻覺工具名／schema 不合一律一次性判死（`:724-747`），不重試、不回饋給模型，直接掉進「把 JSON 整段刪掉」的文字 fallback，而那次 LLM 呼叫已經花掉了。

### D4（成本層）token 在 wrapper 被主動丟棄，且資料庫沒有欄位可存

`server/services/llmProvider.ts:48-60` 的 `LlmCompletion` **有** `usage`，但 `assistant.ts:376-383` 的 `callLlm` 只回 `{ text, provider, model, fellBack }`——usage 在 wrapper 被丟掉。往下游看，`server/db/schema/aiTrace.ts:27-41` 的 `ai_trace_events` 只有 `latencyMs`，沒有任何 token/cost 欄位。

疊加一個帳務漏洞：`ASK_COST_POINTS = 0`（`assistant.ts:72`），使用者可把 mode 設成 fal 檔位連問 4 輪（`MAX_TOOL_ROUNDS = 3`，`:74`），平台實付 USD 卻不扣任何點、也不留帳。**成本視覺化目前完全沒有資料源，而且有真實的漏帳。**

### D5（安全層）人類確認 gate 只存在於前端元件，伺服器端沒有憑證

`assistant.ts:826-833` 的 `runAction` 只驗 `requireGroup` + `assertProjectEditable`，接著對 payload 重跑白名單。程式碼註解自己承認「payload 可由任何呼叫端組出，不能只信 ask 端 resolve 的結果」。

**白名單是防禦深度，不是確認憑證。** `modelId` 有白名單保護，但 `sceneId`、`script` 內容、`prompt` 這些 args 沒有任何完整性保護——伺服器無法區分「使用者按過確認」與「有人直接打 API」。目前靠 viewer ACL 擋住多數風險，但若之後要讓代理連續執行動作，這一層必須先補。

### D6（呈現層）視覺化資產齊備但掛錯地方，且有一道被忽略的架構牆

後端資料其實很完整：`server/services/agentDag.ts` 是純函式的完整 DAG 求解器，`agent_events` 有 `stepId/stepIndex/actorType/data`，`agentPlannerTelemetry` 連 token/costUsd 都落庫了。但 `client/src/components/AgentCard.tsx:918` 把 `dependsOn` 壓縮成「前置 N」一顆 chip，整個 1054 行單檔沒有任何圖。

**額外發現（跨材料交叉比對得出，兩份材料都沒提）：** 調研建議「`agentDag.ts` 可直接被前端 import 來算節點狀態」——**這條路被 ADR-009 擋死**。`scripts/check-import-boundaries.mjs:5` 明文規定 `client/** must not import server/**`，而 `agentDag.ts` 位於 `server/services/`。要讓前端共用 DAG 求解，必須先把它搬到 `shared/`，否則 `check:boundaries` 在 CI 的 lint-gates job 直接紅燈。

---

## 2. 目標架構

```
┌─ 使用者輸入 ────────────────────────────────────────────────────────┐
│  CreationWorkbench 四模式（ask / generate / template / plan）        │
│  【改】模式 tabs 移到目標輸入框上方；砍重複文案；模式降級為次要導覽      │
└───────────────────────────┬────────────────────────────────────────┘
                            ↓
┌─ 代理迴圈 ─────────────────────────────────────────────────────────┐
│  【新造】server/services/toolLoop.ts  —— 唯一的 tool-loop runner     │
│    · 原生 tool_calls（不再 regex 撈 JSON）                          │
│    · 平行工具呼叫、可設輪次上限、repair round（錯誤回饋給模型再試）    │
│    · 由 assistant / teamAssistant 共用（消滅複製貼上的第二套迴圈）    │
│                            ↕                                       │
│  【改】server/services/llmProvider.ts —— 加 tools 參數、轉發 usage    │
│  【改】server/services/nvidia-nim.ts  —— body 加 tools/tool_choice   │
│         （fal any-llm 無 tool calling → 自動降級提示詞模式）          │
└───────────────────────────┬────────────────────────────────────────┘
                            ↓
┌─ 工具層 ───────────────────────────────────────────────────────────┐
│  【新造】shared/toolRegistry.ts —— 單一工具註冊表                    │
│    name + zod schema + 中文標籤 + LLM 說明 + access + 審批等級        │
│         ↓ 推導                    ↓ 推導                            │
│  【既有】mcp.ts TOOLS(71)     【改】助手可見工具集（分組＋熱門常駐）    │
│  【改】mcp.ts:657 callTool 加 export ←── 一行，但是所有工作的前置       │
│  【既有·不動】scopeDeniedReason / requireGroup / assertProjectEditable │
│              / resolveAgentAccess / recordMcpAudit                  │
│  【既有·不動】寫入動作 → ResolvedAction → 使用者確認 → runAction       │
│  【新造】runAction 的 HMAC 確認憑證（補 D5）                          │
└───────────────────────────┬────────────────────────────────────────┘
                            ↓
┌─ 事件串流 ─────────────────────────────────────────────────────────┐
│  【新造】shared/agentEvents.ts —— 結構化事件判別聯集（藍本：AG-UI）   │
│    取代 { phase, text }。帶 seq / toolCallId / input / durationMs /  │
│    usage / cost / approval / artifact                              │
│  【既有·不動】assistantStream.ts 的 SSE decoder（跨 chunk UTF-8 已解決）│
│  【改】aiTrace schema 加 promptTokens/completionTokens/costUsd/points │
│  【改】emit() 與 recordAiTraceEvent 共用同一個事件模型                │
│  【新造】舊 phase adapter（過渡期不破前端）                          │
└───────────────────────────┬────────────────────────────────────────┘
                            ↓
┌─ 視覺化 ───────────────────────────────────────────────────────────┐
│  【新造】client/src/features/agent-trace/                           │
│    · AgentTimeline.tsx  —— 直向鏈狀時間軸（390px 主視圖，0 新依賴）   │
│    · ToolCallCard.tsx   —— 工具卡片（狀態 Pill＋耗時＋參數／結果摘要） │
│    · timelineModel.ts   —— 純函式：steps+dependsOn → 扁平列＋軌道線   │
│  【搬移】server/services/agentDag.ts → shared/agentDag.ts（ADR-009）  │
│  【既有·沿用】ui/ primitives、MenuSurface 貼底 sheet、SECTION_COLORS  │
│  【明確不做】節點式 DAG 畫布（390px 不可用，見 §5）                    │
└────────────────────────────────────────────────────────────────────┘
```

**一句話：** 型別先加寬（事件協定）→ 工具接上（註冊表）→ 迴圈換原生 → 畫面才有東西可畫。順序不能顛倒。

---

## 3. 五個工作包

### WP1 — 原生 tool calling 與共用迴圈

**目標：** 刪掉 regex 撈 JSON，改用供應商原生 `tool_calls`；把四套複製貼上的迴圈收斂成一支 runner。

**改哪些檔案**

| 動作 | 路徑 | 內容 |
|---|---|---|
| 新增 | `server/services/toolLoop.ts` | 唯一 tool-loop runner（約 200 行）：原生 tool_calls、平行呼叫、輪次上限、repair round |
| 改 | `server/services/nvidia-nim.ts:112-126` | request body 加 `tools` / `tool_choice`；回傳解析 `message.tool_calls` |
| 改 | `server/services/llmProvider.ts:233` | `CompleteTextParams` 加 `tools?`；`LlmCompletion` 加 `toolCalls?`；fal 路徑無工具能力時回報 `toolCallingSupported: false` |
| 改 | `server/routers/assistant.ts:674-760` | 整段迴圈換成呼叫 `runToolLoop()`；刪除 `raw.match(/\{[\s\S]*\}/)` 與 `JSON.parse` |
| 改 | `server/routers/assistant.ts:376-383` | `callLlm` 轉發 `usage`（補 D4 第一半） |
| 刪 | `server/routers/assistant.ts:143-176` | `coerceActionToolCall`（原生工具格式後失去存在理由） |
| 改 | `server/routers/teamAssistant.ts:1140-1193` | 改用同一支 runner，刪除自己那份 `MAX_TOOL_ROUNDS` 與 regex |

**開源方案**

- **steal**：Vercel AI SDK 的工具狀態機與 `repairToolCall` 模式 — https://github.com/vercel/ai — Apache-2.0
- **reference**：BFCL（決定模型是否該換） — https://github.com/ShishirPatil/gorilla — Apache-2.0（pip 套件名是 `bfcl-eval`，別裝到同名的 `bfcl`）

> **本方案刻意偏離調研建議：不 `npm install ai`。**
> 調研的 agent-loop-quality 視角建議 adopt AI SDK。我選擇 steal 設計、自寫 200 行 runner，理由有三：(1) `llmProvider` 已自建 NIM/fal 路由、退避重試、auto fallback、logprobs introspection，AI SDK 的 provider 層會與它正面衝突，等於同時維護兩套；(2) fal 的 `any-llm` 路徑（`llmProvider.ts:194-201`）根本沒有 tool calling，AI SDK 的抽象在這條線上幫不上忙；(3) 要把既有 provider 餵給 `generateText` 必須實作 `LanguageModelV3` 介面，而該介面版本斷層已經實際弄壞過 `openai-agents-js`（其 issue #868）。這和調研自己的 anti-recommendation「不要引入會和自研基礎設施疊床架屋的框架」是同一條邏輯。

**前置相依：** 無（可立即開工）

**估時：** 5 人天

**驗收條件**

1. 問「第 3 鏡在講什麼」時，不再出現「我不太確定要怎麼幫你——可以把想做的事講得更具體嗎？」這句無資訊 fallback（該句在 `assistant.ts:744`）。
2. 刻意用一個會讓模型吐兩個 JSON 物件的提問（現況必定 fallback），改版後能正常完成工具呼叫並回答。
3. 模型叫錯工具名時，錯誤會回饋給模型並在下一輪自我修正；trace 中看得到 `tool-error` 事件，而不是靜默降級成最終回答。
4. 同一題若需要「查素材 + 讀第 3 鏡」，兩個工具在同一輪平行送出（trace 的時間戳可證），總延遲低於改版前。

**風險與測試衝突**

- `server/routers/assistant.coerce.test.ts` — `coerceActionToolCall` 被刪除，此測試檔須一併移除，並在 PR 說明中交代「該 self-healing 機制的存在理由已由原生工具格式取代」。
- `server/routers/assistant.test.ts` — 涵蓋 `searchCatalogText` 等純函式，應不受影響，但需重跑確認。
- **最大風險（誠實標註）：我沒有實測 `meta/llama-3.1-70b-instruct` 在 NVIDIA NIM 上的 tool calling 實際行為。** 模型家族支援不等於該部署啟用了 vLLM tool-calling engine。**開工第一件事是花半天寫一支 spike：直接對 `/v1/chat/completions` 送一個帶 `tools` 的請求，確認回得到 `tool_calls`。** 若失敗，退路是保留提示詞模式但改用 `response_format: json_schema`（比裸 JSON 可靠），WP1 估時 +2 人天。

---

### WP2 — 單一工具註冊表，助手接上 MCP 工具層

**目標：** 助手可見工具從 5 個提升到有意義的一批，且工具定義只寫一次。

**改哪些檔案**

| 動作 | 路徑 | 內容 |
|---|---|---|
| 新增 | `shared/toolRegistry.ts` | 單一註冊表：`name` + zod `argsSchema` + `label`(中文) + `llmDescription` + `access` + `approval` |
| 新增 | `server/services/assistantTools.ts` | adapter：由註冊表 + `callTool` 產生助手可用的工具集，支援 `allow` 子集 |
| 改 | `server/services/mcp.ts:657` | **`callTool` 加 `export`**（一行，但是整個工作包的前置） |
| 改 | `server/services/mcp.ts:108` | `TOOLS` 的 `inputSchema` 改由註冊表的 zod schema 產生（見下方 zod v3 註記） |
| 改 | `server/routers/assistant.ts:221-233` | 刪除硬編 `z.enum`，改讀註冊表 |
| 改 | `server/routers/assistant.ts:292-367` | `runLookupTool` 的 if-chain 改為註冊表分派 |
| 改 | `server/routers/assistant.ts:453-455, 617-621` | 刪除 `LOOKUP_LABEL` 與硬編提示詞條列，改由註冊表產生 |
| 新增 | `server/services/toolSearch.ts` | BM25 檢索（工具名＋說明＋參數名＋參數說明四欄），約 100 行 |
| 改 | `server/services/mcpCatalogParity.test.ts` | 擴充成「catalog ↔ 註冊表 ↔ 助手」三方對齊 |

**工具過多的處理策略（分三段，不要一次全開）**

Anthropic 官方文件明載：可用工具超過 **30–50 個**後，模型挑對工具的能力開始退化；建議門檻是「≥10 個工具或工具定義 >10k tokens 就該上 tool search」。我們有 71 個，正踩在退化區。

- **第 1 段（本工作包必做）：常駐 5 個熱門工具 + 靜態分組。**
  常駐：`get_project_status`、`list_scenes`、`query_database`、`find_model`、`list_assets`。
  其餘唯讀工具依 `shared/agentSkills.ts:49-118` 已有的四個工作台模式（ask/generate/template/plan）掛載，任一時刻模型可見工具數 **控制在 12 個以內**。
- **第 2 段：加 `search_tools(query)`**（BM25，本地檢索 71 個工具的四個欄位，每次最多回 5 個），模型搜到才把工具 hydrate 進可見集。
- **第 3 段（本次不做）：寫入類工具。** 先只開唯讀。寫入工具與既有「提議→確認→runAction」哲學直接衝突（MCP 的 write 工具是立即執行），需要另案設計，見 §5。

**開源方案**

- **steal**：Anthropic Tool Search 的規格（搜尋四欄位、每次回 5 個、3–5 個熱門工具不 defer、`service_resource_action` 命名） — https://github.com/anthropics/claude-cookbooks — MIT
  （註：數字本身來自 platform.claude.com 官方文件與 Anthropic engineering blog，非該 repo；且屬廠商自報數據，非獨立第三方實證。）
- **reference**：Mastra 的 MCPServer ↔ agent tools 雙向對稱抽象 — https://github.com/mastra-ai/mastra — Apache-2.0（注意 `ee/` 目錄為商業授權）
- **reference**：zonlabs/mcp-ts 的 ToolRouter 兩段式介面（discover → hydrate） — https://github.com/zonlabs/mcp-ts — 只讀介面設計，**不引入**（repo 內查無 LICENSE 檔、24 stars、單一維護者）

**前置相依：** WP1（迴圈要先能吃結構化工具定義）

**估時：** 8 人天

**驗收條件**

1. 使用者問「這個專案現在卡在哪？」，助手呼叫 `get_project_status`，回答中出現**具體的**逾期任務標題與負責人（現況只能給聚合計數，因為 `projectIntelligence.ts:31-35` 只注入數字）。
2. 使用者問「下週要交什麼？」，助手呼叫 `list_schedule`，回答含真實日期與項目名。
3. 使用者問「知識庫裡有沒有提到 XX？」，助手呼叫 `list_knowledge` + `get_knowledge`，能讀到超出 20,000 字注入預算的長文（現況做不到）。
4. 新增一個工具只需改 `shared/toolRegistry.ts` 一處；`mcpCatalogParity.test.ts` 會擋住任何一邊漏改。
5. 任一時刻送給模型的工具定義 ≤ 12 個。

**風險與測試衝突**

- `server/services/mcpCatalogParity.test.ts` — 必然要改（這是好事，它從雙向對齊升級成三方對齊）。
- `server/routers/assistant.test.ts` — `searchCatalogText` 若被移進註冊表需同步搬測試。
- **zod v3 限制（實測 `package.json:80` 為 `"zod": "^3.24.1"`）：zod v3 沒有內建 `z.toJSONSchema`，repo 內也沒有 `zod-to-json-schema`。** 兩個選項：(a) 加 `zod-to-json-schema` 這個 devDependency 在 build 時產生 MCP 的 JSON Schema；(b) 註冊表同時手寫兩份 schema，用測試鎖住一致性。**建議 (a)**，成本較低且不會漂移。若團隊排斥新依賴則選 (b)。
- **權限模型的好消息：** 助手的 ask 路徑（`assistant.ts:480`）與 MCP 唯讀工具（`mcp.ts:1395`）**都只做組隔離**，讀取權限語意已經一致，搬工具不需要新設計 ACL。缺的只是把 `recordMcpAudit`（`mcp.ts:613-641`）掛到助手路徑上。

---

### WP3 — 結構化事件協定

**目標：** 用一份判別聯集取代 `{ phase, text }`，同時當 SSE 線上格式、DB 事件列、與未來 MCP 工具輸出。

**藍本選擇：AG-UI Protocol**（https://github.com/ag-ui-protocol/ag-ui，MIT，已查證：`sdks/typescript/packages/core/src/events.ts` 33 個事件型別、`BaseEventSchema` 明文 `.passthrough()`）。

選它而非 Vercel AI SDK 的 `UIMessageChunk` 的理由：AG-UI 是**離散事件**（每筆可直接當一列 DB row、可重播、可經 SSE 續傳），而 `UIMessageChunk` 本質是餵給 client reducer 的指令流。我們的 `AssistantTrace` 是 append-only 活動清單、MCP 還有 `list_agent_events` 要把事件查出來——語意上要的是事件日誌。且 AG-UI 的 `.passthrough()` 代表「加自己的欄位（token/點數/artifact）」是協定允許的擴充，不是 fork。

> **採用 AG-UI 時已修正的三個事實**（來自查證，照抄原始說法會踩雷）：AG-UI 的 `ToolCallStartEvent` 欄位是 `toolCallName` 不是 `toolName`；另有第五個事件 `ToolCallChunkEvent`；`ToolCallResultEvent` 另有選填 `role`。以下型別草案已按修正後事實設計，並刻意統一使用 `toolName`（我們沒有 AI SDK 那種把工具名編碼進 type 樣板的需求）。

**完整 TypeScript 型別草案**

```ts
// shared/agentEvents.ts
// 藍本：AG-UI Protocol（MIT）。usage/cost 欄位名對齊 OpenTelemetry GenAI semconv；
// cost 形狀抄 Langfuse Observation（OTel GenAI registry 完全沒有 cost 屬性）。
// run 狀態借用 MCP TaskStatus 五個字面值，未來要把 agent run 暴露成 MCP Task 時零轉換。

/** 與 MCP TaskStatus 逐字相同（schema/2025-11-25） */
export type RunStatus = "working" | "input_required" | "completed" | "failed" | "cancelled";

export interface BaseAgentEvent {
  type: AgentEventType;
  /** run 內單調遞增。用作 SSE `id:` 欄位（Last-Event-ID 續傳）與 DB 排序鍵。
   *  AG-UI 沒有這欄（它假設不掉包），屬我們的 passthrough 擴充。 */
  seq: number;
  /** ISO-8601 UTC。AG-UI 用 epoch ms，這裡改 ISO 以對齊 MCP Task.createdAt。 */
  ts: string;
  /** 一次問答或一次 agent run 的關聯鍵 */
  runId: string;
  /** 上游原始 frame（NIM/fal 回應、MCP JSON-RPC），除錯用，不進 UI、不進前端型別驗證 */
  rawEvent?: unknown;
}

/* ── 生命週期 ── */
export interface RunStartedEvent extends BaseAgentEvent {
  type: "RUN_STARTED";
  projectId: string;
  mode: "nim" | "fal_quality" | "auto";
  /** 本次可見工具數（WP2 的分組策略要能被觀測） */
  visibleToolCount: number;
}
export interface RunFinishedEvent extends BaseAgentEvent {
  type: "RUN_FINISHED";
  status: Extract<RunStatus, "completed" | "cancelled">;
  elapsedMs: number;
  usage?: UsagePayload;   // run 級總計
}
export interface RunErrorEvent extends BaseAgentEvent {
  type: "RUN_ERROR";
  status: Extract<RunStatus, "failed">;
  message: string;        // 已轉成人話，可直接顯示
  code?: string;          // TRPCError code
  retryable?: boolean;
  elapsedMs?: number;
}

/* ── 文字與推理 ──
 *  紅線 2：REASONING_* 只承載「供應商主動揭露」的摘要（見 shared/llmIntrospection）。
 *  站內不生成、不補寫、不改寫，且 payload 仍過 sanitizeAiTracePayload。 */
export interface TextDeltaEvent extends BaseAgentEvent {
  type: "TEXT_DELTA"; messageId: string; delta: string;
}
export interface ReasoningSummaryEvent extends BaseAgentEvent {
  type: "REASONING_SUMMARY";
  messageId: string;
  /** 供應商揭露的摘要；沒有就不發這個事件 */
  disclosed: string;
}

/* ── 工具 ── */
export interface ToolRef {
  /** 註冊表中的工具名，例如 "get_project_status" */
  name: string;
  /** 給人看的中文標籤（取代舊 LOOKUP_LABEL） */
  label: string;
  /** 唯讀／會改資料／會花點數 —— 決定要不要走 APPROVAL */
  effect: "read" | "write" | "billable";
}
export interface ToolCallStartEvent extends BaseAgentEvent {
  type: "TOOL_CALL_START";
  toolCallId: string;
  tool: ToolRef;
  /** 第幾輪工具（取代舊的隱式輪次） */
  round: number;
  /** 同一輪平行送出的工具數；>1 時 UI 畫分岔 */
  parallelWidth: number;
}
export interface ToolCallEndEvent extends BaseAgentEvent {
  type: "TOOL_CALL_END";
  toolCallId: string;
  /** 已遮罩的完整參數（PII／金鑰在 server 端就拔掉） */
  input?: Record<string, unknown>;
  inputRedacted?: boolean;
}
export interface ToolCallResultEvent extends BaseAgentEvent {
  type: "TOOL_CALL_RESULT";
  toolCallId: string;
  /** 給人看的一行摘要，例如「查到 12 筆素材」。UI 不該去 parse 結果本體 */
  summary: string;
  /** 結果筆數，供 UI 誠實顯示（現況只有部分工具帶筆數） */
  rowCount?: number;
  /** 被截斷時的實際／總數 */
  truncated?: { shown: number; total: number };
  durationMs: number;
  /** 對齊 MCP CallToolResult.structuredContent；UI 展開時才讀 */
  structuredContent?: Record<string, unknown>;
}
export interface ToolCallErrorEvent extends BaseAgentEvent {
  type: "TOOL_CALL_ERROR";
  toolCallId: string;
  errorText: string;
  code?: string;
  durationMs: number;
  /** 已把錯誤回饋給模型、模型將重試（WP1 的 repair round） */
  willRetry: boolean;
}
/** AgentPrism 的第四種狀態：跑完了但結果可疑／部分失敗。
 *  AI SDK 與 AG-UI 都沒有這一格，但創作工具很需要（例如查到 0 筆） */
export interface ToolCallWarningEvent extends BaseAgentEvent {
  type: "TOOL_CALL_WARNING";
  toolCallId: string;
  reason: string;
}

/* ── 人類確認（紅線 1：UI 只回報決定，執行權永遠在 runAction） ── */
export interface ApprovalRequestedEvent extends BaseAgentEvent {
  type: "APPROVAL_REQUESTED";
  approvalId: string;
  /** 對應既有的 ResolvedAction */
  action: unknown;
  /** 給人看的問句（沿用現有 confirmMsg） */
  message: string;
  /** 這次批准會花多少點 —— 不讓付費行為隱形 */
  estimatedCost?: CostPayload;
  /** HMAC 簽章，綁定 action type + args + approvalId（WP5） */
  signature: string;
  expiresAt: string;
}
export interface ApprovalRespondedEvent extends BaseAgentEvent {
  type: "APPROVAL_RESPONDED";
  approvalId: string;
  /** 三態：AI SDK 的 boolean 資訊量不足 */
  status: "resolved" | "cancelled" | "expired";
  approved: boolean;
  respondedBy?: string;   // userId，稽核用
}

/* ── 用量與成本 ── */
export interface UsagePayload {
  provider?: string;              // gen_ai.provider.name
  requestModel?: string;          // gen_ai.request.model
  responseModel?: string;         // gen_ai.response.model
  inputTokens?: number;           // gen_ai.usage.input_tokens
  outputTokens?: number;          // gen_ai.usage.output_tokens
  cacheReadInputTokens?: number;  // gen_ai.usage.cache_read.input_tokens
  finishReasons?: string[];       // gen_ai.response.finish_reasons
  timeToFirstChunkMs?: number;    // gen_ai.response.time_to_first_chunk
  cost?: CostPayload;
}
export interface CostPayload {
  credits: number;                // 站內點數
  usd: number;                    // 平台實付；NIM 免費額度為 0
  details?: Record<string, number>;  // Langfuse costDetails 形狀
  /** auto 模式中途轉付費：必須是事件欄位，不是隱藏旗標 */
  fellBackToPaid?: boolean;
  billable: boolean;
}
export interface UsageEvent extends BaseAgentEvent {
  type: "USAGE";
  scope: "step" | "tool" | "run";
  refId?: string;
  usage: UsagePayload;
}

/* ── 產出物（對齊 MCP ResourceLink） ── */
export interface ArtifactEvent extends BaseAgentEvent {
  type: "ARTIFACT";
  kind: "asset" | "scene" | "generation" | "database_row" | "note" | "task" | "schedule_item";
  id: string;
  /** MCP resource URI，例如 "aios://project/{p}/asset/{id}" */
  uri: string;
  title?: string;
  previewUrl?: string;
  toolCallId?: string;
  /** 本次新建（true）或引用既有（false） */
  created: boolean;
}

export type AgentEvent =
  | RunStartedEvent | RunFinishedEvent | RunErrorEvent
  | TextDeltaEvent | ReasoningSummaryEvent
  | ToolCallStartEvent | ToolCallEndEvent | ToolCallResultEvent
  | ToolCallErrorEvent | ToolCallWarningEvent
  | ApprovalRequestedEvent | ApprovalRespondedEvent
  | UsageEvent | ArtifactEvent;

export type AgentEventType = AgentEvent["type"];
```

**工具卡片的七態 → 既有 Pill 對照（重要：不必動 `components/ui/`）**

`client/src/components/ui/Pill.tsx:12-28` 的 `PillStatus` 只有 5 個值。實測後確認**七個工具狀態可以完全映射到既有 5 個 Pill 狀態**，因此不需要擴充 Pill——這避開了 `vitest.client.config.ts:22-43` 對 `components/ui/**` 的 85% 覆蓋率門檻。

| 工具狀態 | 中文標籤 | Pill status | Icon |
|---|---|---|---|
| input-streaming | 準備中 | `neutral` | `CircleDot` |
| input-available | 執行中 | `running` | `Loader`（脈動，已受 reduced-motion 保護） |
| approval-requested | 待確認 | `queued` | `Clock`（金色，符合計畫 §24.3） |
| approval-responded | 已回覆 | `neutral` | `Check` |
| output-available | 已完成 | `done` | `Check` |
| warning | 需注意 | `queued` | `TriangleAlert`* |
| output-error / denied | 失敗／已拒絕 | `failed` | `X` |

\* `TriangleAlert` 需確認是否在 `Icon.tsx` 的 111 個名單內；若無，用 `node scripts/add-icon.mjs TriangleAlert` 產生（禁止手抄路徑）。

**改哪些檔案**

| 動作 | 路徑 | 內容 |
|---|---|---|
| 新增 | `shared/agentEvents.ts` | 上述型別 + 對應 zod schema |
| 新增 | `shared/agentEventsAdapter.ts` | 新事件 → 舊 `{phase, text}` 的 3 行降級（過渡期不破前端） |
| 改 | `server/routers/assistant.ts:420` | 刪除 `AskStreamEvent`，改用 `AgentEvent` |
| 改 | `server/routers/assistant.ts:503,598,679,714,718,723` | 六個 `emit()` 呼叫點改發結構化事件 |
| 改 | `server/db/schema/aiTrace.ts:27-41` | 加 `promptTokens` / `completionTokens` / `costUsd` / `points` 欄位 |
| 新增 | `drizzle/` | 對應 migration |
| 改 | `server/services/aiTrace.ts:128-152` | `recordAiTraceEvent` 接受新欄位（advisory-lock 序號分配機制不動） |
| 改 | `client/src/components/assistantStream.ts:97-108` | `isDoneEvent` 補齊型別驗證（現況比伺服器回傳鬆） |

**開源方案**

- **steal**：AG-UI Protocol 事件形狀 — https://github.com/ag-ui-protocol/ag-ui — MIT
- **steal**：AI Elements `tool.tsx` 的 `statusLabels`/`statusIcons` 對照表 — https://github.com/vercel/ai-elements — Apache-2.0
- **steal**：AgentPrism 的 status 四分法（多出 `warning` 一格）與 span 帶 `duration` — https://github.com/evilmartians/agent-prism — MIT（**只抄型別**：其 `packages/ui` 標了 `"private": true`，未發佈到 npm，且 deps 寫死 react ^19.1.0）
- **reference**：OpenTelemetry GenAI semconv 的欄位命名 — https://github.com/open-telemetry/semantic-conventions-genai — Apache-2.0（該 registry **沒有** cost 屬性，故 cost 另抄 Langfuse）

**前置相依：** 無（可與 WP1 平行開工；但 WP1 完成後才有平行工具事件可發）

**估時：** 6 人天

**驗收條件**

1. 前端收到的事件含**工具真名**（`get_project_status`）而非只有中文標籤。
2. 每個工具呼叫在 UI 上顯示耗時（例如「1.2s」）。
3. 問一題後，`ai_trace_events` 該列有非 null 的 `promptTokens` / `completionTokens`。
4. 使用者選 fal 檔位問一題，UI 上看得到「已自動備援／本次花費 N 點」（現況完全隱形）。
5. 舊版前端在 adapter 下行為不變（過渡期不破線上）。

**風險與測試衝突**

- `client/src/components/assistantStream.test.ts`（291 行）— SSE decoder 本身不動（跨 chunk UTF-8／CRLF／尾段 flush 的邏輯是資產），但 `isDoneEvent` 的斷言要擴充。
- DB migration 需要 review：`ai_trace_events` 是熱表，加欄位要 nullable + 有 default，避免鎖表。
- **誠實標註：`usd` 的準確計算依賴 fal 的計價資料。** 若 `llmPricing` 目前沒有涵蓋 fal 的所有檔位，先讓 `usd` 可為 null 並在 UI 顯示「費用計算中」，不要顯示 0（顯示 0 會讓付費行為隱形，違反紅線）。

---

### WP4 — 代理執行視覺化（390px 手機優先）

**目標：** 讓使用者在手機上看得懂「代理跑到哪、哪幾步平行、卡在誰、花了多少」。

**關鍵設計決策：主視圖是直向鏈狀時間軸，不是節點圖。**

理由是硬證據，不是偏好：
- 390px 扣掉安全區與 padding 約剩 350px；一個帶繁中標題的節點卡至少要 140–160px 寬，一排最多兩顆，一有平行分支就必須橫捲。
- `client/src/features/creation-workbench/__tests__/mob03LongTaskCopy.test.ts:53-57` 鎖住 `html`/`body` 為 `overflow-x: clip`——超寬內容不會產生橫向捲軸，而是**被硬裁**。
- xyflow 自己的 issue #5066 / #1914 記錄手機 pinch 會被瀏覽器視窗縮放搶走，且 `zoomOnPinch={false}` 在手機無效。
- `MOBILE_AUDIT.md:288` 把「觸控裝置不支援空白處平移」列入禁改清單（保留頁面捲動）。
- **最強證據是同業做法**：Arize Phoenix 以 trace 視覺化為賣點，其 `app/package.json` 完全沒有 xyflow/reactflow/dagre/elkjs/mermaid；Langfuse 明確分岔出 `useIsMobile`，手機上不給圖、改切 tab。**兩家做 span waterfall 的專業工具都用手刻 CSS。**

**視覺設計**

```
  ●  查專案現況                    0.4s  ← Pill:done
  │
  ├─●  查分鏡內容 (12 筆)          1.2s  ← 同 rank = 平行，用分岔標記
  ├─●  查任務清單 (3 筆)           0.9s
  │
  ●  整理回答                      2.1s
  │
  ⧗  建立第 4 鏡  約 12 點  [確認] [取消]   ← 待確認，整寬攔截卡
  ┆
  ┆ ○  生成畫面（等待前一步）        ← 被阻擋：虛線軌道 + 灰字
```

- 左側軌道線由 `treeLines: boolean[]` 純資料驅動，CSS 只畫直線，**不用任何 SVG**（抄 Langfuse `timeline-flattening.ts` 的設計）。
- 每列只放：狀態 icon + 工具中文名 + 筆數 + 耗時 + 點數。其餘（參數、結果全文、rationale、sourceRefs）一律推進既有的 `MenuSurface` 貼底 sheet（抄 Dify 把「節點」與「節點結果」分離的決策）。
- **詳情區條件渲染**（抄 LibreChat）：`input` 或 `output` 皆空時，該列不可點——避免一堆點下去空空如也的假摺疊。
- 失敗連坐：`agentRunner.ts:442-445` 已有「某步 failed → 被它 block 的 pending 標成 failed」的邏輯，畫成虛線軌道 + 灰字（抄 n8n 的錯誤分支語意，只抄語意不抄程式碼）。

**改哪些檔案**

| 動作 | 路徑 | 內容 |
|---|---|---|
| 新增 | `client/src/features/agent-trace/AgentTimeline.tsx` | 直向鏈狀時間軸 |
| 新增 | `client/src/features/agent-trace/ToolCallCard.tsx` | 工具卡片（收合式，狀態 Pill + 耗時） |
| 新增 | `client/src/features/agent-trace/timelineModel.ts` | **純函式**：`steps + dependsOn → { step, depth, treeLines, rank, isLastSibling }[]` |
| 新增 | `client/src/features/agent-trace/timelineModel.test.ts` | 覆蓋平行分支、環、失敗連坐 |
| **搬移** | `server/services/agentDag.ts` → `shared/agentDag.ts` | **ADR-009 要求**：`client/**` 不得 import `server/**` |
| 改 | `server/services/agentRunner.ts` 等 import 點 | 跟隨搬移調整 |
| 改 | `client/src/components/AssistantTrace.tsx` | 改吃 `AgentEvent` 聯集，內部改用 `AgentTimeline` |
| 改 | `client/src/components/AgentCard.tsx:909-951` | 步驟列表換成 `AgentTimeline`；`dependsOn` 不再是「前置 N」一顆 chip |
| 改 | `client/src/components/AgentCard.tsx:69-109` | 四張對照表 `export` 出來共用（現為檔案私有） |
| 改 | `client/src/styles.css` | 新增 `.agent-timeline*` 選擇器（軌道線、分岔、虛線） |

**明確不做：** 節點式 DAG 畫布。若日後桌機真的需要，走 `React.lazy` 獨立 chunk + `useMatchMedia("(max-width: 820px)")` gate 掉，且**不列入前三個里程碑**（理由見 §5）。

**開源方案**

- **steal**：Langfuse 的 `timeline-calculations.ts` / `timeline-flattening.ts`（攤平 + `treeLines: boolean[]`）與 `use-mobile.tsx` 的 `useSyncExternalStore` 寫法 — https://github.com/langfuse/langfuse — MIT（要抄的檔案不在 `ee/` 目錄內，可安全取用）
- **reference（設計反證）**：Arize Phoenix 證明這題不需要 graph 函式庫 — https://github.com/Arize-ai/phoenix — **Elastic License 2.0，非 OSI 開源，不可複製程式碼**，只作為「不裝圖表庫」的佐證
- **steal**：LibreChat `ToolCall.tsx` 的「已取消」判定與詳情區條件渲染 — https://github.com/danny-avila/LibreChat — MIT（需保留著作權聲明）
- **steal**：AgentCard 既有的 `eventType → 語意 Pill` 時間軸寫法（`AgentCard.tsx:95,985-1011`）——站內已有，直接抽出共用

**前置相依：** WP3（沒有結構化事件就沒東西可畫）

**估時：** 8 人天

**驗收條件**

1. **在 390px 直立手機上**，打開一個有平行分支的 agent run，能看出哪兩步是同時跑的，且**頁面沒有橫向捲動**。
2. 某一步失敗時，被它連坐的後續步驟以虛線 + 灰字顯示，使用者不必猜為什麼沒跑。
3. 點任一工具列可展開參數與結果摘要；沒有參數也沒有結果的列不可點。
4. 每列右側顯示耗時；整條軌道底部顯示總耗時與總點數。
5. 關閉動畫（`prefers-reduced-motion`）後，時間軸資訊完整可讀（全域 kill-switch 在 `styles.css:1392-1397`，禁改）。
6. 助手對話中的工具呼叫與 agent run 的步驟，使用同一套視覺語彙。

**風險與測試衝突**

- **`scripts/check-ui-primitives.mjs`（實測輸出「裸 class 0（基準線 0）」）** — 新元件寫任何裸的 `hint`/`btn`/`card`/`chip`/`badge`/`pill` class 一律 CI 紅燈。所有外殼必須用 `<Card>`/`<Chip>`/`<Pill>` 渲染。注意 `Chip` 的 `as` 聯集**刻意排除 `li`**，需要清單語意時要寫成 `<li><Chip/></li>`。
- **`scripts/check-import-boundaries.mjs`** — `agentDag.ts` 不搬到 `shared/` 就直接紅燈。這是本工作包**最容易被忽略的阻擋**。
- `client/src/styles.contract.test.ts` 等 9 支樣式契約測試 — 新增 CSS 不得破壞既有字面宣告；特別注意 `--chrome-bottom` 分級與 `--touch-min` 契約不可覆寫。
- 觸控下限 44px 是 `min-height` + `min-width` **雙鎖**（`styles.css:145-193`），密排的時間軸列與圖例在手機會被撐開，設計時就要按 44px 算高度。
- `styles.css` 已 7122 行 / 408KB raw / 120.9KB gzip 且未拆分。新增選擇器要克制；若超過約 150 行應考慮拆檔（但要先確認 `styles.mobileTokens.contract.test.ts` 對 import 順序的約束）。
- **範圍風險：`AgentCard.tsx` 是 1054 行單檔，把輸入表單／成本／健康度／步驟／任務／事件／核准全混在一起。** 本工作包只動步驟列表那一段，**不做整檔重構**——否則估時會失控。整檔拆分應另立技術債項目。

---

### WP5 — 介面簡化與確認契約

**目標：** 承接上一輪共識（tabs 位置、文案精簡、模式降級），同時補上伺服器端的確認憑證。

**改哪些檔案**

| 動作 | 路徑 | 內容 |
|---|---|---|
| 改 | `client/src/features/creation-workbench/CreationWorkbench.tsx` | 模式 tabs 移到目標輸入框**上方**；模式從主導覽降級為次要切換 |
| 改 | `client/src/features/creation-workbench/modes/*.tsx` | 砍除四個模式間重複的說明文案 |
| 改 | `client/src/components/ProjectAssistant.tsx:570-581,664-689` | 確認流程改為獨立的「確認卡」（整寬、兩顆大按鈕），不再塞在文字裡 |
| 新增 | `server/services/approvalToken.ts` | HMAC 簽章：綁定 `approvalId + action.type + args + userId + expiresAt` |
| 改 | `server/routers/assistant.ts:826-883` | `runAction` 驗簽；簽章不符或逾時一律拒絕 |
| 改 | `client/src/features/creation-workbench/AiUnderstandingPanel.tsx` | 精簡模式下收合次要區塊（需自行呼叫 `useDensity()`） |

**確認契約的設計（補 D5）**

- `ResolvedAction` 產生時，伺服器一併簽發 `signature`（HMAC，密鑰不出伺服器）。
- 前端原樣回送 `action + approvalId + signature`。
- `runAction` **先驗簽再執行**；args 被改過簽章即失效。
- **既有的白名單重驗一律保留**（`resolveModel` / `assistantModel` / `sceneId` 歸屬等）——簽章是新增的第一道閘，不是替換防禦深度。
- 抄 CopilotKit 的 `renderAndWaitForResponse` 介面形狀：確認卡做成**完全受控的 presentational component**，只吃 `(action, status, onDecide)` 三個東西，內部沒有任何執行路徑。這樣即使日後有人改 UI 也繞不過 `runAction`。

**開源方案**

- **steal**：AI SDK 的 `experimental_toolApprovalSecret`（HMAC 綁定 tool name + call id + input 的作法） — https://github.com/vercel/ai — Apache-2.0
- **steal**：CopilotKit 的 `(args, status, respond)` 受控元件介面形狀 — https://github.com/CopilotKit/CopilotKit — MIT（**只抄介面形狀，不引入**：`@copilotkit/react-core` 實際依賴包含 lit、rxjs、katex、GraphQL 客戶端）
- **steal**：Chainlit 把確認拆成獨立 `AskActionMessage` 氣泡（手機上點擊目標更大） — https://github.com/Chainlit/chainlit — Apache-2.0
- **steal**：Fooocus 的「把系統自動代勞的事寫成明文清單」哲學 — https://github.com/lllyasviel/Fooocus — GPL-3.0（**只抄哲學，不可引入程式碼**；該專案已進入 LTS bug-fix only）

**前置相依：** WP3（確認事件要走新協定）；與 WP4 可平行

**估時：** 5 人天

**驗收條件**

1. 在 390px 手機上，模式 tabs 出現在目標輸入框上方，且切換模式不會讓輸入框跳位。
2. 四個模式間不再出現內容重複的說明段落。
3. 確認卡是獨立的整寬區塊，兩顆按鈕各 ≥44px，卡上明確寫出「這個動作會花 N 點」。
4. **安全驗收**：用 curl 直接對 `runAction` 送一個合法格式但簽章不符（或竄改 args）的 payload，回 403 而非執行。
5. 精簡模式下，說明類文字收合，但點數金額、錯誤修法、資料筆數等**內容類**資訊仍常駐（遵守 `Meta.tsx:14-19` 立下的判準）。

**風險與測試衝突**

- `scripts/check-ui-primitives.mjs` — 同 WP4。
- `client/src/styles.contract.test.ts` — 動到工作台版面時，`--chrome-bottom`、`.hint-toggle` 的 44px 契約、`.menu` 的 `max-height` 宣告都有字面斷言。
- `client/src/styles.mobileInteract.contract.test.ts` — 若移動輸入框，`focusAndReveal` 的鍵盤契約必須沿用，**禁止自己寫 `scrollIntoView`**。
- **相容性風險：HMAC 上線時，正在使用者畫面上的舊 `ResolvedAction` 會失去簽章。** 需要一個過渡期（例如 7 天）讓 `runAction` 對無簽章 payload 記警告但放行，並在 log 觀測到數量歸零後才改為強制拒絕。

---

## 4. 執行順序與里程碑

| | 工作包 | 人天 | 累計 |
|---|---|---|---|
| **M1** | WP1 + WP3 | 11 | 11 |
| **M2** | WP2 | 8 | 19 |
| **M3** | WP4 + WP5 | 13 | 32 |

> WP1 與 WP3 可平行（不同人），實際日曆時間可壓縮。WP4/WP5 亦可平行。

### M1 — 「AI 不再瞎掰，而且我看得到它在做什麼」

WP1（原生 tool calling）+ WP3（事件協定）。

**使用者感受到的具體差異：**
- 不再收到「我不太確定要怎麼幫你」這種無資訊回覆——模型叫錯工具會自己修正後重試。
- 對話中的工具步驟從「正在查資料…」變成「查專案現況 · 0.4s」「查分鏡內容 (12 筆) · 1.2s」——有真名、有筆數、有耗時。
- 選 fal 檔位時，畫面誠實顯示「已自動備援 / 本次花費」，付費行為不再隱形。

**這個里程碑的價值在於它是後面兩個的地基**——但它本身已經是使用者看得見的改善，不是純技術重構。

### M2 — 「站內助手終於跟外接 Claude 一樣聰明」

WP2（工具註冊表 + 接上 MCP 唯讀工具）。

**使用者感受到的具體差異：**
- 「這個專案現在卡在哪？」→ 講得出**具體**逾期任務、負責人、期限（現況只能給數字）。
- 「下週要交什麼？」「知識庫裡有沒有提到 XX？」→ 現在答得出來，以前完全答不了。
- 助手回答的資訊密度明顯提升，因為它能下鑽而不是只看聚合計數。

### M3 — 「手機上看得懂、用得順」

WP4（視覺化）+ WP5（介面簡化 + 確認契約）。

**使用者感受到的具體差異：**
- 手機上一條垂直時間軸就能看懂代理跑到哪、哪幾步平行、卡在誰身上、花了多少點。
- 某步失敗時，一眼看出哪些後續步驟被連坐，不必猜。
- 工作台不再擁擠：模式 tabs 到了該在的位置，重複文案消失。
- 確認卡變成明確的整寬區塊，且伺服器端真的驗得了「這個動作被人確認過」。

---

## 5. 明確不做的事

| 放棄的方向 | 原因 |
|---|---|
| **節點式 DAG 畫布作為主視圖**（@xyflow/react、Mermaid 前端渲染、Dify/Flowise/n8n 那類） | **390px 不可用**：一排最多兩顆節點，有分支就必須橫捲；而 `html/body` 是 `overflow-x: clip`（有測試鎖住），超寬內容會被硬裁而非產生捲軸。xyflow issue #5066/#1914 證實手機 pinch 會被瀏覽器搶走且無法用 props 關掉。加上 `MOBILE_AUDIT.md:288` 把「觸控不平移畫布」列入禁改清單。**Phoenix 與 Langfuse 兩家專業 trace 工具都不用 graph 函式庫，這是同業共識而非我們的妥協。** |
| **`npm install ai`（Vercel AI SDK）當執行期依賴** | 與既有 `llmProvider` 的 NIM/fal 路由、退避重試、auto fallback、logprobs introspection 正面衝突；fal `any-llm` 路徑本來就沒有 tool calling，抽象幫不上忙；要接既有 provider 必須實作 `LanguageModelV3`，該介面版本斷層已實際弄壞過 `openai-agents-js`。**抄設計、不抄套件。** |
| **elkjs 自動佈局** | 實測 `elk.bundled.js` 為 **469KB gzip**，是本專案前端可接受預算的數倍。而 D-006 已記載首屏 JS 206.5KB gzip（超 180KB 門檻）、ProjectPage chunk 151KB gzip（超 100KB/route 門檻），D-011 瘦身已標 DEFERRED。授權為 `EPL-2.0 OR GPL-3.0-or-later`，內部合規審查會多一道手續。 |
| **Mermaid 前端即時渲染** | flowchart 路徑落點約 100–150KB gzip；更致命的是 **CJK**：mermaid 自動換行按空白斷詞，繁中沒有空白，節點標籤會撐成長條。真要出圖，改成 server 端輸出 `flowchart TD` 文字語法（0 KB，提供「複製流程圖語法」按鈕）。 |
| **`@dagrejs/dagre`（16.9KB gzip）** | 對 390px 的真實需求只是「算出每個 step 的 rank」，用 20 行 Kahn 拓撲排序即可，比引入依賴更便宜也更好控。列為日後若真做桌機節點圖時再評估。 |
| **AgentPrism UI 套件** | 看起來最對題（唯一專做 agent trace timeline 的 React 庫、MIT），但 `packages/ui/package.json` 標 `"private": true`——**根本沒發佈到 npm**，只有 `-types` 與 `-data` 有發。README 自標 Alpha、API 會變。只抄它的 status 四分法與 `duration` 顯示。 |
| **assistant-ui / CopilotKit / LangGraph.js / Mastra / VoltAgent 當 runtime** | 全部要求把訊息流交給它們的 runtime，與既有 tRPC + drizzle + points/quota + audit + aiTrace 疊床架屋。特別是 assistant-ui 與 AI SDK 自帶完整 approval 生命週期（含逾時失效），與我們的 `ResolvedAction → 確認 → runAction` 併存必然出現「UI 說已核准、runAction 沒跑」的不同步窗口。**這是本方案最硬的紅線：搬過來的只能是「呈現 + 回報使用者決定」，執行權一律留在 `runAction`。** |
| **CodeAct / 讓模型寫程式碼呼叫工具**（smolagents 那套） | 71 個工具每一支都綁 per-user ACL、點數扣款與唯讀金鑰守衛（`scopeDeniedReason`）。讓模型寫任意 JS 去呼叫它們，等於把安全邊界從「71 個受檢查的入口」放大到整個 runtime。另註：CodeAct 論文的「+20% 成功率」與「-30% 步數」是**二擇一**的權衡描述（原文為 or），不是同時成立，且那是論文自建實作的數據，不是 smolagents 的實測。 |
| **把 MCP server 改寫成官方 `McpServer` 以取得 in-process client** | `TOOLS` 與 `callTool` 本來就在同一個 process，中間插一層 JSON-RPC 是自我 RPC：多付序列化、錯誤映射被繞兩次、堆疊追蹤變難看。而且官方 `InMemoryTransport.createLinkedPair()` 有明文限制「只能連 2025 世代的實例」。等真要把 MCP server 拆成獨立服務時再一起做。 |
| **本輪開放 MCP 的 38 個寫入工具給助手** | MCP 的 write 工具是**立即執行**，助手的 write 是**提議**——兩套守衛哲學直接衝突。需另案設計（把寫入工具包成「產生 ResolvedAction」而非直接執行）。本輪只開唯讀。 |
| **Open WebUI / Phoenix / n8n / Dify / storyboarder 的程式碼** | 授權擋住：Open WebUI 是 BSD-3 + 品牌條款（>50 使用者即受限）；Phoenix 是 Elastic License 2.0（非 OSI）；n8n 是 Sustainable Use License（非 OSI，且 `master` 以外分支未授權）；Dify 是改動過的 Apache-2.0 + 多租戶限制；`wonderunit/storyboarder` **完全沒有 LICENSE 檔**（等同保留所有權利）且 4 年未更新。全部只能看設計。 |
| **`zonlabs/mcp-ts` 當生產依賴** | repo 內查無 LICENSE 檔（只有 npm metadata 與 README 徽章），24 stars、2026-01 才建立、34 個 open issues。我們需要的只是 BM25 檢索 71 個本地工具，自寫 100 行更安全。 |
| **ComfyBox / Fooocus / OpenCut 當技術基礎** | ComfyBox 已停更約 3 年、GPL-3.0、Svelte；Fooocus 官方聲明進入 LTS bug-fix only；OpenCut 主線正在 Rust 重寫且能用的 `opencut-classic` 已被封存為唯讀。三者皆只作概念參考。 |

---

## 6. 開源清單總表

只列通過對抗式查證者（verdict 為 CONFIRMED 或 CORRECTED；**所有 REFUTED 項目已排除**）。

| 專案 | URL | 授權 | 用途 | 策略 | 引入依賴？ |
|---|---|---|---|---|---|
| AG-UI Protocol | https://github.com/ag-ui-protocol/ag-ui | MIT | 事件協定藍本（WP3） | steal | ❌ |
| Vercel AI SDK | https://github.com/vercel/ai | Apache-2.0 | 工具七態狀態機、`repairToolCall`、HMAC approval 作法（WP1/WP5） | steal | ❌ |
| AI Elements | https://github.com/vercel/ai-elements | Apache-2.0 | 工具卡片狀態標籤／圖示對照表（WP3/WP4） | steal | ❌ |
| Langfuse | https://github.com/langfuse/langfuse | MIT（`ee/` 除外） | 時間軸攤平演算法、`treeLines`、`useIsMobile`（WP4） | steal | ❌ |
| LibreChat | https://github.com/danny-avila/LibreChat | MIT | 工具卡片取消判定、詳情區條件渲染（WP4） | steal | ❌ |
| AgentPrism | https://github.com/evilmartians/agent-prism | MIT | TraceSpan status 四分法、`duration` 顯示（WP3） | steal（型別） | ❌（`packages/ui` 為 private，無法安裝） |
| Anthropic Cookbooks | https://github.com/anthropics/claude-cookbooks | MIT | tool search 規格與門檻（WP2） | steal | ❌ |
| CopilotKit | https://github.com/CopilotKit/CopilotKit | MIT | `(args, status, respond)` 受控元件介面（WP5） | steal | ❌ |
| Chainlit | https://github.com/Chainlit/chainlit | Apache-2.0 | 確認拆成獨立訊息氣泡（WP5） | steal | ❌ |
| Fooocus | https://github.com/lllyasviel/Fooocus | GPL-3.0 | 「明文揭露 AI 自動代勞的事」哲學（WP5） | steal（僅哲學） | ❌（GPL，禁止引入程式碼） |
| Arize Phoenix | https://github.com/Arize-ai/phoenix | Elastic License 2.0 | 設計反證：trace 視覺化不需 graph 函式庫（WP4） | reference | ❌（非 OSI，禁止複製程式碼） |
| MCP 規格 | https://github.com/modelcontextprotocol/modelcontextprotocol | Apache-2.0（MIT 轉換中） | `TaskStatus`、`CallToolResult`、`ResourceLink`、`_meta` 前綴規則（WP2/WP3） | adopt（對齊，非套件） | ❌ |
| OTel GenAI semconv | https://github.com/open-telemetry/semantic-conventions-genai | Apache-2.0 | `usage` 欄位命名字典（WP3） | reference | ❌ |
| Langfuse Observation | https://github.com/langfuse/langfuse | MIT（`ee/` 除外） | `costDetails` 成本欄位形狀（WP3） | reference | ❌ |
| BFCL | https://github.com/ShishirPatil/gorilla | Apache-2.0 | 查證候選模型的 FC 分數（WP1 spike） | reference | ❌ |
| Mastra | https://github.com/mastra-ai/mastra | Apache-2.0（`ee/` 除外） | MCPServer ↔ agent tools 雙向對稱抽象（WP2） | reference | ❌ |
| `zod-to-json-schema` | https://github.com/StefanTerdell/zod-to-json-schema | ISC | 由 zod 產生 MCP JSON Schema（WP2） | adopt | ✅ **devDependency**（唯一新增，且不進產品 bundle） |

**新增的執行期依賴數量：0。** 唯一新增的是一個 build 時的 devDependency，產品 bundle 零位元組——這是刻意的，因為 `DECISIONS.md` D-006 的首屏 JS 與單一 route chunk 兩條門檻都已經超標。

---

## 附錄：開工前必做的三件事

1. **半天 spike：驗證 NIM 的原生 tool calling。** 直接對 `https://integrate.api.nvidia.com/v1/chat/completions` 送一個帶 `tools` 的請求（模型 `meta/llama-3.1-70b-instruct`），確認回得到 `tool_calls`。這是 WP1 的唯一未知數，失敗會改變整個方案的形狀。
2. **一行 PR：`server/services/mcp.ts:657` 的 `callTool` 加 `export`。** 可以先合，是 WP2 的物理前置。
3. **確認 `agentDag.ts` 搬到 `shared/` 不會違反其他約束**，並更新 `docs/adr/009-import-boundaries.md`（該 ADR 明文要求「不要在未更新 ADR 的情況下擴充 allowlist」）。

## 附錄：本文件中誠實標註的不確定處

- **NIM 部署是否啟用 tool-calling engine 未經實測**（見上方 spike）。模型家族支援 ≠ 該部署啟用。
- **fal 檔位的 USD 計價資料完整性未查證。** 若 `llmPricing` 未涵蓋所有 fal 檔位，`costUsd` 應為 nullable 並顯示「計算中」，不可顯示 0。
- **`TriangleAlert` 是否在 `Icon.tsx` 的 111 個名單內未逐一核對**（若無，用 `scripts/add-icon.mjs` 產生）。
- **估時（32 人天）假設單人熟悉此 codebase。** 不含 code review、QA 與真機測試往返。
- 調研材料中一個關於 React 版本的說法有誤：`package.json:72` 實測為 `"react": "^19.2.8"`，非部分調研假設的 React 18。本方案的結論不受影響（AgentPrism 因 `private: true` 本來就無法安裝）。
