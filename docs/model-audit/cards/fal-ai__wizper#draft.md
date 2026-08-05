# fal-ai/wizper#draft

> 審計 bulk-all · #203 · 2026-08-05 · 禁止 --yes

## 1. 身分
| index | 203 | id | `fal-ai/wizper#draft` | endpoint | `fal-ai/wizper` |
| label | Wizper 快速草稿 | cat/tier/kind | speech-to-text/budget/text |
| verified | true | needs | audio | points | 1 |
| cost | ≈$0.0008/運算秒(推定,官方未單列) |
| strengths | 最快最省的初稿 |
| bestFor | 先看內容再決定精修 |

## 2. 數值
points=**1** · cost=`≈$0.0008/運算秒(推定,官方未單列)` · 本輪不改 points

## 3. 連通
- OpenAPI / 狀態：**200** (endpoint_id=`fal-ai/wizper`)
- required: ['audio_url']
- props: ['task', 'version', 'audio_url', 'max_segment_len', 'merge_chunks', 'language', 'chunk_level']
- L2: 未跑(needs)

## 4–8
文件 https://fal.ai/models/fal-ai/wizper · reserveQuota · 暴露依 category

## 9. 建議
**維持**；verified 待證據
