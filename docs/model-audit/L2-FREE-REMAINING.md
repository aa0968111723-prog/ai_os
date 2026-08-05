# L2 free 未 success（零成本收尾）· 2026-08-05T07:35:06.824531+00:00

softStop=500 spent=496.0 unique_success=66

## 未 success free !needs <80
共 **21**

- 1 `fal-ai/diffrhythm` — timeout_poll_120s（已計點、不重跑 --yes）
- 2 `fal-ai/bytedance/seedream/v5/text-to-image` — live 404 path + OpenAPI 404
- 5 `fal-ai/minimax-music/v2.6` — timeout_poll_120s（已計點、不重跑 --yes）
- 6 `fal-ai/cogvideox-5b` — timeout_poll_queued（已計點、不重跑 --yes）
- 8 `fal-ai/yue` — timeout_poll_120s（已計點、不重跑 --yes）
- 9 `fal-ai/kling-video/v1.6/standard/text-to-video` — timeout_poll_120s（已計點、不重跑 --yes）
- 9 `fal-ai/minimax/hailuo-2.3/standard/text-to-video` — timeout_poll_120s（已計點、不重跑 --yes）
- 11 `fal-ai/kling-video/v2.5-turbo/pro/text-to-video` — exit_-9
- 12 `fal-ai/hunyuan-video` — timeout_poll_120s（已計點、不重跑 --yes）
- 12 `fal-ai/hunyuan-video-v1.5/text-to-video` — timeout_poll_120s（已計點、不重跑 --yes）
- 12 `fal-ai/mochi-v1` — timeout_poll_120s（已計點、不重跑 --yes）
- 15 `fal-ai/minimax/hailuo-2.3/pro/text-to-video` — timeout_poll_120s（已計點、不重跑 --yes）
- 16 `fal-ai/luma-dream-machine/ray-2` — timeout_poll_120s（已計點、不重跑 --yes）
- 16 `fal-ai/minimax/video-01-director` — timeout_poll_120s（已計點、不重跑 --yes）
- 16 `fal-ai/wan/v2.5/text-to-video` — timeout_poll_120s（已計點、不重跑 --yes）
- 16 `fal-ai/wan/v2.6/text-to-video` — aborted_softstop
- 17 `fal-ai/kling-video/o3/pro/text-to-video` — never attempted (pts 超出 softStop 剩餘)
- 19 `fal-ai/bytedance/seedance/v1/pro/text-to-video` — never attempted (pts 超出 softStop 剩餘)
- 31 `fal-ai/veo3.1` — never attempted (pts 超出 softStop 剩餘)
- 47 `bytedance/seedance-2.0/text-to-video` — never attempted (pts 超出 softStop 剩餘)
- 58 `fal-ai/veo2` — never attempted (pts 超出 softStop 剩餘)

## expensive free pts≥80 未 live

- 93 `fal-ai/minimax/voice-design` — softStop 不足

## 空輸入連通 cancel_unconfirmed（32）

空 `{}` 被 200 受理且 cancel 回 ALREADY_COMPLETED。連通成立，但**勿解讀為已完成合法生成**；也不自動 verified。

- `fal-ai/qwen-image-2/pro/text-to-image`
- `fal-ai/flux/dev`
- `fal-ai/flux/schnell`
- `fal-ai/flux-2`
- `fal-ai/recraft/v3/text-to-image`
- `fal-ai/bytedance/seedream/v5/text-to-image`
- `fal-ai/imagen4/preview/ultra`
- `fal-ai/imagen4/preview/fast`
- `fal-ai/flux-2-pro/edit`
- `fal-ai/nano-banana/edit`
- `fal-ai/bytedance/seedream/v4/edit`
- `openai/gpt-image-2/edit`
- `fal-ai/qwen-image-2/edit`
- `fal-ai/flux/dev/redux`
- `fal-ai/bria/background/replace`
- `fal-ai/image-editing/object-removal`
- `fal-ai/bria/product-shot`
- `fal-ai/image-editing/photo-restoration`
- `fal-ai/topaz/upscale/image`
- `fal-ai/seedvr/upscale/image`
- `fal-ai/recraft/upscale/crisp`
- `fal-ai/recraft/upscale/creative`
- `fal-ai/minimax/hailuo-2.3/standard/text-to-video`
- `fal-ai/kling-video/v2.6/pro/text-to-video`
- `fal-ai/minimax/hailuo-02/standard/text-to-video`
- `fal-ai/minimax/video-01-director`
- `wan/v2.6`
- `fal-ai/wan/v2.2-a14b/text-to-video/lora`
- `wan/v2.6/image-to-video`
- `fal-ai/wan/v2.2-a14b/image-to-video`
- `fal-ai/luma-dream-machine/ray-2-flash/modify`
- `fal-ai/elevenlabs/sound-effects/v2`
