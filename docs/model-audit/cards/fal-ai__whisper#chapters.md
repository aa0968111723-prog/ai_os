# fal-ai/whisper#chapters

> 審計 bulk-all · #201 · 2026-08-05 · 禁止 --yes

## 1. 身分
| index | 201 | id | `fal-ai/whisper#chapters` | endpoint | `fal-ai/whisper` |
| label | Whisper 長檔分段 | cat/tier/kind | speech-to-text/economy/text |
| verified | true | needs | audio | points | 2 |
| cost | 同 Whisper |
| strengths | 長錄音自動分段落(word 級時間戳) |
| bestFor | 一小時以上開示的結構化整理 |

## 2. 數值
points=**2** · cost=`同 Whisper` · 本輪不改 points

## 3. 連通
- OpenAPI / 狀態：**200** (endpoint_id=`fal-ai/whisper`)
- required: ['audio_url']
- props: ['num_speakers', 'language', 'prompt', 'task', 'diarize', 'chunk_level', 'audio_url', 'batch_size']
- L2: 未跑(needs)

## 4–8
文件 https://fal.ai/models/fal-ai/whisper · reserveQuota · 暴露依 category

## 9. 建議
**維持**；verified 待證據
