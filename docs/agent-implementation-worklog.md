# AIOS Site-Wide Super Agent — Worklog

> 2026-08-08 起。worktree `ai_os_superagent_wt`、分支 `claude/site-wide-super-agent`、base=`origin/claude/healing-migration-ai-os-erewp2`@b06686c（PR #545 後）。

## GOAL

依 docs/GLOBAL_ASSISTANT_PLAN.md 落地 Phase 2「全站核心與寫入動作」＋ Phase 3 的 scope 路由前置：
ASK（全站問答）／ACT（確認卡寫入）／scope 自動聚焦專案，全程重用既有核心，LLM 迴圈永遠唯讀。

## CURRENT ARCHITECTURE（audit 核實，2026-08-08）

- **Phase 1 已上線**（PR #543 一帶）：Orb=按鈕、GlobalAssistantSheet（MenuSurface forceSheet）掛 AICreativeCopilot（teamAssistant.ask）＋GroupCampaignPanel；桌機 AssistantLauncher 在頂欄。現況 scope 一律組級、無專案聚焦、無 SSE、無 trace、無寫入動作卡。
- **兩套提示詞式 JSON 工具迴圈**：assistant.ts:953（專案，SSE+trace 完整）、teamAssistant.ts:1144（組級，9 工具+派工/指令提議）。JSON regex 抽取共 8 處。
- **MCP=工具單一真相**：72 支（33 讀/39 寫），callTool 是唯一入口（審計+readOnly 守衛內建；runTool 未 export）。**無 create_project 工具**。
- **Command layer**（policy 檢查）：executeGenerationCommand／executeNoteCommand／executeScheduleCommand／**executeTaskCommand（已建成但全站零呼叫者）**。MCP 的 note/schedule/task 寫入直呼 core 繞過 policy（既有現況，不在本輪改）。
- **createProjectCore 已存在**（projectCore.ts:18，組代理 create_project 步驟同源）＋ listProjectCreationOptions。
- **ai_trace_sessions.project_id NOT NULL**（0026 migration，無 FK）；events 表 sessionId 無 FK 可共用。migration 流程：schema 檔→ `npm run db:generate`（下一個是 0049）→ migrate.ts；runtime 絕不施 DDL。
- **SSE 模板**：server/index.ts:1923 /api/assistant/ask（open/step/done/error＋15s 心跳＋AbortController）。client 有 assistantStream.ts（AssistantSseDecoder）與 LiveAssistantTrace。
- **ProjectAssistant**（client）已有完整 SSE+動作確認卡+trace 回看，props { projectId, embedded } 可直接嵌 sheet。
- **限流事實**：reserveQuota(points≤0) 直接 return null＝**無任何限流效果**（計畫文件此點有誤）；teamAssistant.ask 靠 consumeRateLimit(RATE_LIMIT_SCOPES.teamAssistant, 6/min)。
- **Agent runner 耐久性**（盤點結論，本輪不動）：advisory lock＋CAS＋zombie sweep＋step effectId 冪等（agent_step_effects 表）＋split_script at-most-once 恢復。缺口：無 failed-run resume API、無 LISTEN/NOTIFY（4s 輪詢）、非 generation/split 步驟無 retry。此輪不引入新基建。

## DECISIONS

- **D-SA-1 runSiteAction 走 Command layer 而非 callTool**：executeNoteCommand/executeScheduleCommand/executeTaskCommand 有 policyEngine＋專案狀態機檢查；tRPC mutation 本身經 authedProcedure 落審計。callTool 的 MCP 審計是給外部金鑰的口徑；站內確認卡動作以 policy 檢查優先。順帶把 executeTaskCommand 從「零呼叫者」接上線。
- **D-SA-2 create_project 用 createProjectCore**：不新增 MCP 工具（外部金鑰要不要開放建專案是另一個產品決定），站內動作直呼 core。
- **D-SA-3 globalAssistant.ask＝teamAssistant 演進**：從 teamAssistant.ts 抽出可重用的 context 組裝與工具執行（export），globalAssistant 加上：site 動作提議、trace 落庫、onEvent（SSE）。teamAssistant.ask 行為不變（其前端呼叫者照舊）。
- **D-SA-4 LLM 迴圈唯讀不變式**：globalAssistant 的迴圈只執行 teamTool（唯讀）；寫入只以 siteActions 提議離開，經前端確認卡→runSiteAction 以本人身分執行。無批次一鍵全過。
- **D-SA-5 site trace 分表**：ai_site_trace_sessions（group_id NOT NULL、project_id NULLABLE、mode='site_ask'）；events 共用 ai_trace_events（無 FK，audit 核實）。讀取走 globalAssistant.traces/trace（owner+group 雙鎖，比照 aiTrace 服務）。
- **D-SA-6 限流**：新增 RATE_LIMIT_SCOPES.globalAssistant（6/min，與 team 同價）；不依賴 reserveQuota(0)。
- **D-SA-7 scope 路由 deterministic**：client 以 route 前綴判斷（/p/:id、/studio/:projectId → 專案聚焦，chip 可切回組級）；伺服器把 projectId 當提示不當授權（沿用既有 requireGroup 重驗）。

## TASK LEDGER 對照

見 docs/agent-implementation-ledger.md。

## COMPLETED

- 六路多代理 audit（825k tokens）＋核心檔案自讀核實。
- Ledger／Worklog 建立。

## CURRENT TASK

Step 1：server/services/assistantCore.ts（extractJsonObject＋runToolLoop）＋單元測試。

## TEST RESULTS

- 基線（開工時未跑，沿用 D-007/D-008 記載的本地 Windows 紅測基線；以「失敗集不增加」為判準）。

## KNOWN ISSUES

- 本地 Windows 有既有紅測（userAvatar POSIX 路徑等，見 DECISIONS.md D-007/D-008）；CI Linux 為準。

## NEXT STEP

Step 1 → 2（rateLimit scope）→ 3（teamAssistant 抽取）→ 4（globalAssistant router）→ 5（site trace）→ 6（SSE 端點)→ 7（client scope 路由＋動作卡）→ 8（安全/整合測試）→ 9（docs＋final report）。
