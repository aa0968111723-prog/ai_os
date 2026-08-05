# 模型契約（contracts）

> 由 `npx tsx scripts/sync-model-contracts.ts` 自動維護。  
> **單一機器可讀真相**：模型指南、MCP、生成系統都讀 `current.json`。

## 檔案

| 檔 | 用途 |
|----|------|
| `current.json` | 最新完整契約（266 列 + capabilities + health） |
| `snapshot.json` | 上次已確認基準（diff 用） |
| `changelog.md` | 人類可讀變動史 |

## 何時跑

1. 改了 `shared/models.ts`（點數、needs、endpoint、verified）
2. 跑完零成本 OpenAPI / live 審計想回寫健康狀態
3. CI 或排程（建議每日 --openapi 一次，有 FAL_KEY）

```bash
npx tsx scripts/sync-model-contracts.ts
FAL_KEY=… npx tsx scripts/sync-model-contracts.ts --openapi
```

## 消費端

- **MCP** `find_model` / `get_model_contract`：回 health、capabilities
- **generationCore**：openapi_404 / live_fail 軟警告
- **gen-model-docs**：目錄附健康摘要
- **工作台**：capabilities 與站內 supportsNegativePrompt／分詞器同源

## 不會做的事

- 不自動把 `verified` 改 true
- 不自動 `--yes` 燒點 live
- 不猜測未知 OpenAPI 欄位
