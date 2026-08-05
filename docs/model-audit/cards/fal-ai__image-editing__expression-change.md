# fal-ai/image-editing/expression-change

> 審計：R · index **#91** · static+research · 2026-08-05（升 thin→九章）  
> needs=**image** · points=**1** · **未**改 verified／points

## 1. 身分
| index | **91** | id | `fal-ai/image-editing/expression-change` | endpoint | `fal-ai/image-editing/expression-change` |
| label | 表情微調(Expression Change) | cat/tier | image-to-image/budget |
| verified | False | needs | image | points | **1** |
| cost | `$0.04/張` | strengths | 微調照片人物表情(眨眼、微笑、視線) | bestFor | 人物照表情太嚴肅/閉眼,不重拍直接調 |

## 2. 數值
points=**1** · **維持**

## 3. 連通
站內: `input: (p, _f, s) => ({ image_url: s, prompt: p.trim() || "gentle smile" }),` · L2 未跑 · **ready-static-only**

## 4–8
圖生圖 · reserveQuota(1) · https://fal.ai/models/fal-ai/image-editing/expression-change

## 9. 建議
- [x] 九章升 · [x] 維持 points/verified
**裁決：維持**
