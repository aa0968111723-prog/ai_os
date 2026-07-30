# AI 代理＋生成架構：現況能力與產業差距分析

> 範圍：`/workspaces/ai_os` 代理規劃／執行、生成 Command、MCP、AI 創作工作台前端  
> 對照：產業創作代理（多模態連貫、意圖路由、結果回饋重規劃、一體化創作台）  
> 依據：架構文件與核心實作（非推測）

---

## Already strong（keep）

### 1. 專案型「完整計畫」而非聊天包裝待辦
產品契約清楚：目標、成功條件、缺資訊、假設、風險、里程碑、估點／工期；步驟有 `sourceRefs`／`outputRefs`／`dependsOn`／穩定 `step.id`。見 `docs/AI代理架構與維運.md`、`shared/plan.ts`（`completePlanSummarySchema`、DAG 循環驗證）。

### 2. 分層邊界乾淨、入口共用守門
| 層 | 路徑 | 責任 |
|---|---|---|
| 契約 | `shared/plan.ts` | 計畫形狀與驗證 |
| 規劃解析 | `server/services/agentPlanning.ts` | JSON 守門、代號→UUID |
| 生命週期 | `server/services/agentCore.ts` | plan／approve／discard／stop、額度預檢 |
| 背景執行 | `server/services/agentRunner.ts` | DAG tick、副作用、陳屍回收 |
| 人類任務 | `server/services/taskCore.ts` | 等待喚醒、角色核准 |
| 事件／洞察 | `server/services/agentEventCore.ts` | 可稽核軌跡、健康／成果中心 |

路由薄殼；網頁與 MCP 共用 core（組隔離、ACL、封存、額度、資料庫 AI 權限）。成熟度報告評 **88/100 RC**。

### 3. 安全規劃（防幻覺寫入）
規劃提示只用 `member1`／`note1`／`db1` 等短代號；伺服器解析後才落地。未知引用、模糊日期、無效模型可降級為 `missingInformation` 或整計畫拒絕。核准前零副作用。`agentCore.ts` `planAgentCore`。

### 4. DAG 人類協作語義
`executionMode="dag"`：獨立 AI 分支可與人類等待並行；生成可並行提交；fail-closed；舊計畫線性相容。`agentDag.ts` + runner `selectAgentDagStep`。

### 5. 冪等與崩潰恢復（產業少見深度）
固定 `effectId`／`generationId`、`agent_step_effects` 憑證、split_script 的 provider-start／prepared／ambiguous 矩陣、task+run advisory lock、`(runId,eventKey)` 事件去重、stop 與終局 CAS。見 runner 註解與 `docs/AI代理架構與維運.md` 冪等表。

### 6. 生成單一 Command 路徑
`server/services/generationCommand.ts`：狀態機 → ACL → Policy → `submitGenerationCore`。Router／MCP／workflow／agent 不應分岔扣點。世界觀注入、角色／場景定裝、來源素材已在 `generationCore.ts` 支援（直呼生成路徑）。

### 7. 助手「提議＋確認」與唯讀工具輪
`server/routers/assistant.ts`：問答／發想／拆分鏡／工作流／`plan_agent`；寫入需使用者確認；最多 3 輪唯讀工具（素材、分鏡、生成、模型、資料庫列）。防自動燒點。

### 8. MCP 面寬且與網頁同權
`shared/mcpCatalog.ts` + `server/services/mcp.ts`：專案脈絡、生成、素材、資料庫、代理生命週期、事件／洞察、排程、筆記、私訊、`get_project_status`。個人金鑰、唯讀 scope、審計。

### 9. 工作台第一階段入口已成形
`client/src/components/AiHub.tsx`：四種開始方式（問 AI／直接生成／製作範本／執行計畫）+ 專案連動 chips + 活動 pill；收合不卸載助手／不中斷背景。規格：`docs/AI創作工作台-第一階段.md`。

---

## Partial（exists but incomplete）

### 1. 創作工作台仍是「導覽殼」非一體化台
現況：`AiHub` 用 `scrollIntoView` 跳 `#sec-studio`／`#sec-workflow`／`#sec-agent`；生成表單仍在 `ProjectPage.tsx`。提案的 `CreationWorkbench`／`CreationDraft`／模式 tabs／資源抽屜尚未落地；`client/src/features/creation-workbench/` 僅有 WB-00 `generationGates.ts` 與基線測試。跨模式帶入、共享草稿、統一成本摘要仍是文件目標（`docs/product/ai-creation-workbench-integration-pr-proposal.md` 階段 2–5）。

### 2. 計畫契約 vs Runner 步驟種類不完全對齊
`shared/plan.ts` 含 `notify`、`checkpoint`；`agentRunner.ts` 的 `AgentStep.kind` 與執行分支**沒有**這兩種（僅有終局 `notifyRunFinished` 推播）。契約超前執行器，擴充檢查表已寫但未閉環。

### 3. 代理生成路徑弱於直接生成
Runner 的 `generate`／`voiceover` 只傳 `modelId`、`prompt`、`sceneId`／`sceneRole`（`executeGenerationCommand`），**未**帶 `characterIds`、`scenePresetIds`、`sourceAssetId`。產業級「定裝連貫多鏡」在代理自動化裡斷層；直呼 `generationCore` 則已支援。

### 4. 角色／風格連貫性僅 foundation
`shared/animationContinuity.ts` + `docs/architecture/anim-02-continuity.md`：型別與 stale／snapshot 純函式已落地，**無** bible 版本表、無生成 API 掛載、無 UI 過期提示。動畫產線 remediation 仍屬後續。

### 5. 任務與成果中心未跨系統
Agent 有 `get_agent_insights` 統一 AI／人員任務與 `outputRefs` 成果；但 **generations + workflow runs + agent runs** 尚未後端聚合（工作台規格第二、三階段）。使用者仍見多條「執行中」語意。

### 6. 助手與代理是雙軌、非意圖路由
助手可 `plan_agent` 動作，但無「一句話自動判斷：問答 vs 單次生成 vs 範本 vs 多步計畫」的控制層（第四階段）。使用者仍需選入口。

### 7. 工具層未統一註冊
助手工具、MCP tools、Runner 步驟 kinds、workflow presets 各自定義；第五階段「跨系統工具層（權限／點數／核准／稽核同一註冊表）」尚未做。`generationCommand` 是生成子集的樣板。

### 8. 執行中不可「依結果重規劃」
核准後 DAG 固定；失敗 fail-closed，不支援 mid-run replan、vision 評分後改 prompt、分支 A/B 自動選優。產業創作代理常有「生成→看圖→改指令→再生成」閉環。

### 9. 營運證據缺口
成熟度報告：缺真實供應商 canary、壓測、備份還原、告警連線、事件冷歸檔政策。程式 RC，營運未升正式。

---

## Missing vs industry

對照 Runway／Kling 類連貫影片、Midjourney 變體與偏好、Adobe Firefly 企業治理、以及「agentic creative」產品（自動多鏡＋回饋）：

| 產業能力 | Aios 現況 |
|---|---|
| 意圖單一輸入框自動路由 | 無；四入口＋捲動 |
| 生成結果視覺 QA／自動重試品質 | 無 vision critic loop |
| 跨鏡角色／服裝／光線鎖定（bible 版本） | 僅 pure foundation |
| 代理步驟自動圖生圖／I2V／對嘴管線 | 代理 generate 禁 needs 來源模型 |
| 多變體並行＋人工或模型選優 | 無 |
| 偏好／風格記憶跨專案學習 | 世界觀為專案靜態設定 |
| 節點畫布／時間軸原生創作圖 | 非目標（提案明示不做無限畫布） |
| 串流預覽、逐步 refinement UI | 助手有 stream；生成多為 poll 狀態 |
| 社群範本市集 | 僅站內 workflow presets |
| 統一工具 registry（助手＝MCP＝Runner） | 分岔定義 |
| 執行中對話式改計畫 | 需 stop／重新 plan |

Aios 的**優勢軸**是：團隊專案治理、點數／核准、人類任務 DAG、MCP 與冪等——偏「工作室／團隊代理」，非「消費級魔法畫布」。

---

## Recommended upgrade themes（產品語言）

### T1｜一體化 AI 創作工作台（UX 收斂）
把問 AI、直接生成、範本、執行計畫收進同一模式切換與共享草稿，手機一屏完成「想法→生成」。

### T2｜意圖路由與創作草稿契約
一句目標自動建議模式；`CreationDraft` 跨模式不丟 prompt／模型／角色／素材。

### T3｜代理生成＝直接生成同一火力
多步計畫步驟可帶定裝、場景、來源素材；代理產物品質對齊手動生成台。

### T4｜角色／風格聖經進產線
版本化定裝寫入生成 lineage；過期提示；多鏡連貫成為預設而非進階手動。

### T5｜結果回饋重規劃（閉環代理）
失敗或品質不足時：修一步、補資訊、或人審後續跑——而非整份計畫只能停掉重來。

### T6｜統一任務與成果中心
一份清單看生成／範本／代理；一份成果牆連分鏡、素材、筆記、資料列。

### T7｜跨入口工具與治理平台
助手、MCP、Runner、範本共用工具註冊、估點、Policy、稽核事件語意。

### T8｜營運級可信賴
真實供應商 canary、Runner SLO 告警、事件保存政策——支撐「可背景執行」的產品承諾。

---

## Concrete file touchpoints per theme

### T1 工作台 UX
- `client/src/components/AiHub.tsx`（殼→模式容器）
- `client/src/pages/ProjectPage.tsx`（抽出 `#sec-studio` 生成表單）
- `client/src/components/WorkflowCard.tsx`、`PromptLibrary.tsx`、`GenerationList.tsx`、`AgentCard.tsx`、`ProjectAssistant.tsx`
- 新建（提案）：`client/src/features/creation-workbench/CreationWorkbench.tsx` 等 modes／drawer
- 規格：`docs/product/ai-creation-workbench-integration-pr-proposal.md`、`docs/AI創作工作台-第一階段.md`

### T2 意圖＋草稿
- 前端：`creationDraft.ts`（提案 contract）、`AiHub`／新 workbench state
- 後端可選：`server/routers/assistant.ts` 意圖分類；或薄 API 不碰 schema
- 基線：`client/src/features/creation-workbench/generationGates.ts`

### T3 代理生成火力對齊
- `shared/plan.ts`：generate 步驟欄位（characterIds／scenePresetIds／source）
- `server/services/agentPlanning.ts`：規劃白名單與引用解析
- `server/services/agentCore.ts`：提示詞允許 needs 模型條件
- `server/services/agentRunner.ts`：`executeGenerationCommand` 傳完整 payload
- `server/services/generationCore.ts`／`generationCommand.ts`（已具備，接線即可）

### T4 連貫性產線
- `shared/animationContinuity.ts`、`shared/animationDomain.ts`
- 後續 schema／migration、`server/db/schema*`
- `generationCore.ts` 寫入 continuity snapshot
- UI：`CharacterCards.tsx`、分鏡／生成紀錄
- 文件：`docs/architecture/anim-02-continuity.md`、remediation plan

### T5 閉環重規劃
- 新 step kinds 或 run API：`agentCore.ts` replan／resume-from-step
- `agentRunner.ts`：失敗策略、可選 checkpoint
- `shared/plan.ts`：落地 `checkpoint`／`notify` 執行語意
- 事件：`agentEventCore.ts` 記錄 replan 裁決
- 前端：`AgentCard` 補資訊／改步驟 UI

### T6 統一任務／成果
- 聚合服務（新建或擴 `agentEventCore.ts` insights）
- `server/routers/agents.ts`、`generation.ts`、`workflows.ts` 讀取面
- MCP：`get_agent_insights`／`get_project_status` 擴充
- UI：workbench 資源抽屜、`GenerationList` 合併

### T7 工具治理平台
- `shared/mcpCatalog.ts` 擴為跨入口 catalog（或平行 `shared/toolCatalog.ts`）
- `server/services/mcp.ts`、`assistant.ts` runAction、`agentRunner` kinds、`workflowRunner.ts`
- `policyEngine.ts`、`generationCommand.ts` 作樣板推廣到 note／schedule／task command

### T8 營運可信
- `docs/SLO與事故應變.md`、`docs/AI代理成熟度與測試報告.md`
- `server/bootstrap/runnerReadiness.ts`、`server/index.ts` ready
- E2E：`scripts/e2e-agent.py`、`scripts/e2e-ui/verify-agent.mjs`、`verify-workbench.mjs`

---

## 一句結論

Aios 在**團隊專案代理的安全、冪等、人類協作與 MCP 同契約**上已達產業少見的工程深度；與產業「創作魔法」的差距主要在**一體化創作 UX、跨鏡連貫、代理生成上下文完整度、結果回饋重規劃，以及跨系統任務／工具統一**。優先順序建議：T1→T3→T6→T4→T5（產品可感知），T7／T8 與工程／營運並行。
