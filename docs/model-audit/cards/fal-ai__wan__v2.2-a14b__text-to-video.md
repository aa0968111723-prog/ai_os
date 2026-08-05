# fal-ai/wan/v2.2-a14b/text-to-video

> slug: `fal-ai__wan__v2.2-a14b__text-to-video` · 審計 #101 · R static+research · 2026-08-05  
> 本輪 **零 live／禁止 `--yes`**；未改 `verified`／`points`。  
> recommended **true**（文生影片經濟日常主力）。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| 站內 id | `fal-ai/wan/v2.2-a14b/text-to-video` |
| 實際 endpoint | **同 id** |
| label | Wan 2.2(開源) |
| category / tier / kind | `text-to-video` · `economy` · `video` |
| verified | **true**（目錄；OpenAPI 200；metadata **active**） |
| needs | 無（純文生影片） |
| recommended | **true** |
| strengths | 開源 14B;性價比首選、已在站內驗證 |
| bestFor | 日常分鏡影片、預算有限時的主力 |
| 廠商 | 阿里通義 **Wan 2.2 A14B** text-to-video via fal.ai |
| MODELS 序 | index **100**（審計總表 **#101**） |

**一句話**：開源 **14B Wan 2.2** 文生影——站內 **recommended** 日常分鏡主力；default **720p**／**81 frames**／**16 fps**（≈5.06s）／acceleration **regular**；按秒計費 $0.04–0.08；目錄 **12 點**對齊 720p×≈5s；**有** `negative_prompt`＋`seed`（allowlist 皆收）。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **12** |
| cost（目錄） | `$0.08/秒(720p)、$0.06/秒(580p)、$0.04/秒(480p);按秒計費(16fps基準)` |
| parseRealCost | usdMid=**0.08**（取 720p 首價）、multiplier=**5**（單鏡假設秒） |
| 估值 NT$ | 0.08 × 5 × 31 = **12.4** → **12** 點 |
| 校準判定 | **≈**（點數校準報告：估值 12.4，≈） |
| realPricePoints | **12** |
| estimatePoints | 扁平 **12**（不依實際秒數動態） |

**數值落差**

- 官方 default `num_frames=81`、`frames_per_second=16` → 時長 ≈ **5.06s**；校準用 **×5 秒** 合理。
- default `resolution=720p` → 用 $0.08/s 估 **正確對齊 points=12**。
- 若使用者未來可選更長 `num_frames`（max 161 ≈10s）或更高負載而不動態估點 → **帳單低估**（現 input 不送 frames）。
- 插幀：`num_interpolated_frames` default 1、`interpolator_model=film`、`adjust_fps_for_interpolation=true` → 輸出 fps 可能×2，時長敘事以生成 frames／base fps 為準；實帳以 fal 帳單為準。
- cost 字串未寫「點數為 6 秒基準」（與 i2v 文案不同）；校準實際用 5 秒——**文件可補**（P2）。
- **本輪禁止改 points**。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 靜態契約 | **ok** |
| OpenAPI | **200** · `WanV22A14bTextToVideoInput`／`Output` |
| metadata | **active** · Wan-2.2 Text-to-Video A14B · tags text to video, motion · updated 2026-04-21 |
| required | 僅 **`prompt`** |
| 站內 input | `{ prompt, aspect_ratio: aspect(f) }` → `16:9`／`9:16`／`1:1` 皆在 enum |
| supportsNegativePrompt | **true** ✓（schema 有；allowlist 有；常規 input 不送，generation 路徑可注入） |
| supportsSeed | **true** ✓（schema 有；allowlist 有） |
| live | **本輪未跑** |
| 輸出 | required `video` + `seed`；`extractResult` → `video.url` |
| 結論 | **ready-static** |

### OpenAPI 摘要

- Paths：`POST /fal-ai/wan/v2.2-a14b/text-to-video` + status／cancel／result
- openapi **3.0.4**；Queue `https://queue.fal.run`

| 官方 property | 型別 / 約束 | 預設 | 站內 | 備註 |
|---------------|-------------|------|------|------|
| `prompt` | string **required** | — | ✅ | |
| `aspect_ratio` | `16:9`\|`9:16`\|`1:1` | **16:9** | ✅ `aspect(f)` | 三比例合法 |
| `resolution` | 480p\|580p\|720p | **720p** | ❌ | 吃 720p＝估點假設 |
| `num_frames` | 17–161 | **81** | ❌ | ≈5s@16fps |
| `frames_per_second` | 4–60 \| null | **16** | ❌ | |
| `num_inference_steps` | 2–40 | **27** | ❌ | |
| `guidance_scale` | 1–10 | 3.5 | ❌ | |
| `guidance_scale_2` | 1–10 | **4** | ❌ | 第二段 CFG |
| `negative_prompt` | string | `""` | △ 可注入 | allowlist ✓ |
| `seed` | int \| null | — | △ 消融 | allowlist ✓ |
| `acceleration` | none\|regular | **regular** | ❌ | |
| `shift` | 1–10 | 5 | ❌ | |
| `enable_prompt_expansion` | bool | false | ❌ | |
| `num_interpolated_frames` | 0–4 | 1 | ❌ | |
| `interpolator_model` | none\|film\|rife | **film** | ❌ | |
| `adjust_fps_for_interpolation` | bool | true | ❌ | |
| `video_quality` | low…maximum | high | ❌ | |
| `video_write_mode` | fast\|balanced\|small | balanced | ❌ | |
| `enable_safety_checker` | bool | false | ❌ | |
| `enable_output_safety_checker` | bool | false | ❌ | |

### 三比例 input

| format | body |
|--------|------|
| 16:9 | `{"prompt":"…","aspect_ratio":"16:9"}` |
| 9:16 | `{"prompt":"…","aspect_ratio":"9:16"}` |
| 1:1 | `{"prompt":"…","aspect_ratio":"1:1"}` |

```ts
input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
```

## 4. 底層

| 面向 | 說明 |
|------|------|
| 架構 | **時序 DiT**（Diffusion Transformer）；A14B 量級開源影片模 |
| 文字塔 | **umT5** 多語，窗口 **512**；`textEncoderProfileFor` → **`wan`** |
| mechanics | `family: dit` |
| 雙段 CFG | `guidance_scale` + `guidance_scale_2`（站內皆不送） |
| 中文 | 生態：中文提示理解好；**畫面內中文字不可靠**（字卡另做） |
| 家族 | i2v `…/image-to-video`；LoRA 成片 `…/text-to-video/lora`；v2.5／v2.6；訓練器 wan-22-* |

## 5. 站內點數路徑

```
→ estimatePoints = 12（realPricePoints 自 $0.08×5s）
→ reserveQuota(12) → falSubmit(id) → 失敗 refund(12)
```

內部顯示／扣／退 **一致 12**。對 fal 實帳：預設 720p×~5s **≈**；更長片／更高負載未動態估。

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 模型選擇器 t2v economy | ✅ | recommended |
| WORKFLOW `wf/*` 成片鏡頭 | ✅ | draft 流步驟；`wf/narrated-scene-economy` 場景影片 |
| playbook b-roll／quote-motion／silent-to-final | ✅ | |
| negative UI | ✅ | allowlist |
| seed UI 一般 | ❌ | 消融可 |
| resolution／frames UI | ❌ | 吃 720p／81 |

**MCP 陷阱**：可傳 negative；勿假設免費加長秒數（估點仍 12）；畫面內中文勿指望。

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 日常分鏡／預算主力 | ✅ **首選** | recommended；bestFor |
| 療癒空鏡 B-roll 量產 | ✅ | playbook b-roll |
| 有聲場景經濟流 | ✅ | wf + TTS |
| 對外電影感關鍵鏡 | ❌ | Veo／Kling 旗艦 |
| 人物情緒特寫 | △ | Hailuo 更強 |
| 最省試節奏 | △ | LTX 1 點先試 |
| 自家 LoRA 成片 | ❌ 本端點 | 走 `…/text-to-video/lora` |

## 8. 文件

| 來源 | 用途 |
|------|------|
| OpenAPI | endpoint_id 本 id · **200** · 2026-08-05 |
| 模型頁 | https://fal.ai/models/fal-ai/wan/v2.2-a14b/text-to-video |
| metadata | active · commercial · 2026-04-21 |
| 站內 | models.ts L1072–1077；NEGATIVE+SEED allowlist；textEncoders wan；WORKFLOW／playbook |
| 點數 | 點數校準報告 ≈12.4 |
| 生態 | fal生態研究 Wan 2.2 A14B recommended |
| 姊妹 | `…__image-to-video.md`；`…__text-to-video__lora.md` |

## 9. 建議動作

- [x] **維持** id、points=12、recommended、verified（不改）
- [x] **維持** input prompt+aspect_ratio（enum 合法）
- [x] **維持** NEGATIVE + SEED allowlist
- [x] 九章卡 + `_index` #101
- [ ] **可選 P2**：cost 補「預設≈5s@720p；點數校準×5 秒」
- [ ] **可選 P3**：UI 暴露 resolution 480p（省點敘事）／num_frames
- [ ] **可選 P3**：一般 seed UI
- [ ] **勿** `--yes`／改 points／verified
- [ ] **無 P0 契約洞**

**L0/L1**：綠。**L2**：未跑。預設 720p 與 12 點校準一致；無 P0。
