# fal-ai/flux-2-klein-9b-base-trainer

> 審計：R5 · index **#257** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__flux-2-klein-9b-base-trainer` · needs=**zip** · points=**133** · 禁經濟 live  
> **未**改 verified／points。

## 1. 身分
| index | **257** | id | `fal-ai/flux-2-klein-9b-base-trainer` | label | FLUX.2 klein 9B 訓練器 |
| cat/tier | training/economy | verified | False | needs | zip |
| points | **133** | cost | `$0.0043/步(千步≈$4.3)` |
| strengths | FLUX.2 小型化底模 LoRA;訓練與生成都更便宜快速 |
| bestFor | 金句卡日更等高頻量產線的風格 LoRA |

## 2. 數值
points=**133** · **維持**

## 3. 連通
- bulk required: `[]`
- 站內: `input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),`
- training probe: ok（本輪 P）
- L2: 未跑


## 4–8
訓練 zip→LoRA · fal https://fal.ai/models/fal-ai/flux-2-klein-9b-base-trainer · reserveQuota(133)

## 9. 建議
- [x] 九章升 · [ ] 核 image(s)_data_url · [x] 維持 points/verified
**裁決：維持**
