# 視覺看板批量生成說明（代理專用）

當圖像服務可用時，對 `visual-boards.jsonl` 與 `visual-boards-batch2.jsonl` 逐條：

1. 讀取 `prompt` 欄位
2. 使用系統預設：手繪插畫、溫暖活潑簡約、16:9
3. 成品命名：`範例_Agent視覺_{title}`
4. **寫入系統／全站素材庫**，不要寫入一般使用者專案配額

## 建議模型
- 草稿：`fal-ai/flux/schnell`
- 定稿：`fal-ai/flux/dev`
- 含文字海報：`fal-ai/ideogram/v3`

## 數量目標
- Batch1：約 30 張核心看板
- Batch2：約 15 張補充
- 可再組合角色×表情×場景產生數百張變體

## CLI 概念

```bash
npx tsx scripts/import-public-agent-fuel.ts --apply
# 未來可加：
# npx tsx scripts/generate-public-visuals.ts --from prompts/visual-boards.jsonl
```
