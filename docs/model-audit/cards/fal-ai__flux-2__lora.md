# fal-ai/flux-2/lora

> 審計：R · index **#29** · static+research · 2026-08-05（升 thin→九章）  
> needs=**zip** · points=**1** · **未**改 verified／points

## 1. 身分
| index | **29** | id | `fal-ai/flux-2/lora` | label | FLUX.2 掛 LoRA 生圖 |
| cat/tier | text-to-image/economy | verified | True | points | **1** |
| cost | `$0.021/MP(LoRA 逾 2GB 有 50%/GB 加價)` | strengths | FLUX.2 訓練成果的生成端點;可同時疊多顆 LoRA | bestFor | 旗艦品質+自家風格的日常出圖(提示詞含觸發詞) |

## 2. 數值
points=**1** · **維持**

## 3. 連通
站內: `input: (p, f, s) => ({ prompt: p, image_size: imageSize(f), loras: [{ path: s, scale: 1 }] }),` · L2 未跑 · **ready-static-only**

## 4–8
文生圖 · reserveQuota(1) · https://fal.ai/models/fal-ai/flux-2/lora

## 9. 建議
- [x] 九章升 · [x] 維持 points/verified
**裁決：維持**
