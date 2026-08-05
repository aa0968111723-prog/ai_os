# fal-ai/ideogram/character

> 審計：R · index **#83** · static+research · 2026-08-05  
> slug：`fal-ai__ideogram__character`  
> **本輪已修 input（P0）**：required `reference_image_urls[]`（**非** `image_url`）+ `image_size` 對齊專案比例。  
> **未**改 verified／points。零 live。禁止 `--yes`。

## 1. 身分

| 項 | 值 |
|----|-----|
| 站內 id / endpoint | `fal-ai/ideogram/character`（無 alias） |
| label | Ideogram 角色一致 |
| category / kind | **image-to-image** · image |
| tier | **flagship** |
| points | **3** |
| cost | `$0.10(turbo)–0.20(quality)/張` |
| verified | **true**（既有；本輪未改） |
| needs | **image**（主角參考照） |
| recommended | false |
| strengths | 單張參考照→跨提示詞、跨場景同一張臉;寫實角色一致旗艦 |
| bestFor | 見證故事分鏡:同一主角演到底(提示詞英文) |
| 供應商 | Ideogram V3 Character · fal 託管 |
| 姊妹 | 情境 `sc-character` pick：本檔 + Kontext max/pro；臉鎖定經濟檔 `fal-ai/flux-pulid` |

**一句話**：Ideogram **角色一致性**旗艦——上傳一張臉／角色照，跨場景同一主角；站內曾誤送 `image_url`（**P0 已修**）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **3** |
| cost（目錄） | `$0.10(turbo)–0.20(quality)/張` |
| `parseRealCost` | 首個 `$0.10`（`(turbo)` 打斷區間解析）→ usdMid=**0.10** · ×1／張 |
| `realPricePoints` | `0.10 × 1 × 31 = 3.1` → **round 3** |
| `estimatePoints` | 扁平 **3** |
| 生態完整價 | turbo **$0.10**／balanced **$0.15**／quality **$0.20**（`docs/fal生態研究.md`） |
| 校準 | 對 **turbo** **≈**；OpenAPI 預設 `rendering_speed=BALANCED` → 實帳約 **$0.15 ≈5 點**（**P1 預設檔 vs 估點**） |

| 速度檔 | 約 USD | 約點（×31） | vs 固定 3 |
|--------|--------|-------------|-----------|
| TURBO | 0.10 | **3** | **≈** |
| BALANCED（default） | 0.15 | **~5** | 低估 ~2 |
| QUALITY | 0.20 | **~6** | 低估 ~3 |

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約（L0 修後） | **ok** — required 參考圖陣列 + prompt |
| OpenAPI Queue | **HTTP 200** · `IdeogramCharacterInput`／`…Output` |
| metadata | status **active** · display_name「Ideogram V3 Character」· commercial |
| 修前 input | `{ prompt, image_url }` → **缺 `reference_image_urls`** → 必 422／缺欄 |
| 修後 input | `{ prompt, reference_image_urls: [s], image_size }` |
| live | **未跑**（needs=image；禁止 --yes） |
| 結論 | **ready-static-only**（P0 欄位已修；verified 維持 true） |

### OpenAPI 摘要（2026-08-05）

- **Queue**：POST `/fal-ai/ideogram/character`
- **required**：`prompt` · **`reference_image_urls`**（array；文件：目前僅 1 張生效）
- **選填**：`reference_mask_urls` · `image_urls`（風格參考）· `style`（`AUTO`\|`REALISTIC`\|`FICTION`）· `rendering_speed`（`TURBO`\|`BALANCED`\|`QUALITY`，default **BALANCED**）· `image_size` · `num_images`（1–8）· `expand_prompt`（MagicPrompt，default true）· `negative_prompt` · `seed` · `color_palette` · `style_codes` · `sync_mode`
- **Output**：`images[]`（File）+ `seed` — 站內 `extractResult` 吃 `images[0].url` ✅

### 三比例（修後）

| format | body `image_size` | schema enum |
|--------|-------------------|-------------|
| 16:9 | `landscape_16_9` | ✅ |
| 9:16 | `portrait_16_9` | ✅ |
| 1:1 | `square_hd` | ✅ |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 產品 | Ideogram V3 Character——角色身份鎖定，非通用 i2i 重繪 |
| input（修後） | 參考圖進 **`reference_image_urls`**；比例走 `image_size`（非 aspect_ratio） |
| negative | schema **有**；`NEGATIVE_PROMPT_SUPPORTED` **未**收 Ideogram 族（刻意）→ 禁忌移出正向 |
| seed | schema 有；allowlist 無 |
| 中文 | **提示詞建議英文**；Ideogram **不寫中文字卡**（標題卡回 Seedream／Qwen） |
| 臉／授權 | 真人臉需本人授權（產品建議 #12） |

---

## 5. 站內扣點／退點

```
estimatePoints → 3（turbo 錨）
→ falSubmit("fal-ai/ideogram/character", { prompt, reference_image_urls, image_size })
→ 失敗 refund(3)
```

| 檢查 | 結果 |
|------|------|
| 顯示／扣／退 | 三者 **3** → 內部一致 |
| 對 default BALANCED | 平台可能倒貼 ~2 點 → **P1** |
| verified true | 失敗仍 refund |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| i2i 選擇器 flagship | ✅ | needs=image |
| 情境「角色一致／見證主角」 | ✅ | pickIds 含本 id |
| MCP | ✅ | 須帶來源圖 URL |
| rendering_speed UI | ❌ | 吃 BALANCED 預設 |
| 中文標題卡 | ❌ | 誤用會字醜 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 同一主角跨分鏡 | ✅ | bestFor／旗艦定位 |
| 寫實角色品牌一致性 | ✅ | style REALISTIC／AUTO |
| 低成本試臉 | △ | 用 turbo 或 `flux-pulid`（1 點） |
| 中文大海報字 | ❌ | 換 Qwen／Seedream |
| 無參考圖純文生 | ❌ | required 參考陣列 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| OpenAPI | `…?endpoint_id=fal-ai/ideogram/character`（本輪 **200**） |
| Platform | status **active** |
| Playground | https://fal.ai/models/fal-ai/ideogram/character |
| 生態 | `docs/fal生態研究.md` §角色一致（turbo/balanced/quality 價） |
| 站內 | `shared/models.ts` #83（本輪 P0 input） |

---

## 9. 建議動作

- [x] **P0 修 input**：`reference_image_urls: [s]` + `image_size: imageSize(f)`  
- [x] **維持** points=3／verified=true／needs=image  
- [ ] **P1**：default BALANCED 實費 vs 3 點——input 明送 `rendering_speed:"TURBO"` 或 points→5／動態檔  
- [ ] **可選 P2**：`SEED_SUPPORTED`；UI 暴露 style／speed  
- [ ] **L2**（有 KEY）：真實參考圖 + 英文 prompt 出片  

**L0 結論**：OpenAPI 綠；**P0 幽靈 `image_url` 已修**；估點貼 turbo、預設 balanced 有輕度倒貼。  
**未做：** live、改 points、改 verified。
