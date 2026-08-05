# fal-ai/flux-pulid

> 審計：R · index **#85** · static+research · 2026-08-05  
> slug：`fal-ai__flux-pulid`  
> **本輪已修 input（P0）**：required `reference_image_url`（**非** `image_url`）+ `image_size` 對齊專案比例。  
> **未**改 verified／points。零 live。禁止 `--yes`。

## 1. 身分

| 項 | 值 |
|----|-----|
| 站內 id / endpoint | `fal-ai/flux-pulid`（無 alias） |
| label | PuLID FLUX 人臉鎖定 |
| category / kind | **image-to-image** · image |
| tier | **economy** |
| points | **1** |
| cost | `$0.0333/MP` |
| verified | **true**（既有；本輪未改） |
| needs | **image**（人臉清晰照） |
| recommended | false |
| strengths | FLUX 底免訓練人臉鎖定;一張臉照+提示詞進任何場景 |
| bestFor | 把授權過的講者臉放進生成場景(提示詞英文) |
| 供應商 | PuLID × FLUX · fal 託管 |
| 姊妹 | 旗艦角色一致 `fal-ai/ideogram/character`；低成本 `minimax/…/subject-reference` |

**一句話**：FLUX 系 **免訓練臉 ID**——一張授權臉照 + 英文提示詞；站內曾誤送 `image_url`（**P0 已修**）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **1** |
| cost | `$0.0333/MP` |
| `parseRealCost` | usdMid=**0.0333** · ×**1MP**（標準輸出假設） |
| `realPricePoints` | `0.0333 × 1 × 31 ≈ 1.03` → **round 1** |
| `estimatePoints` | 扁平 **1** |
| 校準 | 對 **~1MP** **≈**；大圖／高解析 MP 上升則低估（P2） |
| 生態 | 研究表價欄空白；目錄 `$0.0333/MP` 為站內錨（文件原註「未查到」已填） |

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約（修後） | **ok** |
| OpenAPI | **HTTP 200** · `FluxPulidInput`／`…Output` |
| metadata | status **active** · display_name「PuLID Flux」· commercial |
| 修前 input | `{ prompt, image_url }` → **缺 `reference_image_url`** |
| 修後 input | `{ prompt, reference_image_url: s, image_size }` |
| live | **未跑**（needs；禁止 --yes） |
| 結論 | **ready-static-only** |

### OpenAPI 摘要（2026-08-05）

- **Queue**：POST `/fal-ai/flux-pulid`
- **required**：`prompt` · **`reference_image_url`**（string，單張）
- **選填**：`image_size`（default **`landscape_4_3`**）· `id_weight`（0–1，default 1）· `true_cfg` · `guidance_scale` · `num_inference_steps` · `start_step` · `max_sequence_length` · `negative_prompt` · `seed` · `enable_safety_checker` · `sync_mode`
- **Output**：`images[]` + `seed` + timings／nsfw — `extractResult` ✅ `images[0].url`

### 三比例（修後）

| format | body `image_size` | 修前 |
|--------|-------------------|------|
| 16:9 | `landscape_16_9` | 不送 → 誤吃 **4:3** 預設 |
| 9:16 | `portrait_16_9` | 同上 |
| 1:1 | `square_hd` | 同上 |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 產品 | PuLID 身份嵌入 + FLUX 生成；工程參數多（id_weight／true_cfg）站內吃預設 |
| input | 臉圖欄名必須是 **`reference_image_url`**（單數） |
| negative | schema 有；allowlist **未**收 FLUX 主線（刻意） |
| seed | schema 有；allowlist 無 |
| 中文 | **提示詞英文**；臉保真≠文字渲染 |
| 授權 | 真人臉需本人授權 |

---

## 5. 站內扣點／退點

```
estimatePoints → 1
→ falSubmit("fal-ai/flux-pulid", { prompt, reference_image_url, image_size })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| 顯示／扣／退 | 皆 **1** → 一致 |
| 對 ~1MP@$0.0333 | **≈** |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| i2i economy | ✅ | needs=image |
| 情境人臉鎖定 | ✅ | pick 與 Ideogram／MiniMax 並列 |
| id_weight UI | ❌ | 工程預設 1 |
| MCP | ✅ | 來源圖必填 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 授權講者臉進場景 | ✅ | bestFor |
| 系列角色分鏡 | △ | 寫實臉 OK；跨場景旗艦推 Ideogram Character |
| 最低成本試臉 | ✅ | 1 點經濟 |
| 中文海報字 | ❌ | 另模 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| OpenAPI | `…?endpoint_id=fal-ai/flux-pulid`（**200**） |
| Platform | **active** |
| Playground | https://fal.ai/models/fal-ai/flux-pulid |
| 生態 | `docs/fal生態研究.md` PuLID FLUX |
| 站內 | `shared/models.ts` #85（本輪 P0 input） |

---

## 9. 建議動作

- [x] **P0 修 input**：`reference_image_url` + `image_size`  
- [x] **維持** points=1／verified=true  
- [ ] **可選 P2**：大圖 MP 動態估點；SEED allowlist  
- [ ] **可選 P3**：包裝 id_weight 預設檔給志工  
- [ ] **L2**：授權樣臉 live  

**L0 結論**：OpenAPI 綠；**P0 欄位名已修**；points 對 1MP ≈。  
**未做：** live、改 points、改 verified。
