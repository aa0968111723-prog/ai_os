# fal-ai/ltx2-video-trainer

> 審計：R5 · index **#266** · static+research · 2026-08-05（升 thin stub→九章）  
> needs=**zip** · points=**298** · 禁經濟 live · **未**改 verified／points

## 1. 身分
| index | **266** | id | `fal-ai/ltx2-video-trainer` | label | LTX-2 影片訓練器 |
| cat/tier | training/flagship | verified | False | needs | zip |
| points | **298** | cost | `$0.0048/步(預設 2000 步≈$9.6)` |
| strengths | LTX-2 影片 LoRA;長片自動按場景切成訓練樣本 | bestFor | 用歷年活動影音資產練出本會影像風 |

## 2. 數值
points=**298** · **維持**

## 3. 連通
- bulk required: `['training_data_url']`
- 站內: `input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),`
- training probe: ok · L2 未跑


## 4–8
訓練 zip→LoRA · https://fal.ai/models/fal-ai/ltx2-video-trainer

## 9. 建議
- [x] 九章升 · [ ] 核欄名 · [x] 維持 points/verified
**裁決：維持**
