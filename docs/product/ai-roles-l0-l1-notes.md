# AI 職能 L0＋L1 實作備註

| 欄位 | 值 |
|------|-----|
| **Related** | `docs/product/ai-project-roles-concept.md`（#204） |
| **Scope** | L0 敘事文案 + L1 playbook catalog（仍一筆 `agent_run`） |
| **Date** | 2026-07-30 |

## 做了什麼

### L0 — 敘事

- `client/src/components/AgentCard.tsx`：標題／空態／示例目標改為「AI 職能」口吻（分鏡助理、生成員、配音統籌…）。
- 可收合 **AI 職能** 面板：從 `shared/aiProjectRoles` 列出席位；標示「不是專案成員」；可一鍵帶入 `defaultGoalHint`。
- **未** 在 memberships 新增假 user。

### L1 — Playbook = 職能

| 檔案 | 用途 |
|------|------|
| `shared/aiProjectRoles.ts` | 六職能目錄 + `listAiProjectRoles` / `getAiProjectRole` / `formatRoleRosterForPrompt` |
| `shared/rolePlaybooks.ts` | 版本化模板 + `getPlaybook` / `listPlaybooks` / `buildPlannerRoleBlock` |
| `server/services/agentCore.ts` | `planAgentCore` prompt 注入 `buildPlannerRoleBlock()` |
| `server/routers/agents.ts` | 唯讀 `listRoles`（roles + playbooks 摘要） |

執行路徑不變：plan → approve → runner；媒體仍只經 `executeGenerationCommand`。

## 刻意不做

- LangGraph／CrewAI／Temporal multi-agent
- DB migration、席位設定（L2）
- 改 generation 扣點路徑
- 自動執行 playbook（僅規劃提示骨架）

## 如何驗證

```bash
npx vitest run shared/aiProjectRoles.test.ts shared/rolePlaybooks.test.ts
# 或
npm test -- shared/aiProjectRoles shared/rolePlaybooks
```

手動：開專案 → AI 助手卡 → 展開「AI 職能」→ 帶入目標 → 規劃（mock／正式皆可）；確認計畫仍 `awaiting_approval`。

## 後續（L2+）

- 專案啟用哪些職能、每職能週點 cap
- 一鍵「本週短片 → 分鏡助理」
- UI 預設收合、手機減負
