# fal-ai/nano-banana-pro

> 審計：主代理 · index **#19** · static+research · 2026-08-05  
> slug：`fal-ai__nano-banana-pro`

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 19 |
| **id** | `fal-ai/nano-banana-pro` |
| **label** | Nano Banana Pro(Google) |
| **category / tier / kind** | text-to-image · flagship · image |
| **verified** | true |
| **needs** | 無 |
| **points** | 5 |
| **cost** | $0.15/張(4K 加倍) |
| **strengths** | Gemini 3 Pro Image;高階推理、細節與指令遵循更強、可 4K |
| **bestFor** | 最考驗理解力的敘事主視覺、4K 正式成品 |

## 2. 數值

points=**5**；cost=`$0.15/張(4K 加倍)`；USD×31 粗核；本輪不改 points。

## 3. 連通與生成

- L0：ok
- L1：📄OpenAPI200
- L2：未跑
- required prompt；aspect_ratio+resolution 1K/2K/4K；站內 aspect(f)✓

## 4. 底層

見 fal 模型頁與 strengths。站內 input 僅送 MODELS.input() 欄位。

## 5. 站內點數路徑

reserveQuota／estimatePoints；needs 有值則禁空 probe。

## 6. 暴露面

創作台／分鏡／agent／MCP 依 category 可見。

## 7. 情境

bestFor／strengths 本輪維持。

## 8. 文件

https://fal.ai/models/fal-ai/nano-banana-pro

## 9. 建議動作

維持；aspect_ratio✓；4K cost 加倍注意
