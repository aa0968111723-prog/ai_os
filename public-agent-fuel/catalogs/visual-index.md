# 視覺化代理素材索引（大量）

本目錄搭配 `prompts/visual-boards*.jsonl`。
代理可用每條 `prompt` 直接 text-to-image 產出看板；完成後將 URL 登錄系統層公共庫（勿寫入使用者專案配額）。

## Batch 1 — 基礎看板（20）
風格聖經、角色6/8宮格、場景公式、鏡頭、色票光影、Hook-Body-CTA、QC清單、道具、表情、轉場、六格分鏡、Do/Dont、比例、工作流、身份鎖、地圖元素、風雨希望、群像站位、留白焦點

## Batch 2 — 情境與角色（20）
隊長/導航/活寶/智者/照護、夜營、晨登、雨中扶持、街頭音樂、淨灘、祕寶、日曆、擊掌、背影、圍圈、錯誤案例、提示詞分層、MCP地圖、安全禁忌、代理工作台

## 產出規範
- 風格：手繪插畫 溫暖活潑簡約
- 比例：預設 16:9（另有比例板可衍生 9:16 / 1:1）
- 標籤：清楚、可給代理 OCR/描述使用
- 禁止：寫實血腥、醫療宣稱、侵權商業角色複製

## 建議終端機批量
```bash
# 讀 jsonl → 呼叫系統生圖 API → 上傳至 site-scoped asset store
npx tsx scripts/import-public-agent-fuel.ts --apply-visuals
```
