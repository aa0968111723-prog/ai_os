# 266 模型深度審計 — 進度索引

> 更新：2026-08-05（終端批次 L0／L2／L1 乾跑）  
> 計畫：[`docs/product/model-deep-audit-266-plan.md`](../product/model-deep-audit-266-plan.md)  
> 單一真相：`shared/models.ts` → `MODELS`（266）

## 分層狀態

| 層 | 內容 | 指令 | 狀態 | 產出 |
|----|------|------|------|------|
| **L0** | 靜態契約 | `npx tsx scripts/verify-models.ts` | ✅ 完成 | [`docs/模型清查清單.md`](../模型清查清單.md) — 266 模型、**132** 未驗證（可探測 46、需站內素材 86） |
| **L1** | 端點連通（空 `{}`） | `FAL_KEY=… npx tsx scripts/probe-fal-endpoints.ts --yes` | ⏳ 乾跑完成；**需 FAL_KEY 才能實測** | [`docs/fal端點連通報告.md`](../fal端點連通報告.md)（目前為計畫版） |
| **L2** | 點數校準 | `npx tsx scripts/audit-model-pricing.ts` | ✅ 完成 | [`docs/點數校準報告.md`](../點數校準報告.md) — **偏差 0**、需人工 84 |
| **L3** | input／generation 契約抽樣 | 人工 + 單模 `--probe` | 未開 | — |
| **L4** | LLM-as-Judge 黃金題組 | 見 [`llm-as-judge-model-audit-plan.md`](../product/llm-as-judge-model-audit-plan.md) | 文件已合 #421 | 結果寫入本目錄（不自動改 verified） |

## 金錢鐵律（不變）

1. 批次連通只送空輸入 `{}`（422＝連通未生成）。  
2. 真實生成僅 `verify-models.ts --probe "<id>" --yes`，一次一個。  
3. 無 `--yes` 不送請求。  
4. `verified: true` 只由人工改。

## 下一步（終端）

```bash
# 有 FAL_KEY 時：
FAL_KEY=… npx tsx scripts/probe-fal-endpoints.ts --yes
# 可選分批：
FAL_KEY=… npx tsx scripts/probe-fal-endpoints.ts --yes --only text-to-image
# 單模 live（會扣點，先估再 --yes）：
npx tsx scripts/verify-models.ts --probe "fal-ai/flux/schnell"
npx tsx scripts/verify-models.ts --probe "fal-ai/flux/schnell" --yes
```

## 本輪附帶修復

- `server/services/runnerMetrics.test.ts`：改為斷言 gate 形狀，避免 CI／sandbox 因 load／freemem 抖動而紅燈（#411 引入）。
