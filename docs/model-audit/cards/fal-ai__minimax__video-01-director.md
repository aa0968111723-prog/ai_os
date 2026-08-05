# fal-ai/minimax/video-01-director

> 審計：R3 · index **#114** · static+research · 2026-08-05  
> slug：`fal-ai__minimax__video-01-director`  
> 零 live；**未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| id / endpoint | `fal-ai/minimax/video-01-director`（無 alias） |
| label | Video-01 Director(Hailuo 01) |
| category / kind | **text-to-video** · video |
| tier | **economy** |
| points | **16** |
| cost（目錄） | `$0.5/支` |
| verified | **true**（既有；本輪不翻） |
| needs | 無 |
| recommended | false |
| strengths | 導演式運鏡指令(推軌、環繞、俯仰)直覺好控 |
| bestFor | 精準指定運鏡的鏡頭(如環繞佛像) |
| 供應商 | MiniMax **Hailuo T2V-01-Director** via fal |
| 姊妹 | Hailuo-02 Standard t2v（#113）；Hailuo 2.3 Pro；Video-01 家族其他路徑 |

**一句話**：Hailuo **第一代導演檔**——用 `[Pan left]`／`[Zoom in]` 等方括號運鏡指令精準控鏡；固定 **$0.5/支** → 站內 **16 點**。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **16** |
| cost | `$0.5/支`（固定單次，非按秒） |
| `parseRealCost` | usdMid=**0.50**；單位「/支」→ ×1 |
| `realPricePoints` | 0.50 × 31 = **15.5** → round **16** |
| 校準報告 | **15.5 ≈** |
| estimatePoints | **扁平 16**（與 prompt 長度／運鏡標記數無關） |

**判定**：維持 16；固定價無 duration 脫鉤風險（對照按秒片 P0 較乾淨）。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** |
| OpenAPI | **HTTP 200** · `MinimaxVideo01DirectorInput`／`Output` |
| input 站內 | `{ prompt, aspect_ratio: aspect(f) }` |
| OpenAPI 欄位 | **僅** `prompt`（required）、`prompt_optimizer` — **無** `aspect_ratio`／duration／resolution |
| live | **未跑**（無 FAL_KEY） |
| 結論 | **ready-static-only**（端點存活；aspect 死欄；verified 已 true） |

### OpenAPI 摘要（2026-08-05）

- Paths：`POST /fal-ai/minimax/video-01-director` + status／cancel／result  
- Metadata：category text-to-video；about「Hailuo T2V-01-Director … precise camera control」  
- **required**：`prompt` only  
- **order**：prompt → prompt_optimizer  
- `prompt`：文生影片；**方括號運鏡**（最多約 3 組組合）  
  - 支援例：Truck left/right、Pan left/right、Push in/Pull out、Pedestal up/down、Tilt up/down、Zoom in/out、Shake、Tracking shot、Static shot  
  - 例：`[Truck left, Pan right, Zoom in]`  
- `prompt_optimizer`：boolean，default **true**  
- **無**：aspect_ratio、duration、seed、negative_prompt、generate_audio  
- **Output**：`video`（File.url）required  

### 三比例

| format | 站內 | schema |
|--------|------|--------|
| 16:9／9:16／1:1 | 皆送 `aspect_ratio` | **死欄**（多半忽略；比例吃官方預設） |

同 Hailuo 02／2.3 Pro t2v 型：非 422 硬傷，但不控畫幅。

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 產品 | Hailuo **01 Director**——運鏡指令特化；新世代動態更好，但本檔運鏡控制仍直覺 |
| 控鏡 | **寫在 prompt 字串**內的 `[…]` 標記，非獨立 API 欄 |
| 站內 mechanics | minimax 影片族；文字窗閉源 |
| input | 只保證 `prompt`；optimizer 預設 on；aspect 多餘 |
| negative／seed | schema 無 → 不送正確 |
| 中文 | 提示理解優；畫面內中文字不可靠 |

---

## 5. 站內扣點／退點

```
estimatePoints → realPricePoints("$0.5/支") → 16
→ reserveQuota(16) → falSubmit(本 id, { prompt, aspect_ratio })
→ 失敗 refund(16)
```

| 檢查 | 結果 |
|------|------|
| 顯示／扣／退 | 一致 16 |
| 與官價 | $0.5×31≈15.5 → 16 ≈ |
| 固定支價 | 無秒數脫鉤 |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| t2v 選擇器 economy | ✅ | 無 needs |
| MCP／tRPC | ✅ | modelId 全路徑 |
| 運鏡 UI 旋鈕 | ❌ | 需使用者自寫 `[Pan left]` 等 |
| aspect／duration UI | ❌ | schema 無 |
| 見證會演主路徑 | ❌ | 多 2.3 Pro i2v |

**MCP 陷阱**：運鏡靠 prompt 標記，勿傳不存在的 `camera_motion` 欄；勿期望 aspect_ratio 生效。

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 精準指定運鏡（環繞佛像、仰拍） | ✅ 首選檔之一 | bestFor |
| 日常敘事／物理 | △ | 02 Standard／2.3 更對世代 |
| 人物情緒特寫 | ❌ | Hailuo 2.3 Pro |
| 有聲一次出片 | ❌ | schema 無音 |
| 畫面內中文字卡 | ❌ | 另做字卡 |
| 方圖專案 | △ | 死欄；比例不可控 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| fal OpenAPI | `…/openapi.json?endpoint_id=fal-ai/minimax/video-01-director`（**200**） |
| Playground | https://fal.ai/models/fal-ai/minimax/video-01-director |
| 站內 | `shared/models.ts`；姊妹 #113 hailuo-02 standard 卡 |
| 生態／校準 | `docs/fal生態研究.md`；$0.5/支 → 15.5≈ |

---

## 9. 建議動作

- [x] **維持** id／endpoint／points=16／verified=true／cost `$0.5/支`  
- [x] **維持** 不送 negative／seed（schema 無）  
- [ ] **可選 P2**：input 停送死欄 `aspect_ratio`  
- [ ] **可選 P3**：UI／help 提示支援的 `[Truck left]`… 運鏡標記（最多約 3 組）  
- [ ] **可選 P3**：bestFor 文案保留；與 2.3 分工（運鏡 vs 表演）  
- [ ] **L2**（有 KEY）：單次 `--yes` 約 16 點——偏貴，控費時可延後  
- [ ] **勿**把本檔當 2.3 會演替代；**勿**自造非 schema 運鏡 JSON 欄  

**L0 結論**：OpenAPI 綠；固定 $0.5→16 點≈；運鏡在 prompt 方括號；aspect 死欄。  
**未做：** live、改 points／verified／input。
