# fal-ai/bria/background/replace

> 審計：R · index **#50** · static+research · 2026-08-05  
> slug：`fal-ai__bria__background__replace`  
> **本輪已修 input（P0）**：背景描述欄為 **`prompt`**（**非** 幽靈 `bg_prompt`）。  
> **未**改 verified／points。零 live。禁止 `--yes`。

## 1. 身分

| 項 | 值 |
|----|-----|
| 站內 id / endpoint | `fal-ai/bria/background/replace`（無 alias） |
| label | Bria 換背景 |
| category / kind | **image-to-image** · image |
| tier | **economy** |
| points | **1** |
| cost | `約 $0.04/張` |
| verified | **true**（既有；本輪未改） |
| needs | **image**（前景主體圖） |
| recommended | false |
| strengths | 文字描述換背景;授權資料訓練、商用版權安全、結果穩定 |
| bestFor | 一鍵換成禪堂/蓮花/晨光背景,對外發布安心 |
| 供應商 | Bria · 授權資料訓練 · fal 託管 |
| 姊妹 | 去背 `fal-ai/bria/background/remove`；商品情境 `bria/product-shot`；Ideogram 換背景 |

**一句話**：保留主體、文字（或參考圖）換新背景——商用版權安全的一鍵換景；站內曾送 **`bg_prompt`**（**P0 已修**→`prompt`）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **1** |
| cost（目錄） | `約 $0.04/張` |
| `parseRealCost` | usdMid≈**0.04** · ×1／張 |
| `realPricePoints` | `0.04 × 31 = 1.24` → **round 1** |
| `estimatePoints` | 扁平 **1** |
| 生態 | 研究約 $0.04；另有 $0.023 說法（舊表）— 目錄錨 0.04 |
| 校準 | **≈**；fast 預設可能略便宜（P2 對帳） |

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約（修後） | **ok** |
| OpenAPI Queue | **HTTP 200** · openapi **3.0.4** · `BriaBackgroundReplaceInput`／`BGReplaceOutput` |
| metadata | endpointId=`fal-ai/bria/background/replace` |
| 修前 input | `{ image_url, bg_prompt }` → schema **無** `bg_prompt` → 背景描述**被忽略**／可能 422 |
| 修後 input | `{ image_url: s, prompt: p }` ✅ |
| live | **未跑**（needs；禁止 --yes） |
| 結論 | **ready-static-only**（P0 已修） |

### OpenAPI 摘要（2026-08-05）

- **Queue**：POST `/fal-ai/bria/background/replace`
- **required**：`image_url`（前景）
- **選填**：`prompt`（背景文字描述；anyOf string｜null）· `ref_image_url`（背景參考圖；**與文字二擇一**——description 仍寫「ref_image_url or bg_prompt」屬**文件債**，實際 property 名是 **`prompt`**）· `negative_prompt` · `refine_prompt`（default true）· `fast`（default true）· `num_images` 1–4 · `seed` · `sync_mode`
- **Output**：`images[]` + `seed` — `extractResult` ✅
- **無**：`bg_prompt` property

### 契約注意

| 點 | 說明 |
|----|------|
| 幽靈欄 | 舊註「常用 bg_prompt」來自 description 文字，**schema 正式名 = prompt** |
| 二擇一 | prompt 文字 **或** ref_image_url；站內只走文字路徑 |
| 空 prompt | required 僅 image_url——兩者皆空可能無有效背景條件（P2 校驗） |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 產品 | Bria 主體保留 + 生成新背景；授權資料＝商用較安心 |
| input（修後） | 前景 `image_url`；背景描述 **`prompt`** |
| fast | 預設 true；品質／價差未站內暴露 |
| negative | schema 有；allowlist 未收 |
| 比例 | schema **無** aspect_ratio／image_size → 跟原圖 |
| 中文 | 背景描述建議英文（產品與生態一致） |

---

## 5. 站內扣點／退點

```
estimatePoints → 1
→ falSubmit("fal-ai/bria/background/replace", { image_url, prompt })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| 顯示／扣／退 | 皆 **1** → 一致 |
| 對 ~$0.04 | **≈** |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| i2i economy | ✅ | needs=image |
| 情境換背景／商品 | ✅ | pickIds 含本 id |
| MCP | ✅ | 須帶前景圖 |
| ref_image 背景參考 | ❌ | 未暴露；只文字 prompt |
| fast UI | ❌ | 吃 default true |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 對外宣傳換莊嚴背景 | ✅ | bestFor；版權安全 |
| 先去背再合成 | △ | 本檔一步完成；或分步 remove+合成 |
| 無文字只靠背景參考圖 | △ | schema 支援 ref_image_url；站內未接 |
| 需精確遮罩 | ❌ | 非 mask 工具 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| OpenAPI | `…?endpoint_id=fal-ai/bria/background/replace`（本輪 **200**） |
| Playground | https://fal.ai/models/fal-ai/bria/background/replace |
| 生態 | `docs/fal生態研究.md` Bria 換背景 |
| 站內 | `shared/models.ts` #50（本輪 P0：`prompt`） |

---

## 9. 建議動作

- [x] **P0 修 input**：`bg_prompt` → **`prompt`**  
- [x] **維持** points=1／verified=true／needs=image  
- [ ] **P2**：可選 `ref_image_url` 第二來源；空 prompt 校驗  
- [ ] **L2**（有 KEY）：前景圖 + 英文背景描述  

**L0 結論**：OpenAPI 綠；**P0 幽靈 `bg_prompt` 已修**。  
**未做：** live、改 points、改 verified。
