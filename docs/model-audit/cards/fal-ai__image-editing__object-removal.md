# fal-ai/image-editing/object-removal

> 審計：R · index **#53** · static+research · 2026-08-05  
> slug：`fal-ai__image-editing__object-removal`  
> 端點／input **對齊**（`image_url`+可選 `prompt`）。**無 P0 碼修**。零 live。禁止 `--yes`。

## 1. 身分

| 項 | 值 |
|----|-----|
| 站內 id / endpoint | `fal-ai/image-editing/object-removal`（無 alias） |
| label | 物件移除 Object Removal |
| category / kind | **image-to-image** · image |
| tier | **economy** |
| points | **1** |
| cost | `$0.04/張` |
| verified | **false**（既有；本輪未改——待 L2） |
| needs | **image** |
| recommended | false |
| strengths | 移除雜物/路人並自動補背景;一鍵免畫遮罩 |
| bestFor | 活動照清雜物、讓開示/合影畫面乾淨莊嚴 |
| 供應商 | fal image-editing 套件 · omni 去物 |
| 姊妹 | 精修旗艦 `fal-ai/finegrain-eraser`（情境去物 pick 雙選） |

**一句話**：文字描述「刪什麼」即可去物補背景——活動照清路人／雜物的**經濟一鍵檔**。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **1** |
| cost（目錄） | `$0.04/張` |
| `parseRealCost` | usdMid=**0.04** · ×1／張 |
| `realPricePoints` | `0.04 × 1 × 31 = 1.24` → **round 1** |
| `estimatePoints` | 扁平 **1** |
| 生態 | 研究約 $0.02–0.04/張；目錄錨 $0.04 |
| 校準 | 對 **$0.04/張** **≈**（略偏低於 1.24，可接受） |

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** — required 僅 `image_url`；prompt 可選 |
| OpenAPI Queue | **HTTP 200** · openapi **3.0.4** · `ImageEditingObjectRemovalInput`／`…Output` |
| metadata | endpointId=`fal-ai/image-editing/object-removal` · about「Remove unwanted objects」 |
| 站內 input | `{ prompt: p, image_url: s }` ✅ |
| live | **未跑**（needs；禁止 --yes） |
| 結論 | **ready-static-only** |

### OpenAPI 摘要（2026-08-05）

- **Queue**：POST `/fal-ai/image-editing/object-removal`
- **required**：`image_url`
- **選填**：`prompt`（default **`background people`**——「Specify which objects to remove」）· `aspect_ratio`（21:9…9:21 等）· `guidance_scale`（default 3.5）· `num_inference_steps`（default 30）· `safety_tolerance` 1–6 · `output_format` · `seed` · `sync_mode`
- **Output**：`images[]` + `seed` — `extractResult` ✅
- **無**：mask／bbox（純文字去物）

### 三比例（現況）

| format | 站內 body | 實效 |
|--------|-----------|------|
| 16:9 / 9:16 / 1:1 | **不送** aspect_ratio | 依模型預設／原圖；可選映射（P2） |

### 空 prompt 行為

站內若使用者不填描述，仍會送 `prompt: ""`（或空字串）。OpenAPI 預設為 `background people`——**空字串是否回落預設**視 fal 實作；建議工作台提示「描述要移除的物件」（P2）。

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 產品 | 語意去物＋背景補全；免畫遮罩 |
| input | 圖必填；prompt 指「刪什麼」（非生成描述） |
| vs Finegrain | Finegrain 6 點印刷級；本檔 1 點批量清雜 |
| negative | schema **無** |
| seed | 有；allowlist 無 |
| 中文 | 物件名可用中文試；英文更穩（待 L2） |

---

## 5. 站內扣點／退點

```
estimatePoints → 1
→ falSubmit("fal-ai/image-editing/object-removal", { prompt, image_url })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| 顯示／扣／退 | 皆 **1** → 一致 |
| 對 $0.04 | **≈** |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| i2i economy | ✅ | needs=image |
| 情境「去物／清雜」 | ✅ | pick 與 finegrain-eraser 並列 |
| MCP | ✅ | 須帶圖 URL |
| mask UI | ❌ | schema 無 mask |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 活動照清路人／雜物 | ✅ | bestFor |
| 印刷關鍵去物 | △ | 改 Finegrain |
| 只靠框選無文字 | ❌ | 需 prompt（可空吃 default） |
| 浮水印（own content） | △ | 產品敘述可；合規自負 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| OpenAPI | `…?endpoint_id=fal-ai/image-editing/object-removal`（本輪 **200**） |
| Playground | https://fal.ai/models/fal-ai/image-editing/object-removal |
| 生態 | `docs/fal生態研究.md` Object Removal 列 |
| 站內 | `shared/models.ts` #53 |

---

## 9. 建議動作

- [x] **維持** points=1／input `prompt`+`image_url`／verified=false  
- [ ] **P2**：`aspect_ratio: aspect(f)`；空 prompt 時省略欄位吃 default  
- [ ] **L2**（有 KEY）：真實活動照 + 中／英去物描述 → 可考慮 verified=true  

**L0 結論**：OpenAPI 綠；契約對齊；**無 P0**。  
**未做：** live、改 points、改 verified。
