# fal-ai/flux-2/pro/edit

> 審計：R · index **#32** · static+research · 2026-08-05（升 thin→九章）  
> needs=**image** · points=**1** · **未**改 verified／points

## 1. 身分
| index | **32** | id | `fal-ai/flux-2/pro/edit` | endpoint | `fal-ai/flux-2/pro/edit` |
| label | FLUX.2 [pro] Edit | cat/tier | image-to-image/flagship |
| verified | True | needs | image | points | **1** |
| cost | `$0.03/首MP,之後 $0.015/MP` |
| strengths | 生產級編輯;最多 9 張參考圖、構圖一致性佳 |
| bestFor | 正式成品的精修、系列圖風格統一 |

## 2. 數值
points=**1** · cost=`$0.03/首MP,之後 $0.015/MP` · **維持**

## 3. 連通
- 前序 thin / OpenAPI 見 bulk
- 站內: `input: (p, _f, s) => ({ prompt: p, image_urls: [s] }),`
- L2: 未跑（needs 或無 KEY 政策）
- 結論: **ready-static-only**（本輪未重拉 OpenAPI 者待核）

## 4. 底層邏輯
圖生圖／編輯 · 來源圖 + prompt

## 5–8
reserveQuota(1) · fal https://fal.ai/models/fal-ai/flux-2/pro/edit

## 9. 建議
- [x] 九章升 · [x] 維持 points/verified · [ ] 有 KEY 時可 OpenAPI 深核
**裁決：維持**
