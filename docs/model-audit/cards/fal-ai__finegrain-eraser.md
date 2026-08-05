# fal-ai/finegrain-eraser

> 審計：R · index **#94** · static+research · 2026-08-05  
> slug：`fal-ai__finegrain-eraser`  
> 端點／input **對齊**（`image_url`+`prompt`）。**無 P0 碼修**。零 live。禁止 `--yes`。

## 1. 身分

| 項 | 值 |
|----|-----|
| 站內 id / endpoint | `fal-ai/finegrain-eraser`（無 alias） |
| label | Finegrain 精修去物 |
| category / kind | **image-to-image** · image |
| tier | **flagship** |
| points | **6** |
| cost | `$0.18/次(prompt 模式);bbox/mask 模式 $0.04/次` |
| verified | **true**（既有；本輪未改） |
| needs | **image** |
| recommended | false |
| strengths | 高品質物件移除(prompt 模式);邊緣乾淨的精修版 |
| bestFor | 印刷級海報的關鍵去物 |
| 供應商 | Finegrain · fal 託管 |
| 姊妹 | 經濟去物 `fal-ai/image-editing/object-removal`（情境去物 pick 雙選） |

**一句話**：自然語言去物＋補背景的**精修旗艦**——比通用 Object Removal 貴、邊緣更乾淨；站內走 **prompt 模式**（$0.18 錨）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **6** |
| cost（目錄） | 上表 |
| `parseRealCost` | 首個 `$0.18` · unit **／次** → ×1 |
| `realPricePoints` | `0.18 × 1 × 31 = 5.58` → **round 6** |
| `estimatePoints` | 扁平 **6** |
| 校準 | 對 **prompt／standard 檔 $0.18** **≈** |

### 模式／計費落差（文件債）

| 來源 | 說法 |
|------|------|
| 目錄 cost | prompt **$0.18**；bbox/mask **$0.04** |
| 生態研究 | `$0.18–0.36/次`；bbox/mask $0.04 起 |
| **OpenAPI `mode`** | 僅 **`express`\|`standard`\|`premium`**（default **`standard`**）——**無** bbox／mask 欄位 |

→ 站內只送 prompt+image_url → 吃 **standard** 預設，與 $0.18／6 點錨一致。bbox/mask 低價路徑**未**暴露（若官方仍有，需另 endpoint 或 body 擴充；本輪 schema 未見）。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** — required 與 input 一致 |
| OpenAPI | **HTTP 200** · `FinegrainEraserInput`／`…Output` |
| metadata | status **active** · display_name「Finegrain Eraser」· tags utility/editing · commercial |
| 站內 input | `{ prompt: p, image_url: s }` ✅ |
| live | **未跑**（needs；禁止 --yes） |
| 結論 | **ready-static-only** |

### OpenAPI 摘要（2026-08-05）

- **Queue**：POST `/fal-ai/finegrain-eraser`
- **required**：`image_url` · `prompt`（「要抹除的物件」文字描述）
- **選填**：`mode`（express／standard／premium）· `seed`（0–999）
- **Output**：`image`（File）+ `used_seed` — `extractResult` 吃 `image.url` ✅
- **無**：mask_url／bbox／aspect_ratio／image_size

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 產品 | 語意去物：連陰影／反光一併處理，場景合理填補 |
| input | 圖 + 描述「刪什麼」；**空 prompt 會缺 required**（勿當純點選遮罩工具） |
| mode | 不送 → **standard**；premium 可能更貴（目錄區間上緣 $0.36 待 live 帳單） |
| negative／seed | 無 negative；seed 有、allowlist 無 |
| vs Object Removal | 後者 1 點經濟；本檔印刷級關鍵去物 |

---

## 5. 站內扣點／退點

```
estimatePoints → 6
→ falSubmit("fal-ai/finegrain-eraser", { prompt, image_url })
→ 失敗 refund(6)
```

| 檢查 | 結果 |
|------|------|
| 顯示／扣／退 | 皆 **6** → 一致 |
| 對 $0.18 standard | **≈** |
| premium 若加價 | 扁平 6 可能低估 → 待 live（P2） |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| i2i flagship | ✅ | needs=image |
| 情境「去物／清雜」 | ✅ | 與 object-removal 並列 |
| mode UI | ❌ | 固定 standard 預設 |
| mask／bbox 低價 | ❌ | schema 未見 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 印刷海報關鍵去物 | ✅ | bestFor |
| 活動照清路人／雜物 | ✅ | 邊緣要求高時優於 1 點檔 |
| 批量便宜清雜 | △ | 用 object-removal |
| 無文字、只靠框選 | ❌ | 需 prompt；schema 無 mask |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| OpenAPI | `…?endpoint_id=fal-ai/finegrain-eraser`（**200**） |
| Platform | **active** |
| Playground | https://fal.ai/models/fal-ai/finegrain-eraser |
| 生態 | `docs/fal生態研究.md` Finegrain 列 |
| 站內 | `shared/models.ts` #94 |

---

## 9. 建議動作

- [x] **維持** id／endpoint／input／points=6／verified=true  
- [ ] **P1 文案**：cost 中「bbox/mask $0.04」與現行 OpenAPI **mode 三檔**不一致——改寫為 express/standard/premium 或註「站內僅 prompt+standard」  
- [ ] **可選 P2**：暴露 `mode`；premium 動態估點  
- [ ] **L2**：真實去物 prompt live  

**L0 結論**：契約綠、input 正確、**無 P0**；計費文案與 schema 模式名脫節屬文件債。  
**未做：** live、改 points、改 verified。
