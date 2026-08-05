# fal-ai/krea-2-trainer

> 審計：R5 · index **#256** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__krea-2-trainer` · needs=**zip** · points=**93** · 禁經濟 live  
> **未**改 verified／points。

## 1. 身分
| index | **256** | id | `fal-ai/krea-2-trainer` | label | Krea 2 訓練器 |
| cat/tier | training/economy | verified | False | needs | zip |
| points | **93** | cost | `$0.003/步(最低 100 步;千步≈$3)` |
| strengths | 新一代 Krea 2 底模 LoRA;美感系升級版 |
| bestFor | 療癒風主力底模升級後的風格 LoRA |

## 2. 數值
points=**93** · **維持**

## 3. 連通
- bulk required: `['images_data_url']`
- 站內: `input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),`
- training probe: ok（本輪 P）
- L2: 未跑


## 4–8
訓練 zip→LoRA · fal https://fal.ai/models/fal-ai/krea-2-trainer · reserveQuota(93)

## 9. 建議
- [x] 九章升 · [ ] 核 image(s)_data_url · [x] 維持 points/verified
**裁決：維持**
