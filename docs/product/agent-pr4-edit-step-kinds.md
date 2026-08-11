# PR-4：Expand Edit Step Kinds（reorder / update / trim）

> 優先級：P1  
> 對應：TRUE_AGENT_ROADMAP A、AI代理架構與維運「新增步驟種類檢查表」

## 目標

補齊「規劃得出來卻執行不了」的核心缺口——讓代理能真正做分鏡編輯動作。

## 終端機指令

```bash
git checkout -b feat/agent-edit-step-kinds origin/claude/healing-migration-ai-os-erewp2
```

## 範圍（嚴格依架構檢查表）

**要新增／強化的 kind：**
- `reorder_scenes`
- `update_scene`（含 durationSec / trim / voiceover / ambience 等）
- 可選：`set_scene_visual`、`remove_scene`（破壞性需更謹慎，建議先 request_approval）

**必須同步更新：**
1. `shared/plan.ts` + draft schema
2. Runner `AgentStep` + advance 分支
3. 前端 icon／文案（AgentCard）
4. 事件 started / completed / failed
5. unit state-machine + 真 PG 競態／rollback 測試
6. MCP 對應（若適用）
7. 停止、封存、權限撤銷、額度不足、重啟與雙 replica 驗證

## 建議修改檔案

- `shared/plan.ts`
- `server/services/agentPlanning.ts`
- `server/services/agentCore.ts`（planner prompt 清單）
- `server/services/agentRunner.ts`
- 相關 scenes core / router
- `client/src/components/AgentCard.tsx`
- 測試檔

## 紅線

- 冪等：reorder 傳整串 orderedIds；update 建議寫 before 值進審計
- 不繞過 ACL／封存／額度
- 不記錄 CoT

## 驗收標準

- [ ] 新 kind 可被規劃、核准、執行、事件記錄
- [ ] 失敗與停止行為符合 fail-closed
- [ ] 檢查表全部打勾
- [ ] typecheck / test / e2e-agent（若動到執行路徑）通過

## 建議 PR 標題

```
feat(agent): add reorder_scenes and richer update_scene step kinds
```
