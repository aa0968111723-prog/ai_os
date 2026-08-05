# fal-ai/qwen-image-edit

> 審計：R · index **#36** · static+research · 2026-08-05（升 thin→九章）  
> needs=**image** · points=**1** · **未**改 verified／points

## 1. 身分
| index | **36** | id | `fal-ai/qwen-image-edit` | endpoint | `fal-ai/qwen-image-edit` |
| label | Qwen Image Edit | cat/tier | image-to-image/economy |
| verified | True | needs | image | points | **1** |
| cost | `≈$0.03/張(按百萬像素計費 $0.03/MP,基準1MP)` |
| strengths | 阿里通義;複雜中文文字渲染與精準編輯 |
| bestFor | 中文標題卡修字、低成本批量修改 |

## 2. 數值
points=**1** · cost=`≈$0.03/張(按百萬像素計費 $0.03/MP,基準1MP)` · **維持**

## 3. 連通
- 前序 thin / OpenAPI 見 bulk
- 站內: `input: (p, _f, s) => ({ prompt: p, image_url: s }),`
- L2: 未跑（needs 或無 KEY 政策）
- 結論: **ready-static-only**（本輪未重拉 OpenAPI 者待核）

## 4. 底層邏輯
圖生圖／編輯 · 來源圖 + prompt

## 5–8
reserveQuota(1) · fal https://fal.ai/models/fal-ai/qwen-image-edit

## 9. 建議
- [x] 九章升 · [x] 維持 points/verified · [ ] 有 KEY 時可 OpenAPI 深核
**裁決：維持**
