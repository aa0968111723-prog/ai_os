# fal-ai/mix-dehaze-net

> 審計：R · index **#73** · static+research · 2026-08-05（升 thin→九章）  
> needs=**image** · points=**1** · **未**改 verified／points

## 1. 身分
| index | **73** | id | `fal-ai/mix-dehaze-net` | endpoint | `fal-ai/mix-dehaze-net` |
| label | Mix-Dehaze 去霧 | cat/tier | image-to-image/budget |
| verified | True | needs | image | points | **1** |
| cost | `$0.025/MP` | strengths | 去霧/去朦朧;提升發灰、低對比舊掃描的通透度 | bestFor | 修復管線前處理:先去霧再放大修復 |

## 2. 數值
points=**1** · **維持**

## 3. 連通
站內: `input: (_p, _f, s) => ({ image_url: s }),` · L2 未跑 · **ready-static-only**

## 4–8
圖生圖 · reserveQuota(1) · https://fal.ai/models/fal-ai/mix-dehaze-net

## 9. 建議
- [x] 九章升 · [x] 維持 points/verified
**裁決：維持**
