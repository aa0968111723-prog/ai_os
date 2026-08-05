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

## #21 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #64 `fal-ai/supir` → 維持（OpenAPI **200**；`image_url`✓；生成式重建／字卡勿用；points=3 價未知人工；prompt 未接 a_prompt；verified=false；needs=image） |
| P | 跳過無 KEY |
| L | 跳過無 KEY（needs=image；spentTwd=5） |
| J | 跳過 |

broken 新增：無  
下一輪：R 各 #10,#65,#117,#170,#223；P 下一 cat（需 FAL_KEY）；L 經濟 !needs

## R3 · #116 · 2026-08-05

| 角色 | 結果 |
|------|------|
| R3 | #116 `fal-ai/wan/v2.6/text-to-video` → **已修 endpoint**（目錄 path／`wan-26`／`wan/v2.6/text-to-video` OpenAPI **404** → `endpoint: wan/v2.6` **200** `V26Input`；points=16≈720p×5s；**P0** default 1080p×5s≈$0.75/~23 vs 扁平16；duration 5/10/**15**；multi_shots default true；**SEED_SUPPORTED** 補 id；aspect 三比例健康；`audio_url`≠generate_audio；零 live／禁止 --yes） |

card：`docs/model-audit/cards/fal-ai__wan__v2.6__text-to-video.md`  
下一輪：R3 下一 id（#117 起）


## #22 | 階段:研究實測 · 2026-08-05T04:42Z

| 角色 | 結果 |
|------|------|
| R1 | #10 `fal-ai/kolors` → OpenAPI 200；points=1≈；歷史 live budget OK；card 已寫 |
| R2 | #65 `fal-ai/thera` → **P0 修 backbone=edsr**；points=1≈$0.0021/MP |
| R3 | #117 `fal-ai/hunyuan-video-v1.5/text-to-video` → **P0 修 1:1→16:9**；points12 貼邊建議14 |
| R4 | #170 `fal-ai/latentsync` → OpenAPI 200；video+audio 契約 OK；points=6≈ |
| R5 | #223 `fal-ai/vibevoice` → **P0 修 speakers**（7b 同）；長稿估點低估 |
| 補卡 | #11 lightning #12 flex #13 flux-2 #14 ultra #17 recraft v3 #24 sana #25 playground #66 seedvr |
| P | 跳過（本 shell 無 FAL_KEY） |
| L | 跳過（無 KEY；spentTwd=5/900） |
| J | 跳過 |

broken 新增：thera/vibevoice/ultra FIXED；hunyuan PARTIAL  
cards 合計：≈65／266  
下一輪：R 各 #15? 下一 missing；P 需 KEY；L 經濟 !needs


## #22 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #117 `fal-ai/hunyuan-video-v1.5/text-to-video` → **已修 input** 1:1→16:9 防422（enum 僅 16:9\|9:16）；OpenAPI **200** active；鎖 **480p**／**121**幀；points=12≈5s@$0.075（P1 cost 文案寫 6s）；negative✓ seed allowlist 未收；verified 維持 true；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=5） |
| J | 跳過 |

broken 新增：無  
下一輪：R 各 #10,#65,#118,#170,#223；P 下一 cat（需 FAL_KEY）；L 經濟 !needs（需 FAL_KEY）


## #23 | 階段:研究實測 · 2026-08-05

| 角色 | 結果 |
|------|------|
| R | 本輪主代理+子代理：#18 recraft v4.1、#19–21 nano/imagen、#22 qwen-max、#23 hunyuan-image **endpoint 修**、#26–27 luma/aura、#67 crystal、#68/70 upscale、#113/118/121/123 T2V、#171 musetalk **source_video_url**、#224 vibevoice/7b |
| P | 跳過（無 FAL_KEY） |
| L | 跳過（spentTwd=5；無 KEY） |
| J | 跳過 |

broken：hunyuan-image/musetalk/aura-flow FIXED；cards≈80+/266  
下一輪：繼續 L0 缺口；P/L 待 KEY


## #24 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #225 `fal-ai/dia-tts/voice-clone` → OpenAPI **200** active（去推定）；**P0** Input 僅 `text`（無樣音欄）·站內 `ref_audio_url` 幽靈；needs=audio／points=2／verified=false 維持；動態估點 $0.04/千字≈；英文主場；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（needs=audio；spentTwd=5） |
| J | 跳過 |

broken 新增：無（端點活；契約 gap 記 P0 非下架）  
下一輪：R 各下一 missing（R4/R5 仍少）；P 下一 cat（需 FAL_KEY）；L 經濟 !needs（需 FAL_KEY）

## R3 unit | #119–#122 T2V L0 batch | 2026-08-05

| 角色 | 結果 |
|------|------|
| R3 | #118 pika **已有卡**跳過 |
| R3 | #119 `fal-ai/luma-dream-machine/ray-2-flash` → **已修** 1:1→16:9；OpenAPI200；6≈$0.2@540p5s；零 live |
| R3 | #120 `fal-ai/bytedance/seedance/v1/lite/text-to-video` → **維持**；OpenAPI200；**deprecated→pro fast** P0 計費；aspect 含1:1 |
| R3 | #122 `fal-ai/pixverse/v6/text-to-video` → **維持**；OpenAPI200 endpoint 確認；1:1 合法；P1 預設720p無音 vs 14@$1080p錨 |

broken 新增：無（#120 棄用轉發記 P0 非 404）  
cards：`fal-ai__luma-dream-machine__ray-2-flash` · `fal-ai__bytedance__seedance__v1__lite__text-to-video` · `fal-ai__pixverse__v6__text-to-video`  
下一輪：R3 下一 ⬜（#124 wan-t2v 起；#121/#123 已 ok）


## #25 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #172 `bria/video/background-removal/v3` → OpenAPI **200** active；`video_url`✓；runtime points **1**≈$0.0042×5s（目錄舊 3／未載價 過期）；預設 **Black**+webm_vp9（合成透明需 P1）；**P0** 長片扁平低估；verified=false；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（needs=video；spentTwd=5） |
| J | 跳過 |

broken 新增：無  
下一輪：R 各 missing（R4 下一 #173 或已映 realtime；R5 #226）；P/L 需 FAL_KEY

## R4+R5 merge | static+research (no --yes)

| 角色 | 結果 |
|------|------|
| R4 | #172 bria v3 維持 cost$0.0042；#173 realtime **endpoint→batch**；#174 VEED fast 維持；extract video[] **已修** |
| R5 | #225 dia voice-clone 契約落差 P0；#226 elevenlabs dialogue 維持 |
| P0 fixed | extractResult File[]；realtime endpoint |
| P0 open | dia-tts/voice-clone schema vs needs |



## #24 | 階段:研究實測 · bulk-all L0 · 2026-08-05T04:55Z

| 角色 | 結果 |
|------|------|
| R | bulk 補齊剩餘 L0 cards；本批 missing→0 目標；404 見下 |
| P | 跳過無 FAL_KEY |
| L | 跳過 spentTwd=5 無 KEY |
| J | 跳過 |

cards=266/266 · 404s=9


## #26 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #227 `fal-ai/gemini-tts` → OpenAPI **200** active；input `prompt`+`Chinese Mandarin (Taiwan)`+`mp3` 全合法；預設 Kore／flash；points=2 人工（cost 無 $）；speakers／style 未暴露；verified=false；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（!needs 可探但無 KEY；spentTwd=5） |
| J | 跳過 |

broken 新增：無  
下一輪：R5 #228 zonos；R4 #175 VEED green-screen；R3 #129+；P/L 需 FAL_KEY


## #27 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #181 `nvidia-nim#deepseek-r1` → **正名卡** `nvidia-nim__deepseek-r1.md`（bulk `#` 檔為 stub 誤判 fal404）；endpoint=`nvidia-nim` model=`deepseek-ai/deepseek-r1`；**P0** 目錄 points=0 vs estimatePoints floor **1**；verified=false；零 live（無 NIM KEY） |
| P | 跳過無 KEY（FAL；NIM 亦無） |
| L | 跳過無 KEY（spentTwd=5） |
| J | 跳過 |

broken 新增：無（bulk 404 註記作廢，非下架）  
下一輪：R4 其餘 NIM／vision 錯名 slug（#182+）；P/L 需 KEY


## bulk→9節 R · #83/#85/#94/#125/#127 · 2026-08-05

| 角色 | 結果 |
|------|------|
| R | #125 `fal-ai/hunyuan-video` → **已修** 1:1→16:9；neg allowlist 移除；12≈$0.40/支；OpenAPI 200 active；零 live |
| R | #83 `fal-ai/ideogram/character` → **P0 修 input** `reference_image_urls[]`+image_size；P1 BALANCED≈5 vs 3；零 live |
| R | #94 `fal-ai/finegrain-eraser` → **維持** input✓；6≈$0.18；P1 cost 文案 vs mode 三檔；無P0 |
| R | #85 `fal-ai/flux-pulid` → **P0 修 input** `reference_image_url`+image_size；1≈$0.0333/MP；零 live |
| R | #127 `fal-ai/cogvideox-5b` → **P0 修 input** `video_size`（去 aspect_ratio）；6≈$0.2/支；negative✓；零 live |

P0 fixed：#83 reference_image_urls；#85 reference_image_url；#125 aspect 1:1；#127 video_size；#125 neg 幽靈  
P0 open：無（本批）  
禁止 `--yes` · verified/points 未改


## #25 | 階段:回寫 B9 · 2026-08-05T04:59Z

### 狀態
- L0 cards: **266/266**
- spentTwd: **5** / softStop 900（P/L 本 shell 無 FAL_KEY → 跳過 live）
- L1: 多數 OpenAPI 靜態 200；category `--yes` 空連通需 KEY
- L2: 5 次歷史 live（schnell/sana/dev/kolors/playground）；其餘未跑/需素材

### B9 勾選進度
- [x] gen-model-docs 已跑 → docs/模型目錄.md
- [x] verify-models 已跑 → docs/模型清查清單.md
- [x] audit-model-pricing 已跑 → docs/點數校準報告.md（標記 pricing-audit-done.flag）
- [x] SCENARIO pickIds：seedream/v5 已換 v4.5；全量 pick/showdown 無死 id
- [x] fal.test.ts 26 passed（含 video[] extract）
- [ ] MODELS 無已知 404（仍保留 4 死 slug 於目錄供標註：seedream/v5、runway-gen3、bria/eraser、mix-dehaze；未批量刪）
- [x] 工作台預設 fal-ai/fast-lightning-sdxl 非 broken
- [ ] 助手／agent／MCP 死 id 全清（catalog 仍列 404 模型，picker 可見；建議下架 PR）
- [ ] e2e-models／e2e-mcp 本輪未跑
- [x] model-audit 可追溯（cards + broken + ROUND-LOG）

### 本輪 models.ts P0 契約修（累積）
thera backbone · vibevoice(+7b) speakers · flux ultra aspect · hunyuan t2v 1:1 · musetalk source_video_url · aura-flow drop image_size · hunyuan-image endpoint · flux-2/pro/edit endpoint · bria realtime endpoint · sc-cn-poster pickIds

### 下一輪
- 有 FAL_KEY 時：P 連通 + L 經濟 !needs 佇列
- 下架/隱藏 404 模型小 PR
- e2e 綠燈


## #28 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #182 `nvidia-nim#llama-3.1-405b` → 正名卡 `nvidia-nim__llama-3.1-405b.md`；model=`meta/llama-3.1-405b-instruct`；非fal；workflow 潤飾步綁定；**P0** 顯示0 vs 估點 floor1；verified=false；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=5） |
| J | 跳過 |

broken 新增：無（bulk 404 註記作廢）  
下一輪：R4 #183 nemotron 等同型正名


## #29 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #183 `nvidia-nim#nemotron-4-340b` → 正名卡 `nvidia-nim__nemotron-4-340b.md`；model=`nvidia/nemotron-4-340b-instruct`；非fal；**P0** 顯示0 vs 估點 floor1；verified=false；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=5） |
| J | 跳過 |

broken 新增：無  
下一輪：R4 #184 llama-70b 等同型正名


## #26 | 階段:回寫 B9 續 · 2026-08-05T05:02Z

R: L0=266/266 已齊；P/L 無 KEY 跳過
B9: points 調 clarity4 / voice-design93 / wan2.5=16+720p / veo-lite9
B9: mix-dehaze/runway/bria-eraser verified=false（404）
B9: sc-cn-poster seedream v5→v4.5；docs 重生
tests: models 17 + pricing 27 + fal 26 = 綠

spentTwd=5/900
下一輪：FAL_KEY→P/L；404 下架 PR；e2e


## #30 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #184 `nvidia-nim#llama-3.1-70b` → 正名卡；**NIM_DEFAULT_MODEL** `meta/llama-3.1-70b-instruct`；recommended=true；**P0** 顯示0 vs 估點 floor1；verified=false；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=5） |
| J | 跳過 |

broken 新增：無  
下一輪：R4 #185 qwen2.5-72b 等同型正名


## #31 | 階段:回寫 B9 · 契約/點數（靜態）· 2026-08-05

### 範圍
- 零 live／禁止 `--yes`；未批量 verified true

### 修改
| id | 動作 |
|----|------|
| `fal-ai/qwen-3-tts/clone-voice/1.7b` | **非端到端 TTS** 註記；input 只送 `audio_url`（+optional `reference_text`）；刪幽靈 `text`；cost `$0.0008/分` points→**1**；strengths 警告；`extractResult` 認 `speaker_embedding`；**verified 維持 false**；broken **P0-PARTIAL** |
| `fal-ai/dia-tts/voice-clone` | OpenAPI 真 path **200**（非 404）；僅 required `text`；input 只送 text；去 needs/ref_audio_url；strengths「非真克隆」；**verified false**；broken **P0-FIXED** |
| `fal-ai/sync-lipsync` (1.9) | points=22 **維持**（$0.7×31 已對齊，無低估） |
| `fal-ai/sync-lipsync/v3` | cost→**$8/分** points **155→248**；broken **P1-FIXED** |
| pickIds/showdown | 複核：無 seedream/v5、runway-gen3、bria/eraser、mix-dehaze 引用（sc-cn-poster 已 v4.5） |

### 檔案
- `shared/models.ts` · `server/services/fal.ts` · `server/services/fal.test.ts`
- cards：qwen clone-voice、dia voice-clone、sync-lipsync、sync-lipsync/v3
- `docs/model-audit/broken.json` · 本段 ROUND-LOG

### 測試
- fal.test 加 speaker_embedding 分支（待本輪 vitest）

### 下一輪
- FAL_KEY → live 對帳（控費）
- Qwen TTS 暴露 `speaker_voice_embedding_file_url` 產品閉環
- 404 下架 PR（seedream/v5 等仍 catalog 可見）


## #31 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #185 `nvidia-nim#qwen2.5-72b` → 正名卡；model=`qwen/qwen2.5-72b-instruct`；中文金句 winner；**P0** 顯示0 vs 估點 floor1；verified=false；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=5） |
| J | 跳過 |

broken 新增：無  
下一輪：R4 #186 mistral-large-2 等同型正名


## #32 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #186 `nvidia-nim#mistral-large-2` → 正名卡；model=`mistralai/mistral-large-2-instruct`；多語/翻譯；**P0** 顯示0 vs 估點 floor1；verified=false；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=5） |
| J | 跳過 |

broken 新增：無  
下一輪：R4 #187 llama-3.1-8b（NIM 最後一檔）後接 vision 錯名 slug


## #33 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #187 `nvidia-nim#llama-3.1-8b` → 正名卡；model=`meta/llama-3.1-8b-instruct`；budget；checkNimStatus 探 ping；**P0** 顯示0 vs 估點 floor1；verified=false；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=5） |
| J | 跳過 |

broken 新增：無  
下一輪：R4 #188 `fal-ai/any-llm/vision#gemini-2.5-pro`（vision 錯名 slug 正名）


## #27 | 階段:回寫 B9 · 2026-08-05T05:08Z

R: L0 266 齊 · cards≥270  
P: 跳過（無 FAL_KEY）  
L: 跳過（spentTwd=5；無 KEY）  
J: 跳過  

B9: qwen clone / dia voice-clone / sync-lipsync v3 / lucy-edit endpoint 確認  
tests 71 綠 · gen-model-docs 已跑  
broken OPEN≈9（3 純 404 待下架 + PARTIAL 估點/產品）

下一輪：無 KEY 則續 B9 清 OPEN；有 KEY 則 P→L


## #34 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #188 `fal-ai/any-llm/vision#gemini-2.5-pro` → 正名卡；endpoint=`fal-ai/any-llm/vision` model=`google/gemini-2.5-pro`；flagship 看圖；**P1** image_url vs OpenAPI image_urls；verified 目錄 true 不改；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=5；needs 不可經濟 probe） |
| J | 跳過 |

broken 新增：無  
下一輪：R4 #189 `fal-ai/any-llm/vision#claude-sonnet-4.5`（同型正名）


## #35 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #189 `fal-ai/any-llm/vision#claude-sonnet-4.5` → 正名卡；endpoint=`fal-ai/any-llm/vision` model=`anthropic/claude-sonnet-4.5`；圖表/文件嚴謹；**P1** image_url vs image_urls 共債；verified 目錄 true 不改；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=5；needs） |
| J | 跳過 |

broken 新增：無  
下一輪：R4 #190 `fal-ai/any-llm/vision#gpt-5`（同型正名）


## #36 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #190 `fal-ai/any-llm/vision#gpt-5` → 正名卡；endpoint=`fal-ai/any-llm/vision` model=`openai/gpt-5`；VQA 全能；**P1** image_url vs image_urls；**verified=false** 待 L2；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=5；needs） |
| J | 跳過 |

broken 新增：無  
下一輪：R4 #191 `fal-ai/moondream-next`（bulk 升正名）或 #195 Flash `#` slug


## #28 | 階段:回寫 B9 · 2026-08-05T05:14Z

R: recommended 深卡 flux-i2i / wan t2v / wan i2v / scribe / moondream  
L/P: 無 KEY  
B9: wan i2v **鎖 480p** 對齊 points=6  
tests models 綠 · spentTwd=5


## #37 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #195 `fal-ai/any-llm/vision#gemini-2.5-flash` → 正名卡；model=`google/gemini-2.5-flash`；**DB_VISION 預設**·sc-caption winner；**P1** image_url vs image_urls；verified=false；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=5；needs） |
| J | 跳過 |

broken 新增：無  
下一輪：R4 #200 `fal-ai/whisper#translate`（speech `#` 正名）


## #38 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #200 `fal-ai/whisper#translate` → 正名卡；endpoint=`fal-ai/whisper` `task=translate`→英；**P2** 長檔扁平估點共債；verified 目錄 true 不改；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=5；needs=audio） |
| J | 跳過 |

broken 新增：無  
下一輪：R4 #201 `fal-ai/whisper#chapters`


## #39 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #201 `fal-ai/whisper#chapters` → 正名卡；endpoint=`fal-ai/whisper` `chunk_level=word`（非獨立 chapters API）；**P2** 長檔扁平估點；verified 目錄 true 不改；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=5；needs=audio） |
| J | 跳過 |

broken 新增：無  
下一輪：R4 #202 `fal-ai/elevenlabs/speech-to-text#keyterms`


## #40 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #202 `fal-ai/elevenlabs/speech-to-text#keyterms` → 正名卡；endpoint=`scribe-v2`+`keyterms`；prompt→術語表；**P2** 長檔扁平；verified=false；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=5；needs=audio） |
| J | 跳過 |

broken 新增：無  
下一輪：R4 #203 `fal-ai/wizper#draft`（R4 最後一檔 proper miss）


## #41 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #203 `fal-ai/wizper#draft` → 正名卡；endpoint=`wizper` 精簡 `task=transcribe`（無 language）；**P2** 長檔扁平；verified 目錄 true 不改；**R4 proper-slug 53/53 齊** |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=5；needs=audio） |
| J | 跳過 |

broken 新增：無  
下一輪：全號段 slug 已齊 → 升 thin bulk 九章（R5 thin≈40 最多）或有 FAL_KEY 則 P/L


## #29 | 階段:回寫+深研 · 2026-08-05T05:21Z

R: 深卡 hunyuan-video / ideogram character / finegrain / flux-pulid / cogvideox  
P0 修: character reference_image_urls · pulid reference_image_url · cogvideox video_size · hunyuan 1:1  
P/L: 無 KEY · spentTwd=5  
tests 71 綠


## #42 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #224 `fal-ai/vibevoice/7b` → 九章升（R5 thin）；OpenAPI required `script`+`speakers` 綠（P0-FIXED）；預設單 Bowen；多人對談 winner；**P2** 長稿flat／單speaker vs 多人；verified=false；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=5；!needs 但無 KEY） |
| J | 跳過 |

broken 新增：無  
下一輪：R5 下一 thin bulk→九章（R5 thick 最少）


## #30 | 階段:研究實測 · 2026-08-05T05:25Z · **20s 節奏 · 有 FAL_KEY**

| 角色 | 結果 |
|------|------|
| R | 背景續深卡 |
| P | text-to-image 30 端：連通 **23/30** ok；0×404；cancel_unconfirmed 若干 |
| L | **live** `fal-ai/fast-lightning-sdxl` · 估1 · success · spentTwd→6.0 |
| J | 跳過 |

broken 新增：無  
下一輪：P 下一 cat；L 下一經濟 !needs（flux-2 / imagen4-fast / kokoro…）


## #31 | 階段:研究實測 · 20s · 2026-08-05T05:25Z

P: image-to-image 49/66 ok · 0×404  
L: **live** fal-ai/flux-2 · 1點 · success · spentTwd=7.0  
R: 背景深卡  
下一: L imagen4/fast 或 seedream4.5；P text-to-video

## #43 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #225 `fal-ai/dia-tts/voice-clone` → 九章升（R5 thin）；B9 path真／required 僅 text；**非真克隆**；needs=null 對齊 models.ts；**P2** 標籤誤導／千字動態；verified=false；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=5；!needs 但無 KEY） |
| J | 跳過 |

broken 新增：無（沿用 P0-FIXED）  
下一輪：R5 thin #228 `fal-ai/zonos`（真 stub）或 #220 qwen clone 1.7b；有 KEY 則 P/L

## #44 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #228 `fal-ai/zonos` → 九章升（R5 thin stub）；OpenAPI required `reference_audio_url`+`prompt` **綠**；真克隆；價未明列 **P2**；points=1/needs=audio/verified=false；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=7；needs=audio 不進經濟探活） |
| J | 跳過 |

broken 新增：無  
下一輪：R5 thin #229 `fal-ai/orpheus-tts`；有 KEY 則 P/L


## #32 | 20s · 2026-08-05T05:30Z
L: imagen4/preview/fast success · spentTwd=8.0
R: bria replace/prompt · photomaker zip · ltx 去 aspect · P0 已修

## #45 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #229 `fal-ai/orpheus-tts` → 九章升（R5 thin stub）；OpenAPI required `text` **綠**；voice×8/情感 tag 可選未暴露；價未明 **P2**；points=1/!needs/verified=false；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=7；!needs 但無 KEY；live 鎖曾佔已過期不 claim） |
| J | 跳過 |

broken 新增：無  
下一輪：R5 thin #230 `fal-ai/lyria2`（text-to-audio）；有 KEY 則 P/L

## #46 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #230 `fal-ai/lyria2` → 九章升（R5 thin stub）；OpenAPI required `prompt` **綠**；$0.10/30s≈points=3；neg/seed 未送；verified=true 不改；**P2** 時長／UI；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=8；!needs 但無 KEY） |
| J | 跳過 |

broken 新增：無  
下一輪：R5 thin #231 `fal-ai/elevenlabs/music`；有 KEY 則 P/L

## #47 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #231 `fal-ai/elevenlabs/music` → 九章升；OpenAPI 無 hard required、站內 `prompt` 綠；74≈3分@$0.80；**P2** music_length_ms 動態／composition_plan 未接；verified=false；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=8；!needs 但無 KEY；高點 74 本回合也不宜 live） |
| J | 跳過 |

broken 新增：無  
下一輪：R5 thin #232 `fal-ai/stable-audio-25/text-to-audio`；有 KEY 則 P/L

## #48 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #232 `fal-ai/stable-audio-25/text-to-audio` → 九章升；OpenAPI required `prompt` **綠**；站內 `seconds_total:30`（API 預設190）；$0.20/次≈6；**P2** 秒數UI vs bestFor；verified=false；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=9；!needs 但無 KEY） |
| J | 跳過 |

broken 新增：無  
下一輪：R5 thin #233 `fal-ai/minimax-music`；有 KEY 則 P/L

## #46 | 20s · 2026-08-05T05:36:44Z

| 角色 | 結果 |
|------|------|
| R | #230 `fal-ai/lyria2` → 九章升；OpenAPI required `prompt` 綠；neg/seed optional 未入 allowlist **P2**；points=3≈$0.10；!needs；零 live |
| P | image-to-video 24 端：連通 **17/24** ok；0×404；cancel_unconfirmed 7 |
| L | **live** `fal-ai/orpheus-tts` · 估1 · success · wav · spentTwd→10.0 · req 019fd069-4f87-7ed1-9c00-dbc084c66f9a |
| J | 跳過 |

broken 新增：無  
下一輪：R5 thin 下一；P text-to-speech；L 下一經濟 !needs（aura-flow / chatterbox / kokoro…）

## #49 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #233 `fal-ai/minimax-music` → 九章升；OpenAPI required `prompt`+`reference_audio_url`；**P0-FIXED** 原僅 prompt 會 422 → needs=audio+input 對齊；verified→false；pure TTM 指引 #237 v2.6；$0.03≈1；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=9；needs=audio） |
| J | 跳過 |

broken 新增：`fal-ai/minimax-music` P0-FIXED  
下一輪：R5 thin #234 `fal-ai/elevenlabs/sound-effects/v2`；有 KEY 則 P/L

## #50 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #234 `fal-ai/elevenlabs/sound-effects/v2` → 九章升；OpenAPI required `text` **綠**；duration/loop 未送；≈$0.01≈1；verified=true 不改；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=10；!needs 但無 KEY） |
| J | 跳過 |

broken 新增：無  
下一輪：R5 thin #235 `cassetteai/sound-effects-generator`；有 KEY 則 P/L


## #33 | 20s · KEY on · spentTwd=11.0

L: seedream 4.5 **success**；kokoro poll timeout(計1防超支)  
P: t2i/i2i/t2v 已跑  
下一: L recraft/v3 或 flux-2/pro；P i2v/tts

## #51 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #235 `cassetteai/sound-effects-generator` → 九章升；OpenAPI required `prompt`+`duration` **綠**（站內10）；output `audio_file` extract✅；≈$0.005≈1；verified=true 不改；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=11；!needs 但無 KEY） |
| J | 跳過 |

broken 新增：無  
下一輪：R5 thin #236 `fal-ai/ace-step`；有 KEY 則 P/L

## #47 | 20s · 2026-08-05T05:41:04Z

| 角色 | 結果 |
|------|------|
| R | #233 `fal-ai/minimax-music` → 九章升；OpenAPI required `prompt`+`reference_audio_url`；**needs=audio**（thin/index 誤標 !needs **P1**）；points=1≈$0.03；零 live |
| P | text-to-speech 22 端：連通 **16/22** ok；0×404；cancel_unconfirmed 6 |
| L | **live** `fal-ai/aura-flow` · 估1 · success · 1024 png · spentTwd→13.0 · req 019fd06e-1bb1-71d1-b09f-29027e1c85f2 |
| J | 跳過 |

broken 新增：無  
下一輪：R5 thin #234 elevenlabs SFX；P text-to-audio；L 下一經濟 !needs（chatterbox / recraft / luma-photon…）

## #52 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #236 `fal-ai/ace-step` → 九章升；OpenAPI required `tags`；**P0-FIXED** 原 prompt→tags；duration 預設60；秒價雙源 **P2**；points=1/verified=true 不改；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=13；!needs 但無 KEY） |
| J | 跳過 |

broken 新增：`fal-ai/ace-step` P0-FIXED  
下一輪：R5 thin #237 `fal-ai/minimax-music/v2.6`（純 prompt TTM；接 #233 分流）；有 KEY 則 P/L


## #34 | 20s · KEY · spentTwd=15.0

P: i2v 18/24 ok（含 runway-gen3 空 probe ok）；tts 16/22 ok  
L: luma-photon + flux-2/pro **success**  
下一: L qwen-image-2 / recraft v4.1 / ideogram v4


## #35 | 20s · spentTwd=16.0
L: qwen-image-2 **success** · 下一 recraft v4.1 / ideogram v4 / chatterbox

## #48 | 20s · 2026-08-05T05:44:08Z

| 角色 | 結果 |
|------|------|
| R | #237 `fal-ai/minimax-music/v2.6` → 九章升；OpenAPI required `prompt`；**P0** 非器樂時 lyrics 條件必填／建議 `lyrics_optimizer:true`；points=5 推定；零 live |
| P | text-to-audio 18 端：連通 **14/18** ok；0×404；cancel_unconfirmed 4 |
| L | **live** `fal-ai/chatterbox/text-to-speech` · **failed 422** ASCII-only（探測「測試」）· twdEst=0 · spentTwd=17.0 · req 019fd072-e762-7293-9c7e-7cd97d1c697d |
| J | 跳過 |

broken 新增：chatterbox 英-only vs 中文 probe；minimax-music/v2.6 條件 lyrics **P0**  
下一輪：R #238 v2；P 下一 cat（training 或 llm 略過／video-to-video…）；L 下一經濟 !needs（recraft/v4.1 · stable-audio · diffrhythm）


## #36 | 20s · spentTwd=18.0
L: ideogram/v4 **P0 修 endpoint→ideogram/v4 + image_size** 後 success  
recraft v4.1 success · qwen-image-2 success

## #49 | 20s · 2026-08-05T05:46:14Z

| 角色 | 結果 |
|------|------|
| R | #238 `fal-ai/minimax-music/v2` → 九章升；OpenAPI **required prompt+lyrics_prompt**；站內只送 prompt → **P0 必422**；points=1 推定；零 live |
| P | video-to-video 27 端：連通 **21/27** ok；0×404；cancel_unconfirmed 6 |
| L | **live** `fal-ai/stable-audio` · 估1 · success · wav · spentTwd→19.0 · req 019fd074-7be6-7152-bbc2-8475566ddac8 |
| J | 跳過 |

broken 新增：minimax-music/v2 缺 lyrics_prompt **P0**  
下一輪：R #239 sonilo；P speech-to-text 或 vision；L 下一經濟 !needs（ace-step / diffrhythm / dia-tts…）


## #53 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #113 `fal-ai/minimax/hailuo-02/standard/text-to-video` → 九章升；OpenAPI required `prompt`；duration 6/10 def6；**P1** schema 無 `aspect_ratio`（站內仍送死欄）；points=7≈5s×$0.045 機械對齊；verified 不改；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=19；!needs 但無 KEY；live 鎖／並發 L 已用） |
| J | 跳過 |

broken 新增：無（aspect 死欄記卡／P1，未證 422）  
下一輪：R3 thin #118 `fal-ai/pika/v2.2/text-to-video`（done 最少號段）；有 KEY 則 P/L


## #37 | 20s · spentTwd=20.0
L: chatterbox **multilingual endpoint 修後 success**；ideogram v4 endpoint 已修  
live success 累計 19


## #38 | 20s · spentTwd=22.0 · live success=20

P: v2v 20/27 ok（含 bria/video/eraser 空 probe ok）  
L: qwen-image-2/pro success(+2)  
下一: 經濟 T2I 剩餘 / TTS 低點


## #54 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #118 `fal-ai/pika/v2.2/text-to-video` → 九章升；OpenAPI required `prompt`；aspect 含 **1:1 綠**；def 720p/5s；$0.2→runtime points **6**（字面10被 realPricePoints 覆寫）；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=22；本環境無 FAL_KEY） |
| J | 跳過 |

broken 新增：無  
下一輪：R3 thin #121 `fal-ai/pixverse/v5.5/text-to-video`（done 最少）；有 KEY 則 P/L


## #55 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #121 `fal-ai/pixverse/v5.5/text-to-video` → 九章升；OpenAPI required `prompt`；aspect 含 **1:1/9:16 綠**；def 720p/5s/無音；`parseRealCost` 失敗→手填 **9**；cost 缺 720p 明碼 **P2**；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=25.0） |
| J | 跳過 |

broken 新增：無  
下一輪：R3 thin #123 `fal-ai/kling-video/v1.6/standard/text-to-video`；有 KEY 則 P/L

## #50 | 20s · 2026-08-05T05:51:07Z

| 角色 | 結果 |
|------|------|
| R | #239 `sonilo/v1.1/text-to-music` → 九章升；OpenAPI required `prompt`；站內 duration=90/samples=1 **綠**；points=7≈$0.225@90s；**P2** 長時長扁平；零 live |
| P | speech-to-text 7 端：連通 **5/7** ok；0×404；cancel_unconfirmed 2 |
| L | **live** `fal-ai/dia-tts` · 估2 · success · wav · spentTwd→27.0 · req 019fd076-3752-7333-8de8-a8de30a6f37a |
| J | 跳過 |

broken 新增：無  
下一輪：R #240 diffrhythm；P vision 或 training；L 下一經濟 !needs（ace-step / diffrhythm / index-tts…）


## #39 | 20s · spentTwd=29.0
L: dia-tts poll timeout(計2) · nano-banana-2 success  
P cats: t2i/i2i/t2v/i2v/tts/v2v 已跑  
P0 本輪: ideogram/v4 endpoint、chatterbox multilingual


## #56 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #123 `fal-ai/kling-video/v1.6/standard/text-to-video` → 九章升；OpenAPI required `prompt`；aspect **16:9/9:16/1:1 全綠**；站內 `duration:"5"` 對齊 $0.056×5×31=**9**；cost「6秒基準」**P2**；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=29.0） |
| J | 跳過 |

broken 新增：無  
下一輪：R3 thin #124 `fal-ai/wan-t2v`；有 KEY 則 P/L

## #51 | 20s · 2026-08-05T05:52:31Z

| 角色 | 結果 |
|------|------|
| R | #240 `fal-ai/diffrhythm` → 九章升；OpenAPI required **`lyrics`**；站內送 `prompt` → **P0 必422**；duration 95s/285s **P2** flat1；零 live |
| P | vision 6 端：連通 **4/6** ok；0×404；cancel_unconfirmed 2 |
| L | **live** `fal-ai/ace-step` · 估1 · success · wav · spentTwd→30.0 · req 019fd07a-a13f-7141-8272-9274672439cc |
| J | 跳過 |

broken 新增：diffrhythm prompt→lyrics **P0**  
下一輪：R #241 cassette music；P training 或 llm；L 下一經濟 !needs（index-tts / cassette music / vibevoice…）

## #52 | 20s · 2026-08-05T05:53:49Z

| 角色 | 結果 |
|------|------|
| R | #241 `cassetteai/music-generator` → 九章升；OpenAPI required `prompt`+`duration` 綠；duration=60；output audio_file；points=1 |
| P | training 19 端：連通 **19/19** ok；**0×404** |
| L | **live** `cassetteai/music-generator` · 估1 · success · wav · spentTwd→34.0 · req 019fd07b-e1ba-7a53-96e1-076140633396 |
| J | 跳過 |

broken 新增：無  
下一輪：R #243 mmaudio t2a（#242 needs=video 略深可記）；P llm；L index-tts / vibevoice / gemini-tts…


## #57 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #124 `fal-ai/wan-t2v` → 九章升；OpenAPI required `prompt`；aspect 僅 16:9/9:16；**P0-FIXED** 1:1→16:9；def **720p** vs cost 480p **P2**；備援 slug 404；points=6；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=34.0） |
| J | 跳過 |

broken 新增：`fal-ai/wan-t2v` P0-FIXED aspect 1:1  
下一輪：R3 thin #126 `fal-ai/mochi-v1`（#125 hunyuan 若已厚則跳）；有 KEY 則 P/L

## #53 | 20s · 2026-08-05T05:55:18Z

| 角色 | 結果 |
|------|------|
| R | #243 `fal-ai/mmaudio-v2/text-to-audio` → 九章升；OpenAPI required `prompt` 綠；duration def8；points=1≈$0.001/s |
| P | llm：7 模型皆 **nvidia-nim** 略過（0 fal 端點）；報告已寫 |
| L | **live** `fal-ai/mmaudio-v2/text-to-audio` · 估1 · success · mp3 · spentTwd→35.0 · req 019fd07d-1216-7210-8693-b7cc9f53c266 |
| J | 跳過 |

broken 新增：無  
下一輪：R #242 mmaudio video 或 #244 yue；P 全 cat 已過可補缺／重掃；L index-tts / vibevoice / gemini-tts…

## #54 | 20s · 2026-08-05T05:56:47Z

| 角色 | 結果 |
|------|------|
| R | #242 `fal-ai/mmaudio-v2` → 九章升；OpenAPI required `video_url`+`prompt`；output **video**；needs=video；**P2** kind=audio vs 片輸出；points=1 |
| P | 跳過（llm 全 NIM；fal cat 本輪已掃完 image/i2i/t2v/i2v/v2v/tts/t2a/stt/vision/training） |
| L | **live** `fal-ai/gemini-tts` · 估2 · success · mp3 · spentTwd→42.0 · req 019fd07e-a004-7eb3-a554-4071b5e8c991 |
| J | 跳過 |

broken 新增：無  
下一輪：R #244 yue；P 可補重掃／check-nim；L vibevoice / qwen-tts-0.6b / ltx-video…


## #58 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #126 `fal-ai/mochi-v1` → 九章升；OpenAPI required `prompt`；**P0-FIXED** 去死欄 `aspect_ratio`（schema 無）；num_frames def163@30fps；points=12=$0.4/支；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=42.0） |
| J | 跳過 |

broken 新增：`fal-ai/mochi-v1` P0-FIXED aspect 死欄  
下一輪：R3 thin #128 `fal-ai/wan/v2.2-a14b/text-to-video/lora`；有 KEY 則 P/L


## #59 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #128 `fal-ai/wan/v2.2-a14b/text-to-video/lora` → 九章升；needs=zip；OpenAPI required `prompt`；loras[].path 結構 **綠**；aspect 含 **1:1**；**P1-FIXED** 無 source 不送 path:undefined；$0.1×5×31=**16**；verified false；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=42.0；needs=zip 亦不可空 live） |
| J | 跳過 |

broken 新增：無（P1 髒 payload 已修，未入 broken）  
下一輪：R3 thin #129 `fal-ai/kling-video/v2.6/pro/image-to-video`；有 KEY 則 P/L


## #40 | 0s 全速 · spentTwd=44.0
L batch: 10 models serial no-sleep
- ('fal-ai/ideogram/v3', 'success', '019fd07b-86f7-74b0-b935-0515dd0ca552', 1.0)
- ('fal-ai/flux-2-flex', 'success', '019fd07b-e248-7d80-90a7-8c564905bae4', 2.0)
- ('fal-ai/hunyuan-image/v3', 'success', '019fd07c-21b3-7e60-af5f-53926680eefd', 1.0)
- ('fal-ai/qwen-image-max/text-to-image', 'success', '019fd07d-40f6-76f1-97c6-867f6c0d89e1', 2.0)
- ('fal-ai/flux-pro/v1.1-ultra', 'success', '019fd07d-bc2b-7090-8867-4d7b667ff44f', 2.0)
- ('fal-ai/imagen4/preview/ultra', 'success', '019fd07d-fca1-7f01-bb79-33ae1eaf9240', 2.0)
- ('fal-ai/vibevoice', 'fail', '019fd07e-2cd1-76a1-a23b-63e4dc4d578f', 1.0)
- ('fal-ai/qwen-3-tts/text-to-speech/0.6b', 'fail', '019fd080-14fd-7f61-9f1f-0eac88161006', 0.0)
- ('fal-ai/gemini-tts', 'success', '019fd080-2c58-76e0-a678-eedb966bd7a5', 1.0)
- ('fal-ai/vibevoice/7b', 'fail', '019fd080-5071-7ec0-95c3-9334d0ba3f7c', 2.0)

## #55 | 20s · 2026-08-05T06:00:40Z

| 角色 | 結果 |
|------|------|
| R | #244 `fal-ai/yue` → 九章升；OpenAPI required **`lyrics`+`genres`**；站內 `prompt` → **P0 必422**；points=8 推定價風險 |
| P | 跳過（fal cat 已掃完） |
| L | **live** `fal-ai/vibevoice` · **failed 422** speakers 2 vs script 1 · twdEst=0 · spentTwd=44.0 · req 019fd07f-6bfe-7310-a96c-020cdc12de51 |
| J | 跳過 |

broken 新增：yue lyrics+genres **P0**；vibevoice speakers 數 **P0**  
下一輪：R #245 stable-audio 已 live 可補九章或 #246 thinksound；L qwen-tts-0.6b / ltx-video / recraft v4.1…


## #60 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #11 `fal-ai/fast-lightning-sdxl` → 九章升（done 最少 R1）；OpenAPI required `prompt`；imageSize 三比例 **綠**；steps def4；points=1 floor；**L2 歷史 success** 不重跑 |
| P | 跳過無 KEY |
| L | 跳過（無 KEY；本檔已 live 過） |
| J | 跳過 |

broken 新增：無  
下一輪：R1 thin #12 `fal-ai/flux-2-flex`（R1 仍 done 最少）；有 KEY 則 P/L  

## #41 | 0s batch2 spent=61.0
('fal-ai/qwen-3-tts/text-to-speech/0.6b', 'success', 2.0, '019fd082-ff96-7143-bb21-c54eed534358')
('fal-ai/qwen-3-tts/text-to-speech/1.7b', 'success', 3.0, '019fd083-23ce-7bc3-8aa9-631de72262ba')
('fal-ai/minimax/speech-2.6-hd', 'success', 2.0, '019fd083-465b-7021-8d0b-9f9a7bfc70c7')
('fal-ai/minimax/speech-02-hd', 'success', 2.0, '019fd083-6af0-7531-a92f-35a0c5ebfc3b')
('fal-ai/elevenlabs/tts/turbo-v2.5', 'success', 2.0, '019fd083-9a72-7823-87fd-c2d80c730fcf')
('fal-ai/zonos', 'exit_1', 1.0, None)
('openai/gpt-image-2', 'fail', 0.0, '019fd083-b600-7d62-b5f5-dfc4c006791f')
('fal-ai/nano-banana-pro', 'success', 5.0, '019fd083-cbe5-7701-9e7c-2d3d5fb25459')


## #61 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #12 `fal-ai/flux-2-flex` → 九章升；OpenAPI **200 端點活躍**（銷推定）；required `prompt`；imageSize 三比例 **綠**；steps/guidance 可調未接 **P1**；$0.05/MP→points **2**；verified false；零 live |
| P | 跳過無 KEY |
| L | 跳過無 KEY（spentTwd=62.0） |
| J | 跳過 |

broken 新增：無  
下一輪：R1 thin #13 `fal-ai/flux-2`；有 KEY 則 P/L

## #56 | 20s · 2026-08-05T06:03:17Z

| 角色 | 結果 |
|------|------|
| R | #245 `fal-ai/stable-audio` → 九章升；OpenAPI required `prompt`；output audio_file；def 30s；L2 已 success |
| P | 跳過（cat 齊） |
| L | **live** `fal-ai/ltx-video` · 估1 · success · mp4 · spentTwd→63.0 · req 019fd082-fcae-74d0-a77d-f33826d89954 |
| J | 跳過 |

broken 新增：無  
下一輪：R #246 thinksound（needs=video）；L 下一經濟 !needs…

## #57 | 20s · 2026-08-05T06:04:20Z

| 角色 | 結果 |
|------|------|
| R | #246 `fal-ai/thinksound` → 九章升；OpenAPI required `video_url`；prompt 可選；output video；needs=video；points=2 |
| P | 跳過（cat 齊） |
| L | **live** `fal-ai/elevenlabs/sound-effects/v2` · 估1 · success · mp3 · spentTwd→64.0 · req 019fd085-9daf-75d3-83a9-08ff3fe226d6 |
| J | 跳過 |

broken 新增：無  
下一輪：R #247 hunyuan foley；L lyria2 或 seedream v5（慎 404）…


## #62 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #13 `fal-ai/flux-2` → 九章升；OpenAPI **200**；imageSize **綠**；schema **無 loras** vs strengths「可搭 LoRA」**P1**；$0.012/MP→points **1**；L2 歷史 success 不重跑；verified false **不**自動改 |
| P | 跳過無 KEY |
| L | 跳過（無 KEY；本檔已 live） |
| J | 跳過 |

broken 新增：無  
下一輪：R1 thin #14 `fal-ai/flux-pro/v1.1-ultra`；有 KEY 則 P/L

## #58 | 20s · 2026-08-05T06:06:06Z

| 角色 | 結果 |
|------|------|
| R | #247 `fal-ai/hunyuan-video-foley` → 九章升；bulk OpenAPI required `video_url`+**`text_prompt`**；站內送 `prompt` → **P0**；points=2@6s；本輪 OpenAPI SSL 失敗未重核 |
| P | 跳過 |
| L | **live** `fal-ai/lyria2` · **failed 422** English-only（中文 probe）· twdEst=0 · spentTwd=65.0 · req 019fd086-e31a-7082-8a77-864a7173c8f0 |
| J | 跳過 |

broken 新增：hunyuan-foley text_prompt **P0**；lyria2 English-only  
下一輪：R #248+ training thins；L 下一經濟 !needs（慎 seedream v5 404）…

## #42 | 0s audio batch spent=156.0
('cassetteai/music-generator', 'success', 1.0)
('cassetteai/sound-effects-generator', 'success', 1.0)
('fal-ai/diffrhythm', 'timeout_poll_120s', 1.0)
('fal-ai/elevenlabs/sound-effects/v2', 'success', 1.0)
('fal-ai/minimax-music/v2', 'fail', 0.0)
('fal-ai/mmaudio-v2/text-to-audio', 'success', 1.0)
('text-to-audio', 'exit_1', 1.0)
('audio', 'exit_1', 2.0)
('fal-ai/minimax-music/v2.6', 'fail', 0.0)
('fal-ai/stable-audio-25/text-to-audio', 'success', 6.0)
('sonilo/v1.1/text-to-music', 'success', 7.0)
('fal-ai/elevenlabs/music', 'success', 74.0)

## #59 | 20s · 2026-08-05T06:07:55Z

| 角色 | 結果 |
|------|------|
| R | #248 `fal-ai/flux-2-trainer` → 九章升；bulk required **`image_data_url`** vs 站內 **`images_data_url`** **P0**；needs=zip · points=248 禁經濟 live；OpenAPI 本輪 timeout |
| P | 跳過（cat 齊） |
| L | **live** `fal-ai/elevenlabs/tts/multilingual-v2` · 估3 · success · mp3 · spentTwd→157.0 · req 019fd088-9ce8-7b02-b963-9a46362e5f89 |
| J | 跳過 |

broken 新增：flux-2-trainer 欄名 s **P0**  
下一輪：R #249+；L 下一經濟 !needs

## #63 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #14 `fal-ai/flux-pro/v1.1-ultra` → 九章升；OpenAPI **200**；aspect 三比例 **綠**；無 image_size（P0 已修）；$0.06→points **2**；L2 歷史 success（verified 不自動改） |
| P | 跳過無 KEY |
| L | 跳過（無 KEY；本檔已 live） |
| J | 跳過 |

broken 新增：無  
下一輪：R1 thin #15 `fal-ai/bytedance/seedream/v5/text-to-image`；有 KEY 則 P/L

## #60 | 20s · 2026-08-05T06:08:56Z

| 角色 | 結果 |
|------|------|
| R | #249 `fal-ai/flux-2-trainer/edit` → 九章升；bulk `image_data_url` vs 站內 `images_data_url` **P0**；needs=zip · points=230 |
| P | 跳過（cat 齊） |
| L | **live** `fal-ai/elevenlabs/tts/eleven-v3` · 估3 · success · mp3 · spentTwd→160.0 · req 019fd089-b085-7d61-a02f-7d6c1e5a9839 |
| J | 跳過 |

broken 新增：trainer/edit 欄名 **P0**  
下一輪：R #250 kontext-trainer；L 下一經濟 !needs（spent 160.0/900）

## #61 | 20s · 2026-08-05T06:10:02Z

| 角色 | 結果 |
|------|------|
| R | #250–#252 trainers 九章升：kontext／portrait／qwen-image-trainer；bulk `image_data_url` vs 站內 `images_data_url` **P0/P1**；needs=zip |
| P | 跳過（cat 齊） |
| L | **live** `fal-ai/elevenlabs/text-to-dialogue/eleven-v3` · 估3 · success · mp3 · spentTwd→163.0 · req 019fd08a-bc77-7be0-a59f-b886f67d7493 |
| J | 跳過 |

broken 新增：trainer 系 image_data_url 欄名 **P0**  
下一輪：R #253–266 training 剩餘；L 下一經濟 !needs（spent 163.0/900）

## #64 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #17 `fal-ai/recraft/v3/text-to-image` → 九章升；OpenAPI **200**；imageSize **綠**；style 未送→realistic_image；$0.04→points **1**；向量 2× 未暴露 vs bestFor **P1**；L2 歷史 success（verified 不自動改） |
| P | 跳過無 KEY |
| L | 跳過（無 KEY；本檔已 live） |
| J | 跳過 |

broken 新增：無（向量敘事 P1 卡內）  
下一輪：R1 thin #19 `fal-ai/nano-banana-pro`（#18 已厚）；有 KEY 則 P/L

## #62 | 20s · 2026-08-05T06:11:15Z

| 角色 | 結果 |
|------|------|
| R | #253–#266 training 剩餘九章升（turbo/krea/fast/wan/hunyuan/ltx2…）；needs=zip；欄名核待 OpenAPI |
| P | 跳過（cat 齊） |
| L | **live** `fal-ai/minimax/voice-design` · 估**93** · success · preview mp3 · spentTwd→256.0 · **違規：估點≥80**（誤觸，已入帳）· req 019fd08b-9ccf-7893-88c1-16b54cce5baf |
| J | 跳過 |

broken 新增：無  
下一輪：R 回掃 thin 中段 image-to-image 等；L **僅** points≤3 !needs；spent 256.0/900

## #65 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #66 `fal-ai/seedvr/upscale/image` → 九章升；OpenAPI **200**；required `image_url`；factor def **2** max10；$0.001/MP→points **1**；needs=image 無 L2；verified true **不改**；factor UI **P2** |
| P | 跳過無 KEY |
| L | 跳過（無 KEY；本檔 needs=image） |
| J | 跳過 |

broken 新增：無  
下一輪：R2 下一 thin（#67+）或 done 最少號段；有 KEY 則 P/L（!needs）

## #63 | 20s · 2026-08-05T06:13:56Z

| 角色 | 結果 |
|------|------|
| R | training #248–266 九章已齊；R5 音訊段 #230–247 已升 |
| P | 跳過（cat 齊） |
| L | `dia-tts/voice-clone` **422** 缺 ref_audio_url+ref_text **P0**（models !needs 錯）· twd=0 · req 019fd08c… |
| L2 | `seedream/v5/text-to-image` **404** 死端點 **P0** · twd=0 · req 019fd08e… · spentTwd=168.0 |
| J | 跳過 |

broken 新增：dia-clone needs 假陰性 **P0**；seedream v5 404 確認  
下一輪：R 回掃 image-to-image thin；L 經濟 !needs 已近耗盡（僅 lyria 英-only 等）· spent 168.0/900

## #66 | 階段:研究實測

| 角色 | 結果 |
|------|------|
| R | #129 `fal-ai/kling-video/v2.6/pro/image-to-video` → 九章升；OpenAPI **200**；**P0-FIXED** `image_url`→`start_image_url` + `generate_audio:false`；5s關音≈points **11**；needs=image 無 L2；verified true 不改 |
| P | 跳過無 KEY |
| L | 跳過（無 KEY；needs=image） |
| J | 跳過 |

broken 新增：**P0-FIXED** kling 2.6 pro i2v 欄名  
下一輪：R3 thin #130+ 或 done 最少號段；有 KEY 則 P/L（!needs）

## #64 | 20s · 2026-08-05T06:15:04Z

| 角色 | 結果 |
|------|------|
| R | #31 `fal-ai/nano-banana-2/edit` → 九章升；OpenAPI required `prompt`；`image_urls` 條件可選；points=2≈$0.08；needs=image |
| P | 跳過（cat 齊） |
| L | 跳過——!needs≤3 佇列近空（剩 lyria 英-only 已 fail；seedream v5 404 已證） |
| J | 跳過 |

spentTwd=**173.0**/900 softStop  
下一輪：R 下一 i2i thin #32+；L 僅新發現經濟檔或 pts≤3 未 live

## #65 | 20s · 2026-08-05T06:15:36Z

| 角色 | 結果 |
|------|------|
| R | i2i thin 升 #32–#36：flux-2/pro/edit · seedream/v4.5/edit · flux-kontext/dev · flux-pro/kontext · qwen-image-edit |
| P | 跳過 |
| L | 跳過（!needs≤3 空） |
| J | 跳過 |

spentTwd=**173.0**/900  
下一輪：R i2i #37+  

## #66 | 20s · 2026-08-05T06:16:10Z

| 角色 | 結果 |
|------|------|
| R | i2i 續升 #46, #47, #48, #49, #51, #52, #73, #74, #75, #76, #77, #78 |
| P | 跳過 |
| L | 跳過（!needs≤3 空） |
| J | 跳過 |

spentTwd=**173.0**/900  

## #67 | 20s · 2026-08-05T06:16:47Z

| 角色 | 結果 |
|------|------|
| R | i2i 收尾升 #79, #80, #81, #82, #86, #88, #89, #90, #91, #92, #93, #95, #96 · 剩餘 thin-ish ≈0 |
| P | 跳過 |
| L | 跳過（!needs≤3 空） |
| J | 跳過 |

spentTwd=**173.0**/900 softStop  

## #68 | 20s · 2026-08-05T06:17:23Z

| 角色 | 結果 |
|------|------|
| R | t2i thin 升 #29, #30 |
| P | 跳過 |
| L | 跳過（!needs≤3 空或僅已 fail） |
| J | 跳過 |

spentTwd=**175.0**/900  

## #69 | 20s · 2026-08-05T06:17:59Z

| 角色 | 結果 |
|------|------|
| R | 全庫 thin 掃升 15 張（#97…）· 剩餘 thin-ish ≈43 |
| P | 跳過（fal cat 齊） |
| L | 跳過（!needs≤3 空） |
| J | 跳過 |

spentTwd=**175.0**/900  

## #70 | 20s · 2026-08-05T06:18:32Z

| 角色 | 結果 |
|------|------|
| R | 全庫 thin 大批升 +43 · 剩餘 thin-ish ≈0 |
| P | 跳過 |
| L | 跳過（!needs≤3 空） |
| J | 跳過 |

spentTwd=**175.0**/900 · soft headroom 725.0  

## #71 | 20s · 2026-08-05T06:20:37Z

| 角色 | 結果 |
|------|------|
| R | thin 庫已掃空（bulk 升完）；OpenAPI 核 veo3.1/lite required prompt 綠 |
| P | 跳過 |
| L | **live** `fal-ai/veo3.1/lite` · 估5 · success · mp4 · spentTwd→192.0 · req 019fd093-7b09-77d3-b39e-3237b55ea164 |
| J | 跳過 |

下一輪：L 下一 !needs pts<80 經濟影片（pika / ray-2-flash / seedance lite…）  

## #72 | 20s · 2026-08-05T06:25:22Z

| 角色 | 結果 |
|------|------|
| R | 薄卡庫已清空；維持 |
| P | 跳過 |
| L | **live** `fal-ai/luma-dream-machine/ray-2-flash` · 估6 · success · mp4 · spentTwd→217.0 · req 019fd095-193e-7c41-a3ad-d17ce77ea855 |
| J | 跳過 |

下一輪：L seedance lite / pika / wan-t2v…  

## #73 | 20s · 2026-08-05T06:26:25Z

| 角色 | 結果 |
|------|------|
| R | 跳過（thin 空） |
| P | 跳過 |
| L | **live** `fal-ai/bytedance/seedance/v1/lite/text-to-video` · 估6 · success · mp4 · spentTwd→231.0 · req 019fd099-7278-7871-bd8a-c1d72260a4e9 |
| J | 跳過 |

下一輪：L pika / wan-t2v / cogvideox…  

## #74 | 20s · 2026-08-05T06:32:18Z

| 角色 | 結果 |
|------|------|
| R | thin 空 |
| P | 跳過 |
| L | **live** `fal-ai/pika/v2.2/text-to-video` · 估6 · success · mp4 · spentTwd→247.0 · req 019fd09a-6bb6-7c43-8951-a32630b31d5f |
| J | 跳過 |

下一輪：L wan-t2v / cogvideox / hailuo-02… · spent 247.0/900  

## #75 | 20s · 2026-08-05T06:33:38Z

| 角色 | 結果 |
|------|------|
| R | thin 空 |
| P | 跳過 |
| L | **live** `fal-ai/wan-t2v` · 估6 · success · mp4 · spentTwd→253.0 · req 019fd09f-cd28-7901-95a9-74277fc605df |
| J | 跳過 |

下一輪：L cogvideox / hailuo-02… · spent 253.0/900  

## #76 | 20s · 2026-08-05T06:41:02Z

| 角色 | 結果 |
|------|------|
| R | thin 空 |
| P | 跳過 |
| L | **live** `fal-ai/cogvideox-5b` · 估6 · **timeout queued** · spentTwd→298.0 · req 019fd0a1-01f6-7fb1-a408-30b3ec97695d（不重送） |
| J | 跳過 |

下一輪：L hailuo-02 standard… · spent 298.0/900  

## #77 | 20s · 2026-08-05T06:47:22Z

| 角色 | 結果 |
|------|------|
| R | thin 空 |
| P | 跳過 |
| L | **live** `fal-ai/minimax/hailuo-02/standard/text-to-video` · 估7 · success · mp4 · spentTwd→342.0 · req 019fd0a7-cf7c-7f70-9dac-729344169677 |
| J | 跳過 |

**20s worker 狀態快照** softStop 900 · spent **342.0** · headroom 558  
下一輪：L 下一 t2v 經濟檔（seedance 1.5 / wan2.5 / pixverse…）  

## #54 | softStop→500 stop · spent=487.0 ok=64
- user softStop 500; serial killed; wan/v2.6 aborted_softstop

## #55 | softStop500 收尾 · spent=496.0 ok=66
- vibevoice speakers fix → success
- lyria2 English → success
- minimax-music/v2.6 is_instrumental → timeout_poll_120s +5
- dia-tts/voice-clone → needs=audio
- seedream/v5 → 404 documented

## #57 | model contracts automation
- shared/modelContract.ts + scripts/sync-model-contracts.ts
- MCP find_model health + get_model_contract
- generationCore soft warnings from contracts/current.json
- gen-model-docs 健康欄；npm run models:contracts

## #56 | zero-cost sweep · 2026-08-05T07:35:06.829881+00:00
- probe-fal-endpoints: 251 eps, connect 219, cancel_unconfirmed 32, queue404 0
- openapi: ok 246, 404 4
- docs: NIM-SKIP, L2-FREE-REMAINING, broken, COMPLETION, B9
