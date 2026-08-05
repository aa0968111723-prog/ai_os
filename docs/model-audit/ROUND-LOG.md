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


## #13 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #216 `fal-ai/minimax/speech-2.6-hd` → **已修 input** `text`→`prompt`+`output_format:url`（OpenAPI required=prompt；default hex 會壞 extract）；points=3 維持；verified=false |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=4；鎖空閒） |
| J | 跳過 |

broken 新增：無（input 422 已修）  
下一輪：R 各 #6,#60,#112,#166,#217；P 下一 cat（需 FAL_KEY）；L 經濟 !needs（需 FAL_KEY）

## R5 unit | #219 minimax/voice-clone | 2026-08-05

| 角色 | 結果 |
|------|------|
| R5 | `fal-ai/minimax/voice-clone` → **維持** points=47／$1.50/次／verified=false／input `{audio_url,text}` ok；OpenAPI 200；**P0** `custom_voice_id` 未進 extractResult、未串 MiniMax TTS；預覽 $0.30/千字未估點 P2；ready-static-only；零 live／禁止 --yes |

broken 新增：無（端點存活；產品管線缺口記於 card，非 dead slug）  
card：`docs/model-audit/cards/fal-ai__minimax__voice-clone.md`  
下一輪：R5 下一 id（#220 起，號段 213–266）


## #14 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #112 `fal-ai/veo3.1/lite` → **已修** aspect `1:1`→`16:9`（enum 僅 16:9\|9:16）；**P0** 預設 duration=8s+generate_audio 實費≈12 vs 扁平5；points=5／verified=true 維持 |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=5；鎖空閒；5 點可 live 但無 KEY） |
| J | 跳過 |

broken 新增：無（1:1 422 已修；估點 P0 僅註記）  
下一輪：R 各 #6,#60,#113,#166,#219；P 下一 cat（需 FAL_KEY）；L 經濟 !needs（需 FAL_KEY）

## #15 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #113 `fal-ai/minimax/hailuo-02/standard/text-to-video` → 維持（OpenAPI **200**；points=7≈$0.045×5s；duration 預設 `"6"`；**aspect_ratio 死欄**；verified 既有 true） |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=5；鎖空閒） |
| J | 跳過 |

broken 新增：無  
下一輪：R 各 #7,#61,#114,#167,#220；P 下一 cat（需 FAL_KEY）；L 經濟 !needs（需 FAL_KEY）

## R5 unit | #220 qwen-3-tts/clone-voice/1.7b | 2026-08-05

| 角色 | 結果 |
|------|------|
| R5 | `fal-ai/qwen-3-tts/clone-voice/1.7b` → OpenAPI 200；**官方 $0.0008/分**（非 ~$0.09/千字）；output=`speaker_embedding` 站內未抽取；input 幽靈 `text`（應 `reference_text`）；**建議** cost/points→1、P0 串 Qwen TTS；ready-static-only；零 live／禁止 --yes |

broken 新增：無（端點存活；產品管線＋標價記於 card）  
card：`docs/model-audit/cards/fal-ai__qwen-3-tts__clone-voice__1.7b.md`  
下一輪：R5 下一 id（#221 起，號段 213–266）

## #7 | 階段:研究實測 | R1 | 2026-08-05

| 角色 | 結果 |
|------|------|
| R1 | #7 `fal-ai/ideogram/v3` → **修input優先**（OpenAPI **200**；points=2≈ BALANCED；**P1** 站內 `aspect_ratio` vs 官方 `image_size`；verified 維持 false；零 live／禁止 --yes） |
| P | 跳過（本輪 R1 只寫卡） |
| L | 跳過（禁止 --yes；budget 無本 id） |
| J | 跳過 |

broken 新增：無 404；契約 gap 記 P1 於 card  
下一輪：R1 下一 id（#8 起）

## R4 unit | #167 veed/video-background-removal | 2026-08-05

| 角色 | 結果 |
|------|------|
| R4 | `veed/video-background-removal` → **修 extractResult（video[]）**（points=4≈6s@上限 refine 維持；OpenAPI active commercial；預設 vp9 alpha；**P0** 輸出 `video` 為陣列站內解析空；ready-static-only；零 live／禁止 --yes） |

broken 新增：無（端點存活；extract 契約風險記於 card，非 dead slug）  
card：`docs/model-audit/cards/veed__video-background-removal.md`  
下一輪：R4 下一 id（#168 起，號段 160–212）

## #113 | 階段:研究實測 | R3 | 2026-08-05

| 角色 | 結果 |
|------|------|
| R3 | #113 `fal-ai/minimax/hailuo-02/standard/text-to-video` → **維持**（OpenAPI **200**；points=7≈5s@$0.045；**P1** 官方 default duration=6 ≈8.4 vs 扁平7；aspect_ratio 死欄 P2；cost「6秒基準」文案債；Pro/i2v fal 存在未收錄；零 live／禁止 --yes） |

broken 新增：無  
card：`docs/model-audit/cards/fal-ai__minimax__hailuo-02__standard__text-to-video.md`  
下一輪：R3 下一 id（#114 起）


## #16 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #114 `fal-ai/minimax/video-01-director` → 維持（OpenAPI **200**；points=16≈$0.5/支；運鏡靠 prompt `[Pan left]`；**aspect 死欄**；verified 既有 true） |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=5；16 點可 live 但無 KEY／非最經濟） |
| J | 跳過 |

broken 新增：無  
下一輪：R 各 #8,#62,#115,#168,#221；P 下一 cat（需 FAL_KEY）；L 經濟 !needs（需 FAL_KEY）

## #17 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #62 `fal-ai/aura-sr` → 維持（OpenAPI **200**；`image_url` required✓；4× 固定；checkpoint 預設 v1；points=2 人工／無$；verified=false；needs=image） |
| P | 跳過無 KEY |
| L | 跳過無 KEY（needs=image 不可 probe；spentTwd=5） |
| J | 跳過 |

broken 新增：無  
下一輪：R 各 #8,#63,#115,#168,#221；P 下一 cat（需 FAL_KEY）；L 經濟 !needs（需 FAL_KEY）

## R5 unit | #221 minimax/voice-design | 2026-08-05

| 角色 | 結果 |
|------|------|
| R5 | `fal-ai/minimax/voice-design` → OpenAPI 200；**官方 $3/聲+$0.03/千字預覽**（非「按字同 TTS」）；input 缺 required `preview_text`→422；output `custom_voice_id` 未抽取；**建議** cost/points→93、修 input；ready-static-only；零 live／禁止 --yes |

broken 新增：契約 gap（缺 preview_text）記於 card，端點存活非 dead slug  
card：`docs/model-audit/cards/fal-ai__minimax__voice-design.md`  
下一輪：R5 下一 id（#222 起，號段 213–266）

## #18 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #115 `fal-ai/wan/v2.5/text-to-video` → **已修 endpoint** `…/v2.5/…` 404 → **`fal-ai/wan-25/text-to-video`**（200）；**P0** 預設 1080p 實費≈23 vs 扁平 8（估點取 480p）；aspect 三比例綠；points=8／verified 維持 |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=5；修後可 live 但無 KEY） |
| J | 跳過 |

broken 新增：無（死 slug 已映射；非下架）  
下一輪：R 各 #8,#63,#116,#168,#221；P 下一 cat（需 FAL_KEY）；L 經濟 !needs（需 FAL_KEY）；**建議**同步核 wan/v2.6 slug

## R4 · #168 · 2026-08-05

| 角色 | 結果 |
|------|------|
| R4 | #168 `decart/lucy-edit` → **P0 endpoint 404**（基底不存在；僅 `/pro` active，`/fast` `/dev` deprecated）；input 對齊 video_url+prompt；points=16 維持（Pro@$0.15 人審~23–28）；verified=false；零 live／禁止 --yes |

card：`docs/model-audit/cards/decart__lucy-edit.md`


## #115 | 階段:研究實測 | R3 | 2026-08-05

| 角色 | 結果 |
|------|------|
| R3 | #115 `fal-ai/wan/v2.5/text-to-video` → **已修 endpoint**（目錄 path OpenAPI **404** → `endpoint: fal-ai/wan-25/text-to-video` **200** `Wan25TextToVideoInput`；points=8≈480p×5s；**P0** default 1080p×5s≈$0.75/~23 vs 扁平8；aspect 16:9/9:16/1:1 健康；`audio_url`≠generate_audio；零 live／禁止 --yes） |

broken 新增：無（死 path 已映射，非下架）  
card：`docs/model-audit/cards/fal-ai__wan__v2.5__text-to-video.md`  
下一輪：R3 下一 id（#116 起）

## #19 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #168 `decart/lucy-edit` → **已修 endpoint** 裸 id **404** → **`decart/lucy-edit/fast`**（economy）；pro 亦 200；input `prompt+video_url`✓；points=16 中價×5s；**P0** 扁平 vs 按秒；verified=false |
| P | 跳過無 KEY |
| L | 跳過無 KEY（needs=video；spentTwd=5） |
| J | 跳過 |

broken 新增：無（死基底 slug 已映射分檔）  
下一輪：R 各 #9,#63,#116,#169,#222；P 下一 cat（需 FAL_KEY）；L 經濟 !needs；**仍建議**核 wan/v2.6→wan-26

## R5 unit | #222 f5-tts | 2026-08-05

| 角色 | 結果 |
|------|------|
| R5 | `fal-ai/f5-tts` → OpenAPI 200；官方 **$0.05/千字** 已對齊；**已修** input 補 required `model_type:"F5-TTS"`；**已修** extractResult 認 AudioFile 形 `audio_url`；維持 points=2 verified=false needs=audio；ready-static-only；零 live／禁止 --yes |

broken 新增：無（契約 gap 已修）  
card：`docs/model-audit/cards/fal-ai__f5-tts.md`  
下一輪：R5 下一 id（#223 起，號段 213–266）

## R4 · #169 · 2026-08-05

| 角色 | 結果 |
|------|------|
| R4 | #169 `fal-ai/wan-vace-14b/outpainting` → **P0 修 input**（OpenAPI 200 active；required prompt+video_url✓；**expand_* 預設全 false** 站內不送邊＝可能不外擴；預設 81幀@16fps≈5s 非整片；points=9≈mid $0.06×5s；官方 $0.04/0.06/0.08/秒@16fps；verified=false；零 live／禁止 --yes） |

card：`docs/model-audit/cards/fal-ai__wan-vace-14b__outpainting.md`  
下一輪：R4 下一 id（#170 起，號段 160–212）


## #20 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #116 `fal-ai/wan/v2.6/text-to-video` → **已修 endpoint** 404（含 `wan-26`）→ **`wan/v2.6`**（200，`V26Input`）；**P0** 預設 1080p≈23 vs 扁平 16（估點取 720p $0.10）；duration 5/10/**15**；multi_shots 預設 true；points=16／verified 維持 |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=5） |
| J | 跳過 |

broken 新增：無（死 path 已映射）  
下一輪：R 各 #9,#63,#117,#169,#222；P 下一 cat（需 FAL_KEY）；L 經濟 !needs
