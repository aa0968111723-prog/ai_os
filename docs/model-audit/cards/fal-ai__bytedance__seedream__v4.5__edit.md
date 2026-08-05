# fal-ai/bytedance/seedream/v4.5/edit

> 審計：R · index **#33** · static+research · 2026-08-05（升 thin→九章）  
> needs=**image** · points=**1** · **未**改 verified／points

## 1. 身分
| index | **33** | id | `fal-ai/bytedance/seedream/v4.5/edit` | endpoint | `fal-ai/bytedance/seedream/v4.5/edit` |
| label | Seedream 4.5 Edit | cat/tier | image-to-image/flagship |
| verified | True | needs | image | points | **1** |
| cost | `$0.04/張` |
| strengths | 生成+編輯一體架構;中文指令理解佳 |
| bestFor | 中文指令修改、文字元素調整 |

## 2. 數值
points=**1** · cost=`$0.04/張` · **維持**

## 3. 連通
- 前序 thin / OpenAPI 見 bulk
- 站內: `input: (p, _f, s) => ({ prompt: p, image_urls: [s] }),`
- L2: 未跑（needs 或無 KEY 政策）
- 結論: **ready-static-only**（本輪未重拉 OpenAPI 者待核）

## 4. 底層邏輯
圖生圖／編輯 · 來源圖 + prompt

## 5–8
reserveQuota(1) · fal https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/edit

## 9. 建議
- [x] 九章升 · [x] 維持 points/verified · [ ] 有 KEY 時可 OpenAPI 深核
**裁決：維持**
