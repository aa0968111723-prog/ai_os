# AI 代理架構與維運

> 適用範圍：Issue #133、PR A–E。本文描述正式資料契約、執行語義、失敗恢復與擴充規則。

## 產品契約

AI 代理不是頁面跳轉器，也不是把聊天文字包成待辦。一次計畫包含：

- 使用者目標、成功條件、預期成果、缺少資訊、假設、風險、里程碑、成本與工期。
- AI 步驟、人類任務、等待、角色核准、筆記、排程、生成、分鏡與資料庫成果。
- `sourceRefs`（依據）、`outputRefs`（成果）、`dependsOn`（依賴）與穩定 `step.id`。
- 可稽核事件：規劃、人工核准、開始、等待、完成、失敗、人工恢復與終局。

產品顯示的是可驗證的動作、來源與結果，不保存或展示模型私密 chain-of-thought。

## 分層

| 層 | 單一責任 |
|---|---|
| `shared/plan.ts` | 完整計畫與 DAG 的跨前後端資料契約、循環與引用驗證 |
| `agentPlanning.ts` | LLM JSON 守門、安全代號解析、日期／引用降級、成本計算 |
| `agentCore.ts` | 規劃、核准、放棄、停止、ACL、額度與生命週期 |
| `agentRunner.ts` | 背景 DAG 推進、副作用、重啟恢復、停止競態與終局通知 |
| `taskCore.ts` | 正式人類任務、角色核准、等待喚醒與交易一致性 |
| `agentEventCore.ts` | 可稽核事件、健康度、阻塞、統一任務與成果中心 |
| notes/schedule/database/generation core | 實際副作用；網頁、MCP 與 Runner 共用守門 |
| `groupCommand.ts` | 組級指令（跨專案核准／停止／放棄／重跑／派工／調任務）的分級授權與組隔離；落地一律轉呼叫上列 core |
| `groupCampaignCore.ts`／`groupCampaignRunner.ts` | 組代理自己的多步調度計畫（campaign）與其背景執行器 |

路由只做傳輸驗證，不複製服務邏輯。網頁與 MCP 因此套用相同組隔離、專案 ACL、封存、額度及資料庫 AI 權限。

## 資料模型

- `agent_runs`：目標、結構化 `plan_summary`、步驟快照、目前狀態與估點。
- `agent_step_effects`：追加筆記／更新排程等非建立型副作用的永久冪等憑證。
- `project_tasks`：AI 與團隊共用的人類任務／核准；以 `wake_run_id`、`wake_step_id` 精準喚醒。
- `agent_events`：append-only 可稽核軌跡；`(run_id,event_key)` 唯一，跨 replica 重播不重複。
- notes、schedule_items、project_tasks：保存 `plan_run_id`、`plan_step_id`，支援雙向追溯。
- `group_agent_runs`／`group_agent_events`：組層的調度計畫與事件軌跡。**不併入上面兩張表**——`agent_events.project_id` NOT NULL，而組級的下令、超預算停手、跳過整條支線不屬於任何單一專案（見 ADR-010）。

常用查詢有 project/status/time、status/updated、user/status 與事件 run/project/time 索引。清單均有限制；事件使用 `nextCursor` 分頁。未核准計畫 14 天自動過期，避免免費規劃無界堆積。

## 安全規劃

LLM 看不到可直接寫入的 UUID。提示詞只提供：

- `member1`、`note1`、`schedule1`、`task1`、`db1` 等短代號。
- 經截斷的筆記／知識摘要、既有排程、任務與成員工作量。
- 白名單模型及真實點數、可寫資料庫欄位。

伺服器再把代號解析成真實 ID。未知代號、跨專案引用、無效模型、模糊時間、錯誤時序與失效依賴不會直接執行；可安全降級者轉成 `missingInformation`，不可安全降級者拒絕整份計畫。核准前不執行副作用。

## 規劃模型與規劃點數

代理規劃預設走**高品質模型**（`DEFAULT_AGENT_PLANNER_MODE = fal_quality`，目前是 Claude Sonnet 4.5），而不是免費的 NVIDIA NIM。理由不是「好模型比較潮」：規劃這一步決定了後面每一步要燒多少執行點數，一份依賴亂接、步驟漏光的計畫，省下的是規劃的幾點、賠掉的是整份計畫的執行成本。使用者仍可在規劃卡改成均衡／省點數／免費檔。

規劃本身**依實際 token 計點**（`shared/llmPricing.ts` 是換算的單一真相，口徑與模型目錄一致：USD × `USD_TO_TWD`、1 點 ≈ NT$1、付費呼叫最低 1 點）：

1. **預留**：送出前依「提示詞實際字數 × 該檔位輸出上限 × 可能的重試次數」估最壞情況，走 `reserveQuota`——額度不足在這裡就被擋下，不會讓人先花掉供應商的錢才發現點數不夠。
2. **結算**：供應商回來後以實際用量（優先用它回報的 `usage.cost`）算實扣點數，`settleUsagePoints` 多退少補。供應商沒回用量時保留預留值，不當成免費。
3. **失敗**：呼叫整段失敗＝沒有產生用量，預留全額退回。但**呼叫成功、計畫卻被判不合格**時照實結算——那筆錢平台真的付了，退成 0 點只是把它藏起來。
4. 免費檔（`nim`，以及 `auto` 走到 NIM 那一次）實扣 0 點；`reserveQuota` 對 0 點直接放行，不寫雜訊帳本列。

實扣結果寫進 `plannerTelemetry.pointsReserved` / `pointsActual`，規劃卡顯示「規劃扣點 N 點」，`run:planned` 事件也帶得走——「這份計畫是用什麼模型、花幾點排出來的」事後查得到。組代理的調度計畫（`planGroupCampaign`）走同一套，點數記在 `campaign:planned` 事件的 `plannerPoints`。

聊天助手是另一條路：它預設仍是免費 NIM（高頻動作，預設就該免費），偏好各自存（`aios.assistantAnswerMode` vs `aios.agentPlannerMode`）——共用一個鍵的話，把規劃調成高品質會連帶讓每一句閒聊都跑付費模型。

## DAG 與等待語義

新計畫的步驟帶 `executionMode="dag"`：

1. 只有全部依賴為 `done` 的 pending 步驟可執行。
2. Runner 優先提交其他可執行分支，再輪詢已送出的生成，因此多個供應商工作可並行。
3. 一個人類分支等待時，獨立 AI 分支繼續；沒有可執行／在途分支時，run 才變成 `waiting`。
4. 人員完成任務時，交易鎖與 Runner 使用同一 advisory lock key，原子更新任務、等待步驟、run 狀態與事件。
5. 核准拒絕、未知依賴或步驟失敗採 fail-closed，停止尚未送出的後續工作。

舊計畫沒有 DAG 標記時，自動套用原線性順序，部署不需要一次重寫歷史 JSON。

## 冪等與崩潰恢復

| 副作用 | 保證 |
|---|---|
| 建立筆記／排程／任務／分鏡 | 先持久化 `effectId`，並把它當目標資料列 UUID |
| 追加筆記／更新排程 | 業務更新與 `agent_step_effects` 在同一交易 |
| 生成 | 先保存固定 `generationId`，再以相同 ID 冪等送出 |
| 拆分鏡 | provider-start、prepared 結果、固定 scene IDs；不明外部結果採 at-most-once、停止人工確認 |
| 人類喚醒 | task lock + agent-run advisory lock + 單一 DB 交易 |
| 事件 | `(runId,eventKey)` 唯一，重播為 no-op |

已送出的生成在停止後仍允許自然結算，但不再送出新步驟。發起人被停權、移出組、降為 viewer 或專案封存時，每個新步驟前重新驗權並安全收斂。

## 可觀測性

`agents.eventsByProject`／MCP `list_agent_events` 提供分頁事件；`agents.insights`／MCP `get_agent_insights` 提供：

- healthy／attention／blocked 專案健康狀態。
- 等待、逾期、高優先阻塞、近七日失敗、待補資訊與風險。
- AI 與人員統一任務清單。
- 由 `outputRefs` 去重的成果中心。

事件資料只放 kind、依賴、來源、輸出、等待任務與錯誤摘要；不得放完整 prompt、token、密碼、私訊或模型內部推理。

## 組層：組代理總指揮

本文寫的是「一個專案裡的代理」。組層另有一個角色會**跨專案下令**：組代理總指揮——分級授權（none／dispatch／supervise／command）、六種組級指令，以及它自己的多步調度計畫（campaign）與背景執行器。

它不新增任何內容副作用：每一道指令都轉呼叫本文列出的 core（`planAgentCore`／`approveAgentCore`／`stopAgentCore`／`discardAgentCore`／`updateProjectTaskCore`），並以**發起人的身分**執行，因此本文的專案 ACL、封存、額度、規劃節流、併發鎖與冪等保證原樣生效。組這一層只多驗兩件事：下令者的等級、目標物是否屬於這個組。

完整說明（能力分層、授權矩陣、campaign 執行模型、點數授權的安全性質、兩張新表與排查手冊）見 **〈[組代理總指揮](./組代理總指揮.md)〉**；授權模型與事件表的取捨見 **[ADR-010](./adr/010-group-agent-command-authority.md)**。

## 新增步驟種類檢查表

1. 更新 `shared/plan.ts`、規劃 draft schema、Runner `AgentStep` 與前端 icon／文案。
2. 決定 actor、成本、ACL、來源與成果 reference。
3. 定義重播語義；有副作用必須先有固定 ID 或交易憑證。
4. 寫 unit state-machine test、真 PostgreSQL 競態／rollback test、MCP 與 E2E 驗收。
5. 補事件 started／waiting／completed／failed，不記 chain-of-thought。
6. 驗證停止、封存、權限撤銷、額度不足、重啟與兩 replica 同時推進。

## 維運

- 部署順序：`db:migrate` → `db:check` → 啟動 replicas。Web replica 不執行 DDL。
- 背景執行器有兩支：`agentRunner`（專案內 DAG）與 `groupCampaignRunner`（跨專案調度，每 8 秒一 tick）。兩支都靠 advisory lock 防多副本重複推進；組層排查見〈組代理總指揮〉的維運段。
- 事故排查：先看 run 狀態與 `agent_events`，再以 `generationId/effectId/taskId` 對照業務表。
- 不可手動把 waiting 改 running；應完成／裁決正式 task，讓交易喚醒。
- 不可刪除事件來「修狀態」。事件是事實軌跡，狀態修復使用新事件與經審核 migration。
- 大量事件保留年限由組織政策決定；目前不自動刪除，需監控 DB 容量並在達門檻前規劃冷歸檔。
