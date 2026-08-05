# fal-ai/whisper

> 審計：R · index **#198** · static+research · 2026-08-05（升 thin→九章）  
> cat=**speech-to-text** · needs=**audio** · points=**2** · **未**改 verified／points

## 1. 身分
| index | **198** | id | `fal-ai/whisper` | label | Whisper large-v3 |
| cat/tier | speech-to-text/flagship | verified | True | needs | audio |
| points | **2** | cost | `≈$0.0008/運算秒(非音訊長度);長錄音實際費用依運算時間,高於扣點` |
| strengths | OpenAI 開源標竿;含時間戳、可分講者 | bestFor | 帶時間軸的字幕稿 |

## 2. 數值
points=**2** · **維持**

## 3. 連通
站內: `input: (_p, _f, s) => ({ audio_url: s, task: "transcribe", language: "zh", chunk_level: "segment" }),` · L2 未跑 · **ready-static-only**

## 4–8
speech-to-text · reserveQuota(2) · https://fal.ai/models/fal-ai/whisper

## 9. 建議
- [x] 九章升 · [x] 維持 points/verified
**裁決：維持**
