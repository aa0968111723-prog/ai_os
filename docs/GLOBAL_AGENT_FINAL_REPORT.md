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

新增：`server/services/assistantCore.ts`（＋test）、`server/routers/globalAssistant.ts`（＋test）、`server/services/aiSiteTrace.ts`、`server/db/schema/aiSiteTrace.ts`、`drizzle/0050_ai_site_trace.sql`、`scripts/e2e-global-assistant.py`、`client/src/app/components/GlobalAssistantSheet.test.tsx`、docs×3。
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

## SELF-REVIEW（多代理對抗式，2026-08-08）

4 維度審查（安全授權／正確性／回歸／成本誠實）×17 條發現，每條經獨立對抗驗證代理逐一 REFUTE 測試——17 條全數 confirmed、全數修復（commit dd90733＋3c11de6）：

- **major×4**：send_dm 本文明文落 audit_log（補 AUDIT_REDACT_BODY，對齊 dm.send 隱私承諾）；確認卡只顯示 24 字摘要就讓使用者確認 2000 字私訊（改全文可見＋卡內自捲——這是紅線一「使用者看過才算確認」的實質漏洞）；trace 落庫失敗會吃掉算好的答案（全程 fail-safe）；確認卡時間顯示 UTC 差 8 小時（改台北時間）。
- **minor×13**：SSE 路徑補審計、abort 記 stopped、catch 保留 steps、quota 懸掛 session 收尾、空白 title/kind 丟棄、fallback 不吐工具 JSON、chip CSS 變數 out-of-scope fallback、專案模式保留調度面板核准徽章等。

## TEST / BUILD RESULTS

tsc ✓；build ✓；boundaries（0 違規）/ui-primitives/hooks ✓；server vitest 2032 passed（僅 D-007 既有本地紅＋一次偶發 hook timeout 單跑即綠）；client 受影響 5 檔全綠；migrationState＋auditWording 守門 48/48；e2e-global-assistant 22/22；瀏覽器實測（桌機＋390px）全流程走通。check:agent-planner canary 需真 FAL_KEY（本機無金鑰，既有限制）。

## PHASE 3 續作（2026-08-08 第二輪，同分支）

原 KNOWN LIMITATIONS 1／2／3／5 已完成：

1. ✅ **全站模式前端 SSE**：`requestSiteAssistantStream`（site done 形狀專屬 guard——與專案助手的 done 差 fallback/siteActions 欄位，共用 guard 會永不派發）＋LiveAssistantTrace 即時軌跡＋取消鍵；串流沒開始才退一次性 tRPC，吐過事件絕不重跑（防重複扣額度）。
2. ✅ **雙迴圈遷入 assistantCore**：teamAssistant.ask 與 assistant.ts（專案助手）的內嵌迴圈全數改走 runToolLoop——JSON 工具迴圈自此**單一實作、三個消費者**；C2 self-healing 與三種回覆來源的 trace 摘要語義保留（assistant 114＋coerce 8＋team 66 測試綠）。
3. ✅ **mock 確定性提議**：訊息含「專案」→create_project、含「筆記」→add_note，走同一條 resolveSiteActions 驗證——「ASK→提議→確認卡→runSiteAction→真寫入」在 E2E_MOCK 全鏈路可驗（e2e 25/25；瀏覽器實測確認卡按下後 DB 真的建案）。
4. ✅ **WATCH foundation**：sheet 零狀態「需要你注意」（重用 groupInsights＋agentOverview，零新後端；待核准／近期失敗／人類關卡／逾期／critical 阻塞；全健康時整塊不渲染）。

期間主幹併入 story-first 大改（PR #546/#547）：另一 session 已把主幹 merge 進本分支並把 0049_ai_site_trace 重編號為 0050（story-first 佔 0049）；合併後全新 DB migrate 至 0050 ✓、173 相關測試 ✓、e2e 25/25 ✓、story-first 新版專案頁上 sheet／chip／ProjectAssistant 嵌入實測正常。

## 第三輪（2026-08-08，REMAINING WORK 清算）

1. ✅ **generate 對齊 executeGenerationCommand**（§4.4 例外 1 收掉）：專案助手 runAction 的 generate 原直呼 submitGenerationCore（無狀態機／viewer 檢查／policyEngine）——最後一個生成旁路已對齊 Command layer。
2. ✅ **context 感知加掛**（§4.2 Phase 3）：全站模式在專案頁（chip 切到「整個組」）時，提示詞注入「使用者目前正停在專案 pN」——「這個專案」不再被反問；只當提示不當授權，pN 對不到就整句不注入。
3. ✅ **第二批寫入動作：add_database_row**：提議面只開放 agentAccess="write" 的庫（唯讀庫連提議都不給——「AI 提議＋人代按」不得繞過管理者的 AI 唯讀設定）；確認卡顯示每一欄值全文；執行端雙重閘（getAgentReadableTable.canWriteRows＋executeDatabaseWriteCommand 的人 ACL＋狀態機＋policy database.write）。request_upload_grant 不做（token 簽發不適合對話確認卡流）。
4. ✅ **agent runner：冪等寫入步驟暫時性 retry**：筆記／追加筆記／行程／改行程／任務／資料列六種步驟（全部 effectId 先持久化、重放安全）遇 DB 抖動或 SERVICE_UNAVAILABLE 不再一擊斃命整份計畫，留在 running 下一 tick 重試（cap 3）；權限／驗證錯誤照舊立即 failed。wait 節點 arming 因狀態轉移複雜刻意不動。
5. ✅ **NIM 原生 tool calling spike**：docs/NIM_TOOL_CALLING_SPIKE.md——協定支援確認（OpenAI 相容 tools/tool_choice，vLLM 引擎、逐模型而異）＋上線前三項實測清單（需真金鑰）＋落地方案（assistantCore 可選 nativeToolStrategy、兩路共存 per-model 白名單、forceFinal 改 tool_choice:"none"）。
6. ✅ **桌機浮窗形態（§7-2）收案**：維持現行「頂欄 AssistantLauncher＋同一張 forceSheet」——sheet 檔頭已記載理由（助手的外觀語言是感知光＋浮輸入框，錨定下拉會變成兩種產品）；FloatingDmBubble 式浮窗不另做。
7. **messageAssistant／dmAssistant 吸收（§Phase 3 評估項）**：暫不吸收——兩者是無工具、無動作的嚴格子集，遷入 assistantCore 收益只有一致性、風險是動到留言區既有行為；列為機會性重構（動到該檔時順手做）。
8. **WATCH 推播化**：關鍵事件的推播**既有已覆蓋**（生成待核准→推組長；代理計畫終局→推發起人；私訊→推收件人；均 event-driven）。缺的是時間觸發類（deadline 將至、專案停滯）——需要排程器，違反「不每分鐘掃全站」約束的最小方案是掛在既有 sweep 節奏上，列為獨立提案不硬做。

## KNOWN LIMITATIONS（最終）

1. 正式模型環境的 LLM 提議品質（非 mock）尚待實戰調校（提示詞已含平台/資料庫白名單與代號制防幻覺）。
2. NIM 原生 tool calling 需真金鑰做三項實測後才解封（spike 文件）。
3. WATCH 時間觸發類（deadline 將至）未做（見上第 8 點）。

## REMAINING WORK

NIM spike 三項實測（需金鑰）；WATCH 時間觸發提案；messageAssistant 機會性遷移。
