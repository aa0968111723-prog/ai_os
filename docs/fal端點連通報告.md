# fal 端點連通報告(管道通就好,不實際生成)

> 產生方式:`FAL_KEY=... npx tsx scripts/probe-fal-endpoints.ts --yes`
> 方法:對每個端點送空輸入 `{}`,靠 422/400 驗證失敗確認「端點存在＋金鑰通＋未生成」;200/202 會立即取消。
> 唯一端點數:**251**|連通:**214**|取消未確認:**37**|404 不存在:**0**|403 無權限:**0**|暫時性:**0**

## ❗ 需要處理:端點不存在(404,該修 shared/models.ts 的 id/endpoint)

(無——所有端點都存在)

## ⚠️ 需要開通:無權限(403,請在 fal 後台為金鑰開通該模型)

(無)

## ❗ 需核對:空輸入已入列但取消未確認

| 端點 | HTTP | 說明 |
|---|---|---|
| `fal-ai/flux-2-pro` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/qwen-image-2/pro/text-to-image` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `openai/gpt-image-2` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/flux/dev` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/ideogram/v3` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/flux/schnell` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/qwen-image-2/text-to-image` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/flux-pro/v1.1-ultra` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/bytedance/seedream/v5/text-to-image` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/recraft/v3/text-to-image` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/recraft/v4.1/text-to-image` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/sana` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/flux-pro/kontext` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/nano-banana-pro/edit` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/bytedance/seedream/v4/edit` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/bytedance/seededit/v3/edit-image` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/qwen-image-2/edit` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/bria/background/replace` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/bria/expand` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/bria/product-shot` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/image-apps-v2/photo-restoration` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/topaz/upscale/image` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/seedvr/upscale/image` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `clarityai/crystal-upscaler` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/recraft/upscale/crisp` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/recraft/upscale/creative` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/ideogram/remove-background` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/kling-video/v2.5-turbo/pro/text-to-video` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/pika/v2.2/text-to-video` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/kling-video/v2.5-turbo/pro/image-to-video` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/veo3.1/image-to-video` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/bytedance/seedance/v1.5/pro/image-to-video` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/minimax/video-01/image-to-video` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/minimax/video-01-subject-reference` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/workflow-utilities/auto-subtitle` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/elevenlabs/speech-to-text/scribe-v2` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |
| `fal-ai/elevenlabs/tts/multilingual-v2` | 200 | 空輸入已被受理,但取消未確認(cancel → HTTP 400:{"status":"ALREADY_COMPLETED"});需到 Fal request history 核對 |

## 全部結果(依類別)

### 文生圖

| 端點 | 狀態 | HTTP | 影響的模型 |
|---|---|---|---|
| `fal-ai/flux-2-pro` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/flux-2/pro |
| `fal-ai/qwen-image-2/pro/text-to-image` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/qwen-image-2/pro/text-to-image |
| `openai/gpt-image-2` | ❗ 空輸入已入列但取消未確認 | 200 | openai/gpt-image-2 |
| `fal-ai/bytedance/seedream/v4.5/text-to-image` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/bytedance/seedream/v4.5/text-to-image |
| `fal-ai/nano-banana-2` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/nano-banana-2 |
| `fal-ai/flux/dev` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/flux/dev |
| `fal-ai/ideogram/v3` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/ideogram/v3 |
| `fal-ai/flux/schnell` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/flux/schnell |
| `fal-ai/qwen-image-2/text-to-image` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/qwen-image-2/text-to-image |
| `fal-ai/kolors` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/kolors |
| `fal-ai/fast-lightning-sdxl` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/fast-lightning-sdxl |
| `fal-ai/flux-2-flex` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/flux-2-flex |
| `fal-ai/flux-2` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/flux-2 |
| `fal-ai/flux-pro/v1.1-ultra` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/flux-pro/v1.1-ultra |
| `fal-ai/bytedance/seedream/v5/text-to-image` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/bytedance/seedream/v5/text-to-image |
| `ideogram/v4` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/ideogram/v4 |
| `fal-ai/recraft/v3/text-to-image` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/recraft/v3/text-to-image |
| `fal-ai/recraft/v4.1/text-to-image` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/recraft/v4.1/text-to-image |
| `fal-ai/nano-banana-pro` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/nano-banana-pro |
| `fal-ai/imagen4/preview/ultra` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/imagen4/preview/ultra |
| `fal-ai/imagen4/preview/fast` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/imagen4/preview/fast |
| `fal-ai/qwen-image-max/text-to-image` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/qwen-image-max/text-to-image |
| `fal-ai/hunyuan-image/v3/text-to-image` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/hunyuan-image/v3 |
| `fal-ai/sana` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/sana |
| `fal-ai/playground-v25` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/playground-v25 |
| `fal-ai/luma-photon` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/luma-photon |
| `fal-ai/aura-flow` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/aura-flow |
| `fal-ai/flux-lora` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/flux-lora |
| `fal-ai/flux-2/lora` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/flux-2/lora |
| `fal-ai/lora` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/lora |

### 圖生圖・編輯

| 端點 | 狀態 | HTTP | 影響的模型 |
|---|---|---|---|
| `fal-ai/nano-banana-2/edit` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/nano-banana-2/edit |
| `fal-ai/flux-2-pro/edit` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/flux-2/pro/edit |
| `fal-ai/bytedance/seedream/v4.5/edit` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/bytedance/seedream/v4.5/edit |
| `fal-ai/flux-kontext/dev` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/flux-kontext/dev |
| `fal-ai/flux-pro/kontext` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/flux-pro/kontext |
| `fal-ai/qwen-image-edit` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/qwen-image-edit |
| `fal-ai/qwen-image-edit-plus` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/qwen-image-edit-plus |
| `fal-ai/flux/dev/image-to-image` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/flux/dev/image-to-image |
| `fal-ai/fast-sdxl/image-to-image` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/fast-sdxl/image-to-image |
| `fal-ai/flux-pro/kontext/max` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/flux-pro/kontext/max |
| `fal-ai/nano-banana-pro/edit` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/nano-banana-pro/edit |
| `fal-ai/nano-banana/edit` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/nano-banana/edit |
| `fal-ai/bytedance/seedream/v4/edit` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/bytedance/seedream/v4/edit |
| `fal-ai/bytedance/seededit/v3/edit-image` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/bytedance/seededit/v3/edit-image |
| `fal-ai/qwen-image-2/edit` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/qwen-image-2/edit |
| `openai/gpt-image-2/edit` | ✅ 連通(誤排佇列已取消) | 200 | openai/gpt-image-2/edit |
| `fal-ai/ideogram/v3/remix` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/ideogram/v3/remix |
| `fal-ai/flux/dev/redux` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/flux/dev/redux |
| `fal-ai/iclight-v2` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/iclight-v2 |
| `fal-ai/bria/background/replace` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/bria/background/replace |
| `fal-ai/bria/background/remove` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/bria/background/remove |
| `fal-ai/bria/expand` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/bria/expand |
| `fal-ai/image-editing/object-removal` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/image-editing/object-removal |
| `fal-ai/bria/product-shot` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/bria/product-shot |
| `fal-ai/codeformer` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/codeformer |
| `fal-ai/image-editing/photo-restoration` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/image-editing/photo-restoration |
| `fal-ai/image-apps-v2/photo-restoration` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/image-apps-v2/photo-restoration |
| `fal-ai/esrgan` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/esrgan |
| `fal-ai/ddcolor` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/ddcolor |
| `fal-ai/clarity-upscaler` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/clarity-upscaler |
| `fal-ai/topaz/upscale/image` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/topaz/upscale/image |
| `fal-ai/aura-sr` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/aura-sr |
| `fal-ai/ccsr` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/ccsr |
| `fal-ai/supir` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/supir |
| `fal-ai/thera` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/thera |
| `fal-ai/seedvr/upscale/image` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/seedvr/upscale/image |
| `clarityai/crystal-upscaler` | ❗ 空輸入已入列但取消未確認 | 200 | clarityai/crystal-upscaler |
| `fal-ai/recraft/upscale/crisp` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/recraft/upscale/crisp |
| `fal-ai/recraft/upscale/creative` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/recraft/upscale/creative |
| `fal-ai/swin2sr` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/swin2sr |
| `fal-ai/drct-super-resolution` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/drct-super-resolution |
| `fal-ai/creative-upscaler` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/creative-upscaler |
| `fal-ai/mix-dehaze-net` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/mix-dehaze-net |
| `fal-ai/birefnet/v2` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/birefnet/v2 |
| `fal-ai/birefnet` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/birefnet |
| `fal-ai/ideogram/remove-background` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/ideogram/remove-background |
| `pixelcut/background-removal` | ✅ 連通(誤排佇列已取消) | 200 | pixelcut/background-removal |
| `fal-ai/imageutils/rembg` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/imageutils/rembg |
| `fal-ai/ben/v2/image` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/ben/v2/image |
| `smoretalk-ai/rembg-enhance` | ✅ 連通(誤排佇列已取消) | 200 | smoretalk-ai/rembg-enhance |
| `fal-ai/ideogram/v3/replace-background` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/ideogram/v3/replace-background |
| `fal-ai/image-editing/background-change` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/image-editing/background-change |
| `fal-ai/ideogram/character` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/ideogram/character |
| `fal-ai/instant-character` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/instant-character |
| `fal-ai/flux-pulid` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/flux-pulid |
| `fal-ai/instantid` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/instantid |
| `fal-ai/photomaker` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/photomaker |
| `fal-ai/face-to-sticker` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/face-to-sticker |
| `fal-ai/qwen-image-edit-plus-lora-gallery/next-scene` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/qwen-image-edit-plus-lora-gallery/next-scene |
| `fal-ai/minimax/image-01/subject-reference` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/minimax/image-01/subject-reference |
| `fal-ai/image-editing/expression-change` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/image-editing/expression-change |
| `easel-ai/easel-avatar` | ✅ 連通(誤排佇列已取消) | 200 | easel-ai/easel-avatar |
| `fal-ai/image-apps-v2/headshot-photo` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/image-apps-v2/headshot-photo |
| `fal-ai/finegrain-eraser` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/finegrain-eraser |
| `fal-ai/recraft/vectorize` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/recraft/vectorize |
| `fal-ai/image2svg` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/image2svg |

### 文生影片

| 端點 | 狀態 | HTTP | 影響的模型 |
|---|---|---|---|
| `fal-ai/veo3.1` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/veo3.1 |
| `fal-ai/sora-2/text-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/sora-2/text-to-video |
| `fal-ai/kling-video/v2.5-turbo/pro/text-to-video` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/kling-video/v2.5-turbo/pro/text-to-video |
| `fal-ai/veo3.1/fast` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/veo3.1/fast |
| `fal-ai/wan/v2.2-a14b/text-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/wan/v2.2-a14b/text-to-video |
| `fal-ai/minimax/hailuo-2.3/standard/text-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/minimax/hailuo-2.3/standard/text-to-video |
| `fal-ai/ltx-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/ltx-video |
| `fal-ai/veo2` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/veo2 |
| `fal-ai/kling-video/v2.6/pro/text-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/kling-video/v2.6/pro/text-to-video |
| `fal-ai/kling-video/o3/pro/text-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/kling-video/o3/pro/text-to-video |
| `fal-ai/minimax/hailuo-2.3/pro/text-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/minimax/hailuo-2.3/pro/text-to-video |
| `fal-ai/luma-dream-machine/ray-2` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/luma-dream-machine/ray-2 |
| `fal-ai/bytedance/seedance/v1/pro/text-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/bytedance/seedance/v1/pro/text-to-video |
| `fal-ai/bytedance/seedance/v1.5/pro/text-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/bytedance/seedance/v1.5/pro/text-to-video |
| `bytedance/seedance-2.0/text-to-video` | ✅ 連通(誤排佇列已取消) | 200 | bytedance/seedance-2.0/text-to-video |
| `fal-ai/veo3.1/lite` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/veo3.1/lite |
| `fal-ai/minimax/hailuo-02/standard/text-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/minimax/hailuo-02/standard/text-to-video |
| `fal-ai/minimax/video-01-director` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/minimax/video-01-director |
| `fal-ai/wan-25/text-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/wan/v2.5/text-to-video |
| `wan/v2.6` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/wan/v2.6/text-to-video |
| `fal-ai/hunyuan-video-v1.5/text-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/hunyuan-video-v1.5/text-to-video |
| `fal-ai/pika/v2.2/text-to-video` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/pika/v2.2/text-to-video |
| `fal-ai/luma-dream-machine/ray-2-flash` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/luma-dream-machine/ray-2-flash |
| `fal-ai/bytedance/seedance/v1/lite/text-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/bytedance/seedance/v1/lite/text-to-video |
| `fal-ai/pixverse/v5.5/text-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/pixverse/v5.5/text-to-video |
| `fal-ai/pixverse/v6/text-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/pixverse/v6/text-to-video |
| `fal-ai/kling-video/v1.6/standard/text-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/kling-video/v1.6/standard/text-to-video |
| `fal-ai/wan-t2v` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/wan-t2v |
| `fal-ai/hunyuan-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/hunyuan-video |
| `fal-ai/mochi-v1` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/mochi-v1 |
| `fal-ai/cogvideox-5b` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/cogvideox-5b |
| `fal-ai/wan/v2.2-a14b/text-to-video/lora` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/wan/v2.2-a14b/text-to-video/lora |

### 圖生影片

| 端點 | 狀態 | HTTP | 影響的模型 |
|---|---|---|---|
| `fal-ai/kling-video/v2.6/pro/image-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/kling-video/v2.6/pro/image-to-video |
| `fal-ai/kling-video/v2.5-turbo/pro/image-to-video` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/kling-video/v2.5-turbo/pro/image-to-video |
| `fal-ai/kling-video/v3/pro/image-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/kling-video/v3/pro/image-to-video |
| `fal-ai/veo3.1/image-to-video` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/veo3.1/image-to-video |
| `fal-ai/veo2/image-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/veo2/image-to-video |
| `fal-ai/minimax/hailuo-2.3/pro/image-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/minimax/hailuo-2.3/pro/image-to-video |
| `fal-ai/bytedance/seedance/v1.5/pro/image-to-video` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/bytedance/seedance/v1.5/pro/image-to-video |
| `fal-ai/luma-dream-machine/ray-2/image-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/luma-dream-machine/ray-2/image-to-video |
| `wan/v2.6/image-to-video` | ✅ 連通(誤排佇列已取消) | 200 | wan/v2.6/image-to-video |
| `fal-ai/wan/v2.2-a14b/image-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/wan/v2.2-a14b/image-to-video |
| `fal-ai/minimax/hailuo-2.3/standard/image-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/minimax/hailuo-2.3/standard/image-to-video |
| `fal-ai/minimax/hailuo-2.3-fast/pro/image-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/minimax/hailuo-2.3-fast/pro/image-to-video |
| `fal-ai/bytedance/seedance/v1/lite/image-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/bytedance/seedance/v1/lite/image-to-video |
| `fal-ai/luma-dream-machine/ray-2-flash/image-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/luma-dream-machine/ray-2-flash/image-to-video |
| `fal-ai/hunyuan-video-image-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/hunyuan-video-image-to-video |
| `fal-ai/pixverse/v5/image-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/pixverse/v5/image-to-video |
| `fal-ai/runway-gen3/turbo/image-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/runway-gen3/turbo/image-to-video |
| `fal-ai/minimax/video-01/image-to-video` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/minimax/video-01/image-to-video |
| `fal-ai/minimax/video-01-subject-reference` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/minimax/video-01-subject-reference |
| `fal-ai/wan-i2v` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/wan-i2v |
| `fal-ai/ltx-video-v095/image-to-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/ltx-video-v095/image-to-video |
| `fal-ai/framepack` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/framepack |
| `fal-ai/stable-video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/stable-video |
| `fal-ai/fast-svd-lcm` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/fast-svd-lcm |

### 影片轉影片

| 端點 | 狀態 | HTTP | 影響的模型 |
|---|---|---|---|
| `fal-ai/topaz/upscale/video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/topaz/upscale/video |
| `fal-ai/sync-lipsync/v2/pro` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/sync-lipsync/v2/pro |
| `fal-ai/luma-dream-machine/ray-2/modify` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/luma-dream-machine/ray-2/modify |
| `fal-ai/luma-dream-machine/ray-2-flash/modify` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/luma-dream-machine/ray-2-flash/modify |
| `fal-ai/sync-lipsync` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/sync-lipsync |
| `fal-ai/video-upscaler` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/video-upscaler |
| `bria/video/background-removal` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/bria/video/background-removal、bria/video/background-removal/realtime |
| `fal-ai/rife/video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/rife/video |
| `fal-ai/sync-lipsync/v3` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/sync-lipsync/v3 |
| `fal-ai/sync-lipsync/v2` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/sync-lipsync/v2 |
| `decart/lucy-restyle` | ✅ 連通(誤排佇列已取消) | 200 | decart/lucy-restyle |
| `fal-ai/seedvr/upscale/video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/seedvr/upscale/video |
| `fal-ai/ben/v2/video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/ben/v2/video |
| `veed/lipsync` | ✅ 連通(誤排佇列已取消) | 200 | veed/lipsync |
| `veed/video-background-removal` | ✅ 連通(誤排佇列已取消) | 200 | veed/video-background-removal |
| `decart/lucy-edit/fast` | ✅ 連通(誤排佇列已取消) | 200 | decart/lucy-edit |
| `fal-ai/wan-vace-14b/outpainting` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/wan-vace-14b/outpainting |
| `fal-ai/latentsync` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/latentsync |
| `fal-ai/musetalk` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/musetalk |
| `bria/video/background-removal/v3` | ✅ 連通(誤排佇列已取消) | 200 | bria/video/background-removal/v3 |
| `veed/video-background-removal/fast` | ✅ 連通(誤排佇列已取消) | 200 | veed/video-background-removal/fast |
| `veed/video-background-removal/green-screen` | ✅ 連通(誤排佇列已取消) | 200 | veed/video-background-removal/green-screen |
| `fal-ai/birefnet/v2/video` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/birefnet/v2/video |
| `fal-ai/auto-caption` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/auto-caption |
| `fal-ai/workflow-utilities/auto-subtitle` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/workflow-utilities/auto-subtitle |
| `veed/subtitles` | ✅ 連通(誤排佇列已取消) | 200 | veed/subtitles |
| `fal-ai/bria/video/eraser` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/bria/video/eraser |

### 圖片轉文字

| 端點 | 狀態 | HTTP | 影響的模型 |
|---|---|---|---|
| `fal-ai/any-llm/vision` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/any-llm/vision#gemini-2.5-pro、fal-ai/any-llm/vision#claude-sonnet-4.5、fal-ai/any-llm/vision#gpt-5、fal-ai/any-llm/vision#gemini-2.5-flash |
| `fal-ai/moondream-next` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/moondream-next |
| `fal-ai/florence-2-large/more-detailed-caption` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/florence-2-large/more-detailed-caption |
| `fal-ai/florence-2-large/ocr` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/florence-2-large/ocr |
| `fal-ai/moondream2` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/moondream2 |
| `fal-ai/got-ocr/v2` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/got-ocr/v2 |

### 語音轉文字

| 端點 | 狀態 | HTTP | 影響的模型 |
|---|---|---|---|
| `fal-ai/elevenlabs/speech-to-text` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/elevenlabs/speech-to-text |
| `fal-ai/whisper` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/whisper、fal-ai/whisper#translate、fal-ai/whisper#chapters |
| `fal-ai/wizper` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/wizper、fal-ai/wizper#draft |
| `fal-ai/elevenlabs/speech-to-text/scribe-v2` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/elevenlabs/speech-to-text#keyterms、fal-ai/elevenlabs/speech-to-text/scribe-v2 |
| `fal-ai/speech-to-text` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/speech-to-text |
| `fal-ai/speech-to-text/turbo` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/speech-to-text/turbo |
| `fal-ai/speech-to-text/stream` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/speech-to-text/stream |

### 文字轉語音

| 端點 | 狀態 | HTTP | 影響的模型 |
|---|---|---|---|
| `fal-ai/elevenlabs/tts/eleven-v3` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/elevenlabs/tts/eleven-v3 |
| `fal-ai/minimax/speech-02-hd` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/minimax/speech-02-hd |
| `fal-ai/elevenlabs/tts/multilingual-v2` | ❗ 空輸入已入列但取消未確認 | 200 | fal-ai/elevenlabs/tts/multilingual-v2 |
| `fal-ai/elevenlabs/tts/turbo-v2.5` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/elevenlabs/tts/turbo-v2.5 |
| `fal-ai/qwen-3-tts/text-to-speech/1.7b` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/qwen-3-tts/text-to-speech/1.7b |
| `fal-ai/dia-tts` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/dia-tts |
| `fal-ai/chatterbox/text-to-speech/multilingual` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/chatterbox/text-to-speech |
| `fal-ai/kokoro/mandarin-chinese` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/kokoro/mandarin-chinese |
| `fal-ai/minimax/speech-2.6-hd` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/minimax/speech-2.6-hd |
| `fal-ai/qwen-3-tts/text-to-speech/0.6b` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/qwen-3-tts/text-to-speech/0.6b |
| `fal-ai/index-tts-2/text-to-speech` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/index-tts-2/text-to-speech |
| `fal-ai/minimax/voice-clone` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/minimax/voice-clone |
| `fal-ai/qwen-3-tts/clone-voice/1.7b` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/qwen-3-tts/clone-voice/1.7b |
| `fal-ai/minimax/voice-design` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/minimax/voice-design |
| `fal-ai/f5-tts` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/f5-tts |
| `fal-ai/vibevoice` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/vibevoice |
| `fal-ai/vibevoice/7b` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/vibevoice/7b |
| `fal-ai/dia-tts/voice-clone` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/dia-tts/voice-clone |
| `fal-ai/elevenlabs/text-to-dialogue/eleven-v3` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/elevenlabs/text-to-dialogue/eleven-v3 |
| `fal-ai/gemini-tts` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/gemini-tts |
| `fal-ai/zonos` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/zonos |
| `fal-ai/orpheus-tts` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/orpheus-tts |

### 文字轉音頻

| 端點 | 狀態 | HTTP | 影響的模型 |
|---|---|---|---|
| `fal-ai/lyria2` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/lyria2 |
| `fal-ai/elevenlabs/music` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/elevenlabs/music |
| `fal-ai/stable-audio-25/text-to-audio` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/stable-audio-25/text-to-audio |
| `fal-ai/minimax-music` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/minimax-music |
| `fal-ai/elevenlabs/sound-effects/v2` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/elevenlabs/sound-effects/v2 |
| `cassetteai/sound-effects-generator` | ✅ 連通(誤排佇列已取消) | 200 | cassetteai/sound-effects-generator |
| `fal-ai/ace-step` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/ace-step |
| `fal-ai/minimax-music/v2.6` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/minimax-music/v2.6 |
| `fal-ai/minimax-music/v2` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/minimax-music/v2 |
| `sonilo/v1.1/text-to-music` | ✅ 連通(誤排佇列已取消) | 200 | sonilo/v1.1/text-to-music |
| `fal-ai/diffrhythm` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/diffrhythm |
| `cassetteai/music-generator` | ✅ 連通(誤排佇列已取消) | 200 | cassetteai/music-generator |
| `fal-ai/mmaudio-v2` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/mmaudio-v2 |
| `fal-ai/mmaudio-v2/text-to-audio` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/mmaudio-v2/text-to-audio |
| `fal-ai/yue` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/yue |
| `fal-ai/stable-audio` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/stable-audio |
| `fal-ai/thinksound` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/thinksound |
| `fal-ai/hunyuan-video-foley` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/hunyuan-video-foley |

### 訓練(LoRA)

| 端點 | 狀態 | HTTP | 影響的模型 |
|---|---|---|---|
| `fal-ai/flux-2-trainer` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/flux-2-trainer |
| `fal-ai/flux-2-trainer/edit` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/flux-2-trainer/edit |
| `fal-ai/flux-kontext-trainer` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/flux-kontext-trainer |
| `fal-ai/flux-lora-portrait-trainer` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/flux-lora-portrait-trainer |
| `fal-ai/qwen-image-trainer` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/qwen-image-trainer |
| `fal-ai/turbo-flux-trainer` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/turbo-flux-trainer |
| `fal-ai/flux-krea-trainer` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/flux-krea-trainer |
| `fal-ai/flux-lora-fast-training` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/flux-lora-fast-training |
| `fal-ai/krea-2-trainer` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/krea-2-trainer |
| `fal-ai/flux-2-klein-9b-base-trainer` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/flux-2-klein-9b-base-trainer |
| `fal-ai/qwen-image-2512-trainer` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/qwen-image-2512-trainer |
| `fal-ai/qwen-image-edit-trainer` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/qwen-image-edit-trainer |
| `fal-ai/z-image-trainer` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/z-image-trainer |
| `fal-ai/wan-22-image-trainer` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/wan-22-image-trainer |
| `fal-ai/wan-22-trainer/t2v-a14b` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/wan-22-trainer/t2v-a14b |
| `fal-ai/wan-22-trainer/i2v-a14b` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/wan-22-trainer/i2v-a14b |
| `fal-ai/wan-trainer` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/wan-trainer |
| `fal-ai/hunyuan-video-lora-training` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/hunyuan-video-lora-training |
| `fal-ai/ltx2-video-trainer` | ✅ 連通(誤排佇列已取消) | 200 | fal-ai/ltx2-video-trainer |

## 下一步

1. **404** 的端點:到 fal.ai/models 搜現行名稱,修 `shared/models.ts` 的 `id`/`endpoint`,再重跑本腳本。
2. **403** 的端點:到 fal 後台為金鑰開通,或改用同類替代模型。
3. **連通但 `verified:false`** 的模型:連通只證明「叫得動」;要標 `verified:true` 仍需一次真實生成確認輸出正常(用 `npx tsx scripts/verify-models.ts --probe "<id>" --yes`,會扣費)。
4. **暫時性/限流**:稍後重試;必要時調低 `--concurrency`。

