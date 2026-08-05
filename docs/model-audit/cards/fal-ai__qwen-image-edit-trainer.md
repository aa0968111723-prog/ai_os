# fal-ai/qwen-image-edit-trainer

> 審計：R5 · index **#259** · static+research · 2026-08-05（升 thin stub→九章）  
> needs=**zip** · points=**124** · 禁經濟 live · **未**改 verified／points

## 1. 身分
| index | **259** | id | `fal-ai/qwen-image-edit-trainer` | label | Qwen 編輯訓練器(中文) |
| cat/tier | training/economy | verified | False | needs | zip |
| points | **124** | cost | `$4/千步(最低 100 步=$0.4)` |
| strengths | 訓練 Qwen 編輯 LoRA;中文語境的固定修圖行為 | bestFor | 照片→本會風格成品的中文系修圖模型 |

## 2. 數值
points=**124** · **維持**

## 3. 連通
- bulk required: `['image_data_url']`
- 站內: `input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "EDIT" }),`
- training probe: ok · L2 未跑
**P0** bulk `image_data_url` vs 站內 `images_data_url`

## 4–8
訓練 zip→LoRA · https://fal.ai/models/fal-ai/qwen-image-edit-trainer

## 9. 建議
- [x] 九章升 · [ ] 核欄名 · [x] 維持 points/verified
**裁決：維持**
