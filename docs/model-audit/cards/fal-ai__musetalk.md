# fal-ai/musetalk

> 審計：主代理 · index **#171** · static+research · 2026-08-05  
> slug：`fal-ai__musetalk`

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 171 |
| **id** | `fal-ai/musetalk` |
| **label** | MuseTalk 對嘴(保守型) |
| **category / tier / kind** | video-to-video · budget · video |
| **verified** | false |
| **needs** | video |
| **points** | 5 |
| **cost** | ≈$0.10–0.20/次(推估) |
| **strengths** | 只改嘴部區域、不重繪全臉;失真風險低 |
| **bestFor** | 師父影像不能失真的保守對嘴 |

## 2. 數值

points=**5**；cost=`≈$0.10–0.20/次(推估)`；USD×31 粗核；本輪不改 points。

## 3. 連通與生成

- L0：⚠input→fixed
- L1：📄OpenAPI200
- L2：未跑(needs×2)
- required source_video_url+audio_url

## 4. 底層

見 fal 模型頁與 strengths。站內 input 僅送 MODELS.input() 欄位。

## 5. 站內點數路徑

reserveQuota／estimatePoints；needs 有值則禁空 probe。

## 6. 暴露面

創作台／分鏡／agent／MCP 依 category 可見。

## 7. 情境

bestFor／strengths 本輪維持。

## 8. 文件

https://fal.ai/models/fal-ai/musetalk

## 9. 建議動作

已修 source_video_url
**P0：** video_url→source_video_url
