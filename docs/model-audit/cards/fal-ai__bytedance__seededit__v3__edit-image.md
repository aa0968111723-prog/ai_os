# fal-ai/bytedance/seededit/v3/edit-image

> 審計：R · index **#44** · static+research · 2026-08-05（升 thin→九章）  
> needs=**image** · points=**1** · **未**改 verified／points

## 1. 身分
| index | **44** | id | `fal-ai/bytedance/seededit/v3/edit-image` | endpoint | `fal-ai/bytedance/seededit/v3/edit-image` |
| label | SeedEdit 3.0(字節) | cat/tier | image-to-image/economy |
| verified | False | needs | image | points | **1** |
| cost | `約 $0.03/張` | strengths | 純指令式單圖編輯;保真度高、對原圖改動最小,支援中文指令 | bestFor | 只動一處、其餘像素級不變的精準小修 |

## 2. 數值
points=**1** · **維持**

## 3. 連通
站內: `input: (p, _f, s) => ({ prompt: p, image_url: s }),` · L2 未跑 · **ready-static-only**

## 4–8
圖生圖 · reserveQuota(1) · https://fal.ai/models/fal-ai/bytedance/seededit/v3/edit-image

## 9. 建議
- [x] 九章升 · [x] 維持 points/verified
**裁決：維持**
