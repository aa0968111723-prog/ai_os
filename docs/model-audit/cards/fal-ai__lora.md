# fal-ai/lora

> 審計：R · index **#30** · static+research · 2026-08-05（升 thin→九章）  
> needs=**zip** · points=**1** · **未**改 verified／points

## 1. 身分
| index | **30** | id | `fal-ai/lora` | label | SDXL 掛社群 LoRA |
| cat/tier | text-to-image/budget | verified | False | points | **1** |
| cost | `按算力秒計(未查到明細)` | strengths | 掛任意社群 SDXL/SD1.5 LoRA;零訓練成本試風格的後門 | bestFor | 試水墨/佛畫/蓮花裝飾等現成風格(品質低於 FLUX 系) |

## 2. 數值
points=**1** · **維持**

## 3. 連通
站內: `input: (p, f, s) => ({ model_name: "stabilityai/stable-diffusion-xl-base-1.0", prompt: p, image_size: imageSize(f), loras: [{ path: s, scale: 1 }] }),` · L2 未跑 · **ready-static-only**

## 4–8
文生圖 · reserveQuota(1) · https://fal.ai/models/fal-ai/lora

## 9. 建議
- [x] 九章升 · [x] 維持 points/verified
**裁決：維持**
