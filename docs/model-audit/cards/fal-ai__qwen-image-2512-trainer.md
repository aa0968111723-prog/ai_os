# fal-ai/qwen-image-2512-trainer

> 審計：R5 · index **#258** · static+research · 2026-08-05（升 thin stub→九章）  
> needs=**zip** · points=**47** · 禁經濟 live · **未**改 verified／points

## 1. 身分
| index | **258** | id | `fal-ai/qwen-image-2512-trainer` | label | Qwen 2512 訓練器(中文) |
| cat/tier | training/budget | verified | False | needs | zip |
| points | **47** | cost | `$0.0015/步(千步≈$1.5;V2 版 $0.95/千步)` |
| strengths | 新版 Qwen 底模 LoRA;全站最便宜正式風格訓練之一 | bestFor | 季度視覺主題 LoRA;中文字最強路線 |

## 2. 數值
points=**47** · **維持**

## 3. 連通
- bulk required: `['image_data_url']`
- 站內: `input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),`
- training probe: ok · L2 未跑
**P0** bulk `image_data_url` vs 站內 `images_data_url`

## 4–8
訓練 zip→LoRA · https://fal.ai/models/fal-ai/qwen-image-2512-trainer

## 9. 建議
- [x] 九章升 · [ ] 核欄名 · [x] 維持 points/verified
**裁決：維持**
