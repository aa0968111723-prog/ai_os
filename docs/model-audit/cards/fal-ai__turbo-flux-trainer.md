# fal-ai/turbo-flux-trainer

> 審計：R5 · index **#253** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__turbo-flux-trainer` · needs=**zip** · points=**80** · 禁經濟 live  
> **未**改 verified／points。

## 1. 身分
| index | **253** | id | `fal-ai/turbo-flux-trainer` | label | Turbo FLUX 訓練器 |
| cat/tier | training/economy | verified | True | needs | zip |
| points | **80** | cost | `$2.4/千步` |
| strengths | 訓練速度快、費用可控 |
| bestFor | 快速迭代風格試驗 |

## 2. 數值
points=**80** · **維持**

## 3. 連通
- bulk required: `[]`
- 站內: `input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),`
- training probe: ok（本輪 P）
- L2: 未跑


## 4–8
訓練 zip→LoRA · fal https://fal.ai/models/fal-ai/turbo-flux-trainer · reserveQuota(80)

## 9. 建議
- [x] 九章升 · [ ] 核 image(s)_data_url · [x] 維持 points/verified
**裁決：維持**
