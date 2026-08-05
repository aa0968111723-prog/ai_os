# fal-ai/bria/expand

> 審計：R · index **#52** · static+research · 2026-08-05（升 thin→九章）  
> needs=**image** · points=**1** · **未**改 verified／points

## 1. 身分
| index | **52** | id | `fal-ai/bria/expand` | endpoint | `fal-ai/bria/expand` |
| label | Bria Expand(生成式擴圖) | cat/tier | image-to-image/economy |
| verified | True | needs | image | points | **1** |
| cost | `$0.023/次` | strengths | 往畫面外補內容轉比例;授權安全的 outpainting | bestFor | 直式照擴 16:9 上 YouTube、老照片補天補地 |

## 2. 數值
points=**1** · **維持**

## 3. 連通
站內: `input: (p, f, s) => ({ image_url: s, prompt: p, canvas_size: f === "9:16" ? [1080, 1920] : f === "1:1" ? [1440, 1440] : [1920, 1080] }),` · L2 未跑 · **ready-static-only**

## 4–8
圖生圖 · reserveQuota(1) · https://fal.ai/models/fal-ai/bria/expand

## 9. 建議
- [x] 九章升 · [x] 維持 points/verified
**裁決：維持**
