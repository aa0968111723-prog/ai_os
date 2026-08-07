# AIOS Site-Wide Super Agent — Final Report

> 2026-08-08，分支 `claude/site-wide-super-agent`（base：`origin/claude/healing-migration-ai-os-erewp2`@b06686c，PR #545 後）。
> 任務入口：docs/GLOBAL_ASSISTANT_PLAN.md（Phase 2「全站核心與寫入動作」＋Phase 3 的 scope 路由前置）。

## WHAT EXISTED BEFORE（開工盤點，六路多代理 audit 核實）

- **Phase 1 已上線**：Orb=按鈕開 `GlobalAssistantSheet`（MenuSurface forceSheet）、桌機頂欄 `AssistantLauncher`；sheet 內容固定組級（AICreativeCopilot→teamAssistant.ask）＋GroupCampaignPanel。無專案聚焦、無寫入動作、無 trace、無 SSE。
- **兩套提示詞式 JSON 工具迴圈**：assistant.ts（專案，SSE＋trace 完整）、teamAssistant.ts（組級，9 唯讀工具＋派工/指令提議）；JSON regex 抽取散在 8 處。
- **MCP＝工具單一真相**：72 支（33 讀/39 寫）、callTool 唯一入口（審計＋readOnly 守衛；runTool 刻意不 export）。無 create_project 工具。
- **Command layer**（policyEngine 檢查）：generation／note／schedule／task／database——其中 `executeTaskCommand` 建好但全站零呼叫者。
- **`createProjectCore` 已存在**（組代理 create_project 步驟同源）＋ `listProjectCreationOptions`。
- **ai_trace_sessions.project_id NOT NULL**；events 表 sessionId 無 FK。
- **Agent runner 耐久性已相當完整**：PG advisory lock＋CAS 終局翻轉＋zombie sweep（30min stale→退點收尾）＋step effectId 冪等（agent_step_effects 唯一鍵）＋split_script at-most-once 恢復＋計畫 14 天過期＋雙層審批。已知缺口（本輪不動，見 REMAINING）：failed-run 無 resume API、4s 輪詢無 LISTEN/NOTIFY、非 generation/split 步驟無 retry。
- **重要事實修正**：`reserveQuota(points≤0)` 直接 return——0 點問答的「佔限流」是誤解，濫用防護必須靠 consumeRateLimit。

## WHAT WAS REUSED（不重做的部分）

buildTeamAskContext（組級視野）、runTeamTool（9 唯讀工具）、resolveDispatches／resolveCommandProposals／sanitize*／buildHistoryBlock、createProjectCore、executeNote/Schedule/TaskCommand、sendDm/assertDmPeer、reserveQuota/refund、recordAiTraceEventSafely＋sanitizeAiTracePayload（事件與遮蔽整套）、completeText（llmProvider）、MenuSurface／ProjectAssistant／orbState／SSE 協定模板／AssistantSseDecoder。

## WHAT WAS CHANGED / NEW ARCHITECTURE

```
              使用者（手機 Orb ／ 桌機 AssistantLauncher）
                              │
                    GlobalAssistantSheet
              deterministic scope 路由（route 說了算）
              /p/:id、/studio/:projectId ──┐ 其他頁
                       chip 可互切          │
             ┌─────────────┴──────────────┐
        PROJECT scope                 TEAM/GLOBAL scope
        ProjectAssistant（既有）       AICreativeCopilot
        assistant.ask＋SSE＋動作卡     globalAssistant.ask（新）
                                          │
                              assistantCore.runToolLoop（新，唯讀不變式）
                              buildTeamAskContext（同源視野）＋runTeamTool
                                          │
                     回覆＝answer＋dispatches＋actions＋siteActions（提議）
                                          │ 使用者按確認卡
             ┌────────────┬───────────────┼──────────────┐
      runSiteAction   teamAssistant.dispatch      teamAssistant.command
      （新 mutation）      （既有）                     （既有）
             │
   create_project→createProjectCore
   add_note→executeNoteCommand（policy）
   add_schedule_item→executeScheduleCommand（policy）
   create_task→executeTaskCommand（policy；首個呼叫者）
   send_dm→dmCore.sendDm
```

安全不變式（紅線一，源碼契約測試鎖定）：**LLM 迴圈只執行唯讀工具；寫入只以提議離開 LLM，經確認卡由使用者本人單發執行；本層零權限判斷、零直接 DB 寫入**（ACL/policy 全在被呼叫端）。

## FILES CHANGED（27 檔，+2348/−351）

新增：`server/services/assistantCore.ts`（＋test）、`server/routers/globalAssistant.ts`（＋test）、`server/services/aiSiteTrace.ts`、`server/db/schema/aiSiteTrace.ts`、`drizzle/0049_ai_site_trace.sql`、`scripts/e2e-global-assistant.py`、`client/src/app/components/GlobalAssistantSheet.test.tsx`、docs×3。
修改：`teamAssistant.ts`（buildTeamAskContext 抽取＋export，行為不變）、`server/index.ts`（SSE 端點）、`routers/index.ts`（註冊）、`rateLimit.ts`（scope）、`auditWording.ts`、`migrationRevisions.ts`、`migrationState.test.ts`（bridge 計數＋註記）、`GlobalAssistantSheet.tsx`、`AICreativeCopilot.tsx`、`api.ts`（AppRouter type re-export）、`styles.css`、測試 mock×3、`drizzle/meta/_journal.json`。

## DATABASE CHANGES

`ai_site_trace_sessions`（0049，手寫冪等 SQL 照 0026 風格）：group_id NOT NULL／project_id NULLABLE／mode='site_ask'，(group,created)＋(user,created) 索引。事件共用 `ai_trace_events`（無 FK，audit 核實）。照 ADR-010 分表先例，不放寬既有 NOT NULL。全新 DB 實測 migrate＋drift none；migrationRevisions 已釘 hash；legacy bridge no-op 計數同步（三句皆 IF NOT EXISTS）。
**踩坑紀錄**：drizzle snapshot 只維護到 0026 前後，`npm run db:generate` 會產出混入 27 支既有表的假 migration——本 repo 慣例是手寫冪等 SQL＋手動 journal 條目。

## MCP CHANGES

零。MCP 目錄仍是工具單一真相；本輪站內動作走 Command layer（policy 較 callTool 路徑完整）。「create_project 是否開放給外部 MCP 金鑰」留產品決策。

## ASSISTANT / AGENT RUNTIME CHANGES

- `assistantCore.ts`：extractJsonObject／stripJsonObject／runToolLoop（forceFinal、abort、fallback、hooks）＋ASSISTANT_READONLY_SCOPE。收斂立約：新迴圈只准用這裡。
- `globalAssistant.ask`：限流（6/分/人專屬桶）→ buildTeamAskContext → 成員代號 mN＋listProjectCreationOptions → site trace session → mock 短路 → 唯讀工具迴圈（trace provider/tool 事件逐輪落庫）→ resolve（dispatches/commands/siteActions 三路，幻覺代號丟棄）→ finalize trace。錯誤路徑：refund＋trace failed＋人話回覆（不假裝成功）。
- `runSiteAction`：payload 逐分支 zod 重驗＋時間可解析檢查；執行走 Command layer／core；經 authedProcedure 自動落審計（auditWording 已補文案與分類）。
- Agent runner 本體未動（盤點結論：現有耐久性機制足以支撐；缺口見 REMAINING）。

## ORB / UI CHANGES

- sheet：scope chip（radiogroup「這個專案／整個組」，只在專案路由出現）；專案模式嵌 ProjectAssistant（key=projectId 換案重掛）；組級模式維持 GroupCampaignPanel＋copilot。
- copilot：改走 globalAssistant.ask（帶 projectId 脈絡）；三種確認卡（站級動作／派工／監督指令），各自 pending→done(✓＋前往連結)/error(重試) 狀態；Orb thinking/speaking/error 契約不變（契約測試綠）。

## BACKGROUND EXECUTION

長任務仍走既有 agentRuns 背景執行器（派工卡→planAgentCore→核准→runner），本輪未新增第二套。SSE `/api/assistant/site-ask` 已就緒（open/step/done/error＋心跳＋abort 中止在途 LLM）。

## MEMORY

沿用既有層（projectIntelligence／knowledge／history 追問）；不新建向量庫、不把模型輸出寫成永久記憶。全站問答軌跡落 site trace（owner-scoped 回看），是紀錄不是第二真相。

## SECURITY

- 唯讀不變式有三層：型別（ASSISTANT_READONLY_SCOPE readonly true）、結構（迴圈只接 runTeamTool）、源碼契約測試（`readOnly: false` 出現即紅、db.insert/update/delete 出現即紅、destructive 型別出現即紅）。
- 注入防線：素材資料不是指令句、contextUsed 白名單、代號制（pN/mN/rN/tN，uuid 不進提示詞）、resolve 端幻覺丟棄；封閉 discriminatedUnion 使「刪除專案」類動作在型別空間就不存在。
- e2e 負例：跨組 projectId 借道、非組員 ask、他人軌跡、壞時間格式、限流——全部實測被擋。
- trace 落庫全程經 sanitizeAiTracePayload（秘密／簽名 query／私密推理遮蔽）。

## TEST / BUILD RESULTS

tsc ✓；build ✓；boundaries（0 違規）/ui-primitives/hooks ✓；server vitest 2032 passed（僅 D-007 既有本地紅＋一次偶發 hook timeout 單跑即綠）；client 受影響 5 檔全綠；migrationState＋auditWording 守門 48/48；e2e-global-assistant 22/22；瀏覽器實測（桌機＋390px）全流程走通。check:agent-planner canary 需真 FAL_KEY（本機無金鑰，既有限制）。

## KNOWN LIMITATIONS

1. 全站模式前端仍是一次性 mutation（steps 事後摘要）；SSE 端點已就緒、前端接 AssistantSseDecoder 列下一輪。
2. teamAssistant.ask／assistant.ts 迴圈本體尚未遷入 assistantCore（已共用上下文與 schema；遷移屬機械工程，Phase 3）。
3. mock 模式不產 siteActions 提議（LLM 不在場）；提議→確認的 UI 全鏈路要靠真模型環境驗。
4. 站級動作第一批五種；資料庫寫入、request_upload_grant 等第二批未開。
5. WATCH 僅止於既有 event-driven 基礎（pendingSummary／group_blockers 進 ask 工具面）；主動通知/推薦引擎未做。

## REMAINING WORK（依優先序）

Phase 3：全站模式前端 SSE 軌跡；兩個舊迴圈遷入 assistantCore；桌機浮窗形態檢討；單專案視角工具 context 感知加掛；第二批寫入動作；agent runner 缺口（failed-run resume、非 generation 步驟 retry）；WATCH 主動化；NIM 原生 tool calling spike。
