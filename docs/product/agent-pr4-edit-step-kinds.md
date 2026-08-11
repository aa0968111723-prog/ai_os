# PR-4：Expand Edit Step Kinds（reorder / update / trim）

> 優先級：P1  
> 對應：TRUE_AGENT_ROADMAP A、AI代理架構與維運「新增步驟種類檢查表」

## 目標

補齊「規劃得出來卻執行不了」的核心缺口——讓代理能真正做分鏡編輯動作，同時把 revision、競態、rollback、audit、重試 side effect 一次定義清楚。

## 終端機指令

```bash
git fetch origin
git checkout -b feat/agent-edit-step-kinds origin/main
```

## 範圍（嚴格依架構檢查表）

**要新增／強化的 kind：**
- `reorder_scenes`
- `update_scene`（含 durationSec / trim / voiceover / ambience 等）
- 可選：`set_scene_visual`、`remove_scene`（破壞性需更謹慎，先 request_approval / confirm）

**必須同步更新：**
1. `shared/plan.ts` + draft schema
2. Runner `AgentStep` + advance 分支
3. 前端 icon／文案（AgentCard / DAG）
4. started / completed / failed observable event
5. unit state-machine + 真 PG 競態／rollback 測試
6. MCP 對應（若適用）
7. 停止、封存、權限撤銷、額度不足、重啟與雙 replica 驗證
8. revision / optimistic concurrency contract
9. before / after audit 與可逆變更證據
10. idempotency：retry 不得重複 side effect / 重複扣點

## 建議修改檔案

- `shared/plan.ts`
- `server/services/agentPlanning.ts`
- `server/services/agentCore.ts`（planner prompt / capability 清單）
- `server/services/agentRunner.ts`
- 相關 scenes core / router
- revision / audit / event core
- MCP catalog / parity test（若適用）
- `client/src/components/AgentCard.tsx`
- `client/src/components/AgentDagCanvas.tsx`（若 PR-3 已合併）
- 測試檔

## Step payload contract

### `reorder_scenes`

建議使用完整 ordered ids + base revision，而不是「把 A 移到 B 前面」這種難以重試的相對指令：

```ts
{
  kind: "reorder_scenes",
  projectId: string,
  orderedSceneIds: string[],
  baseRevision: string,
  idempotencyKey: string
}
```

驗證：
- ids 必須剛好覆蓋允許排序的目標集合，不能有 duplicate / unknown id
- 執行前重新檢查 ACL、archive、revision
- `baseRevision` 不符 → 409 / structured conflict，不偷偷用最新資料硬套

### `update_scene`

```ts
{
  kind: "update_scene",
  projectId: string,
  sceneId: string,
  patch: {
    durationSec?: number,
    trimStartSec?: number,
    trimEndSec?: number,
    voiceover?: string,
    ambience?: string
  },
  baseRevision: string,
  idempotencyKey: string
}
```

規則：
- patch 只允許白名單欄位
- trim / duration 有 domain validation（不得負數、end < start、超出來源長度等）
- 空 patch 不執行 side effect
- 所有 before value / after value 都進 observable audit，但不得寫 CoT

## Concurrency / conflict policy

- 所有 write step 執行前重新讀 authoritative row + revision。
- `baseRevision` 已過期：回 structured `conflict_revision_mismatch`。
- UI / AgentCard 提供：重新讀取並 replan，而不是自動覆蓋使用者更新。
- 同一 `idempotencyKey` 重試必須得到同一 logical outcome，不重複寫入、不重複扣點。
- advisory lock / transaction boundary 必須包住「revision check + write + audit/event」的必要原子區段。
- multi-replica 同時 claim 同一步驟時，只能有一個 side effect 成功。

## Rollback / compensating action

對可逆的 update / reorder：
- audit 必須保存足夠的 before state（只存必要 observable values）
- 若 DB write 成功但後續 event / secondary action 失敗，定義清楚 transaction 是 rollback 還是 commit + retry event
- 不允許出現 UI 顯示 failed 但資料其實已改、而 retry 又再改一次的 split-brain UX

對不可逆 / 外部 side effect：
- 不能假裝 rollback；必須標記 `compensatable: false` 或 equivalent
- retry 前先查 external idempotency / existing result

## Audit / event contract

每次 write 至少能追到：
- runId / stepId / actor
- entity type / entity id
- operation kind
- base revision / resulting revision
- changed field names
- safe before / after summary
- idempotency key / effect id
- success / conflict / failed reason

不得記錄完整 prompt、模型私密 reasoning、token 級 CoT。

## 紅線

- 冪等：reorder 傳完整 `orderedSceneIds`；update 使用明確 patch + baseRevision。
- 不繞過 ACL／封存／額度／approval。
- conflict 一律 fail-closed，不 silent last-write-wins。
- remove / overwrite 等破壞動作 target 不明確時必須追問。
- retry 不重複 side effect / 扣點。
- 不記錄 CoT。

## Failure cases 必測

- scene 在 approval 後、execution 前被其他人修改
- scene 被 archive / delete
- 權限在 execution 前撤銷
- quota 在 execution 前不足
- duplicate retry
- runner restart 在 write 前 / write 後 / event 前
- 兩 replica 同時 claim
- reorder list 少一個 id / 多一個 id / duplicate id
- update trim invalid
- event write 暫時失敗

## Rollout / compatibility

- step kind schema 擴充必須 additive；舊 run 含未知新 kind 時舊 runner fail-closed，不當成成功。
- 新 runner 仍能讀舊 plan。
- 新 kind 建議 feature flag / capability registry gate；planner 只有在 runner capability 已開啟時才可產生。
- rollback binary 前若已有新 kind pending run，需明確策略：停止 / 暫停並提示升級，不可讓舊 runner亂跑。

## 驗收標準

- [ ] 新 kind 可被規劃、核准、執行、事件記錄。
- [ ] planner 不會在 capability off 時產生新 kind。
- [ ] revision mismatch 回 structured conflict，且不覆蓋真人新修改。
- [ ] 同一 idempotency key retry 不重複 side effect / 扣點。
- [ ] before / after audit 足以解釋變更。
- [ ] runner restart / 雙 replica 不造成 duplicate write。
- [ ] ACL / archive / quota / approval 在 execution time 重新驗證。
- [ ] 失敗與停止符合 fail-closed。
- [ ] old plan fixture / unknown kind compatibility test 通過。
- [ ] 真 PG race / rollback / idempotency tests 通過。
- [ ] typecheck / test / e2e-agent / build 通過。

## 建議 PR 標題

```text
feat(agent): add revision-safe reorder and scene update step kinds
```
