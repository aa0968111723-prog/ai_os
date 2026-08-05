# 266 模型審計總表

> 主代理維護。R1–R5 只改自己號段列。

| # | id | category | points | L0 | L1 | L2 live | 建議 | card |
|---|-----|----------|--------|----|----|---------|------|------|
| 1 | `fal-ai/flux-2/pro` | text-to-image | 1 | ok | ⬜ | 未跑 | 維持；L2 後 verified；cost 可補階梯 | [card](cards/fal-ai__flux-2__pro.md) |
| 2 | `fal-ai/qwen-image-2/pro/text-to-image` | text-to-image | 2 | ok | 📄OpenAPI | 未跑 | 維持；L2 後 verified；可選關 prompt_expansion | [card](cards/fal-ai__qwen-image-2__pro__text-to-image.md) |
| 3 | `openai/gpt-image-2` | text-to-image | 5 | ok | 📄OpenAPI | 未跑 | 維持；preset 已修；points=5≈ | [card](cards/openai__gpt-image-2.md) |
| 4 | `fal-ai/bytedance/seedream/v4.5/text-to-image` | text-to-image | 1 | ok | 📄OpenAPI | 未跑 | 維持；L2 後再確認；P1 mechanics | [card](cards/fal-ai__bytedance__seedream__v4.5__text-to-image.md) |
| 5 | `fal-ai/nano-banana-2` | text-to-image | 3 | ok | 📄OpenAPI | 歷史OK(本輪未跑) | 維持；1K預設扁平3≈；seed/4K未暴露 | [card](cards/fal-ai__nano-banana-2.md) |
| 6 | `fal-ai/flux/dev` | text-to-image | 1 | ok | 📄OpenAPI | 歷史OK(本輪未跑) | 維持；recommended+verified；1點≈；字卡勿用 | [card](cards/fal-ai__flux__dev.md) |
| 7 | `fal-ai/ideogram/v3` | text-to-image | 2 | ⚠input | 📄OpenAPI | 未跑 | 修image_size；points=2≈；verified維持false等L2；中文勿主力 | [card](cards/fal-ai__ideogram__v3.md) |
| 8 | `fal-ai/flux/schnell` | text-to-image | 1 | ok | 📄OpenAPI | 歷史OK(本輪未跑) | 維持；verified；1點≈；秒級試方向；T5=256 | [card](cards/fal-ai__flux__schnell.md) |
| 9 | `fal-ai/qwen-image-2/text-to-image` | text-to-image | 1 | ok | 📄OpenAPI | 未跑 | 維持；L2 後 verified；P1 修 quote-card workflow | [card](cards/fal-ai__qwen-image-2__text-to-image.md) |
| 10 | `fal-ai/kolors` | text-to-image | 1 | ok | 📄OpenAPI200 | 歷史OK(budget) | 維持；L2歷史可人工verified | [card](cards/fal-ai__kolors.md) |
| 11 | `fal-ai/fast-lightning-sdxl` | text-to-image | 1 | ok | 📄OpenAPI200 | L2 success | 九章升；required `prompt`；imageSize 三比例 **綠**；steps def4；points=1 floor；$0.001；L2 已成功不重跑 | [card](cards/fal-ai__fast-lightning-sdxl.md) |
| 12 | `fal-ai/flux-2-flex` | text-to-image | 2 | ok | 📄OpenAPI200 | 未跑 | 九章升；端點**活躍**（銷推定）；required `prompt`；imageSize **綠**；steps/guidance 可調未接 **P1**；$0.05/MP→2；verified false | [card](cards/fal-ai__flux-2-flex.md) |
| 13 | `fal-ai/flux-2` | text-to-image | 1 | ok | 📄OpenAPI200 | L2 success | 九章升；端點活躍；imageSize **綠**；schema **無 loras** vs strengths **P1**；$0.012/MP→1；L2 已成功；verified false 不自動改 | [card](cards/fal-ai__flux-2.md) |
| 14 | `fal-ai/flux-pro/v1.1-ultra` | text-to-image | 2 | ok(P0-fixed) | 📄OpenAPI200 | L2 success | 九章升；aspect 三比例 **綠**；無 image_size；$0.06→2；L2 已成功；verified false 不自動改 | [card](cards/fal-ai__flux-pro__v1.1-ultra.md) |
| 15 | `fal-ai/bytedance/seedream/v5/text-to-image` | text-to-image | 2 | ok | 📄OpenAPI | 未跑 | 維持 | [card](cards/fal-ai__bytedance__seedream__v5__text-to-image.md) |
| 16 | `fal-ai/ideogram/v4` | text-to-image | 1 | ok | 📄OpenAPI | 未跑 | 維持 | [card](cards/fal-ai__ideogram__v4.md) |
| 17 | `fal-ai/recraft/v3/text-to-image` | text-to-image | 1 | ok | 📄OpenAPI200 | L2 success | 九章升；imageSize **綠**；style 未送→realistic；$0.04→1；向量2×未暴露 **P1**；verified false 不自動改 | [card](cards/fal-ai__recraft__v3__text-to-image.md) |
| 18 | `fal-ai/recraft/v4.1/text-to-image` | text-to-image | 1 | ok | 📄OpenAPI200 | 未跑 | 維持；image_size✓；無style/neg；points=1≈$0.04 | [card](cards/fal-ai__recraft__v4.1__text-to-image.md) |
| 19 | `fal-ai/nano-banana-pro` | text-to-image | 5 | ok | 📄OpenAPI200 | 未跑 | 維持；aspect_ratio✓；4K cost 加倍注意 | [card](cards/fal-ai__nano-banana-pro.md) |
| 20 | `fal-ai/imagen4/preview/ultra` | text-to-image | 2 | ok | 📄OpenAPI200 | 未跑 | 維持；aspect enum 含站內三比例 | [card](cards/fal-ai__imagen4__preview__ultra.md) |
| 21 | `fal-ai/imagen4/preview/fast` | text-to-image | 1 | ok | 📄OpenAPI200 | 未跑 | 維持 | [card](cards/fal-ai__imagen4__preview__fast.md) |
| 22 | `fal-ai/qwen-image-max/text-to-image` | text-to-image | 2 | ok | 📄OpenAPI200 | 未跑 | 維持；neg+seed✓；prompt max800；expansion預設on；2點≈ | [card](cards/fal-ai__qwen-image-max__text-to-image.md) |
| 23 | `fal-ai/hunyuan-image/v3` | text-to-image | 3 | ⚠404→endpoint fixed | 📄OpenAPI200(真path) | 未跑 | P0-FIXED endpoint…/text-to-image；runtime3≈；P1加neg allowlist | [card](cards/fal-ai__hunyuan-image__v3.md) |
| 24 | `fal-ai/sana` | text-to-image | 1 | ok | 📄OpenAPI200 | 歷史OK(budget) | 維持；防4K default用preset | [card](cards/fal-ai__sana.md) |
| 25 | `fal-ai/playground-v25` | text-to-image | 1 | ok | 📄OpenAPI200 | 歷史OK(budget) | 維持 | [card](cards/fal-ai__playground-v25.md) |
| 26 | `fal-ai/luma-photon` | text-to-image | 1 | ok | 📄OpenAPI200 | 未跑 | 維持；aspect_ratio 非 image_size | [card](cards/fal-ai__luma-photon.md) |
| 27 | `fal-ai/aura-flow` | text-to-image | 1 | ⚠input→fixed | 📄OpenAPI200 | 未跑(歷史timeout?) | 已去 image_size；維持 points=1 | [card](cards/fal-ai__aura-flow.md) |
| 28 | `fal-ai/flux-lora` | text-to-image | 1 | ok | 📄OpenAPI200 | 未跑(needs) | 維持loras✓；P1 neg allowlist≠schema；1點≈$0.035/MP | [card](cards/fal-ai__flux-lora.md) |
| 29 | `fal-ai/flux-2/lora` | text-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__flux-2__lora.md) |
| 30 | `fal-ai/lora` | text-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__lora.md) |
| 31 | `fal-ai/nano-banana-2/edit` | image-to-image | 2 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__nano-banana-2__edit.md) |
| 32 | `fal-ai/flux-2/pro/edit` | image-to-image | 1 | ❌404 | 📄404 | 未跑(needs) | **P0：端點 404** — 需找真 path 或下架 | [card](cards/fal-ai__flux-2__pro__edit.md) |
| 33 | `fal-ai/bytedance/seedream/v4.5/edit` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__bytedance__seedream__v4.5__edit.md) |
| 34 | `fal-ai/flux-kontext/dev` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__flux-kontext__dev.md) |
| 35 | `fal-ai/flux-pro/kontext` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__flux-pro__kontext.md) |
| 36 | `fal-ai/qwen-image-edit` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__qwen-image-edit.md) |
| 37 | `fal-ai/qwen-image-edit-plus` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__qwen-image-edit-plus.md) |
| 38 | `fal-ai/flux/dev/image-to-image` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持；R九章；rec；strength=0.85 vs default0.95；SEED有/NEG無；verified目錄true不改 | [card](cards/fal-ai__flux__dev__image-to-image.md) |
| 39 | `fal-ai/fast-sdxl/image-to-image` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__fast-sdxl__image-to-image.md) |
| 40 | `fal-ai/flux-pro/kontext/max` | image-to-image | 2 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__flux-pro__kontext__max.md) |
| 41 | `fal-ai/nano-banana-pro/edit` | image-to-image | 5 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__nano-banana-pro__edit.md) |
| 42 | `fal-ai/nano-banana/edit` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__nano-banana__edit.md) |
| 43 | `fal-ai/bytedance/seedream/v4/edit` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__bytedance__seedream__v4__edit.md) |
| 44 | `fal-ai/bytedance/seededit/v3/edit-image` | image-to-image | 1 | ⚠OpenAPI 000 | 📄000 | 未跑(needs) | OpenAPI 000 處理 | [card](cards/fal-ai__bytedance__seededit__v3__edit-image.md) |
| 45 | `fal-ai/qwen-image-2/edit` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__qwen-image-2__edit.md) |
| 46 | `openai/gpt-image-2/edit` | image-to-image | 5 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/openai__gpt-image-2__edit.md) |
| 47 | `fal-ai/ideogram/v3/remix` | image-to-image | 2 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__ideogram__v3__remix.md) |
| 48 | `fal-ai/flux/dev/redux` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__flux__dev__redux.md) |
| 49 | `fal-ai/iclight-v2` | image-to-image | 3 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__iclight-v2.md) |
| 50 | `fal-ai/bria/background/replace` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | **已修 input** `prompt`（非 bg_prompt）；P0；verified 維持 true | [card](cards/fal-ai__bria__background__replace.md) |
| 51 | `fal-ai/bria/background/remove` | image-to-image | 1 | ⚠OpenAPI 000 | 📄000 | 未跑(needs) | OpenAPI 000 處理 | [card](cards/fal-ai__bria__background__remove.md) |
| 52 | `fal-ai/bria/expand` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__bria__expand.md) |
| 53 | `fal-ai/image-editing/object-removal` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持；R九章；input image_url+prompt✓；verified=false；無P0 | [card](cards/fal-ai__image-editing__object-removal.md) |
| 54 | `fal-ai/bria/product-shot` | image-to-image | 1 | ✅ | 📄OpenAPI | 未跑(needs) | 維持 | [card](cards/fal-ai__bria__product-shot.md) |
| 55 | `fal-ai/codeformer` | image-to-image | 1 | ✅ | 📄OpenAPI | 未跑(needs) | 維持 | [card](cards/fal-ai__codeformer.md) |
| 56 | `fal-ai/image-editing/photo-restoration` | image-to-image | 1 | ok | 📄OpenAPI | 未跑(needs) | 維持；免 prompt；aspect 未映射 P3 | [card](cards/fal-ai__image-editing__photo-restoration.md) |
| 57 | `fal-ai/image-apps-v2/photo-restoration` | image-to-image | 1 | ok | 📄OpenAPI | 未跑(needs) | 維持 verified=false；價推定待對帳；三開關未暴露 | [card](cards/fal-ai__image-apps-v2__photo-restoration.md) |
| 58 | `fal-ai/esrgan` | image-to-image | 1 | ok | 📄OpenAPI | 未跑(needs) | 維持；face≠face_enhance；預設scale=2；價算秒待對帳 | [card](cards/fal-ai__esrgan.md) |
| 59 | `fal-ai/ddcolor` | image-to-image | 1 | ok | 📄OpenAPI | 未跑(needs) | 維持；sc-colorize 主選；$0.001/MP≈1 | [card](cards/fal-ai__ddcolor.md) |
| 60 | `fal-ai/clarity-upscaler` | image-to-image | 1 | ok | 📄OpenAPI | 未跑(needs) | **建議調 points→4或8**；creativity=0.35✅；4K實價~$0.24 | [card](cards/fal-ai__clarity-upscaler.md) |
| 61 | `fal-ai/topaz/upscale/image` | image-to-image | 2 | ok | 📄OpenAPI | 未跑(needs) | 維持；ready-static-only；≤24MP $0.08→2≈；高階梯風險 | [card](cards/fal-ai__topaz__upscale__image.md) |
| 62 | `fal-ai/aura-sr` | image-to-image | 2 | ok | 📄OpenAPI | 未跑(needs) | 維持；image_url✓；4×固定；checkpoint 預設v1；points=2 人工 | [card](cards/fal-ai__aura-sr.md) |
| 63 | `fal-ai/ccsr` | image-to-image | 2 | ok | 📄OpenAPI | 未跑(needs) | 維持；ready-static-only；價算秒/MP未鎖；points=2人工；scale預設2；seed未暴露 | [card](cards/fal-ai__ccsr.md) |
| 64 | `fal-ai/supir` | image-to-image | 3 | ok | 📄OpenAPI | 未跑(needs) | 維持；image_url✓；生成式字卡勿用；points=3價未知；verified=false | [card](cards/fal-ai__supir.md) |
| 65 | `fal-ai/thera` | image-to-image | 1 | ⚠input→fixed | 📄OpenAPI200 | 未跑(needs) | 已修backbone=edsr；points=1≈ | [card](cards/fal-ai__thera.md) |
| 66 | `fal-ai/seedvr/upscale/image` | image-to-image | 1 | ok | 📄OpenAPI200 | 未跑(needs) | 九章升；required image_url；factor def2 max10；$0.001/MP→1；factor UI **P2**；verified true 維持 | [card](cards/fal-ai__seedvr__upscale__image.md) |
| 67 | `clarityai/crystal-upscaler` | image-to-image | 1 | ok | 📄OpenAPI200 | 未跑(needs) | 維持；ready-static-only；**建議points→2或4**（4K≈4，本回合不改）；input✓；sc-portrait主選 | [card](cards/clarityai__crystal-upscaler.md) |
| 68 | `fal-ai/recraft/upscale/crisp` | image-to-image | 1 | ok | 📄OpenAPI200 | 未跑(needs) | 維持 | [card](cards/fal-ai__recraft__upscale__crisp.md) |
| 69 | `fal-ai/recraft/upscale/creative` | image-to-image | 8 | ok | 📄OpenAPI200 | 未跑(needs) | 維持；8≈$0.25；PNG約束P2；無P0 | [card](cards/fal-ai__recraft__upscale__creative.md) |
| 70 | `fal-ai/swin2sr` | image-to-image | 1 | ok | 📄OpenAPI200 | 未跑(needs) | 維持 | [card](cards/fal-ai__swin2sr.md) |
| 71 | `fal-ai/drct-super-resolution` | image-to-image | 1 | ok | 📄OpenAPI200 | 未跑(needs) | 維持；const4×；input✓；大源MP略低估P2 | [card](cards/fal-ai__drct-super-resolution.md) |
| 72 | `fal-ai/creative-upscaler` | image-to-image | 1 | ok | 📄OpenAPI200 | 未跑(needs) | 維持；verified=false；備援Clarity；算秒需人工；無P0 | [card](cards/fal-ai__creative-upscaler.md) |
| 73 | `fal-ai/mix-dehaze-net` | image-to-image | 1 | ❌404 | 📄404 | 未跑(needs) | 404 修endpoint/下架 | [card](cards/fal-ai__mix-dehaze-net.md) |
| 74 | `fal-ai/birefnet/v2` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__birefnet__v2.md) |
| 75 | `fal-ai/birefnet` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__birefnet.md) |
| 76 | `fal-ai/ideogram/remove-background` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__ideogram__remove-background.md) |
| 77 | `pixelcut/background-removal` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/pixelcut__background-removal.md) |
| 78 | `fal-ai/imageutils/rembg` | image-to-image | 1 | ⚠000 | 📄000 | 未跑(needs) | OpenAPI 000 | [card](cards/fal-ai__imageutils__rembg.md) |
| 79 | `fal-ai/ben/v2/image` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__ben__v2__image.md) |
| 80 | `smoretalk-ai/rembg-enhance` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/smoretalk-ai__rembg-enhance.md) |
| 81 | `fal-ai/ideogram/v3/replace-background` | image-to-image | 2 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__ideogram__v3__replace-background.md) |
| 82 | `fal-ai/image-editing/background-change` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__image-editing__background-change.md) |
| 83 | `fal-ai/ideogram/character` | image-to-image | 3 | ok | 📄OpenAPI200 | 未跑(needs) | **已修 input** `reference_image_urls[]`+image_size；P1 default BALANCED≈5 vs 扁平3(turbo)；verified 維持 true | [card](cards/fal-ai__ideogram__character.md) |
| 84 | `fal-ai/instant-character` | image-to-image | 3 | ok | 📄200 | 未跑(needs) | 維持；R九章；prompt+image_url✓；P1 image_size 未映射；無P0 | [card](cards/fal-ai__instant-character.md) |
| 85 | `fal-ai/flux-pulid` | image-to-image | 1 | ok | 📄OpenAPI200 | 未跑(needs) | **已修 input** `reference_image_url`+image_size；1≈$0.0333/MP；verified 維持 true | [card](cards/fal-ai__flux-pulid.md) |
| 86 | `fal-ai/instantid` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__instantid.md) |
| 87 | `fal-ai/photomaker` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | **已修 input** `image_archive_url`+needs=zip；P0；verified 維持 true | [card](cards/fal-ai__photomaker.md) |
| 88 | `fal-ai/face-to-sticker` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__face-to-sticker.md) |
| 89 | `fal-ai/qwen-image-edit-plus-lora-gallery/next-scene` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__qwen-image-edit-plus-lora-gallery__next-scene.md) |
| 90 | `fal-ai/minimax/image-01/subject-reference` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__minimax__image-01__subject-reference.md) |
| 91 | `fal-ai/image-editing/expression-change` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__image-editing__expression-change.md) |
| 92 | `easel-ai/easel-avatar` | image-to-image | 2 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/easel-ai__easel-avatar.md) |
| 93 | `fal-ai/image-apps-v2/headshot-photo` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__image-apps-v2__headshot-photo.md) |
| 94 | `fal-ai/finegrain-eraser` | image-to-image | 6 | ok | 📄OpenAPI200 | 未跑(needs) | 維持；input image_url+prompt✓；6≈$0.18 standard；P1 cost 文案 bbox/mask vs mode三檔；無P0 | [card](cards/fal-ai__finegrain-eraser.md) |
| 95 | `fal-ai/recraft/vectorize` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__recraft__vectorize.md) |
| 96 | `fal-ai/image2svg` | image-to-image | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__image2svg.md) |
| 97 | `fal-ai/veo3.1` | text-to-video | 31 | ok | 📄200 | 未跑 | 維持 | [card](cards/fal-ai__veo3.1.md) |
| 98 | `fal-ai/sora-2/text-to-video` | text-to-video | 16 | ok | 📄200 | 未跑 | 維持 | [card](cards/fal-ai__sora-2__text-to-video.md) |
| 99 | `fal-ai/kling-video/v2.5-turbo/pro/text-to-video` | text-to-video | 11 | ok | 📄200 | 未跑 | 維持 | [card](cards/fal-ai__kling-video__v2.5-turbo__pro__text-to-video.md) |
| 100 | `fal-ai/veo3.1/fast` | text-to-video | 16 | ok | 📄200 | 未跑 | 維持 | [card](cards/fal-ai__veo3.1__fast.md) |
| 101 | `fal-ai/wan/v2.2-a14b/text-to-video` | text-to-video | 12 | ok | 📄200 | 未跑 | 維持；R九章；rec；720p×~5s≈12點；NEG+SEED allowlist；verified不改 | [card](cards/fal-ai__wan__v2.2-a14b__text-to-video.md) |
| 102 | `fal-ai/minimax/hailuo-2.3/standard/text-to-video` | text-to-video | 9 | ok | 📄200 | 未跑 | 維持 | [card](cards/fal-ai__minimax__hailuo-2.3__standard__text-to-video.md) |
| 103 | `fal-ai/ltx-video` | text-to-video | 1 | ok | 📄200 | 未跑 | **已修 input** 去 aspect_ratio；P0；R九章；初代≠LTX-2.3(P1文案) | [card](cards/fal-ai__ltx-video.md) |
| 104 | `fal-ai/veo2` | text-to-video | 78 | ok | 📄200 | 未跑 | 維持 | [card](cards/fal-ai__veo2.md) |
| 105 | `fal-ai/kling-video/v2.6/pro/text-to-video` | text-to-video | 11 | ok | 📄200 | 未跑 | 維持 | [card](cards/fal-ai__kling-video__v2.6__pro__text-to-video.md) |
| 106 | `fal-ai/kling-video/o3/pro/text-to-video` | text-to-video | 17 | ok | 📄200 | 未跑 | 維持 | [card](cards/fal-ai__kling-video__o3__pro__text-to-video.md) |
| 107 | `fal-ai/minimax/hailuo-2.3/pro/text-to-video` | text-to-video | 15 | ✅ | 📄 | 未跑 | 維持（可選去 aspect_ratio） | [card](cards/fal-ai__minimax__hailuo-2.3__pro__text-to-video.md) |
| 108 | `fal-ai/luma-dream-machine/ray-2` | text-to-video | 16 | ✅ | 📄 | 未跑 | 維持（P2: 1:1 enum；預設 540p） | [card](cards/fal-ai__luma-dream-machine__ray-2.md) |
| 109 | `fal-ai/bytedance/seedance/v1/pro/text-to-video` | text-to-video | 19 | ✅ | 📄 | 未跑 | 維持（可選 SEED allowlist；長秒須聯動估點） | [card](cards/fal-ai__bytedance__seedance__v1__pro__text-to-video.md) |
| 110 | `fal-ai/bytedance/seedance/v1.5/pro/text-to-video` | text-to-video | 8 | ✅ | 📄 | 未跑 | 維持（可選 SEED；sc-t2v-sound 可納；長秒/1080p 須聯動估點） | [card](cards/fal-ai__bytedance__seedance__v1.5__pro__text-to-video.md) |
| 111 | `bytedance/seedance-2.0/text-to-video` | text-to-video | 47 | ok | 📄OpenAPI | 未跑 | 維持；OpenAPI200；P0 duration=auto vs 扁平47；cost 6s文案債(實5s)；含音免費；禁4k裸開 | [card](cards/bytedance__seedance-2.0__text-to-video.md) |
| 112 | `fal-ai/veo3.1/lite` | text-to-video | 5 | ok | 📄OpenAPI | 未跑 | **已修** 1:1→16:9 防422；P0 預設8s+含音≈12 vs 扁平5；verified 維持 true | [card](cards/fal-ai__veo3.1__lite.md) |
| 113 | `fal-ai/minimax/hailuo-02/standard/text-to-video` | text-to-video | 7 | ok | 📄OpenAPI200 | 未跑 | 九章升；required `prompt`；duration 6/10 def6；**P1** schema 無 `aspect_ratio`（站內仍送）；points=7≈5s×$0.045 機械；verified 不改 | [card](cards/fal-ai__minimax__hailuo-02__standard__text-to-video.md) |
| 114 | `fal-ai/minimax/video-01-director` | text-to-video | 16 | ok | 📄OpenAPI | 未跑 | 維持；$0.5/支≈16；運鏡靠 prompt [ ]；aspect 死欄 | [card](cards/fal-ai__minimax__video-01-director.md) |
| 115 | `fal-ai/wan/v2.5/text-to-video` | text-to-video | 8 | ok | 📄OpenAPI | 未跑 | **已修 endpoint**→`wan-25`；P0 預設1080p≈23 vs 扁平8；aspect三比例健康；原生音待live | [card](cards/fal-ai__wan__v2.5__text-to-video.md) |
| 116 | `fal-ai/wan/v2.6/text-to-video` | text-to-video | 16 | ok | 📄OpenAPI | 未跑 | **已修 endpoint**→`wan/v2.6`（非 wan-26／非 …/text-to-video）；P0 預設1080p≈23 vs 扁平16@720p；seed allowlist；aspect 綠；零 live | [card](cards/fal-ai__wan__v2.6__text-to-video.md) |
| 117 | `fal-ai/hunyuan-video-v1.5/text-to-video` | text-to-video | 12 | ok | 📄OpenAPI200 | 未跑 | **已修** 1:1→16:9 防422；鎖480p／121幀；12≈5s@$0.075（P1 cost「6s」文案→若真6s≈14）；seed allowlist 可選；verified 維持 true | [card](cards/fal-ai__hunyuan-video-v1.5__text-to-video.md) |
| 118 | `fal-ai/pika/v2.2/text-to-video` | text-to-video | 6 | ok | 📄OpenAPI200 | 未跑 | 九章升；required `prompt`；aspect 含1:1 **綠**；def 720p/5s→$0.2→runtime **6**（字面10覆寫）；零 live | [card](cards/fal-ai__pika__v2.2__text-to-video.md) |
| 119 | `fal-ai/luma-dream-machine/ray-2-flash` | text-to-video | 6 | ok | 📄OpenAPI200 | 未跑 | **已修** 1:1→16:9 防422；預設540p/5s≈6@$0.2；P3 cost倍率文案 | [card](cards/fal-ai__luma-dream-machine__ray-2-flash.md) |
| 120 | `fal-ai/bytedance/seedance/v1/lite/text-to-video` | text-to-video | 6 | ok | 📄OpenAPI200 | 未跑 | 維持；**deprecated→pro fast**；aspect含1:1；P0計費可能≠$0.18 | [card](cards/fal-ai__bytedance__seedance__v1__lite__text-to-video.md) |
| 121 | `fal-ai/pixverse/v5.5/text-to-video` | text-to-video | 9 | ok | 📄OpenAPI200 | 未跑 | 九章升；required `prompt`；aspect 含1:1/9:16 **綠**；def 720p/5/無音；parseRealCost 失敗→手填9；cost缺720p **P2** | [card](cards/fal-ai__pixverse__v5.5__text-to-video.md) |
| 122 | `fal-ai/pixverse/v6/text-to-video` | text-to-video | 14 | ok | 📄OpenAPI200 | 未跑 | 維持；endpoint確認；1:1合法；P1 預設720p無音vs14點@1080p錨／bestFor有音未開 | [card](cards/fal-ai__pixverse__v6__text-to-video.md) |
| 123 | `fal-ai/kling-video/v1.6/standard/text-to-video` | text-to-video | 9 | ok | 📄OpenAPI200 | 未跑 | 九章升；required `prompt`；aspect 16:9/9:16/1:1 **全綠**；站內 duration=`"5"` 對齊 $0.056×5×31=9；cost「6秒」文案 **P2** | [card](cards/fal-ai__kling-video__v1.6__standard__text-to-video.md) |
| 124 | `fal-ai/wan-t2v` | text-to-video | 6 | ok | 📄OpenAPI200 | 未跑 | 九章升；**P0-FIXED** 1:1→16:9（schema 僅16:9/9:16）；def **720p** vs cost 480p **P2**；備援 v2.1/1.3b slug **404**；points=6 | [card](cards/fal-ai__wan-t2v.md) |
| 125 | `fal-ai/hunyuan-video` | text-to-video | 12 | ok | 📄OpenAPI200 | 未跑 | **已修** 1:1→16:9；neg allowlist 移除(schema無)；12≈$0.40/支；預設720p/129幀；verified 維持 true | [card](cards/fal-ai__hunyuan-video.md) |
| 126 | `fal-ai/mochi-v1` | text-to-video | 12 | ok | 📄OpenAPI200 | 未跑 | 九章升；**P0-FIXED** 去死欄 `aspect_ratio`（schema 無）；required `prompt`；num_frames def163@30fps；points=12=$0.4/支 | [card](cards/fal-ai__mochi-v1.md) |
| 127 | `fal-ai/cogvideox-5b` | text-to-video | 6 | ok | 📄OpenAPI200 | 未跑 | **已修 input** video_size(非aspect_ratio)；6≈$0.2/支；negative✓；verified 維持 true | [card](cards/fal-ai__cogvideox-5b.md) |
| 128 | `fal-ai/wan/v2.2-a14b/text-to-video/lora` | text-to-video | 16 | ok | 📄OpenAPI200 | 未跑 | 九章升；needs=zip；loras[].path **綠**；aspect 含1:1；**P1-FIXED** 無 source 不送 path:undefined；$0.1×5×31=16；verified false | [card](cards/fal-ai__wan__v2.2-a14b__text-to-video__lora.md) |
| 129 | `fal-ai/kling-video/v2.6/pro/image-to-video` | image-to-video | 11 | **P0-FIXED** | 📄OpenAPI200 | 未跑(needs) | 九章升；`image_url`→`start_image_url`；`generate_audio:false`；5s關音≈11；verified true 不改 | [card](cards/fal-ai__kling-video__v2.6__pro__image-to-video.md) |
| 130 | `fal-ai/kling-video/v2.5-turbo/pro/image-to-video` | image-to-video | 11 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__kling-video__v2.5-turbo__pro__image-to-video.md) |
| 131 | `fal-ai/kling-video/v3/pro/image-to-video` | image-to-video | 17 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__kling-video__v3__pro__image-to-video.md) |
| 132 | `fal-ai/veo3.1/image-to-video` | image-to-video | 31 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__veo3.1__image-to-video.md) |
| 133 | `fal-ai/veo2/image-to-video` | image-to-video | 78 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__veo2__image-to-video.md) |
| 134 | `fal-ai/minimax/hailuo-2.3/pro/image-to-video` | image-to-video | 15 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__minimax__hailuo-2.3__pro__image-to-video.md) |
| 135 | `fal-ai/bytedance/seedance/v1.5/pro/image-to-video` | image-to-video | 8 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__bytedance__seedance__v1.5__pro__image-to-video.md) |
| 136 | `fal-ai/luma-dream-machine/ray-2/image-to-video` | image-to-video | 16 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__luma-dream-machine__ray-2__image-to-video.md) |
| 137 | `wan/v2.6/image-to-video` | image-to-video | 8 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/wan__v2.6__image-to-video.md) |
| 138 | `fal-ai/wan/v2.2-a14b/image-to-video` | image-to-video | 6 | ok | 📄200 | 未跑(needs) | 維持；R九章；rec；**P0帳單** default720p vs 6點/480p校準（建議鎖480p或升12）；SEED未入allowlist；verified不改 | [card](cards/fal-ai__wan__v2.2-a14b__image-to-video.md) |
| 139 | `fal-ai/minimax/hailuo-2.3/standard/image-to-video` | image-to-video | 9 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__minimax__hailuo-2.3__standard__image-to-video.md) |
| 140 | `fal-ai/minimax/hailuo-2.3-fast/pro/image-to-video` | image-to-video | 10 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__minimax__hailuo-2.3-fast__pro__image-to-video.md) |
| 141 | `fal-ai/bytedance/seedance/v1/lite/image-to-video` | image-to-video | 6 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__bytedance__seedance__v1__lite__image-to-video.md) |
| 142 | `fal-ai/luma-dream-machine/ray-2-flash/image-to-video` | image-to-video | 6 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__luma-dream-machine__ray-2-flash__image-to-video.md) |
| 143 | `fal-ai/hunyuan-video-image-to-video` | image-to-video | 12 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__hunyuan-video-image-to-video.md) |
| 144 | `fal-ai/pixverse/v5/image-to-video` | image-to-video | 9 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__pixverse__v5__image-to-video.md) |
| 145 | `fal-ai/runway-gen3/turbo/image-to-video` | image-to-video | 12 | ❌404 | 📄404 | 未跑(needs) | 404修endpoint | [card](cards/fal-ai__runway-gen3__turbo__image-to-video.md) |
| 146 | `fal-ai/minimax/video-01/image-to-video` | image-to-video | 16 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__minimax__video-01__image-to-video.md) |
| 147 | `fal-ai/minimax/video-01-subject-reference` | image-to-video | 16 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__minimax__video-01-subject-reference.md) |
| 148 | `fal-ai/wan-i2v` | image-to-video | 9 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__wan-i2v.md) |
| 149 | `fal-ai/ltx-video-v095/image-to-video` | image-to-video | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__ltx-video-v095__image-to-video.md) |
| 150 | `fal-ai/framepack` | image-to-video | 5 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__framepack.md) |
| 151 | `fal-ai/stable-video` | image-to-video | 2 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__stable-video.md) |
| 152 | `fal-ai/fast-svd-lcm` | image-to-video | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__fast-svd-lcm.md) |
| 153 | `fal-ai/topaz/upscale/video` | video-to-video | 7 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__topaz__upscale__video.md) |
| 154 | `fal-ai/sync-lipsync/v2/pro` | video-to-video | 155 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__sync-lipsync__v2__pro.md) |
| 155 | `fal-ai/luma-dream-machine/ray-2/modify` | video-to-video | 16 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__luma-dream-machine__ray-2__modify.md) |
| 156 | `fal-ai/luma-dream-machine/ray-2-flash/modify` | video-to-video | 8 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__luma-dream-machine__ray-2-flash__modify.md) |
| 157 | `fal-ai/sync-lipsync` | video-to-video | 22 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__sync-lipsync.md) |
| 158 | `fal-ai/video-upscaler` | video-to-video | 16 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__video-upscaler.md) |
| 159 | `fal-ai/bria/video/background-removal` | video-to-video | 16 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__bria__video__background-removal.md) |
| 160 | `fal-ai/rife/video` | video-to-video | 2 | ✅ | 📄 | 未跑 | 維持 | [card](cards/fal-ai__rife__video.md) |
| 161 | `fal-ai/sync-lipsync/v3` | video-to-video | 248 | ✅ | 📄 | 未跑 | B9 points 155→248 cost $8/分 | [card](cards/fal-ai__sync-lipsync__v3.md) |
| 162 | `fal-ai/sync-lipsync/v2` | video-to-video | 93 | ✅ | 📄 | 未跑 | 維持（$3/分＝93 已對齊） | [card](cards/fal-ai__sync-lipsync__v2.md) |
| 163 | `decart/lucy-restyle` | video-to-video | 19 | ok | 📄OpenAPI | 未跑(needs) | 維持 verified=false；P0 長片估點低估；720p only | [card](cards/decart__lucy-restyle.md) |
| 164 | `fal-ai/seedvr/upscale/video` | video-to-video | 12 | ok | 📄OpenAPI | 未跑 | 維持 | [card](cards/fal-ai__seedvr__upscale__video.md) |
| 165 | `fal-ai/ben/v2/video` | video-to-video | 5 | ✅ | 📄OpenAPI | 未跑 | 維持（5≈6s720p30；預設mp4無alpha；文案勿寫全場最便宜） | [card](cards/fal-ai__ben__v2__video.md) |
| 166 | `veed/lipsync` | video-to-video | 12 | ✅ | 📄OpenAPI | 未跑 | 維持（$0.4/分＝12 已對齊） | [card](cards/veed__lipsync.md) |
| 167 | `veed/video-background-removal` | video-to-video | 4 | ✅ | 📄OpenAPI | 未跑 | **extract video[] 已修**；4≈6s@上限 refine；ready-static-only | [card](cards/veed__video-background-removal.md) |
| 168 | `decart/lucy-edit` | video-to-video | 16 | ok | 📄OpenAPI(fast/pro) | 未跑(needs) | **已修 endpoint**→`…/fast`；裸id404；P0扁平16 vs 按秒；verified=false | [card](cards/decart__lucy-edit.md) |
| 169 | `fal-ai/wan-vace-14b/outpainting` | video-to-video | 9 | ✅ | 📄OpenAPI | 未跑(needs) | **P0 修 input**（expand_* 預設 false 不擴邊；幀~5s）；9≈mid×5s；ready-static-only | [card](cards/fal-ai__wan-vace-14b__outpainting.md) |
| 170 | `fal-ai/latentsync` | video-to-video | 6 | ok | 📄OpenAPI200 | 未跑(needs×2) | 維持；契約OK points=6≈ | [card](cards/fal-ai__latentsync.md) |
| 171 | `fal-ai/musetalk` | video-to-video | 5 | ⚠input→fixed | 📄OpenAPI200 | 未跑(needs×2) | 已修 source_video_url | [card](cards/fal-ai__musetalk.md) |
| 172 | `bria/video/background-removal/v3` | video-to-video | 3 | ok | 📄OpenAPI200 | 未跑(needs) | 維持 points=3（實價6s≈1有緩衝）；cost$0.0042/s；預設Black+webm_vp9；P1 Transparent | [card](cards/bria__video__background-removal__v3.md) |
| 173 | `bria/video/background-removal/realtime` | video-to-video | 1 | ⚠input→fixed | 📄OpenAPI | 未跑(needs) | **已修** endpoint→batch base（裸realtime=WebRTC）；1≈6s@$0.0042 | [card](cards/bria__video__background-removal__realtime.md) |
| 174 | `veed/video-background-removal/fast` | video-to-video | 2 | ok | 📄OpenAPI | 未跑(needs) | 維持；2≈6s@上限；extract video[] 已修 | [card](cards/veed__video-background-removal__fast.md) |
| 175 | `veed/video-background-removal/green-screen` | video-to-video | 5 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/veed__video-background-removal__green-screen.md) |
| 176 | `fal-ai/birefnet/v2/video` | video-to-video | 2 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__birefnet__v2__video.md) |
| 177 | `fal-ai/auto-caption` | video-to-video | 2 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__auto-caption.md) |
| 178 | `fal-ai/workflow-utilities/auto-subtitle` | video-to-video | 2 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__workflow-utilities__auto-subtitle.md) |
| 179 | `veed/subtitles` | video-to-video | 3 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/veed__subtitles.md) |
| 180 | `fal-ai/bria/video/eraser` | video-to-video | 22 | ❌404 | 📄404 | 未跑(needs) | 404修endpoint | [card](cards/fal-ai__bria__video__eraser.md) |
| 181 | `nvidia-nim#deepseek-r1` | llm | 0 | ok | NIM | 未跑 | 維持；非fal；model=`deepseek-ai/deepseek-r1`；**P0** 顯示0 vs 估點floor1；verified=false | [card](cards/nvidia-nim__deepseek-r1.md) |
| 182 | `nvidia-nim#llama-3.1-405b` | llm | 0 | ok | NIM | 未跑 | 維持；非fal；model=`meta/llama-3.1-405b-instruct`；workflow潤飾步；**P0** 顯示0 vs 估點floor1；verified=false | [card](cards/nvidia-nim__llama-3.1-405b.md) |
| 183 | `nvidia-nim#nemotron-4-340b` | llm | 0 | ok | NIM | 未跑 | 維持；非fal；model=`nvidia/nemotron-4-340b-instruct`；**P0** 顯示0 vs 估點floor1；verified=false | [card](cards/nvidia-nim__nemotron-4-340b.md) |
| 184 | `nvidia-nim#llama-3.1-70b` | llm | 0 | ok | NIM | 未跑 | 維持；**NIM_DEFAULT_MODEL**；model=`meta/llama-3.1-70b-instruct`；recommended；**P0** 顯示0 vs 估點floor1；verified=false | [card](cards/nvidia-nim__llama-3.1-70b.md) |
| 185 | `nvidia-nim#qwen2.5-72b` | llm | 0 | ok | NIM | 未跑 | 維持；非fal；model=`qwen/qwen2.5-72b-instruct`；中文金句winner；**P0** 顯示0 vs 估點floor1；verified=false | [card](cards/nvidia-nim__qwen2.5-72b.md) |
| 186 | `nvidia-nim#mistral-large-2` | llm | 0 | ok | NIM | 未跑 | 維持；非fal；model=`mistralai/mistral-large-2-instruct`；多語/翻譯；**P0** 顯示0 vs 估點floor1；verified=false | [card](cards/nvidia-nim__mistral-large-2.md) |
| 187 | `nvidia-nim#llama-3.1-8b` | llm | 0 | ok | NIM | 未跑 | 維持；非fal；model=`meta/llama-3.1-8b-instruct`；budget；checkNimStatus；**P0** 顯示0 vs 估點floor1；verified=false | [card](cards/nvidia-nim__llama-3.1-8b.md) |
| 188 | `fal-ai/any-llm/vision#gemini-2.5-pro` | vision | 1 | ok | 📄200 | 未跑(needs) | 維持；正名；endpoint=`any-llm/vision` model=`google/gemini-2.5-pro`；**P1** image_url vs image_urls；verified 目錄 true 不改 | [card](cards/fal-ai__any-llm__vision__gemini-2.5-pro.md) |
| 189 | `fal-ai/any-llm/vision#claude-sonnet-4.5` | vision | 1 | ok | 📄200 | 未跑(needs) | 維持；正名；endpoint=`any-llm/vision` model=`anthropic/claude-sonnet-4.5`；圖表/文件；**P1** image_url vs image_urls；verified 目錄 true 不改 | [card](cards/fal-ai__any-llm__vision__claude-sonnet-4.5.md) |
| 190 | `fal-ai/any-llm/vision#gpt-5` | vision | 1 | ok | 📄200 | 未跑(needs) | 維持；正名；endpoint=`any-llm/vision` model=`openai/gpt-5`；VQA；**P1** image_url vs image_urls；**verified=false** 待 L2 | [card](cards/fal-ai__any-llm__vision__gpt-5.md) |
| 191 | `fal-ai/moondream-next` | vision | 1 | ok | 📄200 | 未跑(needs) | 維持；R九章；rec；prompt必填有預設句；max_tokens default64；英文主；verified不改 | [card](cards/fal-ai__moondream-next.md) |
| 192 | `fal-ai/florence-2-large/more-detailed-caption` | vision | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__florence-2-large__more-detailed-caption.md) |
| 193 | `fal-ai/florence-2-large/ocr` | vision | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__florence-2-large__ocr.md) |
| 194 | `fal-ai/moondream2` | vision | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__moondream2.md) |
| 195 | `fal-ai/any-llm/vision#gemini-2.5-flash` | vision | 1 | ok | 📄200 | 未跑(needs) | 維持；正名；model=`google/gemini-2.5-flash`；**DB_VISION 預設**·sc-caption winner；**P1** image_url vs image_urls；verified=false | [card](cards/fal-ai__any-llm__vision__gemini-2.5-flash.md) |
| 196 | `fal-ai/got-ocr/v2` | vision | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__got-ocr__v2.md) |
| 197 | `fal-ai/elevenlabs/speech-to-text` | speech-to-text | 2 | ok | 📄200 | 未跑(needs) | 維持；R九章；rec；Scribe V1；zho；**P2** V1價$0.008vs$0.03對帳；長檔估點扁平；verified不改 | [card](cards/fal-ai__elevenlabs__speech-to-text.md) |
| 198 | `fal-ai/whisper` | speech-to-text | 2 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__whisper.md) |
| 199 | `fal-ai/wizper` | speech-to-text | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__wizper.md) |
| 200 | `fal-ai/whisper#translate` | speech-to-text | 2 | ok | 📄200 | 未跑(needs) | 維持；正名；endpoint=`whisper` `task=translate`→英；**P2** 長檔扁平估點；verified 目錄 true 不改 | [card](cards/fal-ai__whisper__translate.md) |
| 201 | `fal-ai/whisper#chapters` | speech-to-text | 2 | ok | 📄200 | 未跑(needs) | 維持；正名；endpoint=`whisper` `chunk_level=word`（非獨立API）；**P2** 長檔扁平估點；verified 目錄 true 不改 | [card](cards/fal-ai__whisper__chapters.md) |
| 202 | `fal-ai/elevenlabs/speech-to-text#keyterms` | speech-to-text | 2 | ok | 📄200 | 未跑(needs) | 維持；正名；endpoint=`scribe-v2`+`keyterms`；prompt→術語表；**P2** 長檔扁平；verified=false | [card](cards/fal-ai__elevenlabs__speech-to-text__keyterms.md) |
| 203 | `fal-ai/wizper#draft` | speech-to-text | 1 | ok | 📄200 | 未跑(needs) | 維持；正名；endpoint=`wizper` 精簡 task=transcribe（無 language）；**P2** 長檔扁平；verified 目錄 true 不改；**R4 proper 齊** | [card](cards/fal-ai__wizper__draft.md) |
| 204 | `fal-ai/elevenlabs/speech-to-text/scribe-v2` | speech-to-text | 2 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__elevenlabs__speech-to-text__scribe-v2.md) |
| 205 | `fal-ai/speech-to-text` | speech-to-text | 2 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__speech-to-text.md) |
| 206 | `fal-ai/speech-to-text/turbo` | speech-to-text | 2 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__speech-to-text__turbo.md) |
| 207 | `fal-ai/speech-to-text/stream` | speech-to-text | 2 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__speech-to-text__stream.md) |
| 208 | `fal-ai/elevenlabs/tts/eleven-v3` | text-to-speech | 3 | ok | 📄200 | 未跑 | 維持 | [card](cards/fal-ai__elevenlabs__tts__eleven-v3.md) |
| 209 | `fal-ai/minimax/speech-02-hd` | text-to-speech | 3 | ok | 📄200 | 未跑 | 維持 | [card](cards/fal-ai__minimax__speech-02-hd.md) |
| 210 | `fal-ai/elevenlabs/tts/multilingual-v2` | text-to-speech | 3 | ok | 📄200 | 未跑 | 維持 | [card](cards/fal-ai__elevenlabs__tts__multilingual-v2.md) |
| 211 | `fal-ai/elevenlabs/tts/turbo-v2.5` | text-to-speech | 2 | ok | 📄200 | 未跑 | 維持 | [card](cards/fal-ai__elevenlabs__tts__turbo-v2.5.md) |
| 212 | `fal-ai/qwen-3-tts/text-to-speech/1.7b` | text-to-speech | 3 | ok | 📄200 | 未跑 | 維持 | [card](cards/fal-ai__qwen-3-tts__text-to-speech__1.7b.md) |
| 213 | `fal-ai/dia-tts` | text-to-speech | 2 | ✅ | 📄 | 未跑 | 維持·補英文限制 | [card](cards/fal-ai__dia-tts.md) |
| 214 | `fal-ai/chatterbox/text-to-speech` | text-to-speech | 1 | ✅ | 📄 | 未跑 | 維持·英文草稿·旋鈕P2 | [card](cards/fal-ai__chatterbox__text-to-speech.md) |
| 215 | `fal-ai/kokoro/mandarin-chinese` | text-to-speech | 1 | ✅ | 📄OpenAPI | 未跑 | 維持·草稿底線·voice/speed P2 | [card](cards/fal-ai__kokoro__mandarin-chinese.md) |
| 216 | `fal-ai/minimax/speech-2.6-hd` | text-to-speech | 3 | ok | 📄OpenAPI | 未跑 | **已修** text→prompt+output_format:url；維持 points=3 verified=false | [card](cards/fal-ai__minimax__speech-2.6-hd.md) |
| 217 | `fal-ai/qwen-3-tts/text-to-speech/0.6b` | text-to-speech | 2 | ok | 📄OpenAPI | 未跑 | 維持 | [card](cards/fal-ai__qwen-3-tts__text-to-speech__0.6b.md) |
| 218 | `fal-ai/index-tts-2/text-to-speech` | text-to-speech | 1 | ok | 📄OpenAPI | 未跑(needs) | **已修** text→prompt+audio_url+needs；維持 points=1 verified=false；長旁白估點P2 | [card](cards/fal-ai__index-tts-2__text-to-speech.md) |
| 219 | `fal-ai/minimax/voice-clone` | text-to-speech | 47 | ok | 📄OpenAPI | 未跑(needs) | **維持** points=47 verified=false input ok；ready-static-only；**P0** custom_voice_id 未抽取+TTS未串；預覽加價P2 | [card](cards/fal-ai__minimax__voice-clone.md) |
| 220 | `fal-ai/qwen-3-tts/clone-voice/1.7b` | text-to-speech | 1 | ok | 📄OpenAPI | 未跑(needs) | B9：**非端到端TTS**；input 僅 audio_url；extract embedding；points=1；TTS串接待產品；verified=false | [card](cards/fal-ai__qwen-3-tts__clone-voice__1.7b.md) |
| 221 | `fal-ai/minimax/voice-design` | text-to-speech | 3 | 落差 | 📄OpenAPI | 未跑 | **建議調** cost→$3/次 points=93；**修 input**+preview_text；**P0** custom_voice_id+TTS未串；ready-static-only | [card](cards/fal-ai__minimax__voice-design.md) |
| 222 | `fal-ai/f5-tts` | text-to-speech | 2 | ok | 📄OpenAPI | 未跑(needs) | **已修** model_type+extract AudioFile；維持 points=2/$0.05/千字/verified=false；ready-static-only | [card](cards/fal-ai__f5-tts.md) |
| 223 | `fal-ai/vibevoice` | text-to-speech | 1 | ok | 📄OpenAPI | 未跑 | **已修** script+speakers(雙ZH)；維持 points=1/$0.04/分/verified=false；長稿扣點P2；ready-static-only | [card](cards/fal-ai__vibevoice.md) |
| 224 | `fal-ai/vibevoice/7b` | text-to-speech | 2 | ok | 📄OpenAPI200 | 未跑 | 九章升；required script+speakers **綠**（P0-FIXED）；預設單 Bowen；多人對談 winner；**P2** 長稿flat／單speaker vs 多人定位；verified=false | [card](cards/fal-ai__vibevoice__7b.md) |
| 225 | `fal-ai/dia-tts/voice-clone` | text-to-speech | 2 | ok | 📄OpenAPI200(B9) | 未跑 | 九章升；path真；input **僅 text**（P0-FIXED）；**非真克隆**；needs=null 對齊；points=2/verified=false；**P2** 標籤誤導／千字動態 | [card](cards/fal-ai__dia-tts__voice-clone.md) |
| 226 | `fal-ai/elevenlabs/text-to-dialogue/eleven-v3` | text-to-speech | 3 | ok | 📄OpenAPI | 未跑 | 維持；inputs[]契約綠；3點長稿風險；英文對談旗艦 | [card](cards/fal-ai__elevenlabs__text-to-dialogue__eleven-v3.md) |
| 227 | `fal-ai/gemini-tts` | text-to-speech | 2 | ok | 📄OpenAPI200 | 未跑 | 維持；prompt+zh-TW language_code+mp3✓；預設 Kore/flash；價人工2無$；speakers未暴露；verified=false | [card](cards/fal-ai__gemini-tts.md) |
| 228 | `fal-ai/zonos` | text-to-speech | 1 | ok | 📄OpenAPI200 | 未跑(needs) | 九章升；required `reference_audio_url`+`prompt` **綠**；真克隆；價未明列 **P2**；points=1/verified=false/needs=audio | [card](cards/fal-ai__zonos.md) |
| 229 | `fal-ai/orpheus-tts` | text-to-speech | 1 | ok | 📄OpenAPI200 | 未跑 | 九章升；required `text` **綠**；optional voice×8/temp/rep_pen 未送用預設；情感 tag 嵌 text；價未明 **P2**；points=1/!needs/verified=false | [card](cards/fal-ai__orpheus-tts.md) |
| 230 | `fal-ai/lyria2` | text-to-audio | 3 | ok | 📄OpenAPI200 | 未跑 | 九章升；required `prompt` **綠**；neg/seed 可選未送；$0.10/30s≈points=3；verified=true 不改；**P2** 時長／neg UI | [card](cards/fal-ai__lyria2.md) |
| 231 | `fal-ai/elevenlabs/music` | text-to-audio | 74 | ok | 📄OpenAPI200 | 未跑 | 九章升；schema 無 hard required、站內 `prompt` 路徑綠；74≈3分@$0.80；**P2** 時長動態/composition_plan；verified=false | [card](cards/fal-ai__elevenlabs__music.md) |
| 232 | `fal-ai/stable-audio-25/text-to-audio` | text-to-audio | 6 | ok | 📄OpenAPI200 | 未跑 | 九章升；required `prompt` **綠**；站內 `seconds_total:30`（API 預設190/max190）；$0.20/次≈6；**P2** 秒數UI；verified=false | [card](cards/fal-ai__stable-audio-25__text-to-audio.md) |
| 233 | `fal-ai/minimax-music` | text-to-audio | 1 | ok | 📄OpenAPI200 | 未跑(needs) | 九章升；**P0-FIXED** required `prompt`+`reference_audio_url`；原僅 prompt 會 422；needs=audio；verified→false；pure TTM→#237 v2.6；$0.03/首≈1 | [card](cards/fal-ai__minimax-music.md) |
| 234 | `fal-ai/elevenlabs/sound-effects/v2` | text-to-audio | 1 | ok | 📄OpenAPI200 | 未跑 | 九章升；required `text` **綠**（非 prompt）；duration/loop 可選未送；≈$0.01≈1；verified=true 不改 | [card](cards/fal-ai__elevenlabs__sound-effects__v2.md) |
| 235 | `cassetteai/sound-effects-generator` | text-to-audio | 1 | ok | 📄OpenAPI200 | 未跑 | 九章升；required `prompt`+`duration` **綠**（站內10）；output `audio_file` extract✅；≈$0.005≈1；verified=true 不改 | [card](cards/cassetteai__sound-effects-generator.md) |
| 236 | `fal-ai/ace-step` | text-to-audio | 1 | ok | 📄OpenAPI200 | 未跑 | 九章升；**P0-FIXED** required `tags`（原 prompt）；duration 預設60；秒價雙源 **P2**；points=1/verified=true 不改 | [card](cards/fal-ai__ace-step.md) |
| 237 | `fal-ai/minimax-music/v2.6` | text-to-audio | 5 | ok | 📄200 | 未跑 | 維持 | [card](cards/fal-ai__minimax-music__v2.6.md) |
| 238 | `fal-ai/minimax-music/v2` | text-to-audio | 1 | ok | 📄200 | 未跑 | 維持 | [card](cards/fal-ai__minimax-music__v2.md) |
| 239 | `sonilo/v1.1/text-to-music` | text-to-audio | 7 | ok | 📄200 | 未跑 | 維持 | [card](cards/sonilo__v1.1__text-to-music.md) |
| 240 | `fal-ai/diffrhythm` | text-to-audio | 1 | ok | 📄200 | 未跑 | 維持 | [card](cards/fal-ai__diffrhythm.md) |
| 241 | `cassetteai/music-generator` | text-to-audio | 1 | ok | 📄200 | 未跑 | 維持 | [card](cards/cassetteai__music-generator.md) |
| 242 | `fal-ai/mmaudio-v2` | text-to-audio | 1 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__mmaudio-v2.md) |
| 243 | `fal-ai/mmaudio-v2/text-to-audio` | text-to-audio | 1 | ok | 📄200 | 未跑 | 維持 | [card](cards/fal-ai__mmaudio-v2__text-to-audio.md) |
| 244 | `fal-ai/yue` | text-to-audio | 8 | ok | 📄200 | 未跑 | 維持 | [card](cards/fal-ai__yue.md) |
| 245 | `fal-ai/stable-audio` | text-to-audio | 1 | ok | 📄200 | 未跑 | 維持 | [card](cards/fal-ai__stable-audio.md) |
| 246 | `fal-ai/thinksound` | text-to-audio | 2 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__thinksound.md) |
| 247 | `fal-ai/hunyuan-video-foley` | text-to-audio | 2 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__hunyuan-video-foley.md) |
| 248 | `fal-ai/flux-2-trainer` | training | 248 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__flux-2-trainer.md) |
| 249 | `fal-ai/flux-2-trainer/edit` | training | 230 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__flux-2-trainer__edit.md) |
| 250 | `fal-ai/flux-kontext-trainer` | training | 78 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__flux-kontext-trainer.md) |
| 251 | `fal-ai/flux-lora-portrait-trainer` | training | 80 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__flux-lora-portrait-trainer.md) |
| 252 | `fal-ai/qwen-image-trainer` | training | 62 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__qwen-image-trainer.md) |
| 253 | `fal-ai/turbo-flux-trainer` | training | 80 | ⚠000 | 📄000 | 未跑(needs) | 重試000 | [card](cards/fal-ai__turbo-flux-trainer.md) |
| 254 | `fal-ai/flux-krea-trainer` | training | 62 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__flux-krea-trainer.md) |
| 255 | `fal-ai/flux-lora-fast-training` | training | 62 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__flux-lora-fast-training.md) |
| 256 | `fal-ai/krea-2-trainer` | training | 93 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__krea-2-trainer.md) |
| 257 | `fal-ai/flux-2-klein-9b-base-trainer` | training | 133 | ⚠000 | 📄000 | 未跑(needs) | 重試000 | [card](cards/fal-ai__flux-2-klein-9b-base-trainer.md) |
| 258 | `fal-ai/qwen-image-2512-trainer` | training | 47 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__qwen-image-2512-trainer.md) |
| 259 | `fal-ai/qwen-image-edit-trainer` | training | 124 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__qwen-image-edit-trainer.md) |
| 260 | `fal-ai/z-image-trainer` | training | 70 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__z-image-trainer.md) |
| 261 | `fal-ai/wan-22-image-trainer` | training | 140 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__wan-22-image-trainer.md) |
| 262 | `fal-ai/wan-22-trainer/t2v-a14b` | training | 124 | ⚠000 | 📄000 | 未跑(needs) | 重試000 | [card](cards/fal-ai__wan-22-trainer__t2v-a14b.md) |
| 263 | `fal-ai/wan-22-trainer/i2v-a14b` | training | 155 | ⚠000 | 📄000 | 未跑(needs) | 重試000 | [card](cards/fal-ai__wan-22-trainer__i2v-a14b.md) |
| 264 | `fal-ai/wan-trainer` | training | 155 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__wan-trainer.md) |
| 265 | `fal-ai/hunyuan-video-lora-training` | training | 155 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__hunyuan-video-lora-training.md) |
| 266 | `fal-ai/ltx2-video-trainer` | training | 298 | ok | 📄200 | 未跑(needs) | 維持 | [card](cards/fal-ai__ltx2-video-trainer.md) |
