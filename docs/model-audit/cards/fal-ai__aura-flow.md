# fal-ai/aura-flow

> 審計：主代理 · index **#27** · static+research · 2026-08-05  
> slug：`fal-ai__aura-flow`

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 27 |
| **id** | `fal-ai/aura-flow` |
| **label** | AuraFlow v0.3 |
| **category / tier / kind** | text-to-image · budget · image |
| **verified** | false |
| **needs** | 無 |
| **points** | 1 |
| **cost** | $0.028/MP(每張約 1MP=$0.028) |
| **strengths** | 開源 flow 架構;語義精準但較慢(50 步) |
| **bestFor** | 研究性/開源偏好的出圖,優先度低 |

## 2. 數值

points=**1**；cost=`$0.028/MP(每張約 1MP=$0.028)`；USD×31 粗核；本輪不改 points。

## 3. 連通與生成

- L0：⚠input→fixed
- L1：📄OpenAPI200
- L2：未跑(歷史timeout?)
- OpenAPI 無 image_size；steps default 50 慢

## 4. 底層

見 fal 模型頁與 strengths。站內 input 僅送 MODELS.input() 欄位。

## 5. 站內點數路徑

reserveQuota／estimatePoints；needs 有值則禁空 probe。

## 6. 暴露面

創作台／分鏡／agent／MCP 依 category 可見。

## 7. 情境

bestFor／strengths 本輪維持。

## 8. 文件

https://fal.ai/models/fal-ai/aura-flow

## 9. 建議動作

已去 image_size；維持 points=1
**P0：** 已修只送 prompt

## L2 live（2026-08-05）

| 項 | 值 |
|----|-----|
| 指令 | `verify-models --probe fal-ai/aura-flow --yes` |
| 輸入 | 「一盞溫暖的燈,極簡水彩」 |
| requestId | `019fd06e-1bb1-71d1-b09f-29027e1c85f2` |
| 結果 | **success** · 1024×1024 png |
| artifact | https://v3b.fal.media/files/b/0aa5147c/H2ObCPe8jInMs8v6WWm9m.png |
| seed | 2125371491 |
| pointsEst | 1 · budget 已入帳 |
| verified | **維持 false**（禁止自動改 true） |
