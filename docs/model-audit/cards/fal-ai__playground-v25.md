# fal-ai/playground-v25

> 審計：主代理 · index **#25** · static+research · 2026-08-05  
> slug：`fal-ai__playground-v25`

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 25 |
| **id** | `fal-ai/playground-v25` |
| **label** | Playground v2.5 |
| **category / tier** | text-to-image · budget |
| **verified** | false |
| **needs** | 無 |
| **points** | 1 |
| **cost** | 約 $0.002–0.006/張 |
| **strengths** | 開源美學標竿;色彩與構圖討喜、成本極低 |
| **bestFor** | 美感取向的氛圍圖、療癒風底圖 |

## 2. 數值

目錄 points=**1**；cost=`約 $0.002–0.006/張`；USD×31 粗核見 cost；本輪不改 points。

## 3. 連通與生成

- OpenAPI 本輪 curl：**200**（見主代理 batch probe 2026-08-05）
- 站內 input：`input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),`
- OpenAPI 200；steps default 25；budget live OK。
- L2：歷史 budget 成功

## 4. 底層

見 fal 模型頁與 strengths；站內只送 input() 欄位，其餘官方 default。

## 5. 站內點數路徑

reserveQuota／estimatePoints；needs=無。

## 6. 暴露面

MODELS 可選即創作台／agent／MCP 可見（受 category 過濾）。

## 7. 情境

bestFor／strengths 與定位是否合理：本輪維持，矛盾則 B9 調文案。

## 8. 文件

https://fal.ai/models/fal-ai/playground-v25

## 9. 建議動作

**維持**為主；契約已修者見上。verified 僅 L2 或充分證據後人工改。
