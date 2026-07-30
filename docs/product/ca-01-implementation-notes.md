# CA-01 Implementation Notes

| 欄位 | 值 |
|------|-----|
| **Branch** | `feat/ca-01-agent-generate-parity` |
| **Design** | [`ca-01-agent-generate-parity-design.md`](./ca-01-agent-generate-parity-design.md)（#208） |
| **Roles concept** | [`ai-project-roles-concept.md`](./ai-project-roles-concept.md)（#204；CA-01 是職能 L1 技術前提） |

## 定錨

- 代理 `generate` 與手動生成**同火力**（定裝／場景／來源／needs 模型）
- **扣點只走** `executeGenerationCommand` → `reserveQuota`
- 外鍵 **fail-closed**，且在扣點之前：`assertGenerationEntityIds` → 估點 → `reserveQuota` → Fal

## 落地對照（#208）

| 設計項 | 實作 |
|--------|------|
| plan 四欄 | `shared/plan.ts` |
| draft refs + `resolveGenerateModel` | `agentPlanning.ts` |
| PlannerAliases + context | `agentCore.ts` `buildPlannerContext` |
| 閘門 B + Command 透傳 | `agentRunner.ts` |
| KD-12 entity ACL | `generationCore.ts` `assertGenerationEntityIds` |
| needs 進 cheatsheet | `aiModelPolicy.ts` `buildAiModelCheatsheet` |

## 測試

```bash
npm test -- agentPlanning agentRunner agentCore generationCore planTypes aiModelPolicy
npm run typecheck
```

## 非目標（本 PR）

notify／checkpoint、continuity_snapshot、CreationDraft、VLM、假 AI 成員帳號。
