# fal-ai/wan-22-trainer/t2v-a14b

> 審計：R5 · index **#262** · static+research · 2026-08-05（升 thin stub→九章）  
> needs=**zip** · points=**124** · 禁經濟 live · **未**改 verified／points

## 1. 身分
| index | **262** | id | `fal-ai/wan-22-trainer/t2v-a14b` | label | Wan 2.2 文生影訓練器 |
| cat/tier | training/flagship | verified | False | needs | zip |
| points | **124** | cost | `$0.004/步(千步≈$4)` |
| strengths | 影片模型 LoRA(文生影);角色/風格一致影片終極解 | bestFor | 吉祥物、本會影像質感練進影片模型 |

## 2. 數值
points=**124** · **維持**

## 3. 連通
- bulk required: `[]`
- 站內: `input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),`
- training probe: ok · L2 未跑


## 4–8
訓練 zip→LoRA · https://fal.ai/models/fal-ai/wan-22-trainer/t2v-a14b

## 9. 建議
- [x] 九章升 · [ ] 核欄名 · [x] 維持 points/verified
**裁決：維持**
