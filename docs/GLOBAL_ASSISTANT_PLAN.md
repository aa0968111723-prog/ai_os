# 全站助手決策文件：「AI 工作」球 → 全站超級 AI

> 回答產品擁有者的方向性問題：「AI 工作那邊要不要變成全站超級 AI，像 Google 助手一樣一按就可以幫使用者解惑或創建全站的工具，依權限去做。」
> 撰於 2026-08-07。所有 file:line 皆已對照現行程式碼核實；不確定處明文標注。

---

## 1. 回答「要不要」

**要做，而且比想像中便宜——因為四分之三的架構已經存在，缺的主要是「接線」而非「新建」。**

但「全站超級 AI」不是一個工程可交付的名詞。把它重新定義成三件事，逐件對照現況：

| 可交付物 | 定義 | 現況 |
|---|---|---|
| **① 入口 UX** | 任何頁面一按中央球，蓋在當前頁上的助手浮層（參考 Google 助手截圖：喚出、覆蓋、底部輸入列） | **八成就緒**。中央 Orb 球已存在（CSS 四態動畫，`client/src/styles.mobile-tokens.css:167-180`；狀態機 `client/src/lib/orbState.ts`），貼底 sheet 契約已存在（MenuSurface portal 到 body、scrim z-46／sheet z-47 蓋過分頁列 z-44，`client/src/app/components/MenuSurface.tsx:20-41,186`、`client/src/styles.css:5612-5619`）。缺：球目前是導航錨點連結不是按鈕（`client/src/app/components/MobileNavigation.tsx:11`）、sheet 沒接鍵盤讓位、桌機沒有入口。 |
| **② 跨專案工具面** | 助手能查全站資料、能「創建」全站物件（專案／筆記／行程／任務／私訊…） | **就緒但未接**。71 支 MCP 工具（33 唯讀＋38 寫入，`shared/mcpCatalog.ts:53`）每支內建 ACL，`callTool` 已 export 且註解明言就是給站內助手用（`server/services/mcp.ts:666`）。組級問答後端 `teamAssistant.ask` 已完整（9 支唯讀工具＋派工提議，`server/routers/teamAssistant.ts:322-328`），對應前端 `AICreativeCopilot.tsx` 已寫好**但全站沒有任何頁面掛載它**（已核實：無任何非測試檔 import）。缺：全站 scope 的核心、寫入動作的確認閘擴充、`create_project` 這支 71 工具唯一沒覆蓋的高頻動作。 |
| **③ 權限與確認契約** | 「依他的權限去做」＝助手以本人身分執行，花錢／寫入先確認 | **全數就緒**。權限盤點結論：所有寫入 ACL 都在後端 service 內部（requireGroup／assertProjectEditable／resolveAgentAccess／reserveQuota／成本審批），四個入口共用同一批核心，**未發現「只在 UI 擋、後端沒擋」的路徑**（`server/services/policyEngine.ts:189-209`、`server/services/projectAcl.ts:24-51`）。「提議→確認→本人執行」契約在 `assistant.runAction` 已運轉（`server/routers/assistant.ts:1019-1026`）。助手層**零新增權限程式碼**。 |

結論：這不是「要不要做一個新東西」，是「要不要把三塊已完工的積木接起來」。建議做，且第一階段一週內可出貨（見 §5）。

**唯一要誠實承認的新建成本**：全站 scope 的助手核心（§4）與全站問答的 AiTrace 落庫（schema 有明確阻擋，§4）。

---

## 2. 目標體驗（使用者視角）

### 情境 A：「我這週要交什麼？」（任何頁，唯讀）
在今日工作台或筆記排程頁按球，輸入問題。助手以組級視角查：`schedule.list`／`list_tasks`／`group_blockers`（teamAssistant 既有內部工具，`server/routers/teamAssistant.ts:322-328`）＋ `generation.pendingSummary` 同源資料，回答「週五前有 2 個代辦、專案甲有 3 筆生成等你核准」，附深連結。
- 工具：唯讀，自動執行不需確認。**花點：0**（`ASK_COST_POINTS=0`，`server/routers/teamAssistant.ts:74`）。

### 情境 B：「幫我開一個中秋活動宣傳專案」（任何頁，寫入）
助手提議一張「建立專案」確認卡：組＝目前作用中組、名稱＝中秋活動宣傳、類型／平台從該組啟用中選項挑（`server/routers/projects.ts:141-166` 的必填欄位）。使用者按「確認建立」→ 以本人身分執行 `projects.create` 核心 → 跳轉 `/p/:id`。
- 寫入：**必經確認卡**（ResolvedAction 契約）。**花點：0**。注意：這是 71 工具唯一沒覆蓋的動作，需新建 action type（§4）。

### 情境 C：在專案頁內按球：「第三個分鏡的素材好了嗎？」（自動聚焦專案）
球在 `/p/:id`／`/studio/:projectId` 內喚出時自動聚焦該專案，直接走既有 `runAssistantAsk`（5 支唯讀工具、SSE 即時軌跡、工具結果視覺預覽，`server/routers/assistant.ts:241-253`、`server/index.ts:1791-1794`、`shared/toolResultPreview.ts`）。回答附分鏡縮圖預覽；若使用者接著說「幫我重生成」，走既有提議→確認→`runAction`，扣點與成本審批照舊（估點達組門檻自動落 `awaiting_approval` 等組長核准，`server/services/generationCore.ts:698-730`）。
- 唯讀 0 點；生成動作確認後扣點、審批鏈自動繼承。

### 情境 D：「幫我記一下：明天早上十點跟阿明對稿」（任何頁，寫入）
助手提議一張「新增行程」確認卡（標題／時間／代辦與否）。確認後經 `callTool(ctx.auth, {readOnly:false}, "add_schedule_item", …)` 執行（`server/services/mcp.ts:666`，內建 requireGroup＋審計），/planner 立即可見。
- 寫入必經確認卡。**花點：0**。同型的還有 `add_note`、`create_task`、`send_dm`（send_dm 確認卡顯示收件人與全文）。

---

## 3. 入口與 UX 形狀

### 3.1 手機（390px 優先）：中央球 tap → 貼底助手 sheet

- **喚出方式**：tap 即開（球的唯一功能從「導航到錨點」變成「開助手」）。Google 助手的「長按喚出」在 Web 有 iOS long-press 系統行為與 contextmenu 干擾，且我們的球不需要與其他功能分流——長按保留給未來語音（§7 開放問題）。
- **浮層本體**：直接用 `MenuSurface` 的 `surfaceRole="dialog"`（內容是表單／卡片時關閉 roving，`client/src/app/components/MenuSurface.tsx:50,64`）。≤820 自動 portal 到 `document.body` 變 bottom sheet（`MenuSurface.tsx:186`），scrim z-46／sheet z-47 蓋過分頁列 z-44（`client/src/styles.css:5612-5619,5580`），Esc／外點／把手下滑 48px 關閉皆內建。max-height 與 safe-area 幾何沿用 `.menu-surface.is-sheet` 既有值。
- **前置修復（必做）**：`.menu-surface.is-sheet` 沒接 `--kb-inset`——助手 sheet 一定有輸入框，鍵盤會直接蓋住輸入列。比照 `.modal-scrim` 的 `bottom: var(--kb-inset, 0px)`（`client/src/styles.css:1981`）與專案留言 sheet root（`styles.css:3290`）補上；輸入框聚焦走 `focusAndReveal`。注意 `styles.contract.test.ts` 鎖定多處字面，CSS 契約與測試要一起改。
- **Orb 狀態回饋**：沿用 `setOrbState`（`client/src/lib/orbState.ts`）——ask 進行中 `thinking`、回答完成 `speaking`（2.6s 自動回 idle）、失敗 `error`。目前唯一撥動者是直接生成流程（`DirectGenerateMode.tsx:172-175`），助手接上後球「有生命」的感覺就完整了。
- **選擇器同步（必做）**：Orb 樣式綁在 `.mobile-nav > a:nth-child(3)`（`client/src/styles.mobile-tokens.css:167-180`）。中央格從 `<a>` 改 `<button>` 會讓選擇器失配——一併改成顯式 class（如 `.mobile-nav__orb`），順手消掉註解自承的 DOM 順序依賴。
- **零狀態內容**：sheet 打開未輸入時，顯示原 `#ai-work` 落點的同源資料——「繼續創作（最近專案）＋ N 待處理徽章」（重用 `generation.pendingSummary`＋`projects.list`，同 `client/src/pages/Launchpad.tsx:541-604`）＋ 3-4 顆快捷提問（AICreativeCopilot 已有 4 顆可搬）。原 dashboard 區塊本體保留（見 §7 開放問題 1）。
- **沉浸模式（必做）**：新 sheet root 若常駐掛載，需加入 `body.studio-immersive` 隱藏清單（`client/src/features/animation-studio/studio.css:598-604`），該清單有 contract test 逐一斷言（`studio.styles.contract.test.ts:62`）。實務上沉浸時 `.mobile-nav` 已隱藏、球按不到，但 sheet 開著進沉浸的邊角要守住。

### 3.2 上下文注入：助手怎麼知道「你在哪」

Client 端組一個 context 物件隨 ask 送出：
```ts
{ route: location, projectId?: string, groupId: string }
// projectId 由路由 parse（/p/:id、/studio/:projectId）；groupId＝頂欄作用中組
```
**伺服器只把 route 當提示、不當授權**：projectId／groupId 一律經 `requireGroup`／專案查詢重新驗證（`server/routers/assistant.ts:664-666` 既有作法），偽造 context 頂多讓助手查到「你本來就有權看的東西」。

### 3.3 與專案內助手的關係（明確建議）

**同一顆球，自動聚焦，可切換。** 在 `/p/:id`／`/studio/:projectId` 喚出時預設「專案模式」（sheet 頂部顯示 scope chip「▸ 專案：XXX」），直接走既有 `runAssistantAsk`——立刻繼承 SSE 軌跡、工具預覽、7 種提議動作與 AiTrace。chip 可點回「全站模式」。理由：使用者在專案頁問的問題九成是這個專案的；而且這讓球與 `ProjectAssistant` 側欄共用同一核心，Phase 3 可收斂成同一元件，而不是第 5 個問答框。

### 3.4 桌機（>820px）

現況是空白畫布：桌機沒有「AI 工作」入口（topbar 六顆快捷不含它，`client/src/app/navigation/navigationItems.ts:179-186`）。**Phase 1 不做桌機**（不影響現有任何行為）；Phase 3 比照 `FloatingDmBubble`（左下 FAB＋dialog 浮窗，`client/src/components/FloatingDmBubble.tsx`，AppShell 全路由掛載 `AppShell.tsx:296`）做右下或左下助手浮窗，z-index 與 fb-fab-root(45)／scrim(46)／sheet(47)／modal(50) 協調。形態（浮窗 vs topbar 入口）列開放問題。

---

## 4. 架構

### 4.1 核心：不 generalize `runAssistantAsk`，也不寫第 8 套——抽共用迴圈

**不把 `runAssistantAsk` 的 projectId 改 optional。** 專案綁定是貫穿式的，改 optional 等於每段都要條件分支（＝第 8 套核心的偽裝）：
1. `server/routers/assistant.ts:664-666` 專案查詢＋組隔離（無專案即 NOT_FOUND）
2. `:667-688` createAiTraceSession 必帶 projectId（schema NOT NULL，見 4.5）
3. `:693-721` scenes／projectIntelligence／knowledge 全以 project.id 為鍵
4. `:724-779` 提議 resolve 全是專案動作（sceneNo 對 scenes 陣列）
5. `:795` reserveQuota 需 project.groupId
6. `runAction` 入參必填 projectId（`:1019-1026`）

**收斂策略（「不再增加第 N 套迴圈」的硬規定）**：現況工具迴圈整段複製 2 份（`assistant.ts:861-941`、`teamAssistant.ts:1144-1183`）、regex 撈 JSON 至少 7 處。Phase 2 新增 `server/services/assistantCore.ts`：
- `extractJsonObject()`：收斂 regex 撈 JSON 的單一實作（7 處逐步遷入）
- `runToolLoop({ llmCall, tools, maxRounds, onEvent })`：LLM 呼叫→JSON 抽取→工具 dispatch→forceFinal→fallback 的通用迴圈，`onEvent` 同時餵 SSE 與 trace
- **provider strategy 隔離**：「工具說明注入提示詞＋JSON 抽取」封裝成一個 strategy——NIM 原生 tool calling spike 有答案後，只換這層、不動呼叫端（見 §6）

全站助手（`globalAssistant.ask`）是 assistantCore 的**第一個使用者**；`teamAssistant.ask` 在同一 Phase 遷入（它與全站助手工具面重疊最大）；`assistant.ts` Phase 3 遷入。規則：**自此任何新助手／代理迴圈只准用 assistantCore**。

**globalAssistant 的定位**：它是 `teamAssistant.ask` 的演進而非平行品——重用其純函式（`resolveDispatches`／`resolveCommandProposals`／group_blockers 等聚合，`teamAssistant.ts:640,689`）、其 history 追問與 contextUsed 淨化，補上它缺的三件事：SSE、trace、寫入動作確認閘。

### 4.2 工具面：第一批名單與「71 支不能全掛」的處理

提示詞式迴圈下工具數是硬約束（MAX_TOOL_ROUNDS=3，`assistant.ts:88`）。策略是**常駐核心 ≤10 支＋context 感知加掛**，兩段式選擇（先選類別再露工具）在提示詞式下會吃掉 3 輪中的 1 輪，不划算——留待原生 tool calling spike 後評估。

**第一批常駐（唯讀、不需 projectId，經 `callTool(ctx.auth, {readOnly:true}, …)`）**：

| 工具 | 用途 |
|---|---|
| `list_projects` | 全站入口：拿到專案 id 才能鑽（`server/services/mcp.ts`） |
| `get_project_status` | 拿到 id 後的單案快照（需 projectId，由 list_projects 供給） |
| `query_database`（＋`list_databases`） | 以 dbRef 代號防幻覺（沿用 `assistant.ts:250` 慣例）；ACL 走 `resolveAgentAccess`（callTool 內建） |
| `find_model`／`get_model_contract` | 模型檢索（工具內檢索的既有示範） |
| `get_generation`／`get_note`／`get_knowledge`／`get_agent_run` | id 鍵型跨專案讀取（反查 groupId 再 requireGroup） |

加上 teamAssistant 既有的組級聚合（`group_blockers`／`list_tasks`／`project_intelligence`——這三支是內部函式非 MCP，直接 import 重用）。**context 感知加掛**：在專案聚焦模式改走 runAssistantAsk，其 5 支專案工具自然生效；全站模式若 context 帶 projectId，加掛 `list_scenes`／`list_generations` 等單專案視角工具（Phase 3）。

唯讀工具自動執行、附 `toolResultPreview` 視覺預覽（`shared/toolResultPreview.ts`＋`client/src/features/agent-trace/ToolResultPreview.tsx`，直接重用）。

### 4.3 寫入動作：全走「提議→ResolvedAction→確認→本人執行」

**不變式：LLM 的工具迴圈 scope 永遠 `{readOnly:true}`**——38 支寫入工具在 `runTool` 第一行就被 `scopeDeniedReason` 擋掉（`server/services/mcp.ts:682-683`、`shared/mcpCatalog.ts:135`）。寫入意圖只能以「提議」離開 LLM，resolve 成 ResolvedAction 卡片，使用者確認後由新 mutation `globalAssistant.runSiteAction` 以本人身分執行單一具名動作。

**「MCP write 直接執行 vs 站內提議」的差異怎麼處理**：同一支工具、兩條路徑、同一套 ACL 與審計（都落 `mcp.*` 審計，actorId=本人）。差別只在扳機——外部 MCP 金鑰是使用者**發金鑰時的一次性授權**（readOnly:false 即明示允許直接執行）；站內助手是**每個動作即時確認**。不需要改工具本身，只要站內永遠不把 `{readOnly:false}` 交給 LLM 迴圈。

**第一批開放的創建動作**：

| 動作 | 執行路徑 | 確認 | 點數 |
|---|---|---|---|
| `create_project` | **無 MCP 工具**——把 `projects.create`（`server/routers/projects.ts:141-166`）抽成 core 供助手與 router 共用 | 確認卡（組／名稱／類型／平台） | 0 |
| `add_note`、`add_schedule_item` | `callTool({readOnly:false})` | 確認卡 | 0 |
| `create_task` | `callTool`（網頁本無建立 tRPC，`server/routers/tasks.ts:9-28`；MCP 語義補位） | 確認卡 | 0 |
| `send_dm` | `callTool`（限同組夥伴，dmCore 內建） | 確認卡顯示收件人＋全文 | 0 |
| 生成／排代理（專案聚焦模式） | 既有 `assistant.runAction`（7 種，`assistant.ts:217-231`） | 既有確認＋成本審批鏈 | 扣點 |

`runSiteAction` 的 input 比照 `actionInputSchema` 做 discriminatedUnion，執行端逐分支重驗（payload 不可只信 resolve 結果——`assistant.ts:1030` 註解的既有原則）。

### 4.4 權限：不變式與例外

**不變式：助手以本人 AuthState 呼叫既有 service/command 層，ACL 全在被呼叫端內部；助手層零權限判斷。** `Context.auth` 就是 `AuthState`（`server/trpc.ts:15-19`），`callTool(ctx.auth, …)` 零轉換。組隔離、專案 editor/viewer、資料庫 agentAccess、點數四層上限、成本審批（member 估點達組門檻→awaiting_approval 等組長 `decideCost`，`generationCore.ts:698-730`）全部自動繼承。ADR-010 的「等級常數唯一出處」先例（`docs/adr/010-group-agent-command-authority.md:12-43`、`shared/groupAgent.ts`）沿用：派工／指令提議的露出照 `COMMAND_MIN_LEVEL` 同一張表過濾。

**盤點發現的例外（皆非安全洞，列為對齊項而非前置修復）**：
1. `assistant.runAction` 的 generate 直呼 `submitGenerationCore`（有成本門檻、**無 policyEngine**，`assistant.ts:1071-1080`）；MCP/workflow/agent 走 `executeGenerationCommand` 全套（`server/services/generationCommand.ts:40-66`）。**全站助手新碼一律走 executeGenerationCommand**；既有專案助手 Phase 3 對齊。
2. 資料庫必走 `resolveAgentAccess`（人權限 ∩ 每庫 agentAccess，`server/services/databaseAcl.ts:35-108`）——callTool 內建，前提是不繞過 callTool 直呼 runTool（未 export，刻意封死）。
3. 代理雙層審批（plan→approve 與生成級門檻是兩條鏈，`agentCore.ts:947-971`）——確認卡文案要區分「這是排計畫，執行還要核准」與「這筆直接扣點」。

### 4.5 AiTrace：schema 有阻擋，解法照 ADR-010 先例

`ai_trace_sessions.project_id` 與 `group_id` 皆 NOT NULL（`server/db/schema/aiTrace.ts:7-8`），讀取 API 以 projectId 起手——**無專案上下文的全站問答落 trace 被 schema 明確擋住**。ADR-010 同題已明文反對為上層方便放寬 NOT NULL（agent_events 選擇分表，`docs/adr/010-group-agent-command-authority.md:45-61`）。

**解法**：Phase 2 另立 `ai_site_trace_sessions`（`group_id` NOT NULL——全站助手 scope 固定單組，見 §6；`project_id` NULLABLE；`user_id`、mode='site_ask'）。events 表 `ai_trace_events.sessionId` 是無 FK 的 uuid（`aiTrace.ts:29`），**初步判斷可直接共用 events 表**——需在 Phase 2 開工時確認 migration 是否另建了 FK（不確定處，開工首日查）。
**Phase 1 誠實取捨**：全站模式暫不落 trace（與 teamAssistant 現況一致——它本來就不落），紅線二「工具呼叫完整揭露」以會話內即時呈現滿足（專案聚焦模式照常 SSE 軌跡＋落 trace；全站模式 Phase 1 顯示 contextUsed／工具摘要，Phase 2 補 SSE＋落庫）。

### 4.6 成本

- 問答維持 **0 點**：`ASK_COST_POINTS=0` 慣例（`assistant.ts:86`、`teamAssistant.ts:74`），`reserveQuota(0)` 仍佔限流防濫用；預設 NIM 檔位、絕不自動升級 fal（`assistant.ts:603-615` 註解原則）。
- 動作走既有鏈：71 支中只有 5 支扣點且全走 `executeGenerationCommand`／agentCore 既有門檻（冪等鍵、失敗退點、成本核准）——**全站助手不產生任何新扣點旁路**。`policyEngine.evaluatePolicy` 可在確認卡上預告「這筆需組長核准」。

---

## 5. 分階段交付

### Phase 1：接線出貨（估 4-5 人天，一週內；不依賴 NIM spike——兩套既有核心都是提示詞式迴圈，已在 NIM 上運轉）

**零後端新核心**：sheet 依 context 路由到兩套既有後端——專案頁走 `assistant.ask`（含 SSE／預覽／動作確認），其他頁走 `teamAssistant.ask`（組級問答＋派工提議；後端在 `teamAssistant.ts:772` 已完整）。這就是「未掛載的 AICreativeCopilot 接回來」的最短路徑。

| 檔案 | 改/新增 | 內容 |
|---|---|---|
| `client/src/components/GlobalAssistantSheet.tsx`（或 features/global-assistant/） | **新增** | MenuSurface `surfaceRole="dialog"` 包殼；scope 判斷（路由 parse projectId）；專案模式渲染既有 ProjectAssistant 邏輯、全站模式吸收 AICreativeCopilot UI（4 顆快捷提問、派工確認）；零狀態＝繼續創作＋待處理摘要 |
| `client/src/app/components/MobileNavigation.tsx` | 改 | 第三格 `<a href="/dashboard#ai-work">`→`<button>` 開 sheet（`:8-13`）；useHash 移除 #ai-work 分支（`:15-33`）；scrollToAnchorWhenReady 對此格不再需要 |
| `client/src/styles.mobile-tokens.css` | 改 | Orb 選擇器 `.mobile-nav > a:nth-child(3)` → `.mobile-nav__orb` 顯式 class（`:167-180`） |
| `client/src/styles.css`＋`styles.contract.test.ts` | 改 | `.menu-surface.is-sheet` 補 `bottom: var(--kb-inset, 0px)`（比照 `:1981`）；contract 測試字面同步 |
| `client/src/app/components/MobileNavigation.test.tsx` | 改 | `:20,91,107` 鎖定 href=/dashboard#ai-work 與錨點存在的斷言改寫成 button 行為 |
| `client/src/features/animation-studio/studio.css`＋`studio.styles.contract.test.ts` | 改 | sheet root 加入沉浸隱藏清單（`studio.css:598-604`、test `:62`） |
| `client/src/pages/HelpPage.tsx` | 改 | `:221` 五顆分頁說明文案：「AI 工作」改述為助手 |
| `client/src/app/AppShell.tsx` | 改 | `:263` 附近掛 sheet 開關 state；Orb 狀態接 `setOrbState`（thinking/speaking/error） |

**驗收（使用者看得到）**：任何頁按球→sheet 蓋過分頁列開啟，Esc／外點／下滑關閉；390px 鍵盤開啟時輸入列不被蓋；在專案頁開＝自動聚焦該專案（chip 顯示、SSE 軌跡＋縮圖預覽＋動作確認照舊）；其他頁開＝組級問答可用、派工提議可確認；問答期間球呈 thinking、答完 speaking；沉浸繪圖無殘留；`#ai-work` 區塊仍在 dashboard（僅不再是分頁落點）。

**風險與測試衝突**：MobileNavigation.test.tsx 三處斷言重寫；styles.contract.test.ts 字面鎖定連動；useHash 簡化後「今日／專案」互斥仍要成立；全站模式 Phase 1 無 SSE 即時軌跡與 trace 落庫（如 4.5 誠實標注，會話內顯示 contextUsed 摘要）。

### Phase 2：全站核心與寫入動作（估 7-9 人天）

| 檔案 | 改/新增 | 內容 |
|---|---|---|
| `server/services/assistantCore.ts` | **新增** | `extractJsonObject`＋`runToolLoop`＋provider strategy（§4.1） |
| `server/routers/globalAssistant.ts` | **新增** | `ask`（scope={groupId, projectId?}；工具面＝§4.2 第一批 callTool 唯讀＋teamAssistant 聚合函式；SSE 比照 `server/index.ts:1791` 模式）＋`runSiteAction`（create_project／add_note／add_schedule_item／create_task／send_dm 確認閘） |
| `server/routers/projects.ts` | 改 | `create` 抽 core 供 runSiteAction 共用（`:141-166`） |
| `server/db/schema/aiTrace.ts`＋migration | 改/新增 | `ai_site_trace_sessions` 分表（§4.5；events 表共用與否開工首日確認 FK） |
| `server/routers/teamAssistant.ts` | 改 | 迴圈遷入 assistantCore；純函式被 globalAssistant 重用；前端全站模式改指 globalAssistant.ask |
| `client GlobalAssistantSheet` | 改 | 全站模式接 SSE 軌跡＋toolResultPreview；寫入確認卡（含「需組長核准」預告） |

**驗收**：情境 A/B/D 全數可用；全站問答有即時軌跡且落 trace 可回看；「幫我開專案」確認後跳轉新專案；member 的花點提議在確認卡預告審批；工具迴圈只剩 assistantCore 一份新實作（assistant.ts 舊迴圈暫存、標記待遷）。

### Phase 3：桌機、收斂與擴充（估 6-8 人天）

- 桌機浮窗（FloatingDmBubble 模式）或 topbar 入口——依 §7 拍板；z 階梯與 fb-fab-root(45) 協調；`/chat` 的 assistant 氣泡樣式重用（`styles.css:1943`）。
- `assistant.ts` 迴圈遷入 assistantCore；generate 對齊 `executeGenerationCommand`；ProjectAssistant 側欄與球收斂為同一元件；評估 dm/messageAssistant（無工具、無動作的嚴格子集）吸收。
- 單專案視角唯讀工具 context 感知加掛；第二批寫入動作（資料庫寫入 3 支、request_upload_grant）；社群發布與任務網頁 router 補位（現況缺口：`server/routers/tasks.ts:9-28`、`community.publishFromSource` 僅能從既有物件發布）。
- NIM 原生 tool calling spike 結果落地：只換 assistantCore 的 provider strategy。

---

## 6. 明確不做的事

1. **不讓助手繞過確認直接執行寫入**：LLM 工具迴圈 scope 固定 `{readOnly:true}`；寫入只能以提議形態存在，經使用者逐動作確認後由 runSiteAction／runAction 以本人身分執行（紅線一）。也不開放「批次確認多個寫入」的一鍵全過。
2. **不做跨組資料聚合**：單次會話 scope 固定為作用中單一組；`list_projects` 雖天然回所有組，注入提示詞前以作用中 groupId 過濾；切組必須由使用者明示（重開 scope）。DM 對象限同組夥伴已由 dmCore 內建。這也是 site trace 表 `group_id` 能保 NOT NULL 的前提。
3. **不在 NIM spike 答案出來前把迴圈重寫成原生 tool calling**：提示詞式 JSON 迴圈是現行已驗證路徑；assistantCore 以 provider strategy 預留接口，屆時只換一層。
4. **不放寬 `ai_trace_sessions` 的 NOT NULL**：照 ADR-010 分表先例（`docs/adr/010-group-agent-command-authority.md:45-61`）。
5. **0 新增執行期依賴**：sheet＝MenuSurface、串流＝既有 SSE/EventSource、預覽＝toolResultPreview、動畫＝CSS——全部現成（bundle 已超標）。
6. **不寫第 8 套核心／第 3 份迴圈／第 8 處 regex**：新碼一律進 assistantCore；此文件即收斂的立約點。
7. **不繞過 `callTool` 直呼 `runTool`**：唯讀守衛、封存守衛、審計都在 callTool（`mcp.ts:666`，runTool 刻意未 export）。
8. **第一波不開 destructive／代人花錢動作**：stop/discard_agent、schedule.remove、notes.remove、`approve_agent`（替別人立刻花點——ADR-010 定義的貴動作）不進提議白名單。
9. **不畫假示意圖、不揭露隱藏推理**（工具呼叫本身完整揭露）、**不破壞 390px 優先**——四條紅線全程有效。

---

## 7. 開放問題（需產品擁有者拍板）

1. **原「AI 工作」落點區塊去留**：`#ai-work` 的「繼續創作＋待處理」（`Launchpad.tsx:541-604`）建議保留在 dashboard 且 sheet 零狀態重用同資料——還是球改造後就從 dashboard 移除？（建議：保留一版觀察，重複感重再移。）
2. **桌機形態**：右下浮窗（FloatingDmBubble 模式）、topbar 加一顆、或桌機不做？（建議：Phase 3 浮窗；桌機現況本無入口，不急。）
3. **語音要不要**：Google 助手截圖含語音暗示。Web Speech API 免依賴但 iOS Safari 相容性需查證；建議 Phase 3 後另評，長按手勢保留給它。
4. **全站問答歷史要不要給使用者回看**：Phase 2 落 trace 後，是否在 UI 開歷史列表（現有回看入口全以專案起手）？
5. **NIM 原生 tool calling spike 的優先級**：它決定工具面能否從 ≤10 支常駐擴到按需檢索全 71 支——要不要在 Phase 2 前先解出站白名單？
6. **專案內喚球的 scope chip**：預設聚焦專案＋可切全站（§3.3 建議）——接受這個預設嗎？
