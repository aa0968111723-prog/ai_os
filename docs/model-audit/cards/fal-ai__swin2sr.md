# fal-ai/swin2sr

> 審計：主代理 · index **#70** · static+research · 2026-08-05  
> slug：`fal-ai__swin2sr`

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 70 |
| **id** | `fal-ai/swin2sr` |
| **label** | Swin2SR 去壓縮放大 |
| **category / tier / kind** | image-to-image · budget · image |
| **verified** | true |
| **needs** | image |
| **points** | 1 |
| **cost** | $0.025/MP |
| **strengths** | Transformer 忠實放大;擅長去除 JPEG 壓縮假影 |
| **bestFor** | 被通訊軟體多次轉傳壓爛的低清舊圖救援 |

## 2. 數值

points=**1**；cost=`$0.025/MP`；USD×31 粗核；本輪不改 points。

## 3. 連通與生成

- L0：ok
- L1：📄OpenAPI200
- L2：未跑(needs)
- required image_url；task classical_sr

## 4. 底層

見 fal 模型頁與 strengths。站內 input 僅送 MODELS.input() 欄位。

## 5. 站內點數路徑

reserveQuota／estimatePoints；needs 有值則禁空 probe。

## 6. 暴露面

創作台／分鏡／agent／MCP 依 category 可見。

## 7. 情境

bestFor／strengths 本輪維持。

## 8. 文件

https://fal.ai/models/fal-ai/swin2sr

## 9. 建議動作

維持
