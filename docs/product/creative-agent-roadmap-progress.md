# Creative Agent Evolution — Progress Tracker

| 欄位 | 值 |
|------|-----|
| **roadmapId** | CA-ROADMAP-2026-07 |
| **設計文件** | [`creative-agent-evolution-roadmap.md`](./creative-agent-evolution-roadmap.md) |
| **研究簡報** | [`docs/research/creative-agent-2026-07/`](../research/creative-agent-2026-07/) |
| **updatedAt** | 2026-07-30 |
| **狀態** | CA-01 實作中（`feat/ca-01-agent-generate-parity`：generate 對齊 characters／presets／source／needs） |

## Glossary

```text
CA-* = 創作代理能力路線圖 PR（本文件）
WB-* = AI 創作工作台 UX PR（docs/product/ai-creation-workbench-integration-pr-proposal.md）
CreationDraft 模組所有權 = CA-02（WB-01 必須 import，禁止分叉）
```

## 全域約束（不可違反）

- **禁止** 引入 LangGraph / CrewAI / Temporal / OpenAI Agents SDK 作為 runtime 依賴
- 媒體生成寫入**只能**走 `executeGenerationCommand` → `submitGenerationCore`（TD-02）
- Continuity snapshot **嚴禁**寫入 `generations.params`（那是 fal provider input）
- 同一 Claude Code / agent session：**一條實作分支**；純文件 PR（CA-00／CA-09）可並行
- Checklist 項**禁止刪除**；只允許 `passes: false` → `true`（合併後）

## Claude Code 下一動作

1. 讀本檔 + 設計文件 PR Plan 對應章節  
2. 選第一個 `passes: false` 且依賴已合入預設分支的 PR  
3. 自預設分支（`claude/healing-migration-ai-os-erewp2` 或之後的 `main`）開 suggested branch  
4. 依 Implementation steps 實作 → Suggested test commands 全綠 → 開 PR → 更新本檔 notes  
5. **勿**在同一 session 開下一個依賴未合入的實作 PR  

建議全域回歸：

```bash
npm run audit:high && npm run typecheck && npm test && npm run test:client:coverage && npm run build
scripts/ci-migration-test.sh   # 有 migration 時
scripts/e2e-agent.py
```

## PR Checklist

### CA-00 — Docs landing + progress tracker

| 欄位 | 值 |
|------|-----|
| **passes** | false |
| **est_sessions** | 0.5 |
| **branch** | `docs/creative-agent-evolution-roadmap` |
| **merged_sha** | |
| **dependencies** | 無 |
| **notes** | 本 PR：路線圖 + 研究簡報 + progress 入庫 |

### CA-01 — Agent generate parity (characters / presets / source / needs)

| 欄位 | 值 |
|------|-----|
| **passes** | false |
| **est_sessions** | 2 |
| **branch** | `feat/ca-01-agent-generate-parity` |
| **merged_sha** | |
| **dependencies** | CA-00 |
| **notes** | 實作對齊 #208 設計稿：plan/AgentStep 四欄、PlannerAliases char/preset/asset、`resolveGenerateModel`（禁 needs 靜默降級）、runner 閘門 B+透傳、`assertGenerationEntityIds`、cheatsheet 含 needs；單元測綠。職能概念見 #204。 |

### CA-02 — CreationDraft module (WB-01 must import)

| 欄位 | 值 |
|------|-----|
| **passes** | false |
| **est_sessions** | 1 |
| **branch** | `feat/ca-02-creation-draft-contract` |
| **merged_sha** | |
| **dependencies** | CA-00 |
| **notes** | 可與 CA-01 / CA-03 平行（不同工作樹）；單一 draft 所有權 |

### CA-03 — Extend ProjectAgentInsights (not parallel feed)

| 欄位 | 值 |
|------|-----|
| **passes** | false |
| **est_sessions** | 1–2 |
| **branch** | `feat/ca-03-unified-insights-feed` |
| **merged_sha** | |
| **dependencies** | CA-00 |
| **notes** | kind=ai\|human；source=generation\|workflow\|…；同 PR 改 AgentCard 標籤 |

### CA-04a — Continuity snapshot column + draft bible write

| 欄位 | 值 |
|------|-----|
| **passes** | false |
| **est_sessions** | 1–2 |
| **branch** | `feat/ca-04a-continuity-snapshot` |
| **merged_sha** | |
| **dependencies** | CA-01（建議） |
| **notes** | migration: generations.continuity_snapshot jsonb；禁寫 params |

### CA-04b — Optional true bible version table + stale UI

| 欄位 | 值 |
|------|-----|
| **passes** | false |
| **est_sessions** | 2+ |
| **branch** | `feat/ca-04b-bible-versions` |
| **merged_sha** | |
| **dependencies** | CA-04a |
| **notes** | 可滯後 |

### CA-05a — Execute notify + checkpoint

| 欄位 | 值 |
|------|-----|
| **passes** | false |
| **est_sessions** | 2 |
| **branch** | `feat/ca-05a-notify-checkpoint` |
| **merged_sha** | |
| **dependencies** | CA-00 |
| **notes** | 實作前重讀 docs/AI代理架構與維運.md 新增步驟檢查表；pg 測試 |

### CA-05b — onFailure policy

| 欄位 | 值 |
|------|-----|
| **passes** | false |
| **est_sessions** | 1–2 |
| **branch** | `feat/ca-05b-on-failure` |
| **merged_sha** | |
| **dependencies** | CA-05a |
| **notes** | |

### CA-06 — Thin intent router

| 欄位 | 值 |
|------|-----|
| **passes** | false |
| **est_sessions** | 1 |
| **branch** | `feat/ca-06-intent-router` |
| **merged_sha** | |
| **dependencies** | CA-02（建議 draft 已存在） |
| **notes** | 預設規則、可關閉 |

### CA-07 — Unified tool catalog

| 欄位 | 值 |
|------|-----|
| **passes** | false |
| **est_sessions** | 1 |
| **branch** | `feat/ca-07-tool-catalog` |
| **merged_sha** | |
| **dependencies** | CA-00 |
| **notes** | 描述層；執行仍進既有 core |

### CA-08 — VLM quality gate (flag off)

| 欄位 | 值 |
|------|-----|
| **passes** | false |
| **est_sessions** | 2 |
| **branch** | `feat/ca-08-vlm-quality-gate` |
| **merged_sha** | |
| **dependencies** | CA-01、CA-05a |
| **notes** | 滯後；預設 off；reroll cap |

### CA-09 — Ops canary + SLO docs

| 欄位 | 值 |
|------|-----|
| **passes** | false |
| **est_sessions** | 0.5–1 |
| **branch** | `docs/ca-09-agent-ops-canary` |
| **merged_sha** | |
| **dependencies** | CA-00 |
| **notes** | 可隨時；純文件為主 |

### CA-10 — Mid-run replan API (optional)

| 欄位 | 值 |
|------|-----|
| **passes** | false |
| **est_sessions** | 2 |
| **branch** | `feat/ca-10-mid-run-replan` |
| **merged_sha** | |
| **dependencies** | CA-05b |
| **notes** | 新 generationId only；避免雙重扣點 |

## 建議執行順序

```text
CA-00 → CA-01（最高價值）→ CA-03 ∥ CA-02 → CA-04a → CA-05a → CA-05b
      → CA-06 → CA-07 → CA-08（滯後）→ CA-09（隨時）→ CA-10
```

JSON 鏡像：同目錄 `creative-agent-roadmap-progress.json`。
