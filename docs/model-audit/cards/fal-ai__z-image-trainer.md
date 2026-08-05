# fal-ai/z-image-trainer

> 審計：R5 · index **#260** · static+research · 2026-08-05（升 thin stub→九章）  
> needs=**zip** · points=**70** · 禁經濟 live · **未**改 verified／points

## 1. 身分
| index | **260** | id | `fal-ai/z-image-trainer` | label | Z-Image 訓練器(試水溫) |
| cat/tier | training/budget | verified | False | needs | zip |
| points | **70** | cost | `$2.26/千步(最低 100 步=$0.226)` |
| strengths | 通義 Z-Image Turbo 上訓練;最低 100 步約 7 點 | bestFor | 先驗證素材包能否練出風格再上正式訓練 |

## 2. 數值
points=**70** · **維持**

## 3. 連通
- bulk required: `['image_data_url']`
- 站內: `input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),`
- training probe: ok · L2 未跑
**P0** bulk `image_data_url` vs 站內 `images_data_url`

## 4–8
訓練 zip→LoRA · https://fal.ai/models/fal-ai/z-image-trainer

## 9. 建議
- [x] 九章升 · [ ] 核欄名 · [x] 維持 points/verified
**裁決：維持**
