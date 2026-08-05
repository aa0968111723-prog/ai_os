# fal-ai/photomaker

> 審計：R · index **#87** · static+research · 2026-08-05  
> slug：`fal-ai__photomaker`  
> **本輪已修 input（P0）**：required `image_archive_url`（**非** `image_url`）+ `needs`→**zip**。  
> **未**改 verified／points。零 live。禁止 `--yes`。

## 1. 身分

| 項 | 值 |
|----|-----|
| 站內 id / endpoint | `fal-ai/photomaker`（無 alias） |
| label | PhotoMaker 人像生成 |
| category / kind | **image-to-image** · image |
| tier | **budget** |
| points | **1** |
| cost | `$0.001/算秒(每張約 1–3 美分)` |
| verified | **true**（既有；本輪未改） |
| needs | **zip**（1–4 張參考照的 ZIP；修後由 image 改 zip） |
| recommended | false |
| strengths | 參考照學臉生成;最便宜的「把某人畫進畫面」 |
| bestFor | 人物紀念圖草稿(SDXL 世代質感有限) |
| 供應商 | PhotoMaker（SDXL 世代 ID 堆疊）· fal 託管 |
| 姊妹 | 新代臉鎖定 `fal-ai/flux-pulid`；角色一致 `ideogram/character`／`instant-character` |

**一句話**：最便宜「把某人畫進畫面」——**ZIP 多張參考照**堆疊學臉；站內曾誤送 `image_url`（**P0 已修**）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **1** |
| cost（目錄） | `$0.001/算秒(每張約 1–3 美分)` |
| `parseRealCost` | 算秒類常難機械換算；目錄錨「每張約 1–3 美分」→ 取中 **~$0.02** 粗核 ×31 ≈ **0.6–0.9** → 扁平 **1** |
| `estimatePoints` | 扁平 **1** |
| 生態 | `$0.001/compute-second`；研究估每張 1–3 美分 |
| 校準 | 短跑 **≈1**；高 steps／batch 可能略低估（P2） |

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約（修後） | **ok** — required `image_archive_url`+`prompt` |
| OpenAPI Queue | **HTTP 200** · openapi **3.0.4** · `PhotomakerInput`／`PhotomakerOutput` |
| metadata | endpointId=`fal-ai/photomaker` · category image-to-image |
| 修前 input | `{ prompt, image_url }` → **缺 `image_archive_url`** → 必 422／缺欄 |
| 修後 input | `{ prompt, image_archive_url: s }` + needs=**zip** |
| live | **未跑**（needs；禁止 --yes） |
| 結論 | **ready-static-only**（P0 欄位已修；ZIP 語意仍待 L2） |

### OpenAPI 摘要（2026-08-05）

- **Queue**：POST `/fal-ai/photomaker`
- **required**：`image_archive_url`（ZIP 參考照 URL；例 elon.zip）· `prompt`
- **選填**：`base_pipeline` photomaker｜photomaker-style · `initial_image_url`／`initial_image_strength` · `style`（Photographic 等 11 檔，default Photographic）· `style_strength` 15–50 · `negative_prompt` · `num_inference_steps`（default 50）· `num_images` 1–4 · `guidance_scale` · `seed`
- **Output**：`images[]` + `seed` — `extractResult` ✅
- **無**：單張 `image_url` required（僅 optional initial img2img）

### 契約注意

| 點 | 說明 |
|----|------|
| ZIP | 官方：最多約 4 張參考照打包；單圖 URL **不是** archive |
| 觸發詞 | 範例 prompt 含 **`img`**（如 `portrait photo of a man img`）— 站內未自動注入（P1） |
| 比例 | schema **無** image_size／aspect_ratio → 輸出約 1024² |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 產品 | PhotoMaker stacked ID embedding + SDXL；質感舊於 FLUX／新代 |
| input（修後） | 來源必須進 **`image_archive_url`**；needs=zip 讓 UI 收 ZIP |
| style | 預設 Photographic；站內不暴露 |
| negative | schema 有；allowlist 未收 |
| seed | schema 有；allowlist 無 |
| 中文 | 提示詞英文；不渲染中文字卡 |
| 授權 | 真人臉需本人授權 |

---

## 5. 站內扣點／退點

```
estimatePoints → 1
→ falSubmit("fal-ai/photomaker", { prompt, image_archive_url })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| 顯示／扣／退 | 皆 **1** → 一致 |
| 對 ~1–3¢/張 | **≈** 扁平 1 |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| i2i budget | ✅ | needs=**zip**（修後） |
| 單圖素材庫 | ❌ | 須先打 ZIP；勿當一般 i2i |
| MCP | ✅ | 須傳 ZIP 可下載 URL |
| style UI | ❌ | 吃 Photographic 預設 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 多角度臉試稿、極省成本 | ✅ | bestFor 草稿 |
| 正式寫實主角 | △ | 用 Ideogram Character／PuLID |
| 只有一張 PNG 無 ZIP | ❌ | 需 archive；UI 現收 zip |
| 中文海報字 | ❌ | 換 Qwen／Seedream |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| OpenAPI | `…?endpoint_id=fal-ai/photomaker`（本輪 **200**） |
| Playground | https://fal.ai/models/fal-ai/photomaker |
| API 例 | `image_archive_url` → elon.zip |
| 生態 | `docs/fal生態研究.md` PhotoMaker 列 |
| 站內 | `shared/models.ts` #87（本輪 P0） |

---

## 9. 建議動作

- [x] **P0 修 input**：`image_archive_url: s`；`needs: "zip"`；sourceHint 改 ZIP  
- [x] **維持** points=1／verified=true  
- [ ] **P1**：prompt 自動補 `img` 觸發詞（若使用者未寫）  
- [ ] **P2**：style／base_pipeline UI；算秒動態估點  
- [ ] **L2**（有 KEY）：真實 ZIP + 含 img 的英文 prompt  

**L0 結論**：OpenAPI 綠；**P0 幽靈 `image_url` 已修**為 archive；needs 對齊 ZIP。  
**未做：** live、改 points、改 verified。
