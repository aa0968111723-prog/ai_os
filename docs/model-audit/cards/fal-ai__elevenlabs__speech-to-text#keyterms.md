# fal-ai/elevenlabs/speech-to-text#keyterms

> 審計 bulk-all · #202 · 2026-08-05 · 禁止 --yes

## 1. 身分
| index | 202 | id | `fal-ai/elevenlabs/speech-to-text#keyterms` | endpoint | `fal-ai/elevenlabs/speech-to-text/scribe-v2` |
| label | Scribe 關鍵詞強化 | cat/tier/kind | speech-to-text/economy/text |
| verified | false | needs | audio | points | 2 |
| cost | $0.008/分(≈$0.48/小時) |
| strengths | 提示專有名詞(佛學術語)提升辨識 |
| bestFor | 術語密集的開示(提示詞欄填術語、逗號分隔) |

## 2. 數值
points=**2** · cost=`$0.008/分(≈$0.48/小時)` · 本輪不改 points

## 3. 連通
- OpenAPI / 狀態：**200** (endpoint_id=`fal-ai/elevenlabs/speech-to-text/scribe-v2`)
- required: ['audio_url']
- props: ['audio_url', 'language_code', 'diarize', 'tag_audio_events', 'keyterms']
- L2: 未跑(needs)

## 4–8
文件 https://fal.ai/models/fal-ai/elevenlabs/speech-to-text/scribe-v2 · reserveQuota · 暴露依 category

## 9. 建議
**維持**；verified 待證據
