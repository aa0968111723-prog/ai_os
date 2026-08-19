# AIOS ↔ CUTOS 原生雙向整合

此文件是 `aa0968111723-prog/ai_os` 與 `aa0968111723-prog/CUTOS` 的跨 repo contract。

目標不是用 UI automation 操作 CUTOS，而是讓 AIOS Agent Runner、Tool Registry、MCP/外部工具層與 CUTOS 的 Agent Runtime / Edit DSL / Timeline / Preview / Render 透過正式、可驗證、可恢復的協定互相呼叫。

## 雙 repo 分工

### AIOS：Control Plane

AIOS 負責：

- 使用者 / 專案權限
- Agent plan / DAG / 長任務執行
- Tool registry 與 confirmation policy
- Memory / context / project intelligence
- 模型路由與資源選擇
- Run ledger / progress / recovery
- 對 CUTOS 的能力發現與調度

### CUTOS：Editing Data Plane

CUTOS 負責：

- Media / Project canonical state
- Transcript / semantic video intelligence
- Edit DSL validation
- Timeline revision / undo / redo
- Instant Preview
- FFmpeg render / export
- 剪輯 domain 的 idempotency、revision guard 與 approval boundary

AIOS 不直接修改 CUTOS Timeline，也不得自行拼 FFmpeg shell command 取代 CUTOS renderer。

## Protocol

CUTOS 提供：

- `GET /api/aios/manifest`
- `POST /api/aios/invoke`
- `GET /api/aios/health`

AIOS 端由：

- `shared/cutosProtocol.ts`
- `server/services/cutosClient.ts`

持有 canonical client-side contract。

後續實作應將 protocol 升級到 `cutos.agent.v2`，並支援：

- `requestId`
- `idempotencyKey`
- `expectedRevision`
- `projectId`
- `runId`
- `jobId`
- `timelineRevision`
- structured error code
- capability permission/risk metadata
- asynchronous job/run polling or event stream

## AIOS Tool Registry

不得把 CUTOS 寫成一個巨大 `cutos.invoke(anything)` unrestricted tool。

應將 CUTOS manifest 正規化後註冊為有型別的 AIOS tools，例如：

### Read tools

- `cutos.project.get`
- `cutos.transcript.search`
- `cutos.semantic.search`
- `cutos.topics.list`
- `cutos.highlights.find`
- `cutos.preview.inspect`
- `cutos.job.get`
- `cutos.run.get`

### Write tools

- `cutos.analysis.start`
- `cutos.plan.create`
- `cutos.plan.preview`
- `cutos.plan.reject_operation`
- `cutos.plan.apply`
- `cutos.timeline.undo`
- `cutos.timeline.redo`
- `cutos.export.start`

所有 write tools 必須使用 AIOS `ToolRegistry` 的：

- access
- risk
- confirmation
- idempotency
- retry
- verify
- evidence

規則，不得繞過既有 autonomy guardrails。

## Agent Runner integration

CUTOS 不應只作為 chat provider。

AIOS Agent Runner 應支援一個 replayable external-tool step contract，讓 planning DAG 可以出現：

```text
ensure_transcript
  ↓
search_semantic
  ↓
find_highlights
  ↓
create_edit_plan
  ↓
verify_edit_plan
  ↓
request_approval
  ↓
apply_edit_plan
  ↓
export
```

每個 step 必須保存：

- AIOS agentRunId
- AIOS stepId
- CUTOS projectId
- CUTOS runId / jobId
- requestId
- idempotencyKey
- expectedTimelineRevision
- resultingTimelineRevision
- status
- evidence / verification result

重播或 runner restart 時，不得重複 apply 已完成的 Timeline mutation。

## Project mapping

AIOS project 與 CUTOS project 不假設 UUID 相同。

建立 durable mapping：

```text
AIOS projectId
↔ CUTOS projectId
```

mapping 必須 project/group scoped，並通過現有 `authFor(context)` 權限守門。

不可讓 Agent 傳 arbitrary CUTOS projectId 後跨專案讀取。

## Context / Memory

CUTOS transcript、Timeline、media metadata 的 canonical 內容留在 CUTOS。

AIOS memory 可保存：

- 剪輯偏好
- 使用者曾接受/拒絕的 edit decision
- project creative intent
- style / delivery preference
- CUTOS entity references
- verified summaries

AIOS memory 不應複製整份 60 分鐘逐字稿或 Timeline 作為第二真實來源。

長影片 context：

```text
user intent
→ CUTOS semantic retrieval
→ bounded context envelope
→ AIOS planner
```

## Cross-repo contract tests

兩邊都要有 contract fixtures。

至少驗證：

1. AIOS 讀 CUTOS manifest。
2. capability schema 可被 AIOS parser 接受。
3. read tool 呼叫成功。
4. write tool 帶 `idempotencyKey`。
5. stale `expectedRevision` 被拒絕。
6. retry 不重複 apply。
7. CUTOS job/run 可被 AIOS runner 恢復追蹤。
8. CUTOS unavailable 時 AIOS run 進入 retryable / waiting，而不是假成功。
9. unauthorized project mapping 被拒絕。
10. AIOS runner restart 後可從已保存的 CUTOS runId/jobId 繼續。

## Environment

AIOS 端：

```text
CUTOS_URL=http://localhost:3000
CUTOS_API_KEY=...
CUTOS_TIMEOUT_MS=15000
```

CUTOS 端仍保留既有 AIOS kernel/provider 設定。

正式環境禁止把 token 寫入 client bundle、log 或 project content。

## Definition of Done

這個 companion PR 完成時：

- AIOS 有 typed CUTOS client。
- CUTOS protocol schema 在 AIOS 端有 runtime validation。
- CUTOS capabilities 可進 AIOS ToolRegistry。
- CUTOS write operations 使用 AIOS confirmation/idempotency/retry/verify guardrails。
- Agent Runner 能執行並恢復 CUTOS long-running steps。
- AIOS project ↔ CUTOS project mapping durable 且受 ACL 保護。
- runId/jobId/timelineRevision 可跨 repo correlation。
- MCP / remote-agent layer 可選擇性暴露經過治理的 CUTOS tools。
- 兩 repo contract tests 同時通過。
- CUTOS 掛掉、timeout、stale revision、duplicate request 都有真實測試。
- UI 若顯示整合狀態，一律使用繁體中文。

## Companion PR

CUTOS 對應工作位於 `aa0968111723-prog/CUTOS` 的 PR #9：`AIOS-native orchestration + multi-agent video editing control plane`。
