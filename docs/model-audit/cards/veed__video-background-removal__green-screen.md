# veed/video-background-removal/green-screen

> 審計：R · index **#175** · static+research · 2026-08-05（升 thin→九章）  
> cat=**video-to-video** · needs=**video** · points=**5** · **未**改 verified／points

## 1. 身分
| index | **175** | id | `veed/video-background-removal/green-screen` | label | VEED 綠幕摳像 |
| cat/tier | video-to-video/economy | verified | False | needs | video |
| points | **5** | cost | `$0.025/30幀;按秒計費,點數為 6 秒基準` |
| strengths | 真綠幕專用:chroma key+自動去綠色溢光 | bestFor | 有架綠幕拍攝的素材,比通用去背乾淨 |

## 2. 數值
points=**5** · **維持**

## 3. 連通
站內: `input: (_p, _f, s) => ({ video_url: s }),` · L2 未跑 · **ready-static-only**

## 4–8
video-to-video · reserveQuota(5) · https://fal.ai/models/veed/video-background-removal/green-screen

## 9. 建議
- [x] 九章升 · [x] 維持 points/verified
**裁決：維持**
