# fal-ai/fast-sdxl/image-to-image

> 審計：R · index **#39** · static+research · 2026-08-05（升 thin→九章）  
> needs=**image** · points=**1** · **未**改 verified／points

## 1. 身分
| index | **39** | id | `fal-ai/fast-sdxl/image-to-image` | endpoint | `fal-ai/fast-sdxl/image-to-image` |
| label | SDXL 圖生圖 | cat/tier | image-to-image/budget |
| verified | False | needs | image | points | **1** |
| cost | `≈$0.001/張` | strengths | 最低成本的圖生圖 | bestFor | 試驗風格方向 |

## 2. 數值
points=**1** · **維持**

## 3. 連通
站內: `input: (p, _f, s) => ({ prompt: p, image_url: s, strength: 0.75 }),` · L2 未跑 · **ready-static-only**

## 4–8
圖生圖 · reserveQuota(1) · https://fal.ai/models/fal-ai/fast-sdxl/image-to-image

## 9. 建議
- [x] 九章升 · [x] 維持 points/verified
**裁決：維持**
