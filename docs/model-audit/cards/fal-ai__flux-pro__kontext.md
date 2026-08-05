# fal-ai/flux-pro/kontext

> 審計：R · index **#35** · static+research · 2026-08-05（升 thin→九章）  
> needs=**image** · points=**1** · **未**改 verified／points

## 1. 身分
| index | **35** | id | `fal-ai/flux-pro/kontext` | endpoint | `fal-ai/flux-pro/kontext` |
| label | FLUX.1 Kontext [pro] | cat/tier | image-to-image/economy |
| verified | True | needs | image | points | **1** |
| cost | `$0.04/張` |
| strengths | 局部編輯與整景轉換兼顧;角色一致性迭代編輯 |
| bestFor | 同角色連續分鏡、逐步修圖 |

## 2. 數值
points=**1** · cost=`$0.04/張` · **維持**

## 3. 連通
- 前序 thin / OpenAPI 見 bulk
- 站內: `input: (p, _f, s) => ({ prompt: p, image_url: s }),`
- L2: 未跑（needs 或無 KEY 政策）
- 結論: **ready-static-only**（本輪未重拉 OpenAPI 者待核）

## 4. 底層邏輯
圖生圖／編輯 · 來源圖 + prompt

## 5–8
reserveQuota(1) · fal https://fal.ai/models/fal-ai/flux-pro/kontext

## 9. 建議
- [x] 九章升 · [x] 維持 points/verified · [ ] 有 KEY 時可 OpenAPI 深核
**裁決：維持**
