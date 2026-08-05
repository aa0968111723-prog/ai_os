# fal-ai/wan/v2.2-a14b/image-to-video

> slug: `fal-ai__wan__v2.2-a14b__image-to-video` · 審計 #138 · R static+research · 2026-08-05  
> 本輪 **零 live／禁止 `--yes`**；未改 `verified`／`points`。  
> recommended **true**（圖生影片日常主力／showdown winner）。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| 站內 id | `fal-ai/wan/v2.2-a14b/image-to-video` |
| 實際 endpoint | **同 id** |
| label | Wan 2.2 圖生(開源) |
| category / tier / kind | `image-to-video` · `economy` · `video` |
| verified | **true**（目錄；OpenAPI 200；metadata **active**） |
| needs | **image**（首格） |
| recommended | **true** |
| sourceHint | 作為首格的圖(素材庫或網址) |
| strengths | 開源 14B 的 i2v 版;性價比與可控性最佳的日常主力 |
| bestFor | 把 FLUX/Seedream 分鏡圖批量動起來 |
| 廠商 | 阿里通義 **Wan 2.2 A14B** image-to-video via fal.ai |
| MODELS 序 | index **137**（審計總表 **#138**） |

**一句話**：Wan 2.2 **i2v**——必填 `prompt`+`image_url`；站內只送這兩欄，**aspect_ratio 吃 auto**（跟首格）；default **720p**／81 frames／16fps；目錄 **6 點**校準口徑偏 **480p×≈5s**，與 OpenAPI default **720p** **不一致**（見 §2／§9 **P0 帳單風險**，本輪不改 points）。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **6** |
| cost（目錄） | `480p $0.04/秒–720p $0.08/秒;按秒計費,點數為 6 秒基準` |
| parseRealCost | usdMid=**0.04**（字串**先**出現 480p 價）、multiplier=**5** |
| 估值 NT$ | 0.04 × 5 × 31 = **6.2** → **6** 點（**480p 假設**） |
| 校準判定 | **≈**（報告：6.2，≈）——**前提是 480p** |
| realPricePoints | **6** |
| estimatePoints | 扁平 **6** |

**數值落差（重要）**

1. **OpenAPI default `resolution=720p`**，站內 **不送** resolution → 實跑多半 **720p**。  
   720p×5s：$0.08×5×31 = **12.4** → 應對 **≈12 點**，但站內只扣 **6** → **平台約 2× 低估**（對 fal 帳單風險）。
2. cost 寫「6 秒基準」、parse 用 **×5 秒**（與 t2v／num_frames=81@16fps 一致）——文案秒數略混。
3. 另有 `end_image_url`（首尾幀）未暴露。
4. **本輪禁止改 points**；P0 建議見 §9（可選 input 鎖 480p **或** 升點——需產品決策，非本輪自動改碼）。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 | **ok**（required 映射正確） |
| OpenAPI | **200** · `WanV22A14bImageToVideoInput`／`Output` |
| metadata | **active** · Wan v2.2 A14B · updated 2026-04-21 |
| required | **`prompt` + `image_url`** |
| 站內 input | `{ prompt: p, image_url: s }` ✓ |
| supportsNegativePrompt | **true** ✓ |
| supportsSeed | **false**（schema **有** seed；**未**進 `SEED_SUPPORTED`）→ P3 |
| live | **未跑**（needs） |
| 輸出 | `video` + `seed`；extractResult `video.url` |
| 結論 | **ready-static**；**帳單 P0 風險**（720p default vs 6 點） |

### OpenAPI 摘要

| 官方 property | 型別 / 約束 | 預設 | 站內 | 備註 |
|---------------|-------------|------|------|------|
| `prompt` | string **required** | — | ✅ | |
| `image_url` | string **required** | — | ✅ | 不符 AR 時 resize+center crop |
| `end_image_url` | string \| null | — | ❌ | 尾幀未暴露 |
| `aspect_ratio` | auto\|16:9\|9:16\|1:1 | **auto** | ❌ | 跟首格；**不**送 `aspect(f)` 正確 |
| `resolution` | 480p\|580p\|720p | **720p** | ❌ | **與 6 點假設衝突** |
| `num_frames` | 17–161 | **81** | ❌ | |
| `frames_per_second` | 4–60 | 16 | ❌ | |
| `num_inference_steps` | 2–40 | 27 | ❌ | |
| `guidance_scale` | 1–10 | 3.5 | ❌ | |
| `guidance_scale_2` | 1–10 | **3.5** | ❌ | t2v 預設為 4 |
| `negative_prompt` | string | `""` | △ 可注入 | allowlist ✓ |
| `seed` | int \| null | — | ❌ | **未**入 SEED allowlist |
| `acceleration` | none\|regular | regular | ❌ | |
| 其餘插幀／quality／safety | （同 t2v 族） | … | ❌ | |

### input 本機

| format | body |
|--------|------|
| 任意 | `{"prompt":"…","image_url":"…"}` |

```ts
input: (p, _f, s) => ({ prompt: p, image_url: s }),
```

## 4. 底層

| 面向 | 說明 |
|------|------|
| 架構 | 與 t2v 同 **DiT A14B**；首格條件化 i2v |
| 文字塔 | umT5 **512**；profile **`wan`** |
| mechanics | `family: dit` |
| AR | default **auto**（依輸入圖）——站內不覆寫正確 |
| 中文 | 提示理解好；畫面內中文不可靠 |
| 家族 | t2v 本族；Kling／Hailuo 為旗艦替代 |

## 5. 站內點數路徑

```
→ needs=image 守門
→ estimatePoints = 6
→ reserveQuota(6) → falSubmit → refund(6)
```

帳本內部自洽 **6**。對 fal：**疑似 720p 實帳 ≈12 點級**（見 §2）。

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 模型選擇器 i2v economy | ✅ | recommended |
| `sc-animate-storyboard` | ✅ | **pickIds[0]** |
| STYLE_SHOWDOWNS「分鏡圖動起來」 | ✅ | **winnerId** |
| negative | ✅ | allowlist |
| seed 消融 | ❌ | 未入 SEED_SUPPORTED |
| resolution／end_image | ❌ | |

**MCP 陷阱**：必須首格圖；勿送非法欄；估點 6 不隨 720p 實價。

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 分鏡圖批量動起來 | ✅ **首選** | showdown winner；sc-animate-storyboard |
| 量大可控成本 | ✅ | recommended |
| 人物情緒／表演 | △ | Hailuo 更強 |
| 對外關鍵電影鏡 | ❌ | Veo／Kling |
| 無首格純文生 | ❌ | 走 t2v 同族 |
| 首尾幀控制 | △ | schema 有 end_image；未暴露 |

## 8. 文件

| 來源 | 用途 |
|------|------|
| OpenAPI | 本 id · **200** |
| 模型頁 | https://fal.ai/models/fal-ai/wan/v2.2-a14b/image-to-video |
| metadata | active · 2026-04-21 |
| 站內 | models.ts L1366–1371；NEGATIVE 有、SEED **無**；sc-animate-storyboard；showdown |
| 點數 | 校準 ≈6.2（**480p** 假設） |
| 姊妹 | t2v 卡；kling v2.5-turbo i2v runner-up |

## 9. 建議動作

- [x] **維持** id、needs=image、input prompt+image_url、recommended、verified（不改）
- [x] **維持** points=**6** 本輪不改（改點需產品決策）
- [x] 九章卡 + `_index` #138
- [ ] **P0 帳單（建議二選一，本輪未自動改碼）**  
  - **A**：`input` 加 `resolution: "480p"` → 對齊 6 點／經濟定位；或  
  - **B**：points 升 **12** 並改 cost 敘事對齊 default 720p  
- [ ] **P2**：cost 字串統一「×5s 校準」vs「6 秒基準」；註明 default 720p
- [ ] **P3**：`SEED_SUPPORTED` 收錄本 id（schema 有 seed）
- [ ] **P3**：可選 end_image_url／resolution UI
- [ ] **勿** `--yes`／批量 verified

**L0**：required 契約綠。**L1**：OpenAPI 對齊。**帳單**：**P0 風險**（720p default vs 6 點／480p 校準）——建議產品選定 A 或 B 後最小修 `models.ts`。**無** 422 型契約破洞。
