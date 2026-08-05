# fal-ai/instant-character

> 審計：R · index **#84** · static+research · 2026-08-05  
> slug：`fal-ai__instant-character`  
> 端點／input **對齊**（`prompt`+`image_url`）。**無 P0 碼修**。零 live。禁止 `--yes`。

## 1. 身分

| 項 | 值 |
|----|-----|
| 站內 id / endpoint | `fal-ai/instant-character`（無 alias） |
| label | Instant Character 角色一致 |
| category / kind | **image-to-image** · image |
| tier | **economy** |
| points | **3** |
| cost | `$0.10/MP` |
| verified | **true**（既有；本輪未改） |
| needs | **image**（角色設定圖） |
| recommended | false |
| strengths | 單張參考圖出新姿勢新場景;寫實與插畫/動畫皆可 |
| bestFor | 繪本、吉祥物系列圖的角色一致 |
| 供應商 | InstantCharacter（騰訊 InstantX）· fal 託管 |
| 姊妹 | 旗艦寫實 `fal-ai/ideogram/character`；臉鎖定經濟 `fal-ai/flux-pulid` |

**一句話**：單張角色參考 → 新姿勢／新場景／新畫風仍長一樣——插畫／吉祥物／繪本系列一致的經濟檔。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **3** |
| cost（目錄） | `$0.10/MP` |
| `parseRealCost` | usdMid=**0.10** · ×**1MP**（標準輸出假設） |
| `realPricePoints` | `0.10 × 1 × 31 = 3.1` → **round 3** |
| `estimatePoints` | 扁平 **3** |
| 生態 | `docs/fal生態研究.md` Instant Character $0.10/MP ≈ 3 點/張(1MP) |
| 校準 | 對 **~1MP** **≈**；大圖／高解析 MP 上升則低估（P2） |

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** — required 與 input 一致 |
| OpenAPI Queue | **HTTP 200** · openapi **3.0.4** · `InstantCharacterInput`／`ImageOutput` |
| metadata | endpointId=`fal-ai/instant-character` · category image-to-image |
| 站內 input | `{ prompt: p, image_url: s }` ✅ |
| live | **未跑**（needs；禁止 --yes） |
| 結論 | **ready-static-only** |

### OpenAPI 摘要（2026-08-05）

- **Queue**：POST `/fal-ai/instant-character`
- **required**：`prompt` · `image_url`
- **選填**：`image_size`（default **`square_hd`**；enum square_hd／square／portrait_4_3／portrait_16_9／landscape_4_3／landscape_16_9 或自訂 ImageSize）· `scale`（0–2，default 1，主體強度）· `guidance_scale`（default 3.5）· `num_inference_steps`（default 28）· `num_images`（1–4）· `output_format` jpeg｜png · `negative_prompt` · `seed` · `enable_safety_checker` · `sync_mode`
- **Output**：`images[]` + `seed` + timings／nsfw／prompt — `extractResult` 吃 `images[0].url` ✅

### 三比例（現況）

| format | 站內 body | 實效 |
|--------|-----------|------|
| 16:9 / 9:16 / 1:1 | **不送** `image_size` | 吃預設 **square_hd** → 專案比例不對齊（**P1**） |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 產品 | InstantCharacter：單圖身份條件 → 姿勢／場景／風格可換、身份鎖定 |
| input | 參考圖進 **`image_url`**（單數）；提示詞描述新動作／場景 |
| image_size | schema 有、站內未映射 → 預設方圖（P1 可加 `imageSize(f)`） |
| negative | schema 有；allowlist **未**收 → 禁忌移出正向 |
| seed | schema 有；SEED_SUPPORTED 無 |
| 中文 | **提示詞建議英文**；字卡／標題勿靠此端點 |
| vs Ideogram Character | 寫實主角旗艦用 Ideogram；插畫／動畫／吉祥物用本檔 |

---

## 5. 站內扣點／退點

```
estimatePoints → 3
→ falSubmit("fal-ai/instant-character", { prompt, image_url })
→ 失敗 refund(3)
```

| 檢查 | 結果 |
|------|------|
| 顯示／扣／退 | 皆 **3** → 一致 |
| 對 ~1MP@$0.10 | **≈** |
| 多 MP 輸出 | 扁平 3 可能低估 → P2 |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| i2i economy | ✅ | needs=image |
| 情境角色一致 | △ | sc-character pick 以 Ideogram／Kontext 為主；本檔可手選 |
| MCP | ✅ | 須帶來源圖 URL |
| image_size UI | ❌ | 吃 square_hd 預設 |
| scale／CFG UI | ❌ | 工程預設 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 繪本／吉祥物系列 | ✅ | bestFor |
| 寫實見證主角跨分鏡 | △ | 優先 Ideogram Character |
| 無參考純文生 | ❌ | required image_url |
| 中文大海報字 | ❌ | 換 Qwen／Seedream |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/instant-character`（本輪 **200**） |
| Playground | https://fal.ai/models/fal-ai/instant-character |
| 生態 | `docs/fal生態研究.md` Instant Character 列 |
| 站內 | `shared/models.ts` #84 |

---

## 9. 建議動作

- [x] **維持** points=3／verified=true／needs=image／input `prompt`+`image_url`
- [ ] **P1**：`image_size: imageSize(f)` 對齊 16:9／9:16／1:1（現預設 square_hd）
- [ ] **可選 P2**：`NEGATIVE_PROMPT_SUPPORTED`／`SEED_SUPPORTED`；UI scale
- [ ] **L2**（有 KEY）：角色設定圖 + 英文姿勢／場景 prompt 出片  

**L0 結論**：OpenAPI 綠；required 對齊；**無 P0**。比例未映射為 P1。  
**未做：** live、改 points、改 verified、改 input。
