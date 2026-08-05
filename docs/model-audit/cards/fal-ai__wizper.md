# fal-ai/wizper

> 審計：R · index **#199** · static+research · 2026-08-05（升 thin→九章）  
> cat=**speech-to-text** · needs=**audio** · points=**1** · **未**改 verified／points

## 1. 身分
| index | **199** | id | `fal-ai/wizper` | label | Wizper(加速 v3) |
| cat/tier | speech-to-text/flagship | verified | True | needs | audio |
| points | **1** | cost | `≈$0.0008/運算秒(推定,官方未單列);長錄音實際費用遠高於扣點,長稿建議改用 Scribe` |
| strengths | fal 自家加速版 Whisper v3;同級品質、數倍速度 | bestFor | 長錄音快速出稿 |

## 2. 數值
points=**1** · **維持**

## 3. 連通
站內: `input: (_p, _f, s) => ({ audio_url: s, task: "transcribe", language: "zh" }),` · L2 未跑 · **ready-static-only**

## 4–8
speech-to-text · reserveQuota(1) · https://fal.ai/models/fal-ai/wizper

## 9. 建議
- [x] 九章升 · [x] 維持 points/verified
**裁決：維持**
