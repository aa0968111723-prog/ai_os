# fal-ai/imageutils/rembg

> 審計：R · index **#78** · static+research · 2026-08-05（升 thin→九章）  
> needs=**image** · points=**1** · **未**改 verified／points

## 1. 身分
| index | **78** | id | `fal-ai/imageutils/rembg` | endpoint | `fal-ai/imageutils/rembg` |
| label | rembg 去背(陽春) | cat/tier | image-to-image/budget |
| verified | False | needs | image | points | **1** |
| cost | `按算秒計費(每張遠低於 $0.01)` | strengths | 經典 u2net 去背;幾乎免費 | bestFor | 單一主體、背景乾淨的簡單場景 |

## 2. 數值
points=**1** · **維持**

## 3. 連通
站內: `input: (_p, _f, s) => ({ image_url: s }),` · L2 未跑 · **ready-static-only**

## 4–8
圖生圖 · reserveQuota(1) · https://fal.ai/models/fal-ai/imageutils/rembg

## 9. 建議
- [x] 九章升 · [x] 維持 points/verified
**裁決：維持**
