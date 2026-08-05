# fal-ai/hunyuan-video-lora-training

> 審計：R5 · index **#265** · static+research · 2026-08-05（升 thin stub→九章）  
> needs=**zip** · points=**155** · 禁經濟 live · **未**改 verified／points

## 1. 身分
| index | **265** | id | `fal-ai/hunyuan-video-lora-training` | label | 混元影片 LoRA 訓練 |
| cat/tier | training/economy | verified | False | needs | zip |
| points | **155** | cost | `$5/次(1000 步基準,隨步數線性)` |
| strengths | 最少 4 張圖教會影片模型一個人物/物件;自動生成描述 | bestFor | 門檻最低的影片人物 LoRA 驗證 |

## 2. 數值
points=**155** · **維持**

## 3. 連通
- bulk required: `['images_data_url', 'steps']`
- 站內: `input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "CHAR" }),`
- training probe: ok · L2 未跑


## 4–8
訓練 zip→LoRA · https://fal.ai/models/fal-ai/hunyuan-video-lora-training

## 9. 建議
- [x] 九章升 · [ ] 核欄名 · [x] 維持 points/verified
**裁決：維持**
