# fal-ai/luma-photon

> 審計：主代理 · index **#26** · static+research · 2026-08-05  
> slug：`fal-ai__luma-photon`

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 26 |
| **id** | `fal-ai/luma-photon` |
| **label** | Luma Photon |
| **category / tier / kind** | text-to-image · economy · image |
| **verified** | true |
| **needs** | 無 |
| **points** | 1 |
| **cost** | $0.019/MP(標準;Flash 版 $0.005/MP 更省) |
| **strengths** | Luma 視覺模型;創意、可個人化、理解力強 |
| **bestFor** | 創意概念圖、風格化敘事主視覺 |

## 2. 數值

points=**1**；cost=`$0.019/MP(標準;Flash 版 $0.005/MP 更省)`；USD×31 粗核；本輪不改 points。

## 3. 連通與生成

- L0：ok
- L1：📄OpenAPI200
- L2：未跑
- OpenAPI 僅 prompt+aspect_ratio；站內 aspect✓

## 4. 底層

見 fal 模型頁與 strengths。站內 input 僅送 MODELS.input() 欄位。

## 5. 站內點數路徑

reserveQuota／estimatePoints；needs 有值則禁空 probe。

## 6. 暴露面

創作台／分鏡／agent／MCP 依 category 可見。

## 7. 情境

bestFor／strengths 本輪維持。

## 8. 文件

https://fal.ai/models/fal-ai/luma-photon

## 9. 建議動作

維持；aspect_ratio 非 image_size
