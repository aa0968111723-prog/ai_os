# AIOS Site-Wide Super Agent — Implementation Ledger

> 任務入口：docs/GLOBAL_ASSISTANT_PLAN.md（2026-08-07 撰、已對碼核實）。
> 本輪（2026-08-08 起）於 worktree `ai_os_superagent_wt`、分支 `claude/site-wide-super-agent` 施工。
> 規則：完成一項勾一項，不停等；只有 HARD BLOCKER 才停。

## 現況判定（開工 audit）

- Phase 1（Orb → GlobalAssistantSheet → teamAssistant/AICreativeCopilot 接線）**已由先前 PR 完成**（PR #543 一帶）：
  - `client/src/app/components/GlobalAssistantSheet.tsx` 存在，MenuSurface forceSheet，手機 Orb 按鈕 + 桌機 AssistantLauncher 兩入口。
  - 現況 scope 一律組級；專案聚焦/切換、寫入動作卡、SSE 軌跡、trace 落庫皆未做。
- Phase 2 後端（assistantCore / globalAssistant router / runSiteAction / site trace / projects.create core 抽出）**未開始**。

## Ledger

- [x] Audit（六路平行盤點：routers / MCP-ACL / agent runtime / client UI / trace-SSE / generation-projects）
- [x] Existing Agent Map（見 worklog「架構地圖」）
- [x] Global Assistant Shell（Phase 1 既有，驗證不回歸）
- [x] Context Resolver（client 端 route→scope context 物件；server 端只當提示不當授權）
- [x] Scope Router（deterministic：/p/:id、/studio/:projectId → PROJECT，其餘 → TEAM/GLOBAL）
- [x] MCP Tool Adapter（globalAssistant 常駐唯讀工具面 = callTool({readOnly:true})）
- [x] Global ASK（globalAssistant.ask：assistantCore 迴圈 + teamAssistant 聚合重用）
- [x] Global ACT（runSiteAction：create_project / add_note / add_schedule_item / create_task / send_dm）
- [x] Action Confirmation（前端確認卡；LLM 迴圈永遠 readOnly，寫入只以提議離開）
- [x] Orb Integration（thinking/speaking/error 已接 AICreativeCopilot；驗證新流不破壞）
- [x] Agent Run UI（沿用既有 AgentRunsPanel/agent-trace；本輪驗證不回歸）
- [x] Durable Runner Audit（agentRunner 恢復/鎖/CAS/orphan recovery 盤點）
- [x] Retry / Resume（盤點結論：既有機制完整；缺口→ ledger 附註）
- [x] Project Memory（結論：沿用 projectIntelligence + knowledge 為 retrieval 層，本輪不新建向量庫）
- [x] WATCH foundation（結論：既有 pendingSummary/group_blockers 即 event-driven 基礎；本輪納入 ask 工具面）
- [x] Security Tests（EVAL CASE 3/5/6/7：destructive 禁擋、tool failure 不假成功、注入不提權、重試不重複）
- [x] Integration Tests（globalAssistant.ask/runSiteAction 單元+整合測試）
- [x] Build（npm run build 綠）
- [x] Final Review（Staff-level 自審 + 多代理對抗式審查）

## 附註（盤點缺口與決策，隨施工更新）

- 見 docs/agent-implementation-worklog.md。
