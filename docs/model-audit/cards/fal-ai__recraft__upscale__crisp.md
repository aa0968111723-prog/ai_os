# fal-ai/recraft/upscale/crisp

> 審計：主代理 · index **#68** · static+research · 2026-08-05  
> slug：`fal-ai__recraft__upscale__crisp`

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 68 |
| **id** | `fal-ai/recraft/upscale/crisp` |
| **label** | Recraft 清晰化放大 |
| **category / tier / kind** | image-to-image · budget · image |
| **verified** | true |
| **needs** | image |
| **points** | 1 |
| **cost** | $0.004/張 |
| **strengths** | 非生成清晰化;邊緣乾淨臉更利,近乎免費 |
| **bestFor** | 交付前最後銳化;中文字卡安全 |

## 2. 數值

points=**1**；cost=`$0.004/張`；USD×31 粗核；本輪不改 points。

## 3. 連通與生成

- L0：ok
- L1：📄OpenAPI200
- L2：未跑(needs)
- required image_url only

## 4. 底層

見 fal 模型頁與 strengths。站內 input 僅送 MODELS.input() 欄位。

## 5. 站內點數路徑

reserveQuota／estimatePoints；needs 有值則禁空 probe。

## 6. 暴露面

創作台／分鏡／agent／MCP 依 category 可見。

## 7. 情境

bestFor／strengths 本輪維持。

## 8. 文件

https://fal.ai/models/fal-ai/recraft/upscale/crisp

## 9. 建議動作

維持
