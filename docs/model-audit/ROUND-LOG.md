# 大輪日誌

## #1 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R1 | fal-ai/flux-2/pro → 維持 |
| R2 | fal-ai/bria/product-shot → 維持（needs=image） |
| R3 | fal-ai/minimax/hailuo-2.3/pro/text-to-video → 維持；aspect_ratio 死欄 P2 |
| R4 | fal-ai/rife/video → 維持（needs=video） |
| R5 | fal-ai/dia-tts → 維持；英文主場 |
| P | text-to-image 30 端點：21 ok、0 404、9 cancel_unconfirmed |
| L | fal-ai/flux/schnell live OK · 估1點 · spentTwd=1 |
| J | 跳過 |

broken 新增：無 404  
下一輪：R 各 #2,#55,#108,#161,#214；P image-to-image；L 下一個 recommended 經濟檔

## #2 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #2 `fal-ai/qwen-image-2/pro/text-to-image` → 維持（ready-static-only；OpenAPI 綠；points=2 校準≈；negative/seed allowlist 已收） |
| P | 跳過無 KEY（下一 cat 應為 image-to-image） |
| L | 跳過無 KEY（spentTwd=1；鎖空閒） |
| J | 跳過 |

broken 新增：無  
下一輪：R 各 #3,#55,#108,#161,#214；P image-to-image（需 FAL_KEY）；L 下一個 !needs 待 live（需 FAL_KEY）

## #2 | 階段:研究實測（進行中）

| 角色 | 結果 |
|------|------|
| R1–R5 | 並行 #2,#55,#108,#161,#214 |
| P | image-to-image 66 端點：52 ok、0 404 |
| L | fal-ai/sana live OK · spentTwd=2 |
| J | 跳過 |

下一輪：R 各下一 id；P text-to-video；L 下一個 recommended 經濟檔

## #3 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #56 `fal-ai/image-editing/photo-restoration` → 維持（ready-static-only；OpenAPI 綠；needs=image；免 prompt；points=1≈） |
| P | 跳過無 KEY（下一 cat 應為 text-to-video） |
| L | 跳過無 KEY（spentTwd=2；鎖空閒；needs 模不進 probe） |
| J | 跳過 |

broken 新增：無  
下一輪：R 各 #3,#57,#109,#162,#215；P text-to-video（需 FAL_KEY）；L 下一個 !needs 待 live（需 FAL_KEY）

## #2 | 階段:研究實測（完成）

| 角色 | 結果 |
|------|------|
| R1 | fal-ai/qwen-image-2/pro/text-to-image → 維持 |
| R2 | fal-ai/codeformer → 維持 |
| R3 | fal-ai/luma-dream-machine/ray-2 → 維持；P2 1:1 aspect |
| R4 | fal-ai/sync-lipsync/v3 → **建議調 points**（$8/分→約248） |
| R5 | fal-ai/chatterbox/text-to-speech → 維持 |
| P | image-to-image 52/66 ok · 0 404 |
| L | fal-ai/sana live OK · spentTwd=2 |
| broken | seedream/v5 text-to-image OpenAPI **404** P0 |

下一輪：R 各下一 id；P text-to-video；L flux/dev 或 kolors

## #3 | 階段:研究實測（進行中）

| 角色 | 結果 |
|------|------|
| R1–R5 | #3 gpt-image-2 / #56 photo-restoration / #109 seedance / #162 lipsync v2 / #215 kokoro |
| P | text-to-video 24/32 ok · 0 404 |
| L | fal-ai/flux/dev live OK · spentTwd=3 |
| broken | seedream/v5 404 P0；lipsync v3 建議調點 155→248 |

## #4 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #109 `fal-ai/bytedance/seedance/v1/pro/text-to-video` → 維持（OpenAPI 綠；L1 歷史✅；預設1080p5s points=19≈；aspect 含1:1） |
| P | 跳過無 KEY（下一 cat 應為 text-to-video 或已跑則下一類） |
| L | 跳過無 KEY（spentTwd=3；鎖空閒；本模 19 點不宜本輪硬 live） |
| J | 跳過 |

broken 新增：無  
下一輪：R 各 #3/4,#57,#110,#163,#216；P 下一 category（需 FAL_KEY）；L 經濟 !needs（需 FAL_KEY）

## #5 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #57 `fal-ai/image-apps-v2/photo-restoration` → 維持（OpenAPI 綠；needs=image；verified 維持 false；價 $0.04 推定待對帳） |
| P | 跳過無 KEY |
| L | 跳過無 KEY（needs 不可 probe；spentTwd=3） |
| J | 跳過 |

broken 新增：無  
下一輪：R 各 #4,#58,#110,#163,#216；P 下一 cat（需 FAL_KEY）；L 經濟 !needs（需 FAL_KEY）


## #3 | 階段:研究實測（完成）

| R | 結果 |
|---|------|
| R1 | openai/gpt-image-2 維持 |
| R2 | photo-restoration 維持 |
| R3 | seedance v1 pro t2v 維持 |
| R4 | sync-lipsync/v2 維持（93點對齊） |
| R5 | kokoro/mandarin-chinese 維持 |
| P | t2v 24/32 ok |
| L | flux/dev + kolors live · spentTwd=4 |

## #6 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #110 `fal-ai/bytedance/seedance/v1.5/pro/text-to-video` → 維持（OpenAPI 綠；預設720p5s含音 points=8≈；較1.0多 generate_audio） |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=4；鎖空閒） |
| J | 跳過 |

broken 新增：無  
下一輪：R 各 #4,#58,#111,#163,#216；P 下一 cat（需 FAL_KEY）；L 經濟 !needs（需 FAL_KEY）

## #7 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #163 `decart/lucy-restyle` → 維持（OpenAPI 綠；needs=video；verified=false；P0 扁平19點 vs 依時長計費） |
| P | 跳過無 KEY |
| L | 跳過無 KEY（needs=video 不可 probe；spentTwd=4） |
| J | 跳過 |

broken 新增：無（計費契約風險已註 P0）  
下一輪：R 各 #5,#58,#111,#164,#216；P 下一 cat（需 FAL_KEY）；L 經濟 !needs（需 FAL_KEY）

## #12 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #5 `fal-ai/nano-banana-2` → 維持（OpenAPI **200**；points=3 中價≈；aspect_ratio 契約綠；verified 既有 true；hist live OK） |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=7；鎖空閒；本模曾 live 3 點） |
| J | 跳過 |

broken 新增：無  
下一輪：R 各 #6,#59,#112,#165,#218；P 下一 cat（需 FAL_KEY）；L 經濟 !needs（需 FAL_KEY）

## #111 | 階段:研究實測 | R3 | 2026-08-05

| 角色 | 結果 |
|------|------|
| R3 | #111 `bytedance/seedance-2.0/text-to-video` → **維持**（OpenAPI **200**；points=47≈5s@720p；**P0** duration 預設 auto 扁平估點風險；cost「6 秒基準」文案債；含音免費；id 無 fal-ai/；零 live／禁止 --yes） |
| P | 跳過無 KEY |
| L | 跳過無 KEY（47 點不宜硬 live） |
| J | 跳過 |

broken 新增：無（估點契約風險已註 P0）  
card：`docs/model-audit/cards/bytedance__seedance-2.0__text-to-video.md`

## R5 unit | #218 index-tts-2/text-to-speech | 2026-08-05

| 角色 | 結果 |
|------|------|
| R5 | `fal-ai/index-tts-2/text-to-speech` → **已修 input**（OpenAPI required=`prompt`+`audio_url`；加 `needs: audio`）＋**維持** points=1／$0.002/秒／verified=false；ready-static-only；零 live；長旁白扁平估點與時長 API 未接為 P2 |

broken 新增：無（契約已修，非 dead endpoint）  
下一輪：R5 下一 id（#219 起，號段 213–266）

## R4 unit | #165 fal-ai/ben/v2/video | 2026-08-05

| 角色 | 結果 |
|------|------|
| R4 | `fal-ai/ben/v2/video` → **維持**（5≈6s720p30 實價；預設 mp4 無 alpha；文案勿寫全場最便宜／比 Bria 省；ready-static-only；零 live） |

broken 新增：無  
下一輪：R4 下一 id（#166 起，號段 160–212）

