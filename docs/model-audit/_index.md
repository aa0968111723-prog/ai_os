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
| 10 | `fal-ai/kolors` | text-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 11 | `fal-ai/fast-lightning-sdxl` | text-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 12 | `fal-ai/flux-2-flex` | text-to-image | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 13 | `fal-ai/flux-2` | text-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 14 | `fal-ai/flux-pro/v1.1-ultra` | text-to-image | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 15 | `fal-ai/bytedance/seedream/v5/text-to-image` | text-to-image | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 16 | `fal-ai/ideogram/v4` | text-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 17 | `fal-ai/recraft/v3/text-to-image` | text-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 18 | `fal-ai/recraft/v4.1/text-to-image` | text-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 19 | `fal-ai/nano-banana-pro` | text-to-image | 5 | ⬜ | ⬜ | 未跑 | — | — |
| 20 | `fal-ai/imagen4/preview/ultra` | text-to-image | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 21 | `fal-ai/imagen4/preview/fast` | text-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 22 | `fal-ai/qwen-image-max/text-to-image` | text-to-image | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 23 | `fal-ai/hunyuan-image/v3` | text-to-image | 3 | ⬜ | ⬜ | 未跑 | — | — |
| 24 | `fal-ai/sana` | text-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 25 | `fal-ai/playground-v25` | text-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 26 | `fal-ai/luma-photon` | text-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 27 | `fal-ai/aura-flow` | text-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 28 | `fal-ai/flux-lora` | text-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 29 | `fal-ai/flux-2/lora` | text-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 30 | `fal-ai/lora` | text-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 31 | `fal-ai/nano-banana-2/edit` | image-to-image | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 32 | `fal-ai/flux-2/pro/edit` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 33 | `fal-ai/bytedance/seedream/v4.5/edit` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 34 | `fal-ai/flux-kontext/dev` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 35 | `fal-ai/flux-pro/kontext` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 36 | `fal-ai/qwen-image-edit` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 37 | `fal-ai/qwen-image-edit-plus` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 38 | `fal-ai/flux/dev/image-to-image` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 39 | `fal-ai/fast-sdxl/image-to-image` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 40 | `fal-ai/flux-pro/kontext/max` | image-to-image | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 41 | `fal-ai/nano-banana-pro/edit` | image-to-image | 5 | ⬜ | ⬜ | 未跑 | — | — |
| 42 | `fal-ai/nano-banana/edit` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 43 | `fal-ai/bytedance/seedream/v4/edit` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 44 | `fal-ai/bytedance/seededit/v3/edit-image` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 45 | `fal-ai/qwen-image-2/edit` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 46 | `openai/gpt-image-2/edit` | image-to-image | 5 | ⬜ | ⬜ | 未跑 | — | — |
| 47 | `fal-ai/ideogram/v3/remix` | image-to-image | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 48 | `fal-ai/flux/dev/redux` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 49 | `fal-ai/iclight-v2` | image-to-image | 3 | ⬜ | ⬜ | 未跑 | — | — |
| 50 | `fal-ai/bria/background/replace` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 51 | `fal-ai/bria/background/remove` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 52 | `fal-ai/bria/expand` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 53 | `fal-ai/image-editing/object-removal` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
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
| 64 | `fal-ai/supir` | image-to-image | 3 | ⬜ | ⬜ | 未跑 | — | — |
| 65 | `fal-ai/thera` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 66 | `fal-ai/seedvr/upscale/image` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 67 | `clarityai/crystal-upscaler` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 68 | `fal-ai/recraft/upscale/crisp` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 69 | `fal-ai/recraft/upscale/creative` | image-to-image | 8 | ⬜ | ⬜ | 未跑 | — | — |
| 70 | `fal-ai/swin2sr` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 71 | `fal-ai/drct-super-resolution` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 72 | `fal-ai/creative-upscaler` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 73 | `fal-ai/mix-dehaze-net` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 74 | `fal-ai/birefnet/v2` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 75 | `fal-ai/birefnet` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 76 | `fal-ai/ideogram/remove-background` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 77 | `pixelcut/background-removal` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 78 | `fal-ai/imageutils/rembg` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 79 | `fal-ai/ben/v2/image` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 80 | `smoretalk-ai/rembg-enhance` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 81 | `fal-ai/ideogram/v3/replace-background` | image-to-image | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 82 | `fal-ai/image-editing/background-change` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 83 | `fal-ai/ideogram/character` | image-to-image | 3 | ⬜ | ⬜ | 未跑 | — | — |
| 84 | `fal-ai/instant-character` | image-to-image | 3 | ⬜ | ⬜ | 未跑 | — | — |
| 85 | `fal-ai/flux-pulid` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 86 | `fal-ai/instantid` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 87 | `fal-ai/photomaker` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 88 | `fal-ai/face-to-sticker` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 89 | `fal-ai/qwen-image-edit-plus-lora-gallery/next-scene` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 90 | `fal-ai/minimax/image-01/subject-reference` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 91 | `fal-ai/image-editing/expression-change` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 92 | `easel-ai/easel-avatar` | image-to-image | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 93 | `fal-ai/image-apps-v2/headshot-photo` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 94 | `fal-ai/finegrain-eraser` | image-to-image | 6 | ⬜ | ⬜ | 未跑 | — | — |
| 95 | `fal-ai/recraft/vectorize` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 96 | `fal-ai/image2svg` | image-to-image | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 97 | `fal-ai/veo3.1` | text-to-video | 31 | ⬜ | ⬜ | 未跑 | — | — |
| 98 | `fal-ai/sora-2/text-to-video` | text-to-video | 16 | ⬜ | ⬜ | 未跑 | — | — |
| 99 | `fal-ai/kling-video/v2.5-turbo/pro/text-to-video` | text-to-video | 11 | ⬜ | ⬜ | 未跑 | — | — |
| 100 | `fal-ai/veo3.1/fast` | text-to-video | 16 | ⬜ | ⬜ | 未跑 | — | — |
| 101 | `fal-ai/wan/v2.2-a14b/text-to-video` | text-to-video | 12 | ⬜ | ⬜ | 未跑 | — | — |
| 102 | `fal-ai/minimax/hailuo-2.3/standard/text-to-video` | text-to-video | 9 | ⬜ | ⬜ | 未跑 | — | — |
| 103 | `fal-ai/ltx-video` | text-to-video | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 104 | `fal-ai/veo2` | text-to-video | 78 | ⬜ | ⬜ | 未跑 | — | — |
| 105 | `fal-ai/kling-video/v2.6/pro/text-to-video` | text-to-video | 11 | ⬜ | ⬜ | 未跑 | — | — |
| 106 | `fal-ai/kling-video/o3/pro/text-to-video` | text-to-video | 17 | ⬜ | ⬜ | 未跑 | — | — |
| 107 | `fal-ai/minimax/hailuo-2.3/pro/text-to-video` | text-to-video | 15 | ✅ | 📄 | 未跑 | 維持（可選去 aspect_ratio） | [card](cards/fal-ai__minimax__hailuo-2.3__pro__text-to-video.md) |
| 108 | `fal-ai/luma-dream-machine/ray-2` | text-to-video | 16 | ✅ | 📄 | 未跑 | 維持（P2: 1:1 enum；預設 540p） | [card](cards/fal-ai__luma-dream-machine__ray-2.md) |
| 109 | `fal-ai/bytedance/seedance/v1/pro/text-to-video` | text-to-video | 19 | ✅ | 📄 | 未跑 | 維持（可選 SEED allowlist；長秒須聯動估點） | [card](cards/fal-ai__bytedance__seedance__v1__pro__text-to-video.md) |
| 110 | `fal-ai/bytedance/seedance/v1.5/pro/text-to-video` | text-to-video | 8 | ✅ | 📄 | 未跑 | 維持（可選 SEED；sc-t2v-sound 可納；長秒/1080p 須聯動估點） | [card](cards/fal-ai__bytedance__seedance__v1.5__pro__text-to-video.md) |
| 111 | `bytedance/seedance-2.0/text-to-video` | text-to-video | 47 | ok | 📄OpenAPI | 未跑 | 維持；OpenAPI200；P0 duration=auto vs 扁平47；cost 6s文案債(實5s)；含音免費；禁4k裸開 | [card](cards/bytedance__seedance-2.0__text-to-video.md) |
| 112 | `fal-ai/veo3.1/lite` | text-to-video | 5 | ok | 📄OpenAPI | 未跑 | **已修** 1:1→16:9 防422；P0 預設8s+含音≈12 vs 扁平5；verified 維持 true | [card](cards/fal-ai__veo3.1__lite.md) |
| 113 | `fal-ai/minimax/hailuo-02/standard/text-to-video` | text-to-video | 7 | ok | 📄OpenAPI | 未跑 | 維持；OpenAPI200；P1 default 6s≈8.4 vs 扁平7；aspect 死欄P2；cost 6s文案/估5s；Pro/i2v未收錄 | [card](cards/fal-ai__minimax__hailuo-02__standard__text-to-video.md) |
| 114 | `fal-ai/minimax/video-01-director` | text-to-video | 16 | ok | 📄OpenAPI | 未跑 | 維持；$0.5/支≈16；運鏡靠 prompt [ ]；aspect 死欄 | [card](cards/fal-ai__minimax__video-01-director.md) |
| 115 | `fal-ai/wan/v2.5/text-to-video` | text-to-video | 8 | ok | 📄OpenAPI | 未跑 | **已修 endpoint**→`wan-25`；P0 預設1080p≈23 vs 扁平8；aspect三比例健康；原生音待live | [card](cards/fal-ai__wan__v2.5__text-to-video.md) |
| 116 | `fal-ai/wan/v2.6/text-to-video` | text-to-video | 16 | ok | 📄OpenAPI | 未跑 | **已修 endpoint**→`wan/v2.6`；P0 預設1080p≈23 vs 扁平16 | [card](cards/fal-ai__wan__v2.6__text-to-video.md) |
| 117 | `fal-ai/hunyuan-video-v1.5/text-to-video` | text-to-video | 12 | ⬜ | ⬜ | 未跑 | — | — |
| 118 | `fal-ai/pika/v2.2/text-to-video` | text-to-video | 6 | ⬜ | ⬜ | 未跑 | — | — |
| 119 | `fal-ai/luma-dream-machine/ray-2-flash` | text-to-video | 6 | ⬜ | ⬜ | 未跑 | — | — |
| 120 | `fal-ai/bytedance/seedance/v1/lite/text-to-video` | text-to-video | 6 | ⬜ | ⬜ | 未跑 | — | — |
| 121 | `fal-ai/pixverse/v5.5/text-to-video` | text-to-video | 9 | ⬜ | ⬜ | 未跑 | — | — |
| 122 | `fal-ai/pixverse/v6/text-to-video` | text-to-video | 14 | ⬜ | ⬜ | 未跑 | — | — |
| 123 | `fal-ai/kling-video/v1.6/standard/text-to-video` | text-to-video | 9 | ⬜ | ⬜ | 未跑 | — | — |
| 124 | `fal-ai/wan-t2v` | text-to-video | 6 | ⬜ | ⬜ | 未跑 | — | — |
| 125 | `fal-ai/hunyuan-video` | text-to-video | 12 | ⬜ | ⬜ | 未跑 | — | — |
| 126 | `fal-ai/mochi-v1` | text-to-video | 12 | ⬜ | ⬜ | 未跑 | — | — |
| 127 | `fal-ai/cogvideox-5b` | text-to-video | 6 | ⬜ | ⬜ | 未跑 | — | — |
| 128 | `fal-ai/wan/v2.2-a14b/text-to-video/lora` | text-to-video | 16 | ⬜ | ⬜ | 未跑 | — | — |
| 129 | `fal-ai/kling-video/v2.6/pro/image-to-video` | image-to-video | 11 | ⬜ | ⬜ | 未跑 | — | — |
| 130 | `fal-ai/kling-video/v2.5-turbo/pro/image-to-video` | image-to-video | 11 | ⬜ | ⬜ | 未跑 | — | — |
| 131 | `fal-ai/kling-video/v3/pro/image-to-video` | image-to-video | 17 | ⬜ | ⬜ | 未跑 | — | — |
| 132 | `fal-ai/veo3.1/image-to-video` | image-to-video | 31 | ⬜ | ⬜ | 未跑 | — | — |
| 133 | `fal-ai/veo2/image-to-video` | image-to-video | 78 | ⬜ | ⬜ | 未跑 | — | — |
| 134 | `fal-ai/minimax/hailuo-2.3/pro/image-to-video` | image-to-video | 15 | ⬜ | ⬜ | 未跑 | — | — |
| 135 | `fal-ai/bytedance/seedance/v1.5/pro/image-to-video` | image-to-video | 8 | ⬜ | ⬜ | 未跑 | — | — |
| 136 | `fal-ai/luma-dream-machine/ray-2/image-to-video` | image-to-video | 16 | ⬜ | ⬜ | 未跑 | — | — |
| 137 | `wan/v2.6/image-to-video` | image-to-video | 8 | ⬜ | ⬜ | 未跑 | — | — |
| 138 | `fal-ai/wan/v2.2-a14b/image-to-video` | image-to-video | 6 | ⬜ | ⬜ | 未跑 | — | — |
| 139 | `fal-ai/minimax/hailuo-2.3/standard/image-to-video` | image-to-video | 9 | ⬜ | ⬜ | 未跑 | — | — |
| 140 | `fal-ai/minimax/hailuo-2.3-fast/pro/image-to-video` | image-to-video | 10 | ⬜ | ⬜ | 未跑 | — | — |
| 141 | `fal-ai/bytedance/seedance/v1/lite/image-to-video` | image-to-video | 6 | ⬜ | ⬜ | 未跑 | — | — |
| 142 | `fal-ai/luma-dream-machine/ray-2-flash/image-to-video` | image-to-video | 6 | ⬜ | ⬜ | 未跑 | — | — |
| 143 | `fal-ai/hunyuan-video-image-to-video` | image-to-video | 12 | ⬜ | ⬜ | 未跑 | — | — |
| 144 | `fal-ai/pixverse/v5/image-to-video` | image-to-video | 9 | ⬜ | ⬜ | 未跑 | — | — |
| 145 | `fal-ai/runway-gen3/turbo/image-to-video` | image-to-video | 12 | ⬜ | ⬜ | 未跑 | — | — |
| 146 | `fal-ai/minimax/video-01/image-to-video` | image-to-video | 16 | ⬜ | ⬜ | 未跑 | — | — |
| 147 | `fal-ai/minimax/video-01-subject-reference` | image-to-video | 16 | ⬜ | ⬜ | 未跑 | — | — |
| 148 | `fal-ai/wan-i2v` | image-to-video | 9 | ⬜ | ⬜ | 未跑 | — | — |
| 149 | `fal-ai/ltx-video-v095/image-to-video` | image-to-video | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 150 | `fal-ai/framepack` | image-to-video | 5 | ⬜ | ⬜ | 未跑 | — | — |
| 151 | `fal-ai/stable-video` | image-to-video | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 152 | `fal-ai/fast-svd-lcm` | image-to-video | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 153 | `fal-ai/topaz/upscale/video` | video-to-video | 7 | ⬜ | ⬜ | 未跑 | — | — |
| 154 | `fal-ai/sync-lipsync/v2/pro` | video-to-video | 155 | ⬜ | ⬜ | 未跑 | — | — |
| 155 | `fal-ai/luma-dream-machine/ray-2/modify` | video-to-video | 16 | ⬜ | ⬜ | 未跑 | — | — |
| 156 | `fal-ai/luma-dream-machine/ray-2-flash/modify` | video-to-video | 8 | ⬜ | ⬜ | 未跑 | — | — |
| 157 | `fal-ai/sync-lipsync` | video-to-video | 22 | ⬜ | ⬜ | 未跑 | — | — |
| 158 | `fal-ai/video-upscaler` | video-to-video | 16 | ⬜ | ⬜ | 未跑 | — | — |
| 159 | `fal-ai/bria/video/background-removal` | video-to-video | 16 | ⬜ | ⬜ | 未跑 | — | — |
| 160 | `fal-ai/rife/video` | video-to-video | 2 | ✅ | 📄 | 未跑 | 維持 | [card](cards/fal-ai__rife__video.md) |
| 161 | `fal-ai/sync-lipsync/v3` | video-to-video | 155 | ✅ | 📄 | 未跑 | 調 points（$8/分→248；cost 同步） | [card](cards/fal-ai__sync-lipsync__v3.md) |
| 162 | `fal-ai/sync-lipsync/v2` | video-to-video | 93 | ✅ | 📄 | 未跑 | 維持（$3/分＝93 已對齊） | [card](cards/fal-ai__sync-lipsync__v2.md) |
| 163 | `decart/lucy-restyle` | video-to-video | 19 | ok | 📄OpenAPI | 未跑(needs) | 維持 verified=false；P0 長片估點低估；720p only | [card](cards/decart__lucy-restyle.md) |
| 164 | `fal-ai/seedvr/upscale/video` | video-to-video | 12 | ⬜ | ⬜ | 未跑 | — | — |
| 165 | `fal-ai/ben/v2/video` | video-to-video | 5 | ✅ | 📄OpenAPI | 未跑 | 維持（5≈6s720p30；預設mp4無alpha；文案勿寫全場最便宜） | [card](cards/fal-ai__ben__v2__video.md) |
| 166 | `veed/lipsync` | video-to-video | 12 | ✅ | 📄OpenAPI | 未跑 | 維持（$0.4/分＝12 已對齊） | [card](cards/veed__lipsync.md) |
| 167 | `veed/video-background-removal` | video-to-video | 4 | ✅ | 📄OpenAPI | 未跑 | 修 extractResult（video[]）；4≈6s@上限 refine；ready-static-only | [card](cards/veed__video-background-removal.md) |
| 168 | `decart/lucy-edit` | video-to-video | 16 | ok | 📄OpenAPI(fast/pro) | 未跑(needs) | **已修 endpoint**→`…/fast`；裸id404；P0扁平16 vs 按秒；verified=false | [card](cards/decart__lucy-edit.md) |
| 169 | `fal-ai/wan-vace-14b/outpainting` | video-to-video | 9 | ✅ | 📄OpenAPI | 未跑(needs) | **P0 修 input**（expand_* 預設 false 不擴邊；幀~5s）；9≈mid×5s；ready-static-only | [card](cards/fal-ai__wan-vace-14b__outpainting.md) |
| 170 | `fal-ai/latentsync` | video-to-video | 6 | ⬜ | ⬜ | 未跑 | — | — |
| 171 | `fal-ai/musetalk` | video-to-video | 5 | ⬜ | ⬜ | 未跑 | — | — |
| 172 | `bria/video/background-removal/v3` | video-to-video | 3 | ⬜ | ⬜ | 未跑 | — | — |
| 173 | `bria/video/background-removal/realtime` | video-to-video | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 174 | `veed/video-background-removal/fast` | video-to-video | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 175 | `veed/video-background-removal/green-screen` | video-to-video | 5 | ⬜ | ⬜ | 未跑 | — | — |
| 176 | `fal-ai/birefnet/v2/video` | video-to-video | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 177 | `fal-ai/auto-caption` | video-to-video | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 178 | `fal-ai/workflow-utilities/auto-subtitle` | video-to-video | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 179 | `veed/subtitles` | video-to-video | 3 | ⬜ | ⬜ | 未跑 | — | — |
| 180 | `fal-ai/bria/video/eraser` | video-to-video | 22 | ⬜ | ⬜ | 未跑 | — | — |
| 181 | `nvidia-nim#deepseek-r1` | llm | 0 | ⬜ | ⬜ | 未跑 | — | — |
| 182 | `nvidia-nim#llama-3.1-405b` | llm | 0 | ⬜ | ⬜ | 未跑 | — | — |
| 183 | `nvidia-nim#nemotron-4-340b` | llm | 0 | ⬜ | ⬜ | 未跑 | — | — |
| 184 | `nvidia-nim#llama-3.1-70b` | llm | 0 | ⬜ | ⬜ | 未跑 | — | — |
| 185 | `nvidia-nim#qwen2.5-72b` | llm | 0 | ⬜ | ⬜ | 未跑 | — | — |
| 186 | `nvidia-nim#mistral-large-2` | llm | 0 | ⬜ | ⬜ | 未跑 | — | — |
| 187 | `nvidia-nim#llama-3.1-8b` | llm | 0 | ⬜ | ⬜ | 未跑 | — | — |
| 188 | `fal-ai/any-llm/vision#gemini-2.5-pro` | vision | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 189 | `fal-ai/any-llm/vision#claude-sonnet-4.5` | vision | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 190 | `fal-ai/any-llm/vision#gpt-5` | vision | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 191 | `fal-ai/moondream-next` | vision | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 192 | `fal-ai/florence-2-large/more-detailed-caption` | vision | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 193 | `fal-ai/florence-2-large/ocr` | vision | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 194 | `fal-ai/moondream2` | vision | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 195 | `fal-ai/any-llm/vision#gemini-2.5-flash` | vision | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 196 | `fal-ai/got-ocr/v2` | vision | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 197 | `fal-ai/elevenlabs/speech-to-text` | speech-to-text | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 198 | `fal-ai/whisper` | speech-to-text | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 199 | `fal-ai/wizper` | speech-to-text | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 200 | `fal-ai/whisper#translate` | speech-to-text | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 201 | `fal-ai/whisper#chapters` | speech-to-text | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 202 | `fal-ai/elevenlabs/speech-to-text#keyterms` | speech-to-text | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 203 | `fal-ai/wizper#draft` | speech-to-text | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 204 | `fal-ai/elevenlabs/speech-to-text/scribe-v2` | speech-to-text | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 205 | `fal-ai/speech-to-text` | speech-to-text | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 206 | `fal-ai/speech-to-text/turbo` | speech-to-text | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 207 | `fal-ai/speech-to-text/stream` | speech-to-text | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 208 | `fal-ai/elevenlabs/tts/eleven-v3` | text-to-speech | 3 | ⬜ | ⬜ | 未跑 | — | — |
| 209 | `fal-ai/minimax/speech-02-hd` | text-to-speech | 3 | ⬜ | ⬜ | 未跑 | — | — |
| 210 | `fal-ai/elevenlabs/tts/multilingual-v2` | text-to-speech | 3 | ⬜ | ⬜ | 未跑 | — | — |
| 211 | `fal-ai/elevenlabs/tts/turbo-v2.5` | text-to-speech | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 212 | `fal-ai/qwen-3-tts/text-to-speech/1.7b` | text-to-speech | 3 | ⬜ | ⬜ | 未跑 | — | — |
| 213 | `fal-ai/dia-tts` | text-to-speech | 2 | ✅ | 📄 | 未跑 | 維持·補英文限制 | [card](cards/fal-ai__dia-tts.md) |
| 214 | `fal-ai/chatterbox/text-to-speech` | text-to-speech | 1 | ✅ | 📄 | 未跑 | 維持·英文草稿·旋鈕P2 | [card](cards/fal-ai__chatterbox__text-to-speech.md) |
| 215 | `fal-ai/kokoro/mandarin-chinese` | text-to-speech | 1 | ✅ | 📄OpenAPI | 未跑 | 維持·草稿底線·voice/speed P2 | [card](cards/fal-ai__kokoro__mandarin-chinese.md) |
| 216 | `fal-ai/minimax/speech-2.6-hd` | text-to-speech | 3 | ok | 📄OpenAPI | 未跑 | **已修** text→prompt+output_format:url；維持 points=3 verified=false | [card](cards/fal-ai__minimax__speech-2.6-hd.md) |
| 217 | `fal-ai/qwen-3-tts/text-to-speech/0.6b` | text-to-speech | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 218 | `fal-ai/index-tts-2/text-to-speech` | text-to-speech | 1 | ok | 📄OpenAPI | 未跑(needs) | **已修** text→prompt+audio_url+needs；維持 points=1 verified=false；長旁白估點P2 | [card](cards/fal-ai__index-tts-2__text-to-speech.md) |
| 219 | `fal-ai/minimax/voice-clone` | text-to-speech | 47 | ok | 📄OpenAPI | 未跑(needs) | **維持** points=47 verified=false input ok；ready-static-only；**P0** custom_voice_id 未抽取+TTS未串；預覽加價P2 | [card](cards/fal-ai__minimax__voice-clone.md) |
| 220 | `fal-ai/qwen-3-tts/clone-voice/1.7b` | text-to-speech | 3 | ok | 📄OpenAPI | 未跑(needs) | **建議調** cost→$0.0008/分 points→1；**P0** speaker_embedding 未抽取+Qwen TTS未串；幽靈text；ready-static-only | [card](cards/fal-ai__qwen-3-tts__clone-voice__1.7b.md) |
| 221 | `fal-ai/minimax/voice-design` | text-to-speech | 3 | 落差 | 📄OpenAPI | 未跑 | **建議調** cost→$3/次 points=93；**修 input**+preview_text；**P0** custom_voice_id+TTS未串；ready-static-only | [card](cards/fal-ai__minimax__voice-design.md) |
| 222 | `fal-ai/f5-tts` | text-to-speech | 2 | ok | 📄OpenAPI | 未跑(needs) | **已修** model_type+extract AudioFile；維持 points=2/$0.05/千字/verified=false；ready-static-only | [card](cards/fal-ai__f5-tts.md) |
| 223 | `fal-ai/vibevoice` | text-to-speech | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 224 | `fal-ai/vibevoice/7b` | text-to-speech | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 225 | `fal-ai/dia-tts/voice-clone` | text-to-speech | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 226 | `fal-ai/elevenlabs/text-to-dialogue/eleven-v3` | text-to-speech | 3 | ⬜ | ⬜ | 未跑 | — | — |
| 227 | `fal-ai/gemini-tts` | text-to-speech | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 228 | `fal-ai/zonos` | text-to-speech | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 229 | `fal-ai/orpheus-tts` | text-to-speech | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 230 | `fal-ai/lyria2` | text-to-audio | 3 | ⬜ | ⬜ | 未跑 | — | — |
| 231 | `fal-ai/elevenlabs/music` | text-to-audio | 74 | ⬜ | ⬜ | 未跑 | — | — |
| 232 | `fal-ai/stable-audio-25/text-to-audio` | text-to-audio | 6 | ⬜ | ⬜ | 未跑 | — | — |
| 233 | `fal-ai/minimax-music` | text-to-audio | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 234 | `fal-ai/elevenlabs/sound-effects/v2` | text-to-audio | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 235 | `cassetteai/sound-effects-generator` | text-to-audio | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 236 | `fal-ai/ace-step` | text-to-audio | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 237 | `fal-ai/minimax-music/v2.6` | text-to-audio | 5 | ⬜ | ⬜ | 未跑 | — | — |
| 238 | `fal-ai/minimax-music/v2` | text-to-audio | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 239 | `sonilo/v1.1/text-to-music` | text-to-audio | 7 | ⬜ | ⬜ | 未跑 | — | — |
| 240 | `fal-ai/diffrhythm` | text-to-audio | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 241 | `cassetteai/music-generator` | text-to-audio | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 242 | `fal-ai/mmaudio-v2` | text-to-audio | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 243 | `fal-ai/mmaudio-v2/text-to-audio` | text-to-audio | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 244 | `fal-ai/yue` | text-to-audio | 8 | ⬜ | ⬜ | 未跑 | — | — |
| 245 | `fal-ai/stable-audio` | text-to-audio | 1 | ⬜ | ⬜ | 未跑 | — | — |
| 246 | `fal-ai/thinksound` | text-to-audio | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 247 | `fal-ai/hunyuan-video-foley` | text-to-audio | 2 | ⬜ | ⬜ | 未跑 | — | — |
| 248 | `fal-ai/flux-2-trainer` | training | 248 | ⬜ | ⬜ | 未跑 | — | — |
| 249 | `fal-ai/flux-2-trainer/edit` | training | 230 | ⬜ | ⬜ | 未跑 | — | — |
| 250 | `fal-ai/flux-kontext-trainer` | training | 78 | ⬜ | ⬜ | 未跑 | — | — |
| 251 | `fal-ai/flux-lora-portrait-trainer` | training | 80 | ⬜ | ⬜ | 未跑 | — | — |
| 252 | `fal-ai/qwen-image-trainer` | training | 62 | ⬜ | ⬜ | 未跑 | — | — |
| 253 | `fal-ai/turbo-flux-trainer` | training | 80 | ⬜ | ⬜ | 未跑 | — | — |
| 254 | `fal-ai/flux-krea-trainer` | training | 62 | ⬜ | ⬜ | 未跑 | — | — |
| 255 | `fal-ai/flux-lora-fast-training` | training | 62 | ⬜ | ⬜ | 未跑 | — | — |
| 256 | `fal-ai/krea-2-trainer` | training | 93 | ⬜ | ⬜ | 未跑 | — | — |
| 257 | `fal-ai/flux-2-klein-9b-base-trainer` | training | 133 | ⬜ | ⬜ | 未跑 | — | — |
| 258 | `fal-ai/qwen-image-2512-trainer` | training | 47 | ⬜ | ⬜ | 未跑 | — | — |
| 259 | `fal-ai/qwen-image-edit-trainer` | training | 124 | ⬜ | ⬜ | 未跑 | — | — |
| 260 | `fal-ai/z-image-trainer` | training | 70 | ⬜ | ⬜ | 未跑 | — | — |
| 261 | `fal-ai/wan-22-image-trainer` | training | 140 | ⬜ | ⬜ | 未跑 | — | — |
| 262 | `fal-ai/wan-22-trainer/t2v-a14b` | training | 124 | ⬜ | ⬜ | 未跑 | — | — |
| 263 | `fal-ai/wan-22-trainer/i2v-a14b` | training | 155 | ⬜ | ⬜ | 未跑 | — | — |
| 264 | `fal-ai/wan-trainer` | training | 155 | ⬜ | ⬜ | 未跑 | — | — |
| 265 | `fal-ai/hunyuan-video-lora-training` | training | 155 | ⬜ | ⬜ | 未跑 | — | — |
| 266 | `fal-ai/ltx2-video-trainer` | training | 298 | ⬜ | ⬜ | 未跑 | — | — |
