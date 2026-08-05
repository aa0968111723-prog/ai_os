# fal-ai/wan-22-image-trainer

> 審計：R5 · index **#261** · static+research · 2026-08-05（升 thin stub→九章）  
> needs=**zip** · points=**140** · 禁經濟 live · **未**改 verified／points

## 1. 身分
| index | **261** | id | `fal-ai/wan-22-image-trainer` | label | Wan 2.2 圖像訓練器 |
| cat/tier | training/economy | verified | False | needs | zip |
| points | **140** | cost | `$0.0045/步(千步≈$4.5)` |
| strengths | Wan 2.2 文生圖 LoRA;圖影同底模、風格可通用 | bestFor | 「圖卡+影片」系列視覺完全統一 |

## 2. 數值
points=**140** · **維持**

## 3. 連通
- bulk required: `['training_data_url', 'trigger_phrase']`
- 站內: `input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),`
- training probe: ok · L2 未跑


## 4–8
訓練 zip→LoRA · https://fal.ai/models/fal-ai/wan-22-image-trainer

## 9. 建議
- [x] 九章升 · [ ] 核欄名 · [x] 維持 points/verified
**裁決：維持**
